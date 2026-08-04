// Time helpers for the Amenities module.
//
// Everything an admin types is a wall-clock string ("06:30") in the society's
// timezone, while everything stored is a UTC instant. Mixing those two is how
// "the pool shows closed at 6am" bugs happen, so all conversion goes through
// this file and nowhere else.

export const HHMM_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export function isHHmm(v) {
  return typeof v === "string" && HHMM_RE.test(v);
}

// "06:30" -> 390
export function toMinutes(hhmm) {
  if (!isHHmm(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// 390 -> "06:30". Values >= 1440 wrap, which only happens for a slot that
// crosses midnight; callers cap before that.
export function fromMinutes(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Parts of `date` as seen in `timeZone`. Intl is used rather than a date
// library because it is built in, DST-correct, and this is the only place that
// needs it.
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    dayOfWeek: weekdayIndex,
    dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

// Local calendar day bucket, e.g. "2026-08-04". This is the analytics grain:
// bucketing by UTC day would file a 1am session under the previous day for
// every Indian society.
export function dayKey(date, timeZone = "Asia/Kolkata") {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function minutesOfDay(date, timeZone = "Asia/Kolkata") {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function dayOfWeek(date, timeZone = "Asia/Kolkata") {
  return zonedParts(date, timeZone).dayOfWeek;
}

export function hourOfDay(date, timeZone = "Asia/Kolkata") {
  return zonedParts(date, timeZone).hour;
}

// Inclusive list of dayKeys between two dates, used to build chart axes that
// include days with zero activity (a gap in a usage chart must read as "nobody
// came", not "no data").
export function dayKeyRange(from, to, timeZone = "Asia/Kolkata") {
  const out = [];
  const cursor = new Date(from.getTime());
  let guard = 0;
  while (cursor <= to && guard < 4000) {
    out.push(dayKey(cursor, timeZone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

// UTC offset (ms, east-positive) of `timeZone` at the instant `date`. Found by
// asking Intl what wall-clock time that instant shows there, then comparing.
function offsetMsAt(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  return asUtc - date.getTime();
}

// The UTC instant of local midnight on `dayKeyStr` ("2026-03-15") in
// `timeZone`. Two passes: the first guess (treating the date as if it were
// already UTC) gives an instant close enough to look up the real offset,
// then that offset corrects the guess - handles DST transitions, not just
// the fixed +05:30 the tests exercise.
export function startOfDayUtc(dayKeyStr, timeZone = "Asia/Kolkata") {
  const [y, m, d] = dayKeyStr.split("-").map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = offsetMsAt(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offset);
}

// Half-open with the next day's startOfDayUtc, so back-to-back days never
// overlap or leave a gap even across a DST change.
export function endOfDayUtc(dayKeyStr, timeZone = "Asia/Kolkata") {
  const [y, m, d] = dayKeyStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return startOfDayUtc(nextKey, timeZone);
}

export function addDays(dateLike, days) {
  const d = new Date(dateLike);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMinutes(dateLike, minutes) {
  return new Date(new Date(dateLike).getTime() + minutes * 60000);
}

// Two [start, end) windows overlap. Used for maintenance overlap rejection and
// closure matching. Touching edges do not overlap: maintenance ending 10:00 and
// the next starting 10:00 is legal.
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

// Whole minutes between two instants, order-independent in sign but never -0
// (a caller doing `if (minutesBetween(a, a) === 0)` should not be tripped up
// by Object.is quirks).
export function minutesBetween(a, b) {
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return diff === 0 ? 0 : diff;
}
