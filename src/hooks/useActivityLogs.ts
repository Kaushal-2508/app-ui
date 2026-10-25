import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getDisplayName } from "@/lib/displayName";
import { formatClassName } from "@/lib/utils";
import {
  ACTIVITY_SOURCES,
  type ActivityEvent,
  type ActivityFilters,
  type ActivitySource,
  type JsonMap,
} from "@/components/activity/activityModel";

/** Rows per page of the merged timeline. Each source is asked for this many
 *  below the cursor, so one page costs at most 4 bounded reads (§23). */
export const ACTIVITY_PAGE_SIZE = 30;

/**
 * Keyset cursor on the event timestamp. `boundaryKeys` are the events already
 * shown whose timestamp equals `before`; the next page reads `<= before` and
 * drops them, so two events written in the same millisecond on different
 * tables are never lost between pages. Never an OFFSET (§23).
 */
export type ActivityCursor = { before: string; boundaryKeys: string[] } | null;

export interface ActivityFeedPage {
  events: ActivityEvent[];
  nextCursor: ActivityCursor;
}

interface FetchContext {
  institutionId: string | null;
  filters: ActivityFilters;
  cursor: ActivityCursor;
  limit: number;
}

interface ActorBits {
  full_name: string | null;
  email: string | null;
}

interface TitledEntity {
  title: string | null;
  institution_id: string | null;
}

/** PostgREST typegen widens an embedded row to `T | T[]`; narrow before use. */
function pickOne<T>(embedded: unknown): T | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  return (row as T | null | undefined) ?? null;
}

function asMap(value: Json | null | undefined): JsonMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonMap;
}

// "System" is reserved for rows with NO actor id. An actor whose profile the
// viewer cannot read (RLS, a deleted account) is still a person, and the one
// screen built to say who did something must not attribute them to the platform.
const UNKNOWN_ACTOR = "Unknown user";

function actorFallback(id: string | null): string {
  return id ? UNKNOWN_ACTOR : "System";
}

function actorFrom(embedded: unknown, id: string | null): ActivityEvent["actor"] {
  const bits = pickOne<ActorBits>(embedded);
  const fallback = actorFallback(id);
  return {
    id,
    name: bits ? getDisplayName(bits, fallback) : fallback,
    email: bits?.email ?? null,
  };
}

// ---------------------------------------------------------------------------
// Source adapters. Each returns at most `limit` events strictly from its own
// table, newest first, already scoped to the institution server-side.
// ---------------------------------------------------------------------------

async function fetchSystemEvents(ctx: FetchContext): Promise<ActivityEvent[]> {
  const { filters, cursor, limit } = ctx;
  let q = supabase
    .from("system_audit_logs")
    .select(
      "id, action, entity_type, entity_id, entity_name, old_values, new_values, ip_address, user_agent, metadata, created_at, actor_id, profiles:actor_id(full_name, email)",
    )
    .order("created_at", { ascending: false })
    // Deterministic tiebreaker: without it, rows sharing a timestamp come back
    // in an arbitrary order and the fixed-size window shifts between pages,
    // which drops rows. Matches the merge comparator below (key = source:id).
    .order("id", { ascending: false })
    .limit(limit);
  // Institution scope is enforced by RLS on metadata->>'institution_id';
  // the table has no institution column to filter on (see migration 20260105052345).
  if (cursor) q = q.lte("created_at", cursor.before);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);
  if (filters.entityType) q = q.ilike("entity_type", filters.entityType);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const metadata = asMap(row.metadata) ?? {};
    const institutionId = typeof metadata.institution_id === "string" ? metadata.institution_id : null;
    return {
      key: `system:${row.id}`,
      id: row.id,
      source: "system",
      action: row.action,
      createdAt: row.created_at,
      actor: actorFrom(row.profiles, row.actor_id),
      entity: {
        type: row.entity_type.toLowerCase(),
        id: row.entity_id,
        name: row.entity_name ?? `${row.entity_type} ${row.entity_id?.slice(0, 8) ?? ""}`.trim(),
      },
      fromStatus: null,
      toStatus: null,
      reason: null,
      before: asMap(row.old_values),
      after: asMap(row.new_values),
      metadata,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      institutionId,
    };
  });
}

async function fetchTaskEvents(ctx: FetchContext): Promise<ActivityEvent[]> {
  const { institutionId, filters, cursor, limit } = ctx;
  // `tasks!inner` so the institution filter runs in SQL and a log row whose
  // task is unreadable never reaches the client as an "Unknown Task".
  let q = supabase
    .from("task_audit_logs")
    .select(
      "id, action, from_status, to_status, reason, created_at, metadata, actor_id, task_id, profiles:actor_id(full_name, email), tasks!inner(title, institution_id)",
    )
    .order("created_at", { ascending: false })
    // Deterministic tiebreaker: without it, rows sharing a timestamp come back
    // in an arbitrary order and the fixed-size window shifts between pages,
    // which drops rows. Matches the merge comparator below (key = source:id).
    .order("id", { ascending: false })
    .limit(limit);
  if (institutionId) q = q.eq("tasks.institution_id", institutionId);
  if (cursor) q = q.lte("created_at", cursor.before);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const task = pickOne<TitledEntity>(row.tasks);
    return {
      key: `task:${row.id}`,
      id: row.id,
      source: "task",
      action: row.action,
      createdAt: row.created_at,
      actor: actorFrom(row.profiles, row.actor_id),
      entity: { type: "task", id: row.task_id, name: task?.title ?? "Task" },
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      before: null,
      after: null,
      metadata: asMap(row.metadata) ?? {},
      ipAddress: null,
      userAgent: null,
      institutionId: task?.institution_id ?? null,
    };
  });
}

async function fetchExamEvents(ctx: FetchContext): Promise<ActivityEvent[]> {
  const { institutionId, filters, cursor, limit } = ctx;
  let q = supabase
    .from("exam_publication_logs")
    .select(
      "id, action, previous_status, new_status, reason, created_at, metadata, actor_id, exam_id, profiles:actor_id(full_name, email), exams!inner(title, institution_id)",
    )
    .order("created_at", { ascending: false })
    // Deterministic tiebreaker: without it, rows sharing a timestamp come back
    // in an arbitrary order and the fixed-size window shifts between pages,
    // which drops rows. Matches the merge comparator below (key = source:id).
    .order("id", { ascending: false })
    .limit(limit);
  if (institutionId) q = q.eq("exams.institution_id", institutionId);
  if (cursor) q = q.lte("created_at", cursor.before);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const exam = pickOne<TitledEntity>(row.exams);
    return {
      key: `exam:${row.id}`,
      id: row.id,
      source: "exam",
      action: row.action,
      createdAt: row.created_at,
      actor: actorFrom(row.profiles, row.actor_id),
      entity: { type: "exam", id: row.exam_id, name: exam?.title ?? "Exam" },
      fromStatus: row.previous_status,
      toStatus: row.new_status,
      reason: row.reason,
      before: null,
      after: null,
      metadata: asMap(row.metadata) ?? {},
      ipAddress: null,
      userAgent: null,
      institutionId: exam?.institution_id ?? null,
    };
  });
}

/** The ledger's only event kind; it has no action column of its own. */
export const ASSIGNMENT_REMOVED_ACTION = "assignment_removed";

async function fetchAssignmentEvents(ctx: FetchContext): Promise<ActivityEvent[]> {
  const { institutionId, filters, cursor, limit } = ctx;
  // The ledger has no action column, so any other action filter excludes it.
  if (filters.action && filters.action !== ASSIGNMENT_REMOVED_ACTION) return [];

  let q = supabase
    .from("class_assignment_deletions")
    .select(
      "id, assignment_id, user_id, class_id, subject_id, role, institution_id, teaching_type, assigned_by, assigned_at, deleted_by, deleted_at",
    )
    .order("deleted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (institutionId) q = q.eq("institution_id", institutionId);
  if (cursor) q = q.lte("deleted_at", cursor.before);
  if (filters.from) q = q.gte("deleted_at", filters.from);
  if (filters.to) q = q.lte("deleted_at", filters.to);
  if (filters.actorId) q = q.eq("deleted_by", filters.actorId);

  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // The ledger deliberately has no FKs (it must outlive the rows it records),
  // so PostgREST cannot embed names. Resolve them in three batched lookups
  // bounded by the page size; a deleted person or class simply shows its id.
  const profileIds = new Set<string>();
  const classIds = new Set<string>();
  const subjectIds = new Set<string>();
  for (const r of rows) {
    profileIds.add(r.user_id);
    if (r.deleted_by) profileIds.add(r.deleted_by);
    if (r.assigned_by) profileIds.add(r.assigned_by);
    classIds.add(r.class_id);
    if (r.subject_id) subjectIds.add(r.subject_id);
  }

  const [profilesRes, classesRes, subjectsRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", [...profileIds]),
    supabase.from("classes").select("id, name, section").in("id", [...classIds]),
    subjectIds.size > 0
      ? supabase.from("universal_subjects").select("id, name").in("id", [...subjectIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (classesRes.error) throw classesRes.error;
  if (subjectsRes.error) throw subjectsRes.error;

  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
  const classes = new Map((classesRes.data ?? []).map((c) => [c.id, c]));
  const subjects = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));

  return rows.map((r) => {
    const target = profiles.get(r.user_id);
    const actor = r.deleted_by ? profiles.get(r.deleted_by) : undefined;
    const assigner = r.assigned_by ? profiles.get(r.assigned_by) : undefined;
    const cls = classes.get(r.class_id);
    const subject = r.subject_id ? subjects.get(r.subject_id) : undefined;
    const className = cls ? formatClassName(cls.name, cls.section) : `Class ${r.class_id.slice(0, 8)}`;
    return {
      key: `assignment:${r.id}`,
      id: r.id,
      source: "assignment",
      action: ASSIGNMENT_REMOVED_ACTION,
      createdAt: r.deleted_at,
      actor: {
        id: r.deleted_by,
        name: actor
          ? getDisplayName(actor, actorFallback(r.deleted_by))
          : actorFallback(r.deleted_by),
        email: actor?.email ?? null,
      },
      entity: {
        type: r.role,
        id: r.user_id,
        name: target ? getDisplayName(target, "Removed user") : "Removed user",
      },
      fromStatus: null,
      toStatus: null,
      reason: null,
      before: {
        class: className,
        subject: subject?.name ?? (r.subject_id ? "Deleted subject" : "No subject"),
        role: r.role,
        teaching_type: r.teaching_type,
        assigned_by: assigner ? getDisplayName(assigner) : r.assigned_by,
        assigned_at: r.assigned_at,
      },
      after: null,
      metadata: { assignment_id: r.assignment_id, class_id: r.class_id, subject_id: r.subject_id },
      ipAddress: null,
      userAgent: null,
      institutionId: r.institution_id,
    };
  });
}

const ADAPTERS: Record<ActivitySource, (ctx: FetchContext) => Promise<ActivityEvent[]>> = {
  system: fetchSystemEvents,
  task: fetchTaskEvents,
  exam: fetchExamEvents,
  assignment: fetchAssignmentEvents,
};

/** Which sources a filter set can still produce rows from. */
export function activeSourcesFor(filters: ActivityFilters): ActivitySource[] {
  let sources = filters.sources.length > 0 ? filters.sources : [...ACTIVITY_SOURCES];
  // Only system rows carry a free-form entity type; the other sources are
  // fixed to task / exam / staff role, so an entity-type filter narrows to system.
  if (filters.entityType) sources = sources.filter((s) => s === "system");
  return sources;
}

/**
 * The merged activity timeline, newest first. Every source is read with the
 * same bounds (cursor, date range, actor, action) so paging past the first
 * screen still returns matches; results are k-way merged in the browser and
 * trimmed to one page. Any source failing surfaces as the page's error state:
 * a short list must never stand in for a failed read (§6).
 */
export function useActivityFeed(
  institutionId: string | null,
  filters: ActivityFilters,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["activity-feed", institutionId, filters],
    initialPageParam: null as ActivityCursor,
    queryFn: async ({ pageParam }): Promise<ActivityFeedPage> => {
      const sources = activeSourcesFor(filters);
      const ctx: FetchContext = { institutionId, filters, cursor: pageParam, limit: ACTIVITY_PAGE_SIZE };
      const perSource = await Promise.all(sources.map((s) => ADAPTERS[s](ctx)));

      const seen = new Set(pageParam?.boundaryKeys ?? []);
      const merged = perSource
        .flat()
        .filter((e) => !seen.has(e.key))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.key.localeCompare(a.key));

      const events = merged.slice(0, ACTIVITY_PAGE_SIZE);
      const anySourceFull = perSource.some((rows) => rows.length === ACTIVITY_PAGE_SIZE);
      const hasMore = merged.length > ACTIVITY_PAGE_SIZE || anySourceFull;
      const last = events[events.length - 1];

      // Every key already emitted AT the cursor timestamp must travel with the
      // cursor, not only the ones on this page: rebuilding the set from the
      // current page alone forgets earlier ties as soon as a whole page lands
      // inside a single timestamp, and those rows return as duplicates. The set
      // resets whenever the timestamp actually advances, so it stays small.
      const tied = last
        ? events.filter((e) => e.createdAt === last.createdAt).map((e) => e.key)
        : [];
      const carried =
        last && last.createdAt === pageParam?.before
          ? [...(pageParam?.boundaryKeys ?? []), ...tied]
          : tied;

      return {
        events,
        nextCursor:
          hasMore && last
            ? {
                before: last.createdAt,
                boundaryKeys: Array.from(new Set(carried)),
              }
            : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface ActivityStats {
  /** Events across every source in the trailing 7 days (today inclusive). */
  total: number;
  bySource: Record<ActivitySource, number>;
  /** ISO start of the window, for the tile caption. */
  since: string;
}

/**
 * Seven-day counts per source, computed server-side with HEAD requests
 * (§23: never fetch rows to count them). Four requests per load, cached for
 * five minutes; the window boundary is a calendar day so the key is stable
 * across renders. Browser-local midnight: fine for India-only today (§24).
 */
export function useActivityStats(institutionId: string | null, enabled = true) {
  const since = startOfDay(subDays(new Date(), 6));
  const sinceIso = since.toISOString();
  const dayKey = format(since, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["activity-stats", institutionId, dayKey],
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ActivityStats> => {
      // system_audit_logs is scoped by RLS on metadata; there is no column to filter.
      const system = supabase
        .from("system_audit_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      let task = supabase
        .from("task_audit_logs")
        .select("id, tasks!inner(institution_id)", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      let exam = supabase
        .from("exam_publication_logs")
        .select("id, exams!inner(institution_id)", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      let assignment = supabase
        .from("class_assignment_deletions")
        .select("id", { count: "exact", head: true })
        .gte("deleted_at", sinceIso);
      if (institutionId) {
        task = task.eq("tasks.institution_id", institutionId);
        exam = exam.eq("exams.institution_id", institutionId);
        assignment = assignment.eq("institution_id", institutionId);
      }

      const [s, t, e, a] = await Promise.all([system, task, exam, assignment]);
      const firstError = s.error ?? t.error ?? e.error ?? a.error;
      if (firstError) throw firstError;

      const bySource: Record<ActivitySource, number> = {
        system: s.count ?? 0,
        task: t.count ?? 0,
        exam: e.count ?? 0,
        assignment: a.count ?? 0,
      };
      return {
        total: bySource.system + bySource.task + bySource.exam + bySource.assignment,
        bySource,
        since: sinceIso,
      };
    },
  });
}
