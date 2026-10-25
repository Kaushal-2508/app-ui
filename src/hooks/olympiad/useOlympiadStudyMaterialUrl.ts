import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

const BUCKET = "olympiad-study-material";

export function useOlympiadStudyMaterialUrl() {
  return useMutation({
    mutationFn: async (materialId: string): Promise<string> => {
      // Step 1: server-side eligibility check via SECURITY DEFINER RPC
      const { data: pathData, error: pathErr } = await supabase.rpc("oly_get_student_study_material_path", {
        p_material_id: materialId,
      });
      if (pathErr) throw pathErr;
      if (!pathData) throw new Error("Material not accessible");

      // Step 2: client-side signed URL generation (5 min TTL)
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathData as string, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't open study material.", context: "useOlympiadStudyMaterialUrl" }),
  });
}
