/**
 * Class promotion utility — handles auto-increment logic for Indian school class names.
 */

const CLASS_ORDER = [
  "Pre Nursery",
  "Nursery",
  "LKG",
  "UKG",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11",
  "Class 12",
];

/**
 * Given a current class name, returns the suggested next class name.
 * Returns null for terminal classes (Class 12) or Class 10 (needs manual stream selection).
 */
export function getNextClassName(currentName: string): string | null {
  // Normalize: trim whitespace
  const normalized = currentName.trim();

  // Direct lookup in ordered list
  const idx = CLASS_ORDER.findIndex(
    (c) => c.toLowerCase() === normalized.toLowerCase()
  );
  if (idx !== -1) {
    if (idx >= CLASS_ORDER.length - 1) return null; // Terminal (Class 12)
    return CLASS_ORDER[idx + 1];
  }

  // Handle "Class N ..." pattern (e.g., "Class 11 Science - Medical" → "Class 12 Science - Medical")
  const match = normalized.match(/^Class\s+(\d+)(.*)/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const suffix = match[2]; // e.g., " Science - Medical"
    if (num >= 12) return null;
    return `Class ${num + 1}${suffix}`;
  }

  return null;
}

/**
 * Find a matching class from available classes based on target name and section.
 */
export function findMatchingClass(
  classes: Array<{ id: string; name: string; section: string | null; academic_year: string }>,
  targetName: string,
  targetSection: string | null,
  targetAcademicYear: string
): { id: string; name: string; section: string | null } | null {
  // Filter by academic year first
  const yearClasses = classes.filter((c) => c.academic_year === targetAcademicYear);

  // Try exact match (name + section)
  const exact = yearClasses.find(
    (c) =>
      c.name.toLowerCase() === targetName.toLowerCase() &&
      (c.section || null) === (targetSection || null)
  );
  if (exact) return exact;

  // Try name-only match (any section)
  const nameMatch = yearClasses.find(
    (c) => c.name.toLowerCase() === targetName.toLowerCase()
  );
  if (nameMatch) return nameMatch;

  return null;
}

/**
 * Get the current academic year string (e.g., "2026-2027").
 */
export function getCurrentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  // Indian academic year typically starts April
  const startYear = now.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

/**
 * Get the next academic year string.
 */
export function getNextAcademicYear(): string {
  const current = getCurrentAcademicYear();
  const parts = current.split("-");
  const start = parseInt(parts[0], 10) + 1;
  return `${start}-${start + 1}`;
}

/**
 * Get all unique class names from the ordered list.
 */
export function getClassOrder(): string[] {
  return [...CLASS_ORDER];
}
