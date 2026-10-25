import { useInfiniteQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type { DiaryEntry, DiaryFeedFilters } from "./types";

const PAGE_SIZE = 20;

/** Keyset cursor on (created_at DESC, id DESC); never an OFFSET (§23). */
type Cursor = { createdAt: string; id: string } | null;

interface DiaryFeedArgs {
  _class_id?: string;
  _student_id?: string;
  _kind?: string;
  _before_created_at?: string;
  _before_id?: string;
  _limit: number;
}

/** Generated types lag the diary RPCs until the migration is applied and
 *  `supabase gen types` runs. Narrow structural cast per CLAUDE.md §5a, never
 *  `as any`. Drop this once the types carry `diary_feed`. */
type DiaryFeedClient = {
  rpc(
    fn: "diary_feed",
    args: DiaryFeedArgs,
  ): PromiseLike<{
    data: DiaryEntry[] | null;
    error: { message: string; code?: string } | null;
  }>;
};

/**
 * The diary, newest first, scoped server-side by role: a student sees entries
 * addressed to them or to their class; a teacher sees entries for classes they
 * teach; a coordinator their wings; an admin the whole school. Optional filters
 * narrow within that scope and are applied in SQL, so paging past the first
 * screen still returns matches.
 */
export function useDiaryFeed(filters: DiaryFeedFilters, enabled = true) {
  const classId = filters.classId ?? null;
  const studentId = filters.studentId ?? null;
  const kind = filters.kind ?? null;

  return useInfiniteQuery({
    queryKey: ["diary", "feed", classId, studentId, kind],
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<{ rows: DiaryEntry[]; nextCursor: Cursor }> => {
      const client = supabase as unknown as DiaryFeedClient;
      const { data, error } = await client.rpc("diary_feed", {
        _class_id: classId ?? undefined,
        _student_id: studentId ?? undefined,
        _kind: kind ?? undefined,
        _before_created_at: pageParam?.createdAt ?? undefined,
        _before_id: pageParam?.id ?? undefined,
        _limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows = data ?? [];
      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          rows.length === PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null,
      };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
