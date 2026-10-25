import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useProcessingJobs } from "@/hooks/useOfflineScan";
import { Loader2, ChevronDown, ChevronUp, FileImage, CheckCircle2, Clock, AlertCircle } from "lucide-react";

export function ProcessingStatusCard() {
  const { data: jobs, isLoading } = useProcessingJobs();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Don't show if no jobs in last 24 hours
  if (isLoading || !jobs || jobs.length === 0) {
    return null;
  }

  const totalPending = jobs.reduce((sum, job) => sum + job.pending, 0);
  const totalProcessing = jobs.reduce((sum, job) => sum + job.processing, 0);
  const totalCompleted = jobs.reduce((sum, job) => sum + (job.completed || 0), 0);
  const totalFailed = jobs.reduce((sum, job) => sum + (job.failed || 0), 0);
  const totalJobs = jobs.reduce((sum, job) => sum + job.total, 0);
  
  // Only show if there are pending/processing jobs, or recently completed ones
  const hasPendingWork = totalPending > 0 || totalProcessing > 0;

  return (
    <Card className={`border-primary/20 ${hasPendingWork ? 'bg-primary/5' : 'bg-muted/30'}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {hasPendingWork ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : totalFailed > 0 ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              {hasPendingWork ? "Processing Answer Sheets" : "OCR Processing Complete"}
            </CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isOpen ? (
                  <>
                    Hide <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Details <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Summary */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2 flex-wrap">
            {totalPending > 0 && <span className="text-amber-600">{totalPending} pending</span>}
            {totalProcessing > 0 && <span className="text-blue-600">{totalProcessing} processing</span>}
            {totalCompleted > 0 && <span className="text-green-600">{totalCompleted} completed</span>}
            {totalFailed > 0 && <span className="text-destructive">{totalFailed} failed</span>}
            <span>· {totalJobs} total</span>
          </div>

          {/* Overall progress */}
          <Progress
            value={(totalCompleted / totalJobs) * 100}
            className="h-2"
          />

          <CollapsibleContent className="mt-4 space-y-3">
            {jobs.map((job) => {
              const isExpanded = expandedJob === `${job.examId}-${job.classId}`;
              const processed = job.total - job.pending - job.processing;
              const progress = (processed / job.total) * 100;

              return (
                <div
                  key={`${job.examId}-${job.classId}`}
                  className="p-3 rounded-lg border bg-card"
                >
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() =>
                      setExpandedJob(isExpanded ? null : `${job.examId}-${job.classId}`)
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileImage className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium truncate">{job.examTitle}</span>
                        <Badge variant="outline" className="text-xs">
                          {job.className}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {processed}/{job.total} sheets processed
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{Math.round(progress)}%</div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <Progress value={progress} className="h-1.5 mt-2" />

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                      {job.uploads.map((upload) => (
                        <div
                          key={upload.id}
                          className="flex items-center justify-between text-xs py-1"
                        >
                          <span className="truncate flex-1 text-muted-foreground">
                            {upload.fileName}
                          </span>
                          <div className="flex items-center gap-1 ml-2">
                            {upload.status === "pending" && (
                              <>
                                <Clock className="h-3 w-3 text-amber-500" />
                                <span className="text-amber-600">Pending</span>
                              </>
                            )}
                            {upload.status === "processing" && (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                <span className="text-blue-600">Processing</span>
                              </>
                            )}
                            {upload.status === "completed" && (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                <span className="text-green-600">Done</span>
                              </>
                            )}
                            {upload.status === "failed" && (
                              <>
                                <AlertCircle className="h-3 w-3 text-destructive" />
                                <span className="text-destructive">Failed</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
