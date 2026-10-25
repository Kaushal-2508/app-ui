import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InlineImage } from "./InlineImage";
import { OptionImageLightbox } from "./OptionImage";

interface QuestionDiagramProps {
  url: string;
  /** Alt text and lightbox title, e.g. "Question 3 diagram". */
  label?: string;
  className?: string;
  /**
   * The attempt page's fullscreen container. Required there: the exam is
   * `fixed inset-0 z-[9999]` (and the real fullscreen element on Android),
   * so a body-level dialog opens behind it. See OptionImageLightbox.
   */
  lightboxContainer?: HTMLElement | null;
}

/**
 * A question-level (or sub-question) diagram the student can enlarge.
 *
 * Unlike an option image there is no answer to select here, so the whole
 * picture is a tap target as well as the corner button. Same lightbox as the
 * options, so enlarging behaves identically everywhere on the paper.
 *
 * The picture wrapper is a div with role="button", not a <button>: the
 * "tap to retry" box InlineImage shows on a failed load must receive its own
 * tap, and WebKit hands a click on any descendant of a <button> to the button
 * (see OptionChoiceGrid). The inline render is the 800px copy; the lightbox
 * opens the master.
 */
export function QuestionDiagram({
  url,
  label = "Question diagram",
  className,
  lightboxContainer,
}: QuestionDiagramProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={cn("relative inline-block max-w-full", className)}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          aria-label={`Enlarge ${label.toLowerCase()}`}
          className="block cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
        >
          <InlineImage
            url={url}
            alt={label}
            className="max-h-64 max-w-full rounded-md border object-contain"
            // Right padding keeps the retry text clear of the enlarge button.
            fallbackClassName="min-h-24 w-72 max-w-full pr-14"
          />
        </div>
        {/* Explicit affordance: a plain picture does not announce that it
            zooms. 44px, the mobile minimum tap target. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={`Enlarge ${label.toLowerCase()}`}
          className="absolute right-1 top-1 h-11 w-11 rounded-md bg-ink-900/55 text-white backdrop-blur-sm hover:bg-ink-900/75 hover:text-white focus-visible:ring-white/70"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <OptionImageLightbox
        url={url}
        label={label}
        open={open}
        onOpenChange={setOpen}
        container={lightboxContainer}
      />
    </>
  );
}
