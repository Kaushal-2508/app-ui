import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOlympiadPinValidate, type PinValidateResult } from "@/hooks/olympiad/useOlympiadPinValidate";

type Props = { onSuccess: (result: Extract<PinValidateResult, { ok: true }>) => void };

const REASON_COPY: Record<string, string> = {
  wrong_pin: "Incorrect PIN. Please check the PIN your supervisor has shared.",
  wrong_batch: "This PIN does not match your assigned batch. Please contact your school.",
  expired_pin: "This batch's entry window has closed. Please contact your school.",
  already_attempted: "You have already submitted this exam. Contact your school if this is an error.",
  student_not_found: "We can't find your enrollment. Please contact your school.",
  enrollment_closed: "This exam is not yet scheduled. Please contact your school.",
};

export function PinEntryForm({ onSuccess }: Props) {
  const validate = useOlympiadPinValidate();
  const [pin, setPin] = useState("");
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorReason(null);
    if (pin.length !== 6) return;
    try {
      const result = await validate.mutateAsync(pin);
      if (result.ok === true) {
        onSuccess(result);
      } else {
        const msg = REASON_COPY[result.reason] ?? "Couldn't validate PIN.";
        setErrorReason(msg);
        toast.error(msg);
      }
    } catch { /* toastError fires */ }
  };

  return (
    <form onSubmit={onSubmit} className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5">
      <header className="text-center">
        <p className="eyebrow">Enter PIN</p>
        <h2 className="text-xl font-bold text-ink-900 mt-1">Your supervisor has the PIN</h2>
        <p className="text-sm text-ink-600 mt-2">Enter the 6-character PIN shown by your supervisor to start the exam.</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Batch PIN</Label>
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          maxLength={6}
          placeholder="XK4M7P"
          className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
          autoFocus
          required
        />
      </div>

      {errorReason && (
        <p className="text-sm text-red-600">{errorReason}</p>
      )}

      <Button type="submit" className="w-full" disabled={pin.length !== 6 || validate.isPending}>
        {validate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Validate PIN
      </Button>
    </form>
  );
}
