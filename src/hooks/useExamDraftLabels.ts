import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";

/**
 * Human labels for the class and subject ids held in an exam draft, for the
 * paper header on the Review step ("Class 7 - A · Mathematics").
 *
 * The draft only stores ids. Both lookups are bounded to exactly the ids
 * selected (an exam targets a handful of sections at most), so `.in()` plus
 * `.limit(ids.length)` is the whole result set, not a page of it.
 */
export function useExamDraftLabels(classIds: string[], subjectIds: string[]) {
  const classQuery = useQuery({
    queryKey: ["exam-draft-class-labels", [...classIds].sort()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .in("id", classIds)
        .limit(classIds.length);
      if (error) throw error;
      return data ?? [];
    },
    enabled: classIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const subjectQuery = useQuery({
    queryKey: ["exam-draft-subject-labels", [...subjectIds].sort()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name")
        .in("id", subjectIds)
        .limit(subjectIds.length);
      if (error) throw error;
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const className = (classQuery.data ?? [])
    .map((c) => formatClassName(c.name, c.section))
    .join(", ");
  const subjectName = (subjectQuery.data ?? []).map((s) => s.name).join(", ");

  return {
    className: className || null,
    subjectName: subjectName || null,
    isLoading: classQuery.isLoading || subjectQuery.isLoading,
    // A failed lookup only costs the header its labels; the paper itself is
    // unaffected, so callers may treat this as informational.
    error: classQuery.error ?? subjectQuery.error ?? null,
  };
}
