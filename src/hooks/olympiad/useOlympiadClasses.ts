import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OlympiadClass {
  grade_level_id: string;
  grade_name: string;
  grade_number: number;
  subject_count: number;
}

export function useOlympiadClasses() {
  return useQuery({
    queryKey: ["olympiad", "classes"],
    queryFn: async (): Promise<OlympiadClass[]> => {
      const { data: grades, error: gErr } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (gErr) throw gErr;

      const applicable = (grades ?? []).filter((g) => {
        // Class 1-10 + all Class 11 & 12 stream variants (grade_number 11-18).
        const n = Number(g.grade_number);
        return Number.isFinite(n) && n >= 1 && n <= 18;
      });
      if (applicable.length === 0) return [];

      const { data: links, error: lErr } = await supabase
        .from("oly_subject_classes")
        .select("grade_level_id")
        .in("grade_level_id", applicable.map((g) => g.id));
      if (lErr) throw lErr;

      const counts = new Map<string, number>();
      for (const l of links ?? []) counts.set(l.grade_level_id, (counts.get(l.grade_level_id) ?? 0) + 1);

      return applicable
        .map((g) => ({
          grade_level_id: g.id,
          grade_name: g.grade_name,
          grade_number: Number(g.grade_number),
          subject_count: counts.get(g.id) ?? 0,
        }))
        .sort((a, b) => a.grade_number - b.grade_number);
    },
    staleTime: 5 * 60_000,
  });
}
