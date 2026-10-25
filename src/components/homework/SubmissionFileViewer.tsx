import { useEffect, useState } from "react";
import { Download, FileText, Image as ImageIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";

export interface SubmissionFileMeta {
  id: string;
  name: string;
  mime: string;
  storagePath: string;
}

export interface SubmissionFileViewerProps {
  files: SubmissionFileMeta[];
  /** Resolve a (short-lived) URL for a file. MUST be a stable reference
   *  (wrap in useCallback) — it's a thumbnail-effect dependency. */
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
  className?: string;
}

/** Lazy-loads a signed URL for an image file and renders a thumbnail.
 *  Mirrors HybridWaitingForUpload's PageThumbnail cancellation idiom. */
function ImageFileRow({
  file,
  getUrl,
}: {
  file: SubmissionFileMeta;
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getUrl(file)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file, getUrl]);

  return (
    <div className="surface-card frosted-shadow rounded-xl p-3">
      <div className="overflow-hidden rounded-lg bg-muted">
        <div className="flex aspect-[3/4] w-full items-center justify-center">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
              <img
                src={url}
                alt={file.name}
                className="h-full w-full object-cover"
                onError={() => setFailed(true)}
              />
            </a>
          ) : failed ? (
            <ImageIcon className="h-7 w-7 text-ink-400" aria-hidden />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-ink-400" aria-hidden />
          )}
        </div>
      </div>
      <p className="mt-2 truncate text-[13px] leading-[18px] text-ink-700" title={file.name}>
        {file.name}
      </p>
    </div>
  );
}

/** A non-image file: icon + name + on-demand "Download" (opens a signed URL in a new tab). */
function DocumentFileRow({
  file,
  getUrl,
}: {
  file: SubmissionFileMeta;
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
}) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const url = await getUrl(file);
      openExternal(url);
    } catch (err) {
      toastError(err instanceof Error ? err : new Error("Couldn't open the file."), {
        fallback: "Couldn't open the file.",
        context: "submissionFileDownload",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-card frosted-shadow flex items-center gap-3 rounded-xl p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <p
        className="min-w-0 flex-1 truncate text-[14px] leading-[20px] text-ink-900"
        title={file.name}
      >
        {file.name}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={loading}
        onClick={handleDownload}
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="mr-1.5 h-4 w-4" aria-hidden />
        )}
        Download
      </Button>
    </div>
  );
}

/** Shared viewer for submission files: inline thumbnails for images, download rows for everything
 *  else. Resolution of the (short-lived) URL is delegated to `getUrl` so the same component works
 *  for a student's own files (direct createSignedUrl) and teacher-viewed files (edge fn). */
export function SubmissionFileViewer({ files, getUrl, className }: SubmissionFileViewerProps) {
  if (files.length === 0) return null;

  const images = files.filter((f) => f.mime.startsWith("image/"));
  const documents = files.filter((f) => !f.mime.startsWith("image/"));

  return (
    <div className={cn("space-y-3", className)}>
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((file) => (
            <ImageFileRow key={file.id} file={file} getUrl={getUrl} />
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((file) => (
            <DocumentFileRow key={file.id} file={file} getUrl={getUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
