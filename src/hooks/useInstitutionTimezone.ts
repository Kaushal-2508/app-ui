import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

/** The platform default (`institutions.timezone` defaults to it too, CLAUDE.md §24). */
export const DEFAULT_INSTITUTION_TIMEZONE = "Asia/Kolkata";

const validZones = new Map<string, boolean>();

function isValidZone(tz: string): boolean {
  const known = validZones.get(tz);
  if (known !== undefined) return known;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    ok = true;
  } catch {
    ok = false; // RangeError: not an IANA zone this runtime knows
  }
  validZones.set(tz, ok);
  return ok;
}

/**
 * The effective institution's IANA timezone (`institutions.timezone`), for anything
 * that shows or compares school-local wall-clock time on the client: the dashboard
 * banner's time of day and its tower clock today.
 *
 * Always returns a usable zone. It is "Asia/Kolkata" while loading, on a query error
 * with no zone fetched before, when there is no institution (a super admin who is not
 * managing one), or when the stored value is not a valid IANA zone. A failed REFETCH
 * keeps the zone already known (TanStack keeps the last good `data` beside the error),
 * so a non-IST school never flips to the default because one request timed out. The
 * fallback on error is deliberate, not a swallowed failure: the only caller is a
 * decorative banner, which has no error state to show, and every school on the platform
 * is in India today, where the default is also the right answer. A caller that must not
 * guess should read the query itself.
 *
 * One row by primary key, one column, cached for 30 minutes and persisted with the
 * query cache (a plain string), so a return visit does not refetch it.
 */
export function useInstitutionTimezone(): string {
  const { institutionId } = useEffectiveInstitution();

  const { data } = useQuery({
    queryKey: ["institution-timezone", institutionId],
    queryFn: async (): Promise<string | null> => {
      if (!institutionId) return null;
      const { data: row, error: queryError } = await supabase
        .from("institutions")
        .select("timezone")
        .eq("id", institutionId)
        .maybeSingle();
      // Throw so a failure is never cached as "no zone" for 30 minutes; the hook
      // below turns the error into the default zone.
      if (queryError) throw queryError;
      return row?.timezone ?? null;
    },
    enabled: !!institutionId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // No `error` test: an error with no data falls through to the default here anyway.
  if (!data || !isValidZone(data)) return DEFAULT_INSTITUTION_TIMEZONE;
  return data;
}
