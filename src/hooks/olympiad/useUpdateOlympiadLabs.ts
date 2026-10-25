import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

/**
 * Persists the per-lab PC breakdown from the Labs & PCs page.
 *
 * School admins have NO direct UPDATE on oly_schools (RLS = super_admin ALL +
 * SELECT-only for everyone else), so a plain table update was silently dropped
 * (0 rows, no error) and pc_count stayed NULL. We go through the
 * `oly_set_lab_capacity` SECURITY DEFINER RPC, which runs the admin check and
 * writes pc_count (= sum) + lab_pc_counts in one shot.
 */
export function useUpdateOlympiadLabs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ olySchoolId, labPcCounts }: { olySchoolId: string; labPcCounts: number[] }) => {
      // oly_set_lab_capacity (migration 20260620130000) isn't in generated types
      // yet — cast the name/args, but keep the call ON `supabase` so the client's
      // `this` binding (and its internal `.rest`) is preserved.
      const { error } = await supabase.rpc("oly_set_lab_capacity" as never, {
        p_oly_school_id: olySchoolId,
        p_lab_pc_counts: labPcCounts,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["olympiad", "my-school"] }),
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save lab setup.", context: "useUpdateOlympiadLabs" }),
  });
}
