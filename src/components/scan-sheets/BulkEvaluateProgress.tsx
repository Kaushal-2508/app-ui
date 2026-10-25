import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, AlertTriangle, Sparkles } from "lucide-react";

interface BulkEvaluateProgressProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  errorMessage?: string;
  results?: Array<{ attemptId: string; success: boolean; data?: any; error?: any }>;
}

export function BulkEvaluateProgress({
  open,
  onOpenChange,
  isPending,
  isSuccess,
  isError,
  errorMessage,
  results,
}: BulkEvaluateProgressProps) {
  const successCount = results?.filter((r) => r.success).length || 0;
  const totalCount = results?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Evaluation
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          {isPending && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
              <div>
                <h3 className="font-medium">Evaluating Answer Sheets...</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  AI is grading each submission. This may take a moment.
                </p>
              </div>
              <Progress value={undefined} className="w-full h-2" />
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="font-medium text-green-600">Evaluation Complete!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Successfully evaluated {successCount} of {totalCount} submissions.
                </p>
              </div>

              {results && results.length > 0 && (
                <div className="w-full mt-4 space-y-2 max-h-40 overflow-y-auto">
                  {results.map((result, i) => (
                    <div
                      key={result.attemptId || i}
                      className={`flex items-center justify-between text-sm p-2 rounded ${
                        result.success
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      <span>Submission {i + 1}</span>
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Button onClick={() => onOpenChange(false)} className="mt-4">
                Close
              </Button>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="font-medium text-red-600">Evaluation Failed</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {errorMessage || "An error occurred during AI evaluation."}
                </p>
              </div>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
