import { useOlympiadMySchool } from "./useOlympiadMySchool";

/**
 * Detects whether the effective institution is an "Olympiad-only" school —
 * i.e. a net-new school onboarded purely for the SALCI Olympiad.
 *
 * These carry `oly_schools.is_existing_salci_school = false`. Existing SALCI
 * schools (`true`) and ordinary institutions with no `oly_schools` row at all
 * (null) are NEVER flagged, so their navigation is left completely untouched.
 *
 * Consumers (sidebar, dashboard landing, ProtectedRoute) use this to collapse
 * the whole experience down to the single Olympiad workspace. The restriction
 * deliberately does NOT apply to super admins — even when a super admin is
 * managing an Olympiad-only institution they keep full navigation.
 *
 * Shares the `useOlympiadMySchool` query cache (one network call, deduped
 * across all three call-sites) and inherits its 60s staleTime — the flag is
 * effectively static for the lifetime of a session.
 */
export function useIsOlympiadOnlyInstitution() {
  const { data, isLoading } = useOlympiadMySchool();
  const isOlympiadOnly = !!data && data.is_existing_salci_school === false;
  return { isOlympiadOnly, isLoading, school: data ?? null };
}

/**
 * The single Olympiad workspace a given role should land on when their
 * institution is Olympiad-only. Students and teachers have their own Olympiad
 * surfaces; everyone else (school_admin, coordinator) manages from the
 * school-admin Olympiad dashboard.
 */
export function olympiadHomePath(
  role: { isStudent?: boolean; isTeacher?: boolean } | null | undefined,
): string {
  if (role?.isStudent) return "/student/olympiad";
  if (role?.isTeacher) return "/teacher/olympiad";
  return "/school/olympiad";
}
