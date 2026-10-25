import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  format,
} from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  UploadCloud,
  X,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileSheet } from "@/components/shared/sheets";
import {
  SubmissionFileViewer,
  type SubmissionFileMeta,
} from "@/components/homework/SubmissionFileViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatClassName } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useHomeworkFileUrl,
  useStudentHomeworkDetail,
  useSubmitHomework,
  type StudentHomeworkRow,
} from "@/hooks/useStudentHomework";
import {
  validateFileUpload,
  HOMEWORK_FILE_ACCEPT,
  HOMEWORK_FILE_ALLOWED_MIMES,
  HOMEWORK_MAX_FILE_BYTES,
  HOMEWORK_MAX_FILES,
} from "@/lib/fileValidation";

const BUCKET = "homework-files";

/** "Due in Xd Yh" / "Due today" / "Overdue — late if submitted". */
function dueLabel(dueAt: string): { text: string; overdue: boolean } {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = differenceInMilliseconds(due, now);
  if (diffMs <= 0) {
    return { text: "Closed", overdue: true };
  }
  const days = differenceInDays(due, now);
  const hours = differenceInHours(due, now) % 24;
  if (days > 0) return { text: `Due in ${days}d ${hours}h`, overdue: false };
  if (hours > 0) return { text: `Due in ${hours}h`, overdue: false };
  return { text: "Due today", overdue: false };
}

function subtitleFor(row: StudentHomeworkRow): string {
  const subjectName =
    row.subjects.length > 0
      ? row.subjects.map((s) => s.name).join(", ")
      : (row.subject?.name ?? "");
  const classNames = row.classes.map((c) => formatClassName(c.name, c.section)).join(", ");
  return classNames ? `${subjectName} · ${classNames}` : subjectName;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Dedupe key for a staged file (name + size — a File has no stable id). */
function fileKey(f: File): string {
  return `${f.name}::${f.size}`;
}

export default function StudentHomeworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { row, isLoading } = useStudentHomeworkDetail(id);

  // Held at top level (never call a hook inside a handler).
  const fileUrl = useHomeworkFileUrl();
  const submit = useSubmitHomework();
  const { institutionId } = useEffectiveInstitution();

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Stable resolver for the student's OWN files (they own the objects → direct sign).
  const ownFileUrl = useCallback(async (file: SubmissionFileMeta): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(file.storagePath, 300);
    if (error || !data) throw error ?? new Error("Couldn't open file");
    return data.signedUrl;
  }, []);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!row) {
    return (
      <PageShell>
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="Not available"
          description="This assignment isn't available to you."
          reason="noData"
        />
      </PageShell>
    );
  }

  const due = dueLabel(row.due_at);
  const isOverdue = new Date() > new Date(row.due_at);
  const locked = row.locked;
  // Hard window: submit only while open (visible AND on/before due), online (not
  // offline-marked), and unsubmitted.
  const canSubmit =
    !locked && !isOverdue && !row.offline_marks && !row.submission && row.status === "published";

  const handleFilesPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    // Reset the input so re-picking the same file fires change again.
    event.target.value = "";
    if (picked.length === 0) return;

    setUploadError(null);
    setStagedFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];
      let rejected: string | null = null;
      for (const file of picked) {
        const validationError = validateFileUpload(file, {
          allowedMimes: HOMEWORK_FILE_ALLOWED_MIMES,
          maxBytes: HOMEWORK_MAX_FILE_BYTES,
        });
        if (validationError) {
          rejected = validationError;
          continue;
        }
        const key = fileKey(file);
        if (seen.has(key)) continue;
        if (next.length >= HOMEWORK_MAX_FILES) {
          rejected = `You can attach at most ${HOMEWORK_MAX_FILES} files.`;
          break;
        }
        seen.add(key);
        next.push(file);
      }
      if (rejected) setUploadError(rejected);
      return next;
    });
  };

  const removeStaged = (key: string) => {
    setStagedFiles((prev) => prev.filter((f) => fileKey(f) !== key));
    setUploadError(null);
  };

  const handleDownloadAttachment = async () => {
    if (!row.attachment_path) return;
    setDownloading(true);
    try {
      const url = await fileUrl.mutateAsync({ homework_assignment_id: row.id });
      openExternal(url);
    } catch (err) {
      toastError(err instanceof Error ? err : new Error("Couldn't open the attachment."), {
        fallback: "Couldn't open the attachment.",
        context: "homeworkAttachmentDownload",
      });
    } finally {
      setDownloading(false);
    }
  };

  const doSubmit = () => {
    if (!institutionId || stagedFiles.length === 0) return;
    submit.mutate(
      { homeworkId: row.id, institutionId, files: stagedFiles },
      {
        onSuccess: () => {
          setSheetOpen(false);
          setStagedFiles([]);
          setUploadError(null);
        },
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title={row.title}
        subtitle={subtitleFor(row)}
      />

      {/* Header info block */}
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-4">
        {locked && (
          <div className="flex items-start gap-2 rounded-lg border border-surface-stroke bg-muted/40 px-3 py-2.5 text-[13px] text-ink-600">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span>
              This assignment opens on{" "}
              <span className="font-medium text-ink-800">
                {format(new Date(row.visible_from), "MMM d, yyyy · h:mm a")}
              </span>
              . The details and submission unlock then.
            </span>
          </div>
        )}
        {row.description && (
          <p className="whitespace-pre-wrap text-[14px] leading-[22px] text-ink-700">
            {row.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {locked && (
            <span className="inline-flex items-center gap-1.5 text-ink-600">
              <CalendarClock className="h-4 w-4 text-ink-400" aria-hidden />
              Opens {format(new Date(row.visible_from), "MMM d, yyyy · h:mm a")}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-ink-600">
            <CalendarClock className="h-4 w-4 text-ink-400" aria-hidden />
            Due {format(new Date(row.due_at), "MMM d, yyyy · h:mm a")}
          </span>
          {!locked && (
            <span
              className={cn(
                "font-medium",
                due.overdue ? "text-rose-600" : "text-brand-primary",
              )}
            >
              {due.text}
            </span>
          )}
        </div>
        <p className="text-[13px] text-ink-500">
          {row.carries_marks
            ? row.max_marks != null
              ? `Carries ${row.max_marks} marks`
              : "Carries marks"
            : "Review only, written feedback"}
        </p>

        {row.attachment_path && (
          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadAttachment}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-1.5 h-4 w-4" aria-hidden />
              )}
              {`Download ${row.attachment_name ?? "attachment"}`}
            </Button>
          </div>
        )}
      </section>

      {/* Upload + submit (only when not yet submitted and still open) */}
      {canSubmit && (
        <form
          data-dirty={stagedFiles.length > 0 ? "true" : undefined}
          onSubmit={(e) => e.preventDefault()}
          className="mt-4 surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-4"
        >
          <div className="space-y-1">
            <h2 className="text-[16px] font-semibold text-ink-900">Your submission</h2>
            <p className="text-[13px] text-ink-500">
              Attach up to {HOMEWORK_MAX_FILES} files (max 10 MB each). Images, PDF, Word,
              PowerPoint, Excel, or text.
            </p>
          </div>

          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl",
              "border-2 border-dashed border-surface-stroke bg-muted/30 px-4 py-6 text-center",
              "transition-colors hover:border-brand-primary/50 hover:bg-brand-primary/5",
            )}
          >
            <UploadCloud className="h-7 w-7 text-ink-400" aria-hidden />
            <span className="text-[14px] font-medium text-ink-700">Tap to choose files</span>
            <span className="text-[12px] text-ink-500">
              {stagedFiles.length}/{HOMEWORK_MAX_FILES} selected
            </span>
            <Input
              type="file"
              accept={HOMEWORK_FILE_ACCEPT}
              multiple
              className="sr-only"
              onChange={handleFilesPicked}
            />
          </label>

          {uploadError && (
            <p className="text-[13px] text-rose-600 dark:text-rose-400">{uploadError}</p>
          )}

          {stagedFiles.length > 0 && (
            <ul className="space-y-2">
              {stagedFiles.map((file) => {
                const key = fileKey(file);
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-surface-stroke bg-muted/20 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] text-ink-800"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-500">
                      {formatBytes(file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStaged(key)}
                      aria-label={`Remove ${file.name}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-ink-400/10"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            type="button"
            className="w-full bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98] sm:w-auto"
            disabled={stagedFiles.length === 0 || submit.isPending}
            onClick={() => setSheetOpen(true)}
          >
            {submit.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <UploadCloud className="mr-2 h-4 w-4" aria-hidden />
            )}
            Submit assignment
          </Button>
        </form>
      )}

      {/* Offline-marked assignment: no online submission; show marks once checked */}
      {row.offline_marks && !locked && (
        <section className="mt-4 surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-4">
          <div className="flex items-start gap-2">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold text-ink-900">Submitted offline</p>
              <p className="mt-0.5 text-[13px] text-ink-500">
                {row.status === "checked"
                  ? "Your teacher recorded your marks for this assignment."
                  : "Hand this assignment to your teacher. Your marks will appear here once they're recorded."}
              </p>
            </div>
          </div>
          {row.status === "checked" && <ResultBlock row={row} />}
        </section>
      )}

      {/* Window closed and the student never submitted */}
      {!row.submission && !locked && !row.offline_marks && isOverdue && (
        <section className="mt-4 surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold text-ink-900">Submission window closed</p>
              <p className="mt-0.5 text-[13px] text-ink-500">
                The due date has passed, so you can no longer submit online. If you completed
                this offline, contact your teacher.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Submitted (read-only) + result */}
      {row.submission && (
        <SubmittedSection row={row} getUrl={ownFileUrl} />
      )}

      <MobileSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Submit assignment?"
        icon={<UploadCloud className="h-4 w-4" />}
        primaryAction={{ label: "Submit", onClick: doSubmit, loading: submit.isPending }}
        secondaryAction={{ label: "Cancel", onClick: () => setSheetOpen(false) }}
      >
        <p className="text-[14px] leading-[22px] text-ink-700">
          Once you submit, you cannot make changes. Are you sure?
        </p>
      </MobileSheet>
    </PageShell>
  );
}

function SubmittedSection({
  row,
  getUrl,
}: {
  row: StudentHomeworkRow;
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
}) {
  const submission = row.submission!;

  const { data: myFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ["my-hw-files", submission.id],
    staleTime: 60_000,
    queryFn: async (): Promise<SubmissionFileMeta[]> => {
      const { data, error } = await supabase
        .from("homework_submission_files")
        .select("id, file_name, file_mime, storage_path")
        .eq("submission_id", submission.id);
      if (error) throw error;
      return (data ?? []).map((f) => ({
        id: f.id,
        name: f.file_name,
        mime: f.file_mime,
        storagePath: f.storage_path,
      }));
    },
  });

  return (
    <section className="mt-4 surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-ink-900">Your submission</h2>
      </div>
      <p className="text-[13px] text-ink-500">
        Submitted on {format(new Date(submission.submitted_at), "MMM d, yyyy · h:mm a")}
      </p>

      <div className="space-y-2">
        <p className="eyebrow flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          Attached files
        </p>
        {filesLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Skeleton className="aspect-[3/4] rounded-xl" />
            <Skeleton className="aspect-[3/4] rounded-xl" />
          </div>
        ) : myFiles.length > 0 ? (
          <SubmissionFileViewer files={myFiles} getUrl={getUrl} />
        ) : (
          <p className="text-[13px] text-ink-500">No files found for this submission.</p>
        )}
      </div>

      <ResultBlock row={row} />
    </section>
  );
}

function ResultBlock({ row }: { row: StudentHomeworkRow }) {
  const checked = row.status === "checked" && !!row.result;

  if (!checked) {
    // Closed with no result row (unmarked assignment auto-closed, or a student
    // the teacher didn't mark).
    const message =
      row.status === "checked"
        ? row.carries_marks
          ? "No marks recorded."
          : "Reviewed, no written feedback."
        : "Waiting for teacher to mark.";
    return (
      <div className="rounded-xl border border-surface-stroke bg-muted/20 px-4 py-3">
        <p className="text-[14px] text-ink-600">{message}</p>
      </div>
    );
  }

  const result = row.result!;

  if (row.carries_marks) {
    return (
      <div className="space-y-3 rounded-xl border border-surface-stroke bg-muted/20 px-4 py-4">
        <div>
          <p className="eyebrow">Marks awarded</p>
          <p className="text-[28px] font-bold leading-[32px] text-ink-900">
            {result.marks_awarded ?? "N/A"}{" "}
            <span className="text-[16px] font-medium text-ink-500">
              / {row.max_marks ?? "N/A"}
            </span>
          </p>
        </div>
        {result.feedback && (
          <div>
            <p className="eyebrow">Feedback</p>
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[22px] text-ink-700">
              {result.feedback}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Review-only.
  return (
    <div className="space-y-1 rounded-xl border border-surface-stroke bg-muted/20 px-4 py-4">
      <p className="eyebrow">Feedback</p>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[22px] text-ink-700">
        {result.feedback ? result.feedback : "Feedback received"}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <PageShell>
      <div className="py-4 sm:py-6 lg:py-8 space-y-3">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/3 rounded-lg" />
      </div>
      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-3">
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-5/6 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <div className="mt-4 surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </PageShell>
  );
}
