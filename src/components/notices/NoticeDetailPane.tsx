import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InboxNotice } from "@/hooks/notices";

import { NoticeTypeDisc } from "./NoticeBits";
import { NoticeDetailContent } from "./NoticeDetailContent";
import { formatNoticeDateLong } from "./noticeMeta";
import { useStampNoticeRead } from "./useStampNoticeRead";

interface NoticeDetailPaneProps {
  notice: InboxNotice;
  onClose: () => void;
  canOversee: boolean;
}

/** Gap kept between the pane and the bottom of the window. */
const BOTTOM_GUTTER = 16;

/** Below this the pane is a letterbox, so stop shrinking and let the page
 *  scroll instead. Only reachable on a window under ~450px tall. */
const MIN_HEIGHT = 220;

/**
 * The right-hand column of the desktop split view. NoticeBoard mounts it
 * only at lg+ and only while a notice is selected, so it and the sheet never
 * both stamp a read, and the list keeps the full row when nothing is open.
 */
export function NoticeDetailPane({ notice, onClose, canOversee }: NoticeDetailPaneProps) {
  const markRead = useStampNoticeRead(notice, true);
  const paneRef = useRef<HTMLElement>(null);

  const needsAck = notice.requires_acknowledgement && !notice.acknowledged_at;

  /**
   * Fit the pane to the space actually left below it.
   *
   * The wrapper is sticky, so ONCE the page has scrolled past the page header
   * and the toolbar the pane's top sits at the app-bar offset and a fixed
   * `100dvh - app bar - 2rem` cap is exactly right. Before that it starts
   * wherever the list starts, which on a short window is ~350px down the page,
   * and that same cap ran the pane and its inner scroller straight off the
   * bottom of the screen: the reach panel was there but unreachable, because
   * the scroller whose bar you would drag was itself below the fold (reported
   * 2026-09-22 on a 1158x603 window, where 260px of the pane hung off).
   *
   * Only a live measurement knows the real budget, so measure on scroll and
   * resize, rAF-throttled, writing the style straight onto the node rather
   * than through state so scrolling never re-renders the tree.
   */
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top;
      const room = window.innerHeight - top - BOTTOM_GUTTER;
      el.style.maxHeight = `${Math.max(MIN_HEIGHT, room)}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <aside
      ref={paneRef}
      // The calc is the pre-measurement default and the value the effect
      // converges on once the pane is stuck under the app bar; the effect
      // overwrites it with the live figure on the first frame.
      className="surface-card frosted-shadow rounded-card flex max-h-[calc(100dvh-var(--app-bar-height,61px)-2rem)] flex-col overflow-hidden"
      aria-label="Notice detail"
    >
      <header className="flex items-start gap-4 border-b border-surface-stroke px-6 pb-4 pt-6">
        <NoticeTypeDisc type={notice.type} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[20px] leading-[28px] font-semibold text-ink-900">
            {notice.title}
          </h2>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            {notice.publisher_name ? `${notice.publisher_name} · ` : ""}
            {formatNoticeDateLong(notice.published_at)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close notice"
          className="-mr-2 -mt-1 shrink-0 rounded-full text-ink-500"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <NoticeDetailContent
          notice={notice}
          active
          canOversee={canOversee}
          acknowledge={
            needsAck
              ? {
                  pending: markRead.isPending,
                  onClick: () =>
                    markRead.mutate({ noticeId: notice.id, acknowledge: true }),
                }
              : undefined
          }
        />
      </div>
    </aside>
  );
}
