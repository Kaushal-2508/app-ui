import { supabase } from "@/integrations/supabase/client";
import type { SourcePaperFile } from "@/types/exam";

const BUCKET = "exam-sheets";

/** Upload one paper file to the public exam-sheets bucket and return its reference. */
export async function uploadExamPaperFile(
  file: File,
  institutionId: string,
): Promise<SourcePaperFile> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${institutionId}/${crypto.randomUUID()}_${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: contentType, size: file.size };
}

/** Public URL for a stored paper file. */
export function getExamPaperUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
