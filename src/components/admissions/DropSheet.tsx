import { useEffect, useRef, useState } from "react";
import { XCircle } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import { useDropEnquiry, type AdmissionEnquiryRow } from "@/hooks/admissions";

/** Drop an enquiry with a reason; a registered child keeps the fee record. */
export function DropSheet({ enquiry, onClose }: { enquiry: AdmissionEnquiryRow | null; onClose: () => void }) {
  const drop = useDropEnquiry();
  const [reason, setReason] = useState("");
  const openFor = useRef<string | null>(null);
  useEffect(() => {
    if (enquiry && openFor.current !== enquiry.id) {
      openFor.current = enquiry.id;
      setReason("");
    }
    if (!enquiry) openFor.current = null;
  }, [enquiry]);
  const pending = drop.isPending;
  const canDrop = reason.trim().length > 0 && !pending;
  const submit = () => {
    if (!enquiry || !canDrop) return;
    drop.mutate({ id: enquiry.id, reason }, { onSuccess: onClose });
  };
  return (
    <MobileSheet
      open={!!enquiry}
      onOpenChange={(open) => !open && !pending && onClose()}
      title="Drop this enquiry?"
      subtitle={enquiry ? `${enquiry.student_name} · ${enquiry.reference_no}` : undefined}
      icon={<XCircle className="h-5 w-5" />}
      placement="center"
      desktopWidth="md"
      primaryAction={{ label: "Drop enquiry", onClick: submit, loading: pending, disabled: !canDrop }}
      secondaryAction={{ label: "Keep it", onClick: onClose, disabled: pending }}
    >
      <div className="space-y-3 p-4">
        <p className="text-sm text-ink-700">
          It leaves the pipeline and can be reopened later.
          {enquiry?.stage === "registered" && " The registration fee stays recorded."}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="drop-reason">Reason</Label>
          <Textarea id="drop-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Joined another school, moved away, no seat in that class…" />
        </div>
      </div>
    </MobileSheet>
  );
}
