import { useMemo, useState } from "react";
import { CalendarIcon, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { localISODate } from "@/lib/substitutions";
import {
  useInstitutionTeachers,
  useUpsertSubstitution,
  useDeleteSubstitution,
  type PeriodSlotV2,
  type ResolvedSlotV2,
  type SubstitutionRow,
  type Weekday,
} from "@/hooks/useTimetableV2";

// --------------------------------------------------------------
// SubstituteDialogV2 — open on cell tap when substitute mode is
// active. Pick a date (defaults to next occurrence of the slot's
// weekday), pick a substitute teacher, optionally add a reason,
// save. Existing substitutions for this slot are listed at the
// bottom with a remove button.
// --------------------------------------------------------------

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** Returns yyyy-mm-dd string for the next occurrence of `weekday` on or after today. */
function nextOccurrenceISO(weekday: Weekday): string {
  const today = new Date();
  const targetIdx = WEEKDAY_INDEX[weekday];
  const currentIdx = today.getDay();
  const diff = (targetIdx - currentIdx + 7) % 7;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return localISODate(target);
}

/** Weekday index (0 = Sunday) of a yyyy-mm-dd string, read as a local date. */
function weekdayIndexOf(iso: string): number | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay();
}

function formatHM(t: string): string {
  return t.slice(0, 5);
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  classSection: string | null;
  day: Weekday;
  periodSlot: PeriodSlotV2;
  existingSlot: ResolvedSlotV2;
  existingSubstitutions: SubstitutionRow[];
  /** The upcoming-covers query failed; say so rather than show an empty list. */
  existingError?: boolean;
  onRetryExisting?: () => void;
  canEdit: boolean;
}

export default function SubstituteDialogV2({
  open,
  onOpenChange,
  className,
  classSection,
  day,
  periodSlot,
  existingSlot,
  existingSubstitutions,
  existingError = false,
  onRetryExisting,
  canEdit,
}: Props) {
  const [date, setDate] = useState<string>(() => nextOccurrenceISO(day));
  const [substituteId, setSubstituteId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");

  const teachers = useInstitutionTeachers();
  const upsertMut = useUpsertSubstitution();
  const deleteMut = useDeleteSubstitution();

  // Don't suggest the slot's own teacher as a substitute.
  const teacherOptions = useMemo(() => {
    const all = teachers.data ?? [];
    return existingSlot.teacher_id
      ? all.filter((t) => t.id !== existingSlot.teacher_id)
      : all;
  }, [teachers.data, existingSlot.teacher_id]);

  const headerTitle = classSection ? `${className} – ${classSection}` : className;
  const dayLabel = capitalize(day);
  // The cell is a recurring weekday period, so a cover for it only means
  // something on that weekday. The picker allows any date; a Wednesday cover
  // for a Monday period would be saved and then match no timetable view.
  const dateMatchesDay = !!date && weekdayIndexOf(date) === WEEKDAY_INDEX[day];
  const canSubmit =
    canEdit && !!substituteId && dateMatchesDay && !upsertMut.isPending;

  function handleSave() {
    if (!substituteId || !dateMatchesDay) return;
    // mutate, not mutateAsync: onError already toasts, and an awaited
    // rejection here surfaced as an "Unhandled rejection" in the console.
    upsertMut.mutate(
      {
        slot_id: existingSlot.id,
        date,
        substitute_teacher_id: substituteId,
        reason: reason.trim() ? reason.trim() : null,
      },
      {
        onSuccess: () => {
          // Keep dialog open so the user can add more dates for the same slot.
          setSubstituteId(null);
          setReason("");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-dirty="true">
        <DialogHeader>
          <DialogTitle>Mark substitute</DialogTitle>
          <DialogDescription>
            {headerTitle} · {dayLabel} · {periodSlot.label}
            {" "}({formatHM(periodSlot.start_time)} – {formatHM(periodSlot.end_time)})
            {existingSlot.teacher_name && (
              <>
                {" · "}
                Normally{" "}
                <span className="font-medium">{existingSlot.teacher_name}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Wrap body in a <form> so the SW dirty-form check
            (form[data-dirty="true"] in main.tsx) actually matches —
            the attribute on DialogContent's <div> is invisible to
            that selector. */}
        <form
          className="space-y-4 py-2"
          data-dirty="true"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1">
              <CalendarIcon className="h-3.5 w-3.5" />
              Date
            </label>
            <Input
              type="date"
              value={date}
              min={localISODate()}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canEdit}
              aria-invalid={!!date && !dateMatchesDay}
            />
            {date && !dateMatchesDay ? (
              <p className="text-xs text-destructive">
                This period runs on {dayLabel}s. Pick a {dayLabel}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Defaults to the next {dayLabel}.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Substitute teacher</label>
            <Select
              value={substituteId ?? ""}
              onValueChange={(v) => setSubstituteId(v || null)}
              disabled={!canEdit || teachers.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={teachers.isLoading ? "Loading teachers…" : "Pick a teacher"} />
              </SelectTrigger>
              <SelectContent>
                {teacherOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canEdit}
              rows={2}
              placeholder="Sick leave, training, etc."
            />
          </div>

          {existingError && (
            <div className="border-t pt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 text-destructive">
                {"Couldn't load the upcoming substitutions for this period."}
              </span>
              {onRetryExisting && (
                <Button type="button" variant="outline" size="sm" onClick={onRetryExisting}>
                  Try again
                </Button>
              )}
            </div>
          )}

          {!existingError && existingSubstitutions.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Upcoming substitutions for this cell
              </h3>
              <ul className="space-y-1.5">
                {existingSubstitutions.map((s) => {
                  // A pending row is the auto-flow saying "the teacher is out
                  // and nobody covers yet". Saving a substitute for that date
                  // above fills it. Removing it would not help: the attendance
                  // pass re-opens it within 15 minutes while the teacher is
                  // still marked absent.
                  const needsCover = s.status === "pending" || !s.substitute_teacher_id;
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "flex items-center gap-2 text-sm rounded-md border p-2",
                        needsCover
                          ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-200"
                          : "bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-200",
                      )}
                    >
                      <Badge
                        variant="outline"
                        className={
                          needsCover
                            ? "border-amber-300 text-amber-900 dark:border-amber-500/40 dark:text-amber-200"
                            : "border-purple-300 text-purple-900 dark:border-purple-500/40 dark:text-purple-200"
                        }
                      >
                        {s.date}
                      </Badge>
                      <span className="flex-1 truncate">
                        {needsCover
                          ? "Teacher absent, no cover yet"
                          : s.substitute_teacher_name ?? "Unknown teacher"}
                        {s.reason && <span className="opacity-80"> · {s.reason}</span>}
                      </span>
                      {canEdit && !needsCover && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteMut.mutate(s.id)}
                          disabled={deleteMut.isPending}
                          aria-label={`Remove the substitute for ${s.date}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {upsertMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save substitute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
