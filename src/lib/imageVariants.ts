/**
 * Image variants in the question-images bucket (work-queue Task 2, 2026-10-05).
 *
 * The teacher's upload is stored twice: the 2000px master (`<uuid>.jpg`) that
 * the enlarge lightbox needs, and an 800px long-edge copy next to it
 * (`<uuid>-w800.jpg`) for the inline grid, which renders at ~390 CSS px on a
 * phone. One image-choice question used to ship 3 to 6 MB of masters to
 * every student; with the small copy it is a few hundred KB. No column, no
 * schema change: the small URL is DERIVED from the stored one here, and every
 * inline render falls back to the master on error, so images uploaded before
 * this change (no `-w800` object) keep working.
 */

export const SMALL_VARIANT_SUFFIX = "-w800";
/** Long edge of the inline copy, in px. */
export const SMALL_VARIANT_EDGE = 800;
/** JPEG quality of the inline copy. */
export const SMALL_VARIANT_QUALITY = 0.75;

/** `.../abc.jpg` -> `.../abc-w800.jpg`. A URL with no extension is returned as is. */
export function smallImageUrl(url: string): string {
  return url.replace(/(\.\w+)(\?.*)?$/, `${SMALL_VARIANT_SUFFIX}$1$2`);
}

/** `abc.jpg` -> `abc-w800.jpg`, for the storage object path at upload time. */
export function smallVariantPath(path: string): string {
  return smallImageUrl(path);
}
