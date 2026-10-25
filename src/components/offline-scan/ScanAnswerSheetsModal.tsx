import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOfflineScan } from "@/hooks/useOfflineScan";
import { ContextStep } from "./ContextStep";
import { CaptureStep } from "./CaptureStep";
import { MatchStep } from "./MatchStep";
import { ProcessingStep } from "./ProcessingStep";
import { useEffect } from "react";

interface ScanAnswerSheetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preSelectedExamId?: string;
  preSelectedClassId?: string;
}

export function ScanAnswerSheetsModal({
  open,
  onOpenChange,
  preSelectedExamId,
  preSelectedClassId,
}: ScanAnswerSheetsModalProps) {
  const scan = useOfflineScan();

  // Set pre-selected values when modal opens
  useEffect(() => {
    if (open) {
      if (preSelectedExamId) scan.setExamId(preSelectedExamId);
      if (preSelectedClassId) scan.setClassId(preSelectedClassId);
      if (preSelectedExamId && preSelectedClassId) {
        scan.setStep("capture");
      }
    }
  }, [open, preSelectedExamId, preSelectedClassId]);

  // Reset on close
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      scan.reset();
    }
    onOpenChange(isOpen);
  };

  const stepTitles = {
    context: "Step 1: Select Exam & Class",
    capture: "Step 2: Capture Answer Sheets",
    match: "Step 3: Match Students",
    processing: "Step 4: Processing",
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Scan Answer Sheets
            <span className="text-sm font-normal text-muted-foreground">
              · {stepTitles[scan.step]}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4">
          {scan.step === "context" && (
            <ContextStep
              examId={scan.examId}
              classId={scan.classId}
              onExamChange={scan.setExamId}
              onClassChange={scan.setClassId}
              onNext={() => scan.setStep("capture")}
            />
          )}

          {scan.step === "capture" && (
            <CaptureStep
              sheets={scan.sheets}
              onAddSheet={scan.addSheet}
              onAddSheets={scan.addSheets}
              onRemoveSheet={scan.removeSheet}
              onBack={() => scan.setStep("context")}
              onNext={() => scan.setStep("match")}
            />
          )}

          {scan.step === "match" && (
            <MatchStep
              sheets={scan.sheets}
              examId={scan.examId}
              classId={scan.classId}
              onUpdateMatch={scan.updateSheetMatch}
              onClearMatch={scan.clearSheetMatch}
              matchedCount={scan.matchedCount}
              allMatched={scan.allMatched}
              onBack={() => scan.setStep("capture")}
              onSubmit={() => scan.setStep("processing")}
            />
          )}

          {scan.step === "processing" && (
            <ProcessingStep
              sheets={scan.sheets}
              examId={scan.examId!}
              classId={scan.classId!}
              onComplete={() => handleOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
