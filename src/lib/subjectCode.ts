/**
 * Subject-code generation — mirrors the algorithm used in migration
 * 20260501160000_regenerate_subject_codes.sql, so the preview the user
 * sees in the UI matches what the DB will actually store.
 *
 * Rules:
 *   base   = first N alphanumeric chars of name (uppercased), starting N=3.
 *            If <base><suffix> collides with a code already in the institution,
 *            grow N by 1 until unique, capped by the name's length.
 *   suffix = grade portion of the code:
 *              - Numbered classes (1..12) → bare grade_number (e.g. "10").
 *              - Pre-school classes (Pre Nursery / Nursery / LKG / UKG) →
 *                zero-padded 3-digit slot (000 / 001 / 002 / 003) so codes
 *                read naturally (ENG001) instead of leaking the negative
 *                grade_number used internally (ENG-3).
 *   code   = base || suffix || optional -k suffix.
 *
 * Examples
 *   generateSubjectCode({ name: "English", gradeNumber: 10, gradeName: "Class 10", existingCodes: [] })
 *     → "ENG10"
 *   generateSubjectCode({ name: "EVS", gradeNumber: -3, gradeName: "Nursery", existingCodes: [] })
 *     → "EVS001"
 *   generateSubjectCode({ name: "Economic Policy", gradeNumber: 11, gradeName: "Class 11", existingCodes: new Set(["ECO11"]) })
 *     → "ECON11"   (prefix grew because ECO11 was taken)
 */

import { supabase } from "@/integrations/supabase/client";

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toUpperCase();

/**
 * Lower-grade name → zero-padded 3-digit code suffix. Keys are normalized
 * (lowercase, alphanumeric only) so "Pre Nursery" / "Pre-Nursery" / "PreNursery"
 * all hash to the same slot.
 */
const LOWER_GRADE_SUFFIX_BY_NAME: Record<string, string> = {
  prenursery: "000",
  nursery: "001",
  lkg: "002",
  ukg: "003",
};

/** Same map as above but keyed by the canonical class_group / grade name so
 * we can fall back to it when grade_levels.grade_name is missing. */
const LOWER_GRADE_NUMBER_BY_NAME: Record<string, number> = {
  prenursery: -4,
  nursery: -3,
  lkg: -2,
  ukg: -1,
};

const normalizeGradeName = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Format the grade portion of a subject code. Numbered classes (1..12) keep
 * their bare grade_number; pre-school classes get a zero-padded 3-digit slot. */
export function formatGradeForCode(
  gradeNumber: number,
  gradeName?: string | null,
): string {
  if (gradeNumber >= 1) return String(gradeNumber);

  const named = LOWER_GRADE_SUFFIX_BY_NAME[normalizeGradeName(gradeName)];
  if (named) return named;

  // Unknown low-grade row — pad the absolute value so the code still reads
  // cleanly without a stray minus sign. (Should rarely hit this branch.)
  return String(Math.abs(gradeNumber)).padStart(3, "0");
}

export function generateSubjectCode({
  name,
  gradeNumber,
  gradeName,
  existingCodes,
}: {
  name: string;
  gradeNumber: number;
  gradeName?: string | null;
  existingCodes: Iterable<string>;
}): string {
  const alnum = (name ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const base = alnum.length > 0 ? alnum : "SUB";
  const gradeSuffix = formatGradeForCode(gradeNumber, gradeName);

  const taken = new Set<string>();
  for (const c of existingCodes) {
    const n = normalize(c);
    if (n) taken.add(n);
  }

  const maxLen = Math.max(base.length, 3);
  for (let len = 3; len <= maxLen; len++) {
    const candidate = base.slice(0, len) + gradeSuffix;
    if (!taken.has(candidate)) return candidate;
  }

  // Exhausted prefix growth — fall through to -k suffix on full base
  const fullBase = base + gradeSuffix;
  for (let k = 2; k < 10000; k++) {
    const candidate = `${fullBase}-${k}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error("Cannot generate unique subject code.");
}

export interface SubjectCodeContext {
  gradeNumber: number;
  gradeName: string;
  existingCodes: string[];
}

/**
 * Load everything needed to generate a preview code:
 *   • grade_number + grade_name of the target class_group (with a name-based
 *     fallback for pre-school class_groups whose grade_level_id is NULL —
 *     legacy rows created before resolveGradeLevelId understood non-numeric
 *     grades, see useClassGroups.ts).
 *   • every active institution-scoped code currently in the institution
 *     (so the preview doesn't collide with the DB's unique index)
 */
export async function loadSubjectCodeContext({
  institutionId,
  classGroupId,
  excludeSubjectId,
}: {
  institutionId: string;
  classGroupId: string;
  excludeSubjectId?: string;
}): Promise<SubjectCodeContext | null> {
  const [cgResult, codesResult] = await Promise.all([
    supabase
      .from("class_groups")
      .select("name, grade_levels(grade_number, grade_name)")
      .eq("id", classGroupId)
      .maybeSingle(),
    supabase
      .from("universal_subjects")
      .select("id, code")
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .not("code", "is", null),
  ]);

  if (cgResult.error) throw cgResult.error;
  if (codesResult.error) throw codesResult.error;

  const cg = cgResult.data as
    | {
        name: string | null;
        grade_levels:
          | { grade_number: number; grade_name: string }
          | { grade_number: number; grade_name: string }[]
          | null;
      }
    | null;
  if (!cg) return null;

  const gl = Array.isArray(cg.grade_levels) ? cg.grade_levels[0] ?? null : cg.grade_levels;

  let gradeNumber: number | null = gl?.grade_number ?? null;
  let gradeName: string = gl?.grade_name ?? cg.name ?? "";

  // Fallback path: class_group exists but its grade_levels link is missing.
  // Derive grade_number from the class_group's own name — numeric classes via
  // /\d+/, pre-school classes via the named lookup table.
  if (gradeNumber == null && cg.name) {
    const numMatch = cg.name.match(/\d+/);
    if (numMatch) {
      gradeNumber = parseInt(numMatch[0], 10);
      if (!gradeName) gradeName = cg.name;
    } else {
      const fallback = LOWER_GRADE_NUMBER_BY_NAME[normalizeGradeName(cg.name)];
      if (fallback !== undefined) {
        gradeNumber = fallback;
        if (!gradeName) gradeName = cg.name;
      }
    }
  }

  if (gradeNumber == null) return null;

  const existingCodes = (codesResult.data ?? [])
    .filter((r: { id: string; code: string | null }) => r.id !== excludeSubjectId)
    .map((r: { id: string; code: string | null }) => r.code as string)
    .filter(Boolean);

  return { gradeNumber, gradeName, existingCodes };
}

/** Resolve class_group_id from a class (section) id. */
export async function resolveClassGroupIdFromClassId(
  classId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("classes")
    .select("class_group_id")
    .eq("id", classId)
    .maybeSingle();
  if (error) throw error;
  return (data as { class_group_id: string | null } | null)?.class_group_id ?? null;
}
