import type { Tone } from "@/components/shared/design-system";

/**
 * The Activity Logs page federates every table that records "who did what"
 * for a school. Each table is one `ActivitySource`; the hook normalises rows
 * from all of them into `ActivityEvent` so the page renders one timeline.
 *
 * Sources and the table behind each (all admin-readable under RLS):
 *   system      → system_audit_logs        (log_audit_event RPC + admin edge fns)
 *   task        → task_audit_logs          (status moves on tasks)
 *   exam        → exam_publication_logs    (publish / unpublish / archive)
 *   assignment  → class_assignment_deletions (teaching assignments removed;
 *                 a ledger with no FKs, so names are resolved separately)
 *
 * Adding a source = one adapter in useActivityLogs.ts + one row in SOURCE_META.
 */
export type ActivitySource = "system" | "task" | "exam" | "assignment";

export const ACTIVITY_SOURCES: readonly ActivitySource[] = ["system", "task", "exam", "assignment"];

export type JsonMap = Record<string, unknown>;

export interface ActivityActor {
  id: string | null;
  name: string;
  email: string | null;
}

export interface ActivityEntity {
  /** Kind of thing acted on, lower-case ("user", "exam", "task", "subject"). */
  type: string;
  id: string | null;
  name: string;
}

export interface ActivityEvent {
  /** Unique across sources: `${source}:${id}`. Row ids alone can collide. */
  key: string;
  id: string;
  source: ActivitySource;
  /** Raw snake_case verb as stored ("password_reset", "published"). */
  action: string;
  createdAt: string;
  actor: ActivityActor;
  entity: ActivityEntity;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  /** Field values before / after the change, when the source records them. */
  before: JsonMap | null;
  after: JsonMap | null;
  metadata: JsonMap;
  ipAddress: string | null;
  userAgent: string | null;
  institutionId: string | null;
}

export interface ActivityFilters {
  /** Empty = every source. */
  sources: ActivitySource[];
  /** Exact raw action, e.g. "password_reset". Null = any. */
  action: string | null;
  /** Actor profile id. Null = anyone. */
  actorId: string | null;
  /** Entity type, matched case-insensitively. Null = any. */
  entityType: string | null;
  /** Inclusive ISO bounds on the event timestamp. */
  from: string | null;
  to: string | null;
}

export const EMPTY_FILTERS: ActivityFilters = {
  sources: [],
  action: null,
  actorId: null,
  entityType: null,
  from: null,
  to: null,
};

export function countActiveFilters(f: ActivityFilters): number {
  let n = 0;
  if (f.sources.length > 0) n += 1;
  if (f.action) n += 1;
  if (f.actorId) n += 1;
  if (f.entityType) n += 1;
  if (f.from || f.to) n += 1;
  return n;
}

export const SOURCE_META: Record<
  ActivitySource,
  { label: string; short: string; tile: string; tone: Tone; description: string }
> = {
  system: {
    label: "System changes",
    short: "System",
    tile: "System",
    tone: "sky",
    description: "Accounts, passwords, roles, subjects, syllabus and profile edits",
  },
  task: {
    label: "Task events",
    short: "Task",
    tile: "Tasks",
    tone: "violet",
    description: "Status moves, approvals and rejections on tasks",
  },
  exam: {
    label: "Exam events",
    short: "Exam",
    tile: "Exams",
    tone: "teal",
    description: "Exams published, unpublished, activated or archived",
  },
  assignment: {
    label: "Teaching assignments",
    short: "Assignment",
    tile: "Assignments",
    tone: "peach",
    description: "Class and subject assignments removed from staff",
  },
};

/**
 * Human copy for raw action verbs. Every entry here is an action string the
 * codebase actually writes (grep `logActivityEvent(`, `log_audit_event(` and
 * the admin edge functions); nothing is guessed. Unknown values fall back to
 * `humanizeAction`, so a new writer still renders readably.
 */
export const ACTION_LABELS: Record<string, string> = {
  // system: admin-operations edge function
  password_reset: "reset the password of",
  user_created: "created the account",
  user_updated: "updated the account",
  user_deleted: "deleted the account",
  user_delete_blocked: "could not delete the account",
  institution_created: "created the institution",
  institution_deleted: "deleted the institution",
  bulk_delete_students: "bulk-deleted students in",
  bulk_update_student_profiles: "bulk-updated student profiles in",
  ai_config_updated: "updated the AI configuration of",
  quota_updated: "updated the AI quota of",
  broadcast_email_sent: "sent a broadcast email to",
  broadcast_email_failed: "failed to send a broadcast email to",
  // system: SQL RPCs
  subject_deleted: "deleted the subject",
  subject_updated: "updated the subject",
  subject_removed_from_class: "removed a subject from",
  teacher_assignments_removed: "removed teaching assignments from",
  class_teachers_updated: "updated the teachers of",
  teacher_role_granted: "granted the teacher role to",
  teacher_role_revoked: "revoked the teacher role from",
  // system: client logActivityEvent
  chapter_deleted: "deleted the chapter",
  chapter_hidden: "hid the chapter",
  material_deleted: "deleted the material",
  segment_deleted: "deleted the segment",
  student_class_updated: "moved the class of",
  student_details_updated: "updated the details of",
  optional_group_upserted: "saved the optional group",
  optional_group_deleted: "deleted the optional group",
  optional_group_choices_saved: "saved optional choices for",
  user_photo_updated: "updated the photo of",
  user_photo_removed: "removed the photo of",
  // creations recorded from the client via logCreation (src/lib/creationLog.ts)
  chapter_created: "created the chapter",
  subject_created: "created the subject",
  class_created: "created the class",
  wing_created: "created the wing",
  wing_assignment_added: "added a coordinator to",
  wing_class_added: "added a class to",
  fee_structure_created: "created the fee structure",
  fee_category_created: "created the fee category",
  holiday_created: "added the holiday",
  employee_level_created: "created the employee level",
  shared_resource_created: "added the shared resource",
  exam_template_created: "saved the exam template",
  question_created: "added the question",
  material_created: "added the material",
  task_created: "created the task",
  task_group_created: "created a task group",
  homework_created: "created the homework",
  diary_entry_created: "wrote the diary entry",
  exam_created: "created the exam",
  // deletions recorded by the zzz_audit_del database triggers (migration 20260914140000)
  exam_deleted: "deleted the exam",
  exam_draft_deleted: "deleted the draft exam",
  homework_deleted: "deleted the homework",
  task_deleted: "deleted the task",
  diary_entry_deleted: "deleted the diary entry",
  question_deleted: "deleted the question",
  exam_template_deleted: "deleted the exam template",
  class_deleted: "deleted the class",
  wing_deleted: "deleted the wing",
  wing_assignment_removed: "removed a coordinator from",
  wing_class_removed: "removed a class from",
  fee_structure_deleted: "deleted the fee structure",
  fee_category_deleted: "deleted the fee category",
  holiday_deleted: "removed the holiday",
  employee_level_deleted: "deleted the employee level",
  substitution_deleted: "removed the substitute for",
  shared_resource_deleted: "deleted the shared resource",
  admin_role_revoked: "revoked the admin role of",
  user_roles_changed: "changed the roles of",
  // syllabus log edits, recorded by the zzz_audit_syllabus_log_* and
  // zzz_audit_period_note_* triggers (migration 20260929120000)
  syllabus_log_created: "logged the chapter",
  syllabus_log_updated: "changed the chapter log",
  syllabus_log_deleted: "removed the chapter log",
  period_note_created: "logged a period note for",
  period_note_updated: "edited the period note for",
  period_note_deleted: "removed the period note for",
  // exam publication
  published: "published",
  activated: "activated",
  completed: "completed",
  // task
  approved: "approved",
  // assignment ledger (synthetic; the table has no action column)
  assignment_removed: "removed a teaching assignment from",
};

/** "done_pending_approval" → "Done pending approval". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Verb phrase that reads between the actor and the entity. */
export function actionPhrase(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action).toLowerCase();
}

/** Standalone label for chips and the filter list. */
export function actionLabel(action: string): string {
  return humanize(action);
}

/** Tone for a destination status so the eye reads outcome before words. */
export function statusTone(status: string | null): Tone | null {
  if (!status) return null;
  if (/completed|published|approved|active|activated|done/.test(status)) return "mint";
  if (/rejected|cancelled|archived|deleted|failed/.test(status)) return "rose";
  if (/pending|review/.test(status)) return "peach";
  return null;
}

/** Two-letter monogram for the actor disc. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
