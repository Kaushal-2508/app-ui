import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Download, FileStack, LayoutGrid, Search, type LucideIcon } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { TONES, type Tone } from "@/components/shared/design-system";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Reports: every report SALCI can download or generate, in one place, opened
 * from the dashboard's Download report button.
 *
 * Two kinds of entry. A report that needs nothing from a particular page is
 * generated right here (`run`, download icon). Everything else needs the page
 * that owns its inputs (a class, an exam, rows picked in a table), so the row
 * takes the reader there (`to`, arrow icon) rather than pretending it can be
 * made from the dashboard.
 *
 * Kept deliberately light on text (owner's call, 2026-10-06): a one-line
 * title and a one-line description per row, no counts, no instructions.
 * Desktop: a category rail beside the list. Phone: a chip row above it.
 */

export type ReportFormat = "PDF" | "Excel" | "CSV" | "Print" | "PNG";

export interface ReportCategory {
  id: string;
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export interface ReportItem {
  id: string;
  /** A ReportCategory id. */
  category: string;
  title: string;
  /** One short line; it is truncated, never wrapped. */
  description: string;
  formats: ReportFormat[];
  icon: LucideIcon;
  /** Generates without leaving the dashboard. */
  run?: () => void;
  /** Otherwise: the page that builds it, and that page's name. */
  to?: string;
  place?: string;
  /** Extra words the search should match. */
  keywords?: string;
}

const ALL = "all";

export function ReportsCenter({
  open, onOpenChange, categories, items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ReportCategory[];
  items: ReportItem[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(ALL);

  const term = query.trim().toLowerCase();
  const matches = useMemo(
    () => items.filter((i) =>
      !term || [i.title, i.description, i.place, i.keywords, i.formats.join(" ")]
        .filter(Boolean).join(" ").toLowerCase().includes(term)),
    [items, term],
  );
  const shown = active === ALL ? matches : matches.filter((i) => i.category === active);
  const groups = categories
    .map((c) => ({ c, rows: shown.filter((i) => i.category === c.id) }))
    .filter((g) => g.rows.length > 0);
  // Categories with nothing to offer this school are not shown at all.
  const usable = categories.filter((c) => items.some((i) => i.category === c.id));
  const filters = [{ id: ALL, label: "All reports", icon: LayoutGrid }, ...usable];

  const choose = (i: ReportItem) => {
    onOpenChange(false);
    // Let this sheet start closing before the report's own dialog opens, so
    // the two do not fight over focus.
    window.setTimeout(() => {
      if (i.run) i.run();
      else if (i.to) navigate(i.to);
    }, 150);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reports"
      icon={<FileStack className="h-4 w-4" />}
      desktopWidth="lg"
      className="h-[88dvh] sm:h-[min(640px,88dvh)]"
      bodyClassName="flex flex-col p-0 overflow-y-hidden"
    >
      <div className="border-b border-surface-stroke px-4 py-3 sm:px-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
            className="h-10 rounded-xl border-surface-stroke bg-surface-base/60 pl-9"
          />
        </div>
        {/* Phone: the categories as a chip row. */}
        <div className="scrollbar-hide -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:hidden">
          {filters.map((f) => (
            <Button
              key={f.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActive(f.id)}
              aria-pressed={active === f.id}
              className={cn(
                "h-8 flex-none rounded-full px-3 text-[13px] font-medium",
                active === f.id
                  ? "border-brand-primary bg-brand-primary text-white hover:bg-brand-primary/90 hover:text-white"
                  : "border-surface-stroke bg-surface-card text-ink-900",
              )}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Desktop: the category rail. */}
        <nav aria-label="Report categories" className="hidden w-[184px] flex-none overflow-y-auto border-r border-surface-stroke p-2 sm:block">
          {filters.map((f) => {
            const Icon = f.icon;
            const on = active === f.id;
            return (
              <Button
                key={f.id}
                type="button"
                variant="ghost"
                onClick={() => setActive(f.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "mb-0.5 h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[13.5px]",
                  on
                    ? "bg-brand-primary/10 font-semibold text-brand-primary hover:bg-brand-primary/15 hover:text-brand-primary"
                    : "font-medium text-ink-900 hover:bg-surface-stroke/60 hover:text-ink-900",
                )}
              >
                <Icon aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left">{f.label}</span>
              </Button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
          {groups.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title={term ? `No report matches "${query.trim()}"` : "No reports here"}
              reason="noResults"
              size="sm"
              action={term ? { label: "Clear search", onClick: () => setQuery("") } : undefined}
            />
          ) : (
            groups.map(({ c, rows }) => (
              <section key={c.id} className="mb-3 last:mb-0">
                {/* A heading only when several groups share the list. */}
                {active === ALL && (
                  <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                    {c.label}
                  </h3>
                )}
                <ul className="m-0 list-none p-0">
                  {rows.map((i) => {
                    const Icon = i.icon;
                    const tone = TONES[c.tone];
                    return (
                      <li key={i.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => choose(i)}
                          title={i.run ? "Generate" : `Opens in ${i.place}`}
                          className="group h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-left font-normal hover:bg-surface-stroke/50"
                        >
                          <span className={cn("grid h-9 w-9 flex-none place-items-center rounded-[10px]", tone.bg, tone.fg)}>
                            <Icon aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-ink-900">{i.title}</span>
                            <span className="block truncate text-[12.5px] text-ink-500">{i.description}</span>
                          </span>
                          {/* Phone: the description needs the width more than the format does. */}
                          <span className="hidden flex-none text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-500 sm:inline">
                            {i.formats[0]}
                          </span>
                          <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink-500 transition-colors duration-200 group-hover:bg-brand-primary/10 group-hover:text-brand-primary">
                            {i.run ? <Download aria-hidden /> : <ArrowUpRight aria-hidden />}
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </MobileSheet>
  );
}
