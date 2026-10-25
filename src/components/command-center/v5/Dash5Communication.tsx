import { cn } from "@/lib/utils";
import {
  useDash5Communication, useDash5SchoolWideNeeds,
} from "@/hooks/dashboard/useDash5";

import {
  V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "./primitives";

/**
 * The Communication page and the School-wide needs card from
 * public/report_reference/salci-admin-dashboard-v5.html.
 *
 * The reference's reach bars include push delivery and open rates. SALCI has no
 * outbound channel switched on (CLAUDE.md 11: the external comms stack is
 * dormant, provider keys and all), so those two bars would be invented numbers
 * on a principal's screen. The card draws what the database can answer and says
 * plainly why the rest is missing, which is the more useful answer anyway.
 */

/* ------------------------------------------------------- communication ---- */

/**
 * The three figures the Communication card shows while it is SHUT, so the row
 * says whether it is worth opening. Reads the same query as the section below
 * it, which React Query serves from one cache entry rather than twice.
 *
 * A school with nothing sent gets ONE honest chip rather than a row of zeroes:
 * the same rule the teacher-activity chips follow, because a row of zeroes
 * reads as a broken widget rather than as an empty year.
 */
export function Dash5CommunicationHighlights() {
  const q = useDash5Communication();
  const d = q.data;
  if (!d) return null;

  const chip = (text: string) => (
    <span
      key={text}
      className="inline-flex items-center rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
    >
      {text}
    </span>
  );

  if (d.circulars.total === 0 && d.ptm.total === 0) {
    return chip("Nothing sent or scheduled yet");
  }

  return (
    <>
      {d.circulars.total > 0 &&
        chip(`${d.circulars.total} circular${d.circulars.total === 1 ? "" : "s"} this year`)}
      {d.circulars.reached > 0 &&
        chip(`${Math.round((d.circulars.opened * 100) / d.circulars.reached)}% opened`)}
      {d.ptm.total > 0 &&
        chip(`${d.ptm.total} meeting${d.ptm.total === 1 ? "" : "s"} in the next 30 days`)}
      {d.ptm.bookings > 0 && chip(`${d.ptm.bookings.toLocaleString()} slots booked`)}
    </>
  );
}

/* The Circulars / Parent-teacher meetings / Reach-this-year block that used
   to live here was removed on 2026-09-18. The Command Center links straight
   to /school/communication now, which owns notices, the diary, PTM and
   messages in full; keeping a slice of it on the dashboard meant two places
   to keep in step. Dash5CommunicationHighlights above is what survives. */

/* --------------------------------------------------- school-wide needs ---- */

const SEV: Record<string, { varName: string; glyph: string }> = {
  High: { varName: "--dash-critical", glyph: "■" },
  Medium: { varName: "--dash-warning", glyph: "◆" },
  Low: { varName: "--dash-good", glyph: "●" },
};

export function Dash5SchoolWideNeeds({ onGoto }: { onGoto?: (id: string) => void }) {
  const q = useDash5SchoolWideNeeds();
  const items = q.data?.items ?? [];

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">School-wide</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Items that belong to no single wing, so nobody's list shows them.
          </p>
        </div>
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load school-wide items." onRetry={() => void q.refetch()} />
        ) : items.length === 0 ? (
          <V5Empty
            title="Nothing school-wide is waiting"
            sub="Proctoring reviews, open issues and leave decisions are all clear."
          />
        ) : (
          <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
            {items.map((it) => {
              const s = SEV[it.severity] ?? SEV.Low;
              return (
                <li key={it.title} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[11px]"
                    style={{
                      color: `hsl(var(${s.varName}))`,
                      background: `hsl(var(${s.varName}) / 0.12)`,
                    }}
                    aria-hidden
                  >
                    {s.glyph}
                  </span>
                  <span className="min-w-0 flex-1 basis-[220px]">
                    <span className="block text-[13px] font-semibold text-ink-900">{it.title}</span>
                    <span className="mt-px block text-[11.5px] font-medium text-ink-500">{it.detail}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onGoto?.(it.goto)}
                    className={cn(
                      "shrink-0 rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold",
                      "text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10",
                    )}
                  >
                    {it.cta}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </V5Card>
  );
}
