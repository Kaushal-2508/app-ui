import * as React from "react";

import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { cn } from "@/lib/utils";

/**
 * The drawer vocabulary from public/report_reference/salci-admin-dashboard-v5.html.
 *
 * Every detail panel in the reference is built from the same four pieces, in
 * the same order: a row of mini-stats, then uppercase section headings, then
 * whatever the panel is about, then a bordered note that says in words what the
 * numbers above it mean. Reproducing that vocabulary once is what keeps seven
 * panels looking like one product rather than seven dialogs.
 *
 * The panel itself is the shared MobileSheet on its "right" placement, so it
 * inherits the app's focus trap, escape handling and safe-area padding instead
 * of forking a second modal implementation (CLAUDE.md 20).
 */

export function Dash5Drawer({
  open, onOpenChange, title, subtitle, children, footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      placement="right"
    >
      {children}
      {footer && <div className="mt-5 border-t border-surface-stroke pt-4">{footer}</div>}
    </MobileSheet>
  );
}

/* --------------------------------------------------------------- stats ---- */

export interface MiniStat {
  label: string;
  /** Pre-formatted. A stat with nothing behind it passes "N/A", never a zero. */
  value: React.ReactNode;
  /** A CSS colour expression, usually `hsl(var(--dash-critical))`. */
  tone?: string;
  small?: boolean;
}

/** Three across, matching the reference. Two or four wrap onto their own rows. */
export function MiniStats({ items }: { items: MiniStat[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 grid grid-cols-3 gap-2.5">
      {items.map((s) => (
        <div
          key={s.label}
          className="rounded-[11px] border border-surface-stroke bg-surface-stroke/30 px-3 py-[11px]"
        >
          <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
            {s.label}
          </div>
          <div
            className={cn(
              "mt-[3px] font-extrabold tracking-[-0.025em] text-ink-900",
              s.small ? "text-[17px]" : "text-[21px]",
            )}
            style={s.tone ? { color: s.tone } : undefined}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ sections ---- */

export function DrawerSection({
  title, children, action,
}: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <>
      <div className="mb-2.5 mt-[22px] flex items-center gap-3 first:mt-0">
        <h4 className="m-0 text-xs font-extrabold uppercase tracking-[0.06em] text-ink-400">
          {title}
        </h4>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </>
  );
}

/**
 * The reference's `.note`: a left-ruled block that explains the figures rather
 * than repeating them. Its whole job is to stop a principal having to work out
 * what a number implies, so it is prose, not a stat.
 */
export function DrawerNote({
  children, tone = "brand",
}: { children: React.ReactNode; tone?: "brand" | "warning" | "critical" }) {
  const rule =
    tone === "critical"
      ? "hsl(var(--dash-critical))"
      : tone === "warning"
        ? "hsl(var(--dash-warning))"
        : "hsl(var(--brand-secondary))";
  return (
    <div
      className="rounded-[9px] border border-surface-stroke bg-surface-stroke/30 px-[13px] py-[11px] text-xs leading-[1.55] text-ink-600 [&_b]:text-ink-900"
      style={{ borderLeftWidth: 3, borderLeftColor: rule }}
    >
      {children}
    </div>
  );
}

export function DrawerHint({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mt-2.5 text-[11.5px] font-medium text-ink-400">{children}</p>;
}

/* ----------------------------------------------------------------- tabs --- */

/**
 * A drawer about one (class, subject) pair has three things to say: how much
 * of the book is covered, how the students in it are doing, and what to do
 * about either. The reference opens three separate panels for that, which means
 * closing one to reach the next; here they are three views of the same drawer,
 * so the header and the scope never change underneath the reader.
 */
// `NoInfer` on the items list is what makes the union come from `value` alone.
// Without it TypeScript widens both candidates to `string` and the caller's
// setState, which only takes its own union, stops matching onChange.
export function DrawerTabs<T extends string>({
  value, onChange, items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: NoInfer<T>; label: string }[];
}) {
  return (
    <div className="mb-4 inline-flex rounded-[11px] border border-surface-stroke bg-surface-stroke/30 p-1">
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          aria-pressed={value === t.value}
          className={cn(
            "rounded-[8px] px-3 py-1.5 text-[12.5px] font-bold",
            "transition-[color,background-color,box-shadow] duration-200",
            value === t.value
              ? "bg-surface-card text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-900",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- actions --- */

export function DrawerActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/** Priority marker, the same three levels create_task_group takes. */
export function PriorityPill({ priority }: { priority: number }) {
  const m =
    priority <= 1
      ? { label: "High", glyph: "■", varName: "--dash-critical" }
      : priority === 2
        ? { label: "Medium", glyph: "◆", varName: "--dash-warning" }
        : { label: "Low", glyph: "●", varName: "--dash-good" };
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
      style={{
        color: `hsl(var(${m.varName}))`,
        background: `hsl(var(${m.varName}) / 0.12)`,
        borderColor: `hsl(var(${m.varName}) / 0.26)`,
      }}
    >
      <span className="text-[9px] leading-none" aria-hidden>{m.glyph}</span>
      {m.label}
    </span>
  );
}

/**
 * One suggested piece of work with the button that commits it. The button
 * reports its own outcome in place rather than only firing a toast: the drawer
 * stays open afterwards so a principal can assign three things in a row, and a
 * toast that has already faded cannot tell them which three.
 */
export function AssignRow({
  priority, title, detail, state, onAssign, disabled,
}: {
  priority: number;
  title: string;
  detail: string;
  state: "idle" | "working" | "done";
  onAssign: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-surface-stroke py-2.5 last:border-b-0">
      <PriorityPill priority={priority} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-snug tracking-[-0.01em] text-ink-900">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] font-medium leading-snug text-ink-500">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onAssign}
        disabled={disabled || state !== "idle"}
        className={cn(
          "shrink-0 rounded-[9px] border px-3 py-1.5 text-[12px] font-bold",
          "transition-[color,background-color,border-color] duration-200",
          state === "done"
            ? "cursor-default border-transparent bg-transparent text-ink-400"
            : "border-brand-primary bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-60",
        )}
      >
        {state === "done" ? "Assigned" : state === "working" ? "Working…" : "Assign"}
      </button>
    </div>
  );
}
