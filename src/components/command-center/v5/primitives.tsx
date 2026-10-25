import * as React from "react";

import { cn } from "@/lib/utils";
import type { Dash5Band } from "@/hooks/dashboard/useDash5";

import { BAND } from "./format";

/**
 * Visual primitives for Admin Dashboard v5, built to
 * public/report_reference/salci-admin-dashboard-v5.html.
 *
 * The reference hardcodes hexes because it is a standalone file. Here every
 * colour flows through a token declared in BOTH `:root` and `.dark`
 * (CLAUDE.md 20), so the page re-skins on the theme toggle instead of looking
 * right once. The only new token the reference needed was `--dash-exc`, the
 * fourth band above "good"; the other three already existed.
 */

export function BandPill({ band }: { band: Dash5Band | null }) {
  if (!band) {
    return <span className="text-[11.5px] font-medium text-ink-400">Not assessed</span>;
  }
  const b = BAND[band];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
      style={{
        color: `hsl(var(${b.varName}))`,
        background: `hsl(var(${b.varName}) / 0.12)`,
        borderColor: `hsl(var(${b.varName}) / 0.26)`,
      }}
    >
      <span className="text-[9px] leading-none" aria-hidden>{b.glyph}</span>
      {b.label}
    </span>
  );
}

/* ----------------------------------------------------------------- cells -- */

/** Taught over planned, with the denominator quietened. */
export function Frac({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <span className="text-ink-400">N/A</span>;
  return (
    <span className="tabular-nums">
      {a} <span className="font-medium text-ink-400">/ {b}</span>
    </span>
  );
}

/**
 * Papers cell, against the Teacher Target.
 *
 * The denominator is a real one now: the current period of whatever targets the
 * teachers in this row hold. With no target the row still says what was done,
 * against 0, rather than pretending the question does not apply.
 */
export function TargetCell({
  done, target, ytd, unit,
}: {
  done: number;
  target: number;
  ytd: number;
  /** "published" for exams, "set" for homework. */
  unit: string;
}) {
  const tone = !target
    ? "var(--ink-400)"
    : done >= target
      ? "var(--dash-exc)"
      : done / target >= 0.6
        ? "var(--dash-warning)"
        : "var(--dash-critical)";
  return (
    <span className="inline-block text-right leading-[1.25]">
      <span className="block whitespace-nowrap text-sm tabular-nums">
        <b style={{ color: `hsl(${tone})` }}>{done}</b>
        <span className="font-medium text-ink-400"> / {target}</span>
      </span>
      <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
        {target ? "this target period" : "no target set"} ·{" "}
        <b className="text-ink-600">{ytd}</b> {unit} this year
      </span>
    </span>
  );
}

/**
 * Subjects cell. Two different numbers, and conflating them is how a dashboard
 * lies: a wing teaching English across 10 classes offers ONE subject and has TEN
 * rows to staff. At class level they are the same, so the caption is dropped.
 */
export function SubjectsCell({
  pairs, distinct, showDistinct,
}: { pairs: number | null; distinct: number | null; showDistinct: boolean }) {
  return (
    <span className="inline-block text-right leading-[1.25]">
      <span className="block text-sm font-bold tabular-nums">{pairs ?? 0}</span>
      {showDistinct && (
        <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
          {distinct ?? 0} distinct
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ card -- */

export function V5Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("surface-card frosted-shadow rounded-card border border-surface-stroke", className)}>
      {children}
    </div>
  );
}

export function V5CardHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-3 px-4 pb-3 pt-4 sm:px-[18px]", className)}>
      {children}
    </div>
  );
}

export function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 className="mb-1 mt-7 text-[17px] font-extrabold tracking-[-0.025em] text-ink-900">{title}</h2>
      {sub && <p className="mb-3 text-[12.5px] font-medium text-ink-500">{sub}</p>}
    </>
  );
}

export function LevelTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-brand-secondary/12 px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-brand-secondary">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ breadcrumb -- */

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px]" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <React.Fragment key={`${c.label}-${i}`}>
          {i > 0 && <span className="text-ink-400" aria-hidden>/</span>}
          {c.onClick ? (
            <button
              type="button"
              onClick={c.onClick}
              className="rounded-[7px] px-1.5 py-[3px] text-[12.5px] font-semibold text-brand-primary hover:bg-brand-primary/10"
            >
              {c.label}
            </button>
          ) : (
            <span className="px-0.5 py-[3px] font-bold text-ink-900">{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/* ----------------------------------------------------- traditional table -- */

/** Below this many body rows the whole table fits in view; nothing rides. */
const STICKY_MIN_ROWS = 5;

/**
 * Keeps a table's header row on screen while its rows scroll past, and lets it
 * go with the table after the last row. Only for tables of more than
 * STICKY_MIN_ROWS body rows, on Tushar's rule (2026-09-23).
 *
 * Not `position: sticky`, and that is forced: TradTable's wrapper is
 * `overflow-x: auto` so wide grids scroll sideways on a phone, and any overflow
 * other than `visible` makes the wrapper the sticky element's scroll container.
 * A sticky header inside it can only stick to the wrapper, which never scrolls
 * vertically, so it never sticks at all. Dropping the overflow would bring the
 * 1,272px phone grid back as a page that scrolls sideways.
 *
 * So the header rides down by a transform instead. It is still part of the
 * same table, which keeps the columns aligned, the sideways scroll working and
 * the pinned first column pinned. It rides to the top edge of whatever the rows
 * are scrolling in:
 *   * on the page, the bottom of the pinned tab strip (`data-pinned-strip`);
 *   * in a drawer, the top of the drawer's own scrolling body.
 * It is clamped so it never goes past the TOP of the last row: the footer total
 * is never covered, and once that row scrolls up the header leaves with it.
 */
function useStickyHead(enabled: boolean, tableRef: React.RefObject<HTMLTableElement>) {
  React.useEffect(() => {
    const table = tableRef.current;
    if (!enabled || !table) return;
    let frame = 0;

    // Ancestors that COULD scroll vertically, found once. TradTable's own
    // wrapper is skipped: it computes as overflow-y auto (overflow-x: auto
    // forces it) but never scrolls vertically, and a header pinned to it would
    // never move.
    const candidates: HTMLElement[] = [];
    for (let n = table.parentElement?.parentElement ?? null;
         n && n !== document.body && n !== document.documentElement;
         n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") candidates.push(n);
    }
    // A table in a drawer or dialog never follows the page's tab strip, which
    // sits behind the overlay.
    const inOverlay = !!table.closest("[role=dialog]");

    const settle = (head: HTMLTableSectionElement, y: number) => {
      head.style.setProperty("--sticky-y", `${y}px`);
      head.classList.toggle("is-stuck", y > 0);
    };

    const update = () => {
      frame = 0;
      const head = table.tHead;
      if (!head) return;
      const cell = head.rows[0]?.cells[0];
      if (!cell) return;

      let bodyRows = 0;
      for (const b of Array.from(table.tBodies)) bodyRows += b.rows.length;
      if (bodyRows <= STICKY_MIN_ROWS) {
        settle(head, 0);
        return;
      }

      // What the rows are scrolling in, right now: the first candidate with
      // more content than room (an ancestor with only overflow-x: hidden also
      // computes as overflow-y auto but never scrolls), else the page.
      const host = candidates.find((n) => n.scrollHeight > n.clientHeight + 1);
      let line: number;
      if (host) {
        line = host.getBoundingClientRect().top + host.clientTop;
      } else if (inOverlay) {
        settle(head, 0);
        return;
      } else {
        const strip = document.querySelector<HTMLElement>("[data-pinned-strip]");
        line = strip ? Math.max(0, strip.getBoundingClientRect().bottom) : 0;
      }

      // Measured off the header CELL, with the current offset taken back out,
      // not off the table: under border-collapse the cell sits a pixel below
      // the table's edge at some widths, and measuring the table left a 1px
      // slit above the riding header where the row behind showed through
      // (375px, 2026-09-23).
      const current = parseFloat(head.style.getPropertyValue("--sticky-y")) || 0;
      const box = cell.getBoundingClientRect();
      const naturalTop = box.top - current;
      const rows = table.rows;
      const last = rows.length ? rows[rows.length - 1] : null;
      const lastTop = last && !head.contains(last)
        ? last.getBoundingClientRect().top
        : naturalTop + box.height;
      // Floored, so any sub-pixel remainder tucks the header UNDER the edge
      // rather than opening a gap above it; the edge paints over the overlap.
      const reach = Math.floor(line - naturalTop);
      const stop = Math.floor(lastTop - naturalTop - box.height);
      settle(head, Math.max(0, Math.min(reach, stop)));
    };
    // One layout read per frame however fast anything scrolls.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // Capture: scroll does not bubble, and a drawer's body scrolls itself, not
    // the window. Listening in the capture phase hears both.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    // Rows come and go on every drill-down, "show all" and load; the row gate
    // and the clamp have to follow the table's size, not just the scroll.
    const ro = new ResizeObserver(schedule);
    ro.observe(table);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [enabled, tableRef]);
}

/**
 * The reference's drill-down is a ruled grid with a filled header and zebra
 * rows, deliberately unlike the app's airy list surfaces: it is a document a
 * principal reads, not a feed. Kept on tokens so it still flips to dark.
 */
export function TradTable({
  children, stickyHeader = true,
}: {
  children: React.ReactNode;
  /**
   * The header row stays on screen while the rows scroll under it, on the page
   * or in a drawer (see useStickyHead). On by default, and inert until the
   * table has more than STICKY_MIN_ROWS body rows. Pass false to opt out.
   */
  stickyHeader?: boolean;
}) {
  const tableRef = React.useRef<HTMLTableElement>(null);
  useStickyHead(stickyHeader, tableRef);
  return (
    // The first column pins while the rest scrolls sideways: on a phone the
    // School performance grid is 1,272px wide and the wing names scrolled
    // away with the numbers, so a row could not be read (2026-09-18 audit).
    // Opaque cells, or the scrolled columns show through the pinned one.
    // `isolate`: the pinned cells carry a z-index, and without their own
    // stacking context they painted over the page's pinned tab strip while
    // the page scrolled (2026-09-18 phone test). Inside an isolated wrapper
    // their z-index only competes with the other cells.
    //
    // The pinned column is also CAPPED on a phone. A cell sizes itself to its
    // widest line, and the second line of these tables is a joined list
    // ("English, English Grammar, English Reader"), so the pinned column took
    // 256px of the 309px card and every scrolled column arrived sliced in half
    // at the right edge (2026-09-22 phone screenshot: Teachers by activity).
    // max-width on a `td` is ignored under `table-layout: auto`, so the cap
    // goes on the cell's own children, which is what actually sets the width;
    // `truncate` on those lines then does its job. From `sm` up there is room
    // for the full name, so the cap lifts.
    <div
      className={cn(
        "relative isolate overflow-x-auto [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-10 [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-10 [&_td:first-child]:bg-surface-card [&_th:first-child]:bg-surface-stroke [&_td:first-child>*]:max-w-[38vw] sm:[&_td:first-child>*]:max-w-none",
        stickyHeader && [
          "[&_thead_th]:[transform:translateY(var(--sticky-y,0px))]",
          // Opaque while it rides over the rows. The normal header tint is
          // 50% alpha and the rows would show through it, so the same tint is
          // laid over the card colour instead: identical at rest.
          "[&_thead_th]:!bg-surface-card",
          "[&_thead_th]:[background-image:linear-gradient(hsl(var(--surface-stroke)/0.5),hsl(var(--surface-stroke)/0.5))]",
          // Above the body cells it slides over, and the pinned corner above
          // the header cells that slide under it when the grid scrolls sideways.
          "[&_thead_th:not(:first-child)]:relative [&_thead_th:not(:first-child)]:z-20",
          "[&_thead_th:first-child]:!z-30",
          // Collapsed borders stay where the table drew them, so a riding
          // header draws its own column rules, and a shadow once it is lifted.
          "[&_thead.is-stuck_th]:shadow-[inset_-1px_0_0_hsl(var(--surface-stroke)),0_8px_12px_-10px_rgba(0,0,0,0.35)]",
        ],
      )}
    >
      <table ref={tableRef} className="w-full border-collapse border border-surface-stroke text-[13px]">
        {children}
      </table>
    </div>
  );
}

export const thBase =
  "border border-surface-stroke bg-surface-stroke/50 px-3 py-2.5 text-left text-[12.5px] font-bold text-ink-900 whitespace-nowrap";
export const tdBase = "border border-surface-stroke px-3 py-2.5 align-middle";

/* ---------------------------------------------------- load / error / none - */

export function V5Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ink-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-surface-stroke border-t-brand-primary" />
      {label}
    </div>
  );
}

/** Error renders BEFORE any empty state, so a failed RPC never reads as "no data". */
export function V5Error({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-9 text-center">
      <p className="m-0 text-[12.5px] text-ink-600">{label}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[12.5px] font-bold text-brand-primary hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function V5Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-[13px] border border-dashed border-surface-stroke bg-surface-stroke/30 px-5 py-8 text-center">
      <p className="m-0 text-[13.5px] font-bold text-ink-600">{title}</p>
      {sub && <p className="m-0 mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------- horizontal bar list ---- */

/**
 * The reference's `.bars-h`: a 138px label, a 9px track, a 62px value, 11px
 * apart. Six cards drew this shape and each had improvised its own column
 * widths and track height, which is why the page did not look like one thing.
 * `sub` is the reference's second label line; it is omitted rather than left
 * empty when a row has nothing to add.
 */
export function BarsH({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[11px]">{children}</div>;
}

export function BarRow({
  label, sub, value, pct, color, onClick, title, marker, action,
}: {
  label: React.ReactNode;
  sub?: React.ReactNode;
  value: React.ReactNode;
  /** 0 to 100, already scaled by the caller against whatever its axis is. */
  pct: number;
  color: string;
  onClick?: () => void;
  title?: string;
  /** A reference line inside the track, 0 to 100. The syllabus pace line. */
  marker?: number | null;
  /** A trailing cell: an assign button, or a caret on a drillable row. */
  action?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-ink-600">{label}</span>
        {sub && <span className="block truncate text-[10.5px] font-medium text-ink-400">{sub}</span>}
      </span>
      {/* The track clips its overflow, so the marker has to sit INSIDE it:
          anything taller is cut away and never appears. */}
      <span className="relative h-[9px] overflow-hidden rounded-[4px] bg-surface-stroke" aria-hidden>
        <span
          className="block h-full rounded-[4px]"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
        />
        {marker != null && (
          <i
            className="absolute inset-y-0 block w-[2px] bg-ink-900/70"
            style={{ left: `${Math.max(0, Math.min(99, marker))}%` }}
          />
        )}
      </span>
      <span className="text-right text-[12.5px] font-bold tabular-nums text-ink-900">{value}</span>
      {action !== undefined && <span className="flex justify-end">{action}</span>}
    </>
  );
  const cls = cn(
    "grid items-center gap-2.5",
    action !== undefined
      ? "grid-cols-[minmax(84px,138px)_1fr_62px_auto]"
      : "grid-cols-[minmax(84px,138px)_1fr_62px]",
  );
  if (!onClick) return <div className={cls} title={title}>{body}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
      title={title}
      className={cn(cls, "-mx-2 cursor-pointer rounded-lg px-2 py-0.5 text-left hover:bg-surface-stroke/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary")}
    >
      {body}
    </div>
  );
}
