import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineImage } from "./InlineImage";

/**
 * Full-size view of an option's diagram. Shared by the small inline thumbnail
 * and by the large image-choice grid, so "tap to enlarge" behaves identically
 * wherever an option image appears.
 *
 * Built on the Radix primitives directly rather than the shared DialogContent:
 *
 * - The online attempt page wraps the whole exam in `fixed inset-0 z-[9999]`
 *   and, on Android/desktop, makes that element the real fullscreen element.
 *   A dialog portalled to <body> at z-50 opens BEHIND that container (or is
 *   not rendered at all under real fullscreen) while Radix still disables
 *   pointer events on the page. To the student the picture "does not open"
 *   and the exam is then frozen until Escape, which a phone has no key for.
 *   So the caller passes the exam container and the layer sits above 9999,
 *   exactly like the page's own Submit dialog.
 * - A phone needs a visible way out, hence the explicit close button; tapping
 *   the backdrop closes too.
 */
export function OptionImageLightbox({
  url,
  label,
  open,
  onOpenChange,
  container,
}: {
  url: string;
  label: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Element to portal into. Pass the attempt page's fullscreen container so
   * the lightbox renders inside (and above) it. Omit everywhere else.
   */
  container?: HTMLElement | null;
}) {
  // The caller reads its container ref during render, which can be one render
  // stale right as an attempt starts (the pre-exam shell is unmounting). A
  // detached node would swallow the portal, so fall back to the real
  // fullscreen element when there is one, else <body>: our z-index already
  // sits above the exam shell, so body only fails under true fullscreen.
  const target =
    container && container.isConnected
      ? container
      : ((document.fullscreenElement as HTMLElement | null) ?? undefined);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={target}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[10000] bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-[10001] overflow-auto outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {/* Fit to WIDTH and scroll vertically, never shrink to the screen
              height: a tall screenshot squeezed into 85vh is a thin unreadable
              column, which is exactly the "poor quality" a student reports.
              The wrapper covers the viewport, so a tap on the dark area (not
              the picture) closes. */}
          <div
            className="flex min-h-full items-start justify-center p-3 pb-8 pt-16 sm:p-6 sm:pt-16"
            onClick={(e) => {
              if (e.target === e.currentTarget) onOpenChange(false);
            }}
          >
            <img
              src={url}
              alt={label}
              className="h-auto w-full max-w-4xl rounded-lg shadow-card-lg"
            />
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="fixed right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface OptionImageProps {
  url: string;
  /** Which option this belongs to, e.g. "Option B" — alt text and zoom title. */
  label: string;
  className?: string;
  /** See OptionImageLightbox. */
  lightboxContainer?: HTMLElement | null;
}

/**
 * A supporting diagram for an option whose TEXT is the answer, rendered at
 * avatar size beside that text.
 *
 * For questions where the picture itself is the answer, use OptionChoiceGrid
 * instead — four thumbnails this size cannot be compared.
 */
export function OptionImage({ url, label, className, lightboxContainer }: OptionImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* A div with role="button", not a <button>: the retry box InlineImage
          shows on a failed load needs its own tap, and WebKit gives a click on
          any descendant of a <button> to the button (see OptionChoiceGrid). */}
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          // Options usually sit inside a <label> wired to a radio; opening the
          // zoom must not also select the answer.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        aria-label={`View the image for ${label}`}
        className={cn(
          "group relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-ink-400/25",
          "bg-surface-card transition-shadow hover:shadow-card focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-brand-primary/50",
          className,
        )}
      >
        <InlineImage
          url={url}
          alt={label}
          loading="lazy"
          className="h-full w-full object-contain"
          fallbackSize="compact"
        />
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
