import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { PublishJob } from "@/hooks/olympiad/useOlympiadPublishJob";

const STATUS_LABEL: Record<PublishJob["status"], string> = {
  queued: "Queued, starting soon",
  computing_ranks: "Computing ranks…",
  generating_pdfs: "Generating PDFs…",
  sending_emails: "Sending parent emails…",
  completed: "All done",
  failed: "Failed",
};

export function PublishJobStatus({ job }: { job: PublishJob }) {
  const pct =
    job.total_students > 0
      ? Math.round((job.processed_students / job.total_students) * 100)
      : 0;
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <div className="surface-card frosted-shadow rounded-card p-6 space-y-4">
      <header className="flex items-center gap-3">
        {isDone && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
        {isFailed && <AlertCircle className="h-6 w-6 text-red-500" />}
        {!isDone && !isFailed && (
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
        )}
        <div>
          <p className="eyebrow">Publish status</p>
          <h2 className="text-lg font-bold text-ink-900">
            {STATUS_LABEL[job.status]}
          </h2>
        </div>
      </header>

      {!isDone && !isFailed && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-600">
            <span>
              {job.processed_students} / {job.total_students} students
            </span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      )}

      {isDone && (
        <p className="text-sm text-ink-700">
          All {job.total_students} students processed. Parents have been notified
          by email.
        </p>
      )}

      {isFailed && job.error && (
        <p className="text-sm text-red-700">Error: {job.error}</p>
      )}

      {job.failed_students > 0 && !isFailed && (
        <p className="text-xs text-amber-700">
          {job.failed_students} student
          {job.failed_students === 1 ? "" : "s"} had errors during processing.
          Retry available.
        </p>
      )}
    </div>
  );
}
