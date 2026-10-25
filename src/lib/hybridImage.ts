import Compressor from "compressorjs";

export const HYBRID_TARGET_MAX_BYTES = 1.4 * 1024 * 1024; // ~1.4 MB target
export const HYBRID_HARD_CEILING_BYTES = 1.5 * 1024 * 1024; // matches storage bucket cap

const HEIC_MIME = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

function isHeic(file: File | Blob): boolean {
  const type = ((file as File).type ?? "").toLowerCase();
  if (HEIC_MIME.includes(type)) return true;
  // iOS frequently reports an EMPTY mime type for HEIC photos — fall back to
  // the filename extension so those still get converted.
  const name = ((file as File).name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Convert an iPhone HEIC/HEIF photo to a JPEG blob so CompressorJS (which
 * draws to a <canvas> and can't decode HEIC on most browsers) can read it.
 * heic2any is ~1.5 MB, so it's lazy-imported — it never enters the main
 * bundle and only loads when an actual HEIC file is chosen.
 */
async function heicToJpeg(file: File | Blob): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

interface CompressOpts {
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

function runCompressor(file: Blob, opts: CompressOpts): Promise<Blob> {
  return new Promise((resolve, reject) => {
    new Compressor(file as File, {
      quality: opts.quality,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      mimeType: "image/jpeg",
      convertSize: 50 * 1024,
      success: (result) => resolve(result as Blob),
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

export async function compressSheetImage(file: File | Blob): Promise<Blob> {
  // iPhone HEIC/HEIF can't be drawn to a canvas by CompressorJS on most
  // browsers — convert to JPEG first.
  let source: Blob = file;
  if (isHeic(file)) {
    try {
      source = await heicToJpeg(file);
    } catch {
      throw new Error(
        "This looks like an iPhone HEIC photo we couldn't read. On iPhone open " +
          'Settings → Camera → Formats → "Most Compatible", or use the "Open ' +
          'camera" button here to retake the page.',
      );
    }
  }

  // Compress progressively harder until we're under the ceiling, so a large,
  // dense handwritten sheet still uploads (legibly) instead of being rejected
  // outright. Each rung trades a little sharpness for size.
  const ladder: CompressOpts[] = [
    { quality: 0.82, maxWidth: 2000, maxHeight: 2000 },
    { quality: 0.7, maxWidth: 1800, maxHeight: 1800 },
    { quality: 0.55, maxWidth: 1600, maxHeight: 1600 },
    { quality: 0.42, maxWidth: 1400, maxHeight: 1400 },
  ];
  let compressed: Blob | null = null;
  for (const opts of ladder) {
    compressed = await runCompressor(source, opts);
    if (compressed.size <= HYBRID_HARD_CEILING_BYTES) return compressed;
  }
  // Smallest attempt; compressSheetToBase64 enforces the hard ceiling below.
  return compressed as Blob;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** Compress a sheet image and return base64 + byte size, enforcing the ceiling. */
export async function compressSheetToBase64(
  file: File | Blob,
): Promise<{ base64: string; sizeBytes: number }> {
  const compressed = await compressSheetImage(file);
  if (compressed.size > HYBRID_HARD_CEILING_BYTES) {
    throw new Error(
      `This photo is still ${(compressed.size / 1024 / 1024).toFixed(1)} MB after ` +
        `compression (max ${(HYBRID_HARD_CEILING_BYTES / 1024 / 1024).toFixed(1)} MB). ` +
        `Take a closer, sharper photo of just the sheet in good light.`,
    );
  }
  const base64 = await blobToBase64(compressed);
  return { base64, sizeBytes: compressed.size };
}
