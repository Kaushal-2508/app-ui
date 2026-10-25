import { useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import {
  useOfflineMarks,
  useSaveDraftOfflineMarks,
  usePublishAllOfflineMarks,
  useUpdateOfflineMark,
  isMarkRowDecided,
  type OfflineMarkRow,
} from "@/hooks/useOfflineMarks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Save, Send, UserX } from "lucide-react";
import { cn, formatClassName } from "@/lib/utils";
import { toast } from "sonner";

interface OfflineMarksEntryProps {
  examId: string;
}

type LocalRow = OfflineMarkRow & {
  dirty: boolean;
  invalid: boolean;
};

function parseMark(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return null;
  return n;
}

function toInputValue(v: number | null): string {
  return v == null ? "" : String(v);
}

export function OfflineMarksEntry({ examId }: OfflineMarksEntryProps) {
  const { data, isLoading, error } = useOfflineMarks(examId);
  const saveDraft = useSaveDraftOfflineMarks(examId);
  const publishAll = usePublishAllOfflineMarks(examId);
  const updateMark = useUpdateOfflineMark(examId);

  const [rows, setRows] = useState<LocalRow[]>([]);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (data) {
      setRows(
        data.rows.map((r) => ({ ...r, dirty: false, invalid: false }))
      );
    }
  }, [data]);

  const totalMax = data?.exam.totalMarks ?? 0;

  const summary = useMemo(() => {
    const total = rows.length;
    const filled = rows.filter((r) => !r.isAbsent && r.marksObtained != null).length;
    const absent = rows.filter((r) => r.isAbsent).length;
    // "Blank" now means genuinely undecided: no mark AND not marked absent.
    const blank = total - filled - absent;
    return { total, filled, absent, blank, decided: filled + absent };
  }, [rows]);

  // Roll numbers live on profiles.roll_number (single value per user) and can
  // collide when two students in the same section accidentally carry the same
  // value. Flag those rows so an admin can spot + fix the bad profile.
  const duplicateRollKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.rollNumber) continue;
      const key = `${r.classId}::${r.rollNumber}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dups = new Set<string>();
    counts.forEach((count, key) => {
      if (count > 1) dups.add(key);
    });
    return dups;
  }, [rows]);

  const isDuplicateRoll = (row: LocalRow) =>
    !!row.rollNumber &&
    duplicateRollKeys.has(`${row.classId}::${row.rollNumber}`);

  const anyPublished = rows.some((r) => r.isPublished);
  const decidedRows = rows.filter(isMarkRowDecided);
  const allPublished =
    decidedRows.length > 0 && decidedRows.every((r) => r.isPublished);

  const updateRow = (studentId: string, patch: Partial<LocalRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r))
    );
  };

  const handleChange = (studentId: string, raw: string) => {
    const parsed = parseMark(raw);
    const invalid = parsed != null && (parsed < 0 || parsed > totalMax);
    updateRow(studentId, {
      marksObtained: parsed,
      dirty: true,
      invalid,
    });
  };

  const commitRow = (row: LocalRow) => {
    if (row.invalid) return;
    if (!row.dirty) return;
    // Correcting a LIVE mark writes through to final_results at once, or the
    // student keeps seeing the old number. A student not yet published is only
    // drafted here: publishing someone for the first time stays behind the
    // Update button's confirm (work-queue Task 6; the old `anyPublished` test
    // published them on blur, without the confirm).
    if (row.isPublished && isMarkRowDecided(row)) {
      updateMark.mutate(
        { row, totalMax, passMarks: data?.exam.passMarks ?? null },
        {
          onSuccess: () => updateRow(row.studentId, { dirty: false, isPublished: true }),
        }
      );
      return;
    }
    if (!isMarkRowDecided(row)) {
      updateRow(row.studentId, { dirty: false });
      return;
    }
    saveDraft.mutate(
      [{ ...row }],
      {
        onSuccess: () => updateRow(row.studentId, { dirty: false }),
      }
    );
  };

  /**
   * Absent and a mark are mutually exclusive (the DB enforces it), so toggling
   * absent on clears any typed mark. Toggling it back off leaves the field
   * empty rather than resurrecting the old value — the teacher should retype it
   * deliberately. Commits immediately so the decision is never left unsaved.
   */
  const toggleAbsent = (row: LocalRow) => {
    const nextAbsent = !row.isAbsent;
    const next: LocalRow = {
      ...row,
      isAbsent: nextAbsent,
      marksObtained: nextAbsent ? null : row.marksObtained,
      invalid: false,
      dirty: true,
    };
    updateRow(row.studentId, next);

    // Same rule as commitRow: only a live mark writes through on its own.
    if (next.isPublished && isMarkRowDecided(next)) {
      updateMark.mutate(
        { row: next, totalMax, passMarks: data?.exam.passMarks ?? null },
        { onSuccess: () => updateRow(row.studentId, { dirty: false, isPublished: true }) },
      );
      return;
    }
    if (!isMarkRowDecided(next)) return; // cleared back to undecided; nothing to save
    saveDraft.mutate([next], {
      onSuccess: () => updateRow(row.studentId, { dirty: false }),
    });
  };

  const focusNext = (index: number) => {
    const next = inputRefs.current[index + 1];
    if (next) next.focus();
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    row: LocalRow,
    index: number
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRow(row);
      focusNext(index);
    }
  };

  const handleSaveDraft = () => {
    const invalidRow = rows.find((r) => r.invalid);
    if (invalidRow) return;
    saveDraft.mutate(rows, {
      onSuccess: () => {
        setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      },
    });
  };

  // Synchronous single-flight for Publish / Update (Task 6). `isPending` alone
  // leaves a render-cycle gap: the second tap of a double tap lands before
  // React has disabled the button, and the same rows go out twice.
  const sendInFlight = useRef(false);

  const handlePublishAll = () => {
    if (!confirmingPublish) {
      setConfirmingPublish(true);
      return;
    }
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    publishAll.mutate(
      { rows, totalMax, passMarks: data?.exam.passMarks ?? null, intent: "publish" },
      {
        onSuccess: () => {
          setConfirmingPublish(false);
          setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
        },
        onError: () => setConfirmingPublish(false),
        onSettled: () => {
          sendInFlight.current = false;
        },
      }
    );
  };

  // Once results are live, every save must reach final_results, or students
  // keep seeing the old number. "Save Draft" only wrote the draft table, so
  // on a published exam it is replaced by Update, which is the same
  // write-through as publishing (and also publishes any newly entered rows).
  // Only the rows the teacher changed, plus any decided row that is not live
  // yet: since Task 6 a blur only DRAFTS a new student, so Update must pick
  // them up even once that draft has landed and the row is no longer dirty.
  // Never the whole class: re-publishing everyone to correct one mark would
  // rewrite every student's final_results row.
  const dirtyDecidedRows = rows.filter((r) => isMarkRowDecided(r) && (r.dirty || !r.isPublished));
  // Rows Update would make visible for the FIRST time. Correcting a live mark
  // needs no ceremony; publishing someone new does, so those get the same
  // two-tap confirm as Publish All.
  const newlyPublishingCount = dirtyDecidedRows.filter((r) => !r.isPublished).length;
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);

  const handleUpdateAll = () => {
    if (rows.some((r) => r.invalid)) return;
    // A published row whose mark was cleared cannot be "updated" to nothing:
    // the publish write-through only takes decided rows, so it would be
    // skipped silently while the student keeps seeing the old mark. Say so.
    const clearedPublished = rows.filter(
      (r) => r.dirty && r.isPublished && !isMarkRowDecided(r),
    );
    if (clearedPublished.length > 0) {
      toast.error(
        `${clearedPublished.length} published student(s) have a cleared mark. Enter a mark or mark them absent, then update.`,
      );
      return;
    }
    if (dirtyDecidedRows.length === 0) return;
    if (newlyPublishingCount > 0 && !confirmingUpdate) {
      setConfirmingUpdate(true);
      return;
    }
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    const ids = new Set(dirtyDecidedRows.map((r) => r.studentId));
    publishAll.mutate(
      { rows: dirtyDecidedRows, totalMax, passMarks: data?.exam.passMarks ?? null, intent: "update" },
      {
        onSuccess: () => {
          setConfirmingUpdate(false);
          setRows((prev) =>
            prev.map((r) => (ids.has(r.studentId) ? { ...r, dirty: false, isPublished: true } : r)),
          );
        },
        onError: () => setConfirmingUpdate(false),
        onSettled: () => {
          sendInFlight.current = false;
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error)?.message ?? "Failed to load exam"}
        </div>
      </div>
    );
  }

  // validate_attempt_creation refuses an attempt on a draft or archived exam,
  // and publishing marks is what creates the attempt. Saving still works: it
  // only writes offline_student_marks. That asymmetry is why 14 exams in prod
  // hold marks with no results at all - the teacher saved, hit Publish, got
  // "This exam isn't open for attempts" and had no idea what to do next.
  const examNotPublishable =
    data.exam.status === "draft" || data.exam.status === "archived";

  const classLabels = data.exam.classes
    .map((c) => formatClassName(c.name, c.section))
    .filter(Boolean);
  const allClassLabel = classLabels.length > 0
    ? classLabels.join(", ")
    : formatClassName(data.exam.className ?? "", data.exam.classSection ?? null);

  return (
    <div className="flex flex-col flex-1 h-full relative overflow-hidden">
      {/* Header — desktop */}
      <div className="hidden md:block border-b bg-background p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-xl font-semibold truncate">{data.exam.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {allClassLabel && <span>{allClassLabel}</span>}
              {data.exam.subjectName && (
                <>
                  <span>·</span>
                  <span>{data.exam.subjectName}</span>
                </>
              )}
              <span>·</span>
              <span>Max marks: {totalMax}</span>
              <span>·</span>
              <span>{summary.total} students</span>
            </div>
          </div>
          {allPublished ? (
            <Badge className="bg-green-500 hover:bg-green-500">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Published
            </Badge>
          ) : anyPublished ? (
            <Badge variant="outline" className="border-[#fa920e] text-[#fa920e]">
              Partially Published
            </Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
        </div>
      </div>

      {/* Header — mobile */}
      <div className="md:hidden sticky top-0 z-10 border-b bg-background p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate">{data.exam.title}</h2>
            <div className="text-xs text-muted-foreground mt-0.5">
              {summary.decided} / {summary.total} done
              {summary.absent > 0 && ` · ${summary.absent} absent`} · Max {totalMax}
            </div>
          </div>
          {allPublished ? (
            <Badge className="bg-green-500 hover:bg-green-500 text-[10px]">
              Published
            </Badge>
          ) : anyPublished ? (
            <Badge variant="outline" className="text-[10px] border-[#fa920e] text-[#fa920e]">
              Partial
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Draft</Badge>
          )}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto pb-24">
        <table className="w-full">
          <thead className="sticky top-0 bg-muted z-10 text-sm text-muted-foreground shadow-sm">
            <tr>
              <th className="w-12 px-4 py-3 text-left font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">Student Name</th>
              <th className="w-28 px-4 py-3 text-left font-medium">Roll No</th>
              <th className="w-32 px-4 py-3 text-left font-medium">Admission No</th>
              <th className="w-48 px-4 py-3 text-left font-medium">
                Marks / {totalMax}
              </th>
              <th className="w-32 px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const elements: JSX.Element[] = [];
              let prevClassId: string | null = null;
              let sectionPos = 0;
              rows.forEach((row, index) => {
                const saved = !row.dirty && isMarkRowDecided(row) && !row.invalid;
                if (row.classId !== prevClassId) {
                  const sectionLabel = formatClassName(
                    row.className ?? "",
                    row.classSection ?? null
                  );
                  const sectionCount = rows.filter(
                    (r) => r.classId === row.classId
                  ).length;
                  elements.push(
                    <tr
                      key={`section-${row.classId}`}
                      className="bg-muted/60 border-t border-b"
                    >
                      <td
                        colSpan={6}
                        className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground"
                      >
                        {sectionLabel || "N/A"}{" "}
                        <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                          · {sectionCount} student{sectionCount === 1 ? "" : "s"}
                        </span>
                      </td>
                    </tr>
                  );
                  prevClassId = row.classId;
                  sectionPos = 0;
                }
                sectionPos += 1;
                elements.push(
                  <tr
                    key={row.studentId}
                    className={cn(
                      "border-b hover:bg-muted/30",
                      row.isAbsent && "bg-destructive/5",
                    )}
                  >
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {sectionPos}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium truncate">
                      {row.fullName}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {row.rollNumber ?? "N/A"}
                        {isDuplicateRoll(row) && (
                          <span
                            title="Duplicate roll number in this section. Update one student's profile to fix"
                            className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                          >
                            <AlertCircle className="h-3 w-3" />
                            DUPLICATE
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {row.admissionNumber ?? "N/A"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Input
                          ref={(el) => (inputRefs.current[index] = el)}
                          type="number"
                          min={0}
                          max={totalMax}
                          step={0.5}
                          inputMode="decimal"
                          disabled={row.isAbsent}
                          value={row.isAbsent ? "" : toInputValue(row.marksObtained)}
                          onChange={(e) => handleChange(row.studentId, e.target.value)}
                          onBlur={() => commitRow(row)}
                          onKeyDown={(e) => handleKeyDown(e, row, index)}
                          className={cn(
                            "h-10 w-28 transition-colors duration-200",
                            row.invalid && "border-destructive focus-visible:ring-destructive",
                            saved && !row.invalid && "border-green-500"
                          )}
                          placeholder={row.isAbsent ? "Absent" : undefined}
                          aria-invalid={row.invalid}
                        />
                        <AbsentToggle row={row} onToggle={() => toggleAbsent(row)} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RowStatus row={row} />
                    </td>
                  </tr>
                );
              });
              return elements;
            })()}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No students enrolled in this exam's class yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden flex-1 overflow-auto space-y-3 p-4 pb-28">
        {(() => {
          const elements: JSX.Element[] = [];
          let prevClassId: string | null = null;
          rows.forEach((row, index) => {
            const saved = !row.dirty && isMarkRowDecided(row) && !row.invalid;
            if (row.classId !== prevClassId) {
              const sectionLabel = formatClassName(
                row.className ?? "",
                row.classSection ?? null
              );
              const sectionCount = rows.filter((r) => r.classId === row.classId).length;
              elements.push(
                <div
                  key={`section-${row.classId}`}
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-2"
                >
                  {sectionLabel || "N/A"}{" "}
                  <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">
                    · {sectionCount} student{sectionCount === 1 ? "" : "s"}
                  </span>
                </div>
              );
              prevClassId = row.classId;
            }
            elements.push(
              <div
                key={row.studentId}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-sm",
                  row.isAbsent && "border-destructive/40 bg-destructive/5",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {row.fullName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5">
                      Roll {row.rollNumber ?? "N/A"}
                      <span className="text-muted-foreground/70">
                        · Adm {row.admissionNumber ?? "N/A"}
                      </span>
                      {isDuplicateRoll(row) && (
                        <span
                          title="Duplicate roll number in this section. Update one student's profile to fix"
                          className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                        >
                          <AlertCircle className="h-3 w-3" />
                          DUPLICATE
                        </span>
                      )}
                    </div>
                  </div>
                  <RowStatus row={row} />
                </div>
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    Marks / {totalMax}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      ref={(el) => (inputRefs.current[index] = el)}
                      type="number"
                      min={0}
                      max={totalMax}
                      step={0.5}
                      inputMode="decimal"
                      enterKeyHint="next"
                      disabled={row.isAbsent}
                      value={row.isAbsent ? "" : toInputValue(row.marksObtained)}
                      onChange={(e) => handleChange(row.studentId, e.target.value)}
                      onBlur={() => commitRow(row)}
                      onKeyDown={(e) => handleKeyDown(e, row, index)}
                      className={cn(
                        "h-12 flex-1 text-base transition-colors duration-200",
                        row.invalid && "border-destructive focus-visible:ring-destructive",
                        saved && !row.invalid && "border-green-500"
                      )}
                      placeholder={row.isAbsent ? "Absent" : "Enter marks"}
                      aria-invalid={row.invalid}
                    />
                    <AbsentToggle row={row} onToggle={() => toggleAbsent(row)} />
                  </div>
                </div>
              </div>
            );
          });
          return elements;
        })()}
        {rows.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12">
            No students enrolled in this exam's class yet.
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="fixed md:absolute bottom-0 left-0 right-0 z-20 border-t bg-background p-3 md:p-4">
        {/* Publishing silently skips anyone with no mark and no absent flag.
            The teacher had no way to know that: the button said "Confirm
            publish 37?" while 14 students were quietly left behind, and those
            14 stay invisible to their families with nothing on screen saying
            so. Named here, on the confirm step, where it is unmissable. */}
        {examNotPublishable && (
          <div className="mb-3 rounded-lg border border-[#fa920e]/40 bg-[#fa920e]/10 p-3">
            <p className="text-xs font-medium text-foreground md:text-sm">
              {data.exam.status === "draft"
                ? "This exam is still a draft, so results can't be published yet."
                : "This exam is archived, so results can't be published."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Marks you enter here are saved and kept. To release them, open the
              exam, publish it, then come back and press Publish.
            </p>
          </div>
        )}
        {confirmingPublish && summary.blank > 0 && (
          <div className="mb-3 rounded-lg border border-[#fa920e]/40 bg-[#fa920e]/10 p-3">
            <p className="text-xs md:text-sm font-medium text-foreground">
              {summary.blank === 1
                ? "1 student has nothing entered and will not be published."
                : `${summary.blank} students have nothing entered and will not be published.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter a mark or tap Abs for them first, or publish the{" "}
              {summary.decided} you have and come back to the rest later.
            </p>
          </div>
        )}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-xs md:text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {summary.total}
            </span>{" "}
            students ·{" "}
            <span className="font-medium text-foreground">
              {summary.filled}
            </span>{" "}
            marked ·{" "}
            <span className="font-medium text-destructive">{summary.absent}</span>{" "}
            absent ·{" "}
            <span className="font-medium text-foreground">{summary.blank}</span>{" "}
            not entered
          </div>
          {/* Wraps on a phone: the "Confirm publish N new?" label does not fit
              beside Save Draft at 375px, so it drops to its own full-width row. */}
          <div className="flex flex-wrap gap-2">
            {/* Save Draft stays while anyone is still unpublished: provisional
                marks for them must be savable without going live. Once every
                student is published there is nothing to draft. */}
            {!allPublished && (
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={saveDraft.isPending || rows.some((r) => r.invalid)}
                className="flex-auto md:flex-none h-11 md:h-10"
              >
                {saveDraft.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Draft
              </Button>
            )}
            {allPublished && (
              <Button
                variant="secondary"
                disabled
                className="flex-auto md:flex-none h-11 md:h-10"
              >
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                Published
                <Pencil className="h-3 w-3 ml-2 text-muted-foreground" />
              </Button>
            )}
            {anyPublished ? (
              <Button
                onClick={handleUpdateAll}
                disabled={
                  publishAll.isPending ||
                  // A blur save still in flight for one row must finish before
                  // Update re-sends it (Task 6).
                  updateMark.isPending ||
                  saveDraft.isPending ||
                  examNotPublishable ||
                  dirtyDecidedRows.length === 0 ||
                  rows.some((r) => r.invalid)
                }
                className={cn(
                  // flex-auto, not flex-1: with a zero basis the long "Confirm
                  // publish N new?" label overflowed its half of a 375px row.
                  "flex-auto md:flex-none h-11 md:h-10",
                  confirmingUpdate && "bg-[#fa920e] hover:bg-[#fa920e]/90"
                )}
              >
                {publishAll.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {confirmingUpdate
                  ? `Confirm publish ${newlyPublishingCount} new?`
                  : "Update"}
              </Button>
            ) : (
              <Button
                onClick={handlePublishAll}
                disabled={
                  publishAll.isPending ||
                  examNotPublishable ||
                  summary.decided === 0 ||
                  rows.some((r) => r.invalid)
                }
                className={cn(
                  "flex-auto md:flex-none h-11 md:h-10",
                  confirmingPublish && "bg-[#fa920e] hover:bg-[#fa920e]/90"
                )}
              >
                {publishAll.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {confirmingPublish
                  ? summary.blank > 0
                    ? `Publish ${summary.decided}, skip ${summary.blank}?`
                    : `Confirm publish ${summary.decided}?`
                  : "Publish All"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Marks a student absent. Deliberately a toggle rather than a value typed into
 * the marks box: absence is a different kind of fact from a score, and the two
 * are mutually exclusive in the database.
 */
function AbsentToggle({ row, onToggle }: { row: LocalRow; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={row.isAbsent ? "destructive" : "outline"}
      onClick={onToggle}
      aria-pressed={row.isAbsent}
      title={row.isAbsent ? "Marked absent - click to undo" : "Mark this student absent"}
      className="h-10 shrink-0 px-2.5"
    >
      <UserX className="h-4 w-4 md:mr-1.5" />
      <span className="hidden md:inline">{row.isAbsent ? "Absent" : "Absent"}</span>
    </Button>
  );
}

function RowStatus({ row }: { row: LocalRow & { dirty: boolean; invalid: boolean } }) {
  if (row.invalid) {
    return (
      <span className="text-xs font-medium text-destructive">Over max</span>
    );
  }
  if (row.dirty) {
    return (
      <span className="text-xs font-medium text-[#fa920e]">Unsaved</span>
    );
  }
  if (row.isAbsent) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <UserX className="h-3 w-3" />
        {row.isPublished ? "Absent · published" : "Absent"}
      </span>
    );
  }
  if (row.marksObtained == null) {
    return <span className="text-xs text-muted-foreground">Not entered</span>;
  }
  if (row.isPublished) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle2 className="h-3 w-3" /> Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3 w-3" /> Saved
    </span>
  );
}
