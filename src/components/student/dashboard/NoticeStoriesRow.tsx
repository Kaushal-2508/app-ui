import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { BookOpen, CalendarDays, ChevronRight, Megaphone, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileSheet } from "@/components/shared/sheets";
import { TONES } from "@/components/shared/design-system";
import { useMarkNoticeRead, useNoticeInbox, type InboxNotice } from "@/hooks/notices";
import { cn } from "@/lib/utils";

import { ToneChip } from "./toneChip";

const MAX_STORIES = 10;

const TYPE_ICON = {
  event: CalendarDays,
  ptm: Users,
  academic: BookOpen,
  general: Megaphone,
} as const;

/**
 * Notices as a row of story circles, Instagram style: a teal ring while
 * unread, a plain hairline once read. Tapping one opens it in a reading sheet
 * and marks it read; acknowledging stays on the Notice Board, which owns that
 * flow. Reads the same inbox feed the Notice Board does, so nothing new is
 * fetched (server-side relevance, paginated, 60s staleTime).
 */
export function NoticeStoriesRow() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useNoticeInbox();
  const markRead = useMarkNoticeRead();
  const marked = useRef(new Set<string>());
  const [openId, setOpenId] = useState<string | null>(null);

  const notices = useMemo(
    () => (data?.pages[0]?.rows ?? []).slice(0, MAX_STORIES),
    [data],
  );
  const open = notices.find((n) => n.id === openId) ?? null;

  const openNotice = (n: InboxNotice) => {
    setOpenId(n.id);
    // Single-flight per notice: the RPC is idempotent, but a double tap should
    // still not send it twice.
    if (!n.read_at && !marked.current.has(n.id)) {
      marked.current.add(n.id);
      markRead.mutate({ noticeId: n.id });
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-16 shrink-0 rounded-full" />
        ))}
      </div>
    );
  }

  // Error before empty (§6).
  if (isError) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-ink-600">
        <span>Couldn't load notices.</span>
        <Button variant="ghost" size="sm" className="text-brand-primary" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  // Nothing addressed to this student: the row simply isn't there.
  if (notices.length === 0) return null;

  return (
    <section aria-label="Notices">
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
        {notices.map((n) => {
          const Icon = TYPE_ICON[n.type as keyof typeof TYPE_ICON] ?? Megaphone;
          const unread = !n.read_at;
          const urgent = n.priority === "urgent";
          return (
            <Button
              key={n.id}
              variant="ghost"
              onClick={() => openNotice(n)}
              className="h-auto w-[72px] shrink-0 snap-start flex-col gap-1.5 p-0 hover:bg-transparent [&_svg]:size-6"
              aria-label={`${unread ? "Unread notice" : "Notice"}: ${n.title}`}
            >
              <span
                className={cn(
                  "relative flex h-16 w-16 items-center justify-center rounded-full p-[3px] transition-transform duration-150 active:scale-95",
                  unread ? "bg-brand-primary" : "bg-surface-stroke",
                )}
              >
                {/* Opaque card disc under the tint, so the ring colour does not
                    show through the 10% teal wash. */}
                <span className="h-full w-full rounded-full border-2 border-background bg-surface-card">
                  <span
                    className={cn(
                      "flex h-full w-full items-center justify-center rounded-full",
                      TONES.teal.bg,
                      unread ? TONES.teal.fg : "text-ink-500",
                    )}
                  >
                    <Icon />
                  </span>
                </span>
                {urgent && (
                  <span className="absolute -right-0.5 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-rose-500" />
                )}
              </span>
              <span
                className={cn(
                  "w-full truncate text-center text-[11px] leading-tight",
                  unread ? "font-semibold text-ink-900" : "font-medium text-ink-500",
                )}
              >
                {n.title}
              </span>
            </Button>
          );
        })}

        <Button
          variant="ghost"
          onClick={() => navigate("/school/notices")}
          className="h-auto w-[72px] shrink-0 snap-start flex-col gap-1.5 p-0 hover:bg-transparent [&_svg]:size-6"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-surface-stroke text-ink-500">
            <ChevronRight />
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium leading-tight text-ink-500">
            See all
          </span>
        </Button>
      </div>

      <MobileSheet
        open={!!open}
        onOpenChange={(o) => !o && setOpenId(null)}
        placement="center"
        title={open?.title ?? ""}
        subtitle={
          open
            ? `${open.publisher_name ?? "School"} · ${format(new Date(open.published_at), "d MMM yyyy")}`
            : undefined
        }
        primaryAction={
          open?.requires_acknowledgement && !open.acknowledged_at
            ? { label: "Acknowledge on Notice Board", onClick: () => navigate("/school/notices") }
            : undefined
        }
        secondaryAction={{ label: "Close", onClick: () => setOpenId(null) }}
      >
        {open && (
          <div className="space-y-3">
            {open.priority !== "normal" && (
              <ToneChip tone={open.priority === "urgent" ? "rose" : "peach"}>
                {open.priority === "urgent" ? "Urgent" : "Important"}
              </ToneChip>
            )}
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-700">{open.content}</p>
            {open.attachments.length > 0 && (
              <Button
                variant="link"
                className="h-auto p-0 text-brand-primary"
                onClick={() => navigate("/school/notices")}
              >
                {open.attachments.length === 1 ? "1 attachment" : `${open.attachments.length} attachments`} on the Notice Board
              </Button>
            )}
          </div>
        )}
      </MobileSheet>
    </section>
  );
}
