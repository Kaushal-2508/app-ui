import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { buildSlotGrid, formatClockTime } from "@/lib/ptm";
import { DURATIONS, withCurrent } from "./formOptions";

export interface OnlineTimingValue {
  scheduledDate: string;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
  bookingCutoffMinutes: number;
}

interface Props {
  value: OnlineTimingValue;
  onChange: <K extends keyof OnlineTimingValue>(key: K, value: OnlineTimingValue[K]) => void;
  /** Editing with bookings: the slot length cannot change any more. */
  durationLocked?: boolean;
  /** The gap is set once, at creation. */
  bufferLocked?: boolean;
  timeError: string | null;
}

const GAPS = [0, 5, 10];

const TOGGLE_ITEM =
  "h-9 px-0 text-ink-600 hover:bg-surface-card hover:text-ink-900 data-[state=on]:bg-brand-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-card-sm";

/**
 * Date, times, slot length and the gap between slots for an online PTM,
 * with a live count of the slots each teacher gets. The grid preview uses
 * the same buildSlotGrid the booking sheet draws from, so what the form
 * promises is what families see.
 */
export function OnlineTimingFields({ value, onChange, durationLocked, bufferLocked, timeError }: Props) {
  const durationOptions = withCurrent(
    DURATIONS.map((d) => ({ value: d, label: `${d} minutes` })),
    value.slotDurationMinutes,
    (v) => ({ value: v, label: `${v} minutes` }),
  );
  const gapOptions = withCurrent(
    GAPS.map((g) => ({ value: g, label: g === 0 ? "No gap" : `${g} min` })),
    value.slotBufferMinutes,
    (v) => ({ value: v, label: `${v} min` }),
  );

  const preview = useMemo(() => {
    if (!value.startTime || !value.endTime) return null;
    const slots = buildSlotGrid(
      value.startTime,
      value.endTime,
      value.slotDurationMinutes,
      value.slotBufferMinutes,
    );
    if (slots.length === 0) return "No slot fits between these times.";
    const gap = value.slotBufferMinutes > 0 ? ` with a ${value.slotBufferMinutes}-minute gap` : "";
    return `${slots.length} ${slots.length === 1 ? "slot" : "slots"} per teacher from ${formatClockTime(slots[0])}: ${value.slotDurationMinutes} minutes each${gap}. Last slot ${formatClockTime(slots[slots.length - 1])}.`;
  }, [value.startTime, value.endTime, value.slotDurationMinutes, value.slotBufferMinutes]);

  return (
    <div className="space-y-4">
      {/* One row from sm up; on a phone the date takes the full width and
          the two times share the row below it (as the regular form). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rptm-date">Date</Label>
          <Input
            id="rptm-date"
            type="date"
            value={value.scheduledDate}
            onChange={(e) => onChange("scheduledDate", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rptm-start">Starts</Label>
          <Input
            id="rptm-start"
            type="time"
            value={value.startTime}
            onChange={(e) => onChange("startTime", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rptm-end">Ends</Label>
          <Input
            id="rptm-end"
            type="time"
            value={value.endTime}
            onChange={(e) => onChange("endTime", e.target.value)}
          />
        </div>
      </div>
      {timeError && <p className="text-sm text-rose-600 dark:text-rose-400">{timeError}</p>}

      {/* Slot length and gap side by side from sm up: the sheet is 672px wide
          there and two short toggle rows stacked left half of it empty. */}
      <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label id="rptm-duration-label">Slot length</Label>
        <ToggleGroup
          type="single"
          aria-labelledby="rptm-duration-label"
          value={String(value.slotDurationMinutes)}
          disabled={durationLocked}
          onValueChange={(v) => {
            // Radix sends "" when the chosen item is tapped again.
            if (v) onChange("slotDurationMinutes", Number(v));
          }}
          className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted/70 p-1"
        >
          {durationOptions.map((d) => (
            <ToggleGroupItem key={d.value} value={String(d.value)} aria-label={d.label} className={TOGGLE_ITEM}>
              {d.value} min
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {durationLocked && (
          <p className="text-xs text-ink-500">Slot length can only change while no family has booked.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label id="rptm-gap-label">Gap between slots</Label>
        <ToggleGroup
          type="single"
          aria-labelledby="rptm-gap-label"
          value={String(value.slotBufferMinutes)}
          disabled={bufferLocked}
          onValueChange={(v) => {
            if (v) onChange("slotBufferMinutes", Number(v));
          }}
          className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted/70 p-1"
        >
          {gapOptions.map((g) => (
            <ToggleGroupItem key={g.value} value={String(g.value)} aria-label={g.label} className={TOGGLE_ITEM}>
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-ink-500">
          {bufferLocked
            ? "The gap is set when the PTM is created."
            : "A short break between one family and the next."}
        </p>
      </div>
      </div>

      <div className="space-y-1 rounded-xl bg-muted/60 px-3 py-2 text-xs text-ink-600 ring-1 ring-inset ring-surface-stroke">
        {preview && <p className="font-medium text-ink-900">{preview}</p>}
        {/* Online books per slot: a family can still take any slot that has
            not started, even once the meeting is under way (Naman, 2026-10-05). */}
        <p>Families can book any slot that has not started yet, even after the meeting begins.</p>
      </div>
    </div>
  );
}
