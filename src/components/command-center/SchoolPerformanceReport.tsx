import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { dash5ReportSnapshotQuery } from "@/hooks/dashboard/useDash5";
import { preparePrint } from "@/lib/native";
import {
  buildSchoolPerformanceReportHtml,
  DEFAULT_REPORT_CONFIG,
} from "@/lib/reports/schoolPerformanceReport";
import { toastError } from "@/lib/toast";

/**
 * The School Performance Report, straight from a click.
 *
 * Replaces the old Dashboard Snapshot, which rasterised eight client-side
 * queries from the retired dash_* family into a PDF: the numbers could differ
 * from the dashboard the button sits on, and at 8pt the html2canvas raster was
 * soft. This prints the four-page report from one dash5_report_snapshot read,
 * through the browser's own print pipeline, so the type stays vector and A4
 * pagination is the page's own.
 *
 * There used to be a sheet in between that described the four pages and had a
 * Generate button. It did no work, so it went (owner's call, 2026-10-06): the
 * click now opens the print window, fetches the figures and prints.
 *
 * The format has no options on purpose: it is four fixed pages measured
 * against the academic calendar and the CBSE attendance floor, not a report
 * builder. Spec: public/report_reference/school-performance-report.html.
 *
 * Call the returned function from a click handler (directly or within a
 * moment of it): the print window must open while the click still counts as a
 * user gesture, or the popup blocker stops it.
 */
export function useSchoolPerformanceReport() {
  const queryClient = useQueryClient();
  // Single-flight: a second click while a build is running does nothing.
  const busy = useRef(false);

  return useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const pending = preparePrint({
      width: 1100,
      height: 800,
      // The report paginates itself once Inter has loaded, and printing
      // before that would capture the un-reflowed static layout. Measured
      // at about 1.2s from load to settled on a 4-page build.
      settleMs: 1800,
    });
    const toastId = toast.loading("Preparing the school performance report");
    try {
      // Reuses a snapshot under five minutes old; otherwise about 5s.
      const snap = await queryClient.fetchQuery(dash5ReportSnapshotQuery);
      const safe = snap.meta.school.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "School";
      await pending.print(buildSchoolPerformanceReportHtml(snap, DEFAULT_REPORT_CONFIG), {
        filename: `${safe}_School_Performance_Report.pdf`,
      });
      toast.success("Report ready. Choose Save as PDF in the print dialog.", { id: toastId });
    } catch (err) {
      pending.cancel();
      toast.dismiss(toastId);
      toastError(err, {
        fallback: "Couldn't build the performance report. Try again in a moment.",
        context: "schoolPerformanceReport",
      });
    } finally {
      busy.current = false;
    }
  }, [queryClient]);
}
