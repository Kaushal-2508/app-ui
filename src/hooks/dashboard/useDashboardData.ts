import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { SEVERITY_WEIGHTS } from "@/lib/dashboardConstants";
import { useUserRole } from "@/hooks/useUserRole";
import { useDashboardScope, isScopedDashboard } from "./DashboardScope";
import type {
  KpiSummary,
  AttendanceTrend,
  SubjectPerformance,
  StudentDistribution,
  ExamTrendItem,
  SubjectHeatmap,
  ClassesTableResult,
  StudentsAttentionResult,
  TeachersTableResult,
  RecentExamsResult,
  Flag,
} from "./types";

// Filter payloads are forwarded verbatim to the RPC's `p_filters` jsonb arg.
export type DashboardFilters = Record<string, Json>;

// Every hook holds `staleTime: 60_000` per CLAUDE.md §23 (no default-0 refetch
// storms at scale). Aggregation already happens server-side in the RPC, so the
// client just casts the `Json` payload through the typed interface after the
// error guard. Errors bubble out of `queryFn` for the panel-level WidgetCard /
// DashboardTable retry surfaces to translate via `toastError`.
//
// Scope-awareness (§ coordinator/teacher dashboard): each hook reads the ambient
// `DashboardScope`. The DEFAULT context value is `"institution"`, so the admin
// Command Center (which wraps nothing) is unchanged. When the surrounding page
// supplies `scope="scoped"`, the hook calls the parallel `dash_scoped_*` RPC,
// which resolves the caller's wing / taught classes server-side (same args minus
// the institution param). `scope` is part of every `queryKey` so the two scopes
// never share a cache entry.

export function useDashboardKpis() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "kpi"],
    staleTime: 60_000,
    queryFn: async (): Promise<KpiSummary> => {
      // Teachers get the subject-aware variant: dash_scoped_kpi_summary averages
      // every subject of every class they touch, which returned the identical
      // 46.8% to two teachers who share a class but teach different subjects.
      const { data, error } =
        scope === "teacher"
          ? await supabase.rpc("dash_teacher_kpi_summary")
          : isScopedDashboard(scope)
            ? await supabase.rpc("dash_scoped_kpi_summary")
            : await supabase.rpc("dash_kpi_summary", {});
      if (error) throw error;
      return data as unknown as KpiSummary;
    },
  });
}

export function useAttendanceTrend(days: number, classId?: string | null) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "attTrend", days, classId ?? null],
    staleTime: 60_000,
    queryFn: async (): Promise<AttendanceTrend> => {
      // Teacher variant adds an optional class filter; the shared RPC takes only
      // p_days, so a multi-class teacher could only see classes pooled.
      // Attendance stays CLASS-level by design — it is not recorded per subject.
      const { data, error } =
        scope === "teacher"
          ? await supabase.rpc("dash_teacher_attendance_trend", {
              p_days: days,
              p_class_id: classId ?? undefined,
            })
          : isScopedDashboard(scope)
            ? await supabase.rpc("dash_scoped_attendance_trend", { p_days: days })
            // The institution RPC now takes an optional class too, so an admin
            // can see which class is dragging the school line down.
            : await supabase.rpc("dash_attendance_trend", {
                p_days: days,
                p_class_id: classId ?? undefined,
              });
      if (error) throw error;
      return data as unknown as AttendanceTrend;
    },
  });
}

export function useSubjectPerformance(classId: string | null | undefined) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "subjectPerf", classId],
    staleTime: 60_000,
    enabled: !!classId,
    queryFn: async (): Promise<SubjectPerformance> => {
      // Teacher variant returns ONLY the caller's own subjects for the class.
      // The shared RPC joins exam_subjects to label rows but never to filter
      // them, which is why a one-subject teacher was shown nine subjects.
      const { data, error } =
        scope === "teacher"
          ? await supabase.rpc("dash_teacher_subject_performance", {
              p_class_id: classId as string,
            })
          : isScopedDashboard(scope)
            ? await supabase.rpc("dash_scoped_subject_performance", {
                p_class_id: classId as string,
              })
            : await supabase.rpc("dash_subject_performance", {
                p_class_id: classId as string,
              });
      if (error) throw error;
      return data as unknown as SubjectPerformance;
    },
  });
}

export function useStudentDistribution(classId?: string | null) {
  const scope = useDashboardScope();
  return useQuery({
    // classId is part of the key so switching class refetches rather than
    // showing the previous class's donut.
    queryKey: ["dash", scope, "studentDist", classId ?? null],
    staleTime: 60_000,
    queryFn: async (): Promise<StudentDistribution> => {
      const { data, error } =
          // Teacher variant adds an optional class filter; the shared RPC takes
          // no arguments, so a teacher could only ever see all classes pooled.
          scope === "teacher"
            ? await supabase.rpc("dash_teacher_student_distribution", {
                p_class_id: classId ?? undefined,
              })
            : isScopedDashboard(scope)
              // No class variant for coordinators, which is why the widget
              // hides its picker at that scope.
              ? await supabase.rpc("dash_scoped_student_distribution")
              : await supabase.rpc("dash_student_distribution", {
                  p_class_id: classId ?? undefined,
                });
      if (error) throw error;
      return data as unknown as StudentDistribution;
    },
  });
}

export function useExamTrend(
  limit = 8,
  classId?: string | null,
  subjectId?: string | null,
  /** A TrendRange token ('tm' | '1m' | '3m' | '6m' | 'ay'). Institution scope
   *  only: neither the teacher nor the coordinator RPC takes a window. */
  range?: string | null,
) {
  const scope = useDashboardScope();
  return useQuery({
    // Filters are part of the key so changing any of them refetches rather than
    // showing the previous selection's bars.
    queryKey: [
      "dash", scope, "examTrend", limit, classId ?? null, subjectId ?? null, range ?? null,
    ],
    staleTime: 60_000,
    queryFn: async (): Promise<ExamTrendItem[]> => {
      // dash_scoped_exam_trend resolves a teacher to class_id only, so it plotted
      // colleagues' Social Studies / Art / PE papers on an English teacher's
      // chart. The teacher variant also requires the exam's SUBJECT to be theirs,
      // and accepts the optional class/subject narrowing the picker drives.
      const { data, error } =
        scope === "teacher"
          ? await supabase.rpc("dash_teacher_exam_trend", {
              p_limit: limit,
              p_class_id: classId ?? undefined,
              p_subject_id: subjectId ?? undefined,
            })
          : isScopedDashboard(scope)
            // The coordinator RPC still takes only p_limit, which is why the
            // widget does not offer a class picker at that scope.
            ? await supabase.rpc("dash_scoped_exam_trend", { p_limit: limit })
            : await supabase.rpc("dash_exam_trend", {
                p_limit: limit,
                p_class_id: classId ?? undefined,
                p_range: range ?? undefined,
              });
      if (error) throw error;
      return data as unknown as ExamTrendItem[];
    },
  });
}

export function useSubjectHeatmap() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "subjectHeatmap"],
    staleTime: 60_000,
    queryFn: async (): Promise<SubjectHeatmap> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_subject_heatmap")
          : await supabase.rpc("dash_subject_heatmap", {});
      if (error) throw error;
      return data as unknown as SubjectHeatmap;
    },
  });
}

export function useClassesTable(filters: DashboardFilters, limit: number, offset: number) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "classesTable", filters, limit, offset],
    staleTime: 60_000,
    queryFn: async (): Promise<ClassesTableResult> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_classes_table", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            })
          : await supabase.rpc("dash_classes_table", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            });
      if (error) throw error;
      return data as unknown as ClassesTableResult;
    },
  });
}

export function useStudentsAttention(filters: DashboardFilters, limit: number, offset: number) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "studentsAttention", filters, limit, offset],
    staleTime: 60_000,
    queryFn: async (): Promise<StudentsAttentionResult> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_students_attention", {
              p_weights: SEVERITY_WEIGHTS,
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            })
          : await supabase.rpc("dash_students_attention", {
              p_weights: SEVERITY_WEIGHTS,
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            });
      if (error) throw error;
      return data as unknown as StudentsAttentionResult;
    },
  });
}

export function useTeachersTable(filters: DashboardFilters, limit: number, offset: number) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teachersTable", filters, limit, offset],
    staleTime: 60_000,
    queryFn: async (): Promise<TeachersTableResult> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_teachers_table", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            })
          : await supabase.rpc("dash_teachers_table", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            });
      if (error) throw error;
      return data as unknown as TeachersTableResult;
    },
  });
}

export function useRecentExams(filters: DashboardFilters, limit: number, offset: number) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "recentExams", filters, limit, offset],
    staleTime: 60_000,
    queryFn: async (): Promise<RecentExamsResult> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_recent_exams", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            })
          : await supabase.rpc("dash_recent_exams", {
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
            });
      if (error) throw error;
      return data as unknown as RecentExamsResult;
    },
  });
}

export function useDashboardFlags() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "flags"],
    staleTime: 60_000,
    queryFn: async (): Promise<Flag[]> => {
      const { data, error } =
        isScopedDashboard(scope)
          ? await supabase.rpc("dash_scoped_get_flags")
          : await supabase.rpc("dash_get_flags", {});
      if (error) throw error;
      return data as unknown as Flag[];
    },
  });
}

/** A class option for the dashboard filter dropdowns. */
export interface DashboardClassOption {
  id: string;
  name: string;
  section: string | null;
}

/**
 * Scope-aware class list for filter dropdowns and the subject-performance picker.
 * - `"scoped"` → `dash_scoped_class_list()` (the caller's wing / taught classes,
 *   resolved server-side).
 * - `"institution"` → the institution's active classes (mirrors how the
 *   command-center components fetched their class list inline before scoping).
 */
export function useDashboardClassList() {
  const scope = useDashboardScope();
  const institutionId = useUserRole().data?.institutionId ?? null;

  return useQuery({
    queryKey: ["dash", scope, "classList", institutionId],
    staleTime: 60_000,
    enabled: isScopedDashboard(scope) || !!institutionId,
    queryFn: async (): Promise<DashboardClassOption[]> => {
      if (isScopedDashboard(scope)) {
        const { data, error } = await supabase.rpc("dash_scoped_class_list");
        if (error) throw error;
        return (data as unknown as DashboardClassOption[] | null) ?? [];
      }

      // Bounded: PostgREST silently truncates at 1000 rows, and four cards now
      // build their pickers from this list, so a school past that ceiling would
      // quietly lose classes from every one of them rather than error.
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId as string)
        .eq("is_active", true)
        .order("name")
        .range(0, 999);
      if (error) throw error;
      return (data ?? []) as DashboardClassOption[];
    },
  });
}
