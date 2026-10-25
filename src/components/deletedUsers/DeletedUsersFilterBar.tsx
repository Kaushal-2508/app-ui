import { useEffect, useState } from "react";
import { CalendarIcon, Search, Settings2, X } from "lucide-react";
import { format } from "date-fns";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import {
  EMPTY_DUA_FILTERS,
  countDuaFilters,
  type DuaEntry,
  type DuaFilters,
  type DuaListPage,
} from "@/hooks/deletedUsers/useDeletedUsers";
import { ENTRY_META, roleLabel, sourceLabel } from "./duaModel";

const ANY = "__any__";
const numberFormat = new Intl.NumberFormat("en-IN");

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  filters: DuaFilters;
  onFiltersChange: (next: DuaFilters) => void;
  facets: DuaListPage["facets"] | undefined;
}

const toDay = (d: Date | undefined) => (d ? format(d, "yyyy-MM-dd") : null);
const fromDay = (s: string | null) => (s ? new Date(`${s}T00:00:00`) : undefined);

/**
 * Search (server-side, debounced by the page), Gone / Live again pills that
 * commit at once, and a Filters dialog for everything else, pending until
 * Apply. Same layout as the Activity Logs filter bar. Option lists come from
 * the server's facet counts, so every value shown has at least one entry.
 */
export function DeletedUsersFilterBar({ search, onSearchChange, filters, onFiltersChange, facets }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DuaFilters>(filters);
  const [range, setRange] = useState<DateRange | undefined>();

  useEffect(() => {
    if (!open) return;
    setPending(filters);
    setRange(filters.from ? { from: fromDay(filters.from), to: fromDay(filters.to) } : undefined);
  }, [open, filters]);

  const dialogCount = countDuaFilters({ ...filters, status: null });
  const activeTotal = countDuaFilters(filters);

  const statusCount = (v: string) => facets?.status.find((s) => s.value === v)?.count;

  const pick = <K extends keyof DuaFilters>(key: K, value: string) =>
    setPending((p) => ({ ...p, [key]: value === ANY ? null : value }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, email or admission number"
            className="h-10 rounded-lg bg-surface-card pl-9 pr-9 shadow-card-sm"
            aria-label="Search deleted users"
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
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-surface-stroke bg-surface-card px-4 text-sm font-medium text-ink-700 shadow-card-sm",
            "transition-[colors,box-shadow] duration-200 hover:bg-ink-400/5 hover:shadow-card",
            dialogCount > 0 && "border-brand-primary text-brand-primary",
          )}
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          <span className="sr-only sm:hidden">Filters</span>
          {dialogCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1.5 text-xs font-semibold text-white">
              {dialogCount}
            </span>
          )}
        </button>
        {activeTotal > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange({ ...EMPTY_DUA_FILTERS, q: filters.q })}
            className="h-10 shrink-0 px-2 text-ink-600 sm:px-3"
            aria-label="Clear all filters"
          >
            <X className="h-3.5 w-3.5 sm:mr-1" aria-hidden />
            <span className="hidden sm:inline">Clear all</span>
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide snap-x sm:flex-wrap sm:overflow-visible sm:pb-0" role="group" aria-label="Status">
        <Pill label="Everyone" active={!filters.status} onClick={() => onFiltersChange({ ...filters, status: null })} />
        <Pill
          label="Gone"
          count={statusCount("gone")}
          active={filters.status === "gone"}
          onClick={() => onFiltersChange({ ...filters, status: filters.status === "gone" ? null : "gone" })}
        />
        <Pill
          label="Live again"
          count={statusCount("live_again")}
          active={filters.status === "live_again"}
          onClick={() => onFiltersChange({ ...filters, status: filters.status === "live_again" ? null : "live_again" })}
        />
      </div>

      {dialogCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {filters.role && <Chip label={`Role: ${roleLabel(filters.role)}`} onRemove={() => onFiltersChange({ ...filters, role: null })} />}
          {filters.institution_id && (
            <Chip
              label={`School: ${facets?.institution.find((f) => f.value === filters.institution_id)?.label ?? "Selected"}`}
              onRemove={() => onFiltersChange({ ...filters, institution_id: null })}
            />
          )}
          {filters.deleted_by && (
            <Chip
              label={`Deleted by: ${facets?.deleted_by.find((f) => f.value === filters.deleted_by)?.label ?? "Selected"}`}
              onRemove={() => onFiltersChange({ ...filters, deleted_by: null })}
            />
          )}
          {filters.source && <Chip label={`How: ${sourceLabel(filters.source)}`} onRemove={() => onFiltersChange({ ...filters, source: null })} />}
          {filters.entry && <Chip label={ENTRY_META[filters.entry].label} onRemove={() => onFiltersChange({ ...filters, entry: null })} />}
          {(filters.from || filters.to) && (
            <Chip
              label={`Deleted ${filters.from ? format(fromDay(filters.from)!, "d MMM yyyy") : "any time"} to ${filters.to ? format(fromDay(filters.to)!, "d MMM yyyy") : "now"}`}
              onRemove={() => onFiltersChange({ ...filters, from: null, to: null })}
            />
          )}
          {filters.has_files && <Chip label="Has files" onRemove={() => onFiltersChange({ ...filters, has_files: false })} />}
          {filters.flagged && <Chip label="Flagged" onRemove={() => onFiltersChange({ ...filters, flagged: false })} />}
          {filters.show_test && <Chip label="Test accounts shown" onRemove={() => onFiltersChange({ ...filters, show_test: false })} />}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>Choices apply when you press Apply.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <Field label="Role">
              <Select value={pending.role ?? ANY} onValueChange={(v) => pick("role", v)}>
                <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ANY}>Any role</SelectItem>
                  {(facets?.role ?? []).map((f) => (
                    <SelectItem key={f.value} value={f.value}>{roleLabel(f.value)} ({numberFormat.format(f.count)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="School">
              <Select value={pending.institution_id ?? ANY} onValueChange={(v) => pick("institution_id", v)}>
                <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ANY}>Any school</SelectItem>
                  {(facets?.institution ?? []).map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label ?? "Unnamed school"} ({numberFormat.format(f.count)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Deleted by">
              <Select value={pending.deleted_by ?? ANY} onValueChange={(v) => pick("deleted_by", v)}>
                <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ANY}>Anyone</SelectItem>
                  {(facets?.deleted_by ?? []).map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label ?? "Unknown person"} ({numberFormat.format(f.count)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="How">
              <Select value={pending.source ?? ANY} onValueChange={(v) => pick("source", v)}>
                <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any way</SelectItem>
                  {(facets?.source ?? []).map((f) => (
                    <SelectItem key={f.value} value={f.value}>{sourceLabel(f.value)} ({numberFormat.format(f.count)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Entry">
              <Select value={pending.entry ?? ANY} onValueChange={(v) => setPending((p) => ({ ...p, entry: v === ANY ? null : (v as DuaEntry) }))}>
                <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any entry</SelectItem>
                  {(facets?.entry ?? []).map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {ENTRY_META[f.value as DuaEntry]?.label ?? f.value} ({numberFormat.format(f.count)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Deleted between">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("h-10 w-full justify-start rounded-xl text-left font-normal", FIELD_FILL, !range?.from && "text-ink-500")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" aria-hidden />
                    {range?.from
                      ? range.to
                        ? `${format(range.from, "d MMM yyyy")} to ${format(range.to, "d MMM yyyy")}`
                        : format(range.from, "d MMM yyyy")
                      : "Any time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={range}
                    onSelect={(r) => {
                      setRange(r);
                      setPending((p) => ({ ...p, from: toDay(r?.from), to: toDay(r?.to ?? r?.from) }));
                    }}
                    numberOfMonths={1}
                    disabled={{ after: new Date() }}
                    className="pointer-events-auto p-3"
                  />
                </PopoverContent>
              </Popover>
            </Field>
            <Toggle label="Has files" checked={pending.has_files} onChange={(v) => setPending((p) => ({ ...p, has_files: v }))} />
            <Toggle label="Flagged" checked={pending.flagged} onChange={(v) => setPending((p) => ({ ...p, flagged: v }))} />
            <Toggle label="Show test accounts" checked={pending.show_test} onChange={(v) => setPending((p) => ({ ...p, show_test: v }))} />
          </div>
          <DialogFooter className="mt-4 gap-2 border-t border-surface-stroke pt-4 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-ink-600"
              onClick={() => {
                setPending({ ...EMPTY_DUA_FILTERS, q: filters.q, status: filters.status });
                setRange(undefined);
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              onClick={() => {
                onFiltersChange({ ...pending, q: filters.q, status: filters.status });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-ink-700">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-10 items-center justify-between gap-3 rounded-xl border border-surface-stroke px-3 text-sm text-ink-700">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Pill({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors",
        active
          ? "border-transparent bg-brand-primary text-white shadow-hero"
          : "border-surface-stroke bg-surface-card text-ink-700 shadow-card-sm hover:border-brand-primary/60 hover:text-ink-900",
      )}
    >
      {label}
      {count !== undefined && <span className={cn("tabular-nums", active ? "text-white/80" : "text-ink-500")}>{numberFormat.format(count)}</span>}
    </button>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
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
