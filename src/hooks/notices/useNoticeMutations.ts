import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

import type { PublishNoticeInput } from "./types";
import { attachmentsToJson } from "./types";

/**
 * Publishes a notice and fans out its recipients in one transaction.
 *
 * Idempotent by construction: `noticeId` is generated client-side (so
 * attachments can be uploaded to {notice_id}/... before the row exists), and
 * publish_notice returns early if that id is already present. A double-click or
 * a retry therefore cannot publish twice. The UI still gates on `isPending`.
 */
export function usePublishNotice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PublishNoticeInput) => {
      const { data, error } = await supabase.rpc("publish_notice", {
        _notice_id: input.noticeId,
        _title: input.title,
        _content: input.content,
        _type: input.type,
        _priority: input.priority,
        _scope: input.scope,
        _class_ids: input.classIds ?? undefined,
        _wing_ids: input.wingIds ?? undefined,
        _audience_roles: input.audienceRoles ?? undefined,
        _teacher_ids: input.teacherIds ?? undefined,
        _requires_acknowledgement: input.requiresAcknowledgement ?? false,
        _expires_at: input.expiresAt ?? undefined,
        _attachments: attachmentsToJson(input.attachments),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notices"] });
      toast.success("Notice published");
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't publish that notice.",
        context: "publishNotice",
      }),
  });
}

/**
 * Records that the signed-in user opened a notice, and optionally that they
 * acknowledged it.
 *
 * The RPC uses COALESCE, so re-marking never moves an existing timestamp --
 * opening a notice twice does not inflate reach, and a double-tapped
 * Acknowledge stamps once. notice_recipients has no UPDATE policy, so this is
 * the only write path.
 *
 * Read failures are deliberately silent: a recipient opening a notice should
 * never see a toast about bookkeeping they did not ask for. An explicit
 * acknowledgement DOES surface its error, because the user pressed a button and
 * is owed an answer.
 */
export function useMarkNoticeRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      noticeId,
      acknowledge = false,
    }: {
      noticeId: string;
      acknowledge?: boolean;
    }) => {
      const { error } = await supabase.rpc("mark_notice_read", {
        _notice_id: noticeId,
        _acknowledge: acknowledge,
      });
      if (error) throw error;
      return { acknowledge };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["notices"] });
      if (result.acknowledge) toast.success("Acknowledged");
    },
    onError: (e: Error, variables) => {
      if (!variables.acknowledge) {
        console.error("[markNoticeRead]", e);
        return;
      }
      toastError(e, {
        fallback: "Couldn't record your acknowledgement.",
        context: "acknowledgeNotice",
      });
    },
  });
}
