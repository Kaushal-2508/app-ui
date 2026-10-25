import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getPaymentAdapter } from "@/lib/olympiad/payment";
import type { PayerContact } from "@/lib/olympiad/payment/types";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

type Props = {
  pendingId: string;
  clientPayload: unknown;
  payer: PayerContact;
  schoolCode: string;
  onCancel: () => void;
};

export function PaymentMethodHandoff({
  pendingId,
  clientPayload,
  payer,
  schoolCode,
  onCancel,
}: Props) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(true);

  useEffect(() => {
    const adapter = getPaymentAdapter();
    adapter
      .openCheckout({ clientPayload, pendingId, payer })
      .then(() => {
        navigate(`/olympiad/${schoolCode}/success?ref=${pendingId}`);
      })
      .catch((e: Error) => {
        const isCancel = (e.message ?? "").toLowerCase().includes("cancel");
        if (isCancel) {
          toast.info("Payment cancelled");
        } else {
          toastError(e, { fallback: "Couldn't complete payment.", context: "PaymentMethodHandoff" });
        }
        setOpening(false);
        onCancel();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId]);

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
      <p className="text-sm text-ink-700">
        {opening ? "Opening payment..." : "Payment cancelled"}
      </p>
    </div>
  );
}
