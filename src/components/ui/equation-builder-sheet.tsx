import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MathField, type MathFieldHandle } from "./math-field";

interface EquationBuilderSheetProps {
  open: boolean;
  /** LaTeX to start from (empty for a new equation, populated when editing). */
  initialLatex: string;
  /** Whether this is an edit (enables the Remove action). */
  editing?: boolean;
  onSubmit: (latex: string) => void;
  onClose: () => void;
}

/** Structures insert with `#?` fill-in boxes the author tabs/clicks into. */
const STRUCTURES: { label: string; latex: string }[] = [
  { label: "a⁄b", latex: "\\frac{#?}{#?}" },
  { label: "√", latex: "\\sqrt{#?}" },
  { label: "xⁿ", latex: "^{#?}" },
  { label: "xₙ", latex: "_{#?}" },
  { label: "( )", latex: "\\left(#?\\right)" },
];

const SYMBOLS: { label: string; latex: string }[] = [
  { label: "×", latex: "\\times" },
  { label: "÷", latex: "\\div" },
  { label: "·", latex: "\\cdot" },
  { label: "±", latex: "\\pm" },
  { label: "≤", latex: "\\leq" },
  { label: "≥", latex: "\\geq" },
  { label: "≠", latex: "\\neq" },
  { label: "≈", latex: "\\approx" },
  { label: "→", latex: "\\rightarrow" },
  { label: "∞", latex: "\\infty" },
  { label: "π", latex: "\\pi" },
  { label: "θ", latex: "\\theta" },
  { label: "α", latex: "\\alpha" },
  { label: "β", latex: "\\beta" },
  { label: "Σ", latex: "\\sum" },
  { label: "∫", latex: "\\int" },
];

/**
 * MathLive emits `\placeholder{}` for empty boxes (and wraps defaults); unwrap
 * to plain LaTeX so KaTeX (the inline chip + the student view) can render it.
 */
function cleanLatex(input: string): string {
  return input
    .replace(/\\placeholder(\[[^\]]*\])?\{([^{}]*)\}/g, "$2")
    .trim();
}

export function EquationBuilderSheet({
  open,
  initialLatex,
  editing = false,
  onSubmit,
  onClose,
}: EquationBuilderSheetProps) {
  const mfRef = useRef<MathFieldHandle>(null);
  const latestRef = useRef(initialLatex);
  const [hasContent, setHasContent] = useState(!!cleanLatex(initialLatex));

  useEffect(() => {
    if (open) {
      latestRef.current = initialLatex;
      setHasContent(!!cleanLatex(initialLatex));
    }
  }, [open, initialLatex]);

  const handleChange = (latex: string) => {
    latestRef.current = latex;
    setHasContent(!!cleanLatex(latex));
  };

  const submit = () => {
    if (!hasContent) return;
    onSubmit(cleanLatex(latestRef.current));
  };

  const insert = (latex: string) => mfRef.current?.insert(latex);

  // MathLive's virtual keyboard renders at the bottom of the page, OUTSIDE the
  // Radix dialog. Without this, the modal treats taps on it as "click outside"
  // (closing the sheet / stealing focus), making the keyboard unusable.
  const isMathLiveSurface = (node: EventTarget | null) =>
    node instanceof HTMLElement && !!node.closest('.ML__keyboard, [class*="ML__"]');
  const guardOutside = (e: { target: EventTarget | null; preventDefault: () => void }) => {
    if (isMathLiveSurface(e.target)) e.preventDefault();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90vh] flex-col sm:mx-auto sm:max-w-lg"
        onInteractOutside={guardOutside}
        onPointerDownOutside={guardOutside}
        onFocusOutside={guardOutside}
      >
        <SheetHeader className="mb-2">
          <SheetTitle>{editing ? "Edit equation" : "Add equation"}</SheetTitle>
        </SheetHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-2">
          {/* Editable equation with fill-in boxes. */}
          {open && (
            <MathField
              ref={mfRef}
              initialValue={initialLatex}
              onChange={handleChange}
              onEnter={submit}
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Tap a box and type. Use the buttons below to add fractions, roots,
            powers, and symbols anywhere in the equation.
          </p>

          {/* Structures */}
          <div className="mt-3 flex flex-wrap gap-2">
            {STRUCTURES.map((s) => (
              <Button
                key={s.label}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[42px] min-w-[48px] text-base font-medium"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(s.latex)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* Common symbols */}
          <div className="mt-2 grid grid-cols-8 gap-1.5">
            {SYMBOLS.map((s) => (
              <Button
                key={s.label}
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 border border-border/60 bg-muted/30 text-base"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(s.latex)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Sticky footer — always visible, never cut off. */}
        <div className="mt-2 flex flex-shrink-0 gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px] flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              className="min-h-[48px] flex-1 text-destructive hover:text-destructive"
              onClick={() => onSubmit("")}
            >
              Remove
            </Button>
          )}
          <Button
            type="button"
            className="min-h-[48px] flex-1"
            disabled={!hasContent}
            onClick={submit}
          >
            {editing ? "Update" : "Insert"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
