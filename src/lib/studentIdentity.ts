/**
 * "Roll 12 · Adm AIS/2024/019" — the identity line rendered beside a student's
 * name on every exam surface (online, offline, hybrid) so whoever is marking can
 * tie the sheet in front of them to the right student.
 *
 * Both fields are optional in `profiles` and a large share of rows carry only
 * one of them, so never render a bare "Roll " / "Adm " label for a null value:
 * an empty string means "show nothing", not "show a blank".
 */
export function formatStudentIdLine(
  rollNumber: string | null | undefined,
  admissionNumber: string | null | undefined,
): string {
  return [
    rollNumber ? `Roll ${rollNumber}` : null,
    admissionNumber ? `Adm ${admissionNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function hasRoll(roll: string | null | undefined): boolean {
  return (roll ?? "").trim() !== "";
}

/**
 * `numeric: true` is what makes 2 sort before 10; a plain string compare gives
 * 1, 10, 11, 2. `parseInt` is NOT a substitute — it maps "A12" and "" to the
 * same value and drags blank rolls to the top of the list.
 */
function compareRoll(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "")
    .trim()
    .localeCompare((b ?? "").trim(), undefined, { numeric: true, sensitivity: "base" });
}

function compareName(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

/**
 * Whether a set of students should be listed in roll-number order.
 *
 * Only when EVERY student in the block has a roll number. The moment one is
 * missing, roll order would interleave numbered and unnumbered students in a
 * sequence that matches nothing the school recognises, so the block falls back
 * to alphabetical — which is the order the school ERP uses while roll
 * allocation is still in progress.
 */
export function blockUsesRollOrder<T>(
  rows: readonly T[],
  getRoll: (row: T) => string | null | undefined,
): boolean {
  return rows.length > 0 && rows.every((row) => hasRoll(getRoll(row)));
}

export interface StudentRosterOrder<T> {
  getRoll: (row: T) => string | null | undefined;
  getName: (row: T) => string | null | undefined;
  /**
   * Rows sharing a key form one block and are ordered independently of the
   * other blocks. Use it whenever a list spans classes/sections/exams — a
   * fully-allocated Class 9 A must not lose roll order just because a
   * half-allocated Class 4 B appears in the same list. Omit for a single class.
   */
  getGroupKey?: (row: T) => string;
  /** Order of the blocks themselves. Defaults to the group key, natural sort. */
  compareGroups?: (a: T, b: T) => number;
}

/**
 * THE ordering rule for every student roster in the app.
 *
 * Per block (a class, a section, one exam's candidates):
 * - every student has a roll number  → roll-number order
 * - anyone is missing one            → alphabetical by name
 *
 * The decision is per block and never per student. A roster that is 5-of-26
 * allocated reads alphabetically end to end, the way the school ERP lists it,
 * instead of showing five numbered students above twenty-one unnumbered ones.
 *
 * Returns a new array; the input is untouched, so it is safe to call directly
 * on React Query data.
 */
export function sortStudentRoster<T>(
  rows: readonly T[],
  { getRoll, getName, getGroupKey, compareGroups }: StudentRosterOrder<T>,
): T[] {
  const keyOf = getGroupKey ?? (() => "");

  // Decide roll-vs-alphabetical once per block, before sorting, so the
  // comparator stays consistent (a comparator that decides per pair is not
  // transitive and lets sort() return an arbitrary order).
  const rollOrderedBlocks = new Set<string>();
  const blocks = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(row);
    else blocks.set(key, [row]);
  }
  for (const [key, bucket] of blocks) {
    if (blockUsesRollOrder(bucket, getRoll)) rollOrderedBlocks.add(key);
  }

  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== kb) {
      return compareGroups
        ? compareGroups(a, b)
        : ka.localeCompare(kb, undefined, { numeric: true });
    }
    if (rollOrderedBlocks.has(ka)) {
      const byRoll = compareRoll(getRoll(a), getRoll(b));
      if (byRoll !== 0) return byRoll;
    }
    return compareName(getName(a), getName(b));
  });
}
