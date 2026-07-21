import { unionRanges, type UtcRange } from "@publicalendar/shared";

export interface BarSegment {
  startPct: number;
  widthPct: number;
  tone: "green" | "gray";
}

const MS_PER_DAY = 86_400_000;

export function localParts(timestamp: number, timeZone: string) {
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
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(guess, timeZone);
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const adjustment = target - displayedAsUtc;
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

export function rangesToSegments(
  ranges: readonly UtcRange[],
  dayStart: number,
  dayEnd: number,
  tone: "green" | "gray",
): BarSegment[] {
  const duration = dayEnd - dayStart;
  if (duration <= 0) return [];
  return clipRangesToDay(ranges, dayStart, dayEnd).map((range) => ({
    startPct: ((range.start - dayStart) / duration) * 100,
    widthPct: ((range.end - range.start) / duration) * 100,
    tone,
  }));
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
    ...rangesToSegments(onlyUser, start, end, "gray"),
    ...rangesToSegments(shared, start, end, "green"),
  ].sort((a, b) => a.startPct - b.startPct);
}

export function publicBarSegments(
  publicRanges: readonly UtcRange[],
  date: string,
  timeZone: string,
): BarSegment[] {
  const { start, end } = dayBounds(date, timeZone);
  return rangesToSegments(publicRanges, start, end, "green");
}
