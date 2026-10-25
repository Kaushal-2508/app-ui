import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { Camera, Loader2, CheckCircle2, RefreshCw, AlertTriangle } from "lucide-react";

interface AcademicYearSnapshotProps {
  institutionId: string | null;
}

interface SnapshotResult {
  processed: number;
  total: number;
  failed: number;
  academicYear: string;
  finishedAt: Date;
}

export function AcademicYearSnapshot({ institutionId }: AcademicYearSnapshotProps) {
  const currentYear = new Date().getFullYear();
  const [academicYear, setAcademicYear] = useState(`${currentYear}-${currentYear + 1}`);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SnapshotResult | null>(null);

  const handleSnapshot = async () => {
    if (!institutionId) {
      toast.error("Institution not found");
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      // invokeEdgeFunction unwraps error.context so failures surface the real
      // Postgres message instead of "Edge Function returned a non-2xx status
      // code". See CLAUDE.md §21.
      const data = await invokeEdgeFunction<{
        processed: number;
        total: number;
        failed?: number;
      }>("snapshot-student-passport", {
        institution_id: institutionId,
        academic_year: academicYear,
      });

      const failed = data.failed ?? 0;
      setResult({
        processed: data.processed,
        total: data.total,
        failed,
        academicYear,
        finishedAt: new Date(),
      });
      const failedSuffix = failed > 0 ? ` · ${failed} skipped` : "";
      toast.success(
        `Snapshot complete: ${data.processed}/${data.total} students processed${failedSuffix}`,
      );
    } catch (err: unknown) {
      toastError(err, { fallback: "Snapshot failed.", context: "snapshotStudentPassport" });
    } finally {
      setIsRunning(false);
    }
  };

  // ─── Success state: prominent, unmissable ──────────────────────────
  if (result && !isRunning) {
    const finishedTimeLabel = result.finishedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const hasFailures = result.failed > 0;
    return (
      <Card className="rounded-2xl border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Academic Year Snapshot
          </CardTitle>
          <CardDescription>
            Capture current student performance into passport history before year-end class reassignments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-card p-5 sm:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Snapshot captured
                </p>
                <h3 className="mt-0.5 text-xl sm:text-2xl font-semibold tabular-nums">
                  {result.processed} <span className="text-base font-normal text-muted-foreground">of {result.total} students</span>
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Academic year <span className="font-medium text-foreground">{result.academicYear}</span> · finished at {finishedTimeLabel}
                </p>
              </div>
            </div>

            {hasFailures && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  {result.failed} student{result.failed === 1 ? "" : "s"} could not be
                  captured. Check the function logs for details.
                </span>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Each student's academic record + per-subject capability for {result.academicYear} is now stored in passport history. Visible from any student's passport page going forward.
            </p>
          </div>

          <Button
            onClick={() => setResult(null)}
            variant="outline"
            className="w-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Take another snapshot
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── Idle / Running state ──────────────────────────────────────────
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Academic Year Snapshot
        </CardTitle>
        <CardDescription>
          Capture current student performance into passport history before year-end class reassignments
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="academic-year">Academic Year</Label>
          <Input
            id="academic-year"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            placeholder="e.g. 2025-2026"
            disabled={isRunning}
          />
        </div>

        <Button onClick={handleSnapshot} disabled={isRunning || !institutionId} className="w-full">
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Capturing snapshot…
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 mr-2" />
              Take Year Snapshot
            </>
          )}
        </Button>

        {isRunning ? (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Loader2 className="h-3 w-3 mt-0.5 animate-spin shrink-0" />
            <span>
              Processing every student in the institution. This can take 30–60 seconds depending on roster size. Please don't close this tab.
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            This saves each student's current academic records and subject capabilities for the specified year. Run this before promoting students to new classes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
