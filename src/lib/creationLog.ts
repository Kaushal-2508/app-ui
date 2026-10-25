import { logActivityEvent } from "@/lib/activityLog";

type JsonScalar = string | number | boolean | null;
type JsonRecord = Record<string, JsonScalar>;

function isJsonScalar(v: unknown): v is JsonScalar {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Flatten a row to JSON scalars; nested values are stringified, never dropped. */
export function toJsonRecord(row: Record<string, unknown> | null | undefined): JsonRecord | null {
  if (!row) return null;
  const out: JsonRecord = {};
  for (const [k, v] of Object.entries(row)) {
    if (isJsonScalar(v)) out[k] = v;
    else if (v !== undefined) out[k] = JSON.stringify(v);
  }
  return out;
}

export interface LogCreationParams {
  /** Human label for the kind of thing made ("Chapter", "Fee category").
   *  Drives the default action `<kind>_created` and the entity_type column. */
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  /**
   * REQUIRED for the school's admins to see the row: system_audit_logs RLS
   * reads `metadata->>'institution_id'`. Pass null only for global objects.
   */
  institutionId: string | null | undefined;
  /** The row as written, so the log shows what was created with what values. */
  newValues?: Record<string, unknown> | null;
  /** Override the default verb, e.g. "wing_assignment_added". */
  action?: string;
  metadata?: JsonRecord;
}

/**
 * Record a creation on the Activity Logs page. Call it AFTER the insert has
 * succeeded, with the returned row (or the payload) as newValues. Counterpart
 * of logDeletion so the timeline shows both ends of an object's life.
 * Best-effort like logActivityEvent: never throws, never blocks the save.
 */
export function logCreation(p: LogCreationParams): Promise<void> {
  const action =
    p.action ?? `${p.entityType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}_created`;
  return logActivityEvent({
    action,
    entityType: p.entityType,
    entityId: p.entityId ?? null,
    entityName: p.entityName ?? null,
    newValues: toJsonRecord(p.newValues),
    metadata: { institution_id: p.institutionId ?? null, ...(p.metadata ?? {}) },
  });
}
