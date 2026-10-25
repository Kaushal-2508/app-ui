import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
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

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => Promise<void>;
  batchCount?: number;
};

export function LockScheduleDialog({
  open,
  onOpenChange,
  onConfirm,
  batchCount,
}: Props) {
  const [typed, setTyped] = useState("");
  const [isPending, setIsPending] = useState(false);
  const canConfirm = typed === "LOCK";

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsPending(true);
    try {
      await onConfirm();
      setTyped("");
    } catch {
      // toastError fires inside the mutation
    } finally {
      setIsPending(false);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!isPending) {
      setTyped("");
      onOpenChange(o);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Lock batch schedule?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will lock{" "}
            {batchCount ? (
              <strong>{batchCount} batches</strong>
            ) : (
              "all batches"
            )}{" "}
            and generate a unique PIN for each. PINs cannot be changed after a
            student has used them. The school status will move to{" "}
            <strong>batches scheduled</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">
            Type LOCK to confirm
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="LOCK"
            disabled={isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || isPending}
            onClick={handleConfirm}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Lock schedule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
