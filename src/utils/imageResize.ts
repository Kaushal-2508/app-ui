import Compressor from "compressorjs";

/**
 * Client-side resize + compress before upload, via compressorjs.
 *
 * `fit` decides what the box means:
 * - `"contain"` (default): the image is scaled DOWN to fit inside
 *   maxWidth x maxHeight and keeps its aspect ratio. Nothing is cut off, and
 *   small images are never upscaled. Use this for anything whose content
 *   matters (question diagrams, option images).
 * - `"cover"`: the output is exactly maxWidth x maxHeight; the image is scaled
 *   to fill and the overflow is cropped away. Only for square avatars.
 *
 * Until 2026-09-04 this helper always used "cover", so every question diagram
 * was hard-cropped to a square on the teacher's device before it reached
 * Storage. Files uploaded before that date are stored cropped and cannot be
 * recovered; only the original on the teacher's device is intact.
 */
export const resizeImageForUpload = (
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    /**
     * Force an output format, e.g. "image/webp". When set, the JPEG
     * auto-conversion is suppressed so the requested type survives.
     */
    mimeType?: string;
    fit?: "contain" | "cover";
    /**
     * PNG/WebP inputs larger than this many bytes are converted to JPEG.
     * Default 100 KB. Raise it for diagrams and screenshots: JPEG smears
     * thin lines and small text, which is exactly what those contain.
     */
    convertSize?: number;
  }
): Promise<File> => {
  const {
    maxWidth = 300,
    maxHeight = 300,
    quality = 0.8,
    mimeType,
    fit = "contain",
    convertSize = 100_000,
  } = options || {};

  return new Promise((resolve, reject) => {
    const format: Compressor.Options = mimeType
      ? { mimeType }
      : { convertTypes: ["image/png", "image/webp"], convertSize };

    // compressorjs applies `resize` only when BOTH width and height are set,
    // and "cover" then crops. `maxWidth`/`maxHeight` alone scale proportionally.
    const sizing: Compressor.Options =
      fit === "cover"
        ? { width: maxWidth, height: maxHeight, resize: "cover" }
        : { maxWidth, maxHeight };

    new Compressor(file, {
      ...sizing,
      quality,
      ...format,
      success(result) {
        // Convert Blob to File to preserve file name
        const resizedFile = new File([result], file.name, {
          type: result.type,
          lastModified: Date.now(),
        });
        resolve(resizedFile);
      },
      error(err) {
        console.error("Image compression error:", err);
        reject(err);
      },
    });
  });
};

/**
 * Check if a file is an image
 */
export const isImageFile = (file: File): boolean => {
  return file.type.startsWith("image/");
};
