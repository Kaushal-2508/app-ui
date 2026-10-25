import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
  SkipForward,
  UploadCloud,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileSheet } from "@/components/shared/sheets";
import {
  SubmissionFileViewer,
  type SubmissionFileMeta,
} from "@/components/homework/SubmissionFileViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatClassName } from "@/lib/utils";
import {
  useHomeworkMarkingAssignment,
  useHomeworkMarkingRoster,
  useHomeworkSubmissionFiles,
  useUpsertHomeworkResult,
  useUpsertRosterMarks,
  usePublishHomeworkMarks,
  type MarkingAssignment,
  type MarkingRosterRow,
  type RosterMarkInput,
} from "@/hooks/useHomeworkMarking";
import { useHomeworkFileUrl, useHomeworkFileUrlResolver } from "@/hooks/useStudentHomework";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";

/** Per-submission local draft. Seeded from the roster; committed on blur/Enter. */
interface Draft {
  marks: string;
  feedback: string;
}

/** A marks string is valid for a 'graded' commit iff it parses to a finite,
 *  non-negative number within the assignment's max. Empty / NaN is INVALID and
 *  must never produce a 'graded' result (it would wrongly satisfy the gate). */
function markError(raw: string, maxMarks: number | null): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Enter a mark.";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a valid number.";
  if (n < 0) return "Mark can't be negative.";
  if (maxMarks != null && n > maxMarks) return `Max is ${maxMarks}.`;
  return null;
}

function subtitleFor(asn: MarkingAssignment): string {
  const subject =
    asn.subjects.length > 0
      ? asn.subjects.map((s) => s.name).join(", ")
      : (asn.subject?.name ?? "");
  const classes = asn.classes
    .map((c) => formatClassName(c.name, c.section))
    .filter(Boolean)
    .join(", ");
  const due = `due ${format(new Date(asn.due_at), "MMM d, yyyy")}`;
  const status =
    asn.status === "checked" ? "Checked" : asn.status === "published" ? "Published" : "Draft";
  return [subject, classes, due, status].filter(Boolean).join(" · ");
}

/** Order roster rows by roll number — numeric-aware (so 21 < 23 < 25 < 125,
 *  not lexicographic); students with no roll go last; name is the tiebreaker. */
function compareByRoll(a: MarkingRosterRow, b: MarkingRosterRow): number {
  const ra = (a.roll_number ?? "").trim();
  const rb = (b.roll_number ?? "").trim();
  if (ra && !rb) return -1;
  if (!ra && rb) return 1;
  if (ra && rb) {
    const cmp = ra.localeCompare(rb, undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp;
  }
  return (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, { sensitivity: "base" });
}

export default function HomeworkMarkingPage() {
  const { id } = useParams<{ id: string }>();
  const asn = useHomeworkMarkingAssignment(id);
  const roster = useHomeworkMarkingRoster(id);

  const upsert = useUpsertHomeworkResult();
  const rosterMarks = useUpsertRosterMarks();
  const publish = usePublishHomeworkMarks();

  // Stable resolver — SubmissionFileViewer treats getUrl as a thumbnail-effect
  // dependency, so it MUST be referentially stable across renders. The resolver
  // hook is an empty-dep useCallback (NOT a mutation object), so getUrl never
  // changes identity → the viewer's thumbnail effect runs once per file, not in
  // a loop. (A mutation's identity changes on every call → infinite re-render.)
  const resolveFileUrl = useHomeworkFileUrlResolver();
  const getUrl = useCallback(
    (f: SubmissionFileMeta): Promise<string> =>
      resolveFileUrl({ submission_file_id: f.id }),
    [resolveFileUrl],
  );

  const rows = useMemo(
    () => [...(roster.data ?? [])].sort(compareByRoll),
    [roster.data],
  );

  const submitted = useMemo(() => rows.filter((r) => r.submission_id), [rows]);
  const notSubmitted = useMemo(() => rows.filter((r) => !r.submission_id), [rows]);
  const processed = useMemo(
    () =>
      submitted.filter(
        (r) => r.result_status === "graded" || r.result_status === "skipped",
      ),
    [submitted],
  );

  // Local draft state, keyed by submission_id, seeded from the roster. We only
  // seed keys that don't already exist locally so an in-flight edit isn't blown
  // away by a background roster refetch.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of submitted) {
        const key = r.submission_id!;
        if (next[key] === undefined) {
          next[key] = {
            marks: r.marks_awarded != null ? String(r.marks_awarded) : "",
            feedback: r.feedback ?? "",
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [submitted]);

  const fileMap = useHomeworkSubmissionFiles(
    submitted.map((r) => r.submission_id!).filter(Boolean),
  );

  const counterLine = useMemo(() => {
    const pending = submitted.length - processed.length;
    return `${submitted.length} of ${rows.length} submitted · ${processed.length} marked · ${pending} pending`;
  }, [submitted.length, rows.length, processed.length]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);

  // ---- Loading / not-available -------------------------------------------

  if (asn.isLoading || roster.isLoading) {
    return <MarkingSkeleton />;
  }

  // A failed roster/assignment fetch must surface as an explicit error — never
  // fall through to the "No submissions yet" empty state, which would mask a
  // backend failure as "nobody submitted" (the 42804 roster bug, 2026-06-02).
  if (asn.isError || roster.isError) {
    return (
      <PageShell>
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          title="Couldn't load submissions"
          description="Something went wrong fetching this assignment's roster. Please try again."
          reason="error"
          action={{
            label: "Retry",
            icon: <RefreshCw className="h-4 w-4" />,
            onClick: () => {
              void asn.refetch();
              void roster.refetch();
            },
          }}
        />
      </PageShell>
    );
  }

  if (!asn.data) {
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

  const assignment = asn.data;
  const { carries_marks, max_marks, status } = assignment;

  // "View assignment" — opens a read-only sheet with the description +
  // attachment the teacher gave students. Available in both marking views.
  const viewAssignmentAction = {
    label: "View assignment",
    icon: <Eye className="h-4 w-4" />,
    onClick: () => setAssignmentSheetOpen(true),
  };

  // ---- Per-row commit handlers -------------------------------------------

  const setDraft = (subId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [subId]: { ...prev[subId], ...patch } }));

  const commitMark = (row: MarkingRosterRow) => {
    const subId = row.submission_id!;
    const raw = drafts[subId]?.marks ?? "";
    const err = markError(raw, max_marks);
    setErrors((prev) => ({ ...prev, [subId]: err }));
    // CRITICAL GUARD: never produce a 'graded' result from an empty/invalid mark.
    if (err) return;
    upsert.mutate({
      homeworkId: assignment.id,
      submissionId: subId,
      studentId: row.student_id,
      marksAwarded: Number(raw.trim()),
      status: "graded",
    });
  };

  const commitFeedback = (row: MarkingRosterRow) => {
    // Review-only: blur commits 'graded' with the (possibly empty) feedback —
    // acceptable per spec; an empty feedback still counts as processed.
    const subId = row.submission_id!;
    const fb = (drafts[subId]?.feedback ?? "").trim();
    upsert.mutate({
      homeworkId: assignment.id,
      submissionId: subId,
      studentId: row.student_id,
      feedback: fb === "" ? null : fb,
      status: "graded",
    });
  };

  const skipRow = (row: MarkingRosterRow) => {
    const subId = row.submission_id!;
    setErrors((prev) => ({ ...prev, [subId]: null }));
    setDraft(subId, { marks: "", feedback: "" });
    upsert.mutate({
      homeworkId: assignment.id,
      submissionId: subId,
      studentId: row.student_id,
      status: "skipped",
    });
  };

  const pending = submitted.length - processed.length;
  const duePassed = Date.now() > new Date(assignment.due_at).getTime();
  // R4(a): a MARKED assignment can't publish until everyone has submitted OR the
  // due date has passed; R4(b): every submission must be marked. An unmarked
  // ("Mark as Checked") assignment has no gate — it also auto-moves to Checked
  // after the due date via the homework-autocheck cron.
  const awaitingSubmitters = carries_marks && notSubmitted.length > 0 && !duePassed;
  const publishDisabled =
    publish.isPending || (carries_marks && (pending > 0 || awaitingSubmitters));
  const publishLabel = carries_marks ? "Publish Marks" : "Mark as Checked";

  const handlePublishConfirm = () => {
    publish.mutate(assignment.id, { onSuccess: () => setConfirmOpen(false) });
  };

  // Offline-marked assignment: teacher enters the whole roster's marks directly
  // (no online submissions). Separate self-contained flow.
  if (assignment.offline_marks) {
    return (
      <PageShell>
        <PageHeader
          icon={<ClipboardCheck className="h-5 w-5" />}
          title={assignment.title}
          subtitle={subtitleFor(assignment)}
          primaryAction={viewAssignmentAction}
        />
        <OfflineMarkingView assignment={assignment} rows={rows} />
        <AssignmentViewSheet
          open={assignmentSheetOpen}
          onOpenChange={setAssignmentSheetOpen}
          assignment={assignment}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title={assignment.title}
        subtitle={subtitleFor(assignment)}
        primaryAction={viewAssignmentAction}
      />

      {/* Counter */}
      <StatTileGrid cols={2} mdCols={3} className="mb-4">
        <StatTile
          label="Submitted"
          value={`${submitted.length} / ${rows.length}`}
          tone="teal"
        />
        <StatTile label="Marked" value={processed.length} tone="mint" />
        <StatTile label="Pending" value={pending} tone="peach" />
      </StatTileGrid>
      <p className="mb-4 text-[13px] text-ink-500">{counterLine}</p>

      {/* Submitted section */}
      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-ink-900">
          Submitted ({submitted.length})
        </h2>
        {submitted.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" />}
            title="No submissions yet"
            description="Nobody has turned this assignment in."
            reason="noData"
          />
        ) : (
          submitted.map((row) => {
            const subId = row.submission_id!;
            const draft = drafts[subId] ?? { marks: "", feedback: "" };
            const rowError = errors[subId] ?? null;
            return (
              <SubmitterCard
                key={subId}
                row={row}
                draft={draft}
                rowError={rowError}
                carriesMarks={carries_marks}
                maxMarks={max_marks}
                files={fileMap.data?.get(subId) ?? []}
                getUrl={getUrl}
                saving={upsert.isPending}
                onMarksChange={(v) => {
                  setDraft(subId, { marks: v });
                  if (rowError) setErrors((prev) => ({ ...prev, [subId]: null }));
                }}
                onFeedbackChange={(v) => setDraft(subId, { feedback: v })}
                onCommitMark={() => commitMark(row)}
                onCommitFeedback={() => commitFeedback(row)}
                onSkip={() => skipRow(row)}
              />
            );
          })
        )}
      </section>

      {/* Not-submitted section */}
      <section className="mt-6 space-y-3 pb-6">
        <h2 className="text-[16px] font-semibold text-ink-900">
          Not submitted ({notSubmitted.length})
        </h2>
        {notSubmitted.length === 0 ? (
          <p className="text-[13px] text-ink-500">Everyone has submitted.</p>
        ) : (
          <>
            {carries_marks && (
              <p className="text-[12px] text-ink-500">
                Enter marks here for students who submitted offline or after the due date.
              </p>
            )}
            <div className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke">
              {notSubmitted.map((row) => (
                <NotSubmittedRow
                  key={row.student_id}
                  row={row}
                  carriesMarks={carries_marks}
                  maxMarks={max_marks}
                  saving={rosterMarks.isPending}
                  onSave={(studentId, marks) =>
                    rosterMarks.mutate({
                      homeworkId: assignment.id,
                      marks: [{ student_id: studentId, marks_awarded: marks, feedback: null }],
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Sticky footer — `sticky` (not `fixed`) + negative margins keep it inside
          the content column so its frosted background never bleeds over the
          sidebar (the bottom-left white patch). Mirrors HomeworkCreationFlow;
          negatives cancel PageShell's px-4 sm:px-6 lg:px-10 xl:px-14. */}
      <div
        data-sticky-bottom
        className="sticky bottom-0 left-0 right-0 z-20 -mx-4 border-t border-surface-stroke app-bar-frost px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-14 xl:px-14"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-600">{counterLine}</p>
          {status === "checked" ? (
            <div className="text-[13px] text-ink-500 sm:text-right">
              <span className="font-medium text-ink-700">
                Checked
                {assignment.checked_at
                  ? ` on ${format(new Date(assignment.checked_at), "MMM d, yyyy · h:mm a")}`
                  : ""}
              </span>
              <span className="block text-ink-500">Edits save immediately.</span>
            </div>
          ) : (
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={publishDisabled}
                className="h-11 bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98] sm:h-10"
              >
                {publish.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                )}
                {publishLabel}
              </Button>
              {awaitingSubmitters ? (
                <p className="text-[12px] text-ink-500 sm:text-right">
                  {notSubmitted.length} student{notSubmitted.length === 1 ? "" : "s"} haven't
                  submitted. Publish after everyone submits or the due date passes
                </p>
              ) : pending > 0 ? (
                <p className="text-[12px] text-ink-500 sm:text-right">
                  {pending} of {submitted.length} submissions not yet marked
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Dual-confirm publish */}
      <MobileSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={carries_marks ? "Publish marks?" : "Mark as checked?"}
        icon={<Send className="h-4 w-4" />}
        primaryAction={{
          label: "Confirm",
          onClick: handlePublishConfirm,
          loading: publish.isPending,
        }}
        secondaryAction={{ label: "Cancel", onClick: () => setConfirmOpen(false) }}
      >
        <p className="text-[14px] leading-[22px] text-ink-700">
          {carries_marks
            ? "Students will be able to see their marks and feedback immediately. You can still edit afterwards."
            : "Students will be able to see your feedback immediately. You can still edit afterwards."}
        </p>
      </MobileSheet>

      <AssignmentViewSheet
        open={assignmentSheetOpen}
        onOpenChange={setAssignmentSheetOpen}
        assignment={assignment}
      />
    </PageShell>
  );
}

// ===========================================================================

/** Read-only sheet showing the assignment's own content (description +
 *  attachment) so a marker can see what students were asked to do. Self-manages
 *  the attachment download via the homework-file-url edge fn (managers can't
 *  sign the owner-only bucket directly; useHomeworkFileUrl is the sanctioned
 *  one-shot click handler — invariant 3). */
function AssignmentViewSheet({
  open,
  onOpenChange,
  assignment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignment: MarkingAssignment;
}) {
  const attachmentUrl = useHomeworkFileUrl();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await attachmentUrl.mutateAsync({ homework_assignment_id: assignment.id });
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

  const subjectNames =
    assignment.subjects.length > 0
      ? assignment.subjects.map((s) => s.name).join(", ")
      : (assignment.subject?.name ?? "");
  const classNames = assignment.classes
    .map((c) => formatClassName(c.name, c.section))
    .filter(Boolean)
    .join(", ");
  const meta = [subjectNames, classNames].filter(Boolean).join(" · ");

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Assignment details"
      icon={<ClipboardList className="h-4 w-4" />}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-4">
        <div>
          <p className="text-[15px] font-semibold text-ink-900">{assignment.title}</p>
          {meta && <p className="mt-1 text-[13px] text-ink-500">{meta}</p>}
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="eyebrow">Visible from</dt>
            <dd className="mt-0.5 text-[13px] text-ink-800">
              {format(new Date(assignment.visible_from), "MMM d, yyyy · h:mm a")}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Due</dt>
            <dd className="mt-0.5 text-[13px] text-ink-800">
              {format(new Date(assignment.due_at), "MMM d, yyyy · h:mm a")}
            </dd>
          </div>
        </dl>

        <div>
          <p className="eyebrow mb-1">Homework</p>
          {assignment.description ? (
            <p className="whitespace-pre-wrap text-[14px] leading-[22px] text-ink-800">
              {assignment.description}
            </p>
          ) : (
            <p className="text-[13px] text-ink-500">No homework added.</p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-1.5">Attachment</p>
          {assignment.attachment_name ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              disabled={downloading}
              className="w-full justify-start"
            >
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="mr-2 h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
              )}
              <span className="truncate">{assignment.attachment_name}</span>
            </Button>
          ) : (
            <p className="text-[13px] text-ink-500">No attachment.</p>
          )}
        </div>
      </div>
    </MobileSheet>
  );
}

interface SubmitterCardProps {
  row: MarkingRosterRow;
  draft: Draft;
  rowError: string | null;
  carriesMarks: boolean;
  maxMarks: number | null;
  files: SubmissionFileMeta[];
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
  saving: boolean;
  onMarksChange: (v: string) => void;
  onFeedbackChange: (v: string) => void;
  onCommitMark: () => void;
  onCommitFeedback: () => void;
  onSkip: () => void;
}

function SubmitterCard({
  row,
  draft,
  rowError,
  carriesMarks,
  maxMarks,
  files,
  getUrl,
  saving,
  onMarksChange,
  onFeedbackChange,
  onCommitMark,
  onCommitFeedback,
  onSkip,
}: SubmitterCardProps) {
  const handleMarkKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommitMark();
    }
  };

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink-900">
            {row.full_name}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {row.roll_number ? `Roll ${row.roll_number}` : "N/A"}
            {row.submitted_at && (
              <>
                {" · "}
                Submitted {format(new Date(row.submitted_at), "MMM d, yyyy · h:mm a")}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.is_late && (
            <Badge className="border border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300">
              Submitted late
            </Badge>
          )}
          <RowStatus
            status={row.result_status}
            invalid={carriesMarks ? Boolean(rowError) : false}
          />
        </div>
      </div>

      {files.length > 0 ? (
        <SubmissionFileViewer files={files} getUrl={getUrl} />
      ) : (
        <p className="text-[13px] text-ink-500">No files attached.</p>
      )}

      {carriesMarks ? (
        <div className="space-y-1">
          <label className="eyebrow block">
            Marks{maxMarks != null ? ` / ${maxMarks}` : ""}
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={maxMarks ?? undefined}
              step={0.5}
              inputMode="decimal"
              value={draft.marks}
              onChange={(e) => onMarksChange(e.target.value)}
              onBlur={onCommitMark}
              onKeyDown={handleMarkKeyDown}
              aria-invalid={Boolean(rowError)}
              className={cn(
                "h-11 w-32 sm:h-10",
                rowError && "border-destructive focus-visible:ring-destructive",
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSkip}
              disabled={saving}
              className="text-ink-600"
            >
              <SkipForward className="mr-1.5 h-4 w-4" aria-hidden />
              Skip
            </Button>
          </div>
          {rowError && (
            <p className="text-[12px] text-rose-600 dark:text-rose-400">{rowError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="eyebrow block">Feedback</label>
          <Textarea
            value={draft.feedback}
            onChange={(e) => onFeedbackChange(e.target.value)}
            onBlur={onCommitFeedback}
            placeholder="Write feedback for this student…"
            className="min-h-[88px]"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onCommitFeedback}
              disabled={saving}
              className="bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
              Mark reviewed
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSkip}
              disabled={saving}
              className="text-ink-600"
            >
              <SkipForward className="mr-1.5 h-4 w-4" aria-hidden />
              Skip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RowStatus({
  status,
  invalid,
}: {
  status: MarkingRosterRow["result_status"];
  invalid: boolean;
}) {
  if (invalid) {
    return <span className="text-xs font-medium text-destructive">Over max</span>;
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-400/10 px-2 py-0.5 text-xs font-medium text-ink-600">
        Skipped
      </span>
    );
  }
  if (status === "graded") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
      </span>
    );
  }
  return <span className="text-xs text-ink-500">Pending</span>;
}

// ===========================================================================
// Offline-marked assignment: enter the whole roster's marks, then Submit marks
// (warns about any students left blank), which records + publishes in one go.

function OfflineMarkingView({
  assignment,
  rows,
}: {
  assignment: MarkingAssignment;
  rows: MarkingRosterRow[];
}) {
  const roster = useUpsertRosterMarks();
  const publish = usePublishHomeworkMarks();
  const max = assignment.max_marks;

  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const r of rows) seed[r.student_id] = r.marks_awarded != null ? String(r.marks_awarded) : "";
    return seed;
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Seed any newly-appeared students (e.g. after a refetch) without clobbering edits.
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.student_id] === undefined) {
          next[r.student_id] = r.marks_awarded != null ? String(r.marks_awarded) : "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const setDraft = (sid: string, v: string) => {
    setDrafts((p) => ({ ...p, [sid]: v }));
    setErrors((p) => (p[sid] ? { ...p, [sid]: null } : p));
  };

  const enteredCount = rows.filter((r) => (drafts[r.student_id] ?? "").trim() !== "").length;
  const missingCount = rows.length - enteredCount;
  const saving = roster.isPending || publish.isPending;

  const validateAll = (): boolean => {
    const next: Record<string, string | null> = {};
    let ok = true;
    for (const r of rows) {
      const raw = (drafts[r.student_id] ?? "").trim();
      if (raw === "") continue; // blank allowed (counts as missed)
      const err = markError(raw, max);
      next[r.student_id] = err;
      if (err) ok = false;
    }
    setErrors(next);
    return ok;
  };

  const buildMarks = (): RosterMarkInput[] =>
    rows
      .map((r) => ({ student_id: r.student_id, raw: (drafts[r.student_id] ?? "").trim() }))
      .filter((x) => x.raw !== "")
      .map((x) => ({ student_id: x.student_id, marks_awarded: Number(x.raw), feedback: null }));

  const doSubmit = async () => {
    await roster.mutateAsync({ homeworkId: assignment.id, marks: buildMarks() });
    await publish.mutateAsync(assignment.id);
    setConfirmOpen(false);
  };

  const onSubmitClick = () => {
    if (!validateAll()) return;
    if (missingCount > 0) setConfirmOpen(true);
    else void doSubmit();
  };

  return (
    <>
      <StatTileGrid cols={3} mdCols={3} className="mb-4">
        <StatTile label="Students" value={rows.length} tone="teal" />
        <StatTile label="Marks entered" value={enteredCount} tone="mint" />
        <StatTile label="Blank" value={missingCount} tone="peach" />
      </StatTileGrid>

      <div className="mb-3 flex items-start gap-2 rounded-lg border border-surface-stroke bg-muted/40 px-3 py-2.5 text-[13px] text-ink-600">
        <UploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
        <span>
          Offline assignment. Enter each student's marks
          {max != null ? ` (out of ${max})` : ""}, then Submit marks.
          {assignment.status === "checked" && " Marks are already published; edits save on submit."}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="No students"
          description="No students are assigned to this assignment's classes."
          reason="noData"
        />
      ) : (
        <div className="surface-card frosted-shadow rounded-card divide-y divide-surface-stroke pb-2 mb-6">
          {rows.map((r) => {
            const err = errors[r.student_id] ?? null;
            return (
              <div key={r.student_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-ink-900">{r.full_name}</p>
                  <p className="text-[12px] text-ink-500">
                    {r.roll_number ? `Roll ${r.roll_number}` : "N/A"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Input
                    type="number"
                    min={0}
                    max={max ?? undefined}
                    step={0.5}
                    inputMode="decimal"
                    value={drafts[r.student_id] ?? ""}
                    onChange={(e) => setDraft(r.student_id, e.target.value)}
                    aria-invalid={Boolean(err)}
                    className={cn(
                      "h-10 w-24",
                      err && "border-destructive focus-visible:ring-destructive",
                    )}
                    placeholder={max != null ? `/ ${max}` : "Marks"}
                  />
                  {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        data-sticky-bottom
        className="sticky bottom-0 left-0 right-0 z-20 -mx-4 border-t border-surface-stroke app-bar-frost px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-14 xl:px-14"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-600">
            {enteredCount} of {rows.length} marked{missingCount > 0 ? ` · ${missingCount} blank` : ""}
          </p>
          <Button
            onClick={onSubmitClick}
            disabled={saving || rows.length === 0}
            className="h-11 bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98] sm:h-10"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="mr-2 h-4 w-4" aria-hidden />
            )}
            Submit marks
          </Button>
        </div>
      </div>

      <MobileSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit marks?"
        icon={<Send className="h-4 w-4" />}
        primaryAction={{ label: "Submit anyway", onClick: () => void doSubmit(), loading: saving }}
        secondaryAction={{ label: "Go back", onClick: () => setConfirmOpen(false) }}
      >
        <p className="text-[14px] leading-[22px] text-ink-700">
          You missed {missingCount} student{missingCount === 1 ? "" : "s"}. Are you sure you want
          to submit? You can still add their marks later from the Checked tab.
        </p>
      </MobileSheet>
    </>
  );
}

// A not-submitted student in an online assignment: lets the teacher enter marks
// for an offline/late acceptance (R6). Commits on blur via the roster-marks RPC.
function NotSubmittedRow({
  row,
  carriesMarks,
  maxMarks,
  saving,
  onSave,
}: {
  row: MarkingRosterRow;
  carriesMarks: boolean;
  maxMarks: number | null;
  saving: boolean;
  onSave: (studentId: string, marks: number) => void;
}) {
  const [val, setVal] = useState(row.marks_awarded != null ? String(row.marks_awarded) : "");
  const [err, setErr] = useState<string | null>(null);

  const commit = () => {
    const raw = val.trim();
    if (raw === "") return; // nothing entered → nothing to save
    const e = markError(raw, maxMarks);
    setErr(e);
    if (e) return;
    onSave(row.student_id, Number(raw));
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink-800">{row.full_name}</p>
        <p className="text-[12px] text-ink-500">
          {row.roll_number ? `Roll ${row.roll_number}` : "N/A"}
        </p>
      </div>
      {carriesMarks ? (
        <div className="flex shrink-0 items-center gap-2">
          {row.result_status === "graded" && row.marks_awarded != null && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
            </span>
          )}
          <div className="text-right">
            <Input
              type="number"
              min={0}
              max={maxMarks ?? undefined}
              step={0.5}
              inputMode="decimal"
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                if (err) setErr(null);
              }}
              onBlur={commit}
              disabled={saving}
              aria-invalid={Boolean(err)}
              className={cn(
                "h-10 w-24",
                err && "border-destructive focus-visible:ring-destructive",
              )}
              placeholder={maxMarks != null ? `/ ${maxMarks}` : "Marks"}
            />
            {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
          </div>
        </div>
      ) : (
        <span className="shrink-0 text-[13px] text-ink-500">
          {row.roll_number ? `Roll ${row.roll_number}` : "N/A"}
        </span>
      )}
    </div>
  );
}

function MarkingSkeleton() {
  return (
    <PageShell>
      <div className="py-4 sm:py-6 lg:py-8 space-y-3">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/2 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 mb-4">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-28 rounded-card" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </PageShell>
  );
}
