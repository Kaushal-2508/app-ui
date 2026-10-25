import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * The admission_* RPCs and tables postdate the generated Database types
 * (NEEDS DB, spec docs/superpowers/specs/2026-10-09-admissions-module-design.md).
 * CLAUDE.md 5a: cast narrowly through `unknown`, never widen to `any`. The
 * same shape as hooks/ptm/ptmClient.ts.
 */

export type PgError = { message: string; code?: string };

type RpcResult<T> = { data: T | null; error: PostgrestError | null };
type AdmissionRpc = <T>(fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<T>>;

const rpc = supabase.rpc.bind(supabase) as unknown as AdmissionRpc;

type ProbeFrom = (table: string) => {
  select: (cols: string) => { limit: (n: number) => PromiseLike<{ error: PostgrestError | null }> };
};
export const probeFrom = supabase.from.bind(supabase) as unknown as ProbeFrom;

export async function callAdmissionRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw error;
  return data as T;
}

/** "The migration has not landed yet": unknown table or function, or
 *  PostgREST's schema-cache miss for either. */
export function isMissingSchemaError(error: PgError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703" || error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205") {
    return true;
  }
  return /does not exist|could not find/i.test(error.message);
}

/** Query keys in one place so invalidation never misses a spelling. */
export const admissionKeys = {
  ready: ["admissions-ready", "v1"] as const,
  access: (userId: string | null) => ["admissions-access", userId] as const,
  settings: (institutionId: string | null) => ["admission-settings", institutionId] as const,
  staff: (institutionId: string | null) => ["admission-staff", institutionId] as const,
  pipeline: (institutionId: string | null, filters: Record<string, string | null>) =>
    ["admission-pipeline", institutionId, filters] as const,
  counts: (institutionId: string | null, year: string | null) => ["admission-stage-counts", institutionId, year] as const,
  enquiry: (id: string | null) => ["admission-enquiry", id] as const,
};
