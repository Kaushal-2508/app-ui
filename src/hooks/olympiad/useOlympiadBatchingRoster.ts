import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BatchClass } from "@/lib/olympiad/batchSeating";

/**
 * All ACTIVE students for the school, grouped into classes for the batch builder.
 * Cursor-paginated (pages of 1000) so big schools don't hit the PostgREST 1000-row
 * cap (CLAUDE.md §23.1). Admin-only, low-concurrency screen.
 */
export function useOlympiadBatchingRoster(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "batching-roster", olySchoolId],
    queryFn: async (): Promise<BatchClass[]> => {
      if (!olySchoolId) return [];
      const PAGE = 1000;
      const rows: {
        id: string;
        grade_level_id: string | null;
        class_label: string;
        roll_number: string;
      }[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("oly_students")
          .select("id, grade_level_id, class_label, roll_number")
          .eq("oly_school_id", olySchoolId)
          .eq("status", "active")
          .order("class_label")
          .order("roll_number")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      const byGrade = new Map<string, BatchClass>();
      for (const r of rows) {
        if (!r.grade_level_id) continue;
        const g =
          byGrade.get(r.grade_level_id) ??
          ({ gradeLevelId: r.grade_level_id, classLabel: r.class_label, studentIds: [] } as BatchClass);
        g.studentIds.push(r.id);
        byGrade.set(r.grade_level_id, g);
      }
      return [...byGrade.values()].sort((a, b) =>
        a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }),
      );
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
