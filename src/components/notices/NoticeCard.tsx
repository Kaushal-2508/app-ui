import { CheckCircle2, ClipboardCheck, Clock, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import type { InboxNotice, OutboxNotice } from "@/hooks/notices";

import { MetaLine, NoticeChip, NoticeMetaChip, NoticeTypeDisc, ReachBar } from "./NoticeBits";
import {
  expiryMeta,
  formatNoticeDate,
  noticePriorityMeta,
  noticeScopeMeta,
  noticeTypeMeta,
} from "./noticeMeta";

/* One card per notice. Two flavours share the frame:
 *
 *   - InboxNoticeCard: what a recipient sees. Unread rows sit on a teal-tinted
 *     surface with a brand rail and a "New" chip; read rows drop back to the
 *     plain white card with a lighter title. The two must be tellable apart
 *     at a glance in a list of twenty, not only side by side.
 *   - IssuedNoticeCard: what an author or overseer sees. The read-progress
 *     line is the point of this view, so it gets the last row to itself.
 *
 * Anatomy, top to bottom: title with the timestamp on the right, then one
 * grey meta line (who, what kind, where), then the body preview (inbox only),
 * then a chip row that renders ONLY when there is something worth flagging
 * (priority, acknowledgement, files, expiry). The type is never a chip: the
 * tinted disc and the meta line already say it.
 *
 * `selected` is the desktop split-view highlight; on mobile nothing is ever
 * selected because the detail opens as a sheet. */

const CARD_BASE =
  "surface-card frosted-shadow rounded-card relative overflow-hidden text-left transition-[box-shadow,transform] duration-200";
const CARD_INTERACTIVE =
  "cursor-pointer hover:shadow-card-lg active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40";

function PriorityChip({ priority }: { priority: string }) {
  const meta = noticePriorityMeta(priority);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <NoticeChip tone={meta.tone} icon={Icon ? <Icon /> : undefined}>
      {meta.label}
    </NoticeChip>
  );
}

function ExpiryChip({ expiresAt }: { expiresAt: string | null }) {
  const expiry = expiryMeta(expiresAt);
  if (!expiry) return null;
  return (
    <NoticeMetaChip
      icon={<Clock />}
      className={cn(expiry.soon && "border-amber-500/40 text-amber-600 dark:text-amber-400")}
    >
      {expiry.label}
    </NoticeMetaChip>
  );
}

function CardFrame({
  selected,
  onClick,
  accent,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  /** Unread: teal-tinted surface, brand border and a full-height rail. */
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    // min-w-0: the row is a grid item, whose automatic minimum size is
    // min-content. The meta line inside never wraps, so without this a long
    // audience list widens the card past the viewport.
    <li className="min-w-0">
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          CARD_BASE,
          CARD_INTERACTIVE,
          "block w-full px-4 py-4 sm:px-5",
          // Utilities win over the .surface-card component layer, so the
          // tint and border replace the plain white card for unread rows.
          accent && "border-brand-primary/30 bg-brand-primary/[0.06] dark:bg-brand-primary/10",
          selected && "ring-2 ring-brand-primary/50",
        )}
      >
        {accent && (
          <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-brand-primary" />
        )}
        {children}
      </button>
    </li>
  );
}

export function InboxNoticeCard({
  notice,
  selected = false,
  onClick,
}: {
  notice: InboxNotice;
  selected?: boolean;
  onClick: () => void;
}) {
  const unread = !notice.read_at;
  const type = noticeTypeMeta(notice.type);
  const needsAck = notice.requires_acknowledgement && !notice.acknowledged_at;
  const files = notice.attachments.length;
  const hasChips =
    noticePriorityMeta(notice.priority) !== null ||
    needsAck ||
    Boolean(notice.acknowledged_at) ||
    files > 0 ||
    expiryMeta(notice.expires_at) !== null;

  return (
    <CardFrame selected={selected} onClick={onClick} accent={unread}>
      <div className="flex items-start gap-3 sm:gap-4">
        <NoticeTypeDisc type={notice.type} muted={!unread} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={cn(
                "min-w-0 text-[16px] leading-[24px] line-clamp-2 break-words",
                unread ? "font-semibold text-ink-900" : "font-medium text-ink-700",
              )}
            >
              {notice.title}
            </h3>
            <span className="flex shrink-0 items-center gap-2 pt-[3px] text-[12px] leading-[18px] text-ink-500 tabular-nums">
              {unread && (
                <NoticeChip tone="teal" className="font-semibold">
                  New
                </NoticeChip>
              )}
              {formatNoticeDate(notice.published_at)}
            </span>
          </div>

          <MetaLine
            className="mt-0.5"
            parts={[notice.publisher_name ?? "School", type.label]}
          />

          {notice.content && (
            <p
              className={cn(
                "mt-2 text-[14px] leading-[20px] line-clamp-2 break-words",
                unread ? "text-ink-700" : "text-ink-500",
              )}
            >
              {notice.content}
            </p>
          )}

          {hasChips && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <PriorityChip priority={notice.priority} />
              {needsAck ? (
                <NoticeChip tone="peach" icon={<ClipboardCheck />}>
                  Needs your acknowledgement
                </NoticeChip>
              ) : notice.acknowledged_at ? (
                <NoticeChip tone="mint" icon={<CheckCircle2 />}>
                  Acknowledged
                </NoticeChip>
              ) : null}
              {files > 0 && (
                <NoticeMetaChip icon={<Paperclip />}>
                  {files} {files === 1 ? "attachment" : "attachments"}
                </NoticeMetaChip>
              )}
              <ExpiryChip expiresAt={notice.expires_at} />
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}

export function IssuedNoticeCard({
  notice,
  selected = false,
  onClick,
}: {
  notice: OutboxNotice;
  selected?: boolean;
  onClick: () => void;
}) {
  const type = noticeTypeMeta(notice.type);
  const scope = noticeScopeMeta(notice.scope);
  const hasChips =
    noticePriorityMeta(notice.priority) !== null ||
    notice.requires_acknowledgement ||
    expiryMeta(notice.expires_at) !== null;

  return (
    <CardFrame selected={selected} onClick={onClick}>
      <div className="flex items-start gap-3 sm:gap-4">
        <NoticeTypeDisc type={notice.type} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-[16px] leading-[24px] font-semibold text-ink-900 line-clamp-2 break-words">
              {notice.title}
            </h3>
            <span className="shrink-0 pt-[3px] text-[12px] leading-[18px] text-ink-500 tabular-nums">
              {formatNoticeDate(notice.published_at)}
            </span>
          </div>

          <MetaLine
            className="mt-0.5"
            parts={[
              notice.target_summary ?? scope.label,
              type.label,
              notice.publisher_name ? `by ${notice.publisher_name}` : null,
            ]}
          />

          {hasChips && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <PriorityChip priority={notice.priority} />
              {notice.requires_acknowledgement && (
                <NoticeChip tone="peach" icon={<ClipboardCheck />}>
                  Acknowledgement required
                </NoticeChip>
              )}
              <ExpiryChip expiresAt={notice.expires_at} />
            </div>
          )}

          <ReachBar
            className="mt-3.5"
            read={notice.read_count}
            total={notice.recipient_count}
            acknowledged={notice.ack_count}
            requiresAcknowledgement={notice.requires_acknowledgement}
          />
        </div>
      </div>
    </CardFrame>
  );
}

/** Placeholder while a page is loading. Mirrors the card geometry so the
 *  list does not jump when data lands. */
export function NoticeCardSkeleton({ issued = false }: { issued?: boolean }) {
  return (
    <li className="surface-card frosted-shadow rounded-card min-w-0 px-4 py-4 sm:px-5" aria-hidden>
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-ink-400/15" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="h-4 w-2/3 animate-pulse rounded bg-ink-400/15" />
            <span className="h-3 w-12 animate-pulse rounded bg-ink-400/15" />
          </div>
          <span className="block h-3 w-1/3 animate-pulse rounded bg-ink-400/10" />
          {issued ? (
            <div className="flex items-center gap-3 pt-1">
              <span className="h-1.5 flex-1 animate-pulse rounded-full bg-ink-400/10" />
              <span className="h-3 w-24 animate-pulse rounded bg-ink-400/10" />
            </div>
          ) : (
            <span className="block h-3 w-11/12 animate-pulse rounded bg-ink-400/10" />
          )}
        </div>
      </div>
    </li>
  );
}
