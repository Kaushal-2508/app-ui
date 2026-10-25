import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Inbox,
  LifeBuoy,
  MailOpen,
  Plus,
} from "lucide-react";

import { isNativePlatform } from "@/lib/native";
import { cn } from "@/lib/utils";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, ListRow, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";
import { ViewModeToggle, useViewMode } from "@/components/shared/board";
import { SupportBoardView } from "@/components/issues/board/SupportBoardView";
import { SUPPORT_VIEW_STORAGE_KEY, boardTicketFromMine } from "@/lib/supportBoard";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { translateError } from "@/lib/errorMessages";
import {
  SupportRequestSheet,
  type SupportRequestPrefill,
} from "@/components/issues/SupportRequestSheet";
import { SupportThread } from "@/components/issues/SupportThread";
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_TONES,
  useMySupportTickets,
  useSupportThread,
  type SupportTab,
  type SupportTicket,
  type SupportTicketCounts,
} from "@/hooks/useSupportTickets";

const TAB_EMPTY_COPY: Record<SupportTab, { title: string; description: string }> = {
  active: {
    title: "No open requests",
    description: "Anything you raise with SALCI shows up here while we work on it.",
  },
  resolved: {
    title: "Nothing resolved yet",
    description: "Requests move here once SALCI closes them out.",
  },
  all: {
    title: "You have not raised anything yet",
    description: "Tap New request to tell SALCI what went wrong.",
  },
};

/**
 * Salci Support, reporter side.
 *
 * Every authenticated role reaches this page, students and employees included:
 * they are 37% of real reporters and had no tracking surface at all before it.
 * The route deliberately carries no allowedRoles and is deliberately absent
 * from FEATURE_URL_MAP, so no school can end up able to press the Support
 * button but unable to open the page it leads to.
 */
export default function SupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SupportTab>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  // Set only by "Raise this again", so the new request opens already naming the
  // one it follows. Cleared for an ordinary new request.
  const [followUp, setFollowUp] = useState<SupportRequestPrefill | null>(null);

  // Inside the app this is a phone screen, not a web page: the list is the
  // whole point, so the stat tiles and the board toggle step aside (the tabs
  // carry the same counts), rows sit in one grouped list, and a thread opens
  // full screen as a chat. The website keeps every one of those elements.
  const native = isNativePlatform();

  // List or board. The board shows every status as a column, so it reads the
  // "all" slice regardless of the tab; the slice is a cached re-select, not a
  // second request.
  const [viewMode, setViewMode] = useViewMode(SUPPORT_VIEW_STORAGE_KEY);
  const isBoard = !native && viewMode === "board";

  const { data, isLoading, isError, error, refetch } = useMySupportTickets(
    isBoard ? "all" : tab,
  );

  const tickets: SupportTicket[] = useMemo(() => data?.tickets ?? [], [data]);
  const boardTickets = useMemo(() => tickets.map(boardTicketFromMine), [tickets]);

  // Server-aggregated in list_my_support_tickets over EVERY ticket this person
  // owns, so the tiles and the tab counts stay right past the 100-row page.
  // Never recount `tickets` here: that array is one clamped, tab-filtered page.
  const counts: SupportTicketCounts =
    data?.counts ?? { active: 0, awaiting: 0, resolved: 0, total: 0 };

  // Deep link from a notification: /support?ticket=<id>. Switch to All first,
  // or a ticket that has since been resolved opens against a list that does
  // not contain it and the sheet has no subject to show.
  const deepLinkId = searchParams.get("ticket");
  useEffect(() => {
    if (!deepLinkId) return;
    setTab("all");
    setSelectedId(deepLinkId);
  }, [deepLinkId]);

  const closeTicket = () => {
    setSelectedId(null);
    if (searchParams.has("ticket")) {
      const next = new URLSearchParams(searchParams);
      next.delete("ticket");
      setSearchParams(next, { replace: true });
    }
  };

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  // `selected` is a lookup into the TAB-FILTERED page, so it is null whenever
  // the open ticket is not in the visible slice: on every ?ticket= deep-link
  // arrival while the list is still loading, and whenever a ticket moves tab
  // under an open sheet. The sheet then showed a bare "Support request" with no
  // status line.
  //
  // Reading the thread header covers both. This is the SAME query key
  // SupportThread already mounts (["support-thread", ticketId]), so TanStack
  // dedupes it and this costs no extra request.
  // Pass `selectedId` verbatim, NOT `selectedId ?? ""`: the key must be
  // byte-identical to the child's ["support-thread", ticketId] or the two
  // become separate cache entries and the request is made twice.
  const { data: openThread } = useSupportThread(selectedId);
  const openTicket = openThread?.ticket ?? selected;

  const startNewRequest = () => {
    setFollowUp(null);
    setNewRequestOpen(true);
  };

  /**
   * A closed request takes no more replies: `post_support_message` reopens the
   * ticket whenever the reporter posts on a finished one, which drags closed
   * work back into SALCI's Open tab. The problem coming back is a new request,
   * so this carries the old one's details into the intake form and leaves the
   * closed thread closed.
   */
  const raiseAgain = () => {
    if (!openTicket) return;
    const raised = format(new Date(openTicket.created_at), "d MMM yyyy");
    setFollowUp({
      subject: openTicket.subject,
      category: openTicket.category ?? "",
      urgency: String(openTicket.priority ?? 2),
      description: `Follow-up to my earlier request "${openTicket.subject}", raised ${raised} and now closed.\n\nWhat is happening now:\n`,
    });
    closeTicket();
    setNewRequestOpen(true);
  };

  const tabs: MobileTabOption[] = [
    { value: "active", label: "Active", count: counts.active },
    { value: "resolved", label: "Resolved", count: counts.resolved },
    { value: "all", label: "All", count: counts.total },
  ];

  return (
    <PageShell>
      <PageHeader
        icon={<LifeBuoy className="h-5 w-5" />}
        title="Salci Support"
        subtitle="Your requests to SALCI, and every reply on them"
        extras={
          native ? undefined : (
            <ViewModeToggle value={viewMode} onChange={setViewMode} cardsLabel="List" />
          )
        }
        primaryAction={{
          label: "New request",
          icon: <Plus className="h-4 w-4" />,
          onClick: startNewRequest,
        }}
      />

      {!native && (
      <StatTileGrid mdCols={3} lgCols={3} className="mt-2">
        <StatTile
          label="Active"
          value={counts.active}
          icon={<Inbox className="h-5 w-5" />}
          tone="peach"
          onClick={() => setTab("active")}
        />
        {/* This tile is labelled "New activity", NOT "Awaiting your reply".
            counts.awaiting is computed server-side as
              last_message_at > coalesce(reporter_last_read_at, epoch)
            which INCLUDES a ticket whose newest message is the reporter's own,
            while the per-row has_unread dot below additionally requires
            author_side <> 'reporter'. Labelling this number "Awaiting your
            reply" would print a tile that says SALCI is waiting on you while
            not one row in the list carries a dot, which is precisely the kind
            of contradiction a support tool cannot afford.

            Deriving the tile from the has_unread flags instead was rejected:
            that array is one clamped, tab-filtered page, so the number would
            change as you switch tabs and go wrong past 100 tickets, and
            counting fetched rows in the browser violates the Scale Gate.
            Narrowing the server aggregate to match has_unread is a one-line
            DB change and belongs in a migration, not here. Until that lands,
            the label states exactly what the number counts. If the aggregate
            is ever narrowed, rename this tile back to "Awaiting your reply"
            in the same change, never separately. */}
        <StatTile
          label="New activity"
          value={counts.awaiting}
          icon={<MailOpen className="h-5 w-5" />}
          tone="sky"
          onClick={() => setTab("all")}
        />
        <StatTile
          label="Resolved"
          value={counts.resolved}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
          onClick={() => setTab("resolved")}
        />
      </StatTileGrid>
      )}

      {/* The board's columns ARE the statuses, so the tab strip steps aside. */}
      {!isBoard && (
        <div
          className={cn(
            "sticky top-[var(--app-bar-offset,var(--app-bar-height,61px))] z-20 -mx-4 px-4 py-2 tab-strip-frost shadow-none",
            native ? "mt-2" : "mt-6",
          )}
        >
          <MobileTabs
            value={tab}
            onValueChange={(v) => setTab(v as SupportTab)}
            options={tabs}
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {isBoard ? (
          /* Read-only for the reporter: only SALCI may set a status, and a
             reply reopens a resolved request (there is no Reopen button by
             design). Cards open the same thread sheet as the list rows. */
          <SupportBoardView
            tickets={boardTickets}
            isLoading={isLoading}
            error={isError ? error : null}
            onRetry={() => void refetch()}
            onOpen={setSelectedId}
            canMove={false}
            showReporter={false}
            attentionLabel="New reply"
            emptyState={
              <EmptyState
                icon={<LifeBuoy className="h-7 w-7" />}
                title={TAB_EMPTY_COPY.all.title}
                description={TAB_EMPTY_COPY.all.description}
                action={{
                  label: "New request",
                  onClick: startNewRequest,
                  icon: <Plus className="h-4 w-4" />,
                }}
              />
            }
            footnote={
              data?.hasMore ? (
                <p className="pt-1 text-center text-xs text-ink-400">
                  Showing your 100 most recent requests.
                </p>
              ) : undefined
            }
          />
        ) : isLoading ? (
          <>
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
          </>
        ) : isError ? (
          /* Error BEFORE empty (§6): a failed read must never read as "you have
             raised nothing", which would send the reporter to raise a duplicate.

             translateError, not error.message (§19). The RPC raises friendly
             text on its expected paths, but a timeout, a 42501 or a dropped
             connection prints raw engine output, and EVERY role reaches this
             page. A student must never be shown a Postgres string. */
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load your requests"
            description={
              translateError(
                error,
                "Something went wrong fetching your support requests. Please try again.",
              ).title
            }
            tone="rose"
            reason="error"
            action={{ label: "Try again", onClick: () => void refetch() }}
          />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="h-7 w-7" />}
            title={TAB_EMPTY_COPY[tab].title}
            description={TAB_EMPTY_COPY[tab].description}
            action={{
              label: "New request",
              onClick: startNewRequest,
              icon: <Plus className="h-4 w-4" />,
            }}
          />
        ) : native ? (
          <>
            {/* One grouped list, rows divided by hairlines, chevron on every
                row: the settings-list shape a phone user already knows. */}
            <ul className="surface-card frosted-shadow overflow-hidden rounded-card divide-y divide-surface-stroke">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(ticket.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-400/5 focus:outline-none focus-visible:bg-ink-400/5"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        ticket.has_unread ? "bg-brand-primary" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium leading-[22px] text-ink-900">
                        {ticket.has_unread && <span className="sr-only">New reply. </span>}
                        {ticket.subject}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-ink-500">
                        <span
                          className={cn(
                            "truncate",
                            ticket.status === "open" || ticket.status === "in_progress"
                              ? "text-brand-primary"
                              : "",
                          )}
                        >
                          {SUPPORT_STATUS_LABELS[ticket.status] ?? ticket.status}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate">
                          {ticket.message_count === 1
                            ? "1 message"
                            : `${ticket.message_count} messages`}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-ink-400">
                      {format(new Date(ticket.last_message_at ?? ticket.created_at), "MMM d")}
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {data?.hasMore && (
              <p className="pt-1 text-center text-xs text-ink-400">
                Showing your 100 most recent requests.
              </p>
            )}
          </>
        ) : (
          <>
            <ul className="space-y-3">
              {tickets.map((ticket) => (
                <ListRow
                  key={ticket.id}
                  as="li"
                  onClick={() => setSelectedId(ticket.id)}
                  title={
                    <span className="flex items-center gap-2">
                      {ticket.has_unread && (
                        <>
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-primary"
                          />
                          <span className="sr-only">New reply</span>
                        </>
                      )}
                      <span className="truncate">{ticket.subject}</span>
                    </span>
                  }
                  subtitle={
                    <span>
                      {ticket.category ? `${ticket.category} · ` : ""}
                      {ticket.message_count === 1
                        ? "1 message"
                        : `${ticket.message_count} messages`}
                      {ticket.last_message_at
                        ? ` · ${format(new Date(ticket.last_message_at), "MMM d")}`
                        : ""}
                    </span>
                  }
                  trailing={
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge
                        variant="outline"
                        className={SUPPORT_STATUS_TONES[ticket.status] ?? ""}
                      >
                        {SUPPORT_STATUS_LABELS[ticket.status] ?? ticket.status}
                      </Badge>
                      <span className="whitespace-nowrap text-xs text-ink-500">
                        {format(new Date(ticket.created_at), "MMM d")}
                      </span>
                    </div>
                  }
                />
              ))}
            </ul>

            {/* The tab counts above are aggregated over every ticket this
                reporter owns, while the list is one 100-row page. Below 100
                tickets the two are identical; past it they are not, and a count
                that outruns the rows on screen with no explanation reads as
                missing data. Say so instead. */}
            {data?.hasMore && (
              <p className="pt-1 text-center text-xs text-ink-400">
                Showing your 100 most recent requests.
              </p>
            )}
          </>
        )}
      </div>

      {/* placement="center" is mandatory on the web: the "bottom" placement
          hard-codes bg-white and does not flip in dark mode. The app opens the
          thread full screen ("right" fills a phone) as a chat: messages scroll
          in their own pane and the composer stays pinned above the keyboard. */}
      <MobileSheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) closeTicket();
        }}
        placement={native ? "right" : "center"}
        bodyClassName={native ? "flex flex-col p-0 overflow-y-hidden" : undefined}
        title={openTicket?.subject ?? "Support request"}
        subtitle={
          openTicket
            ? `${SUPPORT_STATUS_LABELS[openTicket.status]} · raised ${format(
                new Date(openTicket.created_at),
                "MMM d, yyyy",
              )}`
            : undefined
        }
        icon={<LifeBuoy className="h-4 w-4" />}
      >
        {selectedId && (
          <SupportThread
            ticketId={selectedId}
            canPostInternal={false}
            layout={native ? "chat" : "stacked"}
            onRaiseAgain={raiseAgain}
          />
        )}
      </MobileSheet>

      <SupportRequestSheet
        open={newRequestOpen}
        onOpenChange={setNewRequestOpen}
        prefill={followUp}
      />
    </PageShell>
  );
}
