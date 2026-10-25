/**
 * Deterministic subject -> accent class for the student timetable.
 *
 * Hashes the subject NAME, not the tt_slots row id: a class holds several rows
 * for the same subject across the week, and keying on id would paint Monday's
 * Maths differently from Thursday's.
 *
 * The classes themselves (.subj-1 .. .subj-8, .subj-cell) live in index.css and
 * are defined for both themes, so an accent can never ship as a colour that
 * only resolves in light mode.
 */
const ACCENT_COUNT = 8;

export function subjectAccentClass(subject: string | null | undefined): string {
  if (!subject) return "subj-1";
  // FNV-ish rolling hash: cheap, stable across engines, and well spread over
  // the handful of subjects a single class actually carries.
  let hash = 2166136261;
  const key = subject.trim().toLowerCase();
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `subj-${(Math.abs(hash) % ACCENT_COUNT) + 1}`;
}
