import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";

// Module-private on purpose: exporting them beside the component would break
// Fast Refresh for this file (react-refresh/only-export-components), and nothing
// else needs them.

/** Combine a date (Y/M/D) with an "HH:mm" time string into a single Date,
 * preserving the date's calendar day. */
function withTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  const next = new Date(date);
  next.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return next;
}

function toTimeInput(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export interface DateTimeFieldProps {
  label: string;
  helper?: string;
  value: Date;
  onChange: (next: Date) => void;
}

/**
 * A date picker and a time input that together edit one Date.
 *
 * Date and time sit on ONE row at every width. Until 2026-09-24 they stacked
 * below `sm`, each full width, and iOS centres the value inside a time input,
 * so on a phone "12:51" floated mid-row under a left-aligned date and the two
 * read as unrelated controls (Naman circled the whole card). The date is
 * written short ("Wed, 24 Sep 2026") so the pair fits a 375px card with room
 * to spare, and the time value is pinned left on WebKit through its
 * `::-webkit-date-and-time-value` part, the only way iOS honours text-align
 * there.
 */
export function DateTimeField({ label, helper, value, onChange }: DateTimeFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-stretch gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn("min-h-[44px] min-w-0 flex-1 justify-start px-3 text-left font-normal", FIELD_FILL)}
            >
              {/* No margin: the Button base already sets gap-2. */}
              <CalendarIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {/* The weekday is the first thing to go on the narrowest phones
                    (under 360px the button is ~136px), so the date itself never
                    has to ellipsise. */}
                <span className="hidden min-[360px]:inline">{format(value, "EEE, ")}</span>
                {format(value, "d MMM yyyy")}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value}
              onSelect={(d) => d && onChange(withTime(d, toTimeInput(value)))}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
        <Input
          type="time"
          aria-label={`${label} time`}
          className="min-h-[44px] w-28 shrink-0 text-left [&::-webkit-date-and-time-value]:text-left"
          value={toTimeInput(value)}
          onChange={(e) => onChange(withTime(value, e.target.value))}
        />
      </div>
      {helper && <p className="text-[12px] text-ink-500">{helper}</p>}
    </div>
  );
}
