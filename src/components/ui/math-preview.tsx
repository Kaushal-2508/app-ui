import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathPreviewProps {
  text: string;
  className?: string;
}

/**
 * Renders text with inline ($...$) and block ($$...$$) LaTeX math.
 * Falls back to plain text if no LaTeX is detected.
 */
export function MathPreview({ text, className }: MathPreviewProps) {
  const renderedHtml = useMemo(() => {
    if (!text) return "";

    // Check if there's any LaTeX
    if (!text.includes("$")) return "";

    try {
      // Split on $$...$$ (block) and $...$ (inline)
      // Process block math first, then inline
      let result = text;

      // Block math: $$...$$
      result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
        try {
          return katex.renderToString(latex.trim(), {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          return `<span class="text-destructive">[Math Error: ${latex}]</span>`;
        }
      });

      // Inline math: $...$  (but not $$)
      result = result.replace(/(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)/g, (_, latex) => {
        try {
          return katex.renderToString(latex.trim(), {
            displayMode: false,
            throwOnError: false,
          });
        } catch {
          return `<span class="text-destructive">[Math Error: ${latex}]</span>`;
        }
      });

      return result;
    } catch {
      return "";
    }
  }, [text]);

  if (!renderedHtml || !text.includes("$")) return null;

  return (
    <div
      className={`p-3 bg-muted/30 rounded-md border border-dashed text-sm ${className || ""}`}
    >
      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-medium">Preview</p>
      <div
        className="prose prose-sm dark:prose-invert max-w-none math-preview"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  );
}
