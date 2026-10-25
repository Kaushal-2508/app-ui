import type { BoardColumnDef } from "@/components/shared/board";
import type { ReportedIssue } from "@/hooks/useReportedIssues";
import type { SupportTicket, SupportTicketStatus } from "@/hooks/useSupportTickets";
import type { EscalationMark } from "@/lib/supportEscalation";
import { supportInboxComparator } from "@/lib/supportSop";

/**
 * Board vocabulary shared by the reporter's /support and SALCI's /admin/issues.
 * Four columns, one per value the CHECK constraint on reported_issues.status
 * allows. There is no transition matrix on the server: `_support_apply_status`
 * accepts any of the four from a super admin and nothing from anyone else.
 */
export const SUPPORT_BOARD_COLUMNS: BoardColumnDef<SupportTicketStatus>[] = [
  { id: "open", label: "Open", status: "open" },
  { id: "in_progress", label: "In Progress", status: "in_progress" },
  { id: "resolved", label: "Resolved", status: "resolved" },
  { id: "closed", label: "Closed", status: "closed" },
];

/**
 * One card's worth of a ticket, whichever side it was read from. The reporter
 * RPC and the SALCI inbox rows carry different columns; this is the overlap
 * the card needs, so the board has a single card component.
 */
export interface SupportBoardTicket {
  id: string;
  subject: string;
  status: SupportTicketStatus;
  category: string | null;
  /** reported_issues.priority: 1 Low, 2 Medium, 3 High (the reporter's urgency). */
  priority: number | null;
  reporter_name: string | null;
  institution_name: string | null;
  /** Snapshot of the reporter's role, the SOP's tie-break. Null on the reporter side. */
  reporter_role: string | null;
  created_at: string;
  last_message_at: string | null;
  message_count: number | null;
  /** Something the viewer has not seen yet: a SALCI reply, or a reporter reply. */
  attention: boolean;
  /** SOP fields (NEEDS DB); undefined until the columns exist. SALCI side only. */
  triage_priority?: string | null;
  escalated_to_name?: string | null;
  /** Who is working on it, read from the internal mark. SALCI side only. */
  escalation?: EscalationMark | null;
}

export function boardTicketFromMine(t: SupportTicket): SupportBoardTicket {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    category: t.category,
    priority: t.priority,
    reporter_name: t.reporter_name,
    institution_name: t.institution_name,
    reporter_role: t.reporter_role,
    created_at: t.created_at,
    last_message_at: t.last_message_at,
    message_count: t.message_count,
    attention: t.has_unread,
  };
}

const KNOWN_STATUSES: readonly SupportTicketStatus[] = ["open", "in_progress", "resolved", "closed"];

export function boardTicketFromIssue(
  issue: ReportedIssue,
  awaitsSalci: boolean,
  escalation: EscalationMark | null = null,
): SupportBoardTicket | null {
  if (!(KNOWN_STATUSES as readonly string[]).includes(issue.status)) return null;
  return {
    id: issue.id,
    subject: issue.subject,
    status: issue.status as SupportTicketStatus,
    category: issue.category,
    priority: issue.priority,
    reporter_name: issue.reporter_name,
    institution_name: issue.institution_name,
    reporter_role: issue.reporter_role,
    created_at: issue.created_at,
    last_message_at: issue.last_message_at,
    message_count: null,
    attention: awaitsSalci,
    triage_priority: issue.triage_priority,
    escalated_to_name: issue.escalated_to_name,
    escalation,
  };
}

export type SupportBoardSortKey = "sop" | "activity" | "newest" | "urgency";

export const SUPPORT_BOARD_SORT_KEYS: readonly SupportBoardSortKey[] = [
  "sop",
  "activity",
  "newest",
  "urgency",
];

export const SUPPORT_BOARD_SORTS: { value: SupportBoardSortKey; label: string }[] = [
  { value: "sop", label: "Support SOP order" },
  { value: "activity", label: "Latest activity first" },
  { value: "newest", label: "Newest first" },
  { value: "urgency", label: "Highest urgency first" },
];

export const SUPPORT_BOARD_SORT_STORAGE_KEY = "salci.support.board-sort";
export const SUPPORT_VIEW_STORAGE_KEY = "salci.support.view";
export const ADMIN_ISSUES_VIEW_STORAGE_KEY = "salci.admin-issues.view";

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
const byId = (a: SupportBoardTicket, b: SupportBoardTicket) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function supportTicketComparator(
  key: SupportBoardSortKey,
  now: Date = new Date(),
): (a: SupportBoardTicket, b: SupportBoardTicket) => number {
  // The Ticket Resolution SOP's order: overdue on the working-hours clock
  // first, then SALCI priority, then the reporter's role, then oldest first.
  if (key === "sop") return supportInboxComparator<SupportBoardTicket>(now);
  if (key === "urgency") {
    return (a, b) => {
      const diff = (b.priority ?? 2) - (a.priority ?? 2);
      if (diff !== 0) return diff;
      const activity = time(b.last_message_at ?? b.created_at) - time(a.last_message_at ?? a.created_at);
      return activity !== 0 ? activity : byId(a, b);
    };
  }
  if (key === "newest") {
    return (a, b) => {
      const diff = time(b.created_at) - time(a.created_at);
      return diff !== 0 ? diff : byId(a, b);
    };
  }
  return (a, b) => {
    const diff = time(b.last_message_at ?? b.created_at) - time(a.last_message_at ?? a.created_at);
    return diff !== 0 ? diff : byId(a, b);
  };
}
