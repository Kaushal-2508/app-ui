import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  DUA_PAGE_SIZE,
  useDuaLinks,
  useDuaRows,
  type DuaLinkSummary,
  type DuaTableSummary,
} from "@/hooks/deletedUsers/useDeletedUsers";
import { cn } from "@/lib/utils";
import { columnsFor, formatValue, humanize } from "./duaModel";

const numberFormat = new Intl.NumberFormat("en-IN");

function Pager({ page, total, onPage, busy }: { page: number; total: number; onPage: (p: number) => void; busy: boolean }) {
  const pages = Math.max(1, Math.ceil(total / DUA_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-[12px] text-ink-500 sm:px-5">
      <span className="tabular-nums">Page {page + 1} of {pages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={page === 0 || busy} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={page + 1 >= pages || busy} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function RowCard({ row, labels, columns }: { row: Record<string, unknown>; labels: Record<string, string>; columns: string[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 px-4 py-3 text-[13px] sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
      {columns.map((c) => (
        <div key={c} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-500">{humanize(c)}</dt>
          <dd className="break-words text-ink-900">
            {labels[c] ? (
              <>
                {labels[c]}
                <span className="block truncate text-[11px] text-ink-400">{formatValue(row[c])}</span>
              </>
            ) : (
              formatValue(row[c])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHeader({ open, onToggle, label, count, note }: { open: boolean; onToggle: () => void; label: string; count: number; note?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-ink-400/5 sm:px-5"
    >
      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />}
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-900">{label}</span>
      {note && <span className="hidden text-[12px] text-ink-500 sm:inline">{note}</span>}
      <span className="shrink-0 text-[13px] tabular-nums text-ink-600">{numberFormat.format(count)}</span>
    </button>
  );
}

/** One archived table: collapsed by default, pages of 50 rows once opened. */
export function ArchivedTableSection({ archiveId, table }: { archiveId: string; table: DuaTableSummary }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [allFields, setAllFields] = useState(false);
  const countsOnly = table.mode === "counts";
  const q = useDuaRows(archiveId, table.table, page, open && !countsOnly);

  return (
    <div>
      <SectionHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label={table.label}
        count={table.row_count}
        note={countsOnly ? "Count only" : undefined}
      />
      {open && (
        <div className="border-t border-ink-400/20 bg-ink-400/[0.03]">
          {countsOnly ? (
            <p className="px-4 py-3 text-[13px] text-ink-600 sm:px-5">Credentials are never stored. Only the count is kept.</p>
          ) : q.error && !q.data ? (
            <div className="flex items-center justify-between gap-2 px-4 py-3 text-[13px] text-rose-600 sm:px-5">
              Couldn't load these rows.
              <Button variant="ghost" size="sm" onClick={() => void q.refetch()} className="h-8"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
            </div>
          ) : !q.data ? (
            <div className="space-y-2 px-4 py-3 sm:px-5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-2 px-4 pt-3 text-[12px] text-ink-600 sm:px-5">
                <label className="inline-flex items-center gap-2">
                  All fields
                  <Switch checked={allFields} onCheckedChange={setAllFields} />
                </label>
              </div>
              <div className={cn("divide-y divide-ink-400/20", q.isPlaceholderData && "opacity-60")}>
                {q.data.rows.map((r, i) => (
                  <RowCard key={`${page}-${i}`} row={r.row} labels={r.labels} columns={columnsFor(r.row, table.display_columns, allFields)} />
                ))}
              </div>
              <Pager page={page} total={q.data.total ?? table.row_count} onPage={setPage} busy={q.isFetching} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Records the person created that stayed with the school: snapshots, then ids beyond the cap. */
export function KeptLinkSection({ archiveId, link }: { archiveId: string; link: DuaLinkSummary }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [allFields, setAllFields] = useState(false);
  const q = useDuaLinks(archiveId, link.table, link.column, page, open);

  return (
    <div>
      <SectionHeader open={open} onToggle={() => setOpen((v) => !v)} label={`${link.label} (${humanize(link.column)})`} count={link.row_count} />
      {open && (
        <div className="border-t border-ink-400/20 bg-ink-400/[0.03]">
          {q.error && !q.data ? (
            <div className="flex items-center justify-between gap-2 px-4 py-3 text-[13px] text-rose-600 sm:px-5">
              Couldn't load these records.
              <Button variant="ghost" size="sm" onClick={() => void q.refetch()} className="h-8"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
            </div>
          ) : !q.data ? (
            <div className="space-y-2 px-4 py-3 sm:px-5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-2 px-4 pt-3 text-[12px] text-ink-600 sm:px-5">
                <label className="inline-flex items-center gap-2">
                  All fields
                  <Switch checked={allFields} onCheckedChange={setAllFields} />
                </label>
              </div>
              <div className={cn("divide-y divide-ink-400/20", q.isPlaceholderData && "opacity-60")}>
                {q.data.rows.map((r, i) => (
                  <div key={`${page}-${i}`}>
                    {r.title && <p className="px-4 pt-3 text-[14px] font-medium text-ink-900 sm:px-5">{r.title}</p>}
                    <RowCard row={r.row} labels={{}} columns={columnsFor(r.row, [], allFields).slice(0, allFields ? undefined : 6)} />
                  </div>
                ))}
                {(q.data.ids_only ?? []).length > 0 && (
                  <p className="break-all px-4 py-3 text-[12px] text-ink-500 sm:px-5">
                    Ids only: {(q.data.ids_only ?? []).join(", ")}
                  </p>
                )}
              </div>
              <Pager page={page} total={q.data.total} onPage={setPage} busy={q.isFetching} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
