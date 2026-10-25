import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ClayPebble } from "@/components/shared/surfaces";
import type { Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, type AdmissionStage } from "@/lib/admissions";
import { SECTION_ACCENT } from "./tokens";

/**
 * One block of an admissions sheet (Naman, 2026-10-09: "design this in good
 * design"): a card with a coloured edge, a gradient header band, a clay
 * pebble and a filled step chip, the fields inside on a two-column grid
 * from `sm` up.
 */
export function SectionCard({
  step,
  icon,
  tone,
  title,
  hint,
  children,
  className,
}: {
  step?: number;
  icon: ReactNode;
  tone: Tone;
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const a = SECTION_ACCENT[tone];
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-surface-stroke border-l-4 bg-[hsl(var(--surface-card))] shadow-card",
        a.edge,
        className,
      )}
      data-section={title}
    >
      <header className={cn("flex items-center gap-3 bg-gradient-to-r to-transparent px-4 py-3", a.band)}>
        <ClayPebble tone={tone} size="sm">
          {icon}
        </ClayPebble>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-semibold text-ink-900">
            {step !== undefined && (
              <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white", a.chip)}>
                {step}
              </span>
            )}
            {title}
          </p>
          {hint && <p className="text-xs text-ink-600">{hint}</p>}
        </div>
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** A labelled control inside a SectionCard; `wide` spans both columns. */
export function Field({
  label,
  htmlFor,
  hint,
  wide = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={htmlFor} className="text-ink-700">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/** A row of choices as pills, one on at a time: faster than a dropdown for
 *  three or four options the desk picks all day. */
export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors duration-200 disabled:opacity-60",
              on
                ? "border-brand-primary bg-brand-primary text-white"
                : "border-surface-stroke bg-[hsl(var(--surface-card))] text-ink-700 hover:border-brand-primary/50 hover:bg-brand-primary/5",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The strip above a sheet's buttons: what the form says so far, and what
 *  is still needed before it can be saved. */
export function SummaryStrip({ summary, missing }: { summary: string; missing: string | null }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm ring-1 ring-inset",
        missing ? "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200" : "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300",
      )}
      aria-live="polite"
      data-summary-strip=""
    >
      {missing ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{summary || (missing ? "Nothing filled in yet" : "")}</span>
      <span className="shrink-0 text-xs font-medium">{missing ?? "Ready to save"}</span>
    </div>
  );
}

const STAGE_STYLE: Record<AdmissionStage, { className: string; dot: string }> = {
  enquiry: { className: "bg-sky-500/[0.06] text-sky-800 ring-sky-500/30 dark:text-sky-300", dot: "bg-sky-500" },
  registered: { className: "bg-violet-500/[0.06] text-violet-800 ring-violet-500/30 dark:text-violet-300", dot: "bg-violet-500" },
  admitted: { className: "bg-emerald-500/[0.06] text-emerald-800 ring-emerald-500/30 dark:text-emerald-300", dot: "bg-emerald-500" },
  dropped: { className: "bg-rose-500/[0.06] text-rose-800 ring-rose-500/30 dark:text-rose-300", dot: "bg-rose-400" },
};

export function StageBadge({ stage, className }: { stage: AdmissionStage; className?: string }) {
  const s = STAGE_STYLE[stage];
  return (
    <Badge variant="secondary" className={cn("shrink-0 gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset hover:bg-transparent", s.className, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

const STAGE_DOT: Record<AdmissionStage, string> = {
  enquiry: "bg-sky-500",
  registered: "bg-violet-500",
  admitted: "bg-emerald-500",
  dropped: "bg-rose-400",
};

const STAGE_NOTE: Record<AdmissionStage, string> = {
  enquiry: "waiting for the registration fee",
  registered: "fee paid, waiting for admission",
  admitted: "students created",
  dropped: "left the pipeline, with a reason",
};

/**
 * The overview card (Naman, 2026-10-09: "very professional"): four stat
 * cells on hairlines, a note under each number, and a thin pipeline bar
 * with the conversion. Everything from the server's counts; stage colours
 * appear only as small dots.
 */
export function AdmissionsOverview({
  counts,
  yearLabel,
  loading = false,
}: {
  counts: { enquiry: number; registered: number; admitted: number; dropped: number } | undefined;
  yearLabel: string | null;
  loading?: boolean;
}) {
  const order: AdmissionStage[] = ["enquiry", "registered", "admitted", "dropped"];
  const total = counts ? order.reduce((n, k) => n + counts[k], 0) : 0;
  const pct = counts && total > 0 ? Math.round((counts.admitted / total) * 100) : 0;
  return (
    <section className="surface-card frosted-shadow rounded-card overflow-hidden" data-pipeline-strip="" aria-busy={loading || undefined}>
      <dl className="grid grid-cols-2 divide-y divide-surface-stroke sm:divide-y-0 lg:grid-cols-4 lg:divide-x [&>div:nth-child(odd)]:border-r [&>div:nth-child(odd)]:border-surface-stroke lg:[&>div:nth-child(odd)]:border-r-0">
        {order.map((k) => (
          <div key={k} className="px-4 py-4 sm:px-5" data-stat-cell={k}>
            <dt className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", STAGE_DOT[k])} aria-hidden="true" />
              {k === "enquiry" ? "Enquiries" : STAGE_LABEL[k]}
            </dt>
            <dd className="mt-1.5 text-2xl font-semibold tabular-nums text-ink-900">{counts ? counts[k] : loading ? "…" : "N/A"}</dd>
            <dd className="mt-0.5 text-xs text-ink-500">{k === "admitted" && counts && total > 0 ? `${pct}% of all enquiries` : STAGE_NOTE[k]}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-surface-stroke px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-500">
          <span>Pipeline{yearLabel ? ` · ${yearLabel}` : " · all years"}</span>
          <span>
            {counts && total > 0 ? (
              <>
                <span className="font-medium text-ink-900">{counts.admitted}</span> of {total} admitted · <span className="font-medium text-ink-900">{pct}%</span>
              </>
            ) : (
              "No enquiries yet"
            )}
          </span>
        </div>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {counts &&
            total > 0 &&
            order
              .filter((k) => counts[k] > 0)
              .map((k) => <span key={k} className={cn("h-full", STAGE_DOT[k])} style={{ width: `${(counts[k] / total) * 100}%` }} />)}
        </div>
      </div>
    </section>
  );
}

/** A label over a value, for the facts of an enquiry. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink-900">{children}</dd>
    </div>
  );
}
