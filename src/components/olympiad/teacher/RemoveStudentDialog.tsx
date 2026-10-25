// src/components/olympiad/teacher/RemoveStudentDialog.tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useOlympiadRemoveStudent } from "@/hooks/olympiad/useOlympiadRemoveStudent";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student: RosterStudent | null;
};

export function RemoveStudentDialog({ open, onOpenChange, student }: Props) {
  const removeStudent = useOlympiadRemoveStudent();
  const [reason, setReason] = useState("");

  const isOnline = student?.enrollment_channel === "parent_online";
  const refundNote = isOnline
    ? "A refund will be issued automatically via the payment gateway."
    : "This is a cash enrollment. Please return the fee to the parent physically. The system will mark it 'refund offline'.";

  const onConfirm = async () => {
    if (!student || !reason.trim()) return;
    try {
      await removeStudent.mutateAsync({ oly_student_id: student.id, reason: reason.trim() });
      setReason("");
      onOpenChange(false);
    } catch {
      // toastError fires in the mutation's onError
    }
  };

  if (!student) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {student.full_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will mark the student as removed and cannot be undone from the teacher portal.{" "}
            {refundNote}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Reason for removal *</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Student transferred to another school"
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim() || removeStudent.isPending}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {removeStudent.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Remove student
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
