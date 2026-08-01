import type { UtcRange } from "@publicalendar/shared";
import { unionRanges } from "./ranges";

export interface BarSegment {
  startPct: number;
  widthPct: number;
  tone: "green" | "gray";
  /** Combined label, e.g. "09:00–18:00" */
  label?: string;
  startLabel?: string;
  endLabel?: string;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  date: string;
  time: string;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** Fixed standard offsets (minutes east of UTC). Used when `Intl` is missing (WeChat MP). */
const FIXED_OFFSET_MINUTES: Record<string, number> = {
  "Etc/GMT+12": -12 * 60,
  "Pacific/Pago_Pago": -11 * 60,
  "Pacific/Honolulu": -10 * 60,
  "America/Anchorage": -9 * 60,
  "America/Los_Angeles": -8 * 60,
  "America/Denver": -7 * 60,
  "America/Chicago": -6 * 60,
  "America/New_York": -5 * 60,
  "America/Halifax": -4 * 60,
  "America/Sao_Paulo": -3 * 60,
  "Atlantic/South_Georgia": -2 * 60,
  "Atlantic/Azores": -1 * 60,
  "Europe/London": 0,
  UTC: 0,
  "Etc/UTC": 0,
  "Etc/GMT": 0,
  "Europe/Paris": 60,
  "Europe/Athens": 2 * 60,
  "Europe/Moscow": 3 * 60,
  "Asia/Dubai": 4 * 60,
  "Asia/Karachi": 5 * 60,
  "Asia/Dhaka": 6 * 60,
  "Asia/Bangkok": 7 * 60,
  "Asia/Shanghai": 8 * 60,
  "Asia/Hong_Kong": 8 * 60,
  "Asia/Singapore": 8 * 60,
  "Asia/Tokyo": 9 * 60,
  "Australia/Sydney": 10 * 60,
  "Pacific/Noumea": 11 * 60,
};

let intlTimeZoneSupported: boolean | null = null;

function supportsIntlTimeZone(): boolean {
  if (intlTimeZoneSupported !== null) return intlTimeZoneSupported;
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
      intlTimeZoneSupported = false;
      return false;
    }
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    });
    if (typeof formatter.formatToParts !== "function") {
      intlTimeZoneSupported = false;
      return false;
    }
    formatter.formatToParts(new Date());
    intlTimeZoneSupported = true;
    return true;
  } catch {
    intlTimeZoneSupported = false;
    return false;
  }
}

function fixedOffsetMinutes(timeZone: string): number {
  if (timeZone in FIXED_OFFSET_MINUTES) {
    return FIXED_OFFSET_MINUTES[timeZone]!;
  }
  const etc = /^Etc\/GMT([+-])(\d{1,2})$/.exec(timeZone);
  if (etc) {
    const sign = etc[1] === "+" ? -1 : 1;
    return sign * Number(etc[2]) * 60;
  }
  return FIXED_OFFSET_MINUTES["Asia/Shanghai"]!;
}

function partsFromUtcFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): ZonedParts {
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

function localPartsWithOffset(timestamp: number, timeZone: string): ZonedParts {
  const shifted = new Date(timestamp + fixedOffsetMinutes(timeZone) * MS_PER_MINUTE);
  return partsFromUtcFields(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
  );
}

function localPartsWithIntl(timestamp: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return partsFromUtcFields(
    Number(values.year),
    Number(values.month),
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
  );
}

export function localParts(timestamp: number, timeZone: string): ZonedParts {
  if (supportsIntlTimeZone()) {
    try {
      return localPartsWithIntl(timestamp, timeZone);
    } catch {
      // Fall through when the runtime rejects this IANA zone.
    }
  }
  return localPartsWithOffset(timestamp, timeZone);
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);

  if (!supportsIntlTimeZone()) {
    return wallAsUtc - fixedOffsetMinutes(timeZone) * MS_PER_MINUTE;
  }

  let guess = wallAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(guess, timeZone);
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const adjustment = wallAsUtc - displayedAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return guess;
}

export function dayBounds(date: string, timeZone: string): { start: number; end: number } {
  const start = zonedDateTimeToUtc(date, "00:00", timeZone);
  const next = addDays(date, 1);
  const end = zonedDateTimeToUtc(next, "00:00", timeZone);
  return { start, end: end > start ? end : start + MS_PER_DAY };
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function clipRangesToDay(
  ranges: readonly UtcRange[],
  dayStart: number,
  dayEnd: number,
): UtcRange[] {
  return unionRanges(
    ranges
      .map((range) => ({
        start: Math.max(range.start, dayStart),
        end: Math.min(range.end, dayEnd),
      }))
      .filter((range) => range.start < range.end),
  );
}

export function dayAvailabilityRatio(
  ranges: readonly UtcRange[],
  date: string,
  timeZone: string,
): number {
  const { start, end } = dayBounds(date, timeZone);
  const clipped = clipRangesToDay(ranges, start, end);
  if (clipped.length === 0) return 0;
  const available = clipped.reduce((sum, range) => sum + (range.end - range.start), 0);
  const duration = end - start;
  return duration <= 0 ? 0 : Math.min(1, available / duration);
}

export function intersectTwo(a: readonly UtcRange[], b: readonly UtcRange[]): UtcRange[] {
  const left = unionRanges(a);
  const right = unionRanges(b);
  const result: UtcRange[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const l = left[i]!;
    const r = right[j]!;
    const start = Math.max(l.start, r.start);
    const end = Math.min(l.end, r.end);
    if (start < end) result.push({ start, end });
    if (l.end < r.end) i += 1;
    else j += 1;
  }
  return result;
}

export function subtractRanges(base: readonly UtcRange[], cut: readonly UtcRange[]): UtcRange[] {
  let current = unionRanges(base);
  for (const remover of unionRanges(cut)) {
    const next: UtcRange[] = [];
    for (const range of current) {
      if (remover.end <= range.start || remover.start >= range.end) {
        next.push(range);
        continue;
      }
      if (range.start < remover.start) {
        next.push({ start: range.start, end: remover.start });
      }
      if (remover.end < range.end) {
        next.push({ start: remover.end, end: range.end });
      }
    }
    current = next;
  }
  return current;
}

export function formatSegmentEndpoints(
  range: UtcRange,
  date: string,
  timeZone: string,
): { startLabel: string; endLabel: string; label: string } {
  const startParts = localParts(range.start, timeZone);
  const endParts = localParts(range.end, timeZone);
  const startLabel = `${pad(startParts.hour)}:${pad(startParts.minute)}`;
  const endLabel =
    endParts.date !== date && endParts.hour === 0 && endParts.minute === 0
      ? "24:00"
      : `${pad(endParts.hour)}:${pad(endParts.minute)}`;
  return {
    startLabel,
    endLabel,
    label: `${startLabel}-${endLabel}`,
  };
}

export function formatSegmentClockLabel(
  range: UtcRange,
  date: string,
  timeZone: string,
): string {
  return formatSegmentEndpoints(range, date, timeZone).label;
}

function formatCompactClockPart(hour: number, minute: number): string {
  return minute === 0 ? String(hour) : `${hour}:${pad(minute)}`;
}

/** Narrow calendar cell label, e.g. "8-18" or "8:30-18:15". */
export function formatCompactClockRange(
  range: UtcRange,
  date: string,
  timeZone: string,
): string {
  const startParts = localParts(range.start, timeZone);
  const endParts = localParts(range.end, timeZone);
  const startText = formatCompactClockPart(startParts.hour, startParts.minute);
  const endText =
    endParts.date !== date && endParts.hour === 0 && endParts.minute === 0
      ? "24"
      : formatCompactClockPart(endParts.hour, endParts.minute);
  return `${startText}-${endText}`;
}

export function rangesToSegments(
  ranges: readonly UtcRange[],
  dayStart: number,
  dayEnd: number,
  tone: "green" | "gray",
  date?: string,
  timeZone?: string,
): BarSegment[] {
  const duration = dayEnd - dayStart;
  if (duration <= 0) return [];
  return clipRangesToDay(ranges, dayStart, dayEnd).map((range) => {
    const clocks =
      date && timeZone ? formatSegmentEndpoints(range, date, timeZone) : undefined;
    return {
      startPct: ((range.start - dayStart) / duration) * 100,
      widthPct: ((range.end - range.start) / duration) * 100,
      tone,
      label: clocks?.label,
      startLabel: clocks?.startLabel,
      endLabel: clocks?.endLabel,
    };
  });
}

export function userBarSegments(
  userRanges: readonly UtcRange[],
  publicRanges: readonly UtcRange[],
  date: string,
  timeZone: string,
): BarSegment[] {
  const { start, end } = dayBounds(date, timeZone);
  const userDay = clipRangesToDay(userRanges, start, end);
  const publicDay = clipRangesToDay(publicRanges, start, end);
  const shared = intersectTwo(userDay, publicDay);
  const onlyUser = subtractRanges(userDay, publicDay);
  return [
    ...rangesToSegments(onlyUser, start, end, "gray", date, timeZone),
    ...rangesToSegments(shared, start, end, "green", date, timeZone),
  ].sort((a, b) => a.startPct - b.startPct);
}

export function publicBarSegments(
  publicRanges: readonly UtcRange[],
  date: string,
  timeZone: string,
): BarSegment[] {
  const { start, end } = dayBounds(date, timeZone);
  return rangesToSegments(publicRanges, start, end, "green", date, timeZone);
}

/**
 * Calendar summary under a day number.
 * - 0 ranges: []
 * - 1–2 ranges: each label (compact or full)
 * - 3+ ranges: first label only, plus "…"
 */
export function dayPublicTimeSummaries(
  publicRanges: readonly UtcRange[],
  date: string,
  timeZone: string,
  options?: { compact?: boolean },
): string[] {
  const compact = options?.compact !== false;
  const { start, end } = dayBounds(date, timeZone);
  const dayRanges = clipRangesToDay(publicRanges, start, end);
  const labels = dayRanges.map((range) =>
    compact
      ? formatCompactClockRange(range, date, timeZone)
      : formatSegmentClockLabel(range, date, timeZone),
  );
  if (labels.length <= 2) return labels;
  return [labels[0]!, "…"];
}
