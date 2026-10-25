import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";
import { forgetAvatar } from "@/lib/avatarStore";
import { prepareAvatarFile } from "@/lib/avatarImage";

const BUCKET = "user-avatars";

interface AvatarTarget {
  targetId: string;
  targetName?: string | null;
  institutionId?: string | null;
}

interface SetAvatarInput extends AvatarTarget {
  file: File;
}

/** Server-authoritative. The client flag is only a UX affordance; the RPC and
 *  the trg_enforce_avatar_path_authority trigger are the real gates. */
export function useCanSetUserPhoto(targetId?: string | null) {
  return useQuery({
    queryKey: ["can-set-user-photo", targetId],
    enabled: !!targetId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("can_i_set_user_photo", {
        _target: targetId as string,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // Best effort. An orphaned object costs ~10 KB and nothing else.
  }
}

function invalidateAvatarQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  targetId: string,
): void {
  queryClient.invalidateQueries({ queryKey: ["user-details", targetId] });
  queryClient.invalidateQueries({ queryKey: ["profile-data"] });
  queryClient.invalidateQueries({ queryKey: ["school-students"] });
  queryClient.invalidateQueries({ queryKey: ["can-set-user-photo", targetId] });
}

export function useSetUserAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetId, file }: SetAvatarInput) => {
      const prepared = await prepareAvatarFile(file);

      // A fresh uuid per upload keeps every object immutable, which is what lets
      // the on-device cache never go stale and needs no cache-busting.
      const path = `${targetId}/${crypto.randomUUID()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, prepared, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: previousPath, error: rpcError } = await supabase.rpc("set_user_avatar", {
        _target: targetId,
        _path: path,
      });

      if (rpcError) {
        // Never leave an orphan behind a failed write.
        await removeQuietly(path);
        throw rpcError;
      }

      return { path, previousPath: (previousPath as string | null) ?? null };
    },

    onSuccess: async (result, input) => {
      if (result.previousPath) {
        await forgetAvatar(result.previousPath);
        await removeQuietly(result.previousPath);
      }
      invalidateAvatarQueries(queryClient, input.targetId);
      toast.success("Photo updated");
      void logActivityEvent({
        action: "user_photo_updated",
        entityType: "User",
        entityId: input.targetId,
        entityName: input.targetName ?? null,
        // School admins read system_audit_logs by metadata->>'institution_id',
        // so omitting this hides the row from every admin who is not the actor.
        metadata: { institution_id: input.institutionId ?? null },
      });
    },

    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the photo.", context: "setUserAvatar" }),
  });
}

export function useClearUserAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetId }: AvatarTarget) => {
      const { data: previousPath, error } = await supabase.rpc("clear_user_avatar", {
        _target: targetId,
      });
      if (error) throw error;
      return { previousPath: (previousPath as string | null) ?? null };
    },

    onSuccess: async (result, input) => {
      if (result.previousPath) {
        await forgetAvatar(result.previousPath);
        await removeQuietly(result.previousPath);
      }
      invalidateAvatarQueries(queryClient, input.targetId);
      toast.success("Photo removed");
      void logActivityEvent({
        action: "user_photo_removed",
        entityType: "User",
        entityId: input.targetId,
        entityName: input.targetName ?? null,
        metadata: { institution_id: input.institutionId ?? null },
      });
    },

    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't remove the photo.", context: "clearUserAvatar" }),
  });
}
