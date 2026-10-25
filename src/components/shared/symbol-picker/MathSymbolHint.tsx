import type { MouseEvent } from "react";
import { Sigma } from "lucide-react";
import { cn } from "@/lib/utils";
import { SYMBOL_PICKER_OPEN_EVENT } from "./SymbolPickerProvider";

interface MathSymbolHintProps {
  className?: string;
  /** Compact variant — single line, no leading icon. */
  compact?: boolean;
}

const EDITABLE_SELECTOR = [
  "textarea",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="url"]',
  'input[type="email"]',
  'input[type="tel"]',
]
  .map((s) => `${s}:not([data-no-symbol-picker="true"])`)
  .join(", ");

function findNearestEditable(
  start: HTMLElement
): HTMLTextAreaElement | HTMLInputElement | null {
  // Walk up from the hint to find a container that holds the related input,
  // then return the first editable inside it. Textareas are preferred over
  // single-line inputs at the same level.
  let parent: HTMLElement | null = start.parentElement;
  while (parent) {
    const textarea = parent.querySelector<HTMLTextAreaElement>(
      'textarea:not([data-no-symbol-picker="true"])'
    );
    if (textarea && !textarea.disabled && !textarea.readOnly) return textarea;
    const input = parent.querySelector<HTMLInputElement>(EDITABLE_SELECTOR);
    if (input && !input.disabled && !input.readOnly) return input;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Visible button + inline hint for the math symbol picker. The button is the
 * primary mobile/touch affordance (mobile soft keyboards don't reliably fire
 * keydown for space, and iOS hijacks long-press on space for cursor-move),
 * while the trailing kbd hint tells desktop users about the hold-space
 * shortcut.
 */
export function MathSymbolHint({ className, compact = false }: MathSymbolHintProps) {
  const openPicker = (currentTarget: HTMLElement) => {
    const editable = findNearestEditable(currentTarget);
    if (!editable) return;
    try {
      editable.focus({ preventScroll: false });
    } catch {
      editable.focus();
    }
    window.dispatchEvent(
      new CustomEvent(SYMBOL_PICKER_OPEN_EVENT, { detail: { target: editable } })
    );
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openPicker(e.currentTarget);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground",
          "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground",
          className
        )}
        aria-label="Open math and special symbols picker"
      >
        <span>
          Tap or hold{" "}
          <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-foreground">
            space
          </kbd>{" "}
          to insert math &amp; special symbols.
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1",
        className
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        // Prevent the click from blurring the active textarea before our handler runs.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-brand-primary/30 bg-brand-primary/10 px-2.5 py-1",
          "text-xs font-medium text-brand-primary",
          "transition-all hover:border-brand-primary/50 hover:bg-brand-primary/15 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        )}
        aria-label="Open math and special symbols picker"
      >
        <Sigma className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Insert math &amp; symbols</span>
      </button>
      <span className="hidden text-[11px] leading-tight text-muted-foreground sm:inline-flex sm:items-center sm:gap-1">
        or hold
        <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-foreground">
          space
        </kbd>
      </span>
    </div>
  );
}
