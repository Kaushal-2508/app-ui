import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseMathSegments } from "@/lib/mathSegments";
import { EquationBuilderSheet } from "./equation-builder-sheet";

interface MathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Minimum editor height in px (defaults to ~3 lines). */
  minHeight?: number;
  id?: string;
  invalid?: boolean;
  /** Tight layout for grid cells: smaller button, no trailing hint text. */
  compact?: boolean;
}

const ZWSP = "​";

/** Render a LaTeX chip into a span and tag it for serialization. */
function renderChip(span: HTMLSpanElement, latex: string, block: boolean) {
  span.dataset.latex = latex;
  if (block) span.dataset.block = "true";
  else delete span.dataset.block;
  span.contentEditable = "false";
  span.className = "math-chip";
  span.setAttribute("role", "button");
  span.setAttribute("aria-label", "Edit equation");
  try {
    katex.render(latex && latex.trim() ? latex : "\\square", span, {
      throwOnError: false,
      displayMode: false,
      output: "html",
    });
  } catch {
    span.textContent = latex;
  }
}

/** Rebuild the editor DOM from a stored value (prose + `$...$` chips). */
function buildDom(root: HTMLElement, value: string) {
  root.innerHTML = "";
  for (const seg of parseMathSegments(value)) {
    if (seg.type === "text") {
      if (seg.value) root.appendChild(document.createTextNode(seg.value));
    } else {
      const span = document.createElement("span");
      renderChip(span, seg.latex, seg.type === "block");
      root.appendChild(span);
      // A zero-width space after each chip gives the caret a landing spot.
      root.appendChild(document.createTextNode(ZWSP));
    }
  }
}

/** Serialize the editor DOM back to the stored `$...$` format. */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").split(ZWSP).join("");
      } else if (child instanceof HTMLElement) {
        if (child.dataset.latex !== undefined) {
          out +=
            child.dataset.block === "true"
              ? `$$${child.dataset.latex}$$`
              : `$${child.dataset.latex}$`;
        } else if (child.tagName === "BR") {
          out += "\n";
        } else {
          walk(child);
        }
      }
    });
  };
  walk(root);
  return out;
}

/**
 * A WYSIWYG question/answer editor. Prose is edited as normal text; math is
 * shown as inline rendered KaTeX "chips" that the author inserts/edits through
 * the equation builder. Reads and writes the project-wide `$...$` storage
 * format, so downstream renderers (`MathText`) and AI-generated questions stay
 * identical.
 */
export function MathInput({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 88,
  id,
  invalid,
  compact = false,
}: MathInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const editingChip = useRef<HTMLElement | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderInitial, setBuilderInitial] = useState("");
  const [builderEditing, setBuilderEditing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);

  // External value → DOM on mount and on real external changes (e.g. reset);
  // skip echoes of our own edits so typing never clobbers the caret.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (lastEmitted.current === null || value !== lastEmitted.current) {
      buildDom(root, value);
      lastEmitted.current = value;
      setIsEmpty(!value);
    }
  }, [value]);

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = serialize(root);
    lastEmitted.current = next;
    setIsEmpty(!next);
    onChange(next);
  }, [onChange]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (rootRef.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
        return;
      }
    }
    savedRange.current = null;
  };

  const openForInsert = () => {
    saveSelection();
    editingChip.current = null;
    setBuilderInitial("");
    setBuilderEditing(false);
    setBuilderOpen(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest?.(
      "[data-latex]"
    ) as HTMLElement | null;
    if (chip && rootRef.current?.contains(chip)) {
      editingChip.current = chip;
      setBuilderInitial(chip.dataset.latex ?? "");
      setBuilderEditing(true);
      setBuilderOpen(true);
    }
  };

  const insertChip = (latex: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    let range = savedRange.current;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    const span = document.createElement("span");
    renderChip(span, latex, false);
    range.insertNode(span);
    const spacer = document.createTextNode(ZWSP);
    span.after(spacer);
    const sel = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(spacer);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    savedRange.current = null;
    emit();
  };

  const handleBuilderSubmit = (latex: string) => {
    setBuilderOpen(false);
    const chip = editingChip.current;
    editingChip.current = null;
    if (chip) {
      if (!latex) {
        // Removed: also drop the trailing zero-width spacer if present.
        const next = chip.nextSibling;
        if (
          next &&
          next.nodeType === Node.TEXT_NODE &&
          next.textContent === ZWSP
        ) {
          next.remove();
        }
        chip.remove();
      } else {
        renderChip(chip, latex, chip.dataset.block === "true");
      }
      emit();
      return;
    }
    if (latex) insertChip(latex);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.execCommand("insertLineBreak");
      emit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emit();
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        ref={rootRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-empty={isEmpty || undefined}
        data-placeholder={placeholder}
        onInput={emit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleClick}
        className={cn(
          "math-input w-full whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm leading-relaxed",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          invalid ? "border-destructive" : "border-input"
        )}
        style={{ minHeight }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5 border-brand-primary/30 bg-brand-primary/5 text-brand-primary hover:bg-brand-primary/10 hover:text-brand-primary",
            compact && "h-7 px-2 text-xs"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openForInsert}
          aria-label="Insert equation"
        >
          <Sigma className="h-3.5 w-3.5" aria-hidden="true" />{" "}
          {compact ? "Equation" : "Insert equation"}
        </Button>
        {!compact && (
          <span className="text-[11px] text-muted-foreground">
            or tap an equation to edit it
          </span>
        )}
      </div>

      <EquationBuilderSheet
        open={builderOpen}
        initialLatex={builderInitial}
        editing={builderEditing}
        onSubmit={handleBuilderSubmit}
        onClose={() => {
          setBuilderOpen(false);
          editingChip.current = null;
        }}
      />
    </div>
  );
}
