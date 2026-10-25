import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

// Supabase's standard POST upload endpoint has a hard 50 MB request-body
// cap that bucket-level `file_size_limit` cannot raise. The resumable /
// TUS endpoint (`/storage/v1/upload/resumable`) accepts files up to 5 GB
// (subject to the bucket's own `file_size_limit`). This helper uses the
// resumable path for everything, so a single code path supports small and
// large uploads uniformly without us having to maintain a size-threshold
// dispatch.

export interface ResumableUploadOptions {
  bucket: string;
  /** Object path inside the bucket, e.g. `materials/123/foo.pdf`. */
  path: string;
  file: File;
  /** Default false — set to true to overwrite an existing object. */
  upsert?: boolean;
  contentType?: string;
  /** Optional progress callback invoked as bytes upload. */
  onProgress?: (uploaded: number, total: number) => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

export async function uploadResumable({
  bucket,
  path,
  file,
  upsert = false,
  contentType,
  onProgress,
}: ResumableUploadOptions): Promise<void> {
  if (!SUPABASE_URL) {
    throw new Error("Missing VITE_SUPABASE_URL — cannot resolve resumable upload endpoint.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("Not authenticated. Sign in before uploading.");
  }

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": upsert ? "true" : "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: contentType || file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      // 6 MB — the Supabase-recommended chunk size for resumable uploads.
      chunkSize: 6 * 1024 * 1024,
      onError: (err) => reject(err),
      onProgress: onProgress
        ? (bytesUploaded, bytesTotal) => onProgress(bytesUploaded, bytesTotal)
        : undefined,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

/** Convenience wrapper that uploads then returns the public URL. */
export async function uploadResumableAndGetPublicUrl(
  opts: ResumableUploadOptions,
): Promise<string> {
  await uploadResumable(opts);
  const { data } = supabase.storage.from(opts.bucket).getPublicUrl(opts.path);
  return data.publicUrl;
}
