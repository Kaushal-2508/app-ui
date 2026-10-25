/**
 * Escalation mark on a support ticket: who is working on it, and the task
 * raised for them in Task Management.
 *
 * The SOP flow (Naman, 2026-09-23) is manual and in this order: the Support
 * Executive picks the person, creates the task for them by hand in Task
 * Management, copies its link and pastes it back here. Only once the link is
 * on the ticket is the ticket escalated; a person on their own is an intention.
 *
 * Storage: the mark lives in `support_messages` as an INTERNAL row written
 * through `post_support_message`, not in a column on `reported_issues`. The
 * five SOP columns of the 2026-09-18 spec were never applied, and the two
 * columns that do exist are the wrong home: `admin_notes` is readable by the
 * reporter (the SELECT policy is `reporter_id = auth.uid() OR is_super_admin`)
 * and putting the mark there re-opens the leak closed on 2026-08-31, while
 * `task_id` already points at the support mirror task. An internal message is
 * hidden from the reporter by the table's read policy, never moves the ticket's
 * status (the RPC gates every status move on `NOT v_internal`) and leaves the
 * escalation visible in the thread, which is what it is.
 *
 * The body is one machine-readable line, written and read only by this file.
 * When the real columns land, the reader moves and this history stays as a
 * record; nothing needs migrating.
 */

/** Prefix every escalation note starts with. Bump the version, never reuse it. */
export const ESCALATION_MARKER = "SALCI-ESCALATION v1";

const FIELD_SEPARATOR = " | ";
/** Written in the id slot when the name was typed rather than picked. */
const NO_ID = "-";
/** Only the profile id is a uuid; task ids are whatever their surface uses. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EscalationMark {
  /**
   * profiles.id when the person holds a SALCI account, null when their name
   * was simply typed in. Most of the technical team are not super admins and
   * some have no account at all, so the NAME is the identity here and the id is
   * a bonus when it happens to be known.
   */
  staffId: string | null;
  /** Snapshot of their name: profiles RLS hides rows across institutions. */
  staffName: string;
  /**
   * The task link exactly as it was pasted. REQUIRED: a ticket is escalated
   * only once the task exists and its link is on the ticket (Naman,
   * 2026-09-23); a name on its own is an intention, not a state the inbox
   * should be able to show.
   *
   * The whole URL is kept, not an id. Tasks are raised in the LMS on
   * salci.sale, whose links look like
   * `https://www.salci.sale/lms/tasks?task=357`: a different path AND a numeric
   * id, so neither the uuid this portal uses nor a relative path rebuilt from
   * an id would reach the task. Storing what was pasted is also the only thing
   * that keeps working if a third surface starts raising tasks. This is data a
   * super admin typed, not a domain hardcoded in shared code, so CLAUDE.md
   * section 1 is satisfied.
   */
  taskUrl: string;
}

/**
 * The one chip wording, so the inbox row, the board card and the detail sheet
 * cannot describe the same ticket differently.
 */
export function escalationLabel(mark: EscalationMark | null | undefined): string | null {
  return mark ? `Escalated to ${mark.staffName}` : null;
}

/**
 * The note body for a mark. A newline would split the line in the thread, and
 * the name is written last so it may contain the separator.
 */
export function formatEscalationNote(mark: EscalationMark): string {
  const name = mark.staffName.replace(/\s+/g, " ").trim() || "SALCI team member";
  // The URL sits in slot 3 and the name stays last: a URL cannot contain a
  // space, so the " | " separator can never appear inside it, while a name can.
  return [ESCALATION_MARKER, mark.staffId ?? NO_ID, mark.taskUrl, name].join(FIELD_SEPARATOR);
}

/** The note body that withdraws the mark. */
export function formatEscalationClearedNote(): string {
  return `${ESCALATION_MARKER}${FIELD_SEPARATOR}cleared`;
}

/**
 * Reads a note body back. `null` means this message is not an escalation note
 * at all (every other internal note a human writes lands here too);
 * `"cleared"` means the mark was explicitly withdrawn.
 */
export function parseEscalationNote(body: string | null | undefined): EscalationMark | "cleared" | null {
  if (!body) return null;
  const line = body.trim();
  if (!line.startsWith(ESCALATION_MARKER)) return null;

  const parts = line.split(FIELD_SEPARATOR);
  if (parts[1] === "cleared") return "cleared";
  if (parts.length < 4) return null;

  const id = parts[1];
  const taskUrl = normaliseTaskUrl(parts[2]);
  const staffName = parts.slice(3).join(FIELD_SEPARATOR).trim();
  // Both the name and the task link are required; a note missing either is not
  // an escalation and is ignored rather than half-read.
  if (staffName.length === 0 || taskUrl === null) return null;
  if (id !== NO_ID && !UUID.test(id)) return null;

  return { staffId: id === NO_ID ? null : id, staffName, taskUrl };
}

/**
 * Names typed on this machine, so one added for a ticket is offered on every
 * later ticket without being typed again.
 *
 * Two layers, on purpose. Every name that has actually been escalated to comes
 * back from the notes themselves and is therefore shared with the whole SALCI
 * team; this list covers the gap before that, a name added while the task is
 * still being raised. Per-viewer convenience only, so localStorage is the right
 * home: it is never read back by anything but this picker, and every access is
 * guarded because it throws in a private window and can come back empty.
 */
const REMEMBERED_NAMES_KEY = "salci-escalation-names";
const REMEMBERED_NAMES_MAX = 50;

export function rememberedEscalationNames(): string[] {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_NAMES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  } catch {
    return [];
  }
}

/** Newest first, de-duplicated, capped. Silent when storage is unavailable. */
export function rememberEscalationName(name: string): void {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return;
  try {
    const next = [clean, ...rememberedEscalationNames().filter((n) => n !== clean)].slice(
      0,
      REMEMBERED_NAMES_MAX,
    );
    window.localStorage.setItem(REMEMBERED_NAMES_KEY, JSON.stringify(next));
  } catch {
    // No storage (private window, blocked site data). The picker still works
    // from the shared list; the name simply is not pre-offered here.
  }
}

/**
 * Does this address point at ONE task? The guard exists because the ticket
 * link is usually sitting in the same clipboard, and a wrong paste would
 * otherwise be accepted and "Open the task" would lead nowhere, silently.
 *
 * Deliberately shape-based, never id-based: the LMS numbers its tasks
 * (`/lms/tasks?task=357`) while this portal uses uuids, so anything that
 * insisted on a uuid rejected every real link.
 */
function namesOneTask(url: URL): boolean {
  const param = url.searchParams.get("task") ?? url.searchParams.get("taskId");
  if (param && param.trim().length > 0) return true;
  // Or a path that ends in an id, such as /tasks/357.
  const segments = url.pathname.split("/").filter(Boolean);
  const at = segments.findIndex((s) => /^tasks?$/i.test(s));
  return at >= 0 && segments.length > at + 1;
}

/**
 * The task link out of whatever the Support Executive pasted, or null when it
 * is not one. The link is kept whole rather than reduced to an id, because the
 * task may live on another SALCI surface entirely (see `taskUrl` above).
 */
export function normaliseTaskUrl(input: string | null | undefined): string | null {
  const text = input?.trim();
  if (!text) return null;

  // A path copied without its origin still belongs to this app.
  const relative = text.startsWith("/");
  let url: URL;
  try {
    url = new URL(text, relative ? "https://placeholder.invalid" : undefined);
  } catch {
    return null;
  }
  // http(s) only: this is rendered as a link, and `javascript:` is not a task.
  if (!relative && url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!namesOneTask(url)) return null;

  return relative ? text : url.toString();
}
