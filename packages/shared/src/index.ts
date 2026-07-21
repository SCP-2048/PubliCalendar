import { z } from "zod";

export const MAX_RANGES = 100_000;
export const MAX_SCHEDULE_YEARS = 100;
export const RETENTION_DAYS = 30;

export const utcRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine(({ start, end }) => start < end, "时间段结束时间必须晚于开始时间");

export type UtcRange = z.infer<typeof utcRangeSchema>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const dateRangeSchema = z.object({
  startDate: z.string().regex(isoDate),
  endDate: z.string().regex(isoDate),
});

export type DateRange = z.infer<typeof dateRangeSchema>;

export const createScheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    dateRanges: z.array(dateRangeSchema).min(1).max(MAX_RANGES),
    timeZone: z.string().min(1).max(80),
  })
  .superRefine((value, context) => {
    for (const [index, range] of value.dateRanges.entries()) {
      const start = dateToUtc(range.startDate);
      const end = dateToUtc(range.endDate);
      if (start === null || end === null || end < start) {
        context.addIssue({
          code: "custom",
          message: "日期范围无效",
          path: ["dateRanges", index],
        });
      }
    }
    const merged = mergeDateRanges(value.dateRanges);
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (!first || !last) return;
    const start = dateToUtc(first.startDate);
    const end = dateToUtc(last.endDate);
    if (start === null || end === null) return;
    const startDate = new Date(start);
    const maxEnd = Date.UTC(
      startDate.getUTCFullYear() + MAX_SCHEDULE_YEARS,
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
    );
    if (end > maxEnd) {
      context.addIssue({ code: "custom", message: "日程日期范围最多可跨 100 年" });
    }
    try {
      new Intl.DateTimeFormat("zh-CN", { timeZone: value.timeZone }).format();
    } catch {
      context.addIssue({ code: "custom", message: "时区无效", path: ["timeZone"] });
    }
  });

export const joinScheduleSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
});

export const replaceAvailabilitySchema = z.object({
  ranges: z.array(utcRangeSchema).max(MAX_RANGES),
});

export const updateScheduleSettingsSchema = z.object({
  allowParticipantsDeleteOthers: z.boolean(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type JoinScheduleInput = z.infer<typeof joinScheduleSchema>;
export type ReplaceAvailabilityInput = z.infer<typeof replaceAvailabilitySchema>;
export type UpdateScheduleSettingsInput = z.infer<typeof updateScheduleSettingsSchema>;

export interface PublicParticipant {
  id: string;
  nickname: string;
  submitted: boolean;
}

export interface ScheduleView extends CreateScheduleInput {
  startDate: string;
  endDate: string;
  code: string;
  expiresAt: number;
  allowParticipantsDeleteOthers: boolean;
  participants: PublicParticipant[];
}

export interface CreateScheduleResult {
  schedule: ScheduleView;
  creatorToken: string;
}

export interface JoinScheduleResult {
  participant: PublicParticipant;
  participantToken: string;
}

export interface ParticipantAvailabilityView {
  id: string;
  nickname: string;
  ranges: UtcRange[];
}

export interface IntersectionResult {
  /** Count of submitted participants (unsubmitted users are not listed). */
  participantCount: number;
  submittedCount: number;
  /** Always 0; kept for older clients. */
  pendingCount: number;
  /** True when at least one participant has submitted. */
  complete: boolean;
  ranges: UtcRange[];
  submittedParticipants: ParticipantAvailabilityView[];
}

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

export function intersectRangeSets(rangeSets: readonly (readonly UtcRange[])[]): UtcRange[] {
  if (rangeSets.length === 0) return [];
  let result = unionRanges(rangeSets[0] ?? []);
  for (const ranges of rangeSets.slice(1)) {
    const right = unionRanges(ranges);
    const next: UtcRange[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < result.length && rightIndex < right.length) {
      const left = result[leftIndex];
      const other = right[rightIndex];
      if (!left || !other) break;
      const start = Math.max(left.start, other.start);
      const end = Math.min(left.end, other.end);
      if (start < end) next.push({ start, end });
      if (left.end < other.end) leftIndex += 1;
      else rightIndex += 1;
    }
    result = next;
    if (result.length === 0) break;
  }
  return result;
}
