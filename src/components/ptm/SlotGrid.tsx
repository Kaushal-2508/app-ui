import type { ReactNode } from "react";
import { Check, Loader2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatClockTime } from "@/lib/ptm";
import type { PTMSlotRow } from "@/hooks/ptm";

interface Props<T extends PTMSlotRow> {
  slots: T[];
  /** Students pick a slot; staff read names and mark attendance. */
  mode: "student" | "staff";
  selected?: string | null;
  onSelect?: (slotTime: string) => void;
  /** Staff only: mark a booking attended or not. */
  onToggleAttended?: (bookingId: string, attended: boolean) => void;
  attendedPendingId?: string | null;
  /** Staff only: open the student's remarks (teachers). */
  onRemarks?: (studentId: string, studentName: string) => void;
  disabled?: boolean;
  /** Student tiles: a slot that can no longer be picked (it has already
   *  started), greyed and labelled "Past" without being "taken". */
  isUnavailable?: (slot: T) => boolean;
  /** Student tiles: why an unavailable slot is greyed when it is not that it
   *  has started (`short` on the tile, `long` in the accessible name); null
   *  or absent reads "Past". */
  unavailableLabel?: (slot: T) => { short: string; long: string } | null;
  /** Staff rows: a second line under the name (an online PTM shows the class). */
  renderMeta?: (slot: T) => ReactNode;
  /** Staff rows: controls before the Attended tick (an online PTM shows Join). */
  renderActions?: (slot: T) => ReactNode;
}

/**
 * The computed slot grid for one class (or, online, one teacher). Students
 * see free, taken and their own slot (never a name); staff see who booked
 * what and tick attendance. Bookings that no longer fit the grid (the PTM
 * was rescheduled) are listed separately so they are never silently hidden.
 */
export function SlotGrid<T extends PTMSlotRow>({
  slots,
  mode,
  selected,
  onSelect,
  onToggleAttended,
  attendedPendingId,
  onRemarks,
  disabled,
  isUnavailable,
  unavailableLabel,
  renderMeta,
  renderActions,
}: Props<T>) {
  const onGrid = slots.filter((s) => !s.off_grid);
  const offGrid = slots.filter((s) => s.off_grid);

  if (slots.length === 0) {
    return <p className="text-sm text-ink-500">No slots fit between the start and end time.</p>;
  }

  return (
    <div className="space-y-4">
      {mode === "student" ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {onGrid.map((slot) => {
            const taken = !!slot.booking_id && !slot.is_mine;
            const past = !taken && !slot.is_mine && (isUnavailable?.(slot) ?? false);
            const why = past ? (unavailableLabel?.(slot) ?? null) : null;
            const isSelected = selected === slot.slot_time;
            return (
              <Button
                key={slot.slot_time}
                type="button"
                variant="outline"
                // Their own slot is shown, not picked: "moving" onto it is a no-op.
                disabled={disabled || taken || past || slot.is_mine}
                onClick={() => onSelect?.(slot.slot_time)}
                aria-pressed={isSelected}
                aria-label={`${formatClockTime(slot.slot_time)}${taken ? ", taken" : past ? `, ${why?.long ?? "already started"}` : slot.is_mine ? ", your slot" : ""}`}
                // The states carry their own colours, so a disabled tile keeps
                // full opacity (the base Button would fade it to half).
                className={cn(
                  "h-12 flex-col gap-0 font-normal transition-colors duration-200 disabled:opacity-100 [&_svg]:size-3.5",
                  taken && "border-surface-stroke bg-muted text-ink-400 line-through",
                  past && "border-dashed border-surface-stroke bg-muted/60 text-ink-400",
                  !taken && !past && !isSelected && !slot.is_mine && "border-surface-stroke bg-surface-card text-ink-900 hover:border-brand-primary",
                  !taken && !past && isSelected && "border-brand-primary bg-brand-primary text-white hover:bg-brand-primary hover:text-white",
                  !taken && !past && !isSelected && slot.is_mine && "border-brand-primary bg-brand-primary/10 text-brand-primary",
                )}
              >
                <span className="font-medium">{formatClockTime(slot.slot_time)}</span>
                {past && <span className="text-[10px] leading-none">{why?.short ?? "Past"}</span>}
                {slot.is_mine && !isSelected && <span className="text-[10px] leading-none">Yours</span>}
                {isSelected && <Check aria-hidden="true" />}
              </Button>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-surface-stroke overflow-hidden rounded-md border border-surface-stroke">
          {onGrid.map((slot) => (
            <SlotRow
              // Several teachers' bookings can share a time in the everyone view.
              key={`${slot.slot_time}-${slot.booking_id ?? "free"}`}
              slot={slot}
              onToggleAttended={onToggleAttended}
              onRemarks={onRemarks}
              pending={attendedPendingId === slot.booking_id}
              disabled={disabled}
              meta={renderMeta?.(slot)}
              actions={renderActions?.(slot)}
            />
          ))}
        </ul>
      )}

      {offGrid.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-600">
            {mode === "student"
              ? "Your booking no longer fits the new time. Pick a slot above to move it."
              : "Booked before the time changed; these families need a new slot."}
          </p>
          {mode === "staff" && (
            <ul className="divide-y divide-surface-stroke overflow-hidden rounded-md border border-dashed border-surface-stroke">
              {offGrid.map((slot) => (
                <SlotRow
                  key={`${slot.slot_time}-${slot.booking_id}`}
                  slot={slot}
                  onToggleAttended={onToggleAttended}
                  onRemarks={onRemarks}
                  pending={attendedPendingId === slot.booking_id}
                  disabled={disabled}
                  meta={renderMeta?.(slot)}
                  actions={renderActions?.(slot)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  onToggleAttended,
  onRemarks,
  pending,
  disabled,
  meta,
  actions,
}: {
  slot: PTMSlotRow;
  onToggleAttended?: (bookingId: string, attended: boolean) => void;
  onRemarks?: (studentId: string, studentName: string) => void;
  pending: boolean;
  disabled?: boolean;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const booked = !!slot.booking_id;
  return (
    // With actions the row wraps on a phone: time and name on the first
    // line, Join / Remarks / Attended on the second.
    <li className={cn("flex items-center gap-3 px-3 py-2 text-sm", actions && "flex-wrap")}>
      <span className="w-20 shrink-0 font-medium tabular-nums text-ink-900">
        {formatClockTime(slot.slot_time)}
      </span>
      <span className={cn("min-w-0 flex-1", booked ? "text-ink-900" : "text-ink-400")}>
        <span className="block truncate">{booked ? slot.student_name ?? "Booked" : "Free"}</span>
        {meta && <span className="block truncate text-xs text-ink-500">{meta}</span>}
      </span>
      {actions && <span className="flex basis-full items-center gap-2 sm:basis-auto">{actions}</span>}
      {booked && slot.student_id && onRemarks && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs"
          onClick={() => onRemarks(slot.student_id as string, slot.student_name ?? "")}
        >
          <MessageSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Remarks
        </Button>
      )}
      {booked && slot.booking_id && onToggleAttended && (
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-600">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
          ) : (
            <Checkbox
              checked={slot.attended === true}
              disabled={disabled}
              onCheckedChange={(checked) => onToggleAttended(slot.booking_id as string, checked === true)}
              aria-label={`Mark ${slot.student_name ?? "this booking"} attended`}
            />
          )}
          Attended
        </label>
      )}
    </li>
  );
}
