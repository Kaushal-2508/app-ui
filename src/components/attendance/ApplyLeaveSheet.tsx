import { useState } from "react";
import { format } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApplyLeave, LEAVE_TYPES, LEAVE_TYPE_LABEL, type LeaveType } from "@/hooks/useStudentLeave";

// Local calendar date, never UTC: toISOString() is UTC, so before 05:30 IST
// the default date was yesterday.
const TODAY = () => format(new Date(), "yyyy-MM-dd");

export function ApplyLeaveSheet({
  open, onOpenChange, classId, institutionId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classId: string | null;
  institutionId: string | null;
}) {
  const apply = useApplyLeave();
  const [leaveType, setLeaveType] = useState<LeaveType>("personal");
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState(TODAY);
  const [reason, setReason] = useState("");

  const rangeDays =
    (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000;
  const tooLong = rangeDays > 60;
  const canSubmit =
    !!classId && !!institutionId && reason.trim().length > 0 && startDate <= endDate && !tooLong && !apply.isPending;

  const submit = () => {
    if (!canSubmit || !classId || !institutionId) return;
    apply.mutate(
      { class_id: classId, institution_id: institutionId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      { onSuccess: () => { setReason(""); onOpenChange(false); } },
    );
  };

  return (
    <MobileSheet
      open={open} onOpenChange={onOpenChange}
      title="Apply for leave" subtitle="Request time off. Your teacher will review it."
      icon={<CalendarPlus className="h-4 w-4" />}
      primaryAction={{ label: "Submit request", onClick: submit, loading: apply.isPending, disabled: !canSubmit }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form data-dirty={reason.trim().length > 0 ? "true" : undefined} className="space-y-4">
        {!classId && (
          <p className="text-xs text-rose-600">You're not enrolled in a class yet. Ask your admin.</p>
        )}
        {tooLong && (
          <p className="text-xs text-rose-600">Leave range can't exceed 60 days.</p>
        )}
        <div className="space-y-1.5">
          <Label>Leave type</Label>
          <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAVE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={startDate} min={TODAY()} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need leave?" rows={3} />
        </div>
      </form>
    </MobileSheet>
  );
}
