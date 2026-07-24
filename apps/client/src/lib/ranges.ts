import type { DateRange, UtcRange } from "@publicalendar/shared";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Local copies of shared range helpers.
 * WeChat mini program builds mishandle named runtime imports from
 * `@publicalendar/shared` (they bind onto vendor.js and crash at call time).
 */
export function unionRanges(input: readonly UtcRange[]): UtcRange[] {
  if (input.length === 0) return [];
  const sorted = input
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const first = sorted[0];
  if (!first) return [];
  const result: UtcRange[] = [first];
  for (const current of sorted.slice(1)) {
    const previous = result[result.length - 1];
    if (!previous) continue;
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      result.push(current);
    }
  }
  return result;
}

export function mergeDateRanges(input: readonly DateRange[]): DateRange[] {
  const sorted = input
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const result: DateRange[] = [];
  for (const current of sorted) {
    if (dateToUtc(current.startDate) === null || dateToUtc(current.endDate) === null) continue;
    const previous = result[result.length - 1];
    if (!previous) {
      result.push(current);
      continue;
    }
    const dayAfterPrevious = addUtcDays(previous.endDate, 1);
    if (current.startDate <= dayAfterPrevious) {
      previous.endDate = previous.endDate >= current.endDate ? previous.endDate : current.endDate;
    } else {
      result.push(current);
    }
  }
  return result;
}

function dateToUtc(value: string): number | null {
  if (!isoDate.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function addUtcDays(value: string, days: number): string {
  const timestamp = dateToUtc(value);
  if (timestamp === null) return value;
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}
