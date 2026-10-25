import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DashboardStats = {
  totalEnrolled: number;
  byClass: Array<{ grade_level_id: string; grade_name: string; count: number }>;
  onlineCount: number;
  cashCount: number;
  onlineRupees: number;
  cashRupees: number;
  totalRupees: number;
};

export function useOlympiadSchoolDashboard(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "dashboard", olySchoolId],
    queryFn: async (): Promise<DashboardStats> => {
      if (!olySchoolId) {
        return { totalEnrolled: 0, byClass: [], onlineCount: 0, cashCount: 0, onlineRupees: 0, cashRupees: 0, totalRupees: 0 };
      }
      const { data: students, error: sErr } = await supabase
        .from("oly_students")
        .select("id, grade_level_id, enrollment_channel")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "active");
      if (sErr) throw sErr;

      const totalEnrolled = (students ?? []).length;
      const onlineCount = (students ?? []).filter((s) => s.enrollment_channel === "parent_online").length;
      const cashCount = (students ?? []).filter((s) => s.enrollment_channel === "teacher_cash").length;

      // By class
      const byClassMap: Record<string, number> = {};
      for (const s of students ?? []) {
        if (!s.grade_level_id) continue;
        byClassMap[s.grade_level_id] = (byClassMap[s.grade_level_id] ?? 0) + 1;
      }
      const gradeIds = Object.keys(byClassMap);
      const { data: grades } = gradeIds.length > 0
        ? await supabase.from("grade_levels").select("id, grade_name, display_order").in("id", gradeIds)
        : { data: [] };
      const byClass = (grades ?? [])
        .map((g) => ({
          grade_level_id: g.id,
          grade_name: g.grade_name,
          count: byClassMap[g.id] ?? 0,
        }))
        .sort((a, b) => a.grade_name.localeCompare(b.grade_name));

      // Revenue — split by authoritative enrollment_channel on the student row
      const { data: pendings } = await supabase
        .from("oly_enrollment_pending")
        .select("total_rupees, promoted_student_id, oly_students!promoted_student_id(enrollment_channel)")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "paid");

      let onlineRupees = 0;
      let cashRupees = 0;
      for (const p of pendings ?? []) {
        const student = Array.isArray(p.oly_students) ? p.oly_students[0] : p.oly_students;
        const channel = (student as { enrollment_channel?: string } | null)?.enrollment_channel;
        const amount = p.total_rupees ?? 0;
        if (channel === "teacher_cash") cashRupees += amount;
        else onlineRupees += amount;
      }

      return {
        totalEnrolled, byClass, onlineCount, cashCount,
        onlineRupees, cashRupees, totalRupees: onlineRupees + cashRupees,
      };
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
