import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "./useEffectiveInstitution";
import { useSchoolPerformanceMetrics } from "./useSchoolPerformanceMetrics";
import { usePrincipalOverview } from "./usePrincipalDashboard";
import { useAttendanceAnalytics } from "./useAttendanceAnalytics";
import { useFeeDefaulters } from "./useFeeDefaulters";
import { useFeeAnalytics } from "./useFeeAnalytics";
import { useLeaveRequests } from "./useLeaveRequests";
import { usePendingEvaluations } from "./useEvaluations";
import { useAISuggestedTasks } from "./useAISuggestedTasks";
import { useInstitutionFeatures } from "./useInstitutionFeatures";
import { queryKeys } from "@/lib/queryKeys";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export function useCommandCenter() {
  const { institutionId, institutionName, isLoading: instLoading, roleInfo } = useEffectiveInstitution();

  // Compose existing hooks
  const performance = useSchoolPerformanceMetrics(institutionId);
  const principal = usePrincipalOverview(institutionId);

  const today = new Date().toISOString().split("T")[0];
  const attendance = useAttendanceAnalytics(institutionId, null, today, today);

  const defaulters = useFeeDefaulters(institutionId ?? undefined);
  const feeAnalytics = useFeeAnalytics(institutionId ?? undefined);
  const leave = useLeaveRequests(institutionId, "staff");
  const evaluations = usePendingEvaluations();
  const aiTasks = useAISuggestedTasks();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();

  // --- New queries not covered by existing hooks ---

  // Exam pipeline: count by status
  const examPipeline = useQuery({
    queryKey: queryKeys.commandCenterExamPipeline(institutionId ?? undefined),
    queryFn: async () => {
      if (!institutionId) return { draft: 0, published: 0, completed: 0, total: 0, draftExams: [] as { id: string; title: string; class_name: string }[] };

      const { data, error } = await supabase
        .from("exams")
        .select("id, title, status")
        .eq("institution_id", institutionId);

      if (error) throw error;

      const exams = data || [];
      const draft = exams.filter((e) => e.status === "draft");
      const published = exams.filter((e) => e.status === "published");
      const completed = exams.filter((e) => e.status === "completed");

      return {
        draft: draft.length,
        published: published.length,
        completed: completed.length,
        total: exams.length,
        draftExams: draft.map((e) => ({
          id: e.id,
          title: e.title,
          class_name: "N/A",
        })),
      };
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000,
  });

  // Student positioning: bucket students by average performance
  const studentPositioning = useQuery({
    queryKey: queryKeys.commandCenterStudentPositioning(institutionId ?? undefined),
    queryFn: async () => {
      const empty = {
        needsAttention: { count: 0, percentage: 0, students: [] as { id: string; name: string; class: string; accuracy: number }[] },
        developing: { count: 0, percentage: 0, students: [] as { id: string; name: string; class: string; accuracy: number }[] },
        stable: { count: 0, percentage: 0, students: [] as { id: string; name: string; class: string; accuracy: number }[] },
      };
      if (!institutionId) return empty;

      // 1. Classes for this institution
      const { data: classes, error: clsErr } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true);
      if (clsErr) throw clsErr;

      const classIds = (classes ?? []).map((c) => c.id);
      if (classIds.length === 0) return empty;

      const classMap = new Map(
        (classes ?? []).map((c) => [c.id, formatClassName(c.name, c.section)])
      );

      // 2. Snapshots scoped by class_id (institution-safe)
      const { data: snaps, error: snapErr } = await supabase
        .from("student_performance_snapshots")
        .select("student_id, class_id, accuracy_percent, profiles:student_id(full_name)")
        .in("class_id", classIds);
      if (snapErr) throw snapErr;

      // 3. Aggregate per student
      const studentMap: Record<string, { id: string; name: string; class: string; total: number; count: number }> = {};
      for (const s of snaps ?? []) {
        const id = s.student_id;
        if (!id) continue;
        if (!studentMap[id]) {
          studentMap[id] = {
            id,
            name: getDisplayName(s.profiles),
            class: classMap.get(s.class_id) ?? "N/A",
            total: 0,
            count: 0,
          };
        }
        studentMap[id].total += Number(s.accuracy_percent) || 0;
        studentMap[id].count += 1;
      }

      const students = Object.values(studentMap).map((s) => ({
        id: s.id,
        name: s.name,
        class: s.class,
        accuracy: s.count > 0 ? s.total / s.count : 0,
      }));

      const total = students.length || 1;
      const atRisk = students.filter((s) => s.accuracy < 50);
      const developing = students.filter((s) => s.accuracy >= 50 && s.accuracy <= 65);
      const stable = students.filter((s) => s.accuracy > 65);

      return {
        needsAttention: { count: atRisk.length, percentage: (atRisk.length / total) * 100, students: atRisk },
        developing: { count: developing.length, percentage: (developing.length / total) * 100, students: developing },
        stable: { count: stable.length, percentage: (stable.length / total) * 100, students: stable },
      };
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000,
  });

  // Academic years from classes
  const academicYears = useQuery({
    queryKey: queryKeys.commandCenterAcademicYears(institutionId ?? undefined),
    queryFn: async () => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("classes")
        .select("academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true);

      if (error) throw error;
      const years = [...new Set((data || []).map((c) => c.academic_year).filter(Boolean))];
      return years.sort().reverse();
    },
    enabled: !!institutionId,
  });

  // --- Derived / computed values ---

  const schoolAvg = principal.data?.schoolAvg ?? 0;
  const passRate = performance.data?.passRate ?? 0;
  const improvementRate = performance.data?.improvementRate ?? 0;

  // Today's attendance
  const attendanceToday = attendance.data;
  const todayPresent = attendanceToday?.statusCounts?.["present"] ?? 0;
  const todayTotal = attendanceToday?.total ?? 0;
  const todayPct = attendanceToday?.attendanceRate ?? 0;

  // Fee defaulters derived
  const feeDefaulterCount = defaulters.defaulters.length;
  const feeDefaulterAmount = defaulters.defaulters.reduce(
    (sum: number, d: { amount?: number | string | null; paid_amount?: number | string | null }) =>
      sum + (Number(d.amount) - Number(d.paid_amount || 0)),
    0
  );

  // Fee collection percentage from analytics RPC
  const feeCollectionPct = feeAnalytics.analytics
    ? ((Number(feeAnalytics.analytics.total_collected) || 0) / (Number(feeAnalytics.analytics.total_expected) || 1)) * 100
    : 0;

  // Pending leave requests
  const pendingLeave = leave.leaveRequests.filter((r: { status?: string | null }) => r.status === "pending");

  // Overdue evaluations grouped by teacher (from pending evaluations)
  const pendingEvals = evaluations.data || [];
  const overdueTeacherMap: Record<string, { name: string; count: number }> = {};
  for (const e of pendingEvals) {
    // Group by exam to approximate teacher
    if (!overdueTeacherMap[e.examTitle]) {
      overdueTeacherMap[e.examTitle] = { name: e.examTitle, count: 0 };
    }
    overdueTeacherMap[e.examTitle].count++;
  }
  const overdueEvaluations = Object.values(overdueTeacherMap);

  // AI suggestions pending
  const aiPendingCount = (aiTasks.data || []).length; // hook already filters for pending

  // Compliance score (always shown, derived from data checks)
  const complianceChecks = [
    (attendanceToday?.total ?? 0) > 0,                    // Attendance data exists
    (examPipeline.data?.total ?? 0) > 0,                   // Exam records exist
    pendingEvals.length === 0,                              // All evaluations submitted
    (performance.data?.totalStudentsEvaluated ?? 0) > 0,   // Student records exist
    (feeAnalytics.analytics) != null,                       // Fee data exists
  ];
  const complianceScore = (complianceChecks.filter(Boolean).length / complianceChecks.length) * 100;
  const compliancePending = complianceChecks.filter((c) => !c).length;

  // Highest / lowest performing class. Only classes that actually have
  // evaluated data — heatmapData now includes every active class (those with no
  // snapshots carry avgPercent 0), so an unfiltered sort would report a phantom
  // "0.0% lowest class" for any school with an un-examined class.
  const heatmap = (principal.data?.heatmapData || []).filter((h) => h.studentCount > 0);
  const sortedClasses = [...heatmap].sort((a, b) => b.avgPercent - a.avgPercent);
  const highestClass = sortedClasses[0] || null;
  const lowestClass = sortedClasses[sortedClasses.length - 1] || null;

  // Combined loading / error
  const isLoading = instLoading || featuresLoading ||
    performance.isLoading || principal.isLoading || attendance.isLoading ||
    examPipeline.isLoading || studentPositioning.isLoading;

  const isError = performance.isError || principal.isError || attendance.isError ||
    examPipeline.isError || studentPositioning.isError;

  const refetch = () => {
    performance.refetch();
    principal.refetch();
    attendance.refetch();
    // defaulters auto-fetches via its own hook — nothing to refetch here.
    examPipeline.refetch();
    studentPositioning.refetch();
    evaluations.refetch();
    aiTasks.refetch();
  };

  return {
    institutionId,
    institutionName,
    roleInfo,

    // Performance
    schoolAvg,
    passRate,
    improvementRate,

    // Attendance
    todayPct,
    todayPresent,
    todayTotal,

    // Fee
    feeDefaulterCount,
    feeDefaulterAmount,
    feeCollectionPct,
    defaulters: defaulters.defaulters,

    // Leave
    pendingLeave,
    reviewLeaveRequest: leave.reviewLeaveRequest,

    // Evaluations
    pendingEvals,
    overdueEvaluations,

    // AI
    aiPendingCount,
    aiTasks: aiTasks.data || [],

    // Exam pipeline
    examPipeline: examPipeline.data ?? { draft: 0, published: 0, completed: 0, total: 0, draftExams: [] },

    // Student positioning
    studentPositioning: studentPositioning.data ?? {
      needsAttention: { count: 0, percentage: 0, students: [] },
      developing: { count: 0, percentage: 0, students: [] },
      stable: { count: 0, percentage: 0, students: [] },
    },

    // Compliance
    complianceScore,
    compliancePending,

    // Classes
    highestClass,
    lowestClass,

    // Academic years
    academicYears: academicYears.data ?? [],

    // Feature gating (silently maps spec keys to actual keys)
    isFeatureEnabled,
    hasFinanceFeature: isFeatureEnabled("fee_management"),
    hasHRFeature: isFeatureEnabled("hr_payroll"),
    hasAIFeature: isFeatureEnabled("ai_question_generation") || isFeatureEnabled("ai_grading") || isFeatureEnabled("ai_predictions"),

    // State
    isLoading,
    isError,
    refetch,
  };
}

export type CommandCenterData = ReturnType<typeof useCommandCenter>;
