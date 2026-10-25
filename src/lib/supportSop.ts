import { isPastWorkingHours, workingHoursSince } from "./workingHours";

/**
 * Salci Support Ticket Resolution SOP (September 2026), the parts the
 * frontend can apply on its own: the priority scale, the role tie-break and
 * the inbox order. Design:
 * docs/superpowers/specs/2026-09-18-support-sop-design.md.
 *
 * `triage_priority` is the column Tushar adds for the SOP (NEEDS DB in that
 * spec). Until it exists every row reads as untriaged, so the order degrades
 * to overdue first, then role, then oldest, which is still the SOP's shape.
 */

export type SupportPriority = "p1" | "p2" | "p3" | "enhancement";

export interface SupportPriorityMeta {
  value: SupportPriority;
  label: string;
  /** One line a Support Executive can apply without a meeting. */
  definition: string;
  /** SLA target in working hours; null means no target (enhancements). */
  targetWorkingHours: number | null;
}

export const SUPPORT_PRIORITIES: readonly SupportPriorityMeta[] = [
  {
    value: "p1",
    label: "P1",
    definition: "Blocks a whole school or an exam in progress",
    targetWorkingHours: 4,
  },
  {
    value: "p2",
    label: "P2",
    definition: "Blocks one person's work today",
    targetWorkingHours: 8,
  },
  {
    value: "p3",
    label: "P3",
    definition: "Wrong or confusing, work can continue",
    targetWorkingHours: 24,
  },
  {
    value: "enhancement",
    label: "Enhancement",
    definition: "A request for something new",
    targetWorkingHours: null,
  },
];

export const SUPPORT_PRIORITY_LABEL: Record<SupportPriority, string> = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
  enhancement: "Enhancement",
};

/** Label for an untriaged ticket; it sorts between P1 and P2 so triage is fast. */
export const UNTRIAGED_LABEL = "Needs priority";

export function isSupportPriority(value: unknown): value is SupportPriority {
  return value === "p1" || value === "p2" || value === "p3" || value === "enhancement";
}

/** Sort rank: P1 first, then untriaged, then P2, P3, Enhancement. */
export function priorityRank(value: string | null | undefined): number {
  switch (value) {
    case "p1":
      return 0;
    case "p2":
      return 2;
    case "p3":
      return 3;
    case "enhancement":
      return 4;
    default:
      return 1;
  }
}

/**
 * The tie-break the SOP names: Admin or Principal, then Coordinator, then
 * Teacher, then Student. `reporter_role` is a snapshot string and may carry
 * several comma-joined roles; the best one wins. Unknown roles sort last.
 */
export function roleRank(reporterRole: string | null | undefined): number {
  if (!reporterRole) return 4;
  let best = 4;
  for (const raw of reporterRole.split(/[,\s/]+/)) {
    const token = raw.trim().toLowerCase();
    let rank = 4;
    if (
      token === "super_school_admin" ||
      token === "school_admin" ||
      token === "admin" ||
      token === "principal"
    ) {
      rank = 0;
    } else if (token === "coordinator") rank = 1;
    else if (token === "teacher") rank = 2;
    else if (token === "student") rank = 3;
    if (rank < best) best = rank;
  }
  return best;
}

/**
 * The mirror task's priority for a triage value, in the TASKS convention
 * (1 Low, 2 Medium, 3 High). The support urgency scale runs the other way;
 * never pass one as the other.
 */
export function taskPriorityFor(priority: SupportPriority): 1 | 2 | 3 {
  if (priority === "p1") return 3;
  if (priority === "p2") return 2;
  return 1;
}

/** Working hours a ticket may sit before the SOP calls it overdue. */
export const SOP_OVERDUE_WORKING_HOURS = 24;

/** Working hours without a SALCI message before the daily-update rule bites. */
export const SOP_QUIET_WORKING_HOURS = 8;

/**
 * THERE IS NO CLOSURE-NOTE GATE. Removed 2026-09-22 on Tushar's instruction.
 *
 * It demanded 20+ characters before a ticket could move to resolved or closed,
 * and it blocked a real closure on a live Alliance ticket with the reason
 * invisible: the message only rendered after the box had been focused and
 * blurred, so an untouched field left the primary button dead and silent.
 *
 * The note itself stays on every closure path, optional. `_support_apply_status`
 * has always run `nullif(btrim(coalesce(p_note,'')),'')`, so an empty note is a
 * NULL note server-side; no status change ever depended on one.
 *
 * The gate also carried a word blocklist ("fixed", "done", "ok", ...) that never
 * ran once in production: every entry is shorter than 20 characters, so the
 * length check always fired first. Do not resurrect it. If a quality nudge is
 * wanted again, make it a nudge (placeholder, or a hint after the fact), never a
 * disabled button.

/** Statuses the SOP clock runs on. Resolved and closed tickets never sort as overdue. */
export function isLiveStatus(status: string): boolean {
  return status === "open" || status === "in_progress";
}

/** The columns the SOP order reads; both inbox row shapes satisfy it. */
export interface SopSortable {
  created_at: string;
  status: string;
  reporter_role: string | null;
  /** SALCI-set priority (NEEDS DB). Absent or null means untriaged. */
  triage_priority?: string | null;
}

/** True when the SOP clock says the ticket has sat too long. */
export function isSopOverdue(ticket: SopSortable, now: Date): boolean {
  if (!isLiveStatus(ticket.status)) return false;
  return isPastWorkingHours(ticket.created_at, now, SOP_OVERDUE_WORKING_HOURS);
}

/** Working hours a live ticket has been open, for the row label. */
export function sopWorkingAgeHours(ticket: Pick<SopSortable, "created_at">, now: Date): number {
  return workingHoursSince(ticket.created_at, now);
}

/**
 * The inbox order the SOP prescribes: tickets past 24 working hours first,
 * then P1, untriaged, P2, P3, Enhancement, then the role tie-break, then the
 * oldest first. Stable on id so equal rows never swap between renders.
 */
export function supportInboxComparator<T extends SopSortable & { id: string }>(
  now: Date,
): (a: T, b: T) => number {
  return (a, b) => {
    const overdue = Number(isSopOverdue(b, now)) - Number(isSopOverdue(a, now));
    if (overdue !== 0) return overdue;
    const priority = priorityRank(a.triage_priority) - priorityRank(b.triage_priority);
    if (priority !== 0) return priority;
    const role = roleRank(a.reporter_role) - roleRank(b.reporter_role);
    if (role !== 0) return role;
    const age = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (age !== 0) return age;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
