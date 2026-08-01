import type { ScheduleView, UtcRange } from "@publicalendar/shared";
import { zonedDateTimeToUtc } from "./day-timeline";
import { unionRanges } from "./ranges";

export interface DayTimeRange {
  start: string;
  end: string;
}

export interface DayAvailabilityEntry {
  ranges: DayTimeRange[];
}

function isAllowedDate(date: string, schedule: ScheduleView): boolean {
  return schedule.dateRanges.some((range) => date >= range.startDate && date <= range.endDate);
}

function rangeWarning(range: DayTimeRange): boolean {
  return range.start >= range.end;
}

/**
 * Build merged UTC ranges for availability submit.
 * Lives outside page scripts so MP minification cannot shadow page imports
 * (`api`, `uni-bridge`, `ranges`) with loop variables.
 */
export function collectMergedRanges(
  availability: Record<string, DayAvailabilityEntry | undefined>,
  schedule: ScheduleView,
): { mergedRanges: UtcRange[]; ignoredCount: number } {
  const ranges: UtcRange[] = [];
  let ignoredCount = 0;
  const dates = Object.keys(availability).sort();
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    const entry = availability[date];
    if (!entry || !isAllowedDate(date, schedule)) continue;
    for (let j = 0; j < entry.ranges.length; j += 1) {
      const range = entry.ranges[j]!;
      if (rangeWarning(range)) {
        ignoredCount += 1;
        continue;
      }
      const start = zonedDateTimeToUtc(date, range.start, schedule.timeZone);
      const end = zonedDateTimeToUtc(date, range.end, schedule.timeZone);
      if (end <= start) {
        ignoredCount += 1;
        continue;
      }
      ranges.push({ start, end });
    }
  }
  return { mergedRanges: unionRanges(ranges), ignoredCount };
}
