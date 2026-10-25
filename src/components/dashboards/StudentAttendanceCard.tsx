import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, CheckCircle2, XCircle } from "lucide-react";
import { useStudentAttendance } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  present: "bg-green-500",
  absent: "bg-red-500",
  sick: "bg-purple-500",
  casual: "bg-blue-500",
  holiday: "bg-muted",
};

export function StudentAttendanceCard() {
  const { user } = useAuth();
  const { data: records, isLoading } = useStudentAttendance(user?.id);
  const [viewMonth] = useState(new Date());

  if (isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-8 text-center text-muted-foreground">Loading attendance...</CardContent>
      </Card>
    );
  }

  if (!records || records.length === 0) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-8 text-center text-muted-foreground">
          <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No attendance records yet
        </CardContent>
      </Card>
    );
  }

  // Calculate stats
  const total = records.length;
  const presentCount = records.filter((r) => r.status === "present").length;
  const absentCount = records.filter((r) => r.status === "absent").length;
  const percentage = total > 0 ? (presentCount / total) * 100 : 0;

  // Calendar for current month
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getStatusForDay = (day: Date) => {
    const record = records.find((r) => isSameDay(new Date(r.date), day));
    return record?.status || null;
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarCheck className="h-4 w-4" /> Attendance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Row */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className={`text-3xl font-bold ${percentage >= 75 ? "text-green-600" : percentage >= 50 ? "text-amber-600" : "text-red-600"}`}>
              {percentage.toFixed(0)}%
            </div>
            <p className="text-xs text-muted-foreground">Attendance</p>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 mx-auto text-green-600" />
              <p className="font-bold text-sm">{presentCount}</p>
              <p className="text-[10px] text-muted-foreground">Present</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
              <XCircle className="h-4 w-4 mx-auto text-red-600" />
              <p className="font-bold text-sm">{absentCount}</p>
              <p className="text-[10px] text-muted-foreground">Absent</p>
            </div>
          </div>
        </div>

        {/* Mini Calendar */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">{format(viewMonth, "MMMM yyyy")}</p>
          <div className="grid grid-cols-7 gap-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="text-[10px] text-center text-muted-foreground font-medium">{d}</div>
            ))}
            {/* Offset for first day */}
            {Array.from({ length: monthStart.getDay() }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {daysInMonth.map((day) => {
              const status = getStatusForDay(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`h-5 w-5 mx-auto rounded-full flex items-center justify-center text-[9px] ${
                    status ? `${STATUS_COLORS[status]} text-white` : "bg-muted/30 text-muted-foreground"
                  }`}
                  title={status ? `${format(day, "dd MMM")}: ${status}` : format(day, "dd MMM")}
                >
                  {day.getDate()}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_COLORS).filter(([k]) => k !== "holiday").map(([status, color]) => (
            <div key={status} className="flex items-center gap-1">
              <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
              <span className="text-[10px] capitalize text-muted-foreground">{status}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
