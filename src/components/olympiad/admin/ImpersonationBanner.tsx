import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { purgeAvatarCache } from "@/lib/avatarStore";

/**
 * Detects super-admin → school-admin impersonation sessions and renders a
 * sticky amber banner with an exit affordance.
 *
 * Detection contract: the magic link returned by `oly-impersonate-school-admin`
 * has `?impersonating=1` appended. On first load we capture the flag into
 * localStorage and strip it from the URL so a subsequent reload still shows
 * the banner. "Exit impersonation" signs out and routes back to /login.
 */
export function ImpersonationBanner() {
  const navigate = useNavigate();
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromMagicLink = url.searchParams.get("impersonating") === "1";
    if (fromMagicLink) {
      localStorage.setItem("oly_impersonating", "1");
      url.searchParams.delete("impersonating");
      window.history.replaceState({}, "", url.toString());
    }
    setIsImpersonating(localStorage.getItem("oly_impersonating") === "1");

    // Clear the stale flag on sign-out so a future unrelated login in the same browser
    // doesn't see a stuck banner. Supabase fires SIGNED_OUT on session expiry too,
    // which is exactly when the magic-link session dies.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        localStorage.removeItem("oly_impersonating");
        setIsImpersonating(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const exit = async () => {
    localStorage.removeItem("oly_impersonating");
    // A rejecting global signOut() would otherwise strand the user mid-impersonation;
    // force-clear the local session and always navigate.
    try {
      const { error } = await supabase.auth.signOut();
      if (error) await supabase.auth.signOut({ scope: "local" });
    } catch {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        /* noop */
      }
    } finally {
      // Same reason as the sign-out purge in useAuth: this is a user-boundary
      // crossing on one device, so the impersonated user's cached photos must
      // not survive into the next session.
      try {
        await purgeAvatarCache();
      } catch {
        /* noop - never block the exit */
      }
      navigate("/login");
    }
  };

  if (!isImpersonating) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span>
          <strong>Impersonating</strong>: you&apos;re signed in as a school admin via super-admin override
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={exit}>
        <LogOut className="h-4 w-4 mr-1" />
        Exit impersonation
      </Button>
    </div>
  );
}
