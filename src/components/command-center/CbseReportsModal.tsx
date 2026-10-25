import { useCommandCenter } from "@/hooks/useCommandCenter";
import type { CbseReportType } from "./cbseReportTypes";
import { ReportModal } from "./ReportModal";

interface CbseReportsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The report picked in the Download report menu. */
  initialType?: CbseReportType;
}

/**
 * Lazy wrapper around the legacy CBSE ReportModal. `useCommandCenter` runs a
 * large fan-out of fee/HR/leave/exam queries purely to feed the four CBSE
 * report generators, so we only mount (and therefore only run) it when the
 * principal actually opens the reports — never on every dashboard load (§23).
 * Phase 4 will replace the primary "Download Report" action with the new
 * dashboard-snapshot report; the CBSE reports stay reachable here.
 */
export function CbseReportsModal({ open, onOpenChange, initialType }: CbseReportsModalProps) {
  const data = useCommandCenter();
  return <ReportModal open={open} onOpenChange={onOpenChange} data={data} initialType={initialType} />;
}
