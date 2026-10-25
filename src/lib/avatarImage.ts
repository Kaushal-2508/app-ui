import { resizeImageForUpload } from "@/utils/imageResize";

/** Rejected before any upload, so a huge file never leaves the device. */
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;

const AVATAR_EDGE = 256;
const HEIC_MIME = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** Validation failures the user can fix. Short and non-technical, so
 *  isLikelyUserFriendly() in errorMessages.ts passes them straight through. */
export class AvatarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarValidationError";
  }
}

/**
 * iOS routinely reports an EMPTY mime type for HEIC photos, so a plain
 * `type.startsWith("image/")` guard rejects genuine iPhone pictures. Fall back
 * to the filename, exactly as src/lib/hybridImage.ts already does.
 */
function isHeic(file: File): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (HEIC_MIME.includes(type)) return true;
  const name = (file.name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

function looksLikeImage(file: File): boolean {
  return isHeic(file) || (file.type ?? "").toLowerCase().startsWith("image/");
}

/**
 * Validate, convert HEIC, and resize to a 256x256 WebP of roughly 10 KB.
 * compressorjs draws to a canvas and cannot decode HEIC in most browsers, so
 * the conversion must happen first.
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  if (!looksLikeImage(file)) {
    throw new AvatarValidationError("That file isn't a picture. Choose a JPG, PNG, WebP or HEIC image.");
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new AvatarValidationError("That picture is too large. Choose one under 10 MB.");
  }

  let source: File = file;
  if (isHeic(file)) {
    try {
      // heic2any is roughly 1.5 MB. Keep it out of the main bundle.
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      source = new File([blob], "photo.jpg", { type: "image/jpeg" });
    } catch (err) {
      console.error("HEIC to JPEG conversion failed:", err);
      throw new AvatarValidationError("That iPhone photo couldn't be read. Try saving it as a JPG first.");
    }
  }

  try {
    const resized = await resizeImageForUpload(source, {
      maxWidth: AVATAR_EDGE,
      maxHeight: AVATAR_EDGE,
      quality: 0.8,
      mimeType: "image/webp",
      // Avatars are shown in a circle, so a centre-cropped square is the
      // intended shape here. Question diagrams must NOT use this.
      fit: "cover",
    });
    // resizeImageForUpload keeps the INPUT file's name while changing its
    // type, so the webp bytes here would otherwise carry a stale .jpg/.png/
    // .heic name. Rename here, not in the shared helper: that helper's other
    // caller (question-image-upload.tsx) derives its storage extension from
    // the returned name and must keep its current JPEG-auto-convert naming.
    return new File([resized], "avatar.webp", {
      type: resized.type,
      lastModified: resized.lastModified,
    });
  } catch (err) {
    console.error("Avatar resize failed:", err);
    throw new AvatarValidationError("That picture couldn't be processed. Try a different image.");
  }
}
