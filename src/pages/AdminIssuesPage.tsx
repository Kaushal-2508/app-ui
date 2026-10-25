import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, Bell, ExternalLink, Inbox, LifeBuoy } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, ListRow } from "@/components/shared/surfaces";
import { MobileTabs, FilterRow, FilterChip, type MobileTabOption } from "@/components/shared/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/errorMessages";
import { toastError } from "@/lib/toast";
import { IssueDetailSheet } from "@/components/issues/IssueDetailSheet";
import { ClosureNoteSheet } from "@/components/issues/ClosureNoteSheet";
import { SupportHealthBanner } from "@/components/issues/SupportHealthBanner";
import { InboxStatsRow } from "@/components/issues/InboxStatCard";
import { SupportBoardView } from "@/components/issues/board/SupportBoardView";
import { ViewModeToggle, useViewMode } from "@/components/shared/board";
import {
  ADMIN_ISSUES_VIEW_STORAGE_KEY,
  boardTicketFromIssue,
  type SupportBoardTicket,
} from "@/lib/supportBoard";
import {
  SOP_QUIET_WORKING_HOURS,
  SUPPORT_PRIORITY_LABEL,
  UNTRIAGED_LABEL,
  isLiveStatus,
  isSopOverdue,
  sopWorkingAgeHours,
  supportInboxComparator,
} from "@/lib/supportSop";
import { escalationLabel } from "@/lib/supportEscalation";
import { useSupportEscalations } from "@/hooks/useSupportEscalations";
import { useSupportTurnaround } from "@/hooks/useSupportTurnaround";
import { useSupportSopReady } from "@/hooks/useSupportSop";
import { formatWorkingAge, workingHoursSince } from "@/lib/workingHours";
import { useMarkSupportTicketRead } from "@/hooks/useSupportTickets";
import {
  ISSUE_STATUS_LABELS,
  issueAwaitsSalci,
  useReportedIssueById,
  useReportedIssueCounts,
  useReportedIssueFacets,
  useSupportStatsSince,
  useReportedIssues,
  useReportedIssuesBoard,
  useSupportInboxStats,
  useSetIssueStatus,
  type IssueStatus,
} from "@/hooks/useReportedIssues";

/**
 * Board mode on desktop: the page takes exactly the viewport it is given and
 * stops there, so the COLUMNS scroll and the page does not.
 *
 * The list view keeps the ordinary scrolling page. The board cannot: a board
 * whose columns cap themselves at some fraction of `100dvh` while the page
 * keeps its own `min-h-[100dvh]` leaves a band of empty gradient under the
 * last column, which is what this replaces. `100dvh` less the app bar and the
 * padding <main> puts around every page is the height actually available here.
 *
 * overflow-hidden, not auto: this box is sized to hold exactly what is in it,
 * so any scrollbar it offers is a phantom one that scrolls through emptiness.
 * The scrolling that matters happens inside the columns.
 */
const BOARD_SHELL =
  // Height must match PageShell's own floor exactly. The -3rem here used to
  // cancel <main>'s md:p-6, but PageShell cancels that itself with negative
  // margins since 2026-09-15, so subtracting it again left the board 48px
  // short and put back the very band of bare page under the last column that
  // this constant exists to remove.
  "md:flex md:h-[calc(100dvh-var(--app-bar-height,61px))] md:min-h-0 md:flex-col md:overflow-hidden";
const BOARD_SHELL_CONTENT = "md:flex md:min-h-0 md:flex-1 md:flex-col";

const STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

export default function AdminIssuesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState<IssueStatus>("open");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);

  // Only the ID is state. The ticket itself is DERIVED from the cache below.
  //
  // Holding the row as a snapshot taken at click time meant the sheet never
  // followed its own writes: after "Update status" the thread gained the system
  // row, but the badge above it still read the old status, `dirty` stayed true
  // so the primary button never settled, and the form kept data-dirty="true",
  // which per the service-worker contract also suppressed update reloads for as
  // long as the sheet stayed open.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // List or board. The board shows all four statuses at once, so its Awaiting
  // count is scoped to no status (the RPC then returns the platform backlog).
  const [viewMode, setViewMode] = useViewMode(ADMIN_ISSUES_VIEW_STORAGE_KEY);
  const [showEarlier, setShowEarlier] = useState(false);
  const isBoard = viewMode === "board";

  // The SOP clock. Minute granularity: the order and the age labels depend on
  // it, and re-sorting 200 rows once a minute is nothing, whereas a `new Date()`
  // in render would make every memo below recompute on every render.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // A drop on Resolved or Closed pauses here until the closure note is written
  // (SOP: "Fixed" is not a closure). Nothing is mutated until Confirm, so a
  // cancelled drop leaves the card where it was.
  const [pendingMove, setPendingMove] = useState<{
    ticket: SupportBoardTicket;
    target: "resolved" | "closed";
  } | null>(null);

  // The active tab's status is passed so that counts.awaiting_salci is measured
  // over the SAME rows the Awaiting SALCI chip filters below. The four
  // per-status keys the tabs read stay platform-wide inside the RPC, so the tab
  // badges do not move when the tab changes.
  const { data: counts, isError: countsError } = useReportedIssueCounts(
    institutionId,
    role,
    isBoard ? null : status,
  );
  // The three cards. Off in board mode, where the columns carry the numbers.
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    error: statsErr,
    refetch: refetchStats,
  } = useSupportInboxStats(institutionId, role, !isBoard);
  // Turnaround on the SOP's working clock. A separate read from the counts, so
  // the three count cards still render if this one fails.
  const turnaround = useSupportTurnaround(institutionId, role, !isBoard);
  const { data: facets } = useReportedIssueFacets();
  // The reporting cutoff. The cards ALWAYS obey it; this toggle lifts it for
  // the list and the board only, so the 2026-09-28 reset hid history without
  // putting it out of reach (nothing was deleted).
  const { data: statsSince = null } = useSupportStatsSince();
  const {
    data: issues,
    isLoading,
    isError,
    error,
    refetch,
  } = useReportedIssues({ status, institutionId, role }, showEarlier);
  const board = useReportedIssuesBoard(institutionId, role, showEarlier);
  const setIssueStatus = useSetIssueStatus();
  // SOP chips (priority, escalated, waiting on reporter) once the columns exist.
  const { data: sopReady = false } = useSupportSopReady();
  // Who is working on each ticket: one read for the whole page, because the
  // mark lives in an internal message rather than a column on the ticket. See
  // src/lib/supportEscalation.ts for why.
  const escalations = useSupportEscalations();

  // `mutate` is referentially stable in React Query v5, so destructuring it
  // keeps the callbacks below stable and out of effect-loop territory.
  const { mutate: markTicketRead } = useMarkSupportTicketRead();
  const markedRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | null>(null);

  const openIssue = useCallback(
    (ticketId: string) => {
      selectedIdRef.current = ticketId;
      setSelectedId(ticketId);
      setDetailOpen(true);

      // Stamp salci_last_read_at once per ticket per visit, then refresh the
      // rows and counts so the unread dot actually clears on screen.
      if (markedRef.current.has(ticketId)) return;
      markedRef.current.add(ticketId);
      markTicketRead(ticketId, {
        onSuccess: () => {
          for (const key of [
            "support-inbox",
            "support-inbox-counts",
            "support-inbox-stats",
            "support-inbox-ticket",
          ]) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        },
      });
    },
    [markTicketRead, queryClient],
  );

  // Deep link. Support notifications point at /admin/issues?ticket=<id>, and
  // the linked ticket is usually in a different status tab from the one on
  // screen, so it is fetched by id rather than hunted for in the list. Hunting
  // for it in the tab-filtered list would leave the sheet titled with a
  // placeholder on arrival, which is exactly the bug /support still carries.
  const deepLinkId = searchParams.get("ticket");

  useEffect(() => {
    if (!deepLinkId) return;
    if (selectedIdRef.current === deepLinkId) return;
    openIssue(deepLinkId);
  }, [deepLinkId, openIssue]);

  // ONE by-id read serves both paths, because both now carry only an id. It is
  // re-read after every invalidation, so the sheet header follows a status
  // change instead of showing the row as it looked when it was clicked.
  const {
    data: fetchedIssue,
    isError: selectedIsError,
    error: selectedError,
    isSuccess: selectedIsSuccess,
  } = useReportedIssueById(selectedId);

  // The list row renders the sheet instantly on click; the by-id read replaces
  // it the moment it lands and is authoritative from then on. A deep link from
  // another status tab has no list row, so it waits for the read.
  const selectedFromList = useMemo(
    () => issues?.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId],
  );
  const selected = fetchedIssue ?? selectedFromList;

  // A failed or empty deep-link read used to do nothing at all: a super admin
  // following a notification landed on the inbox with no sheet and no reason
  // given, which is the same "a failed query reads as no data" defect the
  // teacher-surface audit catalogued. Reported once per ticket id.
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || notifiedRef.current === selectedId) return;
    if (selectedIsError) {
      notifiedRef.current = selectedId;
      toastError(selectedError, {
        fallback: "Couldn't open that support request.",
        context: "adminIssuesOpenTicket",
      });
      return;
    }
    if (selectedIsSuccess && fetchedIssue === null && !selectedFromList) {
      notifiedRef.current = selectedId;
      toast.error("That support request no longer exists.");
      setDetailOpen(false);
    }
  }, [
    selectedId,
    selectedIsError,
    selectedError,
    selectedIsSuccess,
    fetchedIssue,
    selectedFromList,
  ]);

  const handleDetailOpenChange = (next: boolean) => {
    setDetailOpen(next);
    if (!next) {
      // Release the guard as well as the query param. Without this, closing a
      // deep-linked sheet and then navigating BACK restored ?ticket= but left
      // selectedIdRef holding that same id, so the effect above returned early
      // and the sheet stayed shut.
      selectedIdRef.current = null;
      notifiedRef.current = null;
      if (searchParams.has("ticket")) {
        const params = new URLSearchParams(searchParams);
        params.delete("ticket");
        setSearchParams(params, { replace: true });
      }
    }
  };

  // The badges read the SAME snapshot as the cards above them (stats has no
  // status in its key, so a tab switch cannot leave the two disagreeing for a
  // staleTime). counts is only the fallback when stats is off (board mode) or
  // has failed; on a failed counts read there is no badge at all, because a
  // printed 0 would be a lie.
  const tabs: MobileTabOption[] = useMemo(
    () =>
      (Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((key) => ({
        value: key,
        label: ISSUE_STATUS_LABELS[key],
        count: stats ? stats[key] : countsError ? undefined : (counts?.[key] ?? 0),
      })),
    [stats, counts, countsError],
  );

  // Narrows the page the server already bounded to 200 rows. This is a display
  // filter over rows in hand, not an aggregation: the authoritative total is
  // counts.awaiting_salci, computed in Postgres.
  //
  // The count and this filter MUST measure the same set. Both are scoped to
  // `status`: the RPC is passed the active tab, and `issues` is that tab's
  // list. Without that, the chip would read a platform-wide open + in_progress
  // figure, so the Closed tab could offer "Awaiting SALCI (7)" and then filter
  // to zero rows. The only remaining gap is the 200-row page bound on the list,
  // which the chip's count deliberately ignores because it is the true total
  // for the tab.
  //
  // Order is the Ticket Resolution SOP's: tickets past 24 working hours first,
  // then SALCI priority (untriaged between P1 and P2), then the reporter's role,
  // then oldest first. A sort over the rows in hand, not a query.
  const isTicketEscalated = useCallback(
    (ticketId: string) => escalations.data?.marks.has(ticketId) ?? false,
    [escalations.data],
  );

  const visibleIssues = useMemo(() => {
    if (!issues) return [];
    let rows = awaitingOnly ? issues.filter(issueAwaitsSalci) : issues;
    if (escalatedOnly) rows = rows.filter((i) => isTicketEscalated(i.id));
    return [...rows].sort(supportInboxComparator(now));
  }, [issues, awaitingOnly, escalatedOnly, isTicketEscalated, now]);

  // Same display filter over the board's four-status set.
  const boardTickets = useMemo(() => {
    let source = awaitingOnly ? board.issues.filter(issueAwaitsSalci) : board.issues;
    if (escalatedOnly) source = source.filter((i) => isTicketEscalated(i.id));
    return source.flatMap((issue) => {
      const ticket = boardTicketFromIssue(
        issue,
        issueAwaitsSalci(issue),
        escalations.data?.marks.get(issue.id) ?? null,
      );
      return ticket ? [ticket] : [];
    });
  }, [board.issues, awaitingOnly, escalatedOnly, isTicketEscalated, escalations.data]);

  const schoolLabel =
    facets?.schools.find((s) => s.id === institutionId)?.name ?? "All schools";
  const roleLabel = role ? role.replace(/_/g, " ") : "All roles";
  const activeFilters =
    (institutionId ? 1 : 0) + (role ? 1 : 0) + (awaitingOnly ? 1 : 0) + (escalatedOnly ? 1 : 0);
  const awaitingCount = countsError ? null : (counts?.awaiting_salci ?? 0);

  return (
    <PageShell
      className={isBoard ? BOARD_SHELL : undefined}
      contentClassName={isBoard ? BOARD_SHELL_CONTENT : undefined}
    >
      {/* No Refresh button, deliberately. It was the page's loudest control
          while the real action here is opening a ticket, and it only existed
          because nothing else pulled new rows: this page has no realtime
          channel and the global default is refetchOnWindowFocus:false. The
          inbox queries now refetch on tab focus instead (see
          useReportedIssues), opening a ticket already invalidates the list,
          and new activity rings the bell. */}
      {/* Compact title block. This is an inbox someone works through, so the
          screen belongs to the requests: at the full title size the header,
          the filter chips and the search row together pushed the first card
          most of the way down a laptop screen. */}
      <PageHeader
        density="compact"
        icon={<LifeBuoy className="h-5 w-5" />}
        title="Support Inbox"
        subtitle="Ordered by the support SOP: overdue first, then priority"
        extras={<ViewModeToggle value={viewMode} onChange={setViewMode} cardsLabel="List" />}
      />

      {/* Renders only when intake is degraded or down. Exists because of the
          2026-09-02 incident: seven days of failed submissions with nothing on
          this page to show for it. */}
      <SupportHealthBanner />

      {/* The reporting cutoff, stated rather than implied. A card reading zero
          next to a school that has written to us for months is only honest if
          the page says where the count starts and offers the way back. */}
      {statsSince && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          <span>
            {showEarlier
              ? "Showing every ticket. The cards still count from"
              : "Counting from"}{" "}
            {format(new Date(statsSince), "d MMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            className="rounded-sm font-medium text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
          >
            {showEarlier ? "Hide earlier tickets" : "Show earlier tickets"}
          </button>
        </div>
      )}

      {/* Three cards: Open, In Progress, Resolved (Closed rides inside Resolved
          as a footnote). Hidden in board mode, where the columns already carry
          the numbers and clicking a card sets a status the board does not use.
          Error state before any number: a failed read renders a strip. */}
      {!isBoard && (
        <InboxStatsRow
          stats={stats}
          isLoading={statsLoading}
          isError={statsError}
          error={statsErr}
          refetch={() => {
            void refetchStats();
          }}
          institutionFiltered={Boolean(institutionId)}
          onSelect={setStatus}
          tat={turnaround.data}
          tatError={turnaround.isError}
        />
      )}

      {/* The board's columns ARE the statuses, so the tab strip steps aside. */}
      {!isBoard && (
        <div className="mt-6 sticky top-[var(--app-bar-offset,var(--app-bar-height,61px))] z-20 -mx-4 px-4 py-2 tab-strip-frost shadow-none">
          <MobileTabs value={status} onValueChange={(v) => setStatus(v as IssueStatus)} options={tabs} />
        </div>
      )}

      <FilterRow
        className="mt-1"
        activeCount={activeFilters}
        onClear={() => {
          setInstitutionId(null);
          setRole(null);
          setAwaitingOnly(false);
          setEscalatedOnly(false);
        }}
      >
        <FilterChip
          label={awaitingCount === null ? "Awaiting SALCI" : `Awaiting SALCI (${awaitingCount})`}
          active={awaitingOnly}
          onClick={() => setAwaitingOnly((v) => !v)}
          trailing={<Bell className="h-4 w-4 shrink-0" />}
        />

        {/* Only the tickets handed to someone with a task raised for them.
            Hidden while the marks cannot be read, so it never filters to
            nothing on a failed request. */}
        {!escalations.isError && (
          <FilterChip
            label="Escalated"
            active={escalatedOnly}
            onClick={() => setEscalatedOnly((v) => !v)}
            trailing={<ExternalLink className="h-4 w-4 shrink-0" />}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip label={schoolLabel} active={Boolean(institutionId)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
            <DropdownMenuItem onSelect={() => setInstitutionId(null)}>
              All schools
            </DropdownMenuItem>
            {facets?.schools.map((school) => (
              <DropdownMenuItem key={school.id} onSelect={() => setInstitutionId(school.id)}>
                {school.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip
              label={roleLabel}
              active={Boolean(role)}
              className="capitalize"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onSelect={() => setRole(null)}>All roles</DropdownMenuItem>
            {facets?.roles.map((r) => (
              <DropdownMenuItem key={r} onSelect={() => setRole(r)} className="capitalize">
                {r.replace(/_/g, " ")}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </FilterRow>

      <div
        className={cn(
          "mt-3 space-y-3",
          isBoard && "md:flex md:min-h-0 md:flex-1 md:flex-col",
        )}
      >
        {isBoard ? (
          /* SALCI may set any of the four statuses, so every column accepts a
             drop; `set_support_ticket_status` is the one write path and writes
             the system row, stamps and notifications in one transaction. */
          <SupportBoardView
            tickets={boardTickets}
            isLoading={board.isLoading}
            error={board.isError ? board.error : null}
            onRetry={board.refetch}
            onOpen={openIssue}
            canMove
            onMove={(ticket, target) => {
              if (setIssueStatus.isPending) return;
              // A closure needs its sentence first; every other move is direct.
              if (target === "resolved" || target === "closed") {
                setPendingMove({ ticket, target });
                return;
              }
              setIssueStatus.mutate({ ticketId: ticket.id, status: target });
            }}
            defaultSort="sop"
            showReporter
            fillHeight
            attentionLabel="Unread reply from the reporter"
            emptyState={
              <EmptyState
                icon={<Inbox className="h-7 w-7" />}
                title={
                  awaitingOnly
                    ? "Nothing is waiting on SALCI"
                    : escalatedOnly
                      ? "Nothing is escalated"
                      : "No support requests"
                }
                description={
                  awaitingOnly
                    ? "Every request has been read since the reporter last wrote."
                    : escalatedOnly
                      ? "A request is escalated once someone is on it and its task link is pasted in."
                      : activeFilters > 0
                        ? "No requests match these filters."
                        : "Support requests will appear here as schools raise them."
                }
              />
            }
            footnote={
              <p className="pt-1 text-center text-xs text-ink-400">
                Each column shows its 200 most recent requests.
              </p>
            }
          />
        ) : isLoading ? (
          <>
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
          </>
        ) : isError ? (
          /* Error BEFORE empty (§6): a failed read must never read as "nothing
             here". translateError, not error.message (§19): a timeout or a
             42501 otherwise prints raw engine output onto the page. */
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load the inbox"
            description={
              translateError(
                error,
                "Something went wrong fetching support requests. Please try again.",
              ).title
            }
            tone="rose"
            reason="error"
            action={{ label: "Try again", onClick: () => void refetch() }}
          />
        ) : !visibleIssues.length ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={
              awaitingOnly
                ? "Nothing is waiting on SALCI"
                : escalatedOnly
                  ? "Nothing is escalated"
                  : `Nothing ${ISSUE_STATUS_LABELS[status].toLowerCase()}`
            }
            description={
              awaitingOnly
                ? "Every request in this tab has been read since the reporter last wrote."
                : escalatedOnly
                  ? "A request is escalated once someone is on it and its task link is pasted in."
                  : activeFilters > 0
                    ? "No requests match these filters."
                    : "Support requests will appear here as schools raise them."
            }
          />
        ) : (
          <ul className="space-y-3">
            {visibleIssues.map((issue) => {
              const awaits = issueAwaitsSalci(issue);
              const live = isLiveStatus(issue.status);
              const overdue = isSopOverdue(issue, now);
              const mark = escalations.data?.marks.get(issue.id) ?? null;
              // Approximate until last_salci_message_at exists (NEEDS DB): the
              // last message of any side. When the reporter spoke last the dot
              // above already says so, so this only fires when SALCI is quiet.
              const quietHours = live && !awaits && issue.last_message_at
                ? workingHoursSince(issue.last_message_at, now)
                : 0;
              return (
                <ListRow
                  key={issue.id}
                  as="li"
                  className={cn(overdue && "border border-ink-400/60")}
                  onClick={() => openIssue(issue.id)}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      {awaits && (
                        <>
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-primary"
                          />
                          <span className="sr-only">Unread reply from the reporter</span>
                        </>
                      )}
                      <span className="truncate">{issue.subject}</span>
                    </span>
                  }
                  subtitle={
                    <span>
                      <span className="capitalize">
                        {issue.reporter_name || "Unknown"}
                        {issue.institution_name ? ` · ${issue.institution_name}` : ""}
                        {issue.reporter_role ? ` · ${issue.reporter_role.replace(/_/g, " ")}` : ""}
                      </span>
                      {quietHours >= SOP_QUIET_WORKING_HOURS && (
                        <span className="font-medium text-ink-700">
                          {" · "}No update for {formatWorkingAge(quietHours)}
                        </span>
                      )}
                      {live && (sopReady || mark) && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {sopReady && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 px-1.5 text-[11px]",
                                issue.triage_priority
                                  ? "border-ink-700 font-semibold text-ink-900"
                                  : "border-dashed border-ink-400 text-ink-600",
                              )}
                            >
                              {issue.triage_priority ? SUPPORT_PRIORITY_LABEL[issue.triage_priority] : UNTRIAGED_LABEL}
                            </Badge>
                          )}
                          {mark && (
                            <Badge
                              variant="outline"
                              className="h-5 max-w-[200px] truncate border-violet-500/30 bg-violet-500/10 px-1.5 text-[11px] font-medium text-violet-600"
                            >
                              {escalationLabel(mark)}
                            </Badge>
                          )}
                        </span>
                      )}
                    </span>
                  }
                  trailing={
                    <div className="flex flex-col items-end gap-1.5">
                      {/* Urgency is weight, not colour (support-module skill §5):
                          the overdue chip is the darkest ink on the row. */}
                      {overdue ? (
                        <Badge
                          variant="outline"
                          className="border-ink-700 bg-ink-400/10 font-semibold text-ink-900"
                        >
                          Past 24 working hours
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={STATUS_TONES[issue.status] ?? ""}>
                          {ISSUE_STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
                        </Badge>
                      )}
                      <span className="whitespace-nowrap text-xs text-ink-500">
                        {live
                          ? `Open ${formatWorkingAge(sopWorkingAgeHours(issue, now))}`
                          : format(new Date(issue.last_message_at ?? issue.created_at), "MMM d")}
                      </span>
                    </div>
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      <IssueDetailSheet
        issue={selected}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
      />

      {pendingMove && (
        <ClosureNoteSheet
          open
          onOpenChange={(open) => {
            if (!open) setPendingMove(null);
          }}
          target={pendingMove.target}
          subject={pendingMove.ticket.subject}
          loading={setIssueStatus.isPending}
          onConfirm={(note) => {
            const { ticket, target } = pendingMove;
            setIssueStatus.mutate(
              { ticketId: ticket.id, status: target, note },
              { onSettled: () => setPendingMove(null) },
            );
          }}
        />
      )}
    </PageShell>
  );
}
