import { saveBlob } from "@/lib/native";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Download, Layers, RefreshCw, SearchX } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";

import { PageHeader, PageShell } from "@/components/shared/page";
import { EmptyState, StatCell } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { useDebounce } from "@/hooks/useDebounce";
import { useActivityFeed, useActivityStats, ASSIGNMENT_REMOVED_ACTION } from "@/hooks/useActivityLogs";
import { ActivityDetailSheet } from "@/components/activity/ActivityDetailSheet";
import { ActivityEventRow } from "@/components/activity/ActivityEventRow";
import { ActivityFilterBar, type ActionOption, type ActorOption } from "@/components/activity/ActivityFilterBar";
import { SourceIcon } from "@/components/activity/SourceIcon";
import {
  ACTION_LABELS,
  ACTIVITY_SOURCES,
  EMPTY_FILTERS,
  SOURCE_META,
  actionLabel,
  actionPhrase,
  countActiveFilters,
  type ActivityEvent,
  type ActivityFilters,
} from "@/components/activity/activityModel";
import { toast, toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat("en-IN");

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMMM yyyy");
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export default function ActivityLogsPage() {
  const { data: roleInfo, isLoading: loadingRole } = useUserRole();
  // Super admins read across every school; everyone else is pinned to theirs.
  // RLS enforces the same boundary server-side; this only shapes the query.
  const institutionId = roleInfo?.isSuperAdmin ? null : roleInfo?.institutionId ?? null;
  const ready = !loadingRole && Boolean(roleInfo);

  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  // By value, never `filters !== EMPTY_FILTERS`: the filter bar builds a fresh
  // object on every change, so identity was true even when every field was
  // back at its default and a school with no activity read "Nothing matches".
  const hasFilters = countActiveFilters(filters) > 0;
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const feed = useActivityFeed(institutionId, filters, ready);
  const stats = useActivityStats(institutionId, ready);

  const loaded = useMemo(() => feed.data?.pages.flatMap((p) => p.events) ?? [], [feed.data]);

  // Search narrows the pages already fetched (skill §16 pattern A): the
  // sources have no shared text column to query, and the filters above do
  // the server-side narrowing. The hint under the list says so.
  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return loaded;
    return loaded.filter(
      (e) =>
        e.actor.name.toLowerCase().includes(q) ||
        (e.actor.email ?? "").toLowerCase().includes(q) ||
        e.entity.name.toLowerCase().includes(q) ||
        e.entity.type.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        actionPhrase(e.action).includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q),
    );
  }, [loaded, debouncedSearch]);

  const groups = useMemo(() => {
    const out: { day: string; events: ActivityEvent[] }[] = [];
    for (const e of visible) {
      const day = format(new Date(e.createdAt), "yyyy-MM-dd");
      const last = out[out.length - 1];
      if (last && last.day === day) last.events.push(e);
      else out.push({ day, events: [e] });
    }
    return out;
  }, [visible]);

  // Filter option lists: the known catalogue plus whatever the loaded pages
  // contain, so a new writer's action is filterable without a code change.
  const actionOptions = useMemo<ActionOption[]>(() => {
    const values = new Set<string>([...Object.keys(ACTION_LABELS), ASSIGNMENT_REMOVED_ACTION]);
    for (const e of loaded) values.add(e.action);
    return [...values].sort().map((v) => ({ value: v, label: actionLabel(v) }));
  }, [loaded]);

  const actorOptions = useMemo<ActorOption[]>(() => {
    const map = new Map<string, string>();
    for (const e of loaded) if (e.actor.id) map.set(e.actor.id, e.actor.name);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [loaded]);

  const entityTypeOptions = useMemo(() => {
    // "user" and "class" are written by the SQL RPCs; the rest come from data.
    const values = new Set<string>(["user", "class"]);
    for (const e of loaded) if (e.source === "system") values.add(e.entity.type);
    return [...values].sort();
  }, [loaded]);

  const openEvent = (e: ActivityEvent) => {
    setSelected(e);
    setSheetOpen(true);
  };

  const exportCsv = () => {
    if (visible.length === 0) return;
    try {
      const header = [
        "Timestamp", "Source", "Action", "Actor", "Actor email", "Entity type", "Entity", "Entity ID",
        "From status", "To status", "Reason", "Before", "After", "Metadata", "IP address", "User agent",
      ];
      const rows = visible.map((e) => [
        format(new Date(e.createdAt), "yyyy-MM-dd HH:mm:ss"),
        SOURCE_META[e.source].label,
        e.action,
        e.actor.name,
        e.actor.email ?? "",
        e.entity.type,
        e.entity.name,
        e.entity.id ?? "",
        e.fromStatus ?? "",
        e.toStatus ?? "",
        e.reason ?? "",
        e.before,
        e.after,
        e.metadata,
        e.ipAddress ?? "",
        e.userAgent ?? "",
      ]);
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      saveBlob(blob, `activity-logs-${format(new Date(), "yyyy-MM-dd")}.csv`);
      // Say exactly what went into the file: the rows on screen, which are the
      // loaded pages narrowed by the search box, not the whole history.
      const scope = searching ? " matching your search" : "";
      const remainder = feed.hasNextPage ? ". Older events were not loaded, so they are not in the file." : ".";
      toast.success(`Exported ${numberFormat.format(visible.length)} loaded ${visible.length === 1 ? "event" : "events"}${scope}${remainder}`);
    } catch (err) {
      toastError(err, { fallback: "Couldn't export the activity log.", context: "activityLogsExport" });
    }
  };

  // Only a failed FIRST load may take over the page. fetchNextPage sets
  // feed.error too while keeping the pages already loaded, so gating on the
  // bare error threw away a working timeline over one flaky "Load older".
  const feedFailed = Boolean(feed.error) && !feed.data;
  const initialLoading = !ready || (feed.isLoading && !feed.data);
  const searching = debouncedSearch.trim().length > 0;

  return (
    <PageShell>
      <PageHeader
        density="compact"
        icon={<Activity className="h-5 w-5" />}
        title="Activity Logs"
        subtitle="Every recorded action across accounts, tasks, exams and teaching assignments"
        // Extras, not secondaryActions: a single secondary action collapses to
        // a lone "..." kebab under the title on phones, which reads as broken.
        extras={
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={visible.length === 0}
            title="Exports the events loaded on this page, narrowed by the search box"
            className="h-10 rounded-lg"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        }
      />

      {/* Error branch first: a failed read must never render as "no activity"
          under a strip of zero tiles (§6). */}
      {feedFailed ? (
        <div className="surface-card frosted-shadow rounded-xl border-ink-400/50">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't load the activity log"
            description="Something went wrong reading the audit trail. Try again, and if it keeps happening report it from Salci Support."
            action={{ label: "Retry", icon: <RefreshCw className="h-4 w-4" />, onClick: () => void feed.refetch() }}
          />
        </div>
      ) : (
        <>
          {/* KPI tiles: trailing 7 days, one tile per source. */}
          <div>
            {stats.error ? (
              <div className="surface-card frosted-shadow flex flex-col gap-2 px-4 py-3 text-[13px] text-ink-600 sm:flex-row sm:items-center sm:justify-between md:px-5">
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden />
                  Couldn't load the 7-day counts.
                </span>
                <Button variant="ghost" size="sm" onClick={() => void stats.refetch()} className="h-8 w-fit">
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Retry
                </Button>
              </div>
            ) : (
              /* Two columns on a phone with the total spanning the first row
                 (three rows, not five), five across from md. */
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
                <StatCell
                  label="Last 7 days"
                  value={stats.data ? numberFormat.format(stats.data.total) : "…"}
                  icon={<Layers className="h-5 w-5" />}
                  tone="teal"
                  variant="raised"
                  className="col-span-2 md:col-span-1"
                />
                {ACTIVITY_SOURCES.map((s) => (
                  <StatCell
                    key={s}
                    label={SOURCE_META[s].tile}
                    value={stats.data ? numberFormat.format(stats.data.bySource[s]) : "…"}
                    icon={<SourceIcon source={s} className="h-5 w-5" />}
                    tone={SOURCE_META[s].tone}
                    variant="raised"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <ActivityFilterBar
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onFiltersChange={setFilters}
              actionOptions={actionOptions}
              actorOptions={actorOptions}
              entityTypeOptions={entityTypeOptions}
            />
          </div>

          {/* Timeline. Day headers are plain, not sticky: PageShell wraps every
              page in overflow-x-hidden, which makes it the sticky container, so
              a header with top: var(--app-bar-height) never pins under the app
              bar (probed 2026-09-11). Revisit if PageShell drops that overflow. */}
          <div className="mt-3 surface-card frosted-shadow-lg overflow-hidden">
            {initialLoading ? (
              <div className="divide-y divide-ink-400/30">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4 max-w-md" />
                      <Skeleton className="h-3 w-1/2 max-w-xs" />
                    </div>
                    <Skeleton className="h-3 w-14" />
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={searching || hasFilters ? <SearchX className="h-7 w-7" /> : <Activity className="h-7 w-7" />}
                reason={searching || hasFilters ? "noResults" : "noData"}
                title={searching ? "No loaded events match" : hasFilters ? "Nothing matches these filters" : "No activity recorded yet"}
                description={
                  searching
                    ? feed.hasNextPage
                      ? "Search looks through the events loaded so far. Load more below or narrow the filters instead."
                      : "Try a different name, action or entity."
                    : hasFilters
                      ? "Widen the date range or clear a filter to see more."
                      : "Actions taken in the portal will appear here as they happen."
                }
                action={
                  searching && feed.hasNextPage
                    ? { label: "Load more events", onClick: () => void feed.fetchNextPage() }
                    : hasFilters
                      ? { label: "Clear filters", onClick: () => setFilters(EMPTY_FILTERS) }
                      : undefined
                }
              />
            ) : (
              <div>
                {groups.map((g, i) => (
                  <section key={g.day}>
                    <header
                      className={cn(
                        "flex items-center gap-3 border-b border-ink-400/30 bg-ink-400/5 px-4 py-2 sm:px-5",
                        i > 0 && "border-t",
                      )}
                    >
                      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-600">{dayLabel(g.events[0].createdAt)}</p>
                      {/* The count is of LOADED rows for the day. It is the
                          day's total only once every page is in and no search
                          is narrowing the list; otherwise say "loaded". */}
                      <span className="text-[12px] tabular-nums text-ink-500">
                        {numberFormat.format(g.events.length)} {g.events.length === 1 ? "event" : "events"}
                        {(feed.hasNextPage || searching) && " loaded"}
                      </span>
                    </header>
                    <div className="divide-y divide-ink-400/30">
                      {g.events.map((e) => (
                        <ActivityEventRow key={e.key} event={e} onOpen={openEvent} />
                      ))}
                    </div>
                  </section>
                ))}

                <footer className="flex flex-col items-center gap-2 border-t border-ink-400/30 px-4 py-4 text-center text-[13px] text-ink-500 sm:flex-row sm:justify-between sm:text-left">
                  <span>
                    Showing {numberFormat.format(visible.length)}
                    {searching && ` of ${numberFormat.format(loaded.length)} loaded`}
                    {" "}events{searching && feed.hasNextPage ? ". Search covers loaded events only." : "."}
                  </span>
                  {feed.hasNextPage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void feed.fetchNextPage()}
                      disabled={feed.isFetchingNextPage}
                      className="h-9 rounded-lg"
                    >
                      {feed.isFetchingNextPage ? "Loading…" : "Load older events"}
                    </Button>
                  ) : (
                    <span className="text-ink-400">You have reached the end.</span>
                  )}
                </footer>
              </div>
            )}
          </div>
        </>
      )}

      <ActivityDetailSheet event={selected} open={sheetOpen} onOpenChange={setSheetOpen} />
    </PageShell>
  );
}
