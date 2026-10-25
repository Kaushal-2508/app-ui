import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * The one filter strip every card on the v5 dashboard uses.
 *
 * The reference puts a tinted, ruled strip inside the card head wherever a card
 * can be narrowed, and uses the identical control for a wing, a class, a subject
 * and a window. Fourteen of those hand-rolled separately is how they drift apart,
 * which had already happened to the three that existed before this.
 */

/** Radix forbids an empty string as a value, so "everything" needs a token. */
export const ALL = "__all__";

export function FilterStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // gap-y is larger than gap-x: below `sm` the groups stack, and rows of
        // named controls need more air between them than controls need beside
        // each other.
        "flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-surface-stroke bg-surface-stroke/30",
        "sm:gap-y-2",
        "px-4 py-2.5 sm:px-[18px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400">{children}</span>
  );
}

/**
 * A label and the controls it names, kept together.
 *
 * FilterStrip is a flat flex-wrap, so with more than one label the children
 * wrapped independently and a label ended up beside a control belonging to the
 * group before it: on a phone the exam-performance strip read "SCOPE [All
 * school] / [All classes in scope] PERIOD / [Last 30 days] [24 Aug] to / [23
 * Sep] [Table]", with PERIOD stranded after a scope control and "to" dangling
 * away from its second date (2026-09-23 phone screenshot).
 *
 * Below `sm` each group takes the full width and puts its label on its own
 * line, so the strip reads as a short stack of named rows. From `sm` up it is
 * inline exactly as before, and the desktop strip is unchanged.
 */
export function FilterGroup({
  label, children, className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1",
        "sm:w-auto sm:flex-row sm:items-center sm:gap-2",
        className,
      )}
    >
      {label && <FilterLabel>{label}</FilterLabel>}
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export interface FilterOption { value: string; label: string }

/**
 * Renders nothing when there is at most one real choice: a picker offering a
 * single option is chrome that answers no question, and the reference drops it
 * for the same reason.
 */
export function FilterSelect({
  value, onChange, options, allLabel, width = "w-[150px]",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: FilterOption[] | undefined;
  allLabel: string;
  width?: string;
}) {
  if (!options || options.length < 2) return null;
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className={cn("h-8 text-xs", width)}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A fixed list of choices where "all" is not one of them (a window, a threshold). */
export function ChoiceSelect({
  value, onChange, options, width = "w-[170px]",
}: {
  value: number;
  onChange: (v: number) => void;
  options: { v: number; label: string }[];
  width?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn("h-8 text-xs", width)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.v} value={String(o.v)}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
