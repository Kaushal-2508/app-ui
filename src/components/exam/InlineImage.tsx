import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { smallImageUrl } from "@/lib/imageVariants";

type Stage = "small" | "master" | "failed";

interface InlineImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  /** The stored (master) URL. The 800px copy is derived from it. */
  url: string;
  alt: string;
  /** Classes for the fallback box; defaults to the image's own classes. */
  fallbackClassName?: string;
  /** `compact` fits a 40px thumbnail: icon only, the text goes to the title. */
  fallbackSize?: "compact" | "block";
}

/**
 * An inline question or option image (work-queue Task 2). Tries the 800px
 * copy first, falls back to the master for images uploaded before the copy
 * existed, and when both fail shows a neutral box the student can tap to
 * retry instead of an empty area or raw alt text. The enlarge lightbox is
 * NOT this component: it always shows the master.
 */
export function InlineImage({
  url,
  alt,
  className,
  fallbackClassName,
  fallbackSize = "block",
  ...imgProps
}: InlineImageProps) {
  const [stage, setStage] = useState<Stage>("small");
  const [attempt, setAttempt] = useState(0);

  // A new URL (the teacher swapped the image) starts over from the small copy.
  useEffect(() => {
    setStage("small");
  }, [url]);

  if (stage === "failed") {
    const compact = fallbackSize === "compact";
    return (
      <span
        role="button"
        tabIndex={0}
        title={compact ? "Image could not be loaded, tap to retry" : undefined}
        aria-label="Image could not be loaded, tap to retry"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAttempt((n) => n + 1);
          setStage("small");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAttempt((n) => n + 1);
            setStage("small");
          }
        }}
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border border-dashed border-ink-400/40 bg-muted/60 text-ink-500",
          compact ? "h-full w-full" : "min-h-24 w-full max-w-full px-3 py-4 text-xs",
          fallbackClassName ?? className,
        )}
      >
        <ImageOff className={compact ? "h-4 w-4" : "h-5 w-5 shrink-0"} aria-hidden="true" />
        {!compact && (
          <span className="flex items-center gap-1">
            Image could not be loaded, tap to retry
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </span>
    );
  }

  // The retry counter busts the browser's negative cache for the same URL.
  const base = stage === "small" ? smallImageUrl(url) : url;
  const src = attempt > 0 ? `${base}${base.includes("?") ? "&" : "?"}retry=${attempt}` : base;

  return (
    <img
      {...imgProps}
      src={src}
      alt={alt}
      className={className}
      onError={() => setStage((s) => (s === "small" ? "master" : "failed"))}
    />
  );
}
