import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** classId → (roll number → name of the student already holding it). */
export type RollNumbersByClass = Map<string, Map<string, string>>;

interface ClassAssignmentRow {
  class_id: string;
  profiles:
    | { full_name: string; roll_number: string | null }
    | { full_name: string; roll_number: string | null }[]
    | null;
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const PAGE_SIZE = 500;
// Ceiling so a mis-click on a huge class can never spin forever. 5,000 rows is
// ~100 full sections — far past what anyone moves in one sitting.
const MAX_ROWS = 5_000;

/**
 * Roll numbers already in use inside the given sections, for the "roll 12 is
 * taken in 6 - B" warning on UpdateClassSectionSheet.
 *
 * Called with only the destination sections a user has actually picked (usually
 * one or two), never the whole institution.
 */
export function useSectionRollNumbers(classIds: string[]) {
  const ids = [...new Set(classIds)].sort();

  return useQuery({
    queryKey: ["section-roll-numbers", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<RollNumbersByClass> => {
      const byClass: RollNumbersByClass = new Map();

      // PostgREST silently truncates at 1000 rows, so page explicitly rather
      // than trusting the `.in()` filter to bound the result.
      for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("class_assignments")
          .select(
            "class_id, profiles!class_assignments_user_id_fkey(full_name, roll_number)"
          )
          .in("class_id", ids)
          .eq("role", "student")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const rows = (data ?? []) as ClassAssignmentRow[];
        for (const row of rows) {
          const p = pickOne(row.profiles);
          const roll = p?.roll_number?.trim();
          if (!p || !roll) continue;
          const map = byClass.get(row.class_id) ?? new Map<string, string>();
          if (!map.has(roll)) map.set(roll, p.full_name);
          byClass.set(row.class_id, map);
        }

        if (rows.length < PAGE_SIZE) break;
      }

      return byClass;
    },
  });
}
