/**
 * The option lists and small helpers the two PTM forms share (PTMFormSheet
 * and ResidentialPTMSheet). Kept apart from the form components so the file
 * that exports components exports nothing else (react-refresh).
 */

export const DURATIONS = [5, 10, 15, 20, 30];

export const EDIT_WINDOWS: { value: number; label: string }[] = [
  { value: 0, label: "Until it ends" },
  { value: 1, label: "1 day after it ends" },
  { value: 3, label: "3 days after it ends" },
  { value: 7, label: "1 week after it ends" },
  { value: 14, label: "2 weeks after it ends" },
];

/** The form only asks for the slot length (Naman, 2026-09-29). The booking
 *  cutoff still travels with the form, the default for a new PTM and the
 *  stored value on an edit, so the sheet says what it is instead. */
export function bookingClosesNote(minutes: number): string {
  if (minutes <= 0) return "Families can book until the meeting starts.";
  const span =
    minutes % 1440 === 0
      ? `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`
      : minutes % 60 === 0
        ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`
        : `${minutes} minutes`;
  return `Booking closes ${span} before the meeting starts.`;
}

/** A PTM made before these presets (the old form took any 5 to 60) must
 *  still show its own value when edited, not a blank select. */
export function withCurrent<T extends { value: number }>(
  options: T[],
  current: number,
  make: (v: number) => T,
): T[] {
  if (options.some((o) => o.value === current)) return options;
  return [...options, make(current)].sort((a, b) => a.value - b.value);
}
