import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useCloseEnrollment } from "@/hooks/olympiad/useCloseEnrollment";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  scheduledCloseAt?: string | null; // current enrollment_closes_at, if any
};

// End of the given IST calendar date as a UTC ISO timestamptz
// (23:59:59.999 IST = 18:29:59.999Z on the same date, since IST = UTC+5:30).
function endOfDayISTISO(dateStr: string): string {
  return `${dateStr}T18:29:59.999Z`;
}

// Today's date in IST as YYYY-MM-DD (never new Date(dateStr) for date-only parsing).
function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function CloseEnrollmentDialog({ open, onOpenChange, olySchoolId, scheduledCloseAt }: Props) {
  const close = useCloseEnrollment();
  const preset = scheduledCloseAt
    ? new Date(scheduledCloseAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    : "";
  const [date, setDate] = useState(preset);
  const [confirmNow, setConfirmNow] = useState("");

  // Hold the latest preset in a ref so the open-sync effect reads it without
  // depending on it — otherwise a background refetch (staleTime expiry) that
  // changes `preset` while the dialog is open would clobber an in-progress edit.
  const presetRef = useRef(preset);
  presetRef.current = preset;

  // The dialog is always-mounted in the dashboard, so re-sync the date field
  // (and clear the "close now" confirm box) only when the dialog OPENS.
  useEffect(() => {
    if (open) {
      setDate(presetRef.current);
      setConfirmNow("");
    }
  }, [open]);

  const submit = async (mode: "schedule" | "now" | "cancel") => {
    try {
      await close.mutateAsync({
        olySchoolId,
        mode,
        closesAt: mode === "schedule" ? endOfDayISTISO(date) : undefined,
      });
      onOpenChange(false);
      setConfirmNow("");
    } catch { /* toastError fires */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enrollment closing date</AlertDialogTitle>
          <AlertDialogDescription>
            Schedule the last date students can enroll. Enrollment stays open through that day (IST) and closes automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Last enrollment date</Label>
          <Input type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
          <Button className="mt-2" disabled={!date || close.isPending} onClick={() => submit("schedule")}>
            {close.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {scheduledCloseAt ? "Update closing date" : "Schedule"}
          </Button>
          {scheduledCloseAt && (
            <Button variant="outline" className="mt-1" disabled={close.isPending} onClick={() => submit("cancel")}>
              Cancel scheduled date
            </Button>
          )}
        </div>

        <div className="border-t border-surface-stroke pt-3 space-y-1.5">
          <Label className="text-xs font-medium text-ink-600">Or close immediately. Type CLOSE</Label>
          <Input value={confirmNow} onChange={(e) => setConfirmNow(e.target.value)} placeholder="CLOSE" />
          <Button
            variant="destructive"
            className="w-full"
            disabled={confirmNow !== "CLOSE" || close.isPending}
            onClick={() => submit("now")}
          >
            Close enrollment now
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
