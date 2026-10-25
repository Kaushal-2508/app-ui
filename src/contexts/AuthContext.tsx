import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildAppUrl } from "@/lib/appUrl";
import { purgeAvatarCache } from "@/lib/avatarStore";
import { clearPersistedQueryCache } from "@/lib/queryPersist";
import { isNativePlatform } from "@/lib/native";
import { disablePushOnThisDevice } from "@/lib/pushDevices";
import type { AuthError, User, Session } from "@supabase/supabase-js";

export interface PasswordStatus {
  mustReset: boolean;
  isExpired: boolean;
}

// ── Module-level password-status cache ─────────────────────────────────────
// Auth state lives in ONE AuthProvider (mounted above BrowserRouter), so there
// is exactly one `onAuthStateChange` subscriber, and it calls
// `checkPasswordStatus` on every auth event (SIGNED_IN, TOKEN_REFRESHED, …).
// This cache keeps that to one `profiles` fetch per user per TTL, with
// single-flight dedupe (§23). It predates the provider (1e43906, 2026-07-08),
// when 56+ independent `useAuth()` instances shared it; the provider
// (08f349c5) then removed those N listeners and the per-mount loading flash.
// Tradeoff: an admin flipping must_reset_password mid-session is picked up
// on the next TTL expiry (≤5 min) instead of the next auth event.
const PW_STATUS_TTL_MS = 5 * 60_000;
let pwStatusCache: { userId: string; status: PasswordStatus; at: number } | null = null;
let pwStatusInflight: { userId: string; promise: Promise<PasswordStatus | null> } | null = null;

function clearPasswordStatusCache() {
  pwStatusCache = null;
  pwStatusInflight = null;
}

async function fetchPasswordStatus(userId: string): Promise<PasswordStatus | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("must_reset_password, password_expires_at")
    .eq("id", userId)
    .single();
  if (error || !profile) return null;
  const isExpired = profile.password_expires_at
    ? new Date(profile.password_expires_at) < new Date()
    : false;
  return { mustReset: profile.must_reset_password || false, isExpired };
}

async function getPasswordStatusCached(userId: string): Promise<PasswordStatus | null> {
  if (pwStatusCache && pwStatusCache.userId === userId && Date.now() - pwStatusCache.at < PW_STATUS_TTL_MS) {
    return pwStatusCache.status;
  }
  if (pwStatusInflight && pwStatusInflight.userId === userId) {
    return pwStatusInflight.promise;
  }
  const promise = fetchPasswordStatus(userId)
    .then((status) => {
      if (status) pwStatusCache = { userId, status, at: Date.now() };
      return status;
    })
    .finally(() => {
      if (pwStatusInflight?.promise === promise) pwStatusInflight = null;
    });
  pwStatusInflight = { userId, promise };
  return promise;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /**
   * True only until the FIRST `getSession()` resolves after app boot, then
   * permanently false. Because the provider sits above BrowserRouter it never
   * remounts on navigation, so route changes no longer flash the auth
   * skeleton in ProtectedRoute.
   */
  loading: boolean;
  passwordStatus: PasswordStatus;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordStatus, setPasswordStatus] = useState<PasswordStatus>({
    mustReset: false,
    isExpired: false,
  });

  // The query cache now survives a session (src/lib/queryPersist.ts) and
  // signs in without a reload when a session expired and someone signs back
  // in on the same device. If that someone is a different account, every
  // cached roster and result belongs to the previous one: drop it all.
  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);
  const noteSignedInUser = useCallback((id: string | null) => {
    if (!id) return;
    if (lastUserIdRef.current && lastUserIdRef.current !== id) queryClient.clear();
    lastUserIdRef.current = id;
  }, [queryClient]);

  useEffect(() => {
    const checkPasswordStatus = async (userId: string) => {
      try {
        const status = await getPasswordStatusCached(userId);
        if (status) setPasswordStatus(status);
      } catch (err) {
        console.error("Failed to check password status:", err);
      }
    };

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      noteSignedInUser(session?.user?.id ?? null);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkPasswordStatus(session.user.id);
      }
      setLoading(false);
    }).catch((err) => {
      console.error("Failed to get session:", err);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        noteSignedInUser(session?.user?.id ?? null);
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          checkPasswordStatus(session.user.id);
        } else {
          clearPasswordStatusCache();
          setPasswordStatus({ mustReset: false, isExpired: false });
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [noteSignedInUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const redirectUrl = buildAppUrl("/");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    // Sign-out must be a CLIENT-side action with a best-effort server revoke —
    // never something the server can block. The /auth/v1/logout call can return
    // 403 (a stale/invalid token after a JWT-key rotation or server-side session
    // purge) or reject on a saturated auth server; in those cases supabase-js does
    // not reliably clear the persisted session, so the user stays "signed in".
    // We therefore: (1) best-effort revoke on the server, then (2) ALWAYS purge the
    // local session ourselves, and (3) never throw — so the UI can always reach /login.
    let resultError: Error | null = null;
    clearPasswordStatusCache();
    // Native shell only: drop this phone's push registration while the session
    // can still authorise the DELETE, so the next user of a shared device does
    // not receive this user's notifications. Bounded so a dead network can
    // never hold up reaching /login; a leftover row is swept server-side when
    // the push service reports the token gone.
    if (isNativePlatform()) {
      await Promise.race([
        disablePushOnThisDevice(),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]).catch(() => {});
    }
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        const { error: localError } = await supabase.auth.signOut({ scope: "local" });
        resultError = localError ?? null;
      }
    } catch (err) {
      resultError = err instanceof Error ? err : new Error("Sign out failed");
    } finally {
      // Guarantee the persisted session is gone even when the server rejects
      // logout. The default supabase-js storage key is `sb-<ref>-auth-token`.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        /* noop — storage unavailable */
      }

      // The restored-on-launch query snapshot holds this user's rosters and
      // results; on a shared school device it must not greet the next user.
      clearPersistedQueryCache();

      // Cache Storage is origin-scoped, not user-scoped, and the avatar cache is
      // permanent by design, so without this one user's photographs of children
      // outlive their session on a shared school device. Awaited so it completes
      // before AppLayout's hard redirect tears the page down, but it can never
      // throw and never blocks reaching /login.
      try {
        await purgeAvatarCache();
      } catch {
        /* noop — the cache is a convenience, never a logout blocker */
      }
    }
    return { error: resultError };
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({ user, session, loading, passwordStatus, signIn, signUp, signOut }),
    [user, session, loading, passwordStatus, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
