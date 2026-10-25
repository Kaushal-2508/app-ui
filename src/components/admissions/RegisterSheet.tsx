import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Receipt } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import {
  DEFAULT_REGISTRATION_FEE_RUPEES,
  PAYMENT_MODES,
  PAYMENT_MODE_LABEL,
  formatRupees,
  registrationError,
  type PaymentMode,
} from "@/lib/admissions";
import { useRegisterEnquiry, type AdmissionEnquiryRow, type AdmissionSettings } from "@/hooks/admissions";
import { Field, PillGroup, SectionCard, SummaryStrip } from "./parts";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? format(new Date(y, m - 1, d), "d MMM yyyy") : iso;
}

/**
 * Registration: the parent pays the registration fee (the school's default,
 * Rs 1000 today) and the enquiry is saved as registered until the admission,
 * "immediate or after some days" (Naman, 2026-10-09). The receipt number is
 * the school's own book number, typed.
 */
export function RegisterSheet({
  enquiry,
  settings,
  onClose,
}: {
  enquiry: AdmissionEnquiryRow | null;
  settings: AdmissionSettings | undefined;
  onClose: () => void;
}) {
  const register = useRegisterEnquiry();
  const [fee, setFee] = useState<string>("");
  const [mode, setMode] = useState<PaymentMode | "">("");
  const [receipt, setReceipt] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const openFor = useRef<string | null>(null);
  useEffect(() => {
    if (enquiry && openFor.current !== enquiry.id) {
      openFor.current = enquiry.id;
      setFee(String(settings?.registration_fee_rupees ?? DEFAULT_REGISTRATION_FEE_RUPEES));
      setMode("");
      setReceipt("");
      setPaidOn(today());
      setNote("");
    }
    if (!enquiry) openFor.current = null;
  }, [enquiry, settings]);

  const feeRupees = Number(fee);
  const error = registrationError({ feeRupees, paymentMode: mode, receiptNo: receipt, paidOn });
  const pending = register.isPending;
  const summary = [
    fee !== "" && Number.isFinite(feeRupees) ? formatRupees(feeRupees) : "",
    mode ? `by ${PAYMENT_MODE_LABEL[mode]}` : "",
    receipt.trim() ? `receipt ${receipt.trim()}` : "",
    paidOn ? niceDate(paidOn) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const submit = () => {
    if (!enquiry || error || pending || !mode) return;
    register.mutate(
      { id: enquiry.id, feeRupees, paymentMode: mode, receiptNo: receipt, paidOn, note: note.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <MobileSheet
      open={!!enquiry}
      onOpenChange={(open) => !open && !pending && onClose()}
      title="Register"
      subtitle={enquiry ? `${enquiry.student_name} · ${enquiry.applying_for_label} · ${enquiry.academic_year_label}` : undefined}
      icon={<Receipt className="h-5 w-5" />}
      desktopWidth="md"
      primaryAction={{
        label: Number.isFinite(feeRupees) && fee !== "" ? `Record ${formatRupees(feeRupees)} and register` : "Register",
        onClick: submit,
        loading: pending,
        disabled: !!error || pending,
      }}
      secondaryAction={{ label: "Cancel", onClick: onClose, disabled: pending }}
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SectionCard icon={<Receipt />} tone="mint" title="Registration fee" hint="Recorded once; the child stays registered until the admission">
          <Field label="Amount" htmlFor="reg-fee">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-500">Rs</span>
              <Input id="reg-fee" type="number" inputMode="numeric" min={0} step={1} value={fee} onChange={(e) => setFee(e.target.value)} className="pl-9 text-base font-semibold tabular-nums" />
            </div>
          </Field>
          <Field label="Paid on" htmlFor="reg-date">
            <Input id="reg-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Paid by" wide>
            <PillGroup<PaymentMode> ariaLabel="Paid by" options={PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABEL[m] }))} value={mode} onChange={(v) => setMode(v)} />
          </Field>
          <Field label="Receipt number" htmlFor="reg-receipt" hint="From the school's receipt book">
            <Input id="reg-receipt" value={receipt} onChange={(e) => setReceipt(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Note" htmlFor="reg-note">
            <Textarea id="reg-note" value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="Optional" />
          </Field>
        </SectionCard>
        <SummaryStrip summary={summary} missing={error} />
        <p className="text-xs text-ink-500">The fee stays recorded even if the enquiry is dropped later.</p>
      </form>
    </MobileSheet>
  );
}
