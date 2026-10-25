import { useState } from "react";
import { format } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useApplyStaffLeave,
  STAFF_LEAVE_TYPES,
  STAFF_LEAVE_TYPE_LABEL,
  type StaffLeaveType,
} from "@/hooks/useStaffLeaveRequests";

// Local calendar date, never UTC: toISOString() is UTC, so before 05:30 IST
// the default date was yesterday.
const TODAY = () => format(new Date(), "yyyy-MM-dd");

/**
 * The staff twin of ApplyLeaveSheet: same sheet, same fields, same 60-day
 * cap, with the HR leave types instead of the student ones and a subtitle
 * that names who will review it (coordinator, admin, another admin).
 */
export function ApplyStaffLeaveSheet({
  open,
  onOpenChange,
  institutionId,
  reviewerLabel,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  institutionId: string | null;
  reviewerLabel: string;
  /** Fires after a request is saved (not on cancel), so the host can show it. */
  onApplied?: () => void;
}) {
  const apply = useApplyStaffLeave();
  const [leaveType, setLeaveType] = useState<StaffLeaveType>("casual");
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState(TODAY);
  const [reason, setReason] = useState("");

  const rangeDays =
    (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000;
  const tooLong = rangeDays > 60;
  const canSubmit =
    !!institutionId && reason.trim().length > 0 && startDate <= endDate && !tooLong && !apply.isPending;

  const submit = () => {
    if (!canSubmit || !institutionId) return;
    apply.mutate(
      { institution_id: institutionId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      { onSuccess: () => { setReason(""); onOpenChange(false); onApplied?.(); } },
    );
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Apply for leave"
      subtitle={`Request time off. ${reviewerLabel} will review it.`}
      icon={<CalendarPlus className="h-4 w-4" />}
      primaryAction={{ label: "Submit request", onClick: submit, loading: apply.isPending, disabled: !canSubmit }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form data-dirty={reason.trim().length > 0 ? "true" : undefined} className="space-y-4">
        {!institutionId && (
          <p className="text-xs text-rose-600">Your account isn't linked to a school yet. Ask your admin.</p>
        )}
        {tooLong && <p className="text-xs text-rose-600">Leave range can't exceed 60 days.</p>}
        <div className="space-y-1.5">
          <Label>Leave type</Label>
          <Select value={leaveType} onValueChange={(v) => setLeaveType(v as StaffLeaveType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAFF_LEAVE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{STAFF_LEAVE_TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={startDate}
              min={TODAY()}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
            />
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
