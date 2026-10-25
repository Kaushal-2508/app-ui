/**
 * Indian mobile numbers (work-queue Task 21, 2026-10-05).
 *
 * The login resolver (`resolve-login-identifier`) matches `profiles.phone`
 * against the bare 10 digits, `+91` + 10 and `91` + 10, so the canonical
 * stored form is the 10 national digits. People type numbers every which
 * way: `09876543210`, `+91 98765 43210`, `0091 98765 43210`, `98765-43210`.
 * The first version of this cleanup dropped a leading `91` but not a leading
 * `0`, then KEPT THE FIRST TEN DIGITS, so `09876543210` saved as `0987654321`
 * (real last digit gone) and a genuine mobile starting with 91 plus one stray
 * digit lost its first two digits. Nothing here ever cuts: a number that does
 * not come out at exactly 10 digits is refused with a reason.
 */

export const INDIAN_MOBILE_DIGITS = 10;

export type PhoneNormalization =
  | { ok: true; digits: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "not_a_number" | "not_mobile"; digits: string };

/**
 * The 10 national digits from whatever was typed, pasted or stored, or why not.
 * Prefixes are removed in a fixed order and only when the length says they are
 * prefixes: `0091` with 14 digits, `91` with exactly 12, a trunk `0` with 11.
 * `9123456789` (a real mobile that starts with 91) is left alone, and
 * `91234567890` (that mobile plus a stray digit) is refused, not trimmed.
 */
export function normalizeIndianMobile(raw: string): PhoneNormalization {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty", digits: "" };
  // Digits, spaces, dots, dashes, brackets and a plus are phone punctuation;
  // anything else means this is not a phone number at all.
  if (/[^\d\s().+-]/.test(trimmed)) {
    return { ok: false, reason: "not_a_number", digits: trimmed.replace(/\D/g, "") };
  }
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 14 && digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === INDIAN_MOBILE_DIGITS) {
    // An Indian mobile starts with 6, 7, 8 or 9; a landline with its STD code
    // ("0172234567") does not (Tushar's review, 2026-10-07: it was accepted).
    if (!/^[6-9]/.test(digits)) return { ok: false, reason: "not_mobile", digits };
    return { ok: true, digits };
  }
  return { ok: false, reason: digits.length < INDIAN_MOBILE_DIGITS ? "too_short" : "too_long", digits };
}

/** True when a STORED value is an Indian mobile the +91 field can own. */
export function isIndianMobileValue(stored: string | null | undefined): boolean {
  return !!stored && normalizeIndianMobile(stored).ok;
}

/** What to tell the person under the field. Nothing while it is empty. */
export function phoneErrorMessage(n: PhoneNormalization): string | null {
  // `=== false` throughout: this project compiles with strictNullChecks off,
  // where truthiness does not narrow a discriminated union.
  if (n.ok === true || n.reason === "empty") return null;
  if (n.reason === "too_long") return "That is more than 10 digits. Remove the extra ones.";
  if (n.reason === "not_a_number") return "Only digits, with an optional +91 in front.";
  if (n.reason === "not_mobile") return "Indian mobile numbers start with 6, 7, 8 or 9. A landline can't be saved here.";
  return `Enter all 10 digits (${n.digits.length} so far).`;
}

/** `9876543210` -> `98765 43210`, the way Indian mobiles are read out. */
export function formatIndianMobile(digits: string): string {
  return digits.length === INDIAN_MOBILE_DIGITS ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

/**
 * What a form should save for a phone field, or why it must not.
 * - untouched: the stored value goes back exactly as it was, whatever its
 *   shape (`+44 7911 123456`, a landline, an old `+91` form). Opening and
 *   re-saving a record never rewrites a number nobody edited.
 * - edited and empty: null (the person cleared it).
 * - edited: the 10 digits, or an error to show.
 */
export function phoneToSave(
  current: string,
  stored: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (current === (stored ?? "")) return { ok: true, value: stored ?? null };
  const n = normalizeIndianMobile(current);
  if (n.ok === false && n.reason === "empty") return { ok: true, value: null };
  if (n.ok === false) return { ok: false, message: phoneErrorMessage(n) ?? "Enter a 10-digit mobile number." };
  return { ok: true, value: n.digits };
}
