/**
 * Splits a stored question/answer string into plain-text and math segments.
 *
 * Storage format is the project-wide convention used by `MathText` /
 * `MathPreview` and the AI generator: inline math in `$...$`, block math in
 * `$$...$$`, everything else is prose. The WYSIWYG `MathInput` editor uses this
 * to render each math run as a KaTeX "chip" while leaving prose editable.
 */
export type MathSegment =
  | { type: "text"; value: string }
  | { type: "inline"; latex: string }
  | { type: "block"; latex: string };

// `$$...$$` must be tried before `$...$` so block delimiters win.
const SEGMENT_RE = /\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$/g;

export function parseMathSegments(input: string | null | undefined): MathSegment[] {
  const segments: MathSegment[] = [];
  if (!input) return segments;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Reset state defensively (module-level regex with the global flag).
  SEGMENT_RE.lastIndex = 0;
  while ((match = SEGMENT_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: "block", latex: match[1] });
    } else {
      segments.push({ type: "inline", latex: match[2] ?? "" });
    }
    lastIndex = SEGMENT_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }
  return segments;
}

/** True when the string contains at least one `$...$` / `$$...$$` math run. */
export function hasMath(input: string | null | undefined): boolean {
  return parseMathSegments(input).some((s) => s.type !== "text");
}
