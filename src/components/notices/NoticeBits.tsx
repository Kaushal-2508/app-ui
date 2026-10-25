import * as React from "react";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

import { noticeTypeMeta, percentOf } from "./noticeMeta";

/* Small presentational pieces shared by the notice cards, the detail sheet
 * and the desktop detail pane. Every colour flows through the Tone palette
 * so the pieces flip with dark mode for free. */

const CHIP_CLASSES: Record<Tone, string> = {
  teal: "bg-brand-primary/10 text-brand-primary",
  violet: "bg-brand-secondary/10 text-brand-secondary",
  peach: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  mint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export function NoticeChip({
  tone = "teal",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        CHIP_CLASSES[tone],
        className,
      )}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}

/** Neutral chip for metadata that carries no tone: attachment count,
 *  validity, target summary. */
export function NoticeMetaChip({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-surface-stroke px-2 py-0.5 text-[11px] font-medium leading-4 text-ink-600 whitespace-nowrap",
        className,
      )}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}

/** The leading icon disc, tinted by notice type. `muted` renders a read
 *  notice in grey so the unread ones carry the colour. */
export function NoticeTypeDisc({
  type,
  size = "md",
  muted = false,
  className,
}: {
  type: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}) {
  const meta = noticeTypeMeta(type);
  const Icon = meta.icon;
  const t = TONES[meta.tone];
  const box =
    size === "lg"
      ? "h-12 w-12 rounded-2xl"
      : size === "sm"
        ? "h-8 w-8 rounded-lg"
        : "h-10 w-10 rounded-xl";
  const glyph = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        box,
        muted ? "bg-ink-400/10 text-ink-500" : cn(t.bg, t.fg),
        className,
      )}
      aria-hidden
      title={meta.label}
    >
      <Icon className={glyph} />
    </span>
  );
}

/** "Team · General · 3m ago" style line. Drops empty parts so a missing
 *  publisher never leaves a dangling separator. */
export function MetaLine({
  parts,
  className,
}: {
  parts: (React.ReactNode | null | undefined | false)[];
  className?: string;
}) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-ink-500", className)}>
      {/* The separator travels with the part it introduces, so a line that
          wraps never opens with a dangling "·". */}
      {shown.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-x-1.5">
          {i > 0 && (
            <span aria-hidden className="shrink-0 text-ink-400">
              ·
            </span>
          )}
          <span className="min-w-0 truncate">{p}</span>
        </span>
      ))}
    </p>
  );
}

/** Read-progress for an issued notice. Numbers come from the server
 *  (`notice_outbox` aggregates them); this only draws them.
 *
 *  Layout: the bar on the left, the sentence on the right, one line. The
 *  sentence leads with the verb ("Read by 1 of 253") because that is the
 *  question an author is asking. No percentage: the bar already shows the
 *  proportion, and a figure like "<1%" next to a real count only adds noise. */
export function ReachBar({
  read,
  total,
  acknowledged,
  requiresAcknowledgement,
  className,
}: {
  read: number;
  total: number;
  acknowledged?: number;
  requiresAcknowledgement?: boolean;
  className?: string;
}) {
  const pct = percentOf(read, total);
  const ackPct = requiresAcknowledgement ? percentOf(acknowledged ?? 0, total) : 0;

  if (total <= 0) {
    return (
      <p className={cn("text-[13px] leading-[18px] text-ink-500", className)}>
        Nobody was addressed by this notice.
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-3">
        <div
          className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-400/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`Read by ${read} of ${total}`}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-brand-primary transition-[width] duration-500"
            style={{ width: `${Math.max(pct, read > 0 ? 1.5 : 0)}%` }}
          />
          {requiresAcknowledgement && (
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${Math.max(ackPct, (acknowledged ?? 0) > 0 ? 1.5 : 0)}%` }}
            />
          )}
        </div>
        <p className="shrink-0 text-[13px] leading-[18px] tabular-nums text-ink-600">
          Read by <span className="font-semibold text-ink-900">{read}</span> of {total}
        </p>
      </div>
      {requiresAcknowledgement && (
        <p className="text-[12px] leading-4 tabular-nums text-emerald-600 dark:text-emerald-400">
          <span className="font-semibold">{acknowledged ?? 0}</span> acknowledged
        </p>
      )}
    </div>
  );
}
