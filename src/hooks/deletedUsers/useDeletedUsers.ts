import type { PostgrestError } from "@supabase/supabase-js";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

/**
 * Deleted Users archive (schema `dua`, CLAUDE.md §31). The dua_* RPCs postdate
 * the generated Database types, so the call is cast narrowly through
 * `unknown` here, once (same shape as hooks/ptm/ptmClient.ts). Every RPC
 * refuses anyone but a super admin in dua.viewers (team@salci.in).
 *
 * Every query sets `meta: { persist: false }`: archive data is personal data
 * of people who are no longer users, and must never land in the browser's
 * persisted query cache (lib/queryPersist.ts).
 */

type RpcResult<T> = { data: T | null; error: PostgrestError | null };
type DuaRpc = <T>(fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<T>>;
const rpc = supabase.rpc.bind(supabase) as unknown as DuaRpc;

async function callDua<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw error;
  return data as T;
}

export type DuaEntry = "complete" | "partial" | "on_request" | "capture_failed";

export interface DuaRole {
  role: string | null;
  institution_id: string | null;
  institution_name?: string | null;
  admin_title?: string | null;
  granted_at?: string | null;
}

export interface DuaClassSection {
  class_id: string;
  name: string | null;
  section: string | null;
  role?: string | null;
}

export interface DuaListRow {
  id: string;
  user_id: string;
  kind: string;
  entry: DuaEntry;
  full_name: string | null;
  email: string | null;
  admission_number: string | null;
  roles: DuaRole[];
  institution_name: string | null;
  class_sections: DuaClassSection[];
  deleted_at: string | null;
  deleted_at_min: string | null;
  deleted_at_max: string | null;
  deleted_by_name: string | null;
  source: string;
  is_complete: boolean | null;
  live_again: boolean;
  is_test_account: boolean;
  has_files: boolean;
  sort_at: string;
}

export interface DuaFacet {
  value: string;
  label?: string | null;
  count: number;
}

export interface DuaStats {
  gone: number;
  live_again: number;
  this_month: number;
  students: number;
  staff: number;
  partial: number;
}

export interface DuaListPage {
  rows: DuaListRow[];
  total: number;
  facets: {
    role: DuaFacet[];
    institution: DuaFacet[];
    deleted_by: DuaFacet[];
    source: DuaFacet[];
    entry: DuaFacet[];
    status: DuaFacet[];
    has_files: number;
    flagged: number;
    test_accounts: number;
  };
  stats: DuaStats;
  // exact: 1 for entries with an exact deletion time (listed first), 0 for date ranges.
  next_cursor: { at: string; id: string; exact: string } | null;
}

export interface DuaFilters {
  q: string;
  role: string | null;
  institution_id: string | null;
  deleted_by: string | null;
  source: string | null;
  entry: DuaEntry | null;
  status: "gone" | "live_again" | null;
  has_files: boolean;
  flagged: boolean;
  show_test: boolean;
  from: string | null; // yyyy-MM-dd, school day
  to: string | null;
}

export const EMPTY_DUA_FILTERS: DuaFilters = {
  q: "",
  role: null,
  institution_id: null,
  deleted_by: null,
  source: null,
  entry: null,
  status: null,
  has_files: false,
  flagged: false,
  show_test: false,
  from: null,
  to: null,
};

/** Filters set away from their default, search excluded (it has its own box). */
export function countDuaFilters(f: DuaFilters): number {
  return [
    f.role, f.institution_id, f.deleted_by, f.source, f.entry, f.status,
    f.has_files || null, f.flagged || null, f.show_test || null, f.from || f.to,
  ].filter(Boolean).length;
}

export interface DuaHeader {
  id: string;
  user_id: string;
  kind: string;
  entry: DuaEntry;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  admission_number: string | null;
  roll_number: string | null;
  avatar_path: string | null;
  roles: DuaRole[];
  institution_id: string | null;
  institution_name: string | null;
  class_sections: DuaClassSection[];
  wings: { wing_id: string; name: string | null }[];
  account_created_at: string | null;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  deleted_at: string | null;
  deleted_at_min: string | null;
  deleted_at_max: string | null;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_by_roles: string[];
  source: string;
  source_detail: Record<string, unknown>;
  is_complete: boolean | null;
  completeness: {
    mismatches?: { table: string; deleted: number; archived: number }[];
    expected?: { table: string; deleted: number; archived: number }[];
    error?: string;
    checked_at?: string;
  };
  error: string | null;
  field_sources: Record<string, string>;
  live_again_user_id: string | null;
  is_test_account: boolean;
  total_rows: number;
  created_at: string;
}

export interface DuaTableSummary {
  table: string;
  label: string;
  category: string;
  display_columns: string[];
  mode: "rows" | "counts";
  row_count: number;
}

export interface DuaLinkSummary {
  table: string;
  column: string;
  label: string;
  category: string;
  references_table: string;
  row_count: number;
  snapshot_count: number;
}

export interface DuaFile {
  id: number;
  source: string;
  bucket: string | null;
  path: string | null;
  raw_value: string | null;
  size_bytes: number | null;
  mime: string | null;
}

export interface DuaAuditRow {
  action: string;
  entity_type: string | null;
  entity_name: string | null;
  actor_id: string | null;
  old_values: unknown;
  new_values: unknown;
  created_at: string;
}

export interface DuaDetail {
  header: DuaHeader;
  tables: DuaTableSummary[];
  links: DuaLinkSummary[];
  files: DuaFile[];
  file_count: number;
  traces: { source: string; payload: Record<string, unknown> }[];
  audit_rows: DuaAuditRow[];
  class_assignment_deletions: {
    class_id: string | null;
    class_name: string | null;
    section: string | null;
    subject_id: string | null;
    role: string | null;
    assigned_at: string | null;
    deleted_at: string | null;
  }[];
  log_events: { source: string; kind: string; event_at: string | null; email: string | null; actor_user_id: string | null }[];
  sign_in_days: number;
  live_again: { user_id: string; full_name: string | null; email: string | null; institution_name: string | null; created_at: string | null } | null;
  view_count: number;
}

export interface DuaRowsPage {
  total: number | null;
  mode: "rows" | "counts" | null;
  offset: number;
  rows: { row: Record<string, unknown>; labels: Record<string, string> }[];
}

export interface DuaLinksPage {
  total: number;
  snapshot_count: number;
  offset: number;
  rows: { row: Record<string, unknown>; title: string | null }[];
  ids_only: string[] | null;
}

export const DUA_PAGE_SIZE = 50;

const NO_PERSIST = { persist: false } as const;

/** Whether this account may open the archive. Drives the sidebar item. */
export function useDuaCanView(enabled: boolean) {
  return useQuery({
    queryKey: ["dua-can-view"],
    queryFn: () => callDua<boolean>("dua_can_view"),
    enabled,
    staleTime: 5 * 60_000,
    meta: NO_PERSIST,
  });
}

function filtersPayload(f: DuaFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.q.trim()) out.q = f.q.trim();
  if (f.role) out.role = f.role;
  if (f.institution_id) out.institution_id = f.institution_id;
  if (f.deleted_by) out.deleted_by = f.deleted_by;
  if (f.source) out.source = f.source;
  if (f.entry) out.entry = f.entry;
  if (f.status) out.status = f.status;
  if (f.has_files) out.has_files = true;
  if (f.flagged) out.flagged = true;
  if (f.show_test) out.show_test = true;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  return out;
}

/** The list: keyset pages of 50, with the filtered total, facets and stat row on every page. */
export function useDuaList(filters: DuaFilters) {
  const payload = filtersPayload(filters);
  return useInfiniteQuery({
    queryKey: ["dua-list", payload],
    initialPageParam: null as DuaListPage["next_cursor"],
    queryFn: ({ pageParam }) =>
      callDua<DuaListPage>("dua_list", { _filters: payload, _limit: DUA_PAGE_SIZE, _cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    meta: NO_PERSIST,
  });
}

export function useDuaDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["dua-detail", id],
    queryFn: () => callDua<DuaDetail>("dua_detail", { _id: id }),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    meta: NO_PERSIST,
  });
}

export function useDuaRows(id: string, table: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["dua-rows", id, table, page],
    queryFn: () =>
      callDua<DuaRowsPage>("dua_rows", { _id: id, _table: table, _offset: page * DUA_PAGE_SIZE, _limit: DUA_PAGE_SIZE }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    meta: NO_PERSIST,
  });
}

export function useDuaLinks(id: string, table: string, column: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["dua-links", id, table, column, page],
    queryFn: () =>
      callDua<DuaLinksPage>("dua_links", {
        _id: id, _table: table, _column: column, _offset: page * DUA_PAGE_SIZE, _limit: DUA_PAGE_SIZE,
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    meta: NO_PERSIST,
  });
}

/** A 5-minute signed link to one archived file (edge fn dua-file-url checks the manifest). */
export async function getDuaFileUrl(archiveId: string, fileId: number): Promise<string> {
  const res = await invokeEdgeFunction<{ url: string }>("dua-file-url", { archive_id: archiveId, file_id: fileId });
  return res.url;
}

export interface DuaExport {
  header: Record<string, unknown>;
  tables: Record<string, { label: string; category: string; mode: string; row_count: number; rows: Record<string, unknown>[] | null }>;
  kept_with_school: { table: string; column: string; row_count: number; ids: string[]; snapshots: Record<string, unknown>[] | null }[];
  referenced_rows: { table: string; pk: string; row: Record<string, unknown> }[];
  files: Record<string, unknown>[];
  traces: { source: string; payload: Record<string, unknown> }[];
}

export function fetchDuaExport(id: string): Promise<DuaExport> {
  return callDua<DuaExport>("dua_export", { _id: id });
}
