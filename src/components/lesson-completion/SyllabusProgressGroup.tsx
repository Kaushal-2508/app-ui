import { useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Loader2,
  NotebookPen,
  Pencil,
  Replace,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import {
  useSyllabusProgressState,
  useSyllabusEntryTimes,
  useSyllabusDayNotes,
  useEditSyllabusDay,
  type ChapterAction,
  type ChapterProgressState,
  type EditSyllabusDayInput,
  type SyllabusDayNote,
} from "@/hooks/useSyllabusProgress";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import { compareChapterOrder, enteredLateLabel } from "@/lib/syllabusEntry";
import { ChapterSelectItem } from "@/components/lesson-completion/ChapterStatusTag";

/**
 * One (class, subject) day of the syllabus log, and the ONE place it is edited,
 * wherever it appears: the check-out sheet, the unlogged-days sheet, the
 * lesson-plan dialog and the My syllabus day sheet.
 *
 * On that day a teacher can add a chapter (every chapter listed, marked with
 * its status), switch a logged one between Completed and Partial, remove it,
 * and add, edit or remove the day's note. Switching a chapter for a note or a
 * note for a chapter is ONE save, so the day is never half-changed. Every
 * write goes through edit_syllabus_day (one transaction server-side); every
 * removal asks first and names what goes (CLAUDE.md section 9a).
 */
export function SyllabusProgressGroup({
  classId, subjectId, className, subjectName, date, source,
  serverFilled, showHeader = true, showEnteredOn, hostedInForm = false, collapseWhenFilled = false,
}: {
  classId: string; subjectId: string; className: string; subjectName: string;
  date: string; source: "checkout" | "checkin" | "correction";
  /**
   * The host already wraps us in a <form data-dirty="true">. Nesting a second
   * <form> is invalid HTML (React warns, browsers ignore the inner tag), so
   * render a plain div instead. The sheets leave this off: there the group's
   * own form is what the service-worker dirty check finds.
   */
  hostedInForm?: boolean;
  /**
   * The class + subject line and the Filled badge. On by default because the
   * check-out and backlog sheets stack several of these and the heading is
   * the only thing telling them apart. Hosts showing one group, whose class
   * and subject are already in their own header, turn it off.
   */
  showHeader?: boolean;
  /**
   * The server's own view of whether this group is resolved (a note on a
   * period of a colleague's, say). Combined with what this group can see.
   */
  serverFilled?: boolean;
  /**
   * Say "Entered 16 Sep" on a row typed in after the day it describes. Set by
   * hosts that show one group; the backlog sheet stacks dozens that are late
   * by definition, and the check-out sheet is always today.
   */
  showEnteredOn?: boolean;
  /**
   * Fold a finished group to one line (what was logged + Edit). The unlogged
   * sheet lists a whole day while ANY class on it is missing, so a finished
   * class there looked like it still needed filling (2026-09-29).
   */
  collapseWhenFilled?: boolean;
}) {
  const { data: chapters = [], isLoading, isError } = useSyllabusProgressState({ classId, subjectId, date });
  const [expanded, setExpanded] = useState(false);
  const notesQuery = useSyllabusDayNotes({ classId, subjectId, date });
  const notes = notesQuery.data ?? [];
  const edit = useEditSyllabusDay();

  const [pickedId, setPickedId] = useState<string | null>(null);
  // The note being written: a new one, or an existing one (by its period).
  const [noteDraft, setNoteDraft] = useState<{ slotId: string | null; text: string } | null>(null);
  const [replaceChapters, setReplaceChapters] = useState(false);
  // Set when the next chapter saved should take the place of this note.
  const [replaceNote, setReplaceNote] = useState<SyllabusDayNote | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string; body: string; action: string; input: EditSyllabusDayInput; after?: () => void;
  } | null>(null);

  const savedToday = chapters.filter((c) => c.action_on_date != null);
  const entryTimes = useSyllabusEntryTimes(
    showEnteredOn && savedToday.length > 0 ? { classId, subjectId, date } : null,
  );
  const enteredAt = new Map((entryTimes.data ?? []).map((t) => [t.topic_id, t.created_at]));
  const filled = savedToday.length > 0 || notes.length > 0 || !!serverFilled;
  const busy = edit.isPending;
  const dayLabel = fmtDay(date);

  // EVERY chapter is listed, always, in the syllabus's own order, each marked
  // with its status. This used to hide completed chapters and switch to a
  // separate "revision" list once all were done, so the same list looked
  // different class to class, and a teacher back-filling an old day could not
  // pick a chapter they had marked completed on a LATER day (reported
  // 2026-09-16 as a period note). Logging a completed chapter again is safe: a
  // chapter counts as completed while ANY completed entry exists, and coverage
  // and the chapter badges count DISTINCT chapters.
  const chapterOrder = useChaptersForExam({ classId, subjectId });
  const orderOf = new Map((chapterOrder.data ?? []).map((c) => [c.id, c.displayOrder]));
  const pickerChapters = chapterOrder.data
    ? [...chapters].sort((a, b) => compareChapterOrder(
        { order: orderOf.get(a.topic_id), name: a.topic_name },
        { order: orderOf.get(b.topic_id), name: b.topic_name },
      ))
    : chapters;

  // A chapter already logged for this date stays in the list but cannot be
  // picked: saving it again would overwrite that entry. It is changed in the
  // "Logged for this day" list instead.
  const canPick = (c: { action_on_date: ChapterAction | null }) => c.action_on_date == null;

  // A picked id that is no longer pickable renders as a BLANK trigger:
  // SelectValue looks the item up by value and shows neither the label nor the
  // placeholder. That happens as soon as the chapter is saved for this date.
  const validPickedId =
    pickedId && pickerChapters.some((c) => c.topic_id === pickedId && canPick(c)) ? pickedId : null;

  const base = { classId, subjectId, date, source } as const;

  function run(input: EditSyllabusDayInput, after?: () => void) {
    edit.mutate(input, { onSuccess: () => after?.() });
  }

  function saveChapter(action: ChapterAction) {
    if (!validPickedId) return;
    const picked = chapters.find((c) => c.topic_id === validPickedId);
    const reset = () => { setPickedId(null); setReplaceNote(null); };
    if (replaceNote) {
      setConfirm({
        title: "Replace the note with this chapter?",
        body: `The note "${clip(replaceNote.note)}" is removed from ${dayLabel}, and ${chapterLabel(picked)} is logged as ${action === "completed" ? "Completed" : "Partial"}.`,
        action: "Replace note",
        input: { ...base, set: [{ topicId: validPickedId, action }], clearNote: true, noteSlotId: replaceNote.slot_id },
        after: reset,
      });
      return;
    }
    run({ ...base, set: [{ topicId: validPickedId, action }] }, reset);
  }

  function removeChapter(c: ChapterProgressState) {
    setConfirm({
      title: `Remove this chapter from ${dayLabel}?`,
      body: `${chapterLabel(c)} is taken off the syllabus log for ${className} · ${subjectName} on ${dayLabel}. You can add it again.`,
      action: "Remove chapter",
      input: { ...base, removeTopicIds: [c.topic_id] },
    });
  }

  function saveNote() {
    if (!noteDraft) return;
    const text = noteDraft.text.trim();
    if (!text) return;
    const reset = () => { setNoteDraft(null); setReplaceChapters(false); };
    if (noteDraft.slotId) {
      run({ ...base, note: text, noteSlotId: noteDraft.slotId }, reset);
      return;
    }
    if (replaceChapters && savedToday.length > 0) {
      setConfirm({
        title: "Replace the logged chapters with this note?",
        body: `${savedToday.map(chapterLabel).join(", ")} ${savedToday.length === 1 ? "is" : "are"} removed from ${dayLabel}, and the note is saved instead.`,
        action: "Replace chapters",
        input: { ...base, removeTopicIds: savedToday.map((c) => c.topic_id), note: text },
        after: reset,
      });
      return;
    }
    run({ ...base, note: text }, reset);
  }

  function removeNote(n: SyllabusDayNote) {
    const leavesEmpty = savedToday.length === 0 && notes.length === 1;
    setConfirm({
      title: `Remove this note from ${dayLabel}?`,
      body: `"${clip(n.note)}" is removed.${leavesEmpty ? " The day will show as not logged until you add a chapter or a note." : ""}`,
      action: "Remove note",
      input: { ...base, clearNote: true, noteSlotId: n.slot_id },
    });
  }

  const Wrapper: "form" | "div" = hostedInForm ? "div" : "form";

  // Folded view of a finished group: says WHAT was logged, so "Filled" is
  // never a claim the teacher cannot see behind, and one tap opens the editor.
  if (collapseWhenFilled && filled && !expanded) {
    const summary = [
      ...savedToday.map((c) => `${chapterLabel(c)} (${c.action_on_date === "completed" ? "Completed" : "Partial"})`),
      ...notes.map((n) => `Note: ${clip(n.note)}`),
    ];
    return (
      <Card className="surface-card frosted-shadow rounded-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium text-ink-900">{className} · {subjectName}</p>
            <p className="break-words text-xs text-ink-500">
              {summary.length > 0
                ? summary.join(" · ")
                : isLoading || notesQuery.isLoading
                  ? "Loading what was logged…"
                  : isError || notesQuery.isError
                    ? "Couldn't load what was logged. Tap Edit to retry."
                    // The server counts it as logged but this account cannot
                    // see the entry (a colleague's note on a shared period).
                    : "Logged by a colleague for this class"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className="gap-1 text-[10px] h-5 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
              <Check className="h-2.5 w-2.5" /> Filled
            </Badge>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExpanded(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="surface-card frosted-shadow rounded-card p-3">
      <Wrapper data-dirty="true" onSubmit={(e) => e.preventDefault()} className="space-y-2">
        {showHeader && (
          <div className="flex items-center justify-between gap-2">
            {/* min-w-0 is what makes `truncate` work at all inside a flex row:
                without it the item's automatic minimum size is its content, so a
                long class name pushes the badge out of the dialog instead. */}
            <p className="min-w-0 truncate text-sm font-medium text-ink-900">
              {className} · {subjectName}
            </p>
            {filled && (
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px] h-5 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                <Check className="h-2.5 w-2.5" /> Filled
              </Badge>
            )}
          </div>
        )}

        {/* ---------- What is logged for this day, each row editable ---------- */}
        {savedToday.length > 0 && (
          <p className="pt-1 text-xs font-medium text-ink-500">Logged for this day</p>
        )}
        {savedToday.map((c) => {
          const lateLabel = enteredLateLabel(enteredAt.get(c.topic_id), date);
          return (
            <div key={c.topic_id} className="space-y-1.5 rounded-lg border border-surface-stroke px-2.5 py-2">
              <div className="min-w-0">
                <p className="break-words text-xs font-medium text-ink-900">{chapterLabel(c)}</p>
                {lateLabel && <p className="text-[10px] text-ink-500">{lateLabel}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <ActionToggle
                  value={c.action_on_date ?? "partial"}
                  disabled={busy}
                  onChange={(next) => run({ ...base, set: [{ topicId: c.topic_id, action: next }] })}
                />
                <Button
                  type="button" variant="ghost" size="sm"
                  className="ml-auto h-7 px-2 text-xs text-ink-500 hover:text-rose-600"
                  disabled={busy}
                  onClick={() => removeChapter(c)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </div>
            </div>
          );
        })}

        {/* ---------- The day's note(s) ---------- */}
        {notesQuery.isError && (
          <p className="flex items-center gap-1.5 py-1 text-xs text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Couldn't load this day's note.
          </p>
        )}
        {notes.map((n) =>
          noteDraft?.slotId === n.slot_id ? (
            <NoteEditor
              key={n.id}
              title="Edit the note"
              value={noteDraft.text}
              onChange={(text) => setNoteDraft({ slotId: n.slot_id, text })}
              onCancel={() => setNoteDraft(null)}
              onSave={saveNote}
              busy={busy}
            />
          ) : (
            <div key={n.id} className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="flex items-start gap-2">
                <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-700 dark:text-violet-300" />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-xs text-ink-900">{n.note}</p>
                  {showEnteredOn && enteredLateLabel(n.created_at, date) && (
                    <p className="text-[10px] text-ink-500">{enteredLateLabel(n.created_at, date)}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => { setReplaceNote(null); setNoteDraft({ slotId: n.slot_id, text: n.note ?? "" }); }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                {chapters.length > 0 && (
                  <Button
                    type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => { setNoteDraft(null); setReplaceNote(n); }}
                  >
                    <Replace className="h-3.5 w-3.5 mr-1" /> Replace with a chapter
                  </Button>
                )}
                <Button
                  type="button" variant="ghost" size="sm"
                  className="ml-auto h-7 px-2 text-xs text-ink-500 hover:text-rose-600"
                  disabled={busy}
                  onClick={() => removeNote(n)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </div>
            </div>
          ),
        )}

        {/* ---------- Add a chapter ---------- */}
        {isLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chapters…
          </div>
        ) : isError ? (
          <p className="flex items-center gap-1.5 py-1 text-xs text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Couldn't load chapters. Retrying.
          </p>
        ) : chapters.length === 0 ? (
          <p className="py-1 text-xs text-ink-500">No chapters configured for this subject yet.</p>
        ) : (
          /* Stacked on purpose: the picker takes the full row and the two
             actions share the next one. Every host is narrow (a ~460px
             dialog body, a phone-width sheet), and an inline three-across
             row squeezed the picker until "The Rise of Nationalism" read as
             "The Rise of...". No sm: breakpoint either, since that is a
             VIEWPORT query and would re-cram the row on a desktop. */
          <div className="space-y-2">
            {replaceNote && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <Replace className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Pick the chapter you taught. Saving it removes the note.</span>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setReplaceNote(null)}>
                  Cancel
                </Button>
              </div>
            )}
            <Select value={validPickedId ?? undefined} onValueChange={(v) => setPickedId(v)} disabled={busy}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={savedToday.length > 0 ? "Add another chapter" : "Which chapter did you teach?"} />
              </SelectTrigger>
              <SelectContent>
                {pickerChapters.map((c) => (
                  <ChapterSelectItem
                    key={c.topic_id}
                    value={c.topic_id}
                    label={chapterLabel(c)}
                    status={canPick(c) ? c.status : "logged-today"}
                    disabled={!canPick(c)}
                  />
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                type="button" size="sm"
                onClick={() => saveChapter("completed")}
                disabled={!validPickedId || busy}
                className="flex-1 bg-brand-primary text-white hover:bg-brand-primary/90"
              >
                <Check className="h-4 w-4 mr-1" /> Completed
              </Button>
              <Button
                type="button" size="sm" variant="outline"
                className="flex-1"
                onClick={() => saveChapter("partial")}
                disabled={!validPickedId || busy}
              >
                <CircleDot className="h-4 w-4 mr-1" /> Partial
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Add a note ----------
            Always offered while the day has none, filled or not: a period that
            was a test, an activity, or taught nothing from the syllabus. */}
        {notes.length === 0 && !notesQuery.isLoading && !notesQuery.isError && (
          noteDraft && noteDraft.slotId === null ? (
            <NoteEditor
              title="What happened this period?"
              value={noteDraft.text}
              onChange={(text) => setNoteDraft({ slotId: null, text })}
              onCancel={() => { setNoteDraft(null); setReplaceChapters(false); }}
              onSave={saveNote}
              busy={busy}
              extra={savedToday.length > 0 ? (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`replace-${classId}-${subjectId}-${date}`}
                    checked={replaceChapters}
                    onCheckedChange={(v) => setReplaceChapters(v === true)}
                  />
                  <Label htmlFor={`replace-${classId}-${subjectId}-${date}`} className="text-xs font-normal leading-4 text-ink-700">
                    Replace the logged {savedToday.length === 1 ? "chapter" : "chapters"} with this note
                  </Label>
                </div>
              ) : undefined}
            />
          ) : (
            <Button
              type="button" variant="ghost" size="sm"
              className="h-7 px-1 text-xs text-ink-500 hover:text-ink-900"
              disabled={busy}
              onClick={() => { setReplaceNote(null); setNoteDraft({ slotId: null, text: "" }); }}
            >
              <NotebookPen className="h-3.5 w-3.5 mr-1" />
              {savedToday.length > 0 ? "Add a note for this day" : "Something else happened this period?"}
            </Button>
          )
        )}
      </Wrapper>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm) run(confirm.input, confirm.after);
                setConfirm(null);
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Completed / Partial as a two-button switch; the current one is filled. */
function ActionToggle({
  value, onChange, disabled,
}: {
  value: ChapterAction;
  onChange: (next: ChapterAction) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-full border border-surface-stroke p-0.5" role="group" aria-label="Chapter status">
      {(["completed", "partial"] as const).map((a) => {
        const active = value === a;
        return (
          <Button
            key={a}
            type="button" size="sm" variant="ghost"
            aria-pressed={active}
            disabled={disabled || active}
            onClick={() => onChange(a)}
            className={cn(
              "h-6 rounded-full px-2.5 text-[11px] font-semibold disabled:opacity-100",
              active && a === "completed" && "bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950",
              active && a === "partial" && "bg-yellow-400 text-yellow-950 hover:bg-yellow-400",
              !active && "text-ink-600",
            )}
          >
            {a === "completed" ? <Check className="h-3 w-3 mr-1" /> : <CircleDot className="h-3 w-3 mr-1" />}
            {a === "completed" ? "Completed" : "Partial"}
          </Button>
        );
      })}
    </div>
  );
}

function NoteEditor({
  title, value, onChange, onCancel, onSave, busy, extra,
}: {
  title: string;
  value: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-surface-stroke p-2.5">
      <p className="text-xs font-medium text-ink-900">{title}</p>
      <Textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Surprise test, class activity, assembly ran over..."
      />
      <p className="text-xs text-ink-500">This counts as logged. No chapter is recorded.</p>
      {extra}
      <div className="flex items-center gap-2">
        <Button
          type="button" size="sm"
          disabled={!value.trim() || busy}
          onClick={onSave}
          className="bg-brand-primary text-white hover:bg-brand-primary/90"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Save note
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function chapterLabel(c: Pick<ChapterProgressState, "chapter_number" | "topic_name"> | undefined): string {
  if (!c) return "the chapter";
  return `${c.chapter_number != null ? `${c.chapter_number}. ` : ""}${c.topic_name}`;
}

function clip(note: string | null): string {
  const t = (note ?? "").trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

function fmtDay(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "d MMM");
}
