import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressSheetToBase64 } from "@/lib/hybridImage";

/**
 * Authenticated own-device sheet upload (flow correction, Phase 3).
 *
 * For the student's OWN logged-in device — the phone they wrote on, or a laptop
 * uploading files from local storage. Calls the `upload-hybrid-sheet` edge
 * function (JWT auth). The separate paired-phone path keeps using
 * useUploadHybridPage (token plane).
 */

async function unwrapFunctionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error : new Error("Unknown error");
}

export interface UploadHybridSheetArgs {
  attemptId: string;
  pageNumber: number;
  file: File | Blob;
}

export interface UploadHybridSheetResult {
  page_id: string;
  storage_path: string;
  page_number: number;
  attempt_status: string;
}

export function useUploadHybridSheetAuthed() {
  return useMutation<UploadHybridSheetResult, Error, UploadHybridSheetArgs>({
    mutationFn: async ({ attemptId, pageNumber, file }) => {
      const { base64, sizeBytes } = await compressSheetToBase64(file);
      const { data, error } = await supabase.functions.invoke("upload-hybrid-sheet", {
        body: {
          attempt_id: attemptId,
          page_number: pageNumber,
          file_base64: base64,
          file_size_bytes: sizeBytes,
          content_type: "image/jpeg",
        },
      });
      if (error) throw await unwrapFunctionError(error);
      return data as UploadHybridSheetResult;
    },
  });
}