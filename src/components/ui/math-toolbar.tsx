import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MathSymbol {
  label: string;
  latex: string;
  display: string;
  tooltip: string;
}

const mathGroups: { title: string; symbols: MathSymbol[] }[] = [
  {
    title: "Operations",
    symbols: [
      { label: "√", latex: "\\sqrt{}", display: "√", tooltip: "Square root" },
      { label: "ⁿ√", latex: "\\sqrt[n]{}", display: "ⁿ√", tooltip: "Nth root" },
      { label: "a/b", latex: "\\frac{}{}", display: "⅟", tooltip: "Fraction" },
      { label: "xⁿ", latex: "^{}", display: "xⁿ", tooltip: "Superscript / Power" },
      { label: "xₙ", latex: "_{}", display: "xₙ", tooltip: "Subscript" },
      { label: "∫", latex: "\\int ", display: "∫", tooltip: "Integral" },
      { label: "∑", latex: "\\sum ", display: "∑", tooltip: "Summation" },
      { label: "∏", latex: "\\prod ", display: "∏", tooltip: "Product" },
      { label: "lim", latex: "\\lim_{x \\to }", display: "lim", tooltip: "Limit" },
      { label: "∞", latex: "\\infty", display: "∞", tooltip: "Infinity" },
    ],
  },
  {
    title: "Greek",
    symbols: [
      { label: "α", latex: "\\alpha", display: "α", tooltip: "Alpha" },
      { label: "β", latex: "\\beta", display: "β", tooltip: "Beta" },
      { label: "γ", latex: "\\gamma", display: "γ", tooltip: "Gamma" },
      { label: "δ", latex: "\\delta", display: "δ", tooltip: "Delta" },
      { label: "θ", latex: "\\theta", display: "θ", tooltip: "Theta" },
      { label: "λ", latex: "\\lambda", display: "λ", tooltip: "Lambda" },
      { label: "π", latex: "\\pi", display: "π", tooltip: "Pi" },
      { label: "Σ", latex: "\\Sigma", display: "Σ", tooltip: "Sigma (uppercase)" },
      { label: "Δ", latex: "\\Delta", display: "Δ", tooltip: "Delta (uppercase)" },
      { label: "Ω", latex: "\\Omega", display: "Ω", tooltip: "Omega" },
    ],
  },
  {
    title: "Relations",
    symbols: [
      { label: "±", latex: "\\pm", display: "±", tooltip: "Plus-minus" },
      { label: "×", latex: "\\times", display: "×", tooltip: "Multiply" },
      { label: "÷", latex: "\\div", display: "÷", tooltip: "Divide" },
      { label: "≠", latex: "\\neq", display: "≠", tooltip: "Not equal" },
      { label: "≤", latex: "\\leq", display: "≤", tooltip: "Less or equal" },
      { label: "≥", latex: "\\geq", display: "≥", tooltip: "Greater or equal" },
      { label: "≈", latex: "\\approx", display: "≈", tooltip: "Approximately" },
      { label: "∈", latex: "\\in", display: "∈", tooltip: "Element of" },
      { label: "→", latex: "\\rightarrow", display: "→", tooltip: "Right arrow" },
      { label: "°", latex: "^{\\circ}", display: "°", tooltip: "Degree" },
    ],
  },
];

interface MathToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInsert: (newValue: string, cursorPos: number) => void;
}

export function MathToolbar({ textareaRef, onInsert }: MathToolbarProps) {
  const insertSymbol = (latex: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    // Wrap in $ delimiters if not already inside one
    const before = value.substring(0, start);
    const after = value.substring(end);
    
    // Check if cursor is already inside $ delimiters
    const lastDollar = before.lastIndexOf("$");
    const isInsideMath = lastDollar !== -1 && 
      (before.substring(lastDollar).match(/\$/g)?.length || 0) % 2 === 1;

    let insertion: string;
    let cursorOffset: number;

    if (isInsideMath) {
      insertion = latex;
      cursorOffset = start + latex.length;
    } else {
      insertion = `$${latex}$`;
      cursorOffset = start + 1 + latex.length; // position before closing $
    }

    // If latex has {} placeholder, position cursor inside it
    const braceIndex = insertion.indexOf("{}");
    if (braceIndex !== -1) {
      cursorOffset = start + (isInsideMath ? 0 : 1) + latex.indexOf("{}") + 1;
    }

    const newValue = before + insertion + after;
    onInsert(newValue, cursorOffset);

    // Restore focus
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorOffset, cursorOffset);
    }, 0);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-wrap gap-0.5 p-2 bg-muted/50 rounded-t-md border border-b-0">
        {mathGroups.map((group, gIdx) => (
          <div key={group.title} className="flex items-center gap-0.5">
            {gIdx > 0 && <div className="w-px h-6 bg-border mx-1" />}
            {group.symbols.map((sym) => (
              <Tooltip key={sym.label + sym.latex}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-xs font-mono hover:bg-primary/10"
                    onClick={() => insertSymbol(sym.latex)}
                  >
                    {sym.display}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p>{sym.tooltip}</p>
                  <code className="text-[10px] text-muted-foreground">{sym.latex}</code>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
