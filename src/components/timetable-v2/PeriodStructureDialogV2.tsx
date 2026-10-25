import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import {
  useCreatePeriodStructure,
  useUpdatePeriodStructure,
  useTtPeriodStructureDetail,
  type NewPeriodSlotInput,
  type Weekday,
} from "@/hooks/useTimetableV2";

const DAYS: { value: Weekday; short: string }[] = [
  { value: "monday", short: "Mon" },
  { value: "tuesday", short: "Tue" },
  { value: "wednesday", short: "Wed" },
  { value: "thursday", short: "Thu" },
  { value: "friday", short: "Fri" },
  { value: "saturday", short: "Sat" },
  { value: "sunday", short: "Sun" },
];

const DAY_LONG: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const DEFAULT_SEED: NewPeriodSlotInput[] = [
  { label: "Period 1", start_time: "08:00", end_time: "08:40", kind: "period", days: null },
  { label: "Period 2", start_time: "08:40", end_time: "09:20", kind: "period", days: null },
  { label: "Break",    start_time: "09:20", end_time: "09:40", kind: "break",  days: null },
  { label: "Period 3", start_time: "09:40", end_time: "10:20", kind: "period", days: null },
  { label: "Period 4", start_time: "10:20", end_time: "11:00", kind: "period", days: null },
];

const DEFAULT_WORKING_DAYS: Weekday[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a structure id to enter edit mode; omit/null for create. */
  structureId?: string | null;
}

/** A slot is "default" when it has no explicit days array — meaning it
 *  applies to every working day. Override slots carry a single-day array
 *  identifying the day they replace defaults for. */
function isDefaultSlot(s: NewPeriodSlotInput): boolean {
  return !s.days || s.days.length === 0;
}

/** Slots that drive the schedule for `day` — overrides if any, defaults otherwise. */
function effectiveSlotsForDay(slots: NewPeriodSlotInput[], day: Weekday): NewPeriodSlotInput[] {
  const overrides = slots.filter((s) => s.days?.includes(day));
  if (overrides.length > 0) return overrides;
  return slots.filter(isDefaultSlot);
}

function dayHasOverride(slots: NewPeriodSlotInput[], day: Weekday): boolean {
  return slots.some((s) => s.days?.includes(day));
}

/** True when two slot lists describe the same schedule (same set of rows
 *  by label/start/end/kind, regardless of `days` tagging). Used to detect
 *  "user opened the day dialog and saved without changing anything" so we
 *  don't write redundant override rows that just duplicate the defaults. */
function slotsAreEquivalent(a: NewPeriodSlotInput[], b: NewPeriodSlotInput[]): boolean {
  if (a.length !== b.length) return false;
  const sig = (s: NewPeriodSlotInput) =>
    `${s.start_time}|${s.end_time}|${s.label.trim()}|${s.kind}`;
  const aS = [...a.map(sig)].sort();
  const bS = [...b.map(sig)].sort();
  return aS.every((v, i) => v === bS[i]);
}

export default function PeriodStructureDialogV2({ open, onOpenChange, structureId }: Props) {
  const isEdit = !!structureId;
  const detailQuery = useTtPeriodStructureDetail(open ? structureId ?? null : null);
  const detail = detailQuery.data ?? null;

  const [name, setName] = useState("");
  const [workingDays, setWorkingDays] = useState<Weekday[]>(DEFAULT_WORKING_DAYS);
  const [slots, setSlots] = useState<NewPeriodSlotInput[]>(DEFAULT_SEED);
  const [editingDay, setEditingDay] = useState<Weekday | null>(null);

  const create = useCreatePeriodStructure();
  const update = useUpdatePeriodStructure();
  const isPending = create.isPending || update.isPending;

  // Hydrate form on open.
  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      setName("");
      setWorkingDays(DEFAULT_WORKING_DAYS);
      setSlots(DEFAULT_SEED);
      return;
    }
    if (detail) {
      setName(detail.name);
      setWorkingDays(detail.working_days);
      setSlots(
        detail.slots.length > 0
          ? detail.slots.map((s) => ({ ...s, days: s.days ?? null }))
          : DEFAULT_SEED,
      );
    }
  }, [open, isEdit, detail]);

  // "In use" == structure is assigned to 1+ classes. Was called
  // `slotsInUse` when the schedule was hard-locked to read-only; now edits
  // are always allowed, but this flag routes save through the "patch" mode
  // and gates the destructive-delete confirmation modal below.
  const slotsInUse = isEdit && (detail?.usedByClassCount ?? 0) > 0;

  // Snapshot of the ids present when the dialog was hydrated. Used at save
  // time to compute which rows the user deleted so we can confirm the
  // cascade before applying it.
  const originalSlotIds = useMemo(
    () =>
      new Set(
        (detail?.slots ?? [])
          .map((s) => s.id)
          .filter((id): id is string => !!id),
      ),
    [detail],
  );

  // Confirmation-modal state for destructive deletes. Set when the user
  // hits Save on an in-use structure with pending row deletions; cleared
  // on cancel or after the confirmed save completes.
  const [pendingSave, setPendingSave] = useState<{
    deletedSlotIds: string[];
    affectedCells: number;
  } | null>(null);
  const [countingCells, setCountingCells] = useState(false);

  const defaultSlots = useMemo(() => slots.filter(isDefaultSlot), [slots]);

  function toggleDay(d: Weekday) {
    setWorkingDays((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      // If a day is removed from working_days, drop any override slots that
      // referenced only that day. Override slots keep their other days.
      if (!next.includes(d)) {
        setSlots((prevSlots) =>
          prevSlots
            .map((s) => {
              if (!s.days) return s;
              const trimmed = s.days.filter((x) => x !== d);
              return trimmed.length > 0 ? { ...s, days: trimmed } : null;
            })
            .filter((s): s is NewPeriodSlotInput => s !== null),
        );
      }
      return next;
    });
  }

  function updateSlot(idx: number, patch: Partial<NewPeriodSlotInput>) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addSlot() {
    const last = defaultSlots[defaultSlots.length - 1];
    const nextStart = last ? last.end_time : "08:00";
    const nextEnd = bumpHM(nextStart, 40);
    setSlots((prev) => [
      ...prev,
      {
        label: `Period ${prev.filter((p) => p.kind === "period" && isDefaultSlot(p)).length + 1}`,
        start_time: nextStart,
        end_time: nextEnd,
        kind: "period",
        days: null,
      },
    ]);
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Drop the override slots for `day`; that day reverts to defaults. */
  function clearOverrideForDay(day: Weekday) {
    setSlots((prev) =>
      prev
        .map((s) => {
          if (!s.days?.includes(day)) return s;
          const trimmed = s.days.filter((x) => x !== day);
          return trimmed.length > 0 ? { ...s, days: trimmed } : null;
        })
        .filter((s): s is NewPeriodSlotInput => s !== null),
    );
  }

  /** Replace the override slot list for `day` with a new list. Other days
   *  that previously shared an override row keep their copy via deep-clone
   *  semantics, so this only mutates `day`. */
  function replaceOverrideForDay(day: Weekday, next: NewPeriodSlotInput[]) {
    setSlots((prev) => {
      // Remove `day` from any existing rows; if a row had ONLY `day`, drop it.
      const trimmed = prev
        .map((s) => {
          if (!s.days?.includes(day)) return s;
          const remaining = s.days.filter((x) => x !== day);
          return remaining.length > 0 ? { ...s, days: remaining } : null;
        })
        .filter((s): s is NewPeriodSlotInput => s !== null);
      // Append the new override rows tagged with this day. Strip any id so
      // the patch mode treats these as fresh INSERTs (the trimmed originals
      // above already keep their ids and get UPDATEd in place).
      const newRows = next.map((s) => ({ ...s, id: undefined, days: [day] as Weekday[] }));
      return [...trimmed, ...newRows];
    });
  }

  const validRows = (s: NewPeriodSlotInput) =>
    s.label.trim() && s.start_time && s.end_time && s.start_time < s.end_time;

  const canSubmit =
    !isPending &&
    !countingCells &&
    !(isEdit && detailQuery.isLoading) &&
    name.trim().length > 0 &&
    workingDays.length > 0 &&
    slots.length > 0 &&
    slots.every(validRows);

  async function handleSave() {
    // Create path — brand-new structure, no in-use gating.
    if (!isEdit || !structureId) {
      await create.mutateAsync({
        name: name.trim(),
        working_days: workingDays,
        slots,
      });
      onOpenChange(false);
      return;
    }

    // Edit path. Compute what the user removed vs. the hydrated snapshot.
    const currentIds = new Set(
      slots.map((s) => s.id).filter((id): id is string => !!id),
    );
    const deletedSlotIds = [...originalSlotIds].filter((id) => !currentIds.has(id));

    // Structure not yet assigned to any class — nuclear replace is safe.
    if (!slotsInUse) {
      await update.mutateAsync({
        id: structureId,
        name: name.trim(),
        working_days: workingDays,
        slots,
        slotsAction: "replace",
      });
      onOpenChange(false);
      return;
    }

    // Structure IS assigned. If the user deleted any rows, tt_slots cells
    // referencing them will cascade-delete — confirm the count first.
    if (deletedSlotIds.length > 0) {
      setCountingCells(true);
      try {
        const { count, error } = await supabase
          .from("tt_slots")
          .select("*", { count: "exact", head: true })
          .in("period_slot_id", deletedSlotIds);
        if (error) throw error;
        setPendingSave({ deletedSlotIds, affectedCells: count ?? 0 });
      } catch (e) {
        toastError(e as Error, {
          fallback: "Couldn't count the affected cells. Try again.",
          context: "countAffectedCells",
        });
      } finally {
        setCountingCells(false);
      }
      return;
    }

    // Assigned + no deletions: safe patch (edits + adds only).
    await update.mutateAsync({
      id: structureId,
      name: name.trim(),
      working_days: workingDays,
      slots,
      slotsAction: "patch",
      deletedSlotIds: [],
    });
    onOpenChange(false);
  }

  async function confirmDestructiveSave() {
    if (!pendingSave || !structureId) return;
    await update.mutateAsync({
      id: structureId,
      name: name.trim(),
      working_days: workingDays,
      slots,
      slotsAction: "patch",
      deletedSlotIds: pendingSave.deletedSlotIds,
    });
    setPendingSave(null);
    onOpenChange(false);
  }

  const showLoadingDetail = isEdit && detailQuery.isLoading;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl" data-dirty="true">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit period structure" : "New period structure"}</DialogTitle>
            <DialogDescription>
              A structure is a weekly grid shared by one or more classes.
              {isEdit ? " Update the name, working days, or schedule." : " You can assign it to classes after creating."}
            </DialogDescription>
          </DialogHeader>

          {showLoadingDetail ? (
            <div className="py-6 space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            // Wrap body in a <form> so the SW dirty-form check
            // (form[data-dirty="true"] in main.tsx) actually matches —
            // the attribute on DialogContent's <div> is invisible to
            // that selector.
            <form
              className="space-y-4 py-2"
              data-dirty="true"
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Primary 2026-27"
                />
              </div>

              <div className="space-y-2">
                <Label>Working days</Label>
                <p className="text-xs text-muted-foreground">
                  Tap a day to toggle it. Use the pencil to give a day its own
                  schedule (e.g. shorter Saturdays).
                </p>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => {
                    const on = workingDays.includes(d.value);
                    const overridden = dayHasOverride(slots, d.value);
                    return (
                      <div
                        key={d.value}
                        className={cn(
                          "inline-flex items-stretch rounded-md border text-sm overflow-hidden transition-colors",
                          on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-input",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleDay(d.value)}
                          className={cn(
                            "px-3 py-1.5 transition-colors",
                            on ? "hover:bg-primary/90" : "hover:bg-accent",
                          )}
                        >
                          {d.short}
                          {overridden && (
                            <span
                              className={cn(
                                "ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                                on ? "bg-white/80" : "bg-amber-500",
                              )}
                              aria-label="Has override schedule"
                            />
                          )}
                        </button>
                        {on && (
                          <button
                            type="button"
                            onClick={() => setEditingDay(d.value)}
                            disabled={slotsInUse}
                            title={
                              overridden
                                ? `Edit ${DAY_LONG[d.value]} schedule`
                                : `Set custom schedule for ${DAY_LONG[d.value]}`
                            }
                            className={cn(
                              "px-2 flex items-center justify-center border-l border-primary-foreground/30 transition-colors",
                              "hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                            )}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Default periods &amp; breaks</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSlot}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add row
                  </Button>
                </div>

                {slotsInUse && (
                  <Alert className="bg-amber-50 border-amber-200 text-amber-900">
                    <AlertDescription className="text-xs">
                      This structure is used by {detail?.usedByClassCount ?? 0} class
                      {(detail?.usedByClassCount ?? 0) === 1 ? "" : "es"}. Renaming rows
                      and shifting times apply everywhere as soon as you save. Removing
                      a row will delete its scheduled cells across every class using this
                      structure &mdash; you&apos;ll be asked to confirm the exact count
                      before that happens.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="border rounded-md divide-y">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground font-medium bg-muted/30">
                    <div className="col-span-3">Label</div>
                    <div className="col-span-2">Start</div>
                    <div className="col-span-2">End</div>
                    <div className="col-span-4 text-center">Assembly/Break/Other</div>
                    <div className="col-span-1"></div>
                  </div>
                  {slots.map((s, idx) => {
                    if (!isDefaultSlot(s)) return null;
                    const invalidTime = s.start_time && s.end_time && s.start_time >= s.end_time;
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                        <div className="col-span-3">
                          <Input
                            value={s.label}
                            onChange={(e) => updateSlot(idx, { label: e.target.value })}
                            placeholder="Period 1 / Break / Assembly"
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            type="time"
                            value={s.start_time}
                            onChange={(e) => updateSlot(idx, { start_time: e.target.value })}
                            className={cn(invalidTime && "border-destructive")}
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            type="time"
                            value={s.end_time}
                            onChange={(e) => updateSlot(idx, { end_time: e.target.value })}
                            className={cn(invalidTime && "border-destructive")}
                          />
                        </div>
                        <div className="col-span-4 flex justify-center">
                          <Checkbox
                            checked={s.kind === "break"}
                            onCheckedChange={(v) => updateSlot(idx, { kind: v ? "break" : "period" })}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeSlot(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {slots.some((s) => s.start_time && s.end_time && s.start_time >= s.end_time) && (
                  <Alert className="bg-amber-50 border-amber-200 text-amber-900">
                    <AlertDescription className="text-xs">
                      Every row&apos;s end time must be later than its start time.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </form>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!canSubmit}>
              {(isPending || countingCells) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isEdit ? "Save changes" : "Create structure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingDay && (
        <DayOverrideDialog
          day={editingDay}
          slots={slots}
          locked={slotsInUse}
          onClose={() => setEditingDay(null)}
          onClearOverride={() => clearOverrideForDay(editingDay)}
          onReplaceOverride={(next) => replaceOverrideForDay(editingDay, next)}
        />
      )}

      <AlertDialog
        open={!!pendingSave}
        onOpenChange={(o) => {
          if (!o) setPendingSave(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scheduled cells?</AlertDialogTitle>
            <AlertDialogDescription>
              You removed {pendingSave?.deletedSlotIds.length ?? 0}{" "}
              period{(pendingSave?.deletedSlotIds.length ?? 0) === 1 ? "" : "s"} from
              a structure used by {detail?.usedByClassCount ?? 0}{" "}
              class{(detail?.usedByClassCount ?? 0) === 1 ? "" : "es"}.
              Saving now will permanently delete{" "}
              <strong>{pendingSave?.affectedCells ?? 0}</strong>{" "}
              scheduled cell{(pendingSave?.affectedCells ?? 0) === 1 ? "" : "s"}
              {" "}already placed in those periods. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep those periods</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDestructiveSave}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete cells and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface DayOverrideProps {
  day: Weekday;
  slots: NewPeriodSlotInput[];
  locked: boolean;
  onClose: () => void;
  onClearOverride: () => void;
  onReplaceOverride: (next: NewPeriodSlotInput[]) => void;
}

/**
 * Single-step day editor. Editable rows are shown immediately, seeded from
 * the current effective schedule (override rows if any exist, otherwise the
 * defaults). Saving writes the rows as a Saturday-only override (replacing
 * any prior override for that day) — defaults are never touched.
 *
 * "Reset to default" surfaces only when the day already has an override; it
 * drops the override rows and the day reverts to the shared schedule.
 */
function DayOverrideDialog({
  day,
  slots,
  locked,
  onClose,
  onClearOverride,
  onReplaceOverride,
}: DayOverrideProps) {
  const hasOverride = dayHasOverride(slots, day);
  // Seed the editable buffer from the current effective schedule. When no
  // override exists yet, that's the defaults — saving turns them into a
  // day-specific override copy.
  const initial = useMemo(() => effectiveSlotsForDay(slots, day), [slots, day]);
  const [draft, setDraft] = useState<NewPeriodSlotInput[]>(initial);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const validRow = (s: NewPeriodSlotInput) =>
    s.label.trim() && s.start_time && s.end_time && s.start_time < s.end_time;
  const canSave = !locked && draft.length > 0 && draft.every(validRow);

  function patch(idx: number, p: Partial<NewPeriodSlotInput>) {
    if (locked) return;
    setDraft((prev) => prev.map((s, i) => (i === idx ? { ...s, ...p } : s)));
  }

  function addRow() {
    if (locked) return;
    const last = draft[draft.length - 1];
    const nextStart = last ? last.end_time : "08:00";
    const nextEnd = bumpHM(nextStart, 40);
    setDraft((prev) => [
      ...prev,
      {
        label: `Period ${prev.filter((p) => p.kind === "period").length + 1}`,
        start_time: nextStart,
        end_time: nextEnd,
        kind: "period",
        days: [day],
      },
    ]);
  }

  function removeRow(idx: number) {
    if (locked) return;
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleResetToDefaults() {
    onClearOverride();
    onClose();
  }

  function handleSaveOverride() {
    // No point creating override rows that exactly mirror the defaults —
    // they would just duplicate the period columns in the grid. Treat that
    // as an implicit "reset to default".
    const defaults = slots.filter(isDefaultSlot);
    if (slotsAreEquivalent(draft, defaults)) {
      onClearOverride();
    } else {
      onReplaceOverride(draft);
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-dirty="true">
        <DialogHeader>
          <DialogTitle>{DAY_LONG[day]} schedule</DialogTitle>
          <DialogDescription>
            {hasOverride
              ? `${DAY_LONG[day]} uses its own schedule. Edit the rows below. Your changes only affect ${DAY_LONG[day]}.`
              : `Customize the schedule for ${DAY_LONG[day]} only. Other days keep using the default schedule.`}
          </DialogDescription>
        </DialogHeader>

        {/* Wrap body in a <form> so the SW dirty-form check
            (form[data-dirty="true"] in main.tsx) actually matches —
            the attribute on DialogContent's <div> is invisible to
            that selector. */}
        <form
          className="space-y-3 py-2"
          data-dirty="true"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between">
            <Label>{DAY_LONG[day]} periods</Label>
            <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={locked}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add row
            </Button>
          </div>

          {!hasOverride && (
            <Alert className="bg-sky-50 border-sky-200 text-sky-900">
              <AlertDescription className="text-xs">
                The rows below are seeded from the default schedule. Saving will
                turn them into a {DAY_LONG[day]}-only schedule. Other days are
                unaffected.
              </AlertDescription>
            </Alert>
          )}

          <div className={cn("border rounded-md divide-y", locked && "opacity-70")}>
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground font-medium bg-muted/30">
              <div className="col-span-3">Label</div>
              <div className="col-span-2">Start</div>
              <div className="col-span-2">End</div>
              <div className="col-span-4 text-center">Assembly/Break/Other</div>
              <div className="col-span-1"></div>
            </div>
            {draft.map((s, idx) => {
              const invalidTime = s.start_time && s.end_time && s.start_time >= s.end_time;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                  <div className="col-span-3">
                    <Input
                      value={s.label}
                      onChange={(e) => patch(idx, { label: e.target.value })}
                      placeholder="Period 1 / Break / Assembly"
                      disabled={locked}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="time"
                      value={s.start_time}
                      onChange={(e) => patch(idx, { start_time: e.target.value })}
                      className={cn(invalidTime && "border-destructive")}
                      disabled={locked}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="time"
                      value={s.end_time}
                      onChange={(e) => patch(idx, { end_time: e.target.value })}
                      className={cn(invalidTime && "border-destructive")}
                      disabled={locked}
                    />
                  </div>
                  <div className="col-span-4 flex justify-center">
                    <Checkbox
                      checked={s.kind === "break"}
                      onCheckedChange={(v) => patch(idx, { kind: v ? "break" : "period" })}
                      disabled={locked}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => removeRow(idx)}
                      disabled={locked}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {draft.some((s) => s.start_time && s.end_time && s.start_time >= s.end_time) && (
            <Alert className="bg-amber-50 border-amber-200 text-amber-900">
              <AlertDescription className="text-xs">
                Every row&apos;s end time must be later than its start time.
              </AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {hasOverride && (
            <Button variant="outline" onClick={handleResetToDefaults} disabled={locked}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset to default
            </Button>
          )}
          <Button onClick={handleSaveOverride} disabled={!canSave}>
            Save {DAY_LONG[day]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function bumpHM(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}
