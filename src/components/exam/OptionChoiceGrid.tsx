import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { cn } from "@/lib/utils";
import { InlineImage } from "./InlineImage";
import { OptionImageLightbox } from "./OptionImage";
import {
  isRedundantOptionText,
  optionLetter,
  type DisplayOption,
} from "./optionDisplay";

/** How a read-only surface wants one option tinted. */
export type OptionTone = "neutral" | "correct" | "wrong";

interface OptionChoiceGridProps {
  options: readonly DisplayOption[];
  /** Currently selected option id. Omit together with onSelect for read-only. */
  value?: string | null;
  /** Provide to make the grid interactive (student attempt). */
  onSelect?: (optionId: string) => void;
  /** Per-option tint + trailing note for result review / marking. */
  annotate?: (option: DisplayOption, index: number) => {
    tone?: OptionTone;
    note?: string;
  };
  className?: string;
  /**
   * Where the enlarge lightbox should portal. The online attempt page must
   * pass its fullscreen container (see OptionImageLightbox); other surfaces
   * leave it unset.
   */
  lightboxContainer?: HTMLElement | null;
}

/**
 * The layout for an MCQ where the PICTURE is the answer.
 *
 * "Which is the similar image?" with options A/B/C/D and four photos cannot be
 * answered from 40px thumbnails, so each option becomes a card with the image
 * at a size a student can actually read: full column width on a phone, two up
 * from sm where there is room to compare them side by side.
 *
 * The whole card is the tap target when interactive; the expand button is the
 * only thing that opens the full image, and it stops propagation so enlarging
 * never silently commits an answer.
 *
 * The card is a div with role="radio", NOT a <button>. WebKit reports a click
 * on any descendant of a <button> with the button itself as the target, so an
 * expand control nested inside a button never received its click on iPhone:
 * every tap on the magnifier just re-selected the option, the image never
 * opened, and the student read it as "stuck". Keep the enlarge control a real
 * <button> and keep it outside any other button.
 */
export function OptionChoiceGrid({
  options,
  value,
  onSelect,
  annotate,
  className,
  lightboxContainer,
}: OptionChoiceGridProps) {
  const [zoomed, setZoomed] = useState<number | null>(null);
  const interactive = typeof onSelect === "function";

  return (
    <>
      {/* ONE column on a phone: two columns leaves each photo ~150px wide,
          which is not enough to answer "which is the similar image?". At full
          phone width each option is ~320px and genuinely legible. From sm up
          there is room for two side by side, which is better for comparing. */}
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4", className)}>
        {options.map((option, index) => {
          const letter = optionLetter(index);
          const label = `Option ${letter}`;
          const optionId = option.id ?? String(index);
          const selected = value != null && value === optionId;
          const { tone = "neutral", note } = annotate?.(option, index) ?? {};
          const showText = !isRedundantOptionText(option.text, index);

          const body = (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    tone === "correct"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : tone === "wrong"
                        ? "border-rose-500 bg-rose-500 text-white"
                        : selected
                          ? "border-brand-primary bg-brand-primary text-white"
                          : "border-ink-400/30 bg-surface-base text-ink-700",
                  )}
                >
                  {letter}
                </span>
                {note && (
                  <span
                    className={cn(
                      // The dark variants matter: emerald/rose-700 on the dark
                      // tinted card is barely legible.
                      "truncate text-[11px] font-medium",
                      tone === "correct"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : tone === "wrong"
                          ? "text-rose-700 dark:text-rose-300"
                          : "text-ink-600",
                    )}
                  >
                    {note}
                  </span>
                )}
              </div>

              {option.imageUrl && (
                <div className="relative mt-2 overflow-hidden rounded-lg bg-surface-base">
                  {/* object-contain, not cover: a diagram cropped at the edges
                      can change what the option means. The 800px copy renders
                      here; the enlarge button below opens the master. */}
                  <InlineImage
                    url={option.imageUrl}
                    alt={label}
                    loading="lazy"
                    className="max-h-[300px] w-full object-contain sm:max-h-[220px]"
                    fallbackClassName="min-h-24 w-full pr-14"
                  />
                  {/* 44px tap target (mobile minimum). stopPropagation on both
                      click and keydown so enlarging never selects the option. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Enlarge ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomed(index);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="absolute right-1 top-1 h-11 w-11 rounded-md bg-ink-900/55 text-white backdrop-blur-sm hover:bg-ink-900/75 hover:text-white focus-visible:ring-white/70"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {showText && (
                <MathText
                  as="div"
                  className="mt-2 break-words text-left text-sm text-ink-900"
                  text={option.text ?? ""}
                />
              )}
            </>
          );

          const frame = cn(
            "rounded-card border p-2.5 text-left transition-colors",
            tone === "correct"
              ? "border-emerald-500/40 bg-emerald-500/[0.07]"
              : tone === "wrong"
                ? "border-rose-500/40 bg-rose-500/[0.07]"
                : selected
                  ? "border-brand-primary bg-brand-primary/[0.06] ring-2 ring-brand-primary/40"
                  : "border-surface-stroke bg-surface-card",
            interactive && "hover:border-brand-primary/50",
          );

          return interactive ? (
            <div
              key={optionId}
              role="radio"
              tabIndex={0}
              aria-checked={selected}
              aria-label={label}
              onClick={() => onSelect?.(optionId)}
              onKeyDown={(e) => {
                // Only when the card itself has focus; the enlarge button
                // handles (and stops) its own keys.
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(optionId);
                }
              }}
              className={cn(
                frame,
                "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50",
              )}
            >
              {body}
            </div>
          ) : (
            <div key={optionId} className={frame}>
              {body}
            </div>
          );
        })}
      </div>

      {zoomed !== null && options[zoomed]?.imageUrl && (
        <OptionImageLightbox
          url={options[zoomed]!.imageUrl!}
          label={`Option ${optionLetter(zoomed)}`}
          open
          onOpenChange={(next) => {
            if (!next) setZoomed(null);
          }}
          container={lightboxContainer}
        />
      )}
    </>
  );
}
