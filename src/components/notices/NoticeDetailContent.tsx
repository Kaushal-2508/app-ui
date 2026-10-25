import { CheckCircle2, ClipboardCheck, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNoticeBody, type InboxNotice } from "@/hooks/notices";

import { NoticeAttachmentList } from "./NoticeAttachmentList";
import { NoticeChip, NoticeMetaChip } from "./NoticeBits";
import { NoticeReachPanel } from "./NoticeReachPanel";
import { expiryMeta, noticePriorityMeta, noticeScopeMeta, noticeTypeMeta } from "./noticeMeta";

interface NoticeDetailContentProps {
  notice: InboxNotice;
  /** The container is on screen; gates attachment signing. */
  active: boolean;
  /** Render the reach panel. The RPC gates on oversight anyway, so this is a
   *  rendering hint, not the access control. */
  canOversee: boolean;
  /** Acknowledge affordance. When omitted the container renders its own
   *  (the sheet puts it in the sticky footer). */
  acknowledge?: { onClick: () => void; pending: boolean };
}

/**
 * The body of one notice: chips, message, attachments, validity, reach.
 * Container-agnostic so the mobile sheet and the desktop pane show the same
 * thing.
 */
export function NoticeDetailContent({
  notice,
  active,
  canOversee,
  acknowledge,
}: NoticeDetailContentProps) {
  const priority = noticePriorityMeta(notice.priority);
  const PriorityIcon = priority?.icon;
  const type = noticeTypeMeta(notice.type);
  const scope = noticeScopeMeta(notice.scope);
  const ScopeIcon = scope.icon;
  const expiry = expiryMeta(notice.expires_at);
  const needsAck = notice.requires_acknowledgement && !notice.acknowledged_at;

  // An issued row arrives from notice_outbox without its message or its files,
  // so the pane used to tell the author their own notice was "not included in
  // this view". Fetch the missing half for the one notice they opened. An
  // inbox row already carries both, so this stays idle for a recipient.
  const bodyMissing = active && !notice.content;
  const body = useNoticeBody(notice.id, bodyMissing);
  const content = notice.content || body.data?.content || "";
  const attachments = notice.attachments.length
    ? notice.attachments
    : (body.data?.attachments ?? []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {priority && (
          <NoticeChip tone={priority.tone} icon={PriorityIcon ? <PriorityIcon /> : undefined}>
            {priority.label}
          </NoticeChip>
        )}
        <NoticeMetaChip>{type.label}</NoticeMetaChip>
        <NoticeMetaChip icon={<ScopeIcon />}>{scope.label}</NoticeMetaChip>
        {expiry && (
          <NoticeMetaChip
            icon={<Clock />}
            className={expiry.soon ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : undefined}
          >
            {expiry.label}
          </NoticeMetaChip>
        )}
        {notice.acknowledged_at && (
          <NoticeChip tone="mint" icon={<CheckCircle2 />}>
            Acknowledged
          </NoticeChip>
        )}
      </div>

      {needsAck && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink-900">Acknowledgement requested</p>
              <p className="text-[13px] leading-[18px] text-ink-600">
                The sender wants to know you have read this notice.
              </p>
            </div>
          </div>
          {acknowledge && (
            <Button
              size="sm"
              onClick={acknowledge.onClick}
              disabled={acknowledge.pending}
              className="shrink-0 bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              {acknowledge.pending ? "Saving…" : "I have read this"}
            </Button>
          )}
        </div>
      )}

      {content ? (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[24px] text-ink-700">
          {content}
        </p>
      ) : bodyMissing && body.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the message">
          <span className="block h-4 w-full animate-pulse rounded bg-ink-400/10" />
          <span className="block h-4 w-4/5 animate-pulse rounded bg-ink-400/10" />
        </div>
      ) : bodyMissing && body.isError ? (
        // Error state before the empty state: a failed read must never read as
        // "this notice has no message" (CLAUDE.md section 6).
        <p className="text-sm text-ink-600">
          Couldn't load the message. Try again in a moment.
        </p>
      ) : (
        <p className="text-sm italic text-ink-500">This notice has no message.</p>
      )}

      <NoticeAttachmentList
        noticeId={notice.id}
        attachments={attachments}
        enabled={active}
      />

      {canOversee && (
        <div className="border-t border-surface-stroke pt-4">
          <NoticeReachPanel
            noticeId={notice.id}
            requiresAcknowledgement={notice.requires_acknowledgement}
          />
        </div>
      )}
    </div>
  );
}
