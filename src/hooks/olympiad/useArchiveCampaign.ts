import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id }: { oly_school_id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // Fetch campaign_id for the audit row (oly_audit_log.campaign_id is NOT NULL)
      const { data: school, error: lookupErr } = await supabase
        .from("oly_schools")
        .select("campaign_id")
        .eq("id", oly_school_id)
        .single();
      if (lookupErr) throw lookupErr;

      const { error: updErr } = await supabase
        .from("oly_schools")
        .update({ status: "archived" })
        .eq("id", oly_school_id);
      if (updErr) throw updErr;

      const { error: auditErr } = await supabase.from("oly_audit_log").insert({
        campaign_id: school.campaign_id,
        oly_school_id,
        actor_id: user.id,
        actor_role: "super_admin",
        action: "campaign_archived",
      });
      if (auditErr) {
        // Audit failure is logged but doesn't roll back the archive (already succeeded).
        console.error("[useArchiveCampaign] audit insert failed", auditErr.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success("Campaign archived");
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't archive campaign.",
        context: "useArchiveCampaign",
      }),
  });
}
