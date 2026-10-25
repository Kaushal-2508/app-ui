import { useState } from "react";
import { Loader2 } from "lucide-react";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import { OlympiadFlyer } from "@/components/olympiad/school/OlympiadFlyer";
import { MarketingMessages } from "@/components/olympiad/school/MarketingMessages";

type Format = "link" | "flyer" | "messages";

const FORMAT_TABS: { value: Format; label: string }[] = [
  { value: "link", label: "Enrollment link" },
  { value: "flyer", label: "Flyer" },
  { value: "messages", label: "Messages" },
];

/**
 * "Marketing Material" tab of the school-admin Olympiad flow: every
 * school-specific format for promoting the Olympiad to parents — the public
 * enrollment link + QR, a printable flyer, and ready-to-send messages
 * (email / SMS / WhatsApp / social caption).
 */
export default function OlympiadSchoolMarketingPage() {
  const { data: school, isLoading } = useOlympiadMySchool();
  const [format, setFormat] = useState<Format>("link");

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!school) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        This institution is not currently enrolled in the SALCI Olympiad. Please contact SALCI to onboard.
      </div>
    );
  }

  const base = (import.meta.env.VITE_PUBLIC_URL ?? "https://app.salci.ai").replace(/\/$/, "");
  const publicUrl = `${base}/olympiad/${school.school_short_code}`;
  const closesDateLabel = school.enrollment_closes_at
    ? new Date(school.enrollment_closes_at).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
      })
    : null;

  return (
    <div className="space-y-4 py-4">
      <header className="space-y-3">
        <div>
          <p className="eyebrow">Marketing material</p>
          <h2 className="text-base font-semibold text-ink-900">Promote the Olympiad to parents</h2>
        </div>
        <MobileTabs
          variant="segmented"
          value={format}
          onValueChange={(v) => setFormat(v as Format)}
          options={FORMAT_TABS}
        />
      </header>

      {format === "link" && (
        <div className="space-y-3">
          <PublicPaymentLink schoolShortCode={school.school_short_code} />
          <p className="text-xs text-ink-500">
            Parents open this link (or scan the QR) to enroll their child and pay online, no school
            account needed.
          </p>
        </div>
      )}

      {format === "flyer" && (
        <OlympiadFlyer
          schoolName={school.institution_name}
          publicUrl={publicUrl}
          closesDateLabel={closesDateLabel}
        />
      )}

      {format === "messages" && (
        <MarketingMessages
          schoolName={school.institution_name}
          publicUrl={publicUrl}
          closesDateLabel={closesDateLabel}
        />
      )}
    </div>
  );
}
