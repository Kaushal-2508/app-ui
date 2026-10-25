import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle, Briefcase, CalendarClock, Download, GraduationCap, History, Paperclip, RefreshCw,
  SearchX, UserCheck, UserX,
} from "lucide-react";

import { PageHeader, PageShell } from "@/components/shared/page";
import { EmptyState, StatCell } from "@/components/shared/surfaces";
import { TONES } from "@/components/shared/design-system";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/useDebounce";
import {
  EMPTY_DUA_FILTERS,
  countDuaFilters,
  useDuaList,
  type DuaFilters,
  type DuaListRow,
} from "@/hooks/deletedUsers/useDeletedUsers";
import { DeletedUsersFilterBar } from "@/components/deletedUsers/DeletedUsersFilterBar";
import { ENTRY_META, deletedWhen, initials, roleChips, sourceLabel } from "@/components/deletedUsers/duaModel";
import { saveBlob } from "@/lib/native";
import { toast, toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat("en-IN");

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * /admin/deleted-users: every account deleted from SALCI, from the private
 * `dua` archive (CLAUDE.md §31). Only team@salci.in can open it: the route is
 * super-admin only and every RPC re-checks dua.viewers server-side.
 */
export default function DeletedUsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filters, setFilters] = useState<DuaFilters>(EMPTY_DUA_FILTERS);
  const effective = useMemo(() => ({ ...filters, q: debouncedSearch }), [filters, debouncedSearch]);

  const list = useDuaList(effective);
  const first = list.data?.pages[0];
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);
  const failed = Boolean(list.error) && !list.data;
  const loading = list.isLoading && !list.data;
  const narrowed = debouncedSearch.trim().length > 0 || countDuaFilters(filters) > 0;

  const exportCsv = () => {
    if (rows.length === 0) return;
    try {
      const header = ["Name", "Email", "Admission number", "Roles", "School", "Deleted", "Deleted by", "How", "Entry", "Live again"];
      const lines = rows.map((r) => [
        r.full_name ?? "", r.email ?? "", r.admission_number ?? "", roleChips(r.roles).join(", "), r.institution_name ?? "",
        deletedWhen(r), r.deleted_by_name ?? "", sourceLabel(r.source), ENTRY_META[r.entry].label, r.live_again ? "Yes" : "No",
      ]);
      const csv = [header, ...lines].map((l) => l.map(csvCell).join(",")).join("\n");
      saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `deleted-users-${format(new Date(), "yyyy-MM-dd")}.csv`);
      const more = list.hasNextPage ? ". Load more to include the rest." : ".";
      toast.success(`Exported ${numberFormat.format(rows.length)} of ${numberFormat.format(first?.total ?? rows.length)}${more}`);
    } catch (err) {
      toastError(err, { fallback: "Couldn't export the list.", context: "deletedUsersExport" });
    }
  };

  const stat = (n: number | undefined) => (first ? numberFormat.format(n ?? 0) : "…");

  return (
    <PageShell>
      <PageHeader
        density="compact"
        icon={<UserX className="h-5 w-5" />}
        title="Deleted Users"
        subtitle="Everyone removed from SALCI, and what they left behind"
        extras={
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0} className="h-10 rounded-lg">
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        }
      />

      {failed ? (
        <div className="surface-card frosted-shadow rounded-card">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't load deleted users"
            description="Try again. If it keeps failing, the archive may be closed to this account."
            action={{ label: "Retry", icon: <RefreshCw className="h-4 w-4" />, onClick: () => void list.refetch() }}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
            <StatCell label="Gone" value={stat(first?.stats.gone)} icon={<UserX className="h-5 w-5" />} tone="rose" variant="raised" />
            <StatCell label="Live again" value={stat(first?.stats.live_again)} icon={<UserCheck className="h-5 w-5" />} tone="mint" variant="raised" />
            <StatCell label="This month" value={stat(first?.stats.this_month)} icon={<CalendarClock className="h-5 w-5" />} tone="teal" variant="raised" />
            <StatCell label="Students" value={stat(first?.stats.students)} icon={<GraduationCap className="h-5 w-5" />} tone="sky" variant="raised" />
            <StatCell label="Staff" value={stat(first?.stats.staff)} icon={<Briefcase className="h-5 w-5" />} tone="violet" variant="raised" />
            <StatCell label="Partial history" value={stat(first?.stats.partial)} icon={<History className="h-5 w-5" />} tone="peach" variant="raised" />
          </div>

          <div className="mt-4">
            <DeletedUsersFilterBar
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onFiltersChange={setFilters}
              facets={first?.facets}
            />
          </div>

          <div className="mt-3 surface-card frosted-shadow-lg overflow-hidden rounded-card">
            {loading ? (
              <div className="divide-y divide-ink-400/30">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4 max-w-md" />
                      <Skeleton className="h-3 w-1/2 max-w-xs" />
                    </div>
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={narrowed ? <SearchX className="h-7 w-7" /> : <UserX className="h-7 w-7" />}
                reason={narrowed ? "noResults" : "noData"}
                title={narrowed ? "Nobody matches" : "No deleted users yet"}
                description={narrowed ? "Clear a filter or try another name." : undefined}
                action={
                  narrowed
                    ? { label: "Clear filters", onClick: () => { setFilters(EMPTY_DUA_FILTERS); setSearch(""); } }
                    : undefined
                }
              />
            ) : (
              <>
                <div className="divide-y divide-ink-400/30">
                  {rows.map((r) => (
                    <DeletedUserRow key={r.id} row={r} onOpen={() => navigate(`/admin/deleted-users/${r.id}`)} />
                  ))}
                </div>
                <footer className="flex flex-col items-center gap-2 border-t border-ink-400/30 px-4 py-4 text-center text-[13px] text-ink-500 sm:flex-row sm:justify-between sm:text-left">
                  <span className="tabular-nums">
                    {numberFormat.format(rows.length)} of {numberFormat.format(first?.total ?? rows.length)}
                  </span>
                  {list.hasNextPage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void list.fetchNextPage()}
                      disabled={list.isFetchingNextPage}
                      className="h-9 rounded-lg"
                    >
                      {list.isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  ) : null}
                </footer>
                {list.error && list.data && (
                  <p className="border-t border-ink-400/30 px-4 py-3 text-[13px] text-rose-600">
                    Couldn't load more. Press Load more to try again.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

function Badge({ label, tone }: { label: string; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold", t.bg, t.fg)}>{label}</span>;
}

function DeletedUserRow({ row, onOpen }: { row: DuaListRow; onOpen: () => void }) {
  const entry = ENTRY_META[row.entry];
  const name = row.full_name ?? (row.entry === "on_request" ? "Deleted at their request" : "Name not recorded");
  const roles = roleChips(row.roles);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-ink-400/5 sm:px-5"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-400/10 text-[13px] font-semibold text-ink-700">
        {initials(row.full_name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[15px] font-semibold text-ink-900">{name}</span>
          <Badge label={entry.label} tone={entry.tone} />
          {row.live_again && <Badge label="Live again" tone="mint" />}
          {row.has_files && (
            <span className="inline-flex items-center text-ink-500" title="Has files">
              <Paperclip className="h-3.5 w-3.5" aria-label="Has files" />
            </span>
          )}
        </span>
        {row.email && <span className="block truncate text-[13px] text-ink-600">{row.email}</span>}
        <span className="mt-0.5 block text-[12px] text-ink-500">
          {[roles.join(", "), row.institution_name].filter(Boolean).join(" · ")}
        </span>
        <span className="block text-[12px] text-ink-500">
          {deletedWhen(row)}
          {row.deleted_by_name ? ` · by ${row.deleted_by_name}` : ""}
        </span>
      </span>
    </button>
  );
}
