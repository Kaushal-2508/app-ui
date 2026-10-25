import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  Inbox,
  Megaphone,
  MessageSquare,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces";
import { ReachBar, NoticeTypeDisc } from "@/components/notices/NoticeBits";
import { formatNoticeDate } from "@/components/notices/noticeMeta";
import { useNoticeOutbox, type OutboxNotice } from "@/hooks/notices";
import { useAuth } from "@/hooks/useAuth";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { PTM_FEATURE_ID, ptmEffectiveStatus } from "@/lib/ptm";
import {
  isConversationUnread,
  useConversations,
  type ConversationListRow,
} from "@/hooks/useConversations";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { conversationTitle, initialsOf, useParticipantNames } from "./conversationNames";

/** Tabs this overview can jump to. The host says which of them it renders. */
export type OverviewTab = "notices" | "messages" | "ptm";

interface Props {
  institutionId: string;
  /** Switch the Communication page to another tab. */
  onOpenTab?: (tab: OverviewTab) => void;
  /** Tabs the host actually renders for this user; a jump link is shown only
   *  for those. A coordinator, for instance, has no Messages tab. */
  availableTabs?: OverviewTab[];
  /** @deprecated kept for older hosts; equivalent to onOpenTab("notices"). */
  onOpenNoticeBoard?: () => void;
}

const RECENT_NOTICE_LIMIT = 5;
const RECENT_MESSAGE_LIMIT = 5;
const UPCOMING_PTM_LIMIT = 3;

interface UpcomingPtm {
  id: string;
  title: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: string;
  class: { name: string; section: string | null } | null;
}

/**
 * Communication overview for admins and coordinators: what is happening now,
 * not a ledger of everything that ever happened.
 *
 * Three live panels, each fed by a query another tab already owns or by one
 * small bounded select: the newest notices with their reach (`notice_outbox`,
 * first page), the newest message threads with their unread state (the shared
 * `conversations` query the Messages tab uses, so this costs no extra
 * request), and the next few parent-teacher meetings (`ptm_schedules`, three
 * rows). The `communication_overview` aggregate is still called, but only to
 * decide whether the school has any activity at all; its all-time totals are
 * not shown, since a number that only ever creeps upward tells an admin
 * nothing about today.
 *
 * Nothing here counts rows on the client; the panels are display slices of
 * rows already fetched for display.
 */
export function CommunicationAnalytics({
  institutionId,
  onOpenTab,
  availableTabs,
  onOpenNoticeBoard,
}: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // The PTM panel follows the same flag as the PTM tab, so a school without
  // PTM gets no meeting card here either (ui-invariants section 2).
  const { isFeatureEnabled } = useInstitutionFeatures();
  const ptmEnabled = isFeatureEnabled(PTM_FEATURE_ID);

  const canOpen = (tab: OverviewTab) =>
    Boolean(onOpenTab || (tab === "notices" && onOpenNoticeBoard)) &&
    (availableTabs ? availableTabs.includes(tab) : true);
  const open = (tab: OverviewTab) => {
    if (onOpenTab) onOpenTab(tab);
    else if (tab === "notices") onOpenNoticeBoard?.();
  };

  const overview = useQuery({
    queryKey: ["communication-overview", institutionId],
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("communication_overview", {
        _institution_id: institutionId,
      });
      if (error) throw error;
      return rows?.[0] ?? null;
    },
    enabled: !!institutionId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const outbox = useNoticeOutbox(true);
  const recentNotices = useMemo<OutboxNotice[]>(
    () => outbox.data?.pages[0]?.rows.slice(0, RECENT_NOTICE_LIMIT) ?? [],
    [outbox.data],
  );

  const conversationList = useConversations(institutionId);
  const recentConversations = useMemo<ConversationListRow[]>(
    () => conversationList.conversations.slice(0, RECENT_MESSAGE_LIMIT),
    [conversationList.conversations],
  );
  // Names only for the five rows on screen, not the whole list.
  const names = useParticipantNames(recentConversations, userId);

  const upcomingPtms = useQuery({
    queryKey: ["communication-overview", "upcoming-ptms", institutionId],
    queryFn: async (): Promise<UpcomingPtm[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("ptm_schedules")
        .select("id, title, scheduled_date, start_time, end_time, status, class:classes(name, section)")
        .eq("institution_id", institutionId)
        .gte("scheduled_date", today)
        // Only live meetings: older rows can carry a stored 'completed'.
        .eq("status", "scheduled")
        .order("scheduled_date", { ascending: true })
        .order("start_time", { ascending: true })
        // A few spare rows, because today's meetings that already ended are
        // dropped below; the panel still shows at most UPCOMING_PTM_LIMIT.
        .limit(UPCOMING_PTM_LIMIT + 5);
      if (error) throw error;
      return ((data ?? []) as UpcomingPtm[])
        .filter((p) => ptmEffectiveStatus(p) !== "completed")
        .slice(0, UPCOMING_PTM_LIMIT);
    },
    enabled: !!institutionId && ptmEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (overview.isLoading) {
    return <OverviewSkeleton />;
  }

  // Error before empty: a failed RPC must never read as "no activity".
  if (overview.isError || !overview.data) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        title="Couldn't load communication activity"
        description="Something went wrong reaching the server. Try again in a moment."
        reason="error"
        action={{ label: "Retry", onClick: () => overview.refetch() }}
      />
    );
  }

  const d = overview.data;
  const nothingYet =
    d.total_notices === 0 && d.total_conversations === 0 && (!ptmEnabled || d.total_ptms === 0);

  if (nothingYet) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-7 w-7" />}
        title="No communication activity yet"
        description="Once notices are issued, messages are sent or PTM sessions are scheduled, they show up here."
        reason="noData"
        action={canOpen("notices") ? { label: "Open Notice Board", onClick: () => open("notices") } : undefined}
      />
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="px-1">
        <p className="eyebrow">Right now</p>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-600">
          The newest notices, message threads and meetings across your school.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-start">
        <Panel
          id="comm-notices"
          icon={<Megaphone className="h-[18px] w-[18px]" aria-hidden />}
          tone="teal"
          title="Latest notices"
          subtitle="How many of those addressed have opened each one."
          action={canOpen("notices") ? { label: "See all", onClick: () => open("notices") } : undefined}
        >
          <RecentNoticeReach
            rows={recentNotices}
            isLoading={outbox.isLoading}
            isError={outbox.isError}
            onRetry={() => outbox.refetch()}
            onOpenNoticeBoard={canOpen("notices") ? () => open("notices") : undefined}
          />
        </Panel>

        <Panel
          id="comm-messages"
          icon={<MessageSquare className="h-[18px] w-[18px]" aria-hidden />}
          tone="violet"
          title="Latest messages"
          subtitle="Newest threads first. A dot marks a new reply."
          action={canOpen("messages") ? { label: "Open" , onClick: () => open("messages") } : undefined}
        >
          <RecentConversations
            rows={recentConversations}
            names={names.data ?? {}}
            userId={userId}
            isLoading={conversationList.isLoading}
            isError={conversationList.isError}
            onRetry={() => conversationList.refetch()}
          />
        </Panel>

        {ptmEnabled && (
          <Panel
            id="comm-ptm"
            icon={<CalendarCheck className="h-[18px] w-[18px]" aria-hidden />}
            tone="peach"
            title="Upcoming meetings"
            subtitle="Parent-teacher meetings from today onwards."
            action={canOpen("ptm") ? { label: "See all", onClick: () => open("ptm") } : undefined}
            className="lg:col-span-2"
          >
            <UpcomingMeetings
              rows={upcomingPtms.data ?? []}
              isLoading={upcomingPtms.isLoading}
              isError={upcomingPtms.isError}
              onRetry={() => upcomingPtms.refetch()}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

const PANEL_TONE = {
  teal: "bg-brand-primary/10 text-brand-primary",
  violet: "bg-brand-secondary/10 text-brand-secondary",
  peach: "bg-brand-accent/10 text-brand-accent",
} as const;

function Panel({
  id,
  icon,
  tone,
  title,
  subtitle,
  action,
  className,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  tone: keyof typeof PANEL_TONE;
  title: string;
  subtitle: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      // min-w-0: a grid item's minimum is its content's minimum width, so one
      // long unbroken row widened every panel past a phone screen and the
      // subtitles, empty-state copy and "See all" buttons were cut at the
      // right edge (2026-09-18 phone test). Letting the item shrink keeps the
      // single column at the viewport and the truncation inside it works.
      className={cn("surface-card frosted-shadow rounded-card min-w-0 overflow-hidden p-5 sm:p-6", className)}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              PANEL_TONE[tone],
            )}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 id={`${id}-heading`} className="text-[17px] leading-6 font-semibold text-ink-900">
              {title}
            </h3>
            <p className="mt-0.5 truncate text-[13px] leading-[18px] text-ink-500">{subtitle}</p>
          </div>
        </div>
        {action && (
          <Button
            variant="ghost"
            size="sm"
            onClick={action.onClick}
            className="-mr-2 -mt-1 shrink-0 gap-1 rounded-full px-3 text-[13px] font-medium text-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </header>
      <div className="mt-5 border-t border-surface-stroke">{children}</div>
    </section>
  );
}

function PanelError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
        <p className="text-sm text-ink-700">{text}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0 rounded-full">
        Retry
      </Button>
    </div>
  );
}

function PanelSkeleton({ rows = 3, bar = false }: { rows?: number; bar?: boolean }) {
  return (
    <ul className="divide-y divide-surface-stroke" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 py-3.5">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-ink-400/15" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-ink-400/15" />
            {bar ? (
              <span className="block h-1.5 w-full animate-pulse rounded-full bg-ink-400/10" />
            ) : (
              <span className="block h-3 w-5/6 animate-pulse rounded bg-ink-400/10" />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PanelEmpty({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: { label: string; icon?: React.ReactNode; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-400/10 text-ink-500">
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="max-w-xs text-[13px] leading-[18px] text-ink-600">{text}</p>
      {action && (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          className="mt-1 gap-1.5 rounded-full"
        >
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  );
}

function RecentNoticeReach({
  rows,
  isLoading,
  isError,
  onRetry,
  onOpenNoticeBoard,
}: {
  rows: OutboxNotice[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenNoticeBoard?: () => void;
}) {
  // Error before empty, inside the card: a failed outbox must not read as
  // "you have issued nothing".
  if (isError) return <PanelError text="Couldn't load recent notices." onRetry={onRetry} />;
  if (isLoading) return <PanelSkeleton bar />;
  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={<Inbox className="h-5 w-5" aria-hidden />}
        title="No notices issued yet"
        text="Reach for each notice you publish shows up here."
        action={
          onOpenNoticeBoard
            ? {
                label: "Issue a notice",
                icon: <Send className="h-3.5 w-3.5" aria-hidden />,
                onClick: onOpenNoticeBoard,
              }
            : undefined
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-surface-stroke">
      {rows.map((n) => (
        <li key={n.id} className="flex items-start gap-3.5 py-3.5 last:pb-0">
          <NoticeTypeDisc type={n.type} size="sm" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[14px] leading-5 font-semibold text-ink-900">
                {n.title}
              </p>
              <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-500">
                {formatNoticeDate(n.published_at)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] leading-[18px] text-ink-500">
              {n.target_summary ?? "Whole school"}
              {n.publisher_name ? ` · ${n.publisher_name}` : ""}
            </p>
            <ReachBar
              className="mt-2.5"
              read={n.read_count}
              total={n.recipient_count}
              acknowledged={n.ack_count}
              requiresAcknowledgement={n.requires_acknowledgement}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecentConversations({
  rows,
  names,
  userId,
  isLoading,
  isError,
  onRetry,
}: {
  rows: ConversationListRow[];
  names: Record<string, string>;
  userId: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) return <PanelError text="Couldn't load recent messages." onRetry={onRetry} />;
  if (isLoading) return <PanelSkeleton />;
  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={<MessageSquare className="h-5 w-5" aria-hidden />}
        title="No messages yet"
        text="Threads between teachers, students and staff appear here as they start."
      />
    );
  }

  return (
    <ul className="divide-y divide-surface-stroke">
      {rows.map((c) => {
        const unread = isConversationUnread(c, userId);
        const last = c.conversation_messages[0];
        const title = conversationTitle(c, names, userId);
        const isClass = c.type !== "direct";
        return (
          <li key={c.id} className="flex items-start gap-3.5 py-3.5 last:pb-0">
            <span
              aria-hidden
              className={cn(
                "relative mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                isClass
                  ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  : "bg-brand-secondary/10 text-brand-secondary",
              )}
            >
              {isClass ? <Megaphone className="h-4 w-4" /> : initialsOf(title)}
              {unread && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-primary ring-2 ring-[hsl(var(--surface-card))]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={cn(
                    "min-w-0 truncate text-[14px] leading-5 text-ink-900",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {title}
                </p>
                <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-500">
                  {formatNoticeDate(last?.created_at ?? c.updated_at)}
                </span>
              </div>
              <p
                className={cn(
                  "mt-0.5 truncate text-[13px] leading-[18px]",
                  unread ? "text-ink-700" : "text-ink-500",
                )}
              >
                {last?.content?.trim() || (isClass ? "Class thread" : "No messages yet")}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const PTM_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
};

function formatPtmWhen(p: UpcomingPtm): { day: string; time: string } {
  const start = new Date(`${p.scheduled_date}T${p.start_time}`);
  const end = new Date(`${p.scheduled_date}T${p.end_time}`);
  if (Number.isNaN(start.getTime())) return { day: p.scheduled_date, time: "" };
  const from = format(start, "h:mm a");
  const to = Number.isNaN(end.getTime()) ? "" : ` to ${format(end, "h:mm a")}`;
  return { day: format(start, "EEE, d MMM"), time: `${from}${to}` };
}

function UpcomingMeetings({
  rows,
  isLoading,
  isError,
  onRetry,
}: {
  rows: UpcomingPtm[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) return <PanelError text="Couldn't load upcoming meetings." onRetry={onRetry} />;
  if (isLoading) return <PanelSkeleton rows={2} />;
  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={<CalendarCheck className="h-5 w-5" aria-hidden />}
        title="Nothing scheduled"
        text="No parent-teacher meetings are coming up. New sessions appear here once scheduled."
      />
    );
  }

  return (
    <ul className="grid gap-3 pt-4 sm:grid-cols-3">
      {rows.map((p) => {
        const cls = p.class
          ? `${p.class.name}${p.class.section ? `-${p.class.section}` : ""}`
          : "Whole school";
        const when = formatPtmWhen(p);
        return (
          <li
            key={p.id}
            className="flex items-start gap-3 rounded-2xl border border-surface-stroke px-4 py-3.5"
          >
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent">
              <CalendarDays className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] leading-5 font-semibold text-ink-900">{p.title}</p>
              <p className="mt-0.5 text-[13px] leading-[18px] text-ink-700">
                {when.day}
                {when.time ? ` · ${when.time}` : ""}
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-4 text-ink-500">
                {cls}
                {p.status !== "scheduled" && PTM_STATUS_LABEL[p.status]
                  ? ` · ${PTM_STATUS_LABEL[p.status]}`
                  : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading communication overview">
      <div className="px-1 space-y-2">
        <span className="block h-3 w-16 animate-pulse rounded bg-ink-400/15" />
        <span className="block h-3.5 w-64 max-w-full animate-pulse rounded bg-ink-400/10" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="surface-card frosted-shadow rounded-card h-72 animate-pulse" />
        <div className="surface-card frosted-shadow rounded-card h-72 animate-pulse" />
        <div className="surface-card frosted-shadow rounded-card h-36 animate-pulse lg:col-span-2" />
      </div>
    </div>
  );
}
