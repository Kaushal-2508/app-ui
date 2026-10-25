// =============================================================
// displayName — single source of truth for rendering a person's
// name in the UI.
//
// Never returns "Unknown" / "Unknown User" / "Unknown Student".
// Those labels were leaking across the portal whenever profiles
// rows were null, full_name was null, or a PostgREST join
// returned the row in an unexpected shape — making the system
// look broken to teachers and admins. Fallback chain:
//
//   1. full_name (trimmed)              — the canonical name
//   2. email's local part (before @)    — humane handle for
//                                         OAuth / admin-created
//                                         accounts that never set
//                                         a name
//   3. caller-provided fallback         — defaults to em-dash so
//                                         tables stay aligned
//
// Accepts `unknown` so call sites don't need `as any` casts on
// PostgREST joins — typegen sometimes returns `Profile | Profile[]`
// and this helper narrows internally (single-object on arrays).
// =============================================================

type ProfileLike = {
  full_name?: string | null;
  email?: string | null;
  id?: string | null;
};

function isProfileLike(value: unknown): value is ProfileLike {
  return !!value && typeof value === "object";
}

/**
 * Resolve a humane display name for a profile-like object.
 * Returns the `fallback` (default "—") only when full_name and email
 * are both missing — never the literal "Unknown".
 */
export function getDisplayName(profile: unknown, fallback: string = "N/A"): string {
  // PostgREST joins can come through as `T | T[]`; handle both.
  if (Array.isArray(profile)) {
    return getDisplayName(profile[0] ?? null, fallback);
  }
  if (!isProfileLike(profile)) return fallback;

  if (typeof profile.full_name === "string") {
    const trimmed = profile.full_name.trim();
    if (trimmed) return trimmed;
  }
  if (typeof profile.email === "string") {
    const local = profile.email.split("@")[0]?.trim();
    if (local) return local;
  }
  return fallback;
}

/**
 * Email for a profile-like join, or null. Same tolerance as getDisplayName:
 * PostgREST embeds can arrive as `T | T[]`, and when a table has more than one
 * FK to profiles (wing_assignments, class_assignments) the generated type is a
 * SelectQueryError rather than a row. Callers pass `unknown` and narrow here
 * instead of casting to any (CLAUDE.md section 5a).
 */
export function getProfileEmail(profile: unknown): string | null {
  if (Array.isArray(profile)) {
    return getProfileEmail(profile[0] ?? null);
  }
  if (!isProfileLike(profile)) return null;
  return typeof profile.email === "string" && profile.email.trim() ? profile.email : null;
}

/**
 * Same as getDisplayName but returns null when the profile resolves
 * to neither a name nor an email handle — useful for callers that
 * want to filter out orphaned rows instead of rendering a placeholder.
 */
export function getDisplayNameOrNull(profile: unknown): string | null {
  const resolved = getDisplayName(profile, "");
  return resolved === "" ? null : resolved;
}
