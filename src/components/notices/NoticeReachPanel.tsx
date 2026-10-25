import { useState } from "react";
import { CheckCircle2, Eye, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { FilterChip, FilterRow } from "@/components/shared/nav";
import {
  useNoticeReach,
  useNoticeRecipients,
  type RecipientStatusFilter,
} from "@/hooks/notices";

import { NoticeChip, ReachBar } from "./NoticeBits";

interface NoticeReachPanelProps {
  noticeId: string;
  requiresAcknowledgement: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  coordinator: "Coordinators",
  teacher: "Teachers",
  student: "Students",
};

const ROLE_TONE = {
  coordinator: "violet",
  teacher: "teal",
  student: "sky",
} as const;

const FILTERS: { value: RecipientStatusFilter; label: string }[] = [
  { value: "unread", label: "Not yet read" },
  { value: "read", label: "Read" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "all", label: "Everyone" },
];

/**
 * Reach for one notice, for the author and anyone above them.
 *
 * Renders nothing when `notice_reach` comes back empty: the RPC gates on
 * notice_can_oversee(), so a plain recipient gets no rows. Showing an empty
 * panel to them would advertise a report they are not entitled to.
 */
export function NoticeReachPanel({
  noticeId,
  requiresAcknowledgement,
}: NoticeReachPanelProps) {
  const [status, setStatus] = useState<RecipientStatusFilter>("unread");
  const reach = useNoticeReach(noticeId);
  const recipients = useNoticeRecipients(noticeId, status);

  if (reach.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  // Error state BEFORE empty state, so a failed RPC never reads as "no data"
  // (CLAUDE.md section 6).
  if (reach.isError) {
    return (
      <p className="py-4 text-sm text-ink-600">
        Couldn't load who has seen this notice. Try again in a moment.
      </p>
    );
  }

  const rows = reach.data ?? [];
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const read = rows.reduce((sum, r) => sum + r.read_count, 0);
  const acked = rows.reduce((sum, r) => sum + r.ack_count, 0);

  const recipientRows = recipients.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Who has seen this</h3>
        <ReachBar
          read={read}
          total={total}
          acknowledged={acked}
          requiresAcknowledgement={requiresAcknowledgement}
        />
      </div>

      <StatTileGrid>
        {rows.map((r) => (
          <StatTile
            key={r.recipient_role}
            label={ROLE_LABEL[r.recipient_role] ?? r.recipient_role}
            value={`${r.read_count}/${r.total}`}
            icon={<Eye className="h-4 w-4" />}
            tone={
              ROLE_TONE[r.recipient_role as keyof typeof ROLE_TONE] ?? "teal"
            }
          />
        ))}
      </StatTileGrid>

      <div className="space-y-3">
        <FilterRow>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={status === f.value}
              onClick={() => setStatus(f.value)}
            />
          ))}
        </FilterRow>

        {recipients.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
          </div>
        ) : recipients.isError ? (
          <p className="py-2 text-sm text-ink-600">
            Couldn't load this list. Try again in a moment.
          </p>
        ) : recipientRows.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-ink-500">
            <Users className="h-4 w-4" />
            {status === "unread"
              ? "Everyone addressed has read this."
              : "Nobody here yet."}
          </p>
        ) : (
          <ul className="divide-y divide-surface-stroke">
            {recipientRows.map((r) => (
              <li
                key={r.user_id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">
                    {r.full_name ?? "Unnamed"}
                  </p>
                  <p className="text-xs text-ink-500">
                    {ROLE_LABEL[r.recipient_role] ?? r.recipient_role}
                    {r.added_reason === "wing_coordinator_auto" &&
                      " · added automatically"}
                  </p>
                </div>
                {r.acknowledged_at ? (
                  <NoticeChip tone="mint" icon={<CheckCircle2 />}>
                    Acknowledged
                  </NoticeChip>
                ) : r.read_at ? (
                  <NoticeChip tone="teal" icon={<Eye />}>
                    Read
                  </NoticeChip>
                ) : (
                  <span className="shrink-0 text-xs text-ink-500">Not read</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {recipients.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={recipients.isFetchingNextPage}
            onClick={() => recipients.fetchNextPage()}
          >
            {recipients.isFetchingNextPage ? "Loading…" : "Show more"}
          </Button>
        )}
      </div>
    </section>
  );
}
