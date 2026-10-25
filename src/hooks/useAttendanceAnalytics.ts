import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAttendanceAnalytics(
  institutionId: string | null,
  classId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  return useQuery({
    queryKey: ["attendance-analytics", institutionId, classId, startDate, endDate],
    queryFn: async () => {
      if (!institutionId) return null;

      let query = supabase
        .from("attendance_records")
        .select("date, status")
        .eq("institution_id", institutionId);

      if (classId) query = query.eq("class_id", classId);
      if (startDate) query = query.gte("date", startDate);
      if (endDate) query = query.lte("date", endDate);

      const { data, error } = await query;
      if (error) throw error;

      const total = data.length;
      const statusCounts: Record<string, number> = {};
      const dailyCounts: Record<string, Record<string, number>> = {};

      data.forEach((r) => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
        if (!dailyCounts[r.date]) dailyCounts[r.date] = {};
        dailyCounts[r.date][r.status] = (dailyCounts[r.date][r.status] || 0) + 1;
      });

      const presentCount = statusCounts["present"] || 0;
      // Every marked student is in the denominator, students on leave included.
      // Leave is simply not counted as present, the same rule the dash_* RPCs
      // follow. This number reaches the CBSE report PDF via useCommandCenter.
      const attendanceRate = total > 0 ? (presentCount / total) * 100 : 0;

      const dailyData = Object.entries(dailyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({
          date,
          present: counts["present"] || 0,
          absent: counts["absent"] || 0,
          leave: counts["leave"] || 0,
          sick: counts["sick"] || 0,
          casual: counts["casual"] || 0,
        }));

      return { total, statusCounts, attendanceRate, dailyData };
    },
    enabled: !!institutionId,
  });
}
