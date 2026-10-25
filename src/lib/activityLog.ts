import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** JSON-serialisable flat record (assignable to the RPC's `Json` params). */
type JsonRecord = Record<string, string | number | boolean | null>;

export interface LogActivityEventParams {
  /** Past-tense verb, snake_case, e.g. "subject_deleted". */
  action: string;
  /** Human label for the entity kind, e.g. "Subject" / "Chapter" / "Material". */
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  oldValues?: JsonRecord | null;
  /** Values after the change, when the event is an edit rather than a delete. */
  newValues?: JsonRecord | null;
  /** ALWAYS include `institution_id` so school admins can read the row in ViewUserSheet. */
  metadata?: JsonRecord | null;
}

/**
 * Best-effort write to `system_audit_logs` via the SECURITY DEFINER
 * `log_audit_event` RPC, which stamps `actor_id = auth.uid()`. ViewUserSheet's
 * Activity tab federates `system_audit_logs` by `actor_id`, so the event shows
 * up there automatically — no feed changes needed.
 *
 * NEVER throws: a logging failure must not fail the operation it follows.
 */
export async function logActivityEvent(params: LogActivityEventParams): Promise<void> {
  try {
    await supabase.rpc("log_audit_event", {
      _action: params.action,
      _entity_type: params.entityType,
      _entity_id: params.entityId ?? undefined,
      _entity_name: params.entityName ?? undefined,
      _old_values: (params.oldValues ?? undefined) as Json | undefined,
      _new_values: (params.newValues ?? undefined) as Json | undefined,
      _metadata: (params.metadata ?? {}) as Json,
    });
  } catch (err) {
    console.warn("[activityLog] failed to record event:", params.action, err);
  }
}
