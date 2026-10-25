// The school clock -> the banner's time of day. PURE and import-free on purpose: a Node
// test (scripts/test-banner-tod.mjs) loads this file directly with type stripping, so it
// may use only erasable TypeScript (no enums, no namespaces, no imports).
//
// Light theme follows the school's local wall clock (design spec section 0):
//   morning  before 11:00
//   midday   11:00 to 14:59
//   golden   15:00 to 18:59
//   dusk     from 19:00
// The dark theme is always "night"; that choice is made by the caller, not here.

export type ClockTod = "morning" | "midday" | "golden" | "dusk";

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

// Seconds of the local day at which the time of day changes. 24:00 is the midnight
// wrap back to morning.
const BOUNDARIES_S = [11 * 3600, 15 * 3600, 19 * 3600, 24 * 3600];
const DAY_S = 24 * 3600;

// One Intl.DateTimeFormat per zone, built once: building one costs about 10 ms at 4x
// CPU, and the clock asks every boundary and every return to the tab. An invalid zone
// is cached against the default zone's formatter, so it is only tried once.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-GB", { ...FORMAT_OPTIONS, timeZone });
  } catch {
    // RangeError for an unknown IANA zone: fall back to the school default.
    f = FORMATTERS.get(DEFAULT_TIME_ZONE) ?? new Intl.DateTimeFormat("en-GB", { ...FORMAT_OPTIONS, timeZone: DEFAULT_TIME_ZONE });
    FORMATTERS.set(DEFAULT_TIME_ZONE, f);
  }
  FORMATTERS.set(timeZone, f);
  return f;
}

/** True when `timeZone` is an IANA zone this runtime's Intl accepts. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock hour, minute and second in `timeZone` (invalid zone: the default). */
export function clockParts(date: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): { h: number; m: number; s: number } {
  const parts = formatterFor(timeZone || DEFAULT_TIME_ZONE).formatToParts(date);
  let h = 0;
  let m = 0;
  let s = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
    else if (p.type === "second") s = Number(p.value);
  }
  // Some older engines print midnight as "24" even with hourCycle h23.
  return { h: h % 24, m, s };
}

/** The light-theme time of day for `date` on the school's clock. */
export function todFromClock(date: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): ClockTod {
  const { h } = clockParts(date, timeZone);
  if (h < 11) return "morning";
  if (h < 15) return "midday";
  if (h < 19) return "golden";
  return "dusk";
}

// Seconds since local midnight, with the date's own milliseconds (every zone in use
// today is offset by whole minutes, so the sub-second part is zone-independent).
function localSeconds(date: Date, timeZone: string): number {
  const { h, m, s } = clockParts(date, timeZone);
  const ms = ((date.getTime() % 1000) + 1000) % 1000;
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Milliseconds from `date` to the next of 11:00, 15:00, 19:00 or midnight on the
 * school's clock. Exact on ordinary days; on a daylight-saving transition day the
 * wall-clock distance is corrected by one step so the timer still lands on the local
 * boundary (a skipped local time falls back to the uncorrected distance).
 */
export function msUntilNextBoundary(date: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): number {
  const now = localSeconds(date, timeZone);
  let next = DAY_S;
  for (const b of BOUNDARIES_S) {
    if (b > now) {
      next = b;
      break;
    }
  }
  const wallMs = (next - now) * 1000;
  // One correction step for DST: where does the wall-clock distance actually land?
  const landed = localSeconds(new Date(date.getTime() + wallMs), timeZone);
  let drift = (next % DAY_S) - landed;
  if (drift > DAY_S / 2) drift -= DAY_S;
  else if (drift <= -DAY_S / 2) drift += DAY_S;
  const corrected = wallMs + drift * 1000;
  return Math.round(corrected > 0 ? corrected : wallMs);
}
