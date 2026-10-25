import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAVE_TYPES, LEAVE_TYPE_LABEL, type LeaveType } from "@/hooks/useStudentLeave";

/**
 * Collects the leave type + reason a teacher is putting a student on leave
 * for, on the single date the roster is showing.
 *
 * It writes NOTHING. Confirming only lands the choice in the roster's draft,
 * so leave commits with the rest of the class on Save, in one transaction.
 * That keeps the roster's existing draft-then-save contract intact and means
 * a mis-tap costs nothing until the teacher saves.
 *
 * `reason` is required because `leave_requests.reason` is NOT NULL and the
 * text renders verbatim to the student and to every later reviewer.
 */
export function MarkLeaveSheet({
  open,
  onOpenChange,
  studentName,
  dateLabel,
  initialType,
  initialReason,
  existingNote,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentName: string;
  /** Human date the leave applies to, e.g. "3 Sep 2026". */
  dateLabel: string;
  initialType?: LeaveType;
  initialReason?: string;
  /** Shown when the student already has a leave record covering this date. */
  existingNote?: string | null;
  onConfirm: (leaveType: LeaveType, reason: string) => void;
}) {
  const [leaveType, setLeaveType] = useState<LeaveType>("sick");
  const [reason, setReason] = useState("");

  // Re-seed each time the sheet opens for a (possibly different) student, so
  // editing an existing draft entry shows what was already chosen and a fresh
  // one never inherits the last student's reason.
  useEffect(() => {
    if (!open) return;
    setLeaveType(initialType ?? "sick");
    setReason(initialReason ?? "");
  }, [open, initialType, initialReason]);

  const canConfirm = reason.trim().length > 0;

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(leaveType, reason.trim());
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mark on leave"
      subtitle={`${studentName} · ${dateLabel}`}
      icon={<CalendarCheck className="h-4 w-4" />}
      primaryAction={{ label: "Mark on leave", onClick: confirm, disabled: !canConfirm }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form data-dirty={reason.trim().length > 0 ? "true" : undefined} className="space-y-4">
        {existingNote && (
          <p className="text-xs text-ink-600 surface-card rounded-card p-3 border border-[hsl(var(--surface-stroke))]">
            {existingNote}
          </p>
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
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this student on leave?"
            rows={3}
          />
          <p className="text-[11px] text-ink-500">
            The student can see this. It is saved with the rest of the class when you tap Save.
          </p>
        </div>
      </form>
    </MobileSheet>
  );
}
