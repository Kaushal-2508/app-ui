import { useRef, useState } from "react";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useOnboardingDashboard } from "@/hooks/useOnboardingDashboard";
import { PageShell, PageHeader } from "@/components/shared/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { toastError } from "@/lib/toast";
import { saveBlob } from "@/lib/native";
import { SummaryBanner } from "@/components/onboarding-dashboard/SummaryBanner";
import { DeltaBar } from "@/components/onboarding-dashboard/DeltaBar";
import { AlertCards } from "@/components/onboarding-dashboard/AlertCards";
import { KpiCards } from "@/components/onboarding-dashboard/KpiCards";
import { ProgressTrendChart } from "@/components/onboarding-dashboard/ProgressTrendChart";
import { DistributionAndFunnel } from "@/components/onboarding-dashboard/DistributionAndFunnel";
import { CompletedTeachersList } from "@/components/onboarding-dashboard/CompletedTeachersList";
import { PerTeacherTable } from "@/components/onboarding-dashboard/PerTeacherTable";
import { PendingTasksGrid } from "@/components/onboarding-dashboard/PendingTasksGrid";

// PDF export styles — flatten the gradient backdrop, float effects, and
// truncation so html2canvas captures a clean readable page. Also keeps
// small grid cards (pending-teacher tiles, stat tiles) and table rows from
// being sliced across page breaks.
const PDF_EXPORT_CSS = `
.pdf-export, .pdf-export * { box-shadow: none !important; }
.pdf-export { background: white !important; }
.pdf-export .surface-gradient { background: white !important; }
.pdf-export .surface-card { border: 1px solid rgba(0,0,0,0.12) !important; }
.pdf-export .truncate {
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: normal !important;
}
.pdf-export .line-clamp-2,
.pdf-export .line-clamp-1 {
  -webkit-line-clamp: unset !important;
  display: block !important;
  overflow: visible !important;
}
.pdf-export [class*="grid-cols"] > .surface-card,
.pdf-export [class*="grid-cols"] > div {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}
.pdf-export tr,
.pdf-export li {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}
`;

export default function OnboardingDashboardPage() {
  const { institutionId, institutionName } = useEffectiveInstitution();
  const data = useOnboardingDashboard(institutionId);
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const handleDownload = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    reportRef.current.classList.add("pdf-export");
    const safeName = (institutionName ?? "School").replace(/\s+/g, "_");
    const dateStamp = new Date().toISOString().slice(0, 10);
    const opt = {
      margin: 0.4,
      filename: `${safeName}_Onboarding_Dashboard_${dateStamp}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 1280 },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
      pagebreak: {
        mode: ["css", "legacy"],
        avoid: [".surface-card", "tr", "li", ".pdf-keep-together"],
      },
    };
    try {
      // Lazy: html2pdf.js pulls in html2canvas + jspdf (~1 MB), so the route
      // must not pay for it until the export is clicked (§23).
      const { default: html2pdf } = await import("html2pdf.js");
      const blob: Blob = await html2pdf().set(opt).from(reportRef.current).outputPdf("blob");
      saveBlob(blob, opt.filename);
    } catch (e) {
      toastError(e, {
        fallback: "Couldn't generate the PDF.",
        context: "downloadOnboardingDashboard",
      });
    } finally {
      reportRef.current?.classList.remove("pdf-export");
      setIsExporting(false);
    }
  };

  return (
    <PageShell>
      <style>{PDF_EXPORT_CSS}</style>
      <PageHeader
        title="Onboarding Progress"
        subtitle={`${institutionName ?? "School"} · Generated ${today}`}
        primaryAction={{
          label: isExporting ? "Preparing…" : "Download",
          icon: isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          ),
          onClick: handleDownload,
          disabled: isExporting || data.isLoading || data.isError,
        }}
      />

      {data.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {data.isError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Couldn't load onboarding data. Please refresh the page.
          </AlertDescription>
        </Alert>
      )}

      {!data.isLoading && !data.isError && (
        <div ref={reportRef} className="space-y-6">
          <SummaryBanner data={data} />
          <DeltaBar data={data} />
          <AlertCards alerts={data.alerts} />
          <KpiCards data={data} />
          <ProgressTrendChart data={data} />
          <DistributionAndFunnel data={data} />
          <CompletedTeachersList data={data} />
          <PerTeacherTable rows={data.live} />
          <PendingTasksGrid rows={data.live} zeroDayMap={data.zeroDayMap} />
        </div>
      )}
    </PageShell>
  );
}
