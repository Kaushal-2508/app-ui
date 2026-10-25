import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OfflineMarksEntry } from "@/components/exam/OfflineMarksEntry";
import { OfflineMarksEntryScreen } from "@/components/exam-creation/screens/OfflineMarksEntryScreen";

interface OfflineMarksSheetProps {
  /** Exam to open. `null` keeps the sheet closed. */
  examId: string | null;
  /**
   * Results-only ("Already Created") exams were authored in the section-marks
   * pipeline (`offline_section_marks`) and MUST be reopened in it — reading a
   * results-only exam through the per-student pipeline shows an empty sheet.
   * The two pipelines never share a component or a query key.
   */
  isResultsOnly?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The offline marks window, shared by every surface that opens an offline exam.
 *
 * Extracted from ExamsPage so the dashboard's exam-trend chart opens the SAME
 * window a teacher gets from My Exams. Before this, a bar click sent them to
 * /exams/:id/results — the online evaluation view, which reads attempts and so
 * renders every offline student as 0/10 with "0/0 evaluated".
 */
export function OfflineMarksSheet({
  examId,
  isResultsOnly = false,
  onOpenChange,
}: OfflineMarksSheetProps) {
  return (
    <Sheet open={!!examId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-full md:max-w-4xl p-0 flex flex-col"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Offline marks entry</SheetTitle>
        </SheetHeader>
        {examId &&
          (isResultsOnly ? (
            // OfflineMarksEntryScreen is a full-page component (sticky header +
            // sticky CTA); wrap it in a bounded scroll region so its list
            // scrolls inside this fixed-height sheet.
            <div className="flex-1 min-h-0 overflow-y-auto">
              <OfflineMarksEntryScreen examId={examId} />
            </div>
          ) : (
            <OfflineMarksEntry examId={examId} />
          ))}
      </SheetContent>
    </Sheet>
  );
}
