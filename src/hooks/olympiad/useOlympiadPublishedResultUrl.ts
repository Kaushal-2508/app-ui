import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

const BUCKET = "olympiad-receipts";

export function useOlympiadPublishedResultUrl() {
  return useMutation({
    mutationFn: async ({
      resultId,
      kind,
    }: {
      resultId: string;
      kind: "result" | "certificate";
    }): Promise<string> => {
      const { data: pathData, error: pathErr } = await supabase.rpc(
        "oly_get_published_signed_url_path",
        { p_result_id: resultId, p_kind: kind },
      );
      if (pathErr) throw pathErr;
      if (!pathData) throw new Error("PDF not generated yet");
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(pathData as string, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't open PDF.",
        context: "useOlympiadPublishedResultUrl",
      }),
  });
}
