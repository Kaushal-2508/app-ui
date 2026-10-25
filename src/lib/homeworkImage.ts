import { resizeImageForUpload } from "@/utils/imageResize";

/**
 * Photos attached to homework are compressed on the device before upload.
 *
 * Until 2026-09-24 the teacher's attachment went up byte for byte: a phone
 * photo is 3 to 8 MB against a 10 MB bucket cap, and an iPhone HEIC was refused
 * outright because the `homework-files` allowlist (four synced copies, see the
 * homework-module skill, invariant 11) has no HEIC entry. The compressor
 * (compressorjs) already serves avatars, question diagrams and the hybrid
 * answer-sheet camera, so it is in the app bundle; this file only points the
 * homework path at it.
 *
 * Output is always JPEG, so nothing new has to be added to the allowlist:
 * HEIC is converted, large PNG and WebP photos are re-encoded. Small images are
 * left exactly as they are, because a screenshot of text loses more to JPEG
 * than it gains, and GIFs are never touched (re-encoding drops the animation).
 */

/** Raw input we are willing to decode. Documents keep the bucket's own 10 MB. */
export const HOMEWORK_IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Longest edge after compression; a worksheet stays legible at this size. */
export const HOMEWORK_IMAGE_MAX_EDGE = 2000;
export const HOMEWORK_IMAGE_QUALITY = 0.82;
/** Below this an image is uploaded as it is. */
export const HOMEWORK_IMAGE_COMPRESS_ABOVE_BYTES = 800 * 1024;

const HEIC_MIME = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const COMPRESSIBLE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isHeicImage(file: File): boolean {
  if (HEIC_MIME.has(file.type.toLowerCase())) return true;
  // iOS often reports an EMPTY type for HEIC, so the name decides as well.
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/** True for anything this helper may re-encode. Documents and GIFs are false. */
export function isHomeworkPhoto(file: File): boolean {
  return isHeicImage(file) || COMPRESSIBLE_MIME.has(file.type.toLowerCase());
}

function withJpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

async function heicToJpeg(file: File): Promise<File> {
  // heic2any is about 1.5 MB and is lazy-loaded here as it is everywhere else
  // in the app, so it only ever downloads when an actual HEIC is chosen.
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], withJpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * The file to upload for a picked or captured image. Non-photos come back
 * untouched. Throws an Error with reporter-safe wording when the photo cannot
 * be read or is absurdly large; callers show the message inline.
 */
export async function prepareHomeworkImage(file: File): Promise<File> {
  if (!isHomeworkPhoto(file)) return file;

  if (file.size > HOMEWORK_IMAGE_MAX_INPUT_BYTES) {
    throw new Error("That photo is too large to process. Keep it under 25 MB.");
  }

  let source = file;
  if (isHeicImage(file)) {
    try {
      source = await heicToJpeg(file);
    } catch {
      throw new Error(
        "That iPhone photo couldn't be read. Use the camera button here, or set the iPhone camera to Most Compatible.",
      );
    }
  } else if (file.size <= HOMEWORK_IMAGE_COMPRESS_ABOVE_BYTES) {
    return file;
  }

  const resized = await resizeImageForUpload(source, {
    maxWidth: HOMEWORK_IMAGE_MAX_EDGE,
    maxHeight: HOMEWORK_IMAGE_MAX_EDGE,
    quality: HOMEWORK_IMAGE_QUALITY,
    mimeType: "image/jpeg",
    fit: "contain",
  });
  // resizeImageForUpload keeps the input's name while changing its type, so a
  // .png or .heic name would otherwise sit on JPEG bytes.
  return new File([resized], withJpegName(source.name), { type: "image/jpeg", lastModified: Date.now() });
}
