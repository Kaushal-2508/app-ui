import { useState } from "react";
import { Loader2 } from "lucide-react";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answeredCount: number;
  totalCount: number;
  onConfirm: () => Promise<void>;
};

export function SubmitConfirmDialog({ open, onOpenChange, answeredCount, totalCount, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const unanswered = totalCount - answeredCount;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
          <AlertDialogDescription>
            You have answered {answeredCount} of {totalCount} questions.
            {unanswered > 0 && (
              <> Unanswered questions will be marked as not attempted.</>
            )}
            <br /><br />
            Once submitted, you cannot make any more changes. Are you sure?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit exam
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
