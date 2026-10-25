import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LessonPlanExportData } from "@/lib/lessonPlanExport";

/**
 * Hooks over the server-scoped lesson-plan export RPCs (migration
 * 20260623130000). Scope (admin -> institution, coordinator -> wings) is
 * resolved entirely server-side; these just shape params + parse the jsonb.
 */

export interface ExportFilterOption {
  id: string;
  name: string;
}

export interface ExportSectionOption {
  id: string;
  class: string;
  section: string | null;
  class_group_id: string;
}

/** A teacher x class-group x section x subject tuple that actually exists in
 *  tt_slots within scope — drives the dialog's cascading (faceted) dropdowns. */
export interface ExportCombo {
  class_group_id: string;
  section_id: string;
  teacher_id: string;
  subject_id: string;
}

export interface LessonPlanExportFilters {
  academic_year: string | null;
  class_groups: ExportFilterOption[];
  sections: ExportSectionOption[];
  teachers: ExportFilterOption[];
  subjects: ExportFilterOption[];
  combos: ExportCombo[];
}

/** Scope-correct dropdown options for the export dialog (in-scope classes/teachers/subjects only). */
export function useLessonPlanExportFilters(enabled: boolean) {
  return useQuery({
    queryKey: ["lesson-plan-export-filters"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<LessonPlanExportFilters> => {
      const { data, error } = await supabase.rpc("tt_lesson_plan_export_filters");
      if (error) throw error;
      return (
        (data as unknown as LessonPlanExportFilters) ?? {
          academic_year: null,
          class_groups: [],
          sections: [],
          teachers: [],
          subjects: [],
          combos: [],
        }
      );
    },
  });
}

export type ExportPeriod = "week" | "month" | "year";

export interface LessonPlanExportParams {
  period: ExportPeriod;
  classGroupId?: string | null;
  classId?: string | null;
  teacherId?: string | null;
  subjectId?: string | null;
}

/** On-demand fetch of the export payload (called from the download handler). */
export async function fetchLessonPlanExport(
  p: LessonPlanExportParams,
): Promise<LessonPlanExportData> {
  const { data, error } = await supabase.rpc("tt_lesson_plan_export", {
    p_period: p.period,
    p_class_group_id: p.classGroupId ?? undefined,
    p_class_id: p.classId ?? undefined,
    p_teacher_id: p.teacherId ?? undefined,
    p_subject_id: p.subjectId ?? undefined,
  });
  if (error) throw error;
  return data as unknown as LessonPlanExportData;
}
