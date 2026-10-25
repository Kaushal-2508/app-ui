import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onAcknowledge: () => void;
  violations: number;
};

export function ProctoringWarningDialog({ open, onAcknowledge, violations }: Props) {
  const remaining = 3 - violations;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Proctoring violation detected
          </AlertDialogTitle>
          <AlertDialogDescription>
            You exited fullscreen or switched tabs. This is violation <strong>{violations} of 3</strong>.
            <br /><br />
            {remaining > 0
              ? <>You have <strong>{remaining}</strong> warning{remaining === 1 ? "" : "s"} remaining. After {remaining === 1 ? "this" : "3 violations"}, your exam will be submitted automatically.</>
              : <>Your exam will now be submitted automatically.</>
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge}>I understand</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
