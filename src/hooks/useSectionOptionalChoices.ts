import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// =============================================================
// Section-wide optional choices for the "Update Optional Subjects"
// picker: which subject each student of ONE section currently takes
// in each optional group of their class.
//
// Reads student_optional_enrollments directly (RLS: soe_select_manage
// -> can_view_student_optional_choices per row) instead of calling
// get_student_optional_group_assignment once per student, which would
// be N round-trips for a 60-student section. Resolution mirrors that
// RPC: an active row whose subject sits in a group is that group's
// choice, and if a student somehow holds two active rows in the same
// group the most recently updated one wins.
// =============================================================

export const SECTION_OPTIONAL_CHOICES_KEY = "section-optional-choices";

export interface SectionOptionalChoiceGroup {
  id: string;
  subject_ids: string[];
}

/** studentId -> groupId -> chosen subjectId. Missing keys mean "none". */
export type SectionOptionalChoices = Record<string, Record<string, string>>;

interface EnrollmentRow {
  student_id: string;
  subject_id: string;
  updated_at: string;
}

// PostgREST filters travel in the URL. 100 UUIDs is ~3.7 KB per `in()`,
// comfortably under every proxy limit in the chain; a bigger section
// simply makes a second request.
const STUDENT_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function useSectionOptionalChoices(args: {
  classId: string | null;
  studentIds: string[] | null;
  groups: SectionOptionalChoiceGroup[] | null;
}) {
  const { classId, studentIds, groups } = args;

  // Sorted fingerprints keep the key stable across re-renders that merely
  // re-create the arrays, and correct when the roster or groups change.
  const studentKey = studentIds ? [...studentIds].sort().join(",") : "";
  const subjectIds = groups
    ? [...new Set(groups.flatMap((g) => g.subject_ids))].sort()
    : [];
  const subjectKey = subjectIds.join(",");

  return useQuery({
    queryKey: [SECTION_OPTIONAL_CHOICES_KEY, classId, studentKey, subjectKey],
    enabled:
      !!classId && !!studentIds && studentIds.length > 0 && !!groups && subjectIds.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionOptionalChoices> => {
      const ids = studentIds ?? [];
      const groupBySubject = new Map<string, string>();
      for (const g of groups ?? []) {
        for (const s of g.subject_ids) groupBySubject.set(s, g.id);
      }

      const pages = await Promise.all(
        chunk(ids, STUDENT_CHUNK).map(async (part) => {
          const { data, error } = await supabase
            .from("student_optional_enrollments")
            .select("student_id, subject_id, updated_at")
            .eq("is_active", true)
            .in("student_id", part)
            .in("subject_id", subjectIds)
            // Explicit bound: at most one active row per (student, group), so
            // 100 students x 20 groups can never reach it. If it ever does the
            // section is mis-modelled and should fail loudly in review.
            .range(0, 1999);
          if (error) throw error;
          return (data ?? []) as EnrollmentRow[];
        })
      );

      const out: SectionOptionalChoices = {};
      const seenAt: Record<string, Record<string, string>> = {};
      for (const row of pages.flat()) {
        const groupId = groupBySubject.get(row.subject_id);
        if (!groupId) continue;
        const prevAt = seenAt[row.student_id]?.[groupId];
        if (prevAt && prevAt >= row.updated_at) continue;
        (out[row.student_id] ??= {})[groupId] = row.subject_id;
        (seenAt[row.student_id] ??= {})[groupId] = row.updated_at;
      }
      return out;
    },
  });
}
