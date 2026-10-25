import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardScope, isScopedDashboard } from "./DashboardScope";

/**
 * Syllabus Coverage data layer for the dashboards. ONE scope-aware hook over the
 * `dash_syllabus_coverage` (admin / institution) and `dash_scoped_syllabus_coverage`
 * (coordinator wing / teacher tt_slots) RPCs — scope is resolved server-side, so the
 * same widget renders for all three roles. `scope` is part of the query key so the two
 * scopes never share a cache entry. See migration 20260623150000.
 *
 * Coverage = distinct chapters marked done (status='done', session_type='teaching') over
 * the total applicable chapters for the subject + class-group. Shared across every teacher
 * of the subject; never sliced per teacher.
 */

export interface SyllabusCoverageRow {
  class_id: string;
  class_group_id: string | null;
  class_label: string;
  subject_id: string;
  subject_name: string;
  covered: number;
  total: number;
  /** null when no syllabus is set up for the subject (total = 0). */
  pct: number | null;
}

export interface SyllabusCoverageSummary {
  combos: number;
  covered: number;
  total: number;
  pct: number | null;
  fully_covered: number;
  not_started: number;
}

export interface SyllabusCoverageResult {
  scope: string;
  academic_year: string | null;
  generated_on: string;
  summary: SyllabusCoverageSummary;
  rows: SyllabusCoverageRow[];
}

export interface SyllabusCoverageFilters {
  classGroupId?: string | null;
  classId?: string | null;
  subjectId?: string | null;
  teacherId?: string | null;
}

const EMPTY: SyllabusCoverageResult = {
  scope: "institution",
  academic_year: null,
  generated_on: "",
  summary: { combos: 0, covered: 0, total: 0, pct: null, fully_covered: 0, not_started: 0 },
  rows: [],
};

export function useSyllabusCoverage(filters: SyllabusCoverageFilters = {}) {
  const scope = useDashboardScope();
  const { classGroupId = null, classId = null, subjectId = null, teacherId = null } = filters;

  return useQuery({
    queryKey: ["dash", scope, "syllabusCoverage", classGroupId, classId, subjectId, teacherId],
    staleTime: 60_000,
    queryFn: async (): Promise<SyllabusCoverageResult> => {
      const args = {
        p_class_group_id: classGroupId ?? undefined,
        p_class_id: classId ?? undefined,
        p_subject_id: subjectId ?? undefined,
        p_teacher_id: teacherId ?? undefined,
      };
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_syllabus_coverage", args)
          : await supabase.rpc("dash_syllabus_coverage", args);
      if (error) throw error;
      return (data as unknown as SyllabusCoverageResult) ?? EMPTY;
    },
  });
}
