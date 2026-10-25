import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Inbox, Minus } from "lucide-react";

import { cn, formatClassName } from "@/lib/utils";
import { EmptyState } from "@/components/shared/surfaces";
// The hero pill, borrowed rather than re-cut: it already carries the exact
// hover/active/focus behaviour of the Achievements cards these tiles now match,
// and a second copy would be the thing that drifts.
import { HeroAction } from "@/components/achievements/HeroCard";
import { TONES, type Tone } from "@/components/shared/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardClassOption } from "@/hooks/dashboard/useDashboardData";

/**
 * Visual primitives for the admin dashboard, built to the blueprint at
 * public/report_reference/salci-admin-dashboard.html.
 *
 * Every colour flows through a `--dash-*` token declared in BOTH `:root` and
 * `.dark` in src/index.css (§20). The blueprint is a light, print-like document
 * and hardcodes hexes; reproducing those literally would look right once and
 * break the moment anyone flips the theme.
 */

/* ---------------------------------------------------------------- filter ---- */

/** Sentinel for "no class chosen". Radix Select forbids an empty string value,
 *  so the unfiltered state needs a token of its own rather than "". */
export const DASH_ALL_CLASSES = "__all__";

/**
 * The narrowing picker that sits in a card head's `trailing` slot.
 *
 * One component rather than one per dimension: the cards that offer a class
 * picker, a wing picker and a window picker all want the same width, height and
 * "All …" affordance, and the three separately hand-rolled Selects this
 * replaced had already drifted apart. Renders nothing when there is at most one
 * option, since a picker with a single choice is chrome that answers nothing.
 */
export function DashSelectFilter({
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[] | undefined;
  allLabel: string;
  className?: string;
}) {
  if (!options || options.length < 2) return null;
  return (
    <Select
      value={value ?? DASH_ALL_CLASSES}
      onValueChange={(v) => onChange(v === DASH_ALL_CLASSES ? null : v)}
    >
      <SelectTrigger className={cn("h-8 w-[150px] text-xs", className)}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DASH_ALL_CLASSES}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** DashSelectFilter over the class list, since five cards want exactly that. */
export function DashClassFilter({
  value,
  onChange,
  classes,
  allLabel = "All classes",
  className,
}: {
  value: string | null;
  onChange: (classId: string | null) => void;
  classes: DashboardClassOption[] | undefined;
  allLabel?: string;
  className?: string;
}) {
  const options = React.useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.id,
        label: formatClassName(c.name, c.section),
      })),
    [classes],
  );
  return (
    <DashSelectFilter
      value={value}
      onChange={onChange}
      options={options}
      allLabel={allLabel}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------ card ---- */

export function DashCard({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface-card frosted-shadow rounded-card border border-surface-stroke",
        "flex h-full flex-col px-5 py-5 sm:px-6",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DashCardHead({
  title,
  caption,
  trailing,
}: {
  title: React.ReactNode;
  caption?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-2.5">
      <div className="min-w-0">
        <p className="m-0 mb-0.5 text-sm font-bold text-ink-900">
          {title}
        </p>
        {caption && (
          <p className="m-0 text-xs text-ink-500">{caption}</p>
        )}
      </div>
      {trailing && <div className="flex-none">{trailing}</div>}
    </div>
  );
}

/** The plain-English paragraph the blueprint puts under most charts. It is what
 *  makes the page readable by a principal rather than an analyst. */
export function DashExplainer({ children }: { children: React.ReactNode }) {
  return (
    // mt-auto pins the caption to the card's bottom edge, so two cards of
    // different content length still line their captions up.
    <p className="mt-auto border-t border-surface-stroke pt-3 text-[12px] leading-[1.55] text-ink-500">
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------- grid ----- */

/**
 * Two-column card grid with EQUAL-HEIGHT columns.
 *
 * Grid items stretch by default, so paired cards share a bottom edge and the
 * page reads as aligned rows rather than ragged columns. The reused widgets are
 * `<section>` elements from WidgetCard, which do not forward a className, so the
 * child selectors here stretch them from the outside and make them flex columns
 * — without that, the tall card sets the row height and the short one paints
 * its background only as far as its own content.
 *
 * The counterpart is `DashExplainer`, which pins itself to the bottom with
 * `mt-auto`: the leftover space then falls between the chart and its caption
 * instead of piling up under everything.
 */
export function DashGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 lg:grid-cols-2",
        "[&>*]:h-full [&>section]:flex [&>section]:flex-col",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- section ------ */

export function DashSection({
  id,
  icon,
  title,
  description,
  link,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  link?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-[72px]">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-surface-stroke/60 text-ink-700">
            {icon}
          </span>
          <div>
            <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.01em] text-ink-900">
              {title}
            </h2>
            <div className="text-[12.5px] text-ink-500">
              {description}
            </div>
          </div>
        </div>
        {link && (
          <button
            type="button"
            onClick={link.onClick}
            className="whitespace-nowrap text-[12.5px] font-bold text-brand-primary hover:underline"
          >
            {link.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- KPI ------ */

export type DashAccent =
  | "teal"
  | "violet"
  | "good"
  | "warning"
  | "critical"
  | "neutral";

/** Blueprint accent -> the portal's Tone union, so the icon disc uses the same
 *  tinted pairs as every other StatTile in the product. */
const STAT_TONE: Record<DashAccent, Tone> = {
  teal: "teal",
  violet: "violet",
  good: "mint",
  warning: "peach",
  critical: "rose",
  neutral: "sky",
};

const ACCENT_VAR: Record<DashAccent, string> = {
  teal: "var(--dash-teal)",
  violet: "var(--dash-violet)",
  good: "var(--dash-good)",
  warning: "var(--dash-warning)",
  critical: "var(--dash-critical)",
  neutral: "var(--ink-400)",
};

/**
 * Type scale per tile size.
 *
 * A bento hero is three columns wide and two rows tall; the compact scale that
 * suits a 1x1 tile leaves its number looking like a footnote in the middle of
 * all that space. `lg` scales the whole tile together — disc, label, value,
 * footnote — rather than only inflating the number, which would just move the
 * imbalance rather than fix it.
 */
const KPI_SIZE = {
  md: {
    pad: "gap-3 p-3.5",
    disc: "mt-0.5 h-8 w-8 rounded-xl",
    label: "",
    value: "text-2xl leading-8",
    unit: "ml-0.5 text-sm",
    suffix: "text-[11px] leading-4",
    foot: "mt-1 text-[11px] leading-4",
    footerPad: "pt-3",
  },
  lg: {
    pad: "gap-3.5 p-4 sm:p-5",
    disc: "mt-0.5 h-10 w-10 rounded-[14px]",
    label: "text-[12px] leading-4",
    value: "text-[32px] leading-[38px] sm:text-[38px] sm:leading-[44px]",
    unit: "ml-1 text-lg",
    suffix: "text-[13px] leading-5",
    foot: "mt-1.5 text-[13px] leading-5",
    footerPad: "pt-4",
  },
} as const;

/**
 * Ink for a tile painted on a saturated `.hero-card` ground.
 *
 * The default tile inks itself with `text-ink-*`, which is calibrated for a
 * near-white card and disappears on a teal or orange gradient. Rather than
 * conditionally sprinkling `text-white` at each of the six type slots, the two
 * grounds each name a full set once, so a slot can never be styled for one
 * ground and left unstyled on the other.
 */
const KPI_INK = {
  card: {
    label: "eyebrow",
    value: "text-ink-900",
    unit: "text-ink-500",
    suffix: "text-ink-400",
    sub: "text-ink-400",
    flat: "text-ink-500",
    disc: "",
  },
  hero: {
    label: "hero-eyebrow",
    value: "text-[hsl(var(--hero-ink))]",
    unit: "text-[hsl(var(--hero-ink)/0.72)]",
    suffix: "text-[hsl(var(--hero-ink)/0.78)]",
    sub: "text-[hsl(var(--hero-ink)/0.82)]",
    flat: "text-[hsl(var(--hero-ink)/0.82)]",
    disc: "bg-white/20 text-[hsl(var(--hero-ink))]",
  },
} as const;

/** Hero tone -> its `.hero-card` modifier, the same three the Achievements
 *  page uses. Tones live in index.css under BOTH `:root` and `.dark`, so a
 *  toned tile cannot ship a colour that exists in only one theme (§20). */
const KPI_HERO_CLASS = {
  teal: "hero-card--teal",
  orange: "hero-card--orange",
  violet: "hero-card--violet",
} as const;

export type DashHeroTone = keyof typeof KPI_HERO_CLASS;

/**
 * KPI tile — compact variant of the portal's `StatTile`.
 *
 * Keeps StatTile's identity (same card, same tinted icon disc, same `.eyebrow`
 * label, same tabular value, same arrow-and-colour delta) but lays the disc
 * BESIDE the content rather than stacked above it. Nine tiles stacked the
 * standard way cost a whole screen of height before the first chart; going
 * horizontal removes a 40px row plus a gap from each one.
 *
 * Built rather than wrapping StatTile because StatTile has no slot for the
 * `sub` line ("of 45 · 0.0%", "across 6 wings"), and overlaying one on top of
 * it is what broke this layout once already.
 *
 * With `tone` it repaints onto the Achievements hero surface (gradient + dot
 * field + white pill action) instead of the plain card. Reserved for the three
 * bento tiles at the top of the page: the treatment reads as "this is the
 * headline" precisely because most tiles do not use it.
 */
export function DashKpiTile({
  label,
  value,
  unit,
  icon,
  delta,
  sub,
  valueSuffix,
  footer,
  size = "md",
  tone,
  action,
  accent = "teal",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  icon?: React.ReactNode;
  delta?: { text: string; direction: "up" | "down" | "flat" };
  sub?: string;
  /**
   * A qualifier of the number itself, e.g. "of 10 · 60.0%". Sits on the value's
   * line, styled like `sub`. Use it when the text only means anything read
   * straight after the value; genuine footnotes belong in `sub`.
   */
  valueSuffix?: React.ReactNode;
  /**
   * Extra content under the footnote, pushed to the bottom of the tile. For
   * bento tiles that span two rows or three columns and would otherwise be a
   * big number floating in dead space.
   */
  footer?: React.ReactNode;
  /** `lg` for a tile that spans extra bento rows or columns. */
  size?: keyof typeof KPI_SIZE;
  /** Repaint onto the Achievements hero surface in this tone. */
  tone?: DashHeroTone;
  /** White pill action at the foot of the tile. Hero tones only, and only where
   *  the tile is tall enough to seat one without crowding its own footer. */
  action?: { label: string; onClick: () => void };
  accent?: DashAccent;
  onClick?: () => void;
}) {
  const statTone = TONES[STAT_TONE[accent]];
  const s = KPI_SIZE[size];
  const ink = KPI_INK[tone ? "hero" : "card"];

  // A pill inside a clickable card would nest one control in another: the
  // outer press fires on every pill click, and the nesting is invalid ARIA.
  // Where an action exists it IS the affordance, so the card stays inert.
  const cardClick = action ? undefined : onClick;

  return (
    <div
      role={cardClick ? "button" : undefined}
      tabIndex={cardClick ? 0 : undefined}
      onClick={cardClick}
      onKeyDown={
        cardClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                cardClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex h-full items-start",
        tone
          ? ["hero-card", KPI_HERO_CLASS[tone]]
          : "surface-card frosted-shadow",
        s.pad,
        cardClick &&
          "cursor-pointer transition-[box-shadow,transform] duration-200 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
      )}
    >
      {icon && (
        // relative z-10 on every child: the hero dot field is an ::after on the
        // card, so content needs its own stacking context to sit above it.
        <span
          className={cn(
            "relative z-10 inline-flex flex-none items-center justify-center",
            s.disc,
            tone ? ink.disc : [statTone.bg, statTone.fg],
          )}
        >
          {icon}
        </span>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col self-stretch">
        <p className={cn(ink.label, "truncate", s.label)}>{label}</p>
        <p
          className={cn(
            "mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-semibold tabular-nums",
            ink.value,
            s.value,
          )}
        >
          <span>
            {value}
            {unit && (
              <span className={cn("font-semibold", ink.unit, s.unit)}>
                {unit}
              </span>
            )}
          </span>
          {valueSuffix && (
            <span className={cn("font-normal", ink.suffix, s.suffix)}>
              {valueSuffix}
            </span>
          )}
        </p>

        {/* Delta and sub share one line where both exist — they are two halves
            of the same footnote, and stacking them was most of the wasted
            height. */}
        {(delta || sub) && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-0.5",
              s.foot,
            )}
          >
            {delta && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-medium tabular-nums",
                  // Emerald and rose both sink into a saturated hero ground, so
                  // there the arrow carries the direction and the colour just
                  // separates the delta from the quieter `sub` beside it.
                  tone
                    ? delta.direction === "flat"
                      ? ink.flat
                      : ink.value
                    : delta.direction === "up"
                      ? "text-emerald-600"
                      : delta.direction === "down"
                        ? "text-rose-600"
                        : "text-ink-500",
                )}
              >
                {delta.direction === "up" ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                ) : delta.direction === "down" ? (
                  <ArrowDownRight className="h-3 w-3" aria-hidden />
                ) : (
                  <Minus className="h-3 w-3" aria-hidden />
                )}
                {delta.text}
              </span>
            )}
            {sub && <span className={cn("truncate", ink.sub)}>{sub}</span>}
          </div>
        )}

        {/* mt-auto so a tile that spans extra bento rows puts its detail along
            the bottom edge instead of leaving the space under the value. One
            container for both so the leftover space falls in ONE place —
            mt-auto on each would split it and unpin the footer. */}
        {(footer || action) && (
          <div className={cn("mt-auto", s.footerPad)}>
            {footer}
            {action && (
              <HeroAction label={action.label} onClick={action.onClick} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- badges ------ */

export function DashBadge({
  tone,
  children,
}: {
  tone: "high" | "medium" | "low" | "good";
  children: React.ReactNode;
}) {
  const tones = {
    high: "bg-[hsl(var(--dash-critical)/0.12)] text-[hsl(var(--dash-critical))]",
    medium: "bg-[hsl(var(--dash-warning)/0.16)] text-[hsl(var(--dash-warning))]",
    low: "bg-ink-500/10 text-ink-500",
    good: "bg-[hsl(var(--dash-teal)/0.12)] text-brand-primary",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.03em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function DashChip({
  negative,
  children,
}: {
  negative?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        negative
          ? "border-[hsl(var(--dash-critical)/0.18)] bg-[hsl(var(--dash-critical)/0.09)] text-[hsl(var(--dash-critical))]"
          : "border-surface-stroke bg-surface-stroke/60 text-ink-700",
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------- bar chart ------- */

export interface DashBarRow {
  label: string;
  sublabel?: string;
  value: number;
  /** Optional benchmark drawn as a thin vertical tick (the blueprint's school average). */
  benchmark?: number;
  tone?: DashAccent;
  onClick?: () => void;
}

/** CSS bar chart, not Recharts: the blueprint's bars are a label/track/value
 *  grid that stays legible at 375px, and it avoids the ResponsiveContainer
 *  zero-height trap inside a grid child (§20). */
export function DashBarChart({
  rows,
  max = 100,
  suffix = "%",
}: {
  rows: DashBarRow[];
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="mt-1.5 flex flex-col gap-[11px]">
      {rows.map((r) => (
        <div
          key={r.label}
          onClick={r.onClick}
          // Interactive rows must be reachable without a mouse. role+tabIndex
          // rather than a <button> because the row is a grid of three cells and
          // a button would collapse their alignment.
          role={r.onClick ? "button" : undefined}
          tabIndex={r.onClick ? 0 : undefined}
          onKeyDown={
            r.onClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    r.onClick?.();
                  }
                }
              : undefined
          }
          className={cn(
            "group grid items-center gap-2.5",
            "grid-cols-[minmax(96px,152px)_1fr_44px]",
            r.onClick &&
              "-mx-2 cursor-pointer rounded-lg px-2 py-0.5 hover:bg-surface-stroke/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold text-ink-700">
              {r.label}
            </div>
            {r.sublabel && (
              <div className="truncate text-[10.5px] font-medium text-ink-500">
                {r.sublabel}
              </div>
            )}
          </div>
          <div className="relative h-3.5 rounded-[5px] bg-surface-stroke">
            <div
              className="h-full rounded-r-[5px] transition-[filter] duration-150 group-hover:brightness-90"
              style={{
                width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`,
                background: `hsl(${ACCENT_VAR[r.tone ?? "teal"]})`,
              }}
            />
            {r.benchmark != null && (
              <span
                aria-hidden
                title={`School average ${r.benchmark}${suffix}`}
                className="absolute top-[-3px] h-[20px] w-[2px] bg-ink-400"
                style={{
                  left: `${Math.max(0, Math.min(100, (r.benchmark / max) * 100))}%`,
                }}
              />
            )}
          </div>
          <div className="text-right text-xs font-bold tabular-nums text-ink-700">
            {Math.round(r.value)}
            {suffix}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- person row ------- */

export function DashPersonRow({
  name,
  meta,
  chips,
  side,
  actions,
  onClick,
}: {
  name: string;
  meta?: React.ReactNode;
  chips?: React.ReactNode;
  side?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        // items-start, not items-center: a row carrying chips is three or four
        // lines tall, and centring floated the avatar and the score badge to
        // the middle of that block, level with the reasons instead of with the
        // name they belong to.
        "flex items-start gap-3 border-b border-surface-stroke px-0.5 py-3 last:border-b-0",
        onClick &&
          "-mx-2 cursor-pointer rounded-[10px] px-2 hover:bg-surface-stroke/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      <span className="mt-px flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-brand-secondary text-[11.5px] font-extrabold text-white">
        {initials || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-bold text-ink-900">
          {name}
        </div>
        {meta && (
          <div className="mt-px truncate text-[11.5px] text-ink-500">
            {meta}
          </div>
        )}
        {chips && <div className="mt-1.5 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      {/* pt-1 puts the badge on the name's baseline rather than the row's. */}
      <div className="flex flex-none flex-col items-end gap-1.5 pt-1">
        {side}
        {actions && <div className="text-[11.5px]">{actions}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- queue item -------- */

export function DashQueueItem({
  severity,
  title,
  detail,
  cta,
}: {
  severity: "high" | "medium" | "low";
  title: string;
  detail?: string;
  cta?: { label: string; onClick: () => void };
}) {
  const dot = {
    high: "bg-[hsl(var(--dash-critical))]",
    medium: "bg-[hsl(var(--dash-warning))]",
    low: "bg-ink-400",
  }[severity];

  return (
    <div className="flex items-center gap-3.5 rounded-[14px] border border-surface-stroke bg-surface-stroke/40 px-4 py-3">
      <span aria-hidden className={cn("h-2 w-2 flex-none rounded-full", dot)} />
      <div className="min-w-0 flex-1 text-[13px] font-semibold text-ink-900">
        {title}
        {detail && (
          <span className="mt-px block text-[11.5px] font-medium text-ink-500">
            {detail}
          </span>
        )}
      </div>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="whitespace-nowrap text-xs font-bold text-brand-primary hover:underline"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- stat chips --- */

export function DashStatChips({
  items,
}: {
  items: { value: React.ReactNode; label: string }[];
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-[14px] border border-surface-stroke bg-surface-stroke/40 px-3.5 py-3"
        >
          <div className="text-xl font-extrabold tracking-[-0.01em] text-ink-900">
            {it.value}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink-500">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ view all ------ */

export function DashViewAll({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 block w-full border-t border-surface-stroke pt-3 text-center text-[12.5px] font-bold text-brand-primary hover:underline"
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------- states: load/err/empty --- */

export function DashLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ink-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-surface-stroke border-t-brand-primary" />
      {label}
    </div>
  );
}

/** Error state. Rendered BEFORE any empty state so a failed RPC never reads as
 *  "no data" — the failure mode that hid a broken homework RPC for a day (§6). */
export function DashError({ label }: { label: string }) {
  return (
    <p className="py-8 text-center text-[12.5px] text-ink-500">
      {label}
    </p>
  );
}

/** Empty state. Uses the shared `EmptyState` in its compact size so a card with
 *  nothing in it looks like every other empty surface in the portal rather than
 *  a stray line of grey text. */
export function DashEmpty({ label }: { label: string }) {
  return (
    <EmptyState
      icon={<Inbox className="h-7 w-7" />}
      title={label}
      size="sm"
      tone="teal"
      reason="noData"
    />
  );
}

/**
 * Placeholder for a blueprint card whose data source does not exist yet.
 *
 * Deliberately explicit rather than a plausible-looking chart of zeros or
 * sample numbers: a principal cannot tell invented data from real data, and a
 * dashboard that shows both is worse than one that shows less.
 *
 * Currently unused — every blueprint card now has a data source. Kept on
 * purpose: it is the sanctioned way to add a card ahead of its query, and
 * having it here is what makes "ship the shell, not fake numbers" the easy
 * option next time. Not dead code to sweep.
 */
export function DashPending({
  what,
  needs,
}: {
  what: string;
  needs: string;
}) {
  return (
    <div className="rounded-[14px] border border-dashed border-surface-stroke bg-surface-stroke/40 px-4 py-6 text-center">
      <p className="m-0 text-[12.5px] font-semibold text-ink-700">
        {what} is not wired up yet
      </p>
      <p className="m-0 mt-1 text-[11.5px] text-ink-500">
        Needs {needs}. Showing nothing rather than sample numbers.
      </p>
    </div>
  );
}
