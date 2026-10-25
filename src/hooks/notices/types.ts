/** Shared types for the Notice Board. Mirrors the RPC return shapes in
 *  supabase/migrations/202608221005*.sql and 20260822100600_*.sql. */

export type NoticeScope = "institution" | "wing" | "class";
export type NoticePriority = "normal" | "important" | "urgent";
export type NoticeType = "general" | "academic" | "event" | "ptm";
export type RecipientRole = "coordinator" | "teacher" | "student";

export type AddedReason =
  | "audience_role"
  | "class_student"
  | "class_teacher"
  | "wing_coordinator_auto"
  | "wing_member";

/** One entry in `notices.attachments`.
 *
 *  New uploads carry `path` and are read through a signed URL. The single
 *  pre-migration attachment carries `legacy_url` instead: its bytes live in the
 *  old public `circular-attachments` bucket, and moving them between buckets
 *  needs the Storage API rather than a row update, so it is rendered as a plain
 *  anchor. Both shapes are valid; exactly one of the two fields is present. */
export interface NoticeAttachment {
  path?: string;
  legacy_url?: string;
  name: string;
  size?: number;
  mime?: string;
}

/** A notice as it appears in the recipient's inbox, with their own read state. */
export interface InboxNotice {
  id: string;
  title: string;
  content: string;
  type: string;
  scope: string;
  priority: string;
  published_at: string;
  expires_at: string | null;
  requires_acknowledgement: boolean;
  attachments: NoticeAttachment[];
  publisher_name: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

/** A notice the viewer issued or oversees, with its reach counts. */
export interface OutboxNotice {
  id: string;
  title: string;
  type: string;
  scope: string;
  priority: string;
  published_at: string;
  expires_at: string | null;
  requires_acknowledgement: boolean;
  publisher_name: string | null;
  target_summary: string | null;
  recipient_count: number;
  read_count: number;
  ack_count: number;
}

export interface NoticeReachRow {
  recipient_role: string;
  total: number;
  read_count: number;
  ack_count: number;
}

export interface NoticeRecipientRow {
  user_id: string;
  full_name: string | null;
  recipient_role: string;
  added_reason: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

export interface NoticeTargetOption {
  kind: string;
  id: string;
  label: string;
  sort_key: string;
}

export interface NoticeClassStaff {
  kind: string;
  user_id: string;
  full_name: string | null;
  detail: string | null;
}

export type RecipientStatusFilter = "all" | "unread" | "read" | "acknowledged";

/** Payload for `publish_notice`. `noticeId` is generated client-side so
 *  attachments can be uploaded before the row exists, which is also what makes
 *  a double-submit idempotent. */
export interface PublishNoticeInput {
  noticeId: string;
  title: string;
  content: string;
  type: NoticeType;
  priority: NoticePriority;
  scope: NoticeScope;
  classIds?: string[];
  wingIds?: string[];
  audienceRoles?: RecipientRole[];
  /** Empty or omitted means "all teachers of the chosen classes". */
  teacherIds?: string[];
  requiresAcknowledgement?: boolean;
  expiresAt?: string | null;
  attachments?: NoticeAttachment[];
}

/** Serialises attachments for the `jsonb` parameter of `publish_notice`.
 *
 *  `Json` has no `undefined`, so an optional field left unset would not type
 *  check and would also serialise as a null the DB has no use for. Emit only
 *  the keys that actually carry a value. */
export function attachmentsToJson(
  list: NoticeAttachment[] | undefined,
): Record<string, string | number>[] {
  return (list ?? []).map((a) => {
    const out: Record<string, string | number> = { name: a.name };
    if (a.path) out.path = a.path;
    if (a.legacy_url) out.legacy_url = a.legacy_url;
    if (typeof a.size === "number") out.size = a.size;
    if (a.mime) out.mime = a.mime;
    return out;
  });
}

/** `jsonb` columns arrive as `Json`, which is wider than the shape we write.
 *  Narrow it without reaching for `any`. */
export function toAttachments(value: unknown): NoticeAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is NoticeAttachment =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string",
  );
}
