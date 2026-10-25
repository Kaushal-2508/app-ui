import { MobileSheet } from "@/components/shared/sheets";
import type { InboxNotice } from "@/hooks/notices";

import { NoticeDetailContent } from "./NoticeDetailContent";
import { formatNoticeDateLong, noticeTypeMeta } from "./noticeMeta";
import { useStampNoticeRead } from "./useStampNoticeRead";

interface NoticeDetailProps {
  notice: InboxNotice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show the reach panel. The RPC gates on oversight anyway, so this is a
   *  rendering hint, not the access control. */
  canOversee: boolean;
}

/**
 * The notice detail as a centred sheet: the phone and tablet container.
 * Desktop uses NoticeDetailPane instead; both render NoticeDetailContent.
 */
export function NoticeDetail({
  notice,
  open,
  onOpenChange,
  canOversee,
}: NoticeDetailProps) {
  const markRead = useStampNoticeRead(notice, open);

  if (!notice) return null;

  const TypeIcon = noticeTypeMeta(notice.type).icon;
  const needsAck = notice.requires_acknowledgement && !notice.acknowledged_at;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      placement="center"
      icon={<TypeIcon className="h-4 w-4" />}
      title={notice.title}
      subtitle={
        notice.publisher_name
          ? `${notice.publisher_name} · ${formatNoticeDateLong(notice.published_at)}`
          : formatNoticeDateLong(notice.published_at)
      }
      primaryAction={
        needsAck
          ? {
              label: "I have read this",
              loading: markRead.isPending,
              disabled: markRead.isPending,
              onClick: () =>
                markRead.mutate({ noticeId: notice.id, acknowledge: true }),
            }
          : undefined
      }
    >
      <NoticeDetailContent notice={notice} active={open} canOversee={canOversee} />
    </MobileSheet>
  );
}
