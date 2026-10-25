import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  BarChart3,
  Bell,
  BellOff,
  BellRing,
  BookCheck,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  Loader2,
  Megaphone,
  MessageCircle,
  NotebookPen,
  Receipt,
  RefreshCw,
  Send,
  ShieldAlert,
  Siren,
  Star,
  Trophy,
  UserCheck,
  XCircle,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import type { Notification } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

type TypeVisual = { icon: LucideIcon; tone: Tone };

/**
 * Icon + tone per notification type. Every `type` value written by the
 * database triggers, the edge functions and the client hooks is listed;
 * anything new falls back to the plain bell so it still renders cleanly.
 */
const TYPE_VISUALS: Record<string, TypeVisual> = {
  task_assigned: { icon: ClipboardList, tone: "teal" },
  task_overdue: { icon: AlertCircle, tone: "rose" },
  task_reminder: { icon: Clock, tone: "peach" },
  task_escalation: { icon: AlertTriangle, tone: "peach" },
  task_submitted: { icon: Send, tone: "sky" },
  task_approved: { icon: CheckCircle2, tone: "mint" },
  task_rejected: { icon: XCircle, tone: "rose" },
  task_status_changed: { icon: RefreshCw, tone: "sky" },
  task_cancelled: { icon: Ban, tone: "rose" },
  // Support SOP (2026-09-18): written by escalate_support_ticket and the
  // escalation task trigger once Tushar lands them; listed now so the first
  // one rendered is not a bare bell.
  support_escalated: { icon: AlertTriangle, tone: "peach" },
  support_escalation_update: { icon: Send, tone: "sky" },
  badge_earned: { icon: Trophy, tone: "peach" },
  exam_published: { icon: FileText, tone: "teal" },
  exam_reminder: { icon: BellRing, tone: "peach" },
  exam_evaluated: { icon: ClipboardCheck, tone: "mint" },
  results_available: { icon: BarChart3, tone: "violet" },
  marks_published: { icon: BarChart3, tone: "violet" },
  proctoring_alert: { icon: ShieldAlert, tone: "rose" },
  notice_published: { icon: Megaphone, tone: "teal" },
  notice_urgent: { icon: Siren, tone: "rose" },
  message: { icon: MessageCircle, tone: "sky" },
  diary_homework: { icon: BookOpen, tone: "teal" },
  diary_remark: { icon: AlertTriangle, tone: "peach" },
  diary_reminder: { icon: Clock, tone: "peach" },
  diary_appreciation: { icon: Star, tone: "peach" },
  diary_note: { icon: NotebookPen, tone: "violet" },
  homework_visible: { icon: BookOpen, tone: "teal" },
  homework_due_24h: { icon: CalendarClock, tone: "peach" },
  homework_closed: { icon: BookCheck, tone: "mint" },
  ptm_scheduled: { icon: CalendarClock, tone: "teal" },
  ptm_rescheduled: { icon: RefreshCw, tone: "peach" },
  ptm_cancelled: { icon: CalendarX, tone: "rose" },
  ptm_slot_booked: { icon: CalendarCheck, tone: "sky" },
  ptm_reminder: { icon: BellRing, tone: "peach" },
  // Online (residential) PTMs, 2026-10-03.
  ptm_online_invited: { icon: CalendarClock, tone: "sky" },
  ptm_online_assigned: { icon: UserCheck, tone: "sky" },
  ptm_online_unassigned: { icon: CalendarX, tone: "peach" },
  ptm_online_uninvited: { icon: CalendarX, tone: "peach" },
  ptm_booking_confirmed: { icon: CalendarCheck, tone: "mint" },
  ptm_booking_cancelled: { icon: CalendarX, tone: "rose" },
  ptm_slot_cancelled: { icon: CalendarX, tone: "peach" },
  ptm_teacher_swapped: { icon: RefreshCw, tone: "peach" },
  ptm_reminder_15m: { icon: BellRing, tone: "peach" },
  attendance: { icon: CalendarX, tone: "rose" },
  tt_marked_absent: { icon: CalendarX, tone: "rose" },
  tt_substitute_assigned: { icon: UserCheck, tone: "sky" },
  tt_lesson_pending_review: { icon: ClipboardList, tone: "peach" },
  leave_decision: { icon: CalendarCheck, tone: "mint" },
  fee_reminder: { icon: Receipt, tone: "peach" },
  study_material: { icon: FolderOpen, tone: "violet" },
  general: { icon: Bell, tone: "teal" },
};

const FALLBACK_VISUAL: TypeVisual = { icon: Bell, tone: "teal" };

/** "Just now" under a minute, then the strict distance ("3 minutes ago"). */
function formatWhen(createdAt: string | null): string {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  if (Date.now() - date.getTime() < 60_000) return "Just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function NotificationRow({
  notification,
  onSelect,
}: {
  notification: Notification;
  onSelect: (n: Notification) => void;
}) {
  const visual = TYPE_VISUALS[notification.type] ?? FALLBACK_VISUAL;
  const tone = TONES[visual.tone];
  const Icon = visual.icon;
  const unread = !notification.is_read;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${unread ? "Unread: " : ""}${notification.title}`}
      onClick={() => onSelect(notification)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(notification);
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary/40",
        unread ? "bg-brand-primary/[0.06] hover:bg-brand-primary/[0.1]" : "hover:bg-ink-900/[0.04]",
      )}
    >
      <span
        className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone.bg, tone.fg)}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-5 line-clamp-2",
            unread ? "font-semibold text-ink-900" : "font-medium text-ink-700",
          )}
        >
          {notification.title}
        </p>
        {notification.message && (
          <p className="mt-0.5 text-xs leading-4 text-ink-600 line-clamp-2">{notification.message}</p>
        )}
        <p className="mt-1 text-[11px] leading-4 text-ink-500">{formatWhen(notification.created_at)}</p>
      </div>

      {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-primary" aria-hidden="true" />}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2 pt-0.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-2.5 w-1/4" />
      </div>
    </div>
  );
}

export interface NotificationPanelProps {
  rows: Notification[];
  isLoading: boolean;
  isError: boolean;
  /** True while a bigger page is loading behind "Show older". */
  isFetching: boolean;
  unreadCount: number;
  canShowOlder: boolean;
  markAllPending: boolean;
  onSelect: (n: Notification) => void;
  onMarkAllRead: () => void;
  onShowOlder: () => void;
  onRetry: () => void;
}

/**
 * The bell's popover body: header with unread count + "Mark all read", the
 * list (loading, error, empty, rows), and the "Show older" footer. Pure UI,
 * no data access, so it renders anywhere a `Popover` root is mounted.
 */
export function NotificationPanel({
  rows,
  isLoading,
  isError,
  isFetching,
  unreadCount,
  canShowOlder,
  markAllPending,
  onSelect,
  onMarkAllRead,
  onShowOlder,
  onRetry,
}: NotificationPanelProps) {
  return (
    <PopoverContent
      align="end"
      sideOffset={8}
      collisionPadding={8}
      className="w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-card border-surface-stroke bg-surface-card p-0 shadow-card-lg"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-5 text-ink-900">Notifications</h3>
          <p className="text-xs leading-4 text-ink-500">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs text-brand-primary hover:bg-brand-primary/10 hover:text-brand-primary"
            onClick={onMarkAllRead}
            disabled={markAllPending}
          >
            {markAllPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
            )}
            Mark all read
          </Button>
        )}
      </div>
      <Separator className="bg-surface-stroke" />

      {/* Radix ScrollArea only scrolls when its viewport is height-bound, so
          the max-height is applied to both the root and the viewport. */}
      <ScrollArea className="max-h-[min(24rem,60vh)] [&>[data-radix-scroll-area-viewport]]:max-h-[min(24rem,60vh)]">
        {isLoading ? (
          <div className="divide-y divide-surface-stroke">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : isError ? (
          <EmptyState
            size="sm"
            tone="rose"
            reason="error"
            icon={<AlertCircle className="h-5 w-5" />}
            title="Couldn't load notifications"
            description="Check your connection and try again."
            action={{ label: "Retry", onClick: onRetry }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            reason="noData"
            icon={<BellOff className="h-5 w-5" />}
            title="No notifications yet"
            description="Homework, notices, results and messages will show up here."
          />
        ) : (
          <div className="divide-y divide-surface-stroke">
            {rows.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} onSelect={onSelect} />
            ))}
          </div>
        )}
      </ScrollArea>

      {canShowOlder && (
        <>
          <Separator className="bg-surface-stroke" />
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-ink-700"
              disabled={isFetching}
              onClick={onShowOlder}
            >
              {isFetching && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Show older
            </Button>
          </div>
        </>
      )}
    </PopoverContent>
  );
}
