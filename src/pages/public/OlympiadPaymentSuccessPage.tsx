import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { useOlympiadPaymentStatus } from "@/hooks/olympiad/useOlympiadPaymentStatus";

export default function OlympiadPaymentSuccessPage() {
  // schoolCode is in the URL but not needed on this page
  const { schoolCode: _schoolCode } = useParams();
  const [params] = useSearchParams();
  const pendingId = params.get("ref");
  const { data, isLoading } = useOlympiadPaymentStatus(pendingId);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 90_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <OlympiadPublicLayout>
      <div className="surface-card frosted-shadow rounded-card p-8 text-center space-y-4">
        {isLoading ||
        !data ||
        (data.status === "payment_pending" && !timedOut) ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-brand-primary mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">
              Confirming your payment
            </h1>
            <p className="text-sm text-ink-600">
              This usually takes a few seconds.
            </p>
          </>
        ) : data?.status === "paid" && data.roll_number ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">
              Enrollment confirmed
            </h1>
            <div className="rounded-md border border-surface-stroke bg-surface-card p-4">
              <p className="eyebrow">Roll number</p>
              <p className="text-xl font-bold text-ink-900 mt-1 tracking-wider">
                {data.roll_number}
              </p>
            </div>
            <p className="text-sm text-ink-600">
              A receipt with login credentials has been emailed to you (if you
              provided an email).
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">
              We're still confirming your payment
            </h1>
            <p className="text-sm text-ink-600">
              Check your email shortly, or contact your school if you don't
              receive a receipt within 30 minutes.
            </p>
          </>
        )}
      </div>
    </OlympiadPublicLayout>
  );
}
