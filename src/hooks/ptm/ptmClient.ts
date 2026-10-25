import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * The PTM RPCs and the new ptm_* columns postdate the generated Database
 * types: Tushar's migration lands after this frontend (NEEDS DB, spec
 * docs/superpowers/specs/2026-09-28-ptm-module-design.md). CLAUDE.md 5a:
 * cast narrowly through `unknown`, never widen to `any`. This is the one
 * place that names the untyped call, the same shape usePTM.ts used for
 * create_ptm_schedule and useSupportSop.ts uses for its columns.
 */

export type PgError = { message: string; code?: string };

type RpcResult<T> = { data: T | null; error: PostgrestError | null };
type PtmRpc = <T>(fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<T>>;

const rpc = supabase.rpc.bind(supabase) as unknown as PtmRpc;

/** `from()` on a table the generated types do not know yet (the class
 *  sessions of 2026-10-06), narrowed to the two calls the probe makes. */
type PtmProbeFrom = (table: string) => {
  select: (cols: string) => { limit: (n: number) => PromiseLike<{ error: PostgrestError | null }> };
};
export const probeFrom = supabase.from.bind(supabase) as unknown as PtmProbeFrom;

export async function callPtmRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw error;
  return data as T;
}

/**
 * "The migration has not landed yet": an unknown column (42703), an unknown
 * function (42883), or PostgREST's schema-cache miss for either (PGRST202,
 * PGRST204). The probe treats every one of these as NO.
 */
export function isMissingSchemaError(error: PgError | null | undefined): boolean {
  if (!error) return false;
  if (
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST204"
  ) {
    return true;
  }
  return /does not exist|could not find/i.test(error.message);
}

/** Query keys in one place so invalidation never misses a spelling. */
export const ptmKeys = {
  // "v2": the probe's answer changed from a boolean to a level (2026-10-03),
  // and the persisted query cache would otherwise restore the old shape.
  ready: ["ptm-ready", "v2"] as const,
  schedules: (institutionId: string | null, level: string) =>
    ["ptm-schedules", institutionId, level] as const,
  schedule: (ptmId: string | null, level: string) => ["ptm-schedule", ptmId, level] as const,
  scope: (hat: string | null) => ["ptm-scope", hat] as const,
  grid: (ptmId: string | null, classId: string | null) =>
    ["ptm-booking-grid", ptmId, classId] as const,
  myBookings: ["ptm-my-bookings"] as const,
  // Online (residential) PTMs.
  onlineTeacherOptions: (hat: string | null) => ["ptm-online-teacher-options", hat] as const,
  busyWindows: (date: string | null, excludePtmId: string | null) =>
    ["ptm-teacher-busy-windows", date, excludePtmId] as const,
  onlinePickOptions: (ptmId: string | null, classSessionId: string | null = null) =>
    ["ptm-online-pick-options", ptmId, classSessionId] as const,
  onlineSessions: (ptmId: string | null) => ["ptm-online-sessions", ptmId] as const,
  onlineGrid: (ptmId: string | null, teacherId: string | null, classSessionId: string | null = null) =>
    ["ptm-online-grid", ptmId, teacherId, classSessionId] as const,
  onlineMySessions: ["ptm-online-my-sessions"] as const,
  googleEmail: (userId: string | null) => ["profile-google-email", userId] as const,
  feedbackToken: (token: string | null) => ["ptm-feedback-token", token] as const,
  openForFeedback: ["ptm-open-for-feedback"] as const,
  summary: (ptmId: string | null, hat: string | null) =>
    ["ptm-feedback-summary", ptmId, hat] as const,
  list: (ptmId: string | null, hat: string | null, filters: unknown, page: number) =>
    ["ptm-feedback-list", ptmId, hat, filters, page] as const,
};
