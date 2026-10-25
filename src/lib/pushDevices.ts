import { supabase } from "@/integrations/supabase/client";
import { nativePlatform, registerForPush, unregisterFromPush } from "@/lib/native";

/**
 * Ties the phone's push token to the signed-in user, so the server can
 * address this device. Web Push on the website keeps its own table
 * (`push_subscriptions`); this is the native app's counterpart.
 *
 * `public.push_devices` is LIVE (migration 20260918120000): own-row RLS on all
 * four commands, `token` UNIQUE, `anon` revoked from both the table and the
 * registration function. Still owed: the `send-push` edge function, which needs
 * the FCM service-account secret.
 *
 * Registration goes through the `register_push_device` RPC rather than a client
 * upsert, for two reasons. `user_id` is stamped from `auth.uid()` server-side,
 * so a client cannot register a token against another account. And on a shared
 * phone where user B signs in after user A the token is unchanged, so an upsert
 * would have to UPDATE a row still owned by A; own-row RLS correctly refuses
 * that, which would leave B unregistered AND A's row live, so A's notifications
 * would keep arriving on B's phone. The definer function reassigns the row.
 *
 * The table itself is not in the generated types (it is new), hence the narrow
 * structural client type for the read/delete path.
 */

const TOKEN_KEY = "salci-push-token";

type PgError = { message: string; code?: string };

type PushDevicesClient = {
  from(table: "push_devices"): {
    select(columns: "token"): {
      eq(column: "token", value: string): PromiseLike<{
        data: { token: string }[] | null;
        error: PgError | null;
      }>;
    };
    delete(): { eq(column: "token", value: string): PromiseLike<{ error: PgError | null }> };
  };
};

const pushDevices = () => (supabase as unknown as PushDevicesClient).from("push_devices");

/** The token this device registered under, remembered so sign-out can drop the row. */
export function savedPushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function rememberToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: sign-out then leaves the row for the server's UNREGISTERED sweep */
  }
}

export type EnablePushResult =
  | { status: "enabled" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "failed"; reason: string };

/**
 * Prompt (if needed), fetch the device token and register it for the SIGNED-IN
 * user, whom the server identifies itself. Idempotent: the token is the
 * conflict key, so re-running after a token refresh, or after a different user
 * signs in on the same phone, still leaves exactly one row.
 */
export async function enablePushOnThisDevice(): Promise<EnablePushResult> {
  const registration = await registerForPush();
  if (registration.permission === "unsupported") return { status: "unsupported" };
  if (registration.permission === "denied") return { status: "denied" };
  if (!registration.token) {
    return { status: "failed", reason: registration.error ?? "No device token was issued." };
  }
  const platform = nativePlatform();
  if (!platform) return { status: "unsupported" };

  const { error } = await supabase.rpc("register_push_device", {
    _platform: platform,
    _token: registration.token,
  });
  if (error) return { status: "failed", reason: error.message };

  rememberToken(registration.token);
  return { status: "enabled" };
}

/**
 * Forget this device: delete its row while the session can still authorise
 * the DELETE, then invalidate the token with the push service. Never throws,
 * so it is safe at the top of sign-out.
 */
export async function disablePushOnThisDevice(): Promise<void> {
  const token = savedPushToken();
  if (token) {
    try {
      const { error } = await pushDevices().delete().eq("token", token);
      // A DELETE blocked by RLS is indistinguishable from success: no error,
      // no rows (§6). Here that would leave a live token aimed at a phone
      // whose user has signed out, so the row being GONE is the only success
      // signal worth trusting. Best effort either way: sign-out must not be
      // blocked, and the send path drops tokens FCM reports as unregistered.
      if (!error) {
        const { data } = await pushDevices().select("token").eq("token", token);
        if (data && data.length > 0) {
          console.warn("[push] device row survived its own delete; a stale token may remain");
        }
      }
    } catch {
      /* the server's send path drops tokens the push service reports as gone */
    }
    rememberToken(null);
  }
  await unregisterFromPush();
}
