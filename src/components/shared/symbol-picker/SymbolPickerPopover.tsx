import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Sigma, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SYMBOL_PAGES, type SymbolPage } from "./symbols";
import type { EditableEl } from "./insert-at-cursor";
import { useTopInstitutionSymbols } from "@/hooks/useSymbolUsage";

interface SymbolPickerPopoverProps {
  open: boolean;
  onClose: () => void;
  target: EditableEl | null;
  onInsert: (symbol: string) => void;
}

const POPOVER_WIDTH = 360;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_PADDING = 8;

function computePosition(target: EditableEl) {
  const rect = target.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const top =
    spaceBelow >= POPOVER_MAX_HEIGHT + VIEWPORT_PADDING
      ? rect.bottom + 8
      : Math.max(VIEWPORT_PADDING, rect.top - POPOVER_MAX_HEIGHT - 8);
  const left = Math.min(
    Math.max(VIEWPORT_PADDING, rect.left),
    window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING
  );
  return { top, left };
}

export function SymbolPickerPopover({
  open,
  onClose,
  target,
  onInsert,
}: SymbolPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const { data: topSymbols = [] } = useTopInstitutionSymbols(8);

  // When the institution has accumulated usage, prepend a Frequently-used
  // page at index 0; on cold start it's hidden so the picker just shows
  // the static pages.
  const pages = useMemo<SymbolPage[]>(() => {
    if (topSymbols.length === 0) return SYMBOL_PAGES;
    return [
      {
        label: "Frequently used",
        symbols: topSymbols.map((s) => s.symbol),
        recommended: true,
      },
      ...SYMBOL_PAGES,
    ];
  }, [topSymbols]);

  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !target) return;
    setPosition(computePosition(target));
  }, [open, target]);

  useEffect(() => {
    if (!open || !target) return;
    const reposition = () => setPosition(computePosition(target));
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, target]);

  // ESC + click-outside-the-picker (own logic; Radix's outside detection is
  // suppressed by stopPropagation on pointerdown at the popover root, so
  // we re-implement just the parts we need here).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const node = popoverRef.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      // Clicks back inside the host input shouldn't close — let the user reposition the caret.
      if (target && e.target instanceof Node && target.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, target]);

  if (!open || !position) return null;

  const totalPages = pages.length;
  const safeIndex = Math.min(pageIndex, totalPages - 1);
  const page = pages[safeIndex];
  const isRecommendedPage = !!page.recommended;

  // Stop pointer/mouse events from bubbling to ancestor Radix Dialog/Sheet
  // listeners that would otherwise treat clicks here as "click outside" and
  // close the parent surface (which would unmount our target input mid-insert).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Symbol picker"
      data-symbol-picker-root="true"
      className={cn(
        "pointer-events-auto fixed z-[100] w-[360px] overflow-hidden rounded-card border border-border/80 bg-card",
        "shadow-[0_18px_48px_-12px_rgba(15,23,42,0.28),0_8px_18px_-8px_rgba(15,23,42,0.18)]",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
      )}
      style={{ top: position.top, left: position.left }}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md",
              isRecommendedPage
                ? "bg-brand-secondary/15 text-brand-secondary"
                : "bg-brand-primary/10 text-brand-primary"
            )}
          >
            {isRecommendedPage ? (
              <Sparkles className="h-3.5 w-3.5" />
            ) : (
              <Sigma className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="truncate text-xs font-medium text-foreground">
            {page.label}
            {isRecommendedPage && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                · at your school
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs tabular-nums hover:bg-brand-primary/10 hover:text-brand-primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPageIndex((i) => (i + 1) % totalPages)}
            aria-label={`Page ${safeIndex + 1} of ${totalPages}. Tap to advance`}
          >
            <span className="font-semibold">{safeIndex + 1}</span>
            <span className="text-muted-foreground">/</span>
            <span>{totalPages}</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            aria-label="Close symbol picker"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Symbol grid */}
      <div className="grid grid-cols-8 gap-1.5 p-3">
        {page.symbols.map((symbol) => (
          <button
            key={symbol}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(symbol)}
            className={cn(
              "flex h-9 items-center justify-center rounded-md border border-transparent bg-muted/40 text-base text-foreground",
              "transition-all hover:scale-[1.06] hover:border-brand-primary/40 hover:bg-brand-primary/10 hover:text-brand-primary",
              "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            )}
            aria-label={`Insert ${symbol}`}
          >
            {symbol}
          </button>
        ))}
      </div>

      {/* Page dots */}
      <div className="flex items-center justify-center gap-1.5 pb-2">
        {pages.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPageIndex(i)}
            aria-label={`Go to page ${i + 1}${p.recommended ? " (frequently used)" : ""}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === safeIndex
                ? p.recommended
                  ? "w-5 bg-brand-secondary"
                  : "w-5 bg-brand-primary"
                : "w-1.5 bg-border hover:bg-muted-foreground/40"
            )}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-center gap-2 border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          Hold
          <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-foreground">
            space
          </kbd>
          to open
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-foreground">
            esc
          </kbd>
          to close
        </span>
      </div>
    </div>,
    document.body
  );
}
