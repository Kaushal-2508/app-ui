import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resizeImageForUpload, isImageFile } from "@/utils/imageResize";
import { SMALL_VARIANT_EDGE, SMALL_VARIANT_QUALITY, smallVariantPath } from "@/lib/imageVariants";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

interface QuestionImageUploadProps {
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
  /**
   * `block` — the question-level diagram: full "Upload Diagram" button and a
   * preview up to 192px tall.
   * `thumb` — a per-option diagram: icon-only trigger and a 44px rounded
   * preview, so four options stay compact instead of each carrying a banner.
   */
  variant?: "block" | "thumb";
  /** Accessible label, e.g. "Add an image to option B". */
  ariaLabel?: string;
}

/**
 * Longest-edge cap. The image is scaled DOWN to fit inside this box and keeps
 * its aspect ratio; it is never cropped. A 1600x900 diagram becomes 2000x1125.
 *
 * Why 2000: the lightbox shows a picture at full phone width, and a phone
 * renders ~390 CSS px at 3x density, i.e. ~1170 device pixels. A TALL capture
 * (a full-page screenshot, 1170x2532) capped at 1200 on its long edge is only
 * ~555 px wide and reads blurry; at 2000 it is ~925 px wide and legible. Options
 * get the same cap as questions because when the picture IS the answer the
 * grid and lightbox show it at the same size.
 *
 * The 2000px file is the MASTER, for the lightbox only. Since 2026-10-05
 * (Task 2) every upload also stores an 800px copy next to it
 * (`<uuid>-w800.<ext>`, see src/lib/imageVariants.ts) and the inline grid
 * renders that one, falling back to the master for older uploads.
 */
const MAX_EDGE: Record<"block" | "thumb", number> = { block: 2000, thumb: 2000 };

/**
 * PNG stays PNG up to this size (line-art diagrams); above it the file becomes
 * JPEG at quality 0.9, which keeps text crisp at 2000px while bounding what
 * every student downloads. A 4-option image question at 1.5 MB PNG each would
 * ship ~6 MB per question to thousands of phones. The same threshold decides
 * the small copy's format, and both decisions read the ORIGINAL file's size,
 * so master and copy always share an extension and the derived URL is valid.
 */
const KEEP_PNG_UP_TO_BYTES = 400_000;

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function QuestionImageUpload({
  imageUrl,
  onImageChange,
  variant = "block",
  ariaLabel,
}: QuestionImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Storage paths uploaded by THIS mount. Only these may be deleted on remove:
  // a question opened for editing already points at a stored file, and deleting
  // that file here would leave the saved question with a dead image the moment
  // the teacher cancels out of the sheet instead of saving.
  const sessionPaths = useRef<Set<string>>(new Set());

  const handleUpload = async (file: File) => {
    if (isUploading) return;

    if (!isImageFile(file)) {
      toast.error("Pick an image file (PNG, JPG or WEBP).");
      return;
    }

    setIsUploading(true);
    try {
      const edge = MAX_EDGE[variant];
      const resized = await resizeImageForUpload(file, {
        maxWidth: edge,
        maxHeight: edge,
        quality: 0.9,
        // Never "cover": cropping a diagram's edges can change what the
        // question is asking. The stored file must be the whole picture.
        fit: "contain",
        convertSize: KEEP_PNG_UP_TO_BYTES,
      });

      // The inline copy: 800px long edge, JPEG 0.75 (PNG stays PNG below the
      // same threshold, from the same original, so the extension matches).
      const small = await resizeImageForUpload(file, {
        maxWidth: SMALL_VARIANT_EDGE,
        maxHeight: SMALL_VARIANT_EDGE,
        quality: SMALL_VARIANT_QUALITY,
        fit: "contain",
        convertSize: KEEP_PNG_UP_TO_BYTES,
      });

      // The helper keeps the INPUT name, so a PNG converted to JPEG would be
      // stored as ".png". Name the object after what the bytes actually are.
      const ext = extensionFor(resized.type);
      const filePath = `${crypto.randomUUID()}.${ext}`;
      const smallPath = smallVariantPath(filePath);

      const { error: uploadError } = await supabase.storage
        .from("question-images")
        .upload(filePath, resized);

      if (uploadError) throw uploadError;
      sessionPaths.current.add(filePath);

      // Best effort: without the copy the grid falls back to the master, as it
      // does for every image uploaded before 2026-10-05. The question is not
      // held up by it.
      const { error: smallError } = await supabase.storage
        .from("question-images")
        .upload(smallPath, small, { contentType: small.type });
      if (smallError) {
        console.warn("[questionImageUpload] small copy not stored", smallError);
      } else {
        sessionPaths.current.add(smallPath);
      }

      const { data: urlData } = supabase.storage
        .from("question-images")
        .getPublicUrl(filePath);

      onImageChange(urlData.publicUrl);
      toast.success(variant === "thumb" ? "Option image added" : "Diagram uploaded");
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't upload the diagram.",
        context: "questionImageUpload",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!imageUrl) return;

    // Extract path from URL
    try {
      const url = new URL(imageUrl);
      const pathParts = url.pathname.split("/question-images/");
      const path = pathParts[1];
      if (path && sessionPaths.current.has(path)) {
        // The master and, when it was stored, its 800px copy.
        const paths = [path, smallVariantPath(path)].filter((p) => sessionPaths.current.has(p));
        await supabase.storage.from("question-images").remove(paths);
        paths.forEach((p) => sessionPaths.current.delete(p));
      }
    } catch {
      // Ignore deletion errors — clearing the reference is what matters.
    }

    onImageChange(null);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />

      {imageUrl ? (
        <div className="relative inline-block">
          <img
            src={imageUrl}
            alt={ariaLabel ?? "Question diagram"}
            className={
              variant === "thumb"
                ? "h-11 w-11 rounded-lg border border-ink-400/20 bg-surface-card object-contain"
                : "max-h-48 rounded-md border object-contain"
            }
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className={
              variant === "thumb"
                ? "absolute -top-1.5 -right-1.5 h-5 w-5"
                : "absolute -top-2 -right-2 h-6 w-6"
            }
            onClick={handleRemove}
            aria-label={ariaLabel ? `Remove image from ${ariaLabel}` : "Remove diagram"}
          >
            <X className={variant === "thumb" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          </Button>
        </div>
      ) : variant === "thumb" ? (
        // Icon-only and exactly the size of the preview it becomes, so the row
        // height never shifts when the teacher adds or removes an image.
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 border-dashed"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          aria-label={ariaLabel ?? "Add an image to this option"}
          title={ariaLabel ?? "Add an image to this option"}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {isUploading ? "Uploading..." : "Upload Diagram"}
        </Button>
      )}
    </div>
  );
}
