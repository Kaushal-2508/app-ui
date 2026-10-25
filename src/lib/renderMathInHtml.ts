import katex from "katex";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// MathML output is self-contained (no external CSS or font dependencies), so the
// resulting HTML renders correctly in print windows opened via window.open and
// in html2canvas/html2pdf pipelines without needing the KaTeX stylesheet.
export function renderTextWithMathToHtml(text: string | null | undefined): string {
  if (text == null) return "";
  const src = String(text);
  if (!src.includes("$")) return escapeHtml(src);

  const segments: Array<{ kind: "plain" | "block" | "inline"; content: string }> = [];
  const pattern = /\$\$([\s\S]+?)\$\$|(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "plain", content: src.substring(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "block", content: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "inline", content: match[2] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < src.length) {
    segments.push({ kind: "plain", content: src.substring(cursor) });
  }

  return segments
    .map((seg) => {
      if (seg.kind === "plain") return escapeHtml(seg.content);
      try {
        return katex.renderToString(seg.content.trim(), {
          displayMode: seg.kind === "block",
          throwOnError: false,
          output: "mathml",
        });
      } catch {
        return escapeHtml(seg.content);
      }
    })
    .join("");
}
