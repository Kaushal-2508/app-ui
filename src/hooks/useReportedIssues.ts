import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { SupportPriority } from "@/lib/supportSop";
import { sendSupportNotifyEmail, type SupportNotify } from "@/hooks/useSupportTickets";
import { useSupportSopReady } from "@/hooks/useSupportSop";

/**
 * The Salci Support inbox (/admin/issues).
 *
 * Every support request writes BOTH a `tasks` row and a `reported_issues`
 * intake row linked by `task_id`. This inbox reads the intake side, and moves
 * both together through `set_support_ticket_status`, which routes through the
 * shared `_support_apply_status` routine so a resolution from /tasks and one
 * from here produce identical system rows and notifications.
 *
 * The conversation itself lives in `support_messages` and is read through
 * `get_support_thread` (see `useSupportTickets.ts`).
 */

export const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export interface ReportedIssue {
  id: string;
  /** Nullable: the FK is ON DELETE SET NULL so a departing student no longer
   *  takes the ticket history with them. */
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_role: string | null;
  institution_id: string | null;
  institution_name: string | null;
  classes_assigned: string | null;
  subject: string;
  description: string;
  status: string;
  category: string | null;
  priority: number | null;
  task_id: string | null;
  last_message_at: string | null;
  reporter_last_read_at: string | null;
  salci_last_read_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Ticket Resolution SOP columns (NEEDS DB, spec 2026-09-18): the SALCI-set
   * priority and the "escalated to" mark. Present only once
   * `useSupportSopReady()` is true and the query selected them; absent
   * (undefined) before that, which every reader treats as untriaged and not
   * escalated.
   */
  triage_priority?: SupportPriority | null;
  triaged_at?: string | null;
  escalated_to?: string | null;
  escalated_to_name?: string | null;
  escalated_at?: string | null;
}

export interface IssueFilters {
  status: IssueStatus;
  institutionId: string | null;
  role: string | null;
}

/** PostgREST silently truncates at 1000 rows, so bound it explicitly (§23). */
const ISSUE_LIST_RANGE: [number, number] = [0, 199];
const ISSUE_STALE_TIME = 60_000;

/** Explicit column list: reported_issues carries free-text descriptions and is
 *  read on every inbox open, so `select("*")` is not acceptable here.
 *
 *  `admin_notes` is deliberately absent and must stay absent. The column was
 *  dropped on 2026-08-31 because the SELECT policy let the reporter read what
 *  the UI labelled "Internal notes", and its rows became internal
 *  `support_messages`. It was then re-added to prod, EMPTY, purely so the
 *  still-deployed old frontend (which names it in its own select list) keeps
 *  working until this branch ships. Nothing writes it, nothing reads it here,
 *  and internal notes live in support_messages with is_internal = true.
 *
 *  One unbroken literal on purpose: supabase-js parses the selection with
 *  template literal types, and string concatenation widens this to `string`,
 *  which collapses the row type to GenericStringError[]. */
const ISSUE_COLUMNS =
  "id, reporter_id, reporter_name, reporter_email, reporter_role, institution_id, institution_name, classes_assigned, subject, description, status, category, priority, task_id, last_message_at, reporter_last_read_at, salci_last_read_at, first_response_at, resolved_at, created_at, updated_at" as const;

/** The same list plus the SOP columns, selected only once the probe says they exist. */
const ISSUE_COLUMNS_SOP =
  "id, reporter_id, reporter_name, reporter_email, reporter_role, institution_id, institution_name, classes_assigned, subject, description, status, category, priority, task_id, last_message_at, reporter_last_read_at, salci_last_read_at, first_response_at, resolved_at, created_at, updated_at, triage_priority, triaged_at, escalated_to, escalated_to_name, escalated_at" as const;

function issueColumns(sopReady: boolean) {
  return sopReady ? ISSUE_COLUMNS_SOP : ISSUE_COLUMNS;
}

/**
 * True when the reporter has spoken since SALCI last opened the ticket.
 *
 * Computed from two columns already on the row we fetched, so it costs no
 * extra read. The authoritative total comes from the server
 * (`support_inbox_counts.awaiting_salci`), never from measuring this list.
 *
 * This predicate deliberately does NOT look at status: the caller decides which
 * status it is filtering, and it must pass that same status to
 * `useReportedIssueCounts` so the chip's number and the rows it filters measure
 * the same set.
 */
export function issueAwaitsSalci(
  issue: Pick<ReportedIssue, "last_message_at" | "salci_last_read_at">,
): boolean {
  if (!issue.last_message_at) return false;
  if (!issue.salci_last_read_at) return true;
  return (
    new Date(issue.last_message_at).getTime() >
    new Date(issue.salci_last_read_at).getTime()
  );
}

/**
 * The Support Inbox reporting cutoff, `support_settings.stats_since`.
 *
 * Set on 2026-09-28 so the header cards could start at zero and count forward
 * without deleting a single ticket: 20 of the 65 rows then in the table were
 * genuine test traffic, but 45 were real Alliance history. Everything before
 * the cutoff is still stored, still openable by id, and still visible to the
 * school that raised it; it just does not feed the inbox.
 *
 * Both inbox RPCs read the same column server-side, so the cards, the tab
 * badges and this list cannot disagree. NULL means no cutoff.
 */
export function useSupportStatsSince() {
  return useQuery({
    queryKey: ["support-stats-since"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("support_settings")
        .select("stats_since")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.stats_since ?? null;
    },
    // A reporting epoch changes about once a year. Ten minutes is generous.
    staleTime: 10 * 60_000,
  });
}

async function fetchReportedIssues(
  filters: IssueFilters,
  sopReady: boolean,
  since: string | null,
): Promise<ReportedIssue[]> {
  let query = supabase
    .from("reported_issues")
    .select(issueColumns(sopReady))
    .eq("status", filters.status);

  // The cutoff, plus the per-ticket carry-over: a pinned ticket belongs to the
  // current period whenever it was raised (20260928140000).
  if (since) query = query.or(`created_at.gte.${since},pinned_to_inbox.is.true`);
  if (filters.institutionId) query = query.eq("institution_id", filters.institutionId);
  if (filters.role) query = query.eq("reporter_role", filters.role);

  // Live tabs come oldest first: the Ticket Resolution SOP ranks tickets that
  // have sat longest at the top, and the page is bounded to 200 rows, so the
  // rows in hand must be the old ones or the client-side SOP sort could never
  // see them. Finished tabs keep newest first, which is how they are read.
  const oldestFirst = filters.status === "open" || filters.status === "in_progress";
  const { data, error } = await query
    .order("created_at", { ascending: oldestFirst })
    .range(...ISSUE_LIST_RANGE);

  if (error) throw error;
  return (data ?? []) as unknown as ReportedIssue[];
}

/**
 * One query definition shared by the per-tab list and the board, so both read
 * and write the SAME cache entries: a status change made on the board is
 * visible the moment the user switches back to the list, and vice versa.
 *
 * `sopReady` widens the column list once the SOP columns exist. It is part of
 * the key so the probe flipping to true refetches with the wider select rather
 * than serving rows that lack the new fields; useSetIssueStatus filters on the
 * key length, so the key stays four items and the flag rides in the filters.
 */
function reportedIssuesQueryOptions(
  filters: IssueFilters,
  sopReady: boolean,
  since: string | null,
) {
  return {
    queryKey: [
      "support-inbox",
      filters.status,
      filters.institutionId,
      // Role, the SOP-column flag and the reporting cutoff SHARE this slot.
      // useSetIssueStatus's optimistic move selects inbox caches with
      // `key.length === 4`, so this key must stay exactly four items; a fifth
      // would make every optimistic status change silently skip the list.
      `${filters.role ?? ""}#${sopReady ? "sop" : ""}#${since ?? "all"}`,
    ] as const,
    queryFn: () => fetchReportedIssues(filters, sopReady, since),
    staleTime: ISSUE_STALE_TIME,
    // On here against the app-wide default of false, for the same reason
    // `get_support_thread` turns it on (useSupportTickets.ts): an inbox worked
    // all day is exactly the thing you expect to be current when you come back
    // to the tab. There is no realtime channel on this page, so without it the
    // list is frozen at load and a ticket raised meanwhile never appears.
    //
    // The cost is bounded on every side: the query is capped at 200 rows with
    // an explicit column list, only super admins can reach this page, and
    // staleTime still gates the refetch, so flipping between tabs costs at
    // most one read a minute. This replaced a manual Refresh button.
    refetchOnWindowFocus: true,
  };
}

/**
 * `showEarlier` lifts the reporting cutoff for the LIST only. The cards always
 * speak for the current period, so the toggle can never make a card lie.
 */
export function useReportedIssues(filters: IssueFilters, showEarlier = false) {
  const { data: sopReady = false } = useSupportSopReady();
  const { data: since = null, isPending: sincePending } = useSupportStatsSince();
  return useQuery({
    ...reportedIssuesQueryOptions(filters, sopReady, showEarlier ? null : since),
    // Wait for the cutoff before the first read, or the inbox flashes every
    // pre-cutoff ticket for one round trip and then empties.
    enabled: !sincePending,
  });
}

/**
 * Every status at once, for the Kanban board. One bounded query per column
 * (the same four the tabs use, so nothing is fetched twice), each capped at
 * ISSUE_LIST_RANGE: the Resolved and Closed columns show their newest 200 and
 * the board says so in a footnote.
 */
export function useReportedIssuesBoard(
  institutionId: string | null,
  role: string | null,
  showEarlier = false,
) {
  const { data: sopReady = false } = useSupportSopReady();
  const { data: since = null, isPending: sincePending } = useSupportStatsSince();
  const effectiveSince = showEarlier ? null : since;
  return useQueries({
    queries: ISSUE_STATUSES.map((status) => ({
      ...reportedIssuesQueryOptions({ status, institutionId, role }, sopReady, effectiveSince),
      enabled: !sincePending,
    })),
    combine: (results) => ({
      issues: results.flatMap((r) => r.data ?? []),
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => {
        for (const r of results) void r.refetch();
      },
    }),
  });
}

/**
 * One ticket by id, for the `?ticket=<id>` deep link that support notifications
 * point at. The linked ticket is often in a different status tab from the one
 * on screen, so it cannot be found in the list query's cache.
 */
export function useReportedIssueById(ticketId: string | null) {
  const { data: sopReady = false } = useSupportSopReady();
  return useQuery({
    queryKey: ["support-inbox-ticket", ticketId, sopReady],
    queryFn: async (): Promise<ReportedIssue | null> => {
      const { data, error } = await supabase
        .from("reported_issues")
        .select(issueColumns(sopReady))
        .eq("id", ticketId as string)
        .maybeSingle();

      if (error) throw error;
      return (data as unknown as ReportedIssue | null) ?? null;
    },
    enabled: Boolean(ticketId),
    staleTime: ISSUE_STALE_TIME,
  });
}

/**
 * Ticket id behind a support `tasks` row, so /tasks can link into the thread.
 * `reported_issues` SELECT is super-admin-only, so callers must gate this on
 * the viewer actually being one rather than relying on a silent empty result.
 */
export function useSupportTicketIdForTask(taskId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["support-ticket-for-task", taskId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("reported_issues")
        .select("id")
        .eq("task_id", taskId as string)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: Boolean(taskId) && enabled,
    staleTime: ISSUE_STALE_TIME,
  });
}

/**
 * Everything the three Support Inbox cards show, from ONE server-side read.
 * Deliberately has no status argument: the cards must not refetch on every
 * tab switch, so the key is (institution, role) only. See
 * supabase/migrations/20260910120000_support_inbox_stats.sql for the
 * load-bearing predicates (resolved_* count status = 'resolved' only).
 */
export interface SupportInboxStats {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  open_awaiting_salci: number;
  open_never_answered: number;
  /** Whole hours since the oldest open ticket was raised, or null when none. */
  open_oldest_hours: number | null;
  open_top_school_name: string | null;
  open_top_school_count: number;
  in_progress_awaiting_salci: number;
  /** In-progress tickets with no message for 72h+ (never keyed on updated_at). */
  in_progress_quiet_72h: number;
  in_progress_oldest_hours: number | null;
  resolved_7d: number;
  resolved_prev_7d: number;
  /** School-raised only: resolved in the last 30 days without one public reply. */
  resolved_no_reply_30d: number;
  /**
   * Turnaround (tat_*): school-raised tickets only, i.e. reporter is not a super
   * admin and the institution is not is_demo. Rolling 30-day UTC windows,
   * calendar hours, medians. The RPC still emits four unprefixed legacy speed
   * keys for one release; nothing here reads them.
   */
  tat_resolve_median_hours_30d: number | null;
  tat_resolve_sample_30d: number;
  tat_resolve_within_7d_30d: number;
  tat_resolve_over_14d_30d: number;
  tat_resolve_median_hours_prev_30d: number | null;
  tat_resolve_sample_prev_30d: number;
  tat_first_reply_median_hours_30d: number | null;
  tat_first_reply_sample_30d: number;
  tat_first_reply_within_24h_30d: number;
  /** Tickets the exclusion removed from either 30-day cohort ("N test tickets left out"). */
  tat_excluded_30d: number;
  /** True when the inbox is filtered to an is_demo institution: the card explains its empty state. */
  tat_institution_is_demo: boolean;
}

export function useSupportInboxStats(
  institutionId: string | null,
  role: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["support-inbox-stats", institutionId, role],
    queryFn: async (): Promise<SupportInboxStats> => {
      const { data, error } = await supabase.rpc("support_inbox_stats", {
        p_institution_id: institutionId ?? undefined,
        p_role: role ?? undefined,
      });
      if (error) throw error;
      return data as unknown as SupportInboxStats;
    },
    enabled,
    staleTime: ISSUE_STALE_TIME,
    // Same reason as useReportedIssueCounts: the header must never disagree
    // with the rows under it after a focus refetch.
    refetchOnWindowFocus: true,
  });
}

export interface IssueCounts {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  total: number;
  /**
   * Tickets whose newest message lands after SALCI last read them, counted
   * WITHIN the status passed to `useReportedIssueCounts`. With no status it
   * falls back to the platform-wide backlog (open plus in progress).
   */
  awaiting_salci: number;
}

/**
 * Counted in Postgres, never by fetching rows and measuring them (§23).
 *
 * `status` scopes `awaiting_salci` only. The four per-status keys and `total`
 * always cover every status, so the tab badges never move when the active tab
 * changes. Pass the tab the Awaiting SALCI chip sits in: the chip prints this
 * number and filters that tab's rows with `issueAwaitsSalci`, and the two must
 * always measure the same set, or Closed can read "Awaiting SALCI (7)" and then
 * filter to nothing.
 */
export function useReportedIssueCounts(
  institutionId: string | null,
  role: string | null,
  status: IssueStatus | null,
) {
  return useQuery({
    queryKey: ["support-inbox-counts", institutionId, role, status],
    queryFn: async (): Promise<IssueCounts> => {
      const { data, error } = await supabase.rpc("support_inbox_counts", {
        p_institution_id: institutionId ?? undefined,
        p_role: role ?? undefined,
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return data as unknown as IssueCounts;
    },
    staleTime: ISSUE_STALE_TIME,
    // Must match the list above. Refreshing the rows on focus while leaving
    // the tiles and tab badges frozen would print a header that disagrees with
    // the tickets under it, which is the one thing a support tool cannot do.
    refetchOnWindowFocus: true,
  });
}

/**
 * Distinct schools and roles present in the inbox, for the filter chips.
 * Derived from a bounded projection rather than a second full read.
 */
export function useReportedIssueFacets() {
  const { data: since = null } = useSupportStatsSince();
  return useQuery({
    queryKey: ["support-inbox-facets", since],
    queryFn: async () => {
      let q = supabase
        .from("reported_issues")
        .select("institution_id, institution_name, reporter_role");
      // Same cutoff as the list, else the school chips offer schools whose
      // tickets the inbox cannot show.
      if (since) q = q.or(`created_at.gte.${since},pinned_to_inbox.is.true`);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .range(...ISSUE_LIST_RANGE);

      if (error) throw error;

      const schools = new Map<string, string>();
      const roles = new Set<string>();
      for (const row of data ?? []) {
        if (row.institution_id && row.institution_name) {
          schools.set(row.institution_id, row.institution_name);
        }
        if (row.reporter_role) roles.add(row.reporter_role);
      }

      return {
        schools: [...schools.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        roles: [...roles].sort(),
      };
    },
    staleTime: 5 * 60_000,
  });
}

export interface SetIssueStatusInput {
  ticketId: string;
  status: IssueStatus;
  note?: string;
}

/**
 * What `set_support_ticket_status` returns. `notify` is the payload the
 * `support-notify-email` edge function consumes; it is NULL when the move
 * produces no outbound message.
 */
export interface SetIssueStatusResult {
  status: string;
  notify: SupportNotify | null;
}

type InboxSnapshot = Array<[QueryKey, ReportedIssue[] | undefined]>;

export function useSetIssueStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    // Optimistic move across the per-status inbox lists, so a card dropped on
    // the board lands in its new column at once. Keys are
    // ["support-inbox", status, institutionId, role]; the row leaves every list
    // whose status differs and joins every list whose status matches. The
    // server still decides; on error every list is restored from its snapshot.
    onMutate: async ({ ticketId, status }: SetIssueStatusInput) => {
      await queryClient.cancelQueries({ queryKey: ["support-inbox"] });
      const lists = queryClient
        .getQueriesData<ReportedIssue[]>({ queryKey: ["support-inbox"] })
        .filter(([key]) => key.length === 4);
      const snapshots: InboxSnapshot = lists.map(([key, data]) => [key, data]);

      const row = lists.flatMap(([, data]) => data ?? []).find((i) => i.id === ticketId);
      if (row) {
        const moved: ReportedIssue = { ...row, status };
        for (const [key, data] of lists) {
          if (!data) continue;
          const listStatus = key[1];
          const without = data.filter((i) => i.id !== ticketId);
          queryClient.setQueryData<ReportedIssue[]>(
            key,
            listStatus === status ? [moved, ...without] : without,
          );
        }
      }
      return { snapshots };
    },
    mutationFn: async ({
      ticketId,
      status,
      note,
    }: SetIssueStatusInput): Promise<SetIssueStatusResult> => {
      // One RPC, not two client writes: the intake row, its system message and
      // its linked task move in the same transaction or not at all (§23).
      const { data, error } = await supabase.rpc("set_support_ticket_status", {
        p_ticket_id: ticketId,
        p_status: status,
        p_note: note,
      });
      if (error) throw error;
      return data as unknown as SetIssueStatusResult;
    },
    onSuccess: (data, variables) => {
      toast.success(`Marked as ${ISSUE_STATUS_LABELS[variables.status]}`);

      // Best effort, never blocks or fails the status change: the status, the
      // system row and the in-app notification are already committed.
      void sendSupportNotifyEmail(data.notify);

      // The status move writes a kind='system' row into the thread, so the
      // thread cache is stale too. Missing this key leaves the sheet showing a
      // conversation that ends before the status change the user just made.
      // Two more are easy to lose and both matter: ["support-inbox-ticket",
      // ticketId] backs the ?ticket= deep-linked sheet, so dropping it leaves a
      // sheet opened from a notification showing the old status badge, and
      // "tasks-assigned-by-me" is the reporter-side task list that moves with
      // the ticket.
      for (const key of [
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-stats",
        "support-inbox-ticket",
        "support-thread",
        "support-my-tickets",
        "my-tasks",
        "tasks-assigned-by-me",
        "task-detail",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toastError(error, {
        fallback: "Couldn't update this support request.",
        context: "setSupportTicketStatus",
      });
    },
  });
}
