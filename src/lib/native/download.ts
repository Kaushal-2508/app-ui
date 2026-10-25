import { toastError } from "@/lib/toast";

import { nativePlugin } from "./platform";

/**
 * Hand the user a file: a PDF, an XLSX, a CSV template, a QR image.
 *
 * Web: the blob-URL + `<a download>` click every export used to write by
 * hand (22 copies of it). Native: `Filesystem` writes the bytes to the app
 * cache and `Share` opens the share sheet (Save to Files / Drive / WhatsApp),
 * because a WebView ignores `download` and has no downloads UI.
 *
 * Callers produce a Blob and stop there; the delivery is this module's job.
 */

type FilesystemPlugin = {
  writeFile(o: { path: string; data: string; directory: "CACHE" | "DOCUMENTS"; recursive?: boolean }): Promise<{ uri: string }>;
};
type SharePlugin = {
  share(o: { title?: string; text?: string; url?: string; dialogTitle?: string }): Promise<unknown>;
};

export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;

  const fs = nativePlugin<FilesystemPlugin>("Filesystem");
  const share = nativePlugin<SharePlugin>("Share");
  if (fs && share) {
    void shareNatively(fs, share, blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoke on the next tick: Safari cancels the download if the URL dies
    // in the same task as the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function shareNatively(fs: FilesystemPlugin, share: SharePlugin, blob: Blob, filename: string) {
  try {
    const data = await blobToBase64(blob);
    // A per-save folder so two exports with the same name never collide.
    const path = `salci-exports/${Date.now().toString(36)}/${sanitize(filename)}`;
    const { uri } = await fs.writeFile({ path, data, directory: "CACHE", recursive: true });
    await share.share({ title: filename, url: uri, dialogTitle: "Save or share" });
  } catch (err) {
    // The user closing the share sheet is not an error worth a toast.
    if (isShareCancelled(err)) return;
    toastError(err, { fallback: "Couldn't prepare the file for sharing.", context: "saveBlob.native" });
  }
}

function isShareCancelled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(msg);
}

function sanitize(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "file";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Same delivery for content that already is a data: URL (canvas exports). */
export function saveDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === "undefined") return;
  const fs = nativePlugin<FilesystemPlugin>("Filesystem");
  const share = nativePlugin<SharePlugin>("Share");
  if (fs && share) {
    const comma = dataUrl.indexOf(",");
    const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? "application/octet-stream";
    const bytes = atob(dataUrl.slice(comma + 1));
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    void shareNatively(fs, share, new Blob([buf], { type: mime }), filename);
    return;
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Convenience for text exports (CSV, TXT) so callers do not repeat the MIME. */
export function saveText(text: string, filename: string, mime = "text/plain;charset=utf-8"): void {
  saveBlob(new Blob([text], { type: mime }), filename);
}
