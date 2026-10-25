import { supabase } from "@/integrations/supabase/client";
import type { NoticeAttachment } from "@/hooks/notices/types";

const BUCKET = "notice-attachments";

/** Signed URLs are short-lived on purpose: the link is minted when the viewer
 *  opens the notice, so a copied URL stops working quickly. */
const SIGNED_URL_TTL_SECONDS = 300;

/** Keeps a filename recognisable while stripping anything that would break a
 *  storage path. */
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120);
}

/**
 * Uploads one file into `{noticeId}/...`.
 *
 * The notice id is generated BEFORE the notice row exists, which is what lets
 * attachments upload during composing and what makes publish_notice idempotent.
 * The storage read policy resolves that first path segment back to a notice and
 * runs can_view_notice() on it, so an attachment is exactly as visible as the
 * notice it belongs to -- never world-readable by URL, which is what the old
 * public `circular-attachments` bucket was.
 */
export async function uploadNoticeAttachment(
  noticeId: string,
  file: File,
): Promise<NoticeAttachment> {
  const path = `${noticeId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return {
    path,
    name: file.name,
    size: file.size,
    mime: file.type || undefined,
  };
}

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".svg",
];

/** Whether this attachment should render as a picture rather than a download
 *  row. Trusts the recorded mime type first and falls back to the extension,
 *  because legacy entries carry neither a mime nor a size. */
export function isImageAttachment(attachment: NoticeAttachment): boolean {
  if (attachment.mime) return attachment.mime.startsWith("image/");
  const name = (attachment.name ?? attachment.path ?? "").toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Resolves every attachment on a notice in ONE round trip.
 *
 * `createSignedUrls` (plural) signs a whole batch, so a notice with five
 * attachments costs one storage call rather than five. Legacy entries are
 * folded in without a call at all -- their bytes still live in the old public
 * bucket, so the stored URL is already usable.
 *
 * Returns a map keyed by `path` (or by `legacy_url` for legacy entries), with
 * `null` for anything that could not be signed, so one bad file cannot blank
 * the whole list.
 */
export async function resolveNoticeAttachmentUrls(
  attachments: NoticeAttachment[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};

  for (const a of attachments) {
    if (a.legacy_url) out[a.legacy_url] = a.legacy_url;
  }

  const paths = attachments
    .filter((a) => !a.legacy_url && a.path)
    .map((a) => a.path as string);
  if (paths.length === 0) return out;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  for (const entry of data ?? []) {
    // `path` comes back on each entry; fall back to positional matching if a
    // future client version stops returning it.
    const key = entry.path ?? "";
    if (key) out[key] = entry.signedUrl ?? null;
  }
  for (const p of paths) if (!(p in out)) out[p] = null;

  return out;
}

/** Stable lookup key for an attachment in the map above. */
export function attachmentKey(attachment: NoticeAttachment): string {
  return attachment.legacy_url ?? attachment.path ?? attachment.name;
}

/** Best-effort cleanup for files uploaded during a compose that was abandoned
 *  or failed to publish. A leftover object is harmless -- it is unreachable
 *  without a notice row for the read policy to resolve -- so failures here are
 *  swallowed rather than shown to the author. */
export async function removeNoticeAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch (err) {
    console.error("[removeNoticeAttachments]", err);
  }
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
