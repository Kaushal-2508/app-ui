import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { CalendarOff, Send, Loader2 } from "lucide-react";

export function LeaveRequestForm() {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const { leaveRequests, isLoading, createLeaveRequest } = useLeaveRequests(institutionId, "student");

  const [leaveType, setLeaveType] = useState("personal");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  // Get student's class
  const { data: myClass } = useQuery({
    queryKey: ["my-class-assignment"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("class_assignments")
        .select("class_id, classes!inner(id, name, section)")
        .eq("user_id", user.id)
        .eq("role", "student")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const handleSubmit = () => {
    if (!institutionId || !myClass?.class_id || !startDate || !endDate || !reason.trim()) return;
    createLeaveRequest.mutate({
      institution_id: institutionId,
      class_id: myClass.class_id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
    });
    setStartDate("");
    setEndDate("");
    setReason("");
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
    if (s === "rejected") return "bg-red-500/10 text-red-600 border-red-200";
    return "bg-amber-500/10 text-amber-600 border-amber-200";
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="h-4 w-4" /> Submit Leave Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={leaveType} onValueChange={setLeaveType}>
            <SelectTrigger><SelectValue placeholder="Leave Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sick">Sick Leave</SelectItem>
              <SelectItem value="personal">Personal Leave</SelectItem>
              <SelectItem value="family">Family Emergency</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <Textarea placeholder="Reason for leave..." value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <Button onClick={handleSubmit} disabled={createLeaveRequest.isPending || !startDate || !endDate || !reason.trim()} className="w-full">
            {createLeaveRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Submit Request
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">My Leave Requests</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground">Loading...</div>
          ) : leaveRequests.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No leave requests yet.</div>
          ) : (
            <div className="space-y-3">
              {leaveRequests.map((lr: any) => (
                <div key={lr.id} className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                  <div>
                    <p className="text-sm font-medium capitalize">{lr.leave_type} Leave</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(lr.start_date), "dd MMM")} – {format(new Date(lr.end_date), "dd MMM yyyy")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{lr.reason}</p>
                    {lr.reviewer_notes && <p className="text-xs text-primary mt-1">Note: {lr.reviewer_notes}</p>}
                  </div>
                  <Badge variant="outline" className={statusColor(lr.status)}>{lr.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
