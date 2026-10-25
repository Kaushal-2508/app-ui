// Shared helpers for resolving a class's grade_number / grade_level_id from
// its name. Numeric classes (Class 1..12) match via /\d+/; pre-school classes
// (Pre Nursery / Nursery / LKG / UKG) need a name-based lookup because they
// have no digit in their name and are stored with negative grade_numbers in
// public.grade_levels. Keep this table in sync with the equivalent maps in
// src/lib/subjectCode.ts and src/hooks/useClassGroups.ts (kept inline there
// to avoid an import cycle).
//
// Grade numbers:
//   Pre Nursery = -4 (migration 20260513000000)
//   Nursery     = -3
//   LKG         = -2
//   UKG         = -1
//   Pre-School  =  0 (legacy "Grade 0")
//   Class N     =  N

import { supabase } from "@/integrations/supabase/client";

const LOWER_GRADE_NUMBER_BY_NAME: Record<string, number> = {
  prenursery: -4,
  nursery: -3,
  lkg: -2,
  ukg: -1,
};

/** Pull the canonical grade_number out of a class name. Returns null only when
 * the name is neither numeric ("Class 5") nor a recognized pre-school label
 * ("Nursery"). 0 and negative results are valid — callers must check for
 * `=== null` rather than relying on falsiness. */
export function extractGradeNumberFromClassName(
  name: string | null | undefined,
): number | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  // Strip a trailing section suffix like " - A" / " – Red" so a formatted
  // name ("Class 1 - A") still resolves correctly.
  const head = trimmed.split(/\s+[-–—]\s+/)[0].trim();

  const numMatch = head.match(/\d+/);
  if (numMatch) return parseInt(numMatch[0], 10);

  const key = head.toLowerCase().replace(/[^a-z0-9]/g, "");
  return LOWER_GRADE_NUMBER_BY_NAME[key] ?? null;
}

/** One-shot helper: read the class's name, derive the grade_number, then
 * resolve the grade_levels.id. Returns `{ gradeNumber, gradeLevelId }` so the
 * caller can show grade-specific error messages. */
export async function resolveGradeLevelIdForClass(classId: string): Promise<{
  gradeNumber: number | null;
  gradeLevelId: string | null;
  className: string | null;
}> {
  const { data: classRow, error: classErr } = await supabase
    .from("classes")
    .select("name")
    .eq("id", classId)
    .maybeSingle();
  if (classErr) throw classErr;

  const className = (classRow as { name: string } | null)?.name ?? null;
  const gradeNumber = extractGradeNumberFromClassName(className);
  if (gradeNumber === null) {
    return { gradeNumber: null, gradeLevelId: null, className };
  }

  const { data: gradeRow, error: gradeErr } = await supabase
    .from("grade_levels")
    .select("id")
    .eq("grade_number", gradeNumber)
    .maybeSingle();
  if (gradeErr) throw gradeErr;

  return {
    gradeNumber,
    gradeLevelId: (gradeRow as { id: string } | null)?.id ?? null,
    className,
  };
}
