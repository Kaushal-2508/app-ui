import { supabase } from "@/integrations/supabase/client";

type HeadCountChain = PromiseLike<{ count: number | null; error: { message: string } | null }> & {
  eq: (column: string, value: string | number | boolean) => HeadCountChain;
};

// Minimal structural view of the client for HEAD count queries only. Exists
// because `.select(col, { count: "exact", head: true })` chained with .eq()
// trips TS2589 ("type instantiation is excessively deep") on relationship-
// heavy tables (final_results, teacher_overrides) — the generated builder
// generics blow the instantiation budget. Narrow cast per §5a (unknown +
// structural type, never `any`); the runtime call is unchanged PostgREST.
const headClient = supabase as unknown as {
  from(table: string): {
    select(columns: string, opts: { count: "exact"; head: true }): HeadCountChain;
  };
};

/**
 * Server-side row count (HEAD request — no rows shipped) with equality
 * filters. Use for every "count things" need instead of fetching rows and
 * taking .length (§23: aggregate server-side).
 */
export async function headCount(
  table: string,
  filters: Record<string, string | number | boolean>,
): Promise<number> {
  let chain = headClient.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    chain = chain.eq(column, value);
  }
  const { count, error } = await chain;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
