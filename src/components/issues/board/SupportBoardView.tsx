import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, MessageSquare, Minus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KanbanBoard, useStoredPreference } from "@/components/shared/board";
import { EmptyState } from "@/components/shared/surfaces";
import type { SupportTicketStatus } from "@/hooks/useSupportTickets";
import { SUPPORT_URGENCIES } from "@/hooks/useSupportRequest";
import { SUPPORT_PRIORITY_LABEL, UNTRIAGED_LABEL, type SupportPriority } from "@/lib/supportSop";
import { escalationLabel } from "@/lib/supportEscalation";
import {
  SUPPORT_BOARD_COLUMNS,
  SUPPORT_BOARD_SORTS,
  SUPPORT_BOARD_SORT_KEYS,
  SUPPORT_BOARD_SORT_STORAGE_KEY,
  supportTicketComparator,
  type SupportBoardSortKey,
  type SupportBoardTicket,
} from "@/lib/supportBoard";
import { cn } from "@/lib/utils";

function urgencyLabel(priority: number | null): string {
  if (priority === null) return "Medium";
  return SUPPORT_URGENCIES.find((u) => u.value === String(priority))?.label ?? "Medium";
}

function UrgencyIcon({ priority }: { priority: number | null }) {
  const label = `${urgencyLabel(priority)} urgency`;
  if (priority === 3) {
    return <ChevronUp className="h-4 w-4 text-destructive" role="img" aria-label={label} />;
  }
  if (priority === 1) {
    return <ChevronDown className="h-4 w-4 text-muted-foreground" role="img" aria-label={label} />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground" role="img" aria-label={label} />;
}

interface SupportBoardCardProps {
  ticket: SupportBoardTicket;
  isOverlay: boolean;
  /** SALCI sees who raised it and from where; the reporter already knows. */
  showReporter: boolean;
  attentionLabel: string;
}

function SupportBoardCard({ ticket, isOverlay, showReporter, attentionLabel }: SupportBoardCardProps) {
  const lastActivity = ticket.last_message_at ?? ticket.created_at;
  return (
    <Card
      className={cn(
        "space-y-2.5 rounded-xl border-surface-stroke bg-card px-3 py-2.5",
        isOverlay ? "rotate-1 shadow-card-lg" : "shadow-card transition-shadow hover:shadow-card-lg",
      )}
    >
      <p className="flex items-start gap-2 text-sm leading-snug text-ink-900">
        {ticket.attention && (
          <>
            <span
              aria-hidden
              className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand-primary"
            />
            <span className="sr-only">{attentionLabel}</span>
          </>
        )}
        <span className="line-clamp-3">{ticket.subject}</span>
      </p>

      {showReporter && (ticket.reporter_name || ticket.institution_name) && (
        <p className="truncate text-xs text-ink-600">
          {ticket.reporter_name || "Unknown"}
          {ticket.institution_name ? ` · ${ticket.institution_name}` : ""}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
          {/* SOP chips: only rendered when the field is present on the row. */}
          {ticket.triage_priority !== undefined && (ticket.status === "open" || ticket.status === "in_progress") && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[11px]",
                ticket.triage_priority
                  ? "border-ink-700 font-semibold text-ink-900"
                  : "border-dashed border-ink-400 text-ink-600",
              )}
            >
              {ticket.triage_priority ? (SUPPORT_PRIORITY_LABEL[ticket.triage_priority as SupportPriority] ?? ticket.triage_priority) : UNTRIAGED_LABEL}
            </Badge>
          )}
          {ticket.escalation && (
            <Badge
              variant="outline"
              className="h-5 max-w-[180px] truncate border-violet-500/30 bg-violet-500/10 px-1.5 text-[11px] font-medium text-violet-600"
            >
              {escalationLabel(ticket.escalation)}
            </Badge>
          )}
          {ticket.category && (
            <Badge
              variant="outline"
              className="h-5 max-w-[140px] truncate border-surface-stroke px-1.5 text-[11px] font-medium text-ink-600"
            >
              {ticket.category}
            </Badge>
          )}
          {ticket.message_count !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              aria-label={`${ticket.message_count} ${ticket.message_count === 1 ? "message" : "messages"}`}
            >
              <MessageSquare className="h-3 w-3" aria-hidden />
              {ticket.message_count}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-500">
          <UrgencyIcon priority={ticket.priority} />
          <time dateTime={lastActivity}>{format(new Date(lastActivity), "d MMM")}</time>
        </div>
      </div>
    </Card>
  );
}

export interface SupportBoardViewProps {
  tickets: SupportBoardTicket[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  onOpen: (ticketId: string) => void;
  /**
   * False renders a read-only board: cards open the thread but do not drag.
   * The reporter side is always read-only because only SALCI may set status.
   */
  canMove: boolean;
  onMove?: (ticket: SupportBoardTicket, target: SupportTicketStatus) => void;
  showReporter: boolean;
  attentionLabel: string;
  emptyState: ReactNode;
  footnote?: ReactNode;
  /**
   * Desktop only. The page has locked itself to the viewport, so the columns
   * stretch to the bottom of the screen and carry the scroll themselves. Pass
   * it only from a page that actually sets that height (see AdminIssuesPage).
   */
  fillHeight?: boolean;
  /**
   * Sort used until the viewer picks another. SALCI's inbox passes "sop" so
   * the board opens in the Ticket Resolution SOP order; the reporter side
   * keeps latest activity first.
   */
  defaultSort?: SupportBoardSortKey;
}

/** Kanban over support tickets. The page owns fetching and the detail sheet. */
export function SupportBoardView({
  tickets,
  isLoading,
  error,
  onRetry,
  onOpen,
  canMove,
  onMove,
  showReporter,
  attentionLabel,
  emptyState,
  footnote,
  fillHeight = false,
  defaultSort = "activity",
}: SupportBoardViewProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useStoredPreference<SupportBoardSortKey>(
    SUPPORT_BOARD_SORT_STORAGE_KEY,
    SUPPORT_BOARD_SORT_KEYS,
    defaultSort,
  );

  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return tickets;
    return tickets.filter((t) =>
      [t.subject, t.category ?? "", t.reporter_name ?? "", t.institution_name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [tickets, needle]);

  const comparator = useMemo(() => supportTicketComparator(sortBy), [sortBy]);

  return (
    <div className={cn("space-y-3", fillHeight && "md:flex md:min-h-0 md:flex-1 md:flex-col")}>
      <div className={cn("flex flex-wrap items-center gap-2", fillHeight && "md:shrink-0")}>
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search requests"
            aria-label="Search requests"
            className="h-10 pl-9"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SupportBoardSortKey)}>
          <SelectTrigger className="h-10 w-[190px]" aria-label="Sort requests">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_BOARD_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <KanbanBoard<SupportBoardTicket, SupportTicketStatus>
        columns={SUPPORT_BOARD_COLUMNS}
        items={visible}
        getId={(t) => t.id}
        getStatus={(t) => t.status}
        canDrag={() => canMove}
        sortItems={comparator}
        renderCard={(ticket, { isOverlay }) => (
          <SupportBoardCard
            ticket={ticket}
            isOverlay={isOverlay}
            showReporter={showReporter}
            attentionLabel={attentionLabel}
          />
        )}
        onOpen={(ticket) => onOpen(ticket.id)}
        onDrop={(ticket, target) => onMove?.(ticket, target)}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        errorTitle="Couldn't load support requests"
        errorFallback="Something went wrong fetching support requests. Please try again."
        emptyState={
          needle ? (
            <EmptyState
              icon={<Search className="h-7 w-7" />}
              title="No requests match"
              description="Try a different search, or clear it to see every request."
              reason="noResults"
            />
          ) : (
            emptyState
          )
        }
        footnote={footnote}
        fillHeight={fillHeight}
      />
    </div>
  );
}
