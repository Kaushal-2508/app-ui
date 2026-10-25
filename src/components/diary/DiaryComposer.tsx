import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Loader2, NotebookPen, Users } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import { TONES } from "@/components/shared/design-system";
import { useNoticeClassStudents, type NoticeTargetOption } from "@/hooks/notices";
import { useWriteDiaryEntries, useWriteDiaryEntry, type DiaryKind } from "@/hooks/diary";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { cn } from "@/lib/utils";

import { DIARY_KIND_LIST, DIARY_KIND_META, todayInputValue } from "./diaryMeta";

interface DiaryComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Classes this author may write for, already scoped server-side. */
  classes: NoticeTargetOption[];
  /** Pre-select the class the feed is filtered to. */
  defaultClassId?: string | null;
  /** Show the pointer to the graded Homework module. */
  homeworkModuleEnabled: boolean;
}

/** The "Addressed to" row that stands for the class as one entry. */
const WHOLE_CLASS = "__whole_class__";

/**
 * The whole "write in the diary" flow. Order of fields follows the order a
 * teacher thinks: what kind of entry, for whom, then the words.
 */
export function DiaryComposer({
  open,
  onOpenChange,
  classes,
  defaultClassId,
  homeworkModuleEnabled,
}: DiaryComposerProps) {
  const navigate = useNavigate();
  const write = useWriteDiaryEntry();
  const writeMany = useWriteDiaryEntries();

  const [kind, setKind] = useState<DiaryKind>("homework");
  const [classId, setClassId] = useState<string>(defaultClassId ?? classes[0]?.id ?? "");
  // Ticked students, in tick order. Empty means the whole class.
  const [studentIds, setStudentIds] = useState<string[]>([]);
  // One entry id per target (the whole class of a class, or one student),
  // kept for the life of the draft so a retry or a double tap re-sends the
  // same id and the server writes nothing twice. Per target, not one per
  // draft: a retry after switching to another student or class must not
  // reuse an id the server may already hold, or it would skip the new target.
  const copyIds = useRef(new Map<string, string>());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Follow the feed's class filter whenever the sheet opens on a new class.
  useEffect(() => {
    if (open && defaultClassId) setClassId(defaultClassId);
  }, [open, defaultClassId]);

  // If the classes arrive after mount, land on the first one.
  useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  // Ticked students belong to the class they were picked from.
  useEffect(() => {
    setStudentIds([]);
  }, [classId]);

  // Only while the sheet is open: the composer stays mounted on the diary page,
  // so loading with the class alone fetched the roster on every visit. Cached
  // for 5 minutes, so reopening is instant.
  const students = useNoticeClassStudents(open && classId ? [classId] : []);

  const meta = DIARY_KIND_META[kind];
  const isHomework = kind === "homework";
  const isPending = write.isPending || writeMany.isPending;

  const reset = () => {
    copyIds.current = new Map();
    setKind("homework");
    setStudentIds([]);
    setTitle("");
    setBody("");
    setDueDate("");
  };

  const canSave =
    classId !== "" && title.trim().length > 0 && body.trim().length > 0 && !isPending;

  const copyIdFor = (studentId: string | null) => {
    const key = `${classId}:${studentId ?? "class"}`;
    let id = copyIds.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      copyIds.current.set(key, id);
    }
    return id;
  };

  const handleSave = () => {
    if (!canSave) return;
    const entry = {
      classId,
      kind,
      title: title.trim(),
      body: body.trim(),
      dueDate: isHomework && dueDate ? dueDate : null,
    };
    const done = {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    };
    // The whole class or one student: the single write. Two or more: one
    // server transaction writes a copy per student (never a loop from here).
    if (studentIds.length <= 1) {
      const studentId = studentIds[0] ?? null;
      write.mutate({ ...entry, entryId: copyIdFor(studentId), studentId }, done);
    } else {
      writeMany.mutate({ ...entry, studentIds, entryIds: studentIds.map(copyIdFor) }, done);
    }
  };

  const isDirty = title.trim().length > 0 || body.trim().length > 0;
  const selectedClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);

  const wholeClassOption = useMemo<SearchableSelectOption>(
    () => ({
      value: WHOLE_CLASS,
      label: "The whole class",
      description: `Everyone in ${selectedClass?.label ?? "the class"}, as one entry`,
      icon: Users,
    }),
    [selectedClass],
  );
  const studentOptions = useMemo<SearchableSelectOption[]>(
    () =>
      (students.data ?? []).map((s) => ({
        value: s.user_id,
        label: s.full_name ?? "Unnamed student",
        description: s.detail ?? undefined,
      })),
    [students.data],
  );

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      desktopWidth="md"
      icon={<NotebookPen className="h-4 w-4" />}
      title="Write in the diary"
      subtitle="Students and their families see it the same day"
      primaryAction={{
        label: "Add to diary",
        onClick: handleSave,
        loading: isPending,
        disabled: !canSave,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      {/* data-dirty suppresses the service-worker auto-reload so an update
          cannot discard a half-written entry (CLAUDE.md section 17). */}
      <form className="space-y-6" data-dirty={isDirty ? "true" : undefined}>
        {/* ---- 1. Kind ---- */}
        <section className="space-y-3" aria-labelledby="diary-section-kind">
          <p id="diary-section-kind" className="eyebrow">
            What kind of entry
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DIARY_KIND_LIST.map((k) => {
              const Icon = k.icon;
              const active = k.value === kind;
              const t = TONES[k.tone];
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                    active
                      ? "border-brand-primary/50 bg-brand-primary/5"
                      : "border-surface-stroke hover:bg-surface-stroke/40",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg",
                      t.bg,
                      t.fg,
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-[13px] font-medium text-ink-900">{k.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[13px] leading-[18px] text-ink-500">{meta.hint}</p>
        </section>

        {/* ---- 2. For whom ---- */}
        <section
          className="space-y-4 border-t border-surface-stroke pt-5"
          aria-labelledby="diary-section-for"
        >
          <p id="diary-section-for" className="eyebrow">
            For whom
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Class</Label>
              {classes.length === 0 ? (
                <p className="text-sm text-ink-600">
                  You aren't assigned to any class yet, so there is nobody to write for.
                </p>
              ) : (
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger aria-label="Class">
                    <SelectValue placeholder="Choose a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Addressed to</Label>
              {/* One dropdown: "The whole class" pinned on top, the class's
                  students below to tick one or several. */}
              <SearchableMultiSelect
                values={studentIds.length > 0 ? studentIds : [WHOLE_CLASS]}
                onValuesChange={(next) => setStudentIds(next.filter((v) => v !== WHOLE_CLASS))}
                exclusiveOption={wholeClassOption}
                options={studentOptions}
                disabled={!classId}
                searchPlaceholder="Search students"
                emptyText={
                  students.isLoading
                    ? "Loading the students…"
                    : students.isError
                      ? "Couldn't load the students."
                      : "No students are enrolled in this class yet."
                }
                selectedHeading="Selected"
                othersHeading="Other students"
                triggerClassName={cn("h-10 rounded-xl border-input px-3 text-sm", FIELD_FILL)}
                summary={(_count, selected) => {
                  if (studentIds.length === 0) return "The whole class";
                  const names = selected.map((o) => o.label);
                  return names.length <= 2
                    ? names.join(", ")
                    : `${names[0]}, ${names[1]} + ${names.length - 2} more`;
                }}
              />
              {students.isLoading ? (
                <p className="flex items-center gap-2 text-[13px] text-ink-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading the students of {selectedClass?.label ?? "the class"}…
                </p>
              ) : students.isError ? (
                <p className="text-[13px] text-ink-600">
                  Couldn't load the students of this class. You can still write for the whole
                  class, or close and reopen this form.
                </p>
              ) : studentIds.length > 1 ? (
                <p className="text-[13px] text-ink-500">
                  Each of these {studentIds.length} students gets their own copy.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* ---- 3. The entry ---- */}
        <section
          className="space-y-4 border-t border-surface-stroke pt-5"
          aria-labelledby="diary-section-entry"
        >
          <p id="diary-section-entry" className="eyebrow">
            The entry
          </p>

          <div className="space-y-2">
            <Label htmlFor="diary-title">Title</Label>
            <Input
              id="diary-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={meta.titlePlaceholder}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="diary-body">Details</Label>
            <Textarea
              id="diary-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={meta.bodyPlaceholder}
              className="min-h-[110px] resize-y"
            />
          </div>

          {isHomework && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="diary-due">Due date (optional)</Label>
                <Input
                  id="diary-due"
                  type="date"
                  min={todayInputValue()}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              {homeworkModuleEnabled && (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      navigate("/homework/create");
                    }}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-primary hover:underline"
                  >
                    Need submissions and marking? Create a homework assignment instead
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </form>
    </MobileSheet>
  );
}
