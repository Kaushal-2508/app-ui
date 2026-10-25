import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

import type { WriteDiaryEntriesInput, WriteDiaryEntryInput } from "./types";
import {
  DIARY_MULTI_UNAVAILABLE_MESSAGE,
  DIARY_UNAVAILABLE_MESSAGE,
  isDiaryUnavailableError,
} from "./types";

type RpcResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string; code?: string } | null;
}>;

/** A missing RPC is not the user's fault and not a transient failure; say so
 *  in plain words rather than leaking "Could not find the function…". */
function friendly(e: Error): Error {
  return isDiaryUnavailableError(e) ? new Error(DIARY_UNAVAILABLE_MESSAGE) : e;
}

/** Generated types lag the diary RPCs until the migration is applied and
 *  `supabase gen types` runs. Narrow structural cast per CLAUDE.md §5a, never
 *  `as any`. Drop once the types carry these functions. */
type DiaryWriteClient = {
  rpc(
    fn: "diary_write_entry",
    args: {
      _entry_id: string;
      _class_id: string;
      _student_id?: string;
      _kind: string;
      _title: string;
      _body: string;
      _due_date?: string;
    },
  ): RpcResult<string>;
  rpc(
    fn: "diary_write_entries",
    args: {
      _entry_ids: string[];
      _class_id: string;
      _student_ids: string[];
      _kind: string;
      _title: string;
      _body: string;
      _due_date?: string;
    },
  ): RpcResult<string[]>;
  rpc(fn: "diary_delete_entry", args: { _entry_id: string }): RpcResult<null>;
};

/**
 * Writes one diary entry for a class or a single student.
 *
 * Idempotent by construction: the id is generated client-side and the RPC
 * returns early when it already exists, so a double-tap or a retry cannot
 * write twice. The RPC also fans out an in-app notification to the addressed
 * students in the same transaction (see the spec), so the client never does.
 */
export function useWriteDiaryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: WriteDiaryEntryInput) => {
      const client = supabase as unknown as DiaryWriteClient;
      const { data, error } = await client.rpc("diary_write_entry", {
        _entry_id: input.entryId,
        _class_id: input.classId,
        _student_id: input.studentId ?? undefined,
        _kind: input.kind,
        _title: input.title,
        _body: input.body,
        _due_date: input.dueDate ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diary"] });
      toast.success("Added to the diary");
    },
    onError: (e: Error) =>
      toastError(friendly(e), {
        fallback: "Couldn't save that diary entry.",
        context: "writeDiaryEntry",
      }),
  });
}

/**
 * Writes the same entry for two or more students of one class: one copy per
 * student, all in ONE server transaction, so either every student gets it or
 * none does (CLAUDE.md section 9a; never a loop of single writes from here).
 * Each copy is idempotent on its client-generated id, like the single write,
 * and the RPC notifies each student as `diary_write_entry` does.
 *
 * `diary_write_entries` is live since 20261001120000. It checks every student
 * first and, if any is refused, writes nothing and names them (a short P0001
 * message toastError shows as written). The "no such function" message stays
 * for a database restored without it; the diary itself would still work.
 */
export function useWriteDiaryEntries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: WriteDiaryEntriesInput) => {
      const client = supabase as unknown as DiaryWriteClient;
      const { data, error } = await client.rpc("diary_write_entries", {
        _entry_ids: input.entryIds,
        _class_id: input.classId,
        _student_ids: input.studentIds,
        _kind: input.kind,
        _title: input.title,
        _body: input.body,
        _due_date: input.dueDate ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["diary"] });
      toast.success(`Added to the diary for ${input.studentIds.length} students`);
    },
    onError: (e: Error) =>
      toastError(isDiaryUnavailableError(e) ? new Error(DIARY_MULTI_UNAVAILABLE_MESSAGE) : e, {
        fallback: "Couldn't save that diary entry.",
        context: "writeDiaryEntries",
      }),
  });
}

/** Removes an entry. The RPC allows the author or an institution admin. */
export function useDeleteDiaryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entryId: string) => {
      const client = supabase as unknown as DiaryWriteClient;
      const { error } = await client.rpc("diary_delete_entry", { _entry_id: entryId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diary"] });
      toast.success("Entry removed");
    },
    onError: (e: Error) =>
      toastError(friendly(e), {
        fallback: "Couldn't remove that entry.",
        context: "deleteDiaryEntry",
      }),
  });
}
