import type { ReactNode } from "react";
import { Clock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildSlotGrid, formatTimeRange, teacherWindowError } from "@/lib/ptm";

export interface HoursValue {
  startTime: string;
  endTime: string;
}

export interface HoursMeeting {
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
}

interface Props {
  /** Prefix for the two input ids (`<prefix>-start`, `<prefix>-end`). */
  idPrefix: string;
  meeting: HoursMeeting;
  /** Own hours, or null for the meeting's. */
  value: HoursValue | null;
  onChange: (next: HoursValue | null) => void;
  /** A line above the summary: the teacher's name, or nothing for a class box. */
  title?: ReactNode;
}

/**
 * "Meeting hours, 3:00 PM to 5:40 PM · 8 slots" with an "Own hours" button
 * that opens From / To inside the meeting, and "Meeting hours" to go back.
 * One row shared by the per-teacher hours list and the class boxes of the
 * admin's online PTM, so both read and validate the same way
 * (`teacherWindowError`: inside the meeting, end after start, one slot).
 */
export function HoursRow({ idPrefix, meeting, value, onChange, title }: Props) {
  const error = value ? teacherWindowError(value, meeting) : null;
  const hours = value && !error ? value : !value ? meeting : null;
  const slots = hours ? buildSlotGrid(hours.startTime, hours.endTime, meeting.slotDurationMinutes, meeting.slotBufferMinutes).length : null;
  const summary = value
    ? error
      ? "Own hours"
      : `${formatTimeRange(value.startTime, value.endTime)} · ${slots} ${slots === 1 ? "slot" : "slots"}`
    : `Meeting hours, ${formatTimeRange(meeting.startTime, meeting.endTime)} · ${slots} ${slots === 1 ? "slot" : "slots"}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          {title && <span className="block truncate font-medium text-ink-900">{title}</span>}
          <span className="block text-xs text-ink-500">{summary}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          onClick={() => onChange(value ? null : { startTime: meeting.startTime, endTime: meeting.endTime })}
        >
          {value ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Meeting hours
            </>
          ) : (
            <>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Own hours
            </>
          )}
        </Button>
      </div>
      {value && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-start`} className="text-xs text-ink-600">
              From
            </Label>
            <Input
              id={`${idPrefix}-start`}
              type="time"
              value={value.startTime}
              min={meeting.startTime}
              max={meeting.endTime}
              onChange={(e) => onChange({ ...value, startTime: e.target.value })}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-end`} className="text-xs text-ink-600">
              To
            </Label>
            <Input
              id={`${idPrefix}-end`}
              type="time"
              value={value.endTime}
              min={meeting.startTime}
              max={meeting.endTime}
              onChange={(e) => onChange({ ...value, endTime: e.target.value })}
              aria-invalid={error ? true : undefined}
            />
          </div>
          {error && <p className="col-span-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
