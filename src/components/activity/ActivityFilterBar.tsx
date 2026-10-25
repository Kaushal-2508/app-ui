import { useEffect, useState } from "react";
import { CalendarIcon, Search, Settings2, X } from "lucide-react";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TONES } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { SourceIcon } from "./SourceIcon";
import {
  ACTIVITY_SOURCES,
  EMPTY_FILTERS,
  SOURCE_META,
  actionLabel,
  countActiveFilters,
  humanize,
  type ActivityFilters,
  type ActivitySource,
} from "./activityModel";

export interface ActionOption {
  value: string;
  label: string;
}
export interface ActorOption {
  id: string;
  name: string;
}

interface ActivityFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: ActivityFilters;
  onFiltersChange: (next: ActivityFilters) => void;
  actionOptions: ActionOption[];
  actorOptions: ActorOption[];
  entityTypeOptions: string[];
}

type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

function presetBounds(preset: DatePreset, range: DateRange | undefined): { from: string | null; to: string | null } {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "7d":
      return { from: startOfDay(subDays(now, 6)).toISOString(), to: endOfDay(now).toISOString() };
    case "30d":
      return { from: startOfDay(subDays(now, 29)).toISOString(), to: endOfDay(now).toISOString() };
    case "custom":
      return {
        from: range?.from ? startOfDay(range.from).toISOString() : null,
        to: range?.to ? endOfDay(range.to).toISOString() : range?.from ? endOfDay(range.from).toISOString() : null,
      };
    default:
      return { from: null, to: null };
  }
}

const ANY = "__any__";

/**
 * Search box + source toggles inline, everything else (date range, action,
 * person, entity type) in a centred Dialog with pending state that commits
 * on Apply. It used to be a bottom FilterSheet, which on a laptop stretched
 * a four-field form across the whole viewport; a dialog keeps it a compact
 * box in front of the page (asked for explicitly, 2026-09-14). Source
 * toggles commit immediately: they are the filter people reach for most and
 * a round-trip through Apply would slow it down.
 */
export function ActivityFilterBar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  actionOptions,
  actorOptions,
  entityTypeOptions,
}: ActivityFilterBarProps) {
  const [pendingPreset, setPendingPreset] = useState<DatePreset>("all");
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>();
  const [pendingAction, setPendingAction] = useState<string>(ANY);
  const [pendingActor, setPendingActor] = useState<string>(ANY);
  const [pendingEntityType, setPendingEntityType] = useState<string>(ANY);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Keep the dialog's pending controls in step with committed filters, so
  // reopening it shows what is applied (including after "Clear all").
  useEffect(() => {
    setPendingAction(filters.action ?? ANY);
    setPendingActor(filters.actorId ?? ANY);
    setPendingEntityType(filters.entityType ?? ANY);
    if (!filters.from && !filters.to) {
      setPendingPreset("all");
      setPendingRange(undefined);
    }
  }, [filters.action, filters.actorId, filters.entityType, filters.from, filters.to]);

  const sheetCount = countActiveFilters({ ...filters, sources: [] });

  const toggleSource = (source: ActivitySource) => {
    const has = filters.sources.includes(source);
    const next = has ? filters.sources.filter((s) => s !== source) : [...filters.sources, source];
    // Selecting every source is the same as selecting none; collapse to none.
    onFiltersChange({ ...filters, sources: next.length === ACTIVITY_SOURCES.length ? [] : next });
  };

  const apply = () => {
    const bounds = presetBounds(pendingPreset, pendingRange);
    onFiltersChange({
      ...filters,
      action: pendingAction === ANY ? null : pendingAction,
      actorId: pendingActor === ANY ? null : pendingActor,
      entityType: pendingEntityType === ANY ? null : pendingEntityType,
      from: bounds.from,
      to: bounds.to,
    });
  };

  const reset = () => {
    setPendingPreset("all");
    setPendingRange(undefined);
    setPendingAction(ANY);
    setPendingActor(ANY);
    setPendingEntityType(ANY);
    onFiltersChange({ ...EMPTY_FILTERS, sources: filters.sources });
  };

  const activeTotal = countActiveFilters(filters);

  return (
    <div className="space-y-3">
      {/* Search and the Filters pill share one row at every width; on a phone
          the pill used to drop under the box and sit alone on its own line. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search people, actions or entities…"
            className="h-10 rounded-lg bg-surface-card pl-9 pr-9 shadow-card-sm"
            aria-label="Search loaded events"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-500 hover:bg-ink-400/10"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={dialogOpen}
            onClick={() => setDialogOpen(true)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-surface-stroke bg-surface-card px-4 text-sm font-medium text-ink-700 shadow-card-sm",
              "transition-[colors,box-shadow] duration-200 hover:bg-ink-400/5 hover:shadow-card",
              sheetCount > 0 && "border-brand-primary text-brand-primary",
            )}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Filters</span>
            <span className="sr-only sm:hidden">Filters</span>
            {sheetCount > 0 && (
              <span
                aria-label={`${sheetCount} active filters`}
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1.5 text-xs font-semibold text-white"
              >
                {sheetCount}
              </span>
            )}
          </button>

          {activeTotal > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange(EMPTY_FILTERS)}
              className="h-10 shrink-0 px-2 text-ink-600 sm:px-3"
              aria-label="Clear all filters"
            >
              <X className="h-3.5 w-3.5 sm:mr-1" aria-hidden />
              <span className="hidden sm:inline">Clear all</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter dialog: a centred box in front of the page. Four fields in a
          two-column grid on tablets and up, pending until Apply. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>
              Narrow the timeline. Choices apply when you press Apply.
            </DialogDescription>
          </DialogHeader>
          <div id="activity-filter-panel" className="pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-ink-700">Date range</Label>
                <Select value={pendingPreset} onValueChange={(v) => setPendingPreset(v as DatePreset)}>
                  <SelectTrigger className="h-10 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pendingPreset === "custom" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("h-10 w-full justify-start rounded-xl text-left font-normal", FIELD_FILL, !pendingRange?.from && "text-ink-500")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" aria-hidden />
                        {pendingRange?.from
                          ? pendingRange.to
                            ? `${format(pendingRange.from, "d MMM yyyy")} to ${format(pendingRange.to, "d MMM yyyy")}`
                            : format(pendingRange.from, "d MMM yyyy")
                          : "Pick the days"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        selected={pendingRange}
                        onSelect={setPendingRange}
                        numberOfMonths={1}
                        disabled={{ after: new Date() }}
                        className="pointer-events-auto p-3"
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-ink-700">Action</Label>
                <Select value={pendingAction} onValueChange={setPendingAction}>
                  <SelectTrigger className="h-10 w-full rounded-xl">
                    <SelectValue placeholder="Any action" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ANY}>Any action</SelectItem>
                    {actionOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-ink-700">Person</Label>
                <Select value={pendingActor} onValueChange={setPendingActor}>
                  <SelectTrigger className="h-10 w-full rounded-xl">
                    <SelectValue placeholder="Anyone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ANY}>Anyone</SelectItem>
                    {actorOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-ink-700">Entity type</Label>
                <Select value={pendingEntityType} onValueChange={setPendingEntityType}>
                  <SelectTrigger className="h-10 w-full rounded-xl">
                    <SelectValue placeholder="Any type" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ANY}>Any type</SelectItem>
                    {entityTypeOptions.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{humanize(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* One note for both caveats, under the grid, so the two columns
                end level and the footer sits on a straight line. */}
            <p className="mt-4 text-[12px] leading-5 text-ink-500">
              Person lists the people in the events loaded so far. Entity type applies to
              system changes only: tasks, exams and assignments have a fixed type.
            </p>
          </div>
          <DialogFooter className="mt-4 gap-2 border-t border-surface-stroke pt-4 sm:justify-between">
            <Button type="button" variant="ghost" onClick={reset} className="text-ink-600">
              Reset
            </Button>
            <Button
              type="button"
              onClick={() => {
                apply();
                setDialogOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Source toggles: multi-select pills. Empty selection means "all", so
          the row always reads as a complete statement of what is shown. One
          scroll-snap row on a phone that stays inside the page gutter, so
          the first pill lines up with the search box above it (a full-bleed
          row put "All sources" against the screen edge and cut the last pill,
          2026-09-21 phone test); wraps from sm. */}
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide snap-x sm:flex-wrap sm:overflow-visible sm:pb-0"
        role="group"
        aria-label="Filter by source"
      >
        <SourcePill
          label="All sources"
          active={filters.sources.length === 0}
          onClick={() => onFiltersChange({ ...filters, sources: [] })}
        />
        {ACTIVITY_SOURCES.map((s) => {
          const meta = SOURCE_META[s];
          const t = TONES[meta.tone];
          const active = filters.sources.includes(s);
          return (
            <SourcePill
              key={s}
              label={meta.label}
              active={active}
              onClick={() => toggleSource(s)}
              leading={
                <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-md", active ? "bg-white/20 text-white" : cn(t.bg, t.fg))}>
                  <SourceIcon source={s} className="h-3 w-3" />
                </span>
              }
            />
          );
        })}
      </div>

      {/* Applied sheet filters as removable chips, so the state is visible
          without reopening the sheet. */}
      {sheetCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {filters.action && (
            <AppliedChip label={`Action: ${actionLabel(filters.action)}`} onRemove={() => onFiltersChange({ ...filters, action: null })} />
          )}
          {filters.actorId && (
            <AppliedChip
              label={`Person: ${actorOptions.find((a) => a.id === filters.actorId)?.name ?? "Selected"}`}
              onRemove={() => onFiltersChange({ ...filters, actorId: null })}
            />
          )}
          {filters.entityType && (
            <AppliedChip label={`Type: ${humanize(filters.entityType)}`} onRemove={() => onFiltersChange({ ...filters, entityType: null })} />
          )}
          {(filters.from || filters.to) && (
            <AppliedChip
              label={`Dates: ${filters.from ? format(new Date(filters.from), "d MMM") : "start"} to ${filters.to ? format(new Date(filters.to), "d MMM yyyy") : "now"}`}
              onRemove={() => onFiltersChange({ ...filters, from: null, to: null })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SourcePill({
  label,
  active,
  onClick,
  leading,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors",
        active
          ? "border-transparent bg-brand-primary text-white shadow-hero"
          : "border-surface-stroke bg-surface-card text-ink-700 shadow-card-sm hover:-translate-y-px hover:border-brand-primary/60 hover:text-ink-900 hover:shadow-card",
      )}
    >
      {leading}
      {label}
    </button>
  );
}

function AppliedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-primary/10 pl-2.5 pr-1 font-medium text-brand-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand-primary/20"
        aria-label={`Remove filter ${label}`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
