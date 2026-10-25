import { useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { usePublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";
import { EnrollmentFormNonSalci } from "@/components/olympiad/public/EnrollmentFormNonSalci";
import { EnrollmentFormSalci } from "@/components/olympiad/public/EnrollmentFormSalci";
import { formatOlympiadFee } from "@/lib/olympiad/money";

export default function OlympiadPublicEnrollmentPage() {
  const { schoolCode } = useParams();
  const { data, isLoading } = usePublicPaymentContext(schoolCode);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <OlympiadPublicLayout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </OlympiadPublicLayout>
    );
  }

  if (!data || data.found === false) {
    return (
      <OlympiadPublicLayout>
        <div className="surface-card frosted-shadow rounded-card p-6 text-center">
          <p className="text-base font-semibold text-ink-900 mb-2">
            Enrollment unavailable
          </p>
          <p className="text-sm text-ink-600">
            This Olympiad URL is no longer accepting enrollments. Please contact
            your school for assistance.
          </p>
        </div>
      </OlympiadPublicLayout>
    );
  }

  const fee = formatOlympiadFee(data.price_rupees, data.gst_percent);

  if (!showForm) {
    return (
      <OlympiadPublicLayout>
        <div className="surface-card frosted-shadow rounded-card p-6 space-y-4">
          <header>
            <p className="eyebrow">Olympiad Enrollment</p>
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900 mt-1">
              {data.school_name}
            </h1>
          </header>
          <p className="text-sm text-ink-700">
            The SALCI Olympiad is a one-paper competitive exam covering three
            student-chosen subjects, taken in a proctored session at your school.
          </p>
          <div className="rounded-md border border-surface-stroke bg-surface-card p-4 text-center">
            <p className="eyebrow">Enrollment fee</p>
            <p className="text-2xl font-bold text-ink-900 mt-1">{fee.display}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="w-full bg-brand-primary text-white font-semibold py-3 rounded-md hover:opacity-90 transition"
          >
            Enroll student
          </button>
        </div>
      </OlympiadPublicLayout>
    );
  }

  return (
    <OlympiadPublicLayout>
      {data.is_existing_salci_school ? (
        <EnrollmentFormSalci context={data} />
      ) : (
        <EnrollmentFormNonSalci context={data} />
      )}
    </OlympiadPublicLayout>
  );
}
