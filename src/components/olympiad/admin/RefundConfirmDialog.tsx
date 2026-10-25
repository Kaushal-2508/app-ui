import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useOlympiadRefund, type RefundInput } from "@/hooks/olympiad/useOlympiadRefund";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  input: Omit<RefundInput, "reason">;
  contextLabel: string;
  confirmWord?: string;
};

export function RefundConfirmDialog({ open, onOpenChange, input, contextLabel, confirmWord }: Props) {
  const refund = useOlympiadRefund();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  const canSubmit = reason.trim() && (!confirmWord || typed === confirmWord);

  const onConfirm = async () => {
    try {
      await refund.mutateAsync({ ...input, reason: reason.trim() });
      onOpenChange(false);
      setReason("");
      setTyped("");
    } catch {
      // toastError fires on error path
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{contextLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            This is permanent. Online payments will be refunded via the gateway. Cash payments are flagged
            &quot;offline&quot; for the school to handle physically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Reason (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          {confirmWord && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Type {confirmWord} to confirm</Label>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canSubmit || refund.isPending}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {refund.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm refund
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
