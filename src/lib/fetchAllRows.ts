/**
 * Page through a PostgREST read until it runs dry.
 *
 * Supabase's API clips EVERY request to `max-rows` (1000 on this project),
 * and it does so even when the request carries a bigger Range. So
 * `.range(0, 49999)` is not pagination: it is one request that comes back
 * with the first 1000 rows and no error. That is how the institutions grid
 * and the institution detail sheet both under-counted Alliance (2026-09-26:
 * "Total Users 1000", "Total Exams 1000", 465 students on the card against
 * 947 in the sheet, all three wrong).
 *
 * The caller builds one page at a time from the `(from, to)` bounds. The
 * builder MUST include a stable `.order(...)` (an `id` tie-breaker at least):
 * without one Postgres is free to return rows in a different order on every
 * page and a row can be skipped or counted twice.
 *
 * This still ships every row to the browser. It is the frontend-only
 * stop-gap; a grouped count RPC is the real fix (§23 item 2).
 */

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface FetchAllRowsOptions {
  /** Rows per request. Never above the project's max-rows (1000). */
  pageSize?: number;
  /** Hard stop so a mis-built query cannot loop forever. */
  maxRows?: number;
}

export const POSTGREST_MAX_ROWS = 1000;

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = POSTGREST_MAX_ROWS, maxRows = 100_000 }: FetchAllRowsOptions = {},
): Promise<T[]> {
  const size = Math.min(pageSize, POSTGREST_MAX_ROWS);
  const rows: T[] = [];
  let from = 0;

  while (from < maxRows) {
    const { data, error } = await buildPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < size) break;
    from += size;
  }

  return rows;
}
