import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathTextProps {
  text: string | null | undefined;
  className?: string;
  as?: "span" | "div" | "p";
}

const BLOCK_RE = /\$\$([\s\S]*?)\$\$/g;
const INLINE_RE = /(?<!\$)\$(?!\$)([\s\S]*?)(?<!\$)\$(?!\$)/g;

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return `<span class="text-destructive">[Math Error]</span>`;
  }
}

export function MathText({ text, className, as: Tag = "span" }: MathTextProps) {
  const html = useMemo(() => {
    if (!text) return "";
    if (!text.includes("$")) return escapeHtml(text).replace(/\n/g, "<br />");

    let out = text.replace(BLOCK_RE, (_m, latex) => `\u0000BLOCK${renderKatex(latex, true)}\u0000`);
    out = out.replace(INLINE_RE, (_m, latex) => `\u0000INLINE${renderKatex(latex, false)}\u0000`);

    const parts = out.split("\u0000");
    return parts
      .map((part) => {
        if (part.startsWith("BLOCK")) return part.slice(5);
        if (part.startsWith("INLINE")) return part.slice(6);
        return escapeHtml(part).replace(/\n/g, "<br />");
      })
      .join("");
  }, [text]);

  if (!text) return null;

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
