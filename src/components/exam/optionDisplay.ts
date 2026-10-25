/**
 * Shared rules for showing MCQ options that carry their own diagrams.
 *
 * Two different layouts are needed and the difference matters:
 *  - a text option with a supporting picture  -> small thumbnail beside the text
 *  - an option where the PICTURE IS the answer -> a large image-choice grid
 * "Which is the similar image?" with options A/B/C/D is the second kind, and
 * rendering it as four 40px thumbnails makes the question unanswerable.
 */

export interface DisplayOption {
  id?: string | null;
  text?: string | null;
  imageUrl?: string | null;
}

/** A, B, C, D … for the option at `index`. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** True when at least one option carries its own diagram. */
export function hasOptionImages(options: readonly DisplayOption[] | null | undefined): boolean {
  return !!options?.some((o) => !!o?.imageUrl);
}

/**
 * True when an option's text carries no information beyond the letter badge
 * already shown next to it — empty, or literally its own letter ("A", "a.",
 * "(B)"). Those are how teachers label a pure image choice, and repeating them
 * under the picture is noise.
 */
export function isRedundantOptionText(
  text: string | null | undefined,
  index: number,
): boolean {
  const stripped = (text ?? "").replace(/[^a-z0-9]/gi, "").trim();
  if (stripped === "") return true;
  return stripped.toLowerCase() === optionLetter(index).toLowerCase();
}
