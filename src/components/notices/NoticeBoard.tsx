import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Inbox, Plus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChip, MobileTabs } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import {
  useNoticeInbox,
  useNoticeOutbox,
  type InboxNotice,
  type OutboxNotice,
} from "@/hooks/notices";

import { InboxNoticeCard, IssuedNoticeCard, NoticeCardSkeleton } from "./NoticeCard";
import { NoticeComposer } from "./NoticeComposer";
import { NoticeDetail } from "./NoticeDetail";
import { NoticeDetailPane } from "./NoticeDetailPane";
import { NOTICE_TYPE_FILTERS, groupNoticesByDate } from "./noticeMeta";

type BoardTab = "received" | "issued";

/** Matches Tailwind's `lg` breakpoint, where the split view switches on. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** One line under the toolbar that says what the Issued list actually is,
 *  since "Issued" alone hides that oversight widens it. */
const ISSUED_HINT: Record<"admin" | "coordinator" | "teacher", string> = {
  admin: "Every notice issued in your school, with how far each has reached.",
  coordinator: "Notices you issued, plus any sent to classes in your wings.",
  teacher: "Notices you issued, with how many of your students have read them.",
};

/**
 * The Notice Board, shared by the dedicated /school/notices route and the
 * Communication page's tab. One implementation, two entry points.
 *
 * "Received" is everyone's inbox. "Issued" appears only for people who can
 * publish, and its contents are decided server-side by notice_can_oversee():
 * a teacher sees their own, a coordinator theirs plus their wings', an admin
 * the whole school.
 *
 * Layout: a single card list on phones and tablets, with the detail opening
 * as a centred sheet. From lg up the list fills the row until a notice is
 * chosen; then it moves into the left column and a sticky detail pane opens
 * on the right, so an admin can walk down the Issued list and watch reach
 * without a modal per row. Only one detail container is mounted at a time,
 * so a read is stamped once.
 *
 * Filters (type, unread) apply to the rows already loaded; they are a lens on
 * the page, not a server query. Server-side filtering would need `notice_inbox`
 * and `notice_outbox` to accept a type argument (NEEDS DB).
 */
export function NoticeBoard() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");
  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : Boolean(roleInfo?.isCoordinator) && !roleInfo?.isSchoolAdmin;
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;

  const canPublish = isAdmin || isCoordinator || isTeacher;
  const isTeacherOnly = isTeacher && !isAdmin && !isCoordinator;

  const [tab, setTabState] = useState<BoardTab>("received");
  const [typeFilter, setTypeFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<InboxNotice | null>(null);
  const [selectedIsOwn, setSelectedIsOwn] = useState(false);

  const inbox = useNoticeInbox();
  const outbox = useNoticeOutbox(canPublish);

  const inboxRows = useMemo(
    () => inbox.data?.pages.flatMap((p) => p.rows) ?? [],
    [inbox.data],
  );
  const outboxRows = useMemo(
    () => outbox.data?.pages.flatMap((p) => p.rows) ?? [],
    [outbox.data],
  );

  // Unread among the rows on screen; it labels the tab, nothing else.
  const unreadCount = inboxRows.filter((n) => !n.read_at).length;

  // Deep link from the notification bell: /school/notices?notice=<id> opens
  // that notice as soon as the inbox has loaded. A just-published notice is
  // always on the first page. The param is consumed either way so a refresh
  // or a back-navigation does not reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedNoticeId = searchParams.get("notice");
  useEffect(() => {
    if (!linkedNoticeId || !inbox.isSuccess) return;
    const hit = inboxRows.find((n) => n.id === linkedNoticeId);
    if (hit) {
      setTabState("received");
      setSelected(hit);
      setSelectedIsOwn(false);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("notice");
    setSearchParams(next, { replace: true });
  }, [linkedNoticeId, inbox.isSuccess, inboxRows, searchParams, setSearchParams]);

  const visibleInbox = useMemo(
    () =>
      inboxRows.filter(
        (n) =>
          (typeFilter === "all" || n.type === typeFilter) &&
          (!unreadOnly || !n.read_at),
      ),
    [inboxRows, typeFilter, unreadOnly],
  );
  const visibleOutbox = useMemo(
    () => outboxRows.filter((n) => typeFilter === "all" || n.type === typeFilter),
    [outboxRows, typeFilter],
  );
  const groupedInbox = useMemo(
    () => groupNoticesByDate(visibleInbox, (n) => n.published_at),
    [visibleInbox],
  );
  const groupedOutbox = useMemo(
    () => groupNoticesByDate(visibleOutbox, (n) => n.published_at),
    [visibleOutbox],
  );

  const activeFilterCount = (typeFilter !== "all" ? 1 : 0) + (unreadOnly ? 1 : 0);
  const clearFilters = () => {
    setTypeFilter("all");
    setUnreadOnly(false);
  };

  const tabs = useMemo(
    () =>
      canPublish
        ? [
            { value: "received", label: "Received", count: unreadCount || undefined },
            { value: "issued", label: "Issued" },
          ]
        : [{ value: "received", label: "Received", count: unreadCount || undefined }],
    [canPublish, unreadCount],
  );

  const setTab = (next: BoardTab) => {
    setTabState(next);
    setSelected(null);
  };

  const openInbox = (notice: InboxNotice) => {
    setSelected(notice);
    setSelectedIsOwn(false);
  };

  /** An issued row carries no body or read state, so open it by finding the
   *  matching inbox row when there is one, and otherwise render what the
   *  outbox row already knows. The reach panel is the point of this view. */
  const openIssued = (row: OutboxNotice) => {
    const fromInbox = inboxRows.find((n) => n.id === row.id);
    setSelected(
      fromInbox ?? {
        id: row.id,
        title: row.title,
        content: "",
        type: row.type,
        scope: row.scope,
        priority: row.priority,
        published_at: row.published_at,
        expires_at: row.expires_at,
        requires_acknowledgement: row.requires_acknowledgement,
        attachments: [],
        publisher_name: row.publisher_name,
        read_at: null,
        acknowledged_at: null,
      },
    );
    setSelectedIsOwn(true);
  };

  const activeQuery = tab === "received" ? inbox : outbox;
  const isIssued = tab === "issued";
  const issuedHint = isAdmin
    ? ISSUED_HINT.admin
    : isCoordinator
      ? ISSUED_HINT.coordinator
      : ISSUED_HINT.teacher;
  const typeFilterLabel =
    NOTICE_TYPE_FILTERS.find((f) => f.value === typeFilter)?.label ?? "All types";
  const totalLoaded = isIssued ? outboxRows.length : inboxRows.length;
  const totalVisible = isIssued ? visibleOutbox.length : visibleInbox.length;

  const renderList = () => {
    // Error state renders BEFORE the empty state: a failed RPC must never
    // read as "no notices" (CLAUDE.md section 6).
    if (activeQuery.isError) {
      return (
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          title="Couldn't load notices"
          description="Something went wrong reaching the server. Try again in a moment."
          reason="error"
          action={{ label: "Retry", onClick: () => activeQuery.refetch() }}
        />
      );
    }

    if (roleLoading || activeQuery.isLoading) {
      return (
        <ul className="grid grid-cols-1 gap-3" aria-busy="true" aria-label="Loading notices">
          <NoticeCardSkeleton issued={isIssued} />
          <NoticeCardSkeleton issued={isIssued} />
          <NoticeCardSkeleton issued={isIssued} />
        </ul>
      );
    }

    if (totalLoaded === 0) {
      return isIssued ? (
        <EmptyState
          icon={<Send className="h-7 w-7" />}
          title="You haven't issued any notices"
          description="Notices you publish, and those issued in the classes you oversee, appear here with their read counts."
          reason="noData"
          action={{ label: "New notice", onClick: () => setComposerOpen(true) }}
        />
      ) : (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title="No notices yet"
          description="Notices sent to you by your school will appear here."
          reason="noData"
          action={
            canPublish
              ? { label: "Issue a notice", onClick: () => setComposerOpen(true) }
              : undefined
          }
        />
      );
    }

    if (totalVisible === 0) {
      return (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          tone="sky"
          title="Nothing matches these filters"
          description={
            activeQuery.hasNextPage
              ? "None of the notices loaded so far match. Clear the filters, or load older notices below."
              : "None of your notices match. Clear the filters to see everything."
          }
          reason="noResults"
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      );
    }

    const groups = isIssued ? groupedOutbox : groupedInbox;

    return (
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <p className="eyebrow mb-2.5 px-1">{g.group}</p>
            {/* grid-cols-1 is load-bearing, not decoration: an implicit `auto`
                track is sized to the row's min-content, and a card's meta line
                is `truncate` (white-space: nowrap), so a notice addressed to
                eight sections measured 478px wide inside a 375px phone and
                pushed its own date, chips and reach bar off-screen.
                minmax(0,1fr) caps the track at the container. */}
            <ul className="grid grid-cols-1 gap-2.5">
              {isIssued
                ? (g.rows as OutboxNotice[]).map((n) => (
                    <IssuedNoticeCard
                      key={n.id}
                      notice={n}
                      selected={isDesktop && selected?.id === n.id}
                      onClick={() => openIssued(n)}
                    />
                  ))
                : (g.rows as InboxNotice[]).map((n) => (
                    <InboxNoticeCard
                      key={n.id}
                      notice={n}
                      selected={isDesktop && selected?.id === n.id}
                      onClick={() => openInbox(n)}
                    />
                  ))}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* One toolbar row. The page above already owns the primary teal pills,
          so this level is deliberately quieter: a segmented Received/Issued
          switch, the type filter as a single dropdown chip (five type pills
          plus the tab pills read as one undifferentiated wall), the unread
          toggle, and the one action pushed to the right. On a phone the row
          wraps and the action takes the next line in full, rather than
          hanging in the right corner on a line of its own. */}
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && (
          <MobileTabs
            variant="segmented"
            value={tab}
            onValueChange={(v) => setTab(v as BoardTab)}
            options={tabs}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip
              label={typeFilterLabel}
              active={typeFilter !== "all"}
              aria-label="Filter by notice type"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuRadioGroup value={typeFilter} onValueChange={setTypeFilter}>
              {NOTICE_TYPE_FILTERS.map((f) => (
                <DropdownMenuRadioItem key={f.value} value={f.value}>
                  {f.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {!isIssued && (
          <FilterChip
            label="Unread only"
            active={unreadOnly}
            onClick={() => setUnreadOnly((v) => !v)}
            trailing={
              unreadOnly ? (
                <Check className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
              ) : (
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand-primary/70" />
              )
            }
          />
        )}

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-10 rounded-full px-3 text-[13px] text-ink-600 hover:bg-ink-400/5"
          >
            Clear
          </Button>
        )}

        {canPublish && (
          <Button
            onClick={() => setComposerOpen(true)}
            className="w-full shrink-0 gap-1.5 bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98] sm:ml-auto sm:w-auto"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New notice
          </Button>
        )}
      </div>

      {isIssued && (
        <p className="text-[13px] leading-[18px] text-ink-500">{issuedHint}</p>
      )}

      {/* The list owns the full width until a notice is chosen. Picking one
          splits the row: the list slides into the left column and the detail
          pane takes the right. Closing the pane gives the width back.

          The min-height is what lets the sticky pane grow. The pane sizes
          itself to the room below its own top, so on a short window it opens
          around 230px tall, and only reaches a full screen once the page has
          scrolled it up under the app bar. With one notice in the list there
          was nothing left to scroll, so it stayed at 230px forever. A row at
          least a screen tall (minus the app bar and the pane's own gutters)
          always leaves exactly the travel the pane needs, and is inert once
          the list is longer than that by itself. */}
      <div
        className={cn(
          isDesktop &&
            selected &&
            "lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:items-start lg:gap-6",
          isDesktop && selected && "lg:min-h-[calc(100dvh-var(--app-bar-height,61px)-2rem)]",
        )}
      >
        <div className="min-w-0 space-y-4">
          {renderList()}

          {activeQuery.hasNextPage && !activeQuery.isError && (
            <Button
              variant="outline"
              className="w-full rounded-full border-surface-stroke text-ink-700 hover:bg-ink-400/5"
              disabled={activeQuery.isFetchingNextPage}
              onClick={() => activeQuery.fetchNextPage()}
            >
              {activeQuery.isFetchingNextPage ? "Loading…" : "Show older notices"}
            </Button>
          )}
        </div>

        {isDesktop && selected && (
          <div className="sticky top-[calc(var(--app-bar-height,61px)+1rem)] hidden animate-in fade-in slide-in-from-right-4 duration-300 lg:block">
            <NoticeDetailPane
              notice={selected}
              onClose={() => setSelected(null)}
              canOversee={selectedIsOwn || canPublish}
            />
          </div>
        )}
      </div>

      {!isDesktop && (
        <NoticeDetail
          notice={selected}
          open={selected !== null}
          onOpenChange={(v) => !v && setSelected(null)}
          canOversee={selectedIsOwn || canPublish}
        />
      )}

      {canPublish && (
        <NoticeComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          isTeacherOnly={isTeacherOnly}
          canSendInstitutionWide={isAdmin}
          canSendWingWide={isAdmin || isCoordinator}
        />
      )}
    </div>
  );
}
