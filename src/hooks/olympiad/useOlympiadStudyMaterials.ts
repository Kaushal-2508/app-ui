import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

const BUCKET = "olympiad-study-material";
const MAX_BYTES = 10 * 1024 * 1024;

export type StudyMaterial = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  title: string;
  description: string | null;
  storage_path: string;
  file_size_bytes: number;
  display_order: number;
  created_at: string;
};

export function useOlympiadStudyMaterials(
  subjectId: string | undefined,
  gradeLevelId: string | undefined,
) {
  return useQuery({
    queryKey: ["olympiad", "study-materials", subjectId, gradeLevelId],
    queryFn: async (): Promise<StudyMaterial[]> => {
      if (!subjectId || !gradeLevelId) return [];
      const { data, error } = await supabase
        .from("oly_study_materials")
        .select(
          "id, subject_id, grade_level_id, title, description, storage_path, file_size_bytes, display_order, created_at",
        )
        .eq("subject_id", subjectId)
        .eq("grade_level_id", gradeLevelId)
        .order("display_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as StudyMaterial[];
    },
    enabled: !!subjectId && !!gradeLevelId,
    staleTime: 60_000,
  });
}

export function useUploadStudyMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      subjectId: string;
      gradeLevelId: string;
      title: string;
      description: string | null;
      displayOrder: number;
      file: File;
    }) => {
      if (input.file.size > MAX_BYTES) throw new Error("File exceeds 10 MB limit");
      if (input.file.type !== "application/pdf") throw new Error("Only PDF files are accepted");

      // Sanitize filename: keep only alphanumeric, dots, dashes, underscores
      const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${input.subjectId}/${input.gradeLevelId}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("oly_study_materials").insert({
        subject_id: input.subjectId,
        grade_level_id: input.gradeLevelId,
        title: input.title,
        description: input.description,
        storage_path: path,
        file_size_bytes: input.file.size,
        display_order: input.displayOrder,
      });
      if (insErr) {
        // Best-effort cleanup: remove the uploaded file if the metadata insert fails.
        await supabase.storage.from(BUCKET).remove([path]);
        throw insErr;
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["olympiad", "study-materials", vars.subjectId, vars.gradeLevelId],
      });
      toast.success("Study material uploaded");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't upload material.", context: "useUploadStudyMaterial" }),
  });
}

export function useDeleteStudyMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      const { error: dbErr } = await supabase.from("oly_study_materials").delete().eq("id", id);
      if (dbErr) throw dbErr;
      // Best-effort storage cleanup. An orphaned file is invisible to users.
      await supabase.storage.from(BUCKET).remove([storagePath]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "study-materials"] });
      toast.success("Material deleted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't delete material.", context: "useDeleteStudyMaterial" }),
  });
}

export async function getStudyMaterialSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error) throw error;
  return data.signedUrl;
}
