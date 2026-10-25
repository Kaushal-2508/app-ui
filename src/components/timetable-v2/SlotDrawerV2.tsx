import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useSubjectsForClassV2,
  useTeachersForClassSubjectV2,
  type PeriodSlotV2,
  type ResolvedSlotV2,
  type SaveTtSlotInput,
  type SlotType,
  type Weekday,
} from "@/hooks/useTimetableV2";
import { useOptionalGroupsForClass } from "@/hooks/useOptionalGroups";

// --------------------------------------------------------------
// SlotDrawerV2 — tap a cell → slide-up sheet to pick slot type /
// subject / teacher / notes. For Theory + Practical, subject and
// teacher are required; other types (free, assembly, sports...)
// just set the slot_type and commit.
// --------------------------------------------------------------

const ACADEMIC_TYPES: SlotType[] = ["theory", "practical"];

const SLOT_TYPE_LABEL: Record<SlotType, string> = {
  theory: "Theory",
  practical: "Practical",
  library: "Library",
  sports: "Sports",
  arts: "Arts",
  assembly: "Assembly",
  free: "Free",
  break: "Break",
  other: "Other",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  className: string;
  classSection: string | null;
  academicYear: string;
  day: Weekday;
  periodSlot: PeriodSlotV2;
  existingSlot: ResolvedSlotV2 | null;
  canEdit: boolean;
  onSave: (input: SaveTtSlotInput) => Promise<void>;
  onDelete?: (slotId: string) => Promise<void>;
}

export default function SlotDrawerV2({
  open,
  onOpenChange,
  classId,
  className,
  classSection,
  academicYear,
  day,
  periodSlot,
  existingSlot,
  canEdit,
  onSave,
  onDelete,
}: Props) {
  const [slotType, setSlotType] = useState<SlotType>(existingSlot?.slot_type ?? "theory");
  const [subjectId, setSubjectId] = useState<string | null>(existingSlot?.subject_id ?? null);
  const [teacherId, setTeacherId] = useState<string | null>(existingSlot?.teacher_id ?? null);
  const [notes, setNotes] = useState<string>(existingSlot?.notes ?? "");
  const [customLabel, setCustomLabel] = useState<string>(existingSlot?.custom_label ?? "");
  const [optionalGroupId, setOptionalGroupId] = useState<string | null>(
    existingSlot?.optional_group_id ?? null,
  );
  const [saving, setSaving] = useState(false);

  // Reset form when the drawer re-opens for a different cell.
  useEffect(() => {
    if (!open) return;
    setSlotType(existingSlot?.slot_type ?? "theory");
    setSubjectId(existingSlot?.subject_id ?? null);
    setTeacherId(existingSlot?.teacher_id ?? null);
    setNotes(existingSlot?.notes ?? "");
    setCustomLabel(existingSlot?.custom_label ?? "");
    setOptionalGroupId(existingSlot?.optional_group_id ?? null);
  }, [open, existingSlot]);

  const subjects = useSubjectsForClassV2(classId);
  const teachers = useTeachersForClassSubjectV2(
    classId,
    ACADEMIC_TYPES.includes(slotType) ? subjectId : null,
  );

  // Auto-select the teacher when picking a subject narrows the candidate
  // list to exactly one. Coordinators typically only have one teacher per
  // class+subject, so making them confirm a single-option dropdown is busy
  // work. Multi-teacher classes still show the picker (no preselect).
  // Stays a no-op when the user already chose a teacher manually.
  useEffect(() => {
    if (!ACADEMIC_TYPES.includes(slotType)) return;
    if (!subjectId) return;
    if (teacherId !== null) return;
    if (teachers.isLoading) return;
    const list = teachers.data ?? [];
    if (list.length === 1) {
      setTeacherId(list[0].id);
    }
  }, [slotType, subjectId, teacherId, teachers.isLoading, teachers.data]);

  const academic = !optionalGroupId && ACADEMIC_TYPES.includes(slotType);
  const requiresSubject = academic;
  const requiresTeacher = academic;

  // Optional groups of this class's class_group — each becomes its own
  // entry in the slot-type picker ("Optional 1", "Optional 2", ...).
  const { data: optionalGroups = [] } = useOptionalGroupsForClass(classId);
  const selectedGroup = optionalGroupId
    ? optionalGroups.find((g) => g.id === optionalGroupId) ?? null
    : null;

  const isOther = !optionalGroupId && slotType === "other";
  const customLabelValid = !isOther || customLabel.trim().length > 0;

  const canSubmit = canEdit && !saving && (
    !requiresSubject || subjectId !== null
  ) && (
    !requiresTeacher || teacherId !== null
  ) && customLabelValid;

  const headerTitle = classSection ? `${className} – ${classSection}` : className;
  const headerLine =
    `${day[0].toUpperCase() + day.slice(1)} · ` +
    `${periodSlot.label} (${periodSlot.start_time.slice(0, 5)} – ${periodSlot.end_time.slice(0, 5)})`;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        id: existingSlot?.id,
        class_id: classId,
        period_slot_id: periodSlot.id,
        day,
        academic_year: academicYear,
        // A group cell has no single subject/teacher — store it as a 'free'
        // slot carrying optional_group_id so the slot_type CHECK is satisfied.
        slot_type: optionalGroupId ? "free" : slotType,
        subject_id: optionalGroupId || !requiresSubject ? null : subjectId,
        teacher_id: optionalGroupId || !requiresTeacher ? null : teacherId,
        resource_id: existingSlot?.resource_id ?? null,
        notes: notes.trim() ? notes.trim() : null,
        custom_label: isOther ? customLabel.trim() : null,
        // Legacy band flag always cleared on save — group slots supersede it.
        is_optional_band: false,
        optional_group_id: optionalGroupId,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existingSlot || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(existingSlot.id);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col" data-dirty="true">
        <SheetHeader>
          <SheetTitle>{headerTitle}</SheetTitle>
          <SheetDescription>{headerLine}</SheetDescription>
        </SheetHeader>

        {/* Wrap body in a <form> so the SW dirty-form check
            (form[data-dirty="true"] in main.tsx) actually matches —
            the attribute on SheetContent's <div> is invisible to
            that selector. */}
        <form
          className="flex-1 overflow-y-auto space-y-4 py-4"
          data-dirty="true"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Legacy band cell — the old batches-based band is superseded
              by optional-group slot types. Saving converts the cell. */}
          {existingSlot?.is_optional_band && !optionalGroupId && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertDescription>
                This cell used the old "Optional band" setup. Pick one of the
                Optional slot types below and save to move it to the new system.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Slot type</label>
            <Select
              value={optionalGroupId ? `optional:${optionalGroupId}` : slotType}
              onValueChange={(v) => {
                if (v.startsWith("optional:")) {
                  setOptionalGroupId(v.slice("optional:".length));
                  setSubjectId(null);
                  setTeacherId(null);
                  setCustomLabel("");
                  return;
                }
                setOptionalGroupId(null);
                const next = v as SlotType;
                setSlotType(next);
                if (next === "other") {
                  setSubjectId(null);
                  setTeacherId(null);
                } else {
                  setCustomLabel("");
                }
              }}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SLOT_TYPE_LABEL) as SlotType[])
                  // Hide types that shouldn't be pickable in the cell editor.
                  // `break` / `library` were never in the picker; `arts` /
                  // `assembly` / `free` were removed per school-admin ask —
                  // an admin uses either Theory / Practical / Sports (academic)
                  // or the free-text "Other" for anything else.
                  .filter((t) =>
                    t !== "break" &&
                    t !== "library" &&
                    t !== "arts" &&
                    t !== "assembly" &&
                    t !== "free",
                  )
                  .map((t) => (
                    <SelectItem key={t} value={t}>{SLOT_TYPE_LABEL[t]}</SelectItem>
                  ))}
                {/* One entry per optional group of this class's class group —
                    the whole basket runs in parallel during this period. */}
                {optionalGroups.map((g) => (
                  <SelectItem key={g.id} value={`optional:${g.id}`}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {optionalGroupId && (
              <p className="text-xs text-muted-foreground">
                All subjects of this optional run in parallel. Students and
                teachers each see their own subject, not the group label.
              </p>
            )}
          </div>

          {isOther && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Custom label</label>
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value.slice(0, 40))}
                disabled={!canEdit}
                maxLength={40}
                placeholder="e.g. Lunch, Football, Yoga"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the cell for teachers and students. Max 40 characters.
              </p>
            </div>
          )}

          {requiresSubject && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject</label>
              <Select
                value={subjectId ?? ""}
                onValueChange={(v) => {
                  setSubjectId(v || null);
                  setTeacherId(null);
                }}
                disabled={!canEdit || subjects.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={subjects.isLoading ? "Loading…" : "Pick a subject"} />
                </SelectTrigger>
                <SelectContent>
                  {(subjects.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!subjects.isLoading && (subjects.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No subjects mapped to this class yet. Assign subjects under
                  Classes → this class → Subjects.
                </p>
              )}
            </div>
          )}

          {requiresTeacher && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Teacher</label>
              <Select
                value={teacherId ?? ""}
                onValueChange={(v) => setTeacherId(v || null)}
                disabled={!canEdit || !subjectId || teachers.isLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !subjectId
                        ? "Pick a subject first"
                        : teachers.isLoading
                        ? "Loading teachers…"
                        : "Pick a teacher"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(teachers.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {subjectId && !teachers.isLoading && (teachers.data ?? []).length === 0 && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <AlertDescription>
                    No teachers are assigned to teach this subject for this class.
                    Assign teachers under Classes → this class → Teachers.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Read-only picture of what runs in this period when an
              optional group is selected: every subject + its teacher
              for THIS class (from the normal teacher assignments). */}
          {optionalGroupId && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Subjects in {selectedGroup?.name ?? "this optional"}
              </label>
              {!selectedGroup || selectedGroup.subjects.length === 0 ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <AlertDescription>
                    No subjects in this optional yet. Add them from Syllabus →
                    Add New → Optional Groups.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-1">
                  {selectedGroup.subjects.map((s) => (
                    <div
                      key={s.subject_id}
                      className="flex items-center justify-between gap-3 rounded-md border p-2"
                    >
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      {s.teacher_name ? (
                        <p className="shrink-0 text-xs text-muted-foreground">{s.teacher_name}</p>
                      ) : (
                        <p className="shrink-0 text-xs text-amber-700">No teacher assigned</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
              rows={3}
              placeholder="Anything the teacher should know about this period"
            />
          </div>
        </form>

        <div className="sticky bottom-0 bg-background border-t -mx-6 px-6 py-3 flex items-center gap-2">
          {existingSlot && canEdit && onDelete && (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={saving} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
