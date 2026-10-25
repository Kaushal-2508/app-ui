import { useEffect, useRef } from "react";

import { useMarkNoticeRead, type InboxNotice } from "@/hooks/notices";

/**
 * Stamps the recipient's read exactly once per opening of a notice.
 *
 * Shared by the mobile sheet and the desktop pane so the two containers cannot
 * drift. Without the ref, every re-render while the notice is on screen fires
 * another mutation; the RPC is idempotent so nothing would corrupt, but it
 * would be a request per render.
 */
export function useStampNoticeRead(notice: InboxNotice | null, active: boolean) {
  const markRead = useMarkNoticeRead();
  // `mutate` is referentially stable in TanStack Query v5; the mutation OBJECT
  // is not, so depend on the function rather than suppressing the deps rule.
  const mutate = markRead.mutate;
  // Primitives, not the notice object: a refetch hands back a new object for the
  // same notice, and the effect must not re-run on identity alone.
  const noticeId = notice?.id ?? null;
  const readAt = notice?.read_at ?? null;
  const stampedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !noticeId) return;
    if (readAt) return;
    if (stampedFor.current === noticeId) return;
    stampedFor.current = noticeId;
    mutate({ noticeId });
  }, [active, noticeId, readAt, mutate]);

  useEffect(() => {
    if (!active) stampedFor.current = null;
  }, [active]);

  return markRead;
}
