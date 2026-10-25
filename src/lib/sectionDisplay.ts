/**
 * Institution-scoped section label transform (display-only).
 *
 * Alliance International School (code "AISB") displays LKG/UKG section letters
 * as colors: A -> Red, B -> Green, C -> Blue. The database still stores the
 * letters; this module only rewrites how they render.
 *
 * Wiring: InstitutionCodeBridge (mounted near the app root) calls
 * setCurrentInstitutionCode() whenever the effective institution changes.
 * Pure utilities below read that value to decide whether to transform.
 */

const AISB_CODE = "AISB";

const SECTION_COLOR_MAP: Record<string, string> = {
  A: "Red",
  B: "Green",
  C: "Blue",
};

const LKG_UKG_CLASS_NAMES = new Set(["LKG", "UKG"]);

let currentInstitutionCode: string | null = null;

export function setCurrentInstitutionCode(code: string | null) {
  currentInstitutionCode = code ? code.trim().toUpperCase() : null;
}

export function getCurrentInstitutionCode(): string | null {
  return currentInstitutionCode;
}

function isAisbLkgUkg(className: string | null | undefined, institutionCode: string | null): boolean {
  if (institutionCode !== AISB_CODE) return false;
  if (!className) return false;
  return LKG_UKG_CLASS_NAMES.has(className.trim().toUpperCase());
}

/**
 * Returns the display-friendly section label for a given class.
 * Falls back to the original section for non-matching classes/institutions.
 */
export function getDisplaySection(
  className: string | null | undefined,
  section: string | null | undefined,
  institutionCode: string | null = currentInstitutionCode,
): string | null {
  if (!section) return section ?? null;
  if (!isAisbLkgUkg(className, institutionCode)) return section;
  const key = section.trim().toUpperCase();
  return SECTION_COLOR_MAP[key] ?? section;
}
