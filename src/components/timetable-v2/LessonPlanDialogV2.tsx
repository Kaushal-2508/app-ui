import { useEffect, useRef, useState } from "react";
import { CalendarIcon, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useLessonPlanForDate,
  useUpsertLessonPlan,
  useRecordPeriodNote,
  type TeacherWeekSlot,
  type UpsertLessonPlanInput,
  type Weekday,
} from "@/hooks/useTimetableV2";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import {
  useAddChapterForClass,
  useUploadStudyMaterialForChapter,
} from "@/hooks/useSyllabusHierarchy";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { SyllabusProgressGroup } from "@/components/lesson-completion/SyllabusProgressGroup";
import { ChapterReorderSheet } from "@/components/lesson-completion/ChapterReorderSheet";
import { useSyllabusProgressState, useReorderChapters } from "@/hooks/useSyllabusProgress";
import { compareChapterOrder, enteredLateLabel } from "@/lib/syllabusEntry";
import { ChapterSelectItem } from "@/components/lesson-completion/ChapterStatusTag";

// --------------------------------------------------------------
// LessonPlanDialogV2 — teacher-facing plan editor.
//
// Status used to be a top-level field; it's been retired in favour
// of two structural fields that mirror how the syllabus tab is
// organised:
//   1) Chapter — a `syllabus_topics` row, with an inline create
//      button that adds the chapter to the syllabus directly so
//      no parallel data store is introduced.
//   2) Material — an optional file upload that lands on the
//      selected chapter in `study_materials`. Same storage bucket
//      and path scheme as the school-side material upload, so
//      the file shows up identically in the syllabus tree.
//
// Status is preserved on edits; new plans default to 'planned'.
// --------------------------------------------------------------

const NEW_CHAPTER_SENTINEL = "__new_chapter__";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function nextOccurrenceISO(weekday: Weekday): string {
  const today = new Date();
  const target = WEEKDAY_INDEX[weekday];
  const diff = (target - today.getDay() + 7) % 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: TeacherWeekSlot;
  ownerTeacherId: string;
  classIdFallback: string;
  subjectIdFallback: string | null;
  initialDate?: string;
  /** Auto-timeline lookup for THIS slot: dateIso → projected chapter. */
  projectionByDate?: Map<string, { topic_id: string; topic_name: string; chapter_ord: number }>;
  /** Today (ISO) for the past/future split of the syllabus section. */
  todayIso?: string;
  /** Count of chapters that won't fit in the remaining periods at the current pace. */
  overflowCount?: number;
}

export default function LessonPlanDialogV2({
  open,
  onOpenChange,
  slot,
  ownerTeacherId,
  classIdFallback,
  subjectIdFallback,
  initialDate,
  projectionByDate,
  todayIso,
  overflowCount,
}: Props) {
  const { institutionId } = useEffectiveInstitution();

  const [date, setDate] = useState<string>(() => initialDate ?? nextOccurrenceISO(slot.day));
  const [topicId, setTopicId] = useState<string | null>(null);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [newChapterName, setNewChapterName] = useState("");
  const [note, setNote] = useState<string>("");
  const [noteOnly, setNoteOnly] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existing = useLessonPlanForDate(
    open ? slot.id : null,
    open ? date : null,
    // Scoped to the subject THIS teacher delivers in the period.
    slot.subject_id ?? subjectIdFallback,
  );
  const upsert = useUpsertLessonPlan();
  const recordNote = useRecordPeriodNote();
  const addChapter = useAddChapterForClass();
  const uploadMaterial = useUploadStudyMaterialForChapter();

  // Chapters scoped to this class + subject. The slot tells us both.
  const subjectId = slot.subject_id ?? subjectIdFallback;
  const chapters = useChaptersForExam({
    classId: slot.class_id,
    subjectId: subjectId ?? undefined,
  });

  const isPastDate = !!todayIso && date < todayIso;
  // On a day that is over, the "What was covered" box owns the whole record:
  // chapters AND the day's note, with change, remove and swap (2026-09-29). The
  // dialog's own note-only switch is for planning only, so a past note-only row
  // never flips the dialog into its note mode: that would be a second, weaker
  // route to the same note, and saving it through the plan upsert would turn
  // the note back into an empty teaching row.
  const noteOnlyMode = noteOnly && !isPastDate;
  const projected = projectionByDate?.get(date) ?? null;
  const [reorderOpen, setReorderOpen] = useState(false);
  // Fetched for past dates too (it used to be future-only): on a past date the
  // chapters recorded that day are the only sensible target for a study-material
  // upload, now that the redundant second chapter picker is gone.
  const progressState = useSyllabusProgressState(
    open && !noteOnlyMode && subjectId ? { classId: slot.class_id, subjectId, date } : null,
  );
  /** Chapters the teacher actually logged on this date (past-date mode). */
  const chaptersLoggedToday = (progressState.data ?? []).filter((c) => c.action_on_date != null);
  // The planning picker lists the same chapters, in the same order and with the
  // same Completed / In progress marks, as the "What was covered" picker on a
  // past date, so the list looks the same whichever day is open.
  const chapterStatusById = new Map((progressState.data ?? []).map((c) => [c.topic_id, c.status]));
  const planningChapters = [...(chapters.data ?? [])].sort((a, b) => compareChapterOrder(
    { order: a.displayOrder, name: a.topicName },
    { order: b.displayOrder, name: b.topicName },
  ));
  const reorderChapters = useReorderChapters();
  // Mirror the projector's ordering (partial-first, then position, then name)
  // so `chapter_ord` indexes align with this array — otherwise the insert in
  // teachDifferentChapter lands in the wrong slot whenever an in-progress
  // chapter sits mid-sequence. `.filter()` copies, so the in-place sort never
  // mutates the query cache.
  const remainingOrdered = (progressState.data ?? [])
    .filter((c) => c.status !== "completed")
    .sort((a, b) =>
      (b.status === "partial" ? 1 : 0) - (a.status === "partial" ? 1 : 0)
      || a.position - b.position
      || a.topic_name.localeCompare(b.topic_name));

  async function teachDifferentChapter(topicIdPicked: string) {
    if (!institutionId || !subjectId || !projected) return;
    // Auto-wins reorder: move the picked chapter to the ordinal of the chapter
    // currently projected on this period; everything re-flows on next read.
    const ids = remainingOrdered.map((c) => c.topic_id).filter((id) => id !== topicIdPicked);
    const at = Math.min(Math.max(projected.chapter_ord - 1, 0), ids.length);
    ids.splice(at, 0, topicIdPicked);
    await reorderChapters.mutateAsync({
      classId: slot.class_id, subjectId, institutionId, orderedTopicIds: ids,
    });
  }

  // Reset everything when the dialog re-opens for a different cell.
  useEffect(() => {
    if (!open) return;
    setDate(initialDate ?? nextOccurrenceISO(slot.day));
    setCreatingChapter(false);
    setNewChapterName("");
    setNoteOnly(false);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, initialDate, slot.day, slot.id]);

  // When the existing row arrives (or the picked date changes), hydrate
  // the form from it. Treat null topic_id as "no chapter selected yet".
  useEffect(() => {
    if (!open) return;
    if (existing.data) {
      setNote(existing.data.note ?? "");
      setTopicId(existing.data.topic_id ?? null);
      setNoteOnly(existing.data.is_note_only);
    } else {
      setNote("");
      setTopicId(null);
      setNoteOnly(false);
    }
  }, [open, date, existing.data]);

  function handleNoteOnlyChange(next: boolean) {
    setNoteOnly(next);
    if (!next) return;
    // Chapter-mode staging is meaningless once the chapter fields are hidden,
    // and a leftover new-chapter name would create an orphan syllabus_topics
    // row on save.
    setCreatingChapter(false);
    setNewChapterName("");
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleChapterChange(value: string) {
    if (value === NEW_CHAPTER_SENTINEL) {
      setCreatingChapter(true);
      return;
    }
    setCreatingChapter(false);
    setTopicId(value || null);
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      // Soft cap matching the school upload dialog.
      alert("File size must be less than 50 MB");
      return;
    }
    setPendingFile(file);
  }

  function clearFile() {
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isSubmitting =
    upsert.isPending || addChapter.isPending || uploadMaterial.isPending || recordNote.isPending;
  // Chapter is mandatory in the normal path: the syllabus tab is organised by
  // chapter, and the upload needs one to park files under. Note-only mode swaps
  // that requirement for a mandatory note, so a period with no chapter delivery
  // (surprise test, class activity) is still a logged period.
  const hasChapter =
    topicId !== null || (creatingChapter && newChapterName.trim().length > 0);
  const canSave =
    !isSubmitting && !!institutionId &&
    (noteOnlyMode
      ? note.trim().length > 0
      // On a past date the "What was covered" box saves itself per action.
      // Save here only uploads a file, so it must not demand a chapter.
      : isPastDate || hasChapter);

  // Where an uploaded file gets filed. On a past date that is one of the
  // chapters logged that day, defaulting to the first so the common
  // single-chapter case needs no interaction. Derived rather than pushed into
  // `topicId` state, so it cannot race the hydration effect.
  const materialTopicId = isPastDate
    ? (topicId ?? chaptersLoggedToday[0]?.topic_id ?? null)
    : topicId;

  // A saved note typed in after the day it describes says so, same as a
  // chapter row in the "What was covered" block.
  const noteLateLabel =
    noteOnlyMode && existing.data?.is_note_only
      ? enteredLateLabel(existing.data.created_at, date)
      : null;

  // Turning the toggle on over a saved chapter clears it: UNIQUE (slot_id, date)
  // means one row per period. Name what will go before the teacher commits.
  const replacedChapterName =
    noteOnlyMode && existing.data?.topic_id
      ? ((chapters.data ?? []).find((c) => c.id === existing.data?.topic_id)?.topicName
         ?? "the chapter saved here")
      : null;

  async function handleSave() {
    // Note-only goes through the RPC, not the upsert: it resolves the period,
    // writes the canonical row shape and is shared with the check-out gate.
    if (noteOnlyMode) {
      await recordNote.mutateAsync({
        classId: classIdFallback,
        subjectId: subjectIdFallback,
        date,
        note: note.trim(),
        slotId: slot.id,
      });
      onOpenChange(false);
      return;
    }

    let resolvedTopicId = topicId;

    // 1) Create the chapter first if the user is in "new chapter" mode
    //    and typed a name. Skipped when they already picked an existing
    //    chapter or didn't enable the new-chapter row.
    if (!isPastDate && creatingChapter && newChapterName.trim().length > 0) {
      if (!institutionId || !subjectId) return;
      const created = await addChapter.mutateAsync({
        classId: slot.class_id,
        subjectId,
        institutionId,
        topicName: newChapterName,
      });
      resolvedTopicId = created.id;
    }

    // 2) Upsert the lesson plan row.
    const input: UpsertLessonPlanInput = {
      slot_id: slot.id,
      class_id: classIdFallback,
      subject_id: subjectIdFallback,
      owner_teacher_id: ownerTeacherId,
      date,
      note: note.trim() ? note.trim() : null,
      // Both sent explicitly so that toggling note-only OFF and saving converts
      // the row back to a teaching row rather than leaving a stale flag.
      session_type: "teaching",
      is_note_only: false,
    };
    input.topic_id = resolvedTopicId;
    // A day that is over is never written through the plan upsert: its
    // chapters and note belong to the "What was covered" box, which saves every
    // change itself through edit_syllabus_day. An insert here used to leave a
    // chapterless "Planned" row on a finished day (561 had piled up by
    // 2026-09-25), and an update could turn a note back into a teaching row.
    // Save on a past date only uploads the file.
    if (!isPastDate) await upsert.mutateAsync(input);

    // 3) If the teacher attached a file, upload it under the chosen
    //    chapter so it shows up alongside the syllabus tree's materials.
    const uploadTargetId = isPastDate ? materialTopicId : resolvedTopicId;
    if (pendingFile && uploadTargetId && institutionId && subjectId) {
      try {
        await uploadMaterial.mutateAsync({
          topicId: uploadTargetId,
          classId: slot.class_id,
          subjectId,
          institutionId,
          file: pendingFile,
        });
      } catch {
        // toastError fires inside the hook on failure; the lesson plan
        // is already saved, so we don't roll it back.
      }
    }

    onOpenChange(false);
  }

  const classLabel = slot.class_section
    ? `${slot.class_name} – ${slot.class_section}`
    : slot.class_name;
  const subjectLabel = slot.subject_name ?? "Unassigned";

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-dirty="true">
        {/* pr-8 clears DialogContent's absolute close X (right-4). Padding only:
            flex/overflow here would fight the fork's ScrollArea (ui-invariants §1). */}
        <DialogHeader className="pr-8 space-y-1">
          <DialogTitle className="text-ink-900">Lesson plan</DialogTitle>
          <DialogDescription className="text-ink-600 leading-relaxed">
            <span className="block font-medium text-ink-900">{classLabel}</span>
            {subjectLabel} · {slot.period_label} ·{" "}
            {slot.start_time.slice(0, 5)} to {slot.end_time.slice(0, 5)}
          </DialogDescription>
        </DialogHeader>

        {/* Wrap body in a <form> so the SW dirty-form check (selector
            form[data-dirty="true"] in main.tsx) actually matches — the
            attribute on DialogContent's <div> is invisible to that
            selector and was letting updates reload mid-edit. */}
        {/* mt-4 / footer mt-4: DialogContent's gap-4 lives on the outer grid,
            but the fork renders children inside a plain p-6 div in the
            ScrollArea, so header, body and footer otherwise touch. */}
        <form
          className="mt-4 space-y-5"
          data-dirty="true"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* ---------------- Date ---------------- */}
          <section className="space-y-1.5">
            <p className="eyebrow flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" />
              Date
            </p>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full"
            />
          </section>

          {/* ---------------- Chapter ----------------
              Exactly ONE chapter surface per mode. A past date is a record of
              what happened and the block below already owns that with its own
              picker, so showing the planning dropdown as well asked the same
              question twice. A future date is a plan, so only the dropdown. */}
          {!noteOnlyMode && subjectId && (isPastDate ? (
            <section className="space-y-1.5">
              <p className="eyebrow">What was covered</p>
              <SyllabusProgressGroup
                classId={slot.class_id}
                subjectId={subjectId}
                className={classLabel}
                subjectName={subjectLabel}
                date={date}
                source="correction"
                hostedInForm
                // The class and subject are already in this dialog's header,
                // and there is only ever one group here.
                showHeader={false}
                showEnteredOn
              />
            </section>
          ) : (
            <section className="space-y-1.5">
              <p className="eyebrow">Chapter</p>

              {/* The auto-timeline's recommendation for this period (the week
                  card shows it too, arrowed, until a chapter is planned).
                  "Teach a different chapter here" re-sequences the timeline so
                  the pick lands on this period and everything after re-flows
                  (two-timeline spec §7, "Auto wins"); the dropdown below only
                  plans this one period and does not move the timeline. */}
              <div className="rounded-lg border border-surface-stroke bg-muted/30 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-xs text-ink-600">
                    {projected ? (
                      <>
                        Recommended next chapter:{" "}
                        <span className="font-medium text-ink-900">{projected.topic_name}</span>
                      </>
                    ) : (
                      "No chapter recommended for this period."
                    )}
                  </p>
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-6 shrink-0 px-2 text-xs text-ink-500 hover:text-ink-900"
                    onClick={() => setReorderOpen(true)}
                  >
                    Reorder
                  </Button>
                </div>
                {overflowCount != null && overflowCount > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {overflowCount} chapter{overflowCount === 1 ? "" : "s"} will not fit in the
                    remaining periods at this pace.
                  </p>
                )}
                {projected && remainingOrdered.length > 1 && (
                  <Select
                    value=""
                    onValueChange={(v) => { void teachDifferentChapter(v); }}
                    disabled={reorderChapters.isPending}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue placeholder="Teach a different chapter here" />
                    </SelectTrigger>
                    <SelectContent>
                      {remainingOrdered
                        .filter((c) => c.topic_id !== projected.topic_id)
                        .map((c) => (
                          <SelectItem key={c.topic_id} value={c.topic_id}>
                            {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {!creatingChapter ? (
                <>
                  <Select
                    value={topicId ?? ""}
                    onValueChange={handleChapterChange}
                    disabled={!subjectId || chapters.isLoading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          !subjectId
                            ? "Subject not set on this period"
                            : chapters.isLoading
                              ? "Loading chapters..."
                              : "Pick the chapter you will teach"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Highlighted "create" affordance at the top so teachers
                          don't scroll past every chapter to reach it. Avoids
                          `sticky`: Radix Select renders all items in one flow
                          and a sticky child overlaps them. */}
                      <SelectItem
                        value={NEW_CHAPTER_SENTINEL}
                        className="font-semibold text-primary bg-primary/5 focus:bg-primary/10 focus:text-primary"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Plus className="h-3.5 w-3.5" />
                          Add new chapter
                        </span>
                      </SelectItem>
                      <div className="my-1 border-t border-border/60" aria-hidden />
                      {planningChapters.map((c) => (
                        <ChapterSelectItem
                          key={c.id}
                          value={c.id}
                          label={`${c.chapterNumber ? `${c.chapterNumber}. ` : ""}${c.topicName}`}
                          status={chapterStatusById.get(c.id)}
                        />
                      ))}
                    </SelectContent>
                  </Select>
                  {!chapters.isLoading && (chapters.data ?? []).length === 0 && subjectId && (
                    <p className="text-xs text-ink-500">
                      No chapters for this subject yet. Use Add new chapter to create one.
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newChapterName}
                      onChange={(e) => setNewChapterName(e.target.value)}
                      placeholder="e.g. Reading comprehension"
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button" variant="ghost" size="icon" className="shrink-0"
                      onClick={() => { setCreatingChapter(false); setNewChapterName(""); }}
                      title="Cancel new chapter"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-ink-500">
                    This chapter is added to the syllabus too. No duplicate setup needed.
                  </p>
                </div>
              )}
            </section>
          ))}

          {/* ---------------- Study material ----------------
              Needs a chapter to file under (useUploadStudyMaterialForChapter
              requires a topicId). On a past date the only sensible targets are
              the chapters actually logged that day, so offer exactly those. */}
          {!noteOnlyMode && subjectId && (!isPastDate || chaptersLoggedToday.length > 0) && (
            <section className="space-y-1.5">
              <p className="eyebrow">Study material (optional)</p>

              {isPastDate && (
                <Select
                  value={materialTopicId ?? ""}
                  onValueChange={(v) => setTopicId(v || null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="File it under which chapter?" />
                  </SelectTrigger>
                  <SelectContent>
                    {chaptersLoggedToday.map((c) => (
                      <SelectItem key={c.topic_id} value={c.topic_id}>
                        {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,video/*,audio/*,image/*"
                onChange={handleFileChange}
              />
              {!pendingFile ? (
                <Button
                  type="button"
                  variant="outline"
                  // A file picker is a field: it wears the shared field fill
                  // (Button merges classes, so this beats the outline white).
                  className={`w-full justify-start font-normal text-ink-600 ${FIELD_FILL}`}
                  onClick={pickFile}
                >
                  <Upload className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">Choose a file (PDF, doc, slides, video)</span>
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-stroke bg-muted/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-ink-500" />
                    <span className="truncate text-sm text-ink-900">{pendingFile.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-500">
                      {(pendingFile.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={clearFile}
                    title="Remove file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <p className="text-xs text-ink-500">
                Uploaded to the selected chapter, so it appears in the syllabus too.
              </p>
              {!!pendingFile && !isPastDate && !hasChapter && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertDescription className="text-xs">
                    Pick a chapter above so we know where this file goes.
                  </AlertDescription>
                </Alert>
              )}
            </section>
          )}

          {/* A plan note written before the day, kept readable. The day's
              actual note is in the "What was covered" box above. */}
          {isPastDate && existing.data?.note && !existing.data.is_note_only && (
            <section className="space-y-1">
              <p className="eyebrow">Your plan note</p>
              <p className="whitespace-pre-wrap break-words text-xs text-ink-600">{existing.data.note}</p>
            </section>
          )}

          {/* ---------------- Notes, with the note-only switch on its heading ----------------
              Planning only: a past day's note is edited in the box above. */}
          {!isPastDate && (
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">
                {noteOnlyMode ? "What happened this period" : "Notes (optional)"}
                {noteOnlyMode && <span className="text-destructive"> *</span>}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Label
                  htmlFor="lesson-note-only"
                  className="cursor-pointer whitespace-nowrap text-xs font-medium text-ink-600"
                >
                  Note only
                </Label>
                <Switch
                  id="lesson-note-only"
                  checked={noteOnlyMode}
                  onCheckedChange={handleNoteOnlyChange}
                />
              </div>
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={noteOnlyMode ? 4 : 3}
              placeholder={
                noteOnlyMode
                  ? "Surprise test on Chapter 4, class activity, assembly ran over..."
                  : "Topic, objective, carry-forward items, homework..."
              }
            />
            <p className="text-xs text-ink-500">
              {noteOnlyMode
                ? "No chapter is recorded, so syllabus coverage does not move. The day still counts as logged."
                : "Turn on Note only for a period with no chapter, like a surprise test."}
            </p>
            {noteLateLabel && <p className="text-xs text-ink-500">{noteLateLabel}</p>}
            {replacedChapterName && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertDescription className="text-xs">
                  Saving clears the chapter logged here:{" "}
                  <span className="font-medium">{replacedChapterName}</span>. Any study material
                  you uploaded stays in the syllabus.
                </AlertDescription>
              </Alert>
            )}
          </section>
          )}
        </form>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {/* A past day's changes are already saved by the box above. */}
            {replacedChapterName ? "Replace chapter entry" : isPastDate ? (pendingFile ? "Upload file" : "Done") : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {subjectId && (
      <ChapterReorderSheet
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        classId={slot.class_id}
        subjectId={subjectId}
        subjectName={subjectLabel}
      />
    )}
    </>
  );
}
