import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCancelPTM, type PTMSchedule } from "@/hooks/ptm";

interface Props {
  ptm: PTMSchedule | null;
  onClose: () => void;
  onCancelled?: () => void;
}

/**
 * Soft cancel. Confirms first and names what happens (CLAUDE.md section 9a):
 * the PTM is marked cancelled, everyone in scope is notified by the existing
 * trigger, and slot bookings are kept on the record.
 */
export function PTMCancelDialog({ ptm, onClose, onCancelled }: Props) {
  const cancelPTM = useCancelPTM();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (ptm) setReason("");
  }, [ptm]);

  return (
    <AlertDialog open={!!ptm} onOpenChange={(open) => !open && !cancelPTM.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this PTM?</AlertDialogTitle>
          <AlertDialogDescription>
            {ptm?.title} will be marked cancelled, and every teacher and family it was scheduled
            for will be notified. Slot bookings are kept on record. If the meeting is only moving,
            edit the date instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="ptm-cancel-reason">Reason (optional)</Label>
          <Textarea
            id="ptm-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Shown to no one yet; kept on the record."
            rows={2}
            maxLength={300}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelPTM.isPending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={cancelPTM.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!ptm) return;
              cancelPTM.mutate(
                { ptmId: ptm.id, reason },
                {
                  onSuccess: () => {
                    onCancelled?.();
                    onClose();
                  },
                },
              );
            }}
          >
            {cancelPTM.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cancel PTM
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
