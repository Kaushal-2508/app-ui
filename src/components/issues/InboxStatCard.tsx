import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Inbox,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTileGrid } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/errorMessages";
import { formatAge, type AgeParts } from "@/lib/formatAge";
import { formatWorkingAgeParts } from "@/lib/workingHours";
import type { IssueStatus, SupportInboxStats } from "@/hooks/useReportedIssues";
import type { SupportTurnaround } from "@/hooks/useSupportTurnaround";

/**
 * The four Support Inbox cards: Open, In Progress, Resolved (with Closed as a
 * footnote) and Turnaround. Design panels 2026-09-10: editorial-minimal won the
 * first three unanimously; "Turnaround in plain words" won the fourth 3/3.
 *
 * Rules this file encodes, so they survive the next edit:
 *   - Urgency is WEIGHT in the ink scale, never colour. Every colour on a card
 *     is a token (surface-card, text-ink-*, border-surface-stroke, the Tone disc).
 *   - Every windowed metric names its window and its sample size. Turnaround
 *     shares ONE window for the whole card, named once in its footer; its
 *     samples ride on the "x of n" rows and the headline caption.
 *   - Turnaround is a LABEL / VALUE list, never sentences. The first cut was
 *     five sentences with two different denominators and Tushar read it as a
 *     paragraph (2026-09-10). A reader scans a label and a figure, nothing else.
 *   - A fact whose value is 0 is either hidden or rendered muted, never printed
 *     at alert weight; "0 awaiting SALCI" on In Progress is itself the fact.
 *   - A fact below its sample gate is hidden, never shown as n/a. The one
 *     exception is a headline, which cannot be hidden without collapsing the
 *     identity column: it renders "N/A" muted and its caption says why.
 *   - Error before empty: a failed read renders a strip, never four zeros.
 *   - Turnaround figures are SCHOOL-RAISED tickets only (reporter not a super
 *     admin, institution not is_demo); the footer says how many were left out.
 *     The three count cards keep every ticket: they are the inbox, not the
 *     stopwatch.
 *   - A card without onSelect is static: no role, no hover, no focus ring. The
 *     three status cards open their tab; Turnaround has no tab to open.
 *   - The card root is a div role="button" (not a <button>) so the Closed
 *     footnote can be a real nested button without invalid DOM.
 */

export type InboxFactEmphasis = "alert" | "normal" | "muted";

/** A sentence line (Open, In Progress, Resolved). */
export interface InboxFact {
  key: string;
  node: React.ReactNode;
  emphasis: InboxFactEmphasis;
}

/** A label / value row (Turnaround). The value is right-aligned in tabular figures. */
export interface InboxRow {
  key: string;
  label: string;
  value: React.ReactNode;
  emphasis: InboxFactEmphasis;
}

const FACT_CLASS: Record<InboxFactEmphasis, string> = {
  alert: "text-ink-900 font-medium",
  normal: "text-ink-700",
  muted: "text-ink-500",
};

/** A median needs at least this many tickets before it is printed as a fact. */
const TAT_MIN_SAMPLE = 5;
/** Prior-window comparison: slower at +25 percent, faster at -20 percent, else "about the same". */
const TREND_SLOWER_RATIO = 1.25;
const TREND_FASTER_RATIO = 0.8;

function Num({ value, emphasis }: { value: number; emphasis: InboxFactEmphasis }) {
  return (
    <span className={cn("tabular-nums", emphasis === "alert" && "font-semibold")}>{value}</span>
  );
}

/** A count, a duration rendered as value + unit at two sizes, or null for "N/A". */
export type InboxHeadline = number | AgeParts | null;

const HEADLINE_CLASS =
  "text-[28px] leading-8 font-semibold tabular-nums md:text-[34px] md:leading-[40px]";

function Headline({ headline }: { headline: InboxHeadline }) {
  if (headline === null) {
    return <p className={cn(HEADLINE_CLASS, "text-ink-500 md:mt-2")}>N/A</p>;
  }
  if (typeof headline === "number") {
    return <p className={cn(HEADLINE_CLASS, "text-ink-900 md:mt-2")}>{headline}</p>;
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-1 md:mt-2">
      <span className={cn(HEADLINE_CLASS, "text-ink-900")}>{headline.value}</span>
      <span className="text-[14px] font-medium leading-5 text-ink-700 md:text-[16px]">
        {headline.unit}
      </span>
    </p>
  );
}

export interface InboxStatCardProps {
  title: string;
  tone: Tone;
  icon: LucideIcon;
  headline: InboxHeadline;
  /** One short muted line under the headline saying what it measures. */
  caption?: string;
  /** Already filtered by the caller: hideWhenZero applied, zero-valued alerts demoted. */
  facts: InboxFact[];
  /** Label / value rows. When present and non-empty they replace `facts`. */
  rows?: InboxRow[];
  /** The single muted line shown when there is nothing to list. */
  zeroText: string;
  /** Resolved: the Closed footnote button. Turnaround: the window and cohort line. */
  footer?: React.ReactNode;
  /** Absent = a static card with nothing to click. */
  onSelect?: () => void;
  /** Interactive cards with a non-count headline must say what they open. */
  ariaLabel?: string;
}

export function InboxStatCard({
  title,
  tone,
  icon: Icon,
  headline,
  caption,
  facts,
  rows,
  zeroText,
  footer,
  onSelect,
  ariaLabel,
}: InboxStatCardProps) {
  const t = TONES[tone];
  const interactive = Boolean(onSelect);
  const label =
    ariaLabel ??
    (typeof headline === "number" ? `${title}, ${headline} tickets. Show ${title} tab` : title);
  const rowList = rows ?? [];
  const hasRows = rowList.length > 0;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      className={cn(
        "surface-card frosted-shadow rounded-card p-4 md:p-5",
        // Mobile: a two-column index row (identity left, facts right).
        // Desktop: a stacked card with a hairline under the headline.
        "flex flex-row items-start gap-4 md:flex-col md:gap-0 md:min-h-[188px]",
        interactive &&
          "cursor-pointer transition-[box-shadow,transform] duration-200 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
      )}
    >
      <div className="flex w-[88px] shrink-0 flex-col gap-1 md:w-auto md:gap-0">
        <div className="flex flex-col-reverse gap-1 md:flex-row md:items-center md:justify-between md:gap-2">
          <p className="eyebrow">{title}</p>
          <span
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xl md:h-8 md:w-8",
              t.bg,
              t.fg,
            )}
          >
            <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
          </span>
        </div>
        <Headline headline={headline} />
        {caption && <p className="text-[12px] leading-4 text-ink-500 md:mt-1">{caption}</p>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col md:mt-3 md:border-t md:border-surface-stroke md:pt-3">
        {/* One flex row each, not a shared grid. The value never breaks and the
            label gives way, and because the rows size independently a long
            value on one line ("9 working days") no longer truncates the label
            on every other. Working-hours durations made both faults visible at
            375px: "1 working / day", then "Resolved in a ...". */}
        {hasRows ? (
          <dl className="space-y-1 text-[13px] leading-5">
            {rowList.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3">
                <dt className="truncate text-ink-500">{r.label}</dt>
                <dd className={cn("shrink-0 whitespace-nowrap text-right tabular-nums", FACT_CLASS[r.emphasis])}>
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <ul className="space-y-1 break-words text-[13px] leading-5">
            {facts.length === 0 ? (
              <li className="text-ink-500">{zeroText}</li>
            ) : (
              facts.map((f) => (
                <li key={f.key} className={FACT_CLASS[f.emphasis]}>
                  {f.node}
                </li>
              ))
            )}
          </ul>
        )}
        {footer && <div className="mt-2 border-t border-surface-stroke pt-2 md:mt-auto">{footer}</div>}
      </div>
    </div>
  );
}

export interface InboxStatsRowProps {
  stats: SupportInboxStats | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Boolean(institutionId) on the page: the school line would be tautological. */
  institutionFiltered: boolean;
  onSelect: (status: IssueStatus) => void;
  /** Working-hours turnaround. Its own read, so the counts still render if it fails. */
  tat: SupportTurnaround | undefined;
  tatError: boolean;
}

/** "alert" when there is something to act on, "muted" when the zero is the fact. */
function alertIf(n: number): InboxFactEmphasis {
  return n > 0 ? "alert" : "muted";
}

function compact<T>(items: Array<T | false | null | undefined>): T[] {
  return items.filter((x): x is T => Boolean(x));
}

/** "3 of 9" as a row value; a zero count renders muted, never bold. */
function shareRow(key: string, label: string, count: number, sample: number): InboxRow {
  const emphasis: InboxFactEmphasis = count > 0 ? "normal" : "muted";
  return {
    key,
    label,
    emphasis,
    value: (
      <>
        <Num value={count} emphasis={emphasis} /> of <Num value={sample} emphasis={emphasis} />
      </>
    ),
  };
}

/** The prior 30-day median, weighted by direction: alert when slower now. Null until both samples exist. */
function trendRow(tat: SupportTurnaround): InboxRow | null {
  const cur = tat.resolveMedianWorkingHours;
  const prev = tat.resolveMedianWorkingHoursPrev;
  if (
    cur === null ||
    prev === null ||
    prev <= 0 ||
    tat.resolveSample < TAT_MIN_SAMPLE ||
    tat.resolveSamplePrev < TAT_MIN_SAMPLE
  ) {
    return null;
  }
  const parts = formatWorkingAgeParts(prev);
  if (parts === null) return null;
  const was = `${parts.value} ${parts.unit}`;
  const ratio = cur / prev;
  const emphasis: InboxFactEmphasis =
    ratio >= TREND_SLOWER_RATIO ? "alert" : ratio <= TREND_FASTER_RATIO ? "normal" : "muted";
  return { key: "trend", label: "Prior 30 days", emphasis, value: was };
}

export function InboxStatsRow({
  stats,
  isLoading,
  isError,
  error,
  refetch,
  institutionFiltered,
  onSelect,
  tat,
  tatError,
}: InboxStatsRowProps) {
  // Error FIRST (CLAUDE.md section 6): a failed read must never render as zeros.
  if (isError) {
    const fallback = "Couldn't load the inbox summary.";
    const detail = translateError(error, fallback).title;
    return (
      <div className="mt-2 flex items-start gap-3 rounded-card p-4 surface-card frosted-shadow">
        <span
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            TONES.rose.bg,
            TONES.rose.fg,
          )}
        >
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">{fallback}</p>
          {detail && detail !== fallback && <p className="text-[13px] text-ink-600">{detail}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <StatTileGrid cols={1} mdCols={2} lgCols={4} className="mt-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[112px] rounded-card md:h-[188px]" />
        ))}
      </StatTileGrid>
    );
  }

  const openOldest = formatAge(stats.open_oldest_hours);
  const openFacts: InboxFact[] =
    stats.open === 0
      ? []
      : compact<InboxFact>([
          {
            key: "awaiting",
            emphasis: alertIf(stats.open_awaiting_salci),
            node: (
              <>
                <Num value={stats.open_awaiting_salci} emphasis={alertIf(stats.open_awaiting_salci)} /> awaiting
                SALCI
              </>
            ),
          },
          stats.open_never_answered > 0 && {
            key: "never",
            emphasis: "alert" as const,
            node: (
              <>
                <Num value={stats.open_never_answered} emphasis="alert" /> never answered
              </>
            ),
          },
          openOldest !== null && {
            key: "oldest",
            emphasis: "normal" as const,
            node: <>Oldest has waited {openOldest}</>,
          },
          !institutionFiltered &&
            stats.open_top_school_count >= 2 &&
            Boolean(stats.open_top_school_name) && {
              key: "school",
              emphasis: "muted" as const,
              node:
                stats.open_top_school_count === stats.open ? (
                  <>All from {stats.open_top_school_name}</>
                ) : (
                  <>
                    <Num value={stats.open_top_school_count} emphasis="muted" /> of{" "}
                    <Num value={stats.open} emphasis="muted" /> from {stats.open_top_school_name}
                  </>
                ),
            },
        ]);

  const inProgressOldest = formatAge(stats.in_progress_oldest_hours);
  const inProgressFacts: InboxFact[] =
    stats.in_progress === 0
      ? []
      : compact<InboxFact>([
          {
            key: "awaiting",
            emphasis: alertIf(stats.in_progress_awaiting_salci),
            node: (
              <>
                <Num
                  value={stats.in_progress_awaiting_salci}
                  emphasis={alertIf(stats.in_progress_awaiting_salci)}
                />{" "}
                awaiting SALCI
              </>
            ),
          },
          stats.in_progress_quiet_72h > 0 && {
            key: "quiet",
            emphasis: "alert" as const,
            node: (
              <>
                <Num value={stats.in_progress_quiet_72h} emphasis="alert" /> quiet for 3+ days
              </>
            ),
          },
          inProgressOldest !== null && {
            key: "oldest",
            emphasis: "normal" as const,
            node: <>Longest running {inProgressOldest}</>,
          },
        ]);

  // Resolved is throughput plus follow-through. Speed lives on Turnaround.
  const resolvedFacts: InboxFact[] = compact<InboxFact>([
    stats.resolved > 0 && {
      key: "7d",
      emphasis: stats.resolved_7d > 0 ? ("normal" as const) : ("muted" as const),
      node: (
        <>
          <Num value={stats.resolved_7d} emphasis={stats.resolved_7d > 0 ? "normal" : "muted"} /> resolved
          in the last 7 days
        </>
      ),
    },
    stats.resolved > 0 &&
      stats.resolved_prev_7d > 0 && {
        key: "prev7d",
        emphasis: "muted" as const,
        node: (
          <>
            <Num value={stats.resolved_prev_7d} emphasis="muted" /> in the 7 days before
          </>
        ),
      },
    stats.resolved_no_reply_30d > 0 && {
      key: "noreply",
      emphasis: "alert" as const,
      node: (
        <>
          <Num value={stats.resolved_no_reply_30d} emphasis="alert" /> resolved with no reply to the
          school · last 30 days
        </>
      ),
    },
  ]);

  // Closed is an index entry, not a metric: no disc, no eyebrow, no "this week"
  // (there is no closed_at column, and updated_at moves on every read stamp).
  const closedFootnote = (
    <button
      type="button"
      aria-label="Show closed tickets"
      onClick={(e) => {
        e.stopPropagation();
        onSelect("closed");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className="inline-flex items-center gap-1 rounded-sm text-[12px] leading-4 text-ink-500 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
    >
      Closed · <span className="tabular-nums">{stats.closed}</span>
      <ChevronRight className="h-3 w-3" />
    </button>
  );

  // Turnaround: one window (last 30 days), school-raised tickets only, gated
  // medians. Headline = median time to resolve, its caption names the cohort;
  // the rows are label / value, never sentences.
  //
  // Measured on the SOP's clock, 10:00 to 18:00 Monday to Saturday, by
  // useSupportTurnaround. The RPC's own `tat_*` keys are calendar hours and are
  // deliberately not read here: they disagreed with the working-day ages on the
  // rows below this card by a factor of three.
  const resolveOk = Boolean(tat) && tat!.resolveSample >= TAT_MIN_SAMPLE;
  const replyOk = Boolean(tat) && tat!.firstReplySample >= TAT_MIN_SAMPLE;
  const tatHeadline: InboxHeadline = resolveOk
    ? formatWorkingAgeParts(tat!.resolveMedianWorkingHours)
    : null;
  const tatCaption = resolveOk
    ? `to resolve · ${tat!.resolveSample} tickets`
    : replyOk
      ? `fewer than ${TAT_MIN_SAMPLE} resolved`
      : undefined;
  const firstReplyMedian = tat ? formatWorkingAgeParts(tat.firstReplyMedianWorkingHours) : null;
  const tatRows: InboxRow[] = compact<InboxRow>([
    resolveOk && shareRow("week", "Resolved in a week", tat!.resolveWithinWeek, tat!.resolveSample),
    resolveOk && tat && trendRow(tat),
    replyOk &&
      firstReplyMedian !== null && {
        key: "reply",
        label: "First reply",
        emphasis: "normal" as const,
        value: `${firstReplyMedian.value} ${firstReplyMedian.unit}`,
      },
    replyOk && shareRow("day", "Replied in a day", tat!.firstReplyWithinDay, tat!.firstReplySample),
  ]);
  // Error before empty (CLAUDE.md §6): an unmeasurable card must say so rather
  // than read as a desk with nothing to show.
  const tatZeroText = tatError
    ? "Couldn't measure turnaround"
    : tat?.institutionIsDemo
      ? "Test schools are left out of turnaround"
      : `Fewer than ${TAT_MIN_SAMPLE} tickets resolved or answered in the last 30 days`;
  const tatFooter = (
    <p className="text-[12px] leading-4 text-ink-500">
      Medians · working hours · last 30 days
      {(tat?.excluded ?? 0) > 0 && (
        <>
          {" "}
          · <span className="tabular-nums">{tat!.excluded}</span> test tickets left out
        </>
      )}
    </p>
  );

  return (
    <StatTileGrid cols={1} mdCols={2} lgCols={4} className="mt-2">
      <InboxStatCard
        title="Open"
        tone="peach"
        icon={Inbox}
        headline={stats.open}
        facts={openFacts}
        zeroText="Nothing waiting on SALCI"
        onSelect={() => onSelect("open")}
      />
      <InboxStatCard
        title="In Progress"
        tone="sky"
        icon={Clock}
        headline={stats.in_progress}
        facts={inProgressFacts}
        zeroText="Nothing in progress"
        onSelect={() => onSelect("in_progress")}
      />
      <InboxStatCard
        title="Resolved"
        tone="mint"
        icon={CheckCircle2}
        headline={stats.resolved}
        facts={resolvedFacts}
        zeroText="Nothing resolved yet"
        footer={closedFootnote}
        onSelect={() => onSelect("resolved")}
      />
      <InboxStatCard
        title="Turnaround"
        tone="violet"
        icon={Timer}
        headline={tatHeadline}
        caption={tatCaption}
        facts={[]}
        rows={tatRows}
        zeroText={tatZeroText}
        footer={tatFooter}
      />
    </StatTileGrid>
  );
}
