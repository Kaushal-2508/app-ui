import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { useAttendanceAnalytics } from "@/hooks/useAttendanceAnalytics";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { CheckCircle2, XCircle, Users, Download } from "lucide-react";
import { format, subDays } from "date-fns";
import * as XLSX from "xlsx";
import { saveBlob } from "@/lib/native";
import { toast } from "sonner";
import { getDisplayName } from "@/lib/displayName";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

export function AttendanceAnalytics() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [range, setRange] = useState("30");

  const endDate = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), parseInt(range)), "yyyy-MM-dd");

  const { data: classes } = useQuery({
    queryKey: ["classes-list", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data } = await supabase.from("classes").select("id, name, section").eq("institution_id", institutionId).eq("is_active", true).order("name");
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });

  const { data: analytics, isLoading } = useAttendanceAnalytics(
    institutionId,
    classFilter === "all" ? null : classFilter,
    startDate,
    endDate
  );

  const handleExport = async () => {
    if (!institutionId) return;
    try {
      let q = supabase
        .from("attendance_records")
        .select("date, status, method, remarks, student:profiles!attendance_records_student_id_fkey(full_name), class:classes!attendance_records_class_id_fkey(name, section)")
        .eq("institution_id", institutionId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });

      if (classFilter !== "all") q = q.eq("class_id", classFilter);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data || []).map((r: any) => ({
        Date: r.date,
        Student: getDisplayName(r.student),
        Class: formatClassName(r.class?.name || "", r.class?.section),
        Status: r.status,
        Method: r.method,
        Remarks: r.remarks || "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      saveBlob(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `attendance_${startDate}_to_${endDate}.xlsx`,
      );
      toast.success("Attendance data exported");
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Classes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classes?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!analytics}>
          <Download className="h-4 w-4 mr-2" /> Export Excel
        </Button>
      </div>

      {analytics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <GradientKPICard icon={CheckCircle2} value={`${analytics.attendanceRate.toFixed(1)}%`} label="Attendance Rate" variant="emerald" />
            <GradientKPICard icon={Users} value={analytics.total} label="Total Records" variant="blue" />
            <GradientKPICard icon={XCircle} value={analytics.statusCounts["absent"] || 0} label="Absences" variant="orange" />
          </div>

          {analytics.dailyData.length > 0 && (
            <Card className="rounded-2xl">
              <CardHeader><CardTitle className="text-base">Daily Attendance Trend</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.dailyData.slice(-30)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => format(new Date(v), "dd MMM")} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip labelFormatter={(v) => format(new Date(v as string), "PPP")} />
                      <Legend />
                      <Bar dataKey="present" name="Present" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="absent" name="Absent" fill="#ef4444" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="sick" name="Sick" fill="#a855f7" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(analytics.statusCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border">
                    <span className="capitalize text-sm font-medium">{status}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {isLoading && <Card><CardContent className="py-12 text-center text-muted-foreground">Loading analytics...</CardContent></Card>}
    </div>
  );
}
