import { useState } from "react";
import { CalendarRange, Check } from "lucide-react";
import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterChip } from "@/components/shared/nav";
import {
  monthToDateRange,
  MAX_HISTORY_DAYS,
  type AttendanceDateRange,
} from "@/hooks/useUserAttendanceHistory";
import { cn } from "@/lib/utils";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export type RangePreset = "mtd" | "last-month" | "30d" | "60d" | "custom";

const PRESET_LABEL: Record<Exclude<RangePreset, "custom">, string> = {
  mtd: "This month",
  "last-month": "Last month",
  "30d": "Last 30 days",
  "60d": "Last 60 days",
};

/** The window a preset means today. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: Date = new Date()): AttendanceDateRange {
  switch (preset) {
    case "mtd":
      return monthToDateRange(today);
    case "last-month": {
      const m = subMonths(today, 1);
      return { from: ymd(startOfMonth(m)), to: ymd(endOfMonth(m)) };
    }
    case "30d":
      return { from: ymd(subDays(today, 29)), to: ymd(today) };
    case "60d":
      return { from: ymd(subDays(today, 59)), to: ymd(today) };
  }
}

/** "1 to 26 Sep 2026", or "28 Aug to 26 Sep 2026" across a month boundary. */
export function formatRange(r: AttendanceDateRange): string {
  const s = parseISO(r.from);
  const e = parseISO(r.to);
  if (r.from === r.to) return format(s, "d MMM yyyy");
  const sameMonth = format(s, "yyyy-MM") === format(e, "yyyy-MM");
  return `${format(s, sameMonth ? "d" : "d MMM")} to ${format(e, "d MMM yyyy")}`;
}

/**
 * Date window picker for the attendance history view. One chip opens a
 * popover with four presets and a custom from / to; the default is this
 * month to date (asked 2026-09-26, replacing a fixed "last 60 days"). A
 * custom window is capped at MAX_HISTORY_DAYS so the read stays bounded.
 */
export function AttendanceRangeFilter({
  value,
  preset,
  onChange,
}: {
  value: AttendanceDateRange;
  preset: RangePreset;
  onChange: (range: AttendanceDateRange, preset: RangePreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  const todayStr = ymd(new Date());
  const span = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
  const customValid = from <= to && span >= 1 && span <= MAX_HISTORY_DAYS && to <= todayStr;

  const choose = (p: Exclude<RangePreset, "custom">) => {
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
    onChange(r, p);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customValid) return;
    onChange({ from, to }, "custom");
    setOpen(false);
  };

  // "Custom", not the dates: the heading beside the chip already shows the
  // exact window, and a full range on the chip ran past the phone's edge.
  const chipLabel = preset === "custom" ? "Custom" : PRESET_LABEL[preset];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Re-sync the inputs with the applied window whenever the popover opens.
        if (o) {
          setFrom(value.from);
          setTo(value.to);
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <FilterChip
          label={chipLabel}
          active={preset !== "mtd"}
          trailing={<CalendarRange className="h-4 w-4 shrink-0 text-ink-500" />}
          aria-label="Choose the attendance date range"
        />
      </PopoverTrigger>
      {/* On a phone the panel takes the full width inside the 16px gutter and
          the two date fields stack: side by side in a 288px panel, the native
          date control's text ran out of its box (2026-09-26). */}
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-[calc(100vw-2rem)] max-w-sm p-3 sm:w-80"
      >
        <ul className="space-y-0.5">
          {(Object.keys(PRESET_LABEL) as Exclude<RangePreset, "custom">[]).map((p) => (
            <li key={p}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => choose(p)}
                className={cn(
                  "h-9 w-full justify-between rounded-lg px-3 text-sm font-medium",
                  preset === p ? "bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/15" : "text-ink-800",
                )}
              >
                {PRESET_LABEL[p]}
                {preset === p && <Check className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-surface-stroke pt-3">
          <p className="eyebrow mb-2">Custom range</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="att-range-from" className="text-xs">From</Label>
              <Input
                id="att-range-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 w-full min-w-0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="att-range-to" className="text-xs">To</Label>
              <Input
                id="att-range-to"
                type="date"
                value={to}
                min={from}
                max={todayStr}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 w-full min-w-0"
              />
            </div>
          </div>
          {!customValid && from && to && (
            <p className="mt-1.5 text-xs text-rose-600">
              {to > todayStr ? "The range can't go past today." : `Pick up to ${MAX_HISTORY_DAYS} days, from before to.`}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            onClick={applyCustom}
            disabled={!customValid}
            className="mt-2 h-9 w-full rounded-full bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
