// Canonical class-name ordering used everywhere a list of classes is shown.
// Order: Nursery → Pre-KG → LKG → UKG → Class 1 → Class 2 → … → Class 12,
// then by section (A, B, C, …). Anything we can't classify (e.g. "Special
// Batch") sinks to the end alphabetically so it stays deterministic.
//
// Use `compareClassNames` for a primitive `string` comparator, or
// `compareClassRows` when you have `{ name, section? }`-shaped rows.
// Most callers should reach for `sortClassRows(rows, getName, getSection?)`.

const PRE_K_KEYS: { match: RegExp; rank: number }[] = [
  { match: /^pre[\s-]*nursery$/i, rank: -100 },
  { match: /^play\s*school$/i, rank: -95 },
  { match: /^nursery$/i, rank: -80 },
  { match: /^prep$/i, rank: -60 },
  { match: /^pre[\s-]*kg$/i, rank: -55 },
  { match: /^pre[\s-]*k$/i, rank: -55 },
  { match: /^kindergarten$/i, rank: -45 },
  { match: /^kg$/i, rank: -45 },
  { match: /^l\.?\s*k\.?\s*g\.?$/i, rank: -40 },
  { match: /^lower\s*kg$/i, rank: -40 },
  { match: /^lower\s*kindergarten$/i, rank: -40 },
  { match: /^u\.?\s*k\.?\s*g\.?$/i, rank: -20 },
  { match: /^upper\s*kg$/i, rank: -20 },
  { match: /^upper\s*kindergarten$/i, rank: -20 },
];

const UNKNOWN_RANK = 9999;

export function classNameRank(rawName: string | null | undefined): number {
  const name = (rawName ?? "").trim();
  if (!name) return UNKNOWN_RANK;

  // Strip a trailing section-suffix like " - A" / " - Red" / " – B" so that
  // formatClassName("Nursery", "A") = "Nursery - A" still ranks as Nursery.
  // The PRE_K_KEYS regexes are anchored (^…$); without this split they would
  // miss any section-formatted name and the row would sink to UNKNOWN_RANK.
  const head = name.split(/\s+[-–—]\s+/)[0].trim();

  // Strip a leading "Class" / "Grade" / "Std" prefix before regex matching so
  // "Class 1" and "Grade 1" both reach the numeric branch, but bare
  // "Nursery" still hits the pre-K table.
  const stripped = head.replace(/^\s*(class|grade|std\.?|standard)\s*/i, "").trim();

  for (const { match, rank } of PRE_K_KEYS) {
    if (match.test(stripped) || match.test(head) || match.test(name)) return rank;
  }

  // First numeric run wins — "Class 12 Commerce" → 12.
  const numMatch = stripped.match(/\d+/) ?? head.match(/\d+/) ?? name.match(/\d+/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[0], 10);
    if (Number.isFinite(n)) return n;
  }

  return UNKNOWN_RANK;
}

export function compareClassNames(a: string | null | undefined, b: string | null | undefined): number {
  const ra = classNameRank(a);
  const rb = classNameRank(b);
  if (ra !== rb) return ra - rb;
  // Same numeric rank — fall back to locale-sensitive name compare so
  // "Class 12 Commerce" sits before "Class 12 Science".
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base", numeric: true });
}

function compareSections(a: string | null | undefined, b: string | null | undefined): number {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (sa === sb) return 0;
  if (!sa) return -1;
  if (!sb) return 1;
  return sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
}

export function compareClassRows<T extends { name?: string | null; section?: string | null }>(
  a: T,
  b: T,
): number {
  const byName = compareClassNames(a.name ?? "", b.name ?? "");
  if (byName !== 0) return byName;
  return compareSections(a.section ?? null, b.section ?? null);
}

export function sortClassRows<T>(
  rows: readonly T[],
  getName: (row: T) => string | null | undefined,
  getSection?: (row: T) => string | null | undefined,
): T[] {
  return [...rows].sort((a, b) => {
    const byName = compareClassNames(getName(a), getName(b));
    if (byName !== 0) return byName;
    if (getSection) return compareSections(getSection(a), getSection(b));
    return 0;
  });
}
