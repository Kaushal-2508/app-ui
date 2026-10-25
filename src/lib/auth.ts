import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Returns the currently signed-in user from the cached session.
 *
 * For "who am I right now" reads — does NOT hit the auth server. Reads
 * from localStorage via supabase.auth.getSession(). At 10K concurrent
 * users this is the difference between zero server calls and ~5,000+ per
 * hour saturating the auth disk pipe.
 *
 * If you need server-validated user identity (e.g. before a security-
 * critical write), call supabase.auth.getUser(token) directly with an
 * explicit JWT argument instead — that path bypasses the monkey-patch
 * in src/integrations/supabase/client.ts and genuinely hits the server.
 *
 * See CLAUDE.md §23.1 and the project_auth_getuser_monkey_patch memory.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

/**
 * Variant that throws if no user is signed in. Use when the caller has
 * already established the user must be authenticated (e.g. inside a
 * mutation that runs after route-guard auth).
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}