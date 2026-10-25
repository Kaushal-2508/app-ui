import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CapturedSheet, useSubmitSheetsForProcessing } from "@/hooks/useOfflineScan";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight } from "lucide-react";

interface ProcessingStepProps {
  sheets: CapturedSheet[];
  examId: string;
  classId: string;
  onComplete: () => void;
}

export function ProcessingStep({
  sheets,
  examId,
  classId,
  onComplete,
}: ProcessingStepProps) {
  const submitMutation = useSubmitSheetsForProcessing();

  // Auto-submit on mount
  useEffect(() => {
    if (!submitMutation.isPending && !submitMutation.isSuccess && !submitMutation.isError) {
      submitMutation.mutate({ sheets, examId, classId });
    }
  }, []);

  const totalSheets = sheets.length;
  const progress = submitMutation.isSuccess ? 100 : submitMutation.isPending ? 50 : 0;

  return (
    <div className="space-y-6 py-4">
      <div className="text-center">
        {submitMutation.isPending && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Uploading Answer Sheets</h3>
            <p className="text-muted-foreground">
              Uploading {totalSheets} sheets for OCR processing...
            </p>
          </>
        )}

        {submitMutation.isSuccess && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Sheets Submitted!</h3>
            <p className="text-muted-foreground">
              {submitMutation.data?.length} sheets have been submitted for OCR processing.
              You can track the progress on the Evaluations page.
            </p>
          </>
        )}

        {submitMutation.isError && (
          <>
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Upload Failed</h3>
            <p className="text-muted-foreground mb-4">
              {(submitMutation.error as Error)?.message || "An error occurred while uploading sheets."}
            </p>
            <Button
              variant="outline"
              onClick={() => submitMutation.mutate({ sheets, examId, classId })}
            >
              Try Again
            </Button>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <Progress value={progress} className="h-2" />
        <p className="text-sm text-muted-foreground text-center">
          {submitMutation.isPending && "Uploading files..."}
          {submitMutation.isSuccess && "Complete!"}
          {submitMutation.isError && "Failed"}
        </p>
      </div>

      {/* Sheets summary */}
      <div className="bg-muted/50 rounded-lg p-4">
        <h4 className="font-medium mb-2">Summary</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Total Sheets:</span>
            <span className="ml-2 font-medium">{totalSheets}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span>
            <span className="ml-2 font-medium">
              {submitMutation.isPending && "Uploading"}
              {submitMutation.isSuccess && "Submitted"}
              {submitMutation.isError && "Failed"}
            </span>
          </div>
        </div>
      </div>

      {/* Complete button */}
      {submitMutation.isSuccess && (
        <div className="flex justify-center pt-4">
          <Button onClick={onComplete}>
            View in Evaluations
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
