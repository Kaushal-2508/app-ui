import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError, toastSuccess } from "@/lib/toast";

const BUCKET = "institution-logos";
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

function extFor(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  throw new Error(`Unsupported logo MIME: ${file.type}`);
}

export class LogoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoValidationError";
  }
}

export function useUploadInstitutionLogo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ institutionId, file }: { institutionId: string; file: File }) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new LogoValidationError("Logo must be a PNG, JPG, or WebP image.");
      }
      if (file.size > MAX_BYTES) {
        throw new LogoValidationError("Logo must be 2 MB or smaller.");
      }

      const path = `${institutionId}/logo.${extFor(file)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // Cache-bust so the new logo replaces a previously cached one.
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: dbError } = await supabase
        .from("institutions")
        .update({ logo_url: url })
        .eq("id", institutionId);

      if (dbError) {
        // Best-effort cleanup of the orphaned storage object.
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw dbError;
      }

      // Best-effort: clean up any prior logo files that used a different extension.
      const otherExts = ALLOWED_TYPES
        .map(t => extFor({ type: t } as File))
        .filter(e => e !== extFor(file));
      const stalePaths = otherExts.map(e => `${institutionId}/logo.${e}`);
      await supabase.storage.from(BUCKET).remove(stalePaths).catch(() => {});

      return url;
    },
    onSuccess: (_url, { institutionId }) => {
      toastSuccess("Logo updated");
      qc.invalidateQueries({ queryKey: ["institution-logo", institutionId] });
      qc.invalidateQueries({ queryKey: ["admin-institutions"] });
      qc.invalidateQueries({ queryKey: ["header-institution"] });
      qc.invalidateQueries({ queryKey: ["institution-edit", institutionId] });
    },
    onError: (e: Error) => {
      if (e instanceof LogoValidationError) {
        // Surface validation errors as inline form messages — no toast.
        return;
      }
      toastError(e, { fallback: "Couldn't upload logo.", context: "uploadInstitutionLogo" });
    },
  });
}

export function useRemoveInstitutionLogo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ institutionId }: { institutionId: string }) => {
      const { error: dbError } = await supabase
        .from("institutions")
        .update({ logo_url: null })
        .eq("id", institutionId);
      if (dbError) throw dbError;

      // Storage path is deterministic: {institutionId}/logo.{png|jpg|webp}.
      // Best-effort remove all three — extension was lost when DB cleared.
      const allExts = ["png", "jpg", "webp"];
      const paths = allExts.map(e => `${institutionId}/logo.${e}`);
      await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    },
    onSuccess: (_v, { institutionId }) => {
      toastSuccess("Logo removed");
      qc.invalidateQueries({ queryKey: ["institution-logo", institutionId] });
      qc.invalidateQueries({ queryKey: ["admin-institutions"] });
      qc.invalidateQueries({ queryKey: ["header-institution"] });
      qc.invalidateQueries({ queryKey: ["institution-edit", institutionId] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't remove logo.", context: "removeInstitutionLogo" }),
  });
}
