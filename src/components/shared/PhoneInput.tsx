import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { INDIAN_MOBILE_DIGITS, normalizeIndianMobile, phoneErrorMessage } from "@/lib/phone";

export interface PhoneInputProps {
  id?: string;
  /** The form's current value: 10 digits, fewer while typing, or an older stored shape. */
  value: string;
  /** Receives the bare digits (10 when complete), or "" when cleared. */
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Indian mobile number field (work-queue Task 21). The `+91` is drawn inside
 * the box at the same size as the digits and cannot be typed over; the person
 * enters the 10 national digits. A pasted `+91 98765 43210`, `09876543210` or
 * `0091 98765 43210` is normalised; an 11th typed digit is ignored instead of
 * rewriting the number; anything that does not come out at 10 digits is shown
 * with a reason and never cut (see src/lib/phone.ts).
 *
 * A stored value that is NOT an Indian mobile (`+44 7911 123456`, a landline)
 * is shown exactly as saved with a Replace action, so opening a form never
 * rewrites it and re-saving sends it back untouched; only Replace starts a
 * new 10-digit entry.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
}: PhoneInputProps) {
  // "Legacy" is a stored value that is not an Indian mobile and that the
  // person has not touched yet. The parent may fill the value asynchronously
  // (a dialog loading its record), so the test is on the value plus a touched
  // flag, never on what was mounted first. The flag flips on Replace and on
  // the first keystroke, so a half-typed "0" is never mistaken for a legacy
  // value and shown read-only.
  const [touched, setTouched] = useState(false);
  const normalized = normalizeIndianMobile(value);
  const legacy = !touched && value.trim() !== "" && !normalized.ok;
  const errorId = id ? `${id}-error` : undefined;

  if (legacy) {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="text"
            value={value}
            readOnly
            disabled={disabled}
            aria-label={ariaLabel}
            aria-describedby={errorId}
            className="bg-muted/60 text-ink-700"
          />
          {!disabled && (
            <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={() => { setTouched(true); onChange(""); }}>
              Replace
            </Button>
          )}
        </div>
        <p id={errorId} className="text-xs text-ink-500">
          Kept exactly as saved. Replace it to enter a 10-digit mobile.
        </p>
      </div>
    );
  }

  const digits = normalized.digits;
  const error = phoneErrorMessage(normalized);

  const handleChange = (typed: string) => {
    setTouched(true);
    // Up to 14 digits are kept (0091 + 10): a prefix typed key by key
    // ("+91 98765 43210") resolves to the 10 national digits the moment the
    // last one lands, and anything that does not resolve is shown with the
    // "more than 10 digits" message rather than cut. (Tushar's review,
    // 2026-10-07: dropping the 11th keystroke silently saved 9198765432.)
    const typedDigits = typed.replace(/\D/g, "").slice(0, 14);
    if (typedDigits.length <= INDIAN_MOBILE_DIGITS) {
      onChange(typedDigits);
      return;
    }
    const n = normalizeIndianMobile(typedDigits);
    onChange(n.ok ? n.digits : typedDigits);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="relative">
        {/* Same type scale as the Input (text-base on phones, text-sm from md),
            so the prefix and the digits read as one number. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-ink-500 tabular-nums md:text-sm"
        >
          +91
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={digits}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          required={required}
          placeholder="10-digit mobile"
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="pl-12 tabular-nums"
        />
      </div>
      {error && (
        <p id={errorId} className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
