import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Loader2,
  Flag,
  AlertTriangle,
  CheckCircle2,
  Save,
  Send,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AnimatedContainer } from "@/components/ui/animated-container";
import { toast } from "sonner";
import {
  useOfflineMarksEntry,
  useSaveOfflineMarks,
  useFlagForRecheck,
  type OfflineMarksStudentRow,
} from "@/hooks/useOfflineMarksEntry";

interface OfflineMarksEntryScreenProps {
  examId: string;
}

export function OfflineMarksEntryScreen({
  examId,
}: OfflineMarksEntryScreenProps) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useOfflineMarksEntry(examId);
  const save = useSaveOfflineMarks();
  const flagRecheck = useFlagForRecheck();

  const [rows, setRows] = useState<OfflineMarksStudentRow[]>([]);

  const [recheckRow, setRecheckRow] = useState<OfflineMarksStudentRow | null>(
    null
  );
  const [recheckReason, setRecheckReason] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  // Published marks stay editable for everyone who can reach this screen.
  // This used to lock teachers out, mirroring a final_results policy
  // ("Teachers can update unpublished results") that was replaced on
  // 2026-08-25 by "Teachers can update results for assigned classes"; the
  // offline_section_marks teacher policy never had a publish clause either.
  // Corrections after publish are a normal part of offline marking (a
  // mis-keyed total, a recheck), so the server permits them and the UI now
  // matches. The overwrite confirmation below is what keeps it deliberate.

  // Hydrate local rows when data arrives
  useEffect(() => {
    if (data) setRows(data.students);
  }, [data]);







  // Stable identity: summary useMemo depends on it, and a fresh [] each
  // render would recompute the counts on every keystroke.
  const sections = useMemo(() => data?.sections ?? [], [data]);
  const totalMax = sections.reduce((sum, s) => sum + s.totalMarks, 0);
  // A single-section paper is just "marks out of max", which is what the
  // sibling screen shows. Only a genuinely multi-section paper needs a
  // column per section. 910 of 1,056 offline exams have exactly one.
  const multiSection = sections.length > 1;

  const updateRow = (
    studentId: string,
    patch: Partial<OfflineMarksStudentRow>
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r))
    );
  };

  const updateSectionMark = (
    studentId: string,
    sectionId: string,
    value: number
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              sectionMarks: { ...r.sectionMarks, [sectionId]: value },
              isAbsent: false,
            }
          : r
      )
    );
  };

  const updateTotalMark = (studentId: string, value: number) => {
    // In "total" mode, we allocate to section[0] for storage purposes, but
    // the display uses the same aggregate.
    const first = sections[0];
    if (!first) return;
    setRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              sectionMarks: { [first.id]: value },
              isAbsent: false,
            }
          : r
      )
    );
  };

  // Absent and a mark are mutually exclusive, so marking absent clears any
  // entered section marks. Toggling back leaves the fields empty rather than
  // resurrecting the old numbers: the teacher should retype them deliberately.
  const toggleAbsent = (r: OfflineMarksStudentRow) => {
    updateRow(r.studentId, {
      isAbsent: !r.isAbsent,
      sectionMarks: r.isAbsent ? r.sectionMarks : {},
    });
  };

  const rowTotal = (r: OfflineMarksStudentRow): number =>
    sections.reduce(
      (sum, sec) => sum + Number(r.sectionMarks[sec.id] ?? 0),
      0
    );

  const rowHasError = (r: OfflineMarksStudentRow): boolean => {
    if (r.isAbsent) return false;
    return sections.some(
      (sec) => Number(r.sectionMarks[sec.id] ?? 0) > sec.totalMarks
    );
  };

  const anyError = rows.some(rowHasError);

  const publishedCount = rows.filter((r) => r.isPublished).length;

  // The same four numbers, in the same order, as the sibling offline screen
  // (src/components/exam/OfflineMarksEntry.tsx). "Entered" means at least one
  // section carries a value; a student nobody has touched has an empty
  // sectionMarks map, which is what separates "not entered" from a real zero.
  const summary = useMemo(() => {
    const total = rows.length;
    const absent = rows.filter((r) => r.isAbsent).length;
    const filled = rows.filter(
      (r) => !r.isAbsent && sections.some((s) => r.sectionMarks[s.id] != null),
    ).length;
    return { total, filled, absent, blank: total - filled - absent };
  }, [rows, sections]);

  const anyPublished = publishedCount > 0;

  // validate_attempt_creation refuses an attempt on a draft or archived exam.
  // This pipeline keys offline_section_marks on attempt_id, so it has to create
  // an attempt even for a draft save: unlike the per-student screen, NOTHING
  // saves here while the exam is a draft. Both buttons go down, and the banner
  // says so rather than letting the teacher type a whole class into nothing.
  //
  // Optional on `data`: this runs at hook level, ABOVE the isLoading / !data
  // returns, so on the first render `data` is still undefined. Reading it
  // bare threw "undefined is not an object (evaluating 's.exam')" into the
  // error boundary every time an offline exam was opened in the app
  // (Naman, 2026-09-24). False while loading is the right answer anyway.
  const examNotPublishable =
    data?.exam.status === "draft" || data?.exam.status === "archived";
  const allPublished = rows.length > 0 && rows.every((r) => r.isPublished);

  // "Class 12 Humanities - A" style label for the header line.
  const allClassLabel = useMemo(() => {
    const names = Array.from(
      new Set(rows.map((r) => r.className).filter((n): n is string => !!n)),
    );
    return names.join(", ");
  }, [rows]);

  // Publishing is a deliberate second tap, exactly as the sibling screen does
  // it, and the confirm names anyone who would be silently left behind.
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  // Any edit cancels an armed confirm. The numbers it promised are stale the
  // moment a mark changes, so the teacher gets the prompt again.
  useEffect(() => {
    setConfirmingPublish(false);
  }, [rows]);

  // A published row is re-written only if the teacher actually changed it.
  // Every save used to re-upsert the whole class (2-3 sequential writes per
  // student) and bump finalized_at on results nobody touched; on a 45-student
  // exam that is ~100 requests to correct one total. Unpublished rows keep the
  // existing behaviour (saved as entered, blank = 0) so nothing else moves.
  const isRowChanged = (r: OfflineMarksStudentRow): boolean => {
    const original = data?.students.find((s) => s.studentId === r.studentId);
    if (!original) return true;
    if (original.isAbsent !== r.isAbsent) return true;
    const ids = new Set([...Object.keys(original.sectionMarks), ...Object.keys(r.sectionMarks)]);
    for (const id of ids) {
      if (Number(original.sectionMarks[id] ?? 0) !== Number(r.sectionMarks[id] ?? 0)) return true;
    }
    return false;
  };
  const rowsToSave = rows.filter((r) => !r.isPublished || isRowChanged(r));
  const changedPublishedCount = rowsToSave.filter((r) => r.isPublished).length;

  const runSave = (publish: boolean) => {
    if (!data) return;
    save.mutate({
      examId,
      students: rowsToSave,
      sections: data.sections,
      passMarks: data.exam.passMarks,
      // An exam set to release immediately still publishes on any save; that
      // is the exam's own setting, not this button's choice.
      publishResults:
        publish || data.exam.resultVisibility === "immediate",
    });
    // The mutation toasts on success (with the skipped count) - a second toast
    // here would duplicate it.
  };

  // Whether the save waiting behind the overwrite dialog was a publish or a
  // draft. Without this the dialog would always fall back to one of them and
  // quietly do the wrong thing.
  const pendingPublishRef = useRef(false);

  const attemptSave = (publish: boolean) => {
    if (!data) return;
    if (anyError) {
      toast.error("Some entries are over the section maximum");
      return;
    }
    pendingPublishRef.current = publish;
    // Overwriting marks students can already see is allowed, but it must
    // never happen by accident: name how many will change and ask first.
    if (changedPublishedCount > 0) {
      setConfirmOverwrite(true);
      return;
    }
    runSave(publish);
  };

  const handleSaveDraft = () => attemptSave(false);

  const handlePublishAll = () => {
    if (!confirmingPublish) {
      setConfirmingPublish(true);
      return;
    }
    setConfirmingPublish(false);
    attemptSave(true);
  };

  const submitRecheck = () => {
    if (!recheckRow?.attemptId) {
      toast.error("Save marks first before flagging for recheck");
      return;
    }
    flagRecheck.mutate(
      { attemptId: recheckRow.attemptId, reason: recheckReason },
      {
        onSuccess: () => {
          toast.success("Flagged for recheck");
          setRecheckRow(null);
          setRecheckReason("");
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error)?.message ?? "Failed to load exam"}
        </div>
      </div>
    );
  }

  // Every class member is filtered out because none of them chose this exam's
  // optional subject. Say so — a bare empty grid reads as a broken screen, and
  // saving anyway would trip the enrollment trigger (42501) mid-batch.
  if (data.students.length === 0 && data.ineligibleCount > 0) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-ink-900">No students to mark yet</p>
          <p className="mt-1 text-ink-600">
            This exam covers an optional subject and none of the {data.ineligibleCount} student(s)
            in its class(es) have chosen it yet. Record their optional choices from each student's
            Subjects tab, then come back, the list fills in automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AnimatedContainer className="mx-auto w-full max-w-5xl pb-28">
      {/* Same header as the sibling offline screen: title, one meta line, and a
          publication badge. The back button stays because this one is a routed
          screen rather than a sheet, and without it there is no way back. */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-4 backdrop-blur md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-ml-2 h-8 w-8 shrink-0"
              onClick={() => navigate(-1)}
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="truncate text-xl font-semibold">{data.exam.title}</h2>
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
          </div>
          {allPublished ? (
            <Badge className="bg-green-500 hover:bg-green-500">
              <CheckCircle2 className="mr-1 h-3 w-3" />
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
      </header>

      {/* No search, no class chips, no mode toggle and no publish switch. The
          sibling offline screen has none of them: publication is an explicit
          button in the footer, not a switch you can leave in the wrong state,
          and that difference was the whole reason these two screens felt like
          different products. */}
      <div className="space-y-3 p-4 md:p-6">

        {/* Desktop table. This screen used to show stacked cards at every width,
            while the other offline marks screen (src/components/exam/
            OfflineMarksEntry.tsx) showed a proper table, so the two halves of
            the same feature looked like different products. Same columns, same
            class grouping header, same row treatment as that one. The cards
            below are kept for mobile, which is what they were always right for. */}
        <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
          <table className="w-full">
            <thead className="bg-muted text-sm text-muted-foreground">
              <tr>
                <th className="w-12 px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Student Name</th>
                <th className="w-28 px-4 py-3 text-left font-medium">Roll No</th>
                <th className="w-32 px-4 py-3 text-left font-medium">Admission No</th>
                {multiSection ? (
                  sections.map((sec) => (
                    <th key={sec.id} className="w-32 px-4 py-3 text-left font-medium">
                      <span className="block truncate">{sec.title}</span>
                      <span className="text-xs font-normal">/ {sec.totalMarks}</span>
                    </th>
                  ))
                ) : (
                  <th className="w-40 px-4 py-3 text-left font-medium">
                    Marks / {totalMax}
                  </th>
                )}
                {multiSection && (
                  <th className="w-24 px-4 py-3 text-left font-medium">Total</th>
                )}
                <th className="w-36 px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // #, name, roll, admission, status = 5, plus one column per
                // section (or a single Marks column), plus Total when split.
                const colCount =
                  5 + (multiSection ? sections.length + 1 : 1);
                const out: JSX.Element[] = [];
                let prevClassId: string | null = null;
                let posInClass = 0;

                rows.forEach((r) => {
                  if (r.classId !== prevClassId) {
                    const countInClass = rows.filter(
                      (x) => x.classId === r.classId
                    ).length;
                    out.push(
                      <tr key={`grp-${r.classId}`} className="border-t border-b bg-muted/60">
                        <td
                          colSpan={colCount}
                          className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground"
                        >
                          {r.className ?? "N/A"}
                          <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                            · {countInClass} student{countInClass === 1 ? "" : "s"}
                          </span>
                        </td>
                      </tr>
                    );
                    prevClassId = r.classId;
                    posInClass = 0;
                  }
                  posInClass += 1;

                  const total = rowTotal(r);
                  const hasError = rowHasError(r);
                  const entered = sections.some(
                    (sec) => r.sectionMarks[sec.id] != null,
                  );

                  out.push(
                    <tr
                      key={r.studentId}
                      className={`border-b hover:bg-muted/30 ${
                        r.isAbsent ? "bg-destructive/5" : hasError ? "bg-[#fa920e]/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">{posInClass}</td>
                      <td className="px-4 py-3 text-sm font-medium">{r.fullName}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {r.rollNumber ?? "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {r.admissionNumber ?? "N/A"}
                      </td>

                      {multiSection ? (
                        sections.map((sec) => {
                          const val = Number(r.sectionMarks[sec.id] ?? 0);
                          const over = val > sec.totalMarks;
                          return (
                            <td key={sec.id} className="px-4 py-3">
                              <Input
                                type="number"
                                min={0}
                                step={0.5}
                                disabled={r.isAbsent}
                                className={`h-10 w-24 ${over ? "border-destructive" : ""}`}
                                value={r.isAbsent ? "" : r.sectionMarks[sec.id] ?? ""}
                                placeholder={r.isAbsent ? "Absent" : undefined}
                                onChange={(e) =>
                                  updateSectionMark(r.studentId, sec.id, Number(e.target.value))
                                }
                              />
                            </td>
                          );
                        })
                      ) : (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              disabled={r.isAbsent}
                              className="h-10 w-28"
                              value={r.isAbsent ? "" : total || ""}
                              placeholder={r.isAbsent ? "Absent" : undefined}
                              onChange={(e) =>
                                updateTotalMark(r.studentId, Number(e.target.value))
                              }
                            />
                            <AbsentButton row={r} onToggle={() => toggleAbsent(r)} />
                          </div>
                        </td>
                      )}

                      {multiSection && (
                        <td className="px-4 py-3 text-sm font-semibold text-foreground">
                          {r.isAbsent ? "N/A" : total}
                        </td>
                      )}

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <RowStatus row={r} hasError={hasError} entered={entered} />
                          {multiSection && (
                            <AbsentButton row={r} onToggle={() => toggleAbsent(r)} />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-[#fa920e]"
                            onClick={() => setRecheckRow(r)}
                            aria-label="Flag for recheck"
                          >
                            <Flag className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                });

                if (rows.length === 0) {
                  out.push(
                    <tr key="empty">
                      <td
                        colSpan={colCount}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        No students on this exam's roster yet.
                      </td>
                    </tr>
                  );
                }
                return out;
              })()}
            </tbody>
          </table>
        </div>

        <ul className="space-y-2 md:hidden">
          {rows.map((r) => {
            const total = rowTotal(r);
            const hasError = rowHasError(r);
            return (
              <li
                key={r.studentId}
                className={`rounded-lg border p-3 ${
                  r.isAbsent
                    ? "border-destructive/40 bg-destructive/5"
                    : hasError
                    ? "border-[#fa920e]/40 bg-[#fa920e]/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {r.fullName}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.className ?? "N/A"}
                      {r.rollNumber ? ` · Roll ${r.rollNumber}` : ""}
                      {r.admissionNumber ? ` · Adm ${r.admissionNumber}` : ""}
                      {r.isRevised && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Revised
                        </span>
                      )}
                      {r.isPublished && (
                        <span className="ml-2 rounded-full bg-brand-primary/10 px-2 py-0.5 text-[10px] font-semibold text-brand-primary">
                          Published
                        </span>
                      )}
                    </div>
                  </div>
                  <AbsentButton row={r} onToggle={() => toggleAbsent(r)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-[#fa920e]"
                    onClick={() => setRecheckRow(r)}
                    aria-label="Flag for recheck"
                  >
                    <Flag className="h-4 w-4" />
                  </Button>
                </div>

                {!r.isAbsent && (
                  <div className="mt-3">
                    {multiSection ? (
                      <div className="grid grid-cols-2 gap-2">
                        {sections.map((sec) => {
                          const val = Number(r.sectionMarks[sec.id] ?? 0);
                          const over = val > sec.totalMarks;
                          return (
                            <div key={sec.id}>
                              <div className="mb-1 flex items-baseline justify-between text-[10px] text-muted-foreground">
                                <span className="truncate">{sec.title}</span>
                                <span>/ {sec.totalMarks}</span>
                              </div>
                              <Input
                                type="number"
                                min={0}
                                step={0.5}
                                className={`min-h-[40px] ${
                                  over ? "border-destructive" : ""
                                }`}
                                value={r.sectionMarks[sec.id] ?? ""}
                                onChange={(e) =>
                                  updateSectionMark(
                                    r.studentId,
                                    sec.id,
                                    Number(e.target.value)
                                  )
                                }
                              />
                              {over && (
                                <div className="mt-0.5 text-[10px] text-destructive">
                                  Over max
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div>
                        <div className="mb-1 text-[10px] text-muted-foreground">
                          Total marks (/ {totalMax})
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          className="min-h-[44px]"
                          value={total || ""}
                          onChange={(e) =>
                            updateTotalMark(
                              r.studentId,
                              Number(e.target.value)
                            )
                          }
                        />
                      </div>
                    )}
                    <div className="mt-2 text-right text-[11px] font-semibold text-foreground">
                      Total: {total}
                    </div>
                  </div>
                )}

                {hasError && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-[#fa920e]">
                    <AlertTriangle className="h-3 w-3" />
                    Some section marks exceed the maximum.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Same footer as the sibling offline screen: the four counts on the left,
          the actions on the right, and the confirm step naming anyone who would
          be published over or left behind. */}
      <div className="sticky bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur md:p-4">
        {examNotPublishable && (
          <div className="mb-3 rounded-lg border border-[#fa920e]/40 bg-[#fa920e]/10 p-3">
            <p className="text-xs font-medium text-foreground md:text-sm">
              {data.exam.status === "draft"
                ? "This exam is still a draft, so marks can't be saved yet."
                : "This exam is archived, so marks can't be saved."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.exam.status === "draft"
                ? "Open the exam, finish it and publish it, then come back. Nothing typed here will be kept until then."
                : "Restore the exam first if you still need to record its results."}
            </p>
          </div>
        )}
        {confirmingPublish && summary.blank > 0 && (
          <div className="mb-3 rounded-lg border border-[#fa920e]/40 bg-[#fa920e]/10 p-3">
            <p className="text-xs font-medium text-foreground md:text-sm">
              {summary.blank === 1
                ? "1 student has nothing entered and will not be published."
                : `${summary.blank} students have nothing entered and will not be published.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mark them absent or enter a mark first, or publish the{" "}
              {summary.filled + summary.absent} you have and come back to the rest later.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-muted-foreground md:text-sm">
            <span className="font-medium text-foreground">{summary.total}</span> students ·{" "}
            <span className="font-medium text-foreground">{summary.filled}</span> marked ·{" "}
            <span className="font-medium text-destructive">{summary.absent}</span> absent ·{" "}
            <span className="font-medium text-foreground">{summary.blank}</span> not entered
          </div>
          <div className="flex gap-2">
            {allPublished ? (
              <Button variant="secondary" disabled className="h-11 flex-1 md:h-10 md:flex-none">
                <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
                Published
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={save.isPending || anyError || examNotPublishable}
                className="h-11 flex-1 md:h-10 md:flex-none"
              >
                {save.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Draft
              </Button>
            )}
            <Button
              onClick={handlePublishAll}
              disabled={
                save.isPending ||
                anyError ||
                examNotPublishable ||
                summary.filled + summary.absent === 0 ||
                rowsToSave.length === 0
              }
              className={`h-11 flex-1 md:h-10 md:flex-none ${
                confirmingPublish ? "bg-[#fa920e] hover:bg-[#fa920e]/90" : ""
              }`}
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {confirmingPublish
                ? summary.blank > 0
                  ? `Publish ${summary.filled + summary.absent}, skip ${summary.blank}?`
                  : `Confirm publish ${summary.filled + summary.absent}?`
                : anyPublished
                  ? "Update"
                  : "Publish All"}
            </Button>
          </div>
        </div>
        {anyError && (
          <p className="mt-2 text-xs text-destructive">
            Fix out-of-range entries before saving.
          </p>
        )}
      </div>

      <Dialog
        open={recheckRow !== null}
        onOpenChange={(open) => {
          if (!open) setRecheckRow(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Flag for recheck</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">{recheckRow?.fullName}</div>
            <Textarea
              rows={3}
              placeholder="Optional reason for the recheck..."
              value={recheckReason}
              onChange={(e) => setRecheckReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRecheckRow(null)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              onClick={submitRecheck}
              disabled={flagRecheck.isPending}
              className="min-h-[44px]"
            >
              {flagRecheck.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Flag"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correcting published marks is allowed for teachers and admins alike,
          but it changes what students already see, so it needs an explicit
          confirmation every time. */}
      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite published results?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the published marks of {changedPublishedCount} student(s) who can
              already see them. Saving replaces what they see. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOverwrite(false);
                runSave(pendingPublishRef.current);
              }}
            >
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AnimatedContainer>
  );
}

/**
 * Absent toggle. Same affordance and wording as the sibling offline screen
 * (src/components/exam/OfflineMarksEntry.tsx) so the two read identically.
 */
function AbsentButton({
  row,
  onToggle,
}: {
  row: OfflineMarksStudentRow;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant={row.isAbsent ? "destructive" : "outline"}
      size="sm"
      className="h-10 shrink-0 gap-1.5"
      onClick={onToggle}
      title={
        row.isAbsent
          ? "Marked absent, click to undo"
          : "Mark this student absent"
      }
    >
      <UserX className="h-4 w-4" />
      Absent
    </Button>
  );
}

/** The row's state in one phrase, matching the sibling screen's vocabulary. */
function RowStatus({
  row,
  hasError,
  entered,
}: {
  row: OfflineMarksStudentRow;
  hasError: boolean;
  entered: boolean;
}) {
  if (hasError) {
    return <span className="text-xs font-medium text-destructive">Over max</span>;
  }
  if (row.isAbsent) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <UserX className="h-3 w-3" />
        {row.isPublished ? "Absent · published" : "Absent"}
      </span>
    );
  }
  if (!entered) {
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
