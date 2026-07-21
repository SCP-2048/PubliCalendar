import { describe, expect, it } from "vitest";
import {
  createScheduleSchema,
  intersectRangeSets,
  mergeDateRanges,
  unionRanges,
} from "../src";

describe("unionRanges", () => {
  it("sorts and merges overlapping or adjacent ranges", () => {
    expect(
      unionRanges([
        { start: 20, end: 30 },
        { start: 1, end: 10 },
        { start: 8, end: 20 },
        { start: 40, end: 50 },
      ]),
    ).toEqual([
      { start: 1, end: 30 },
      { start: 40, end: 50 },
    ]);
  });

  it("does not mutate input", () => {
    const input = [{ start: 2, end: 4 }];
    unionRanges(input)[0]!.end = 9;
    expect(input[0]!.end).toBe(4);
  });
});

describe("intersectRangeSets", () => {
  it("intersects the union of every participant", () => {
    expect(
      intersectRangeSets([
        [
          { start: 1, end: 6 },
          { start: 5, end: 12 },
        ],
        [
          { start: 3, end: 8 },
          { start: 10, end: 15 },
        ],
        [{ start: 4, end: 11 }],
      ]),
    ).toEqual([
      { start: 4, end: 8 },
      { start: 10, end: 11 },
    ]);
  });

  it("returns empty without submitted participants", () => {
    expect(intersectRangeSets([])).toEqual([]);
  });

  it("returns empty when one participant submitted no available time", () => {
    expect(intersectRangeSets([[{ start: 1, end: 10 }], []])).toEqual([]);
  });
});

describe("schedule validation", () => {
  it("accepts a 100-year span and rejects a longer range", () => {
    const base = { name: "发布会", timeZone: "Asia/Shanghai" };
    expect(createScheduleSchema.safeParse({
      ...base,
      dateRanges: [{ startDate: "2026-07-01", endDate: "2126-07-01" }],
    }).success).toBe(true);
    expect(createScheduleSchema.safeParse({
      ...base,
      dateRanges: [{ startDate: "2026-07-01", endDate: "2126-07-02" }],
    }).success).toBe(false);
  });

  it("rejects calendar dates normalized by Date.parse", () => {
    expect(
      createScheduleSchema.safeParse({
        name: "无效日期",
        dateRanges: [{ startDate: "2026-02-30", endDate: "2026-03-01" }],
        timeZone: "Asia/Shanghai",
      }).success,
    ).toBe(false);
  });

  it("requires at least one date range", () => {
    expect(createScheduleSchema.safeParse({
      name: "无日期",
      dateRanges: [],
      timeZone: "Asia/Shanghai",
    }).success).toBe(false);
  });
});

describe("mergeDateRanges", () => {
  it("sorts and merges overlapping and adjacent calendar ranges", () => {
    expect(mergeDateRanges([
      { startDate: "2026-07-10", endDate: "2026-07-12" },
      { startDate: "2026-07-01", endDate: "2026-07-03" },
      { startDate: "2026-07-04", endDate: "2026-07-08" },
      { startDate: "2026-07-08", endDate: "2026-07-10" },
      { startDate: "2026-08-01", endDate: "2026-08-02" },
    ])).toEqual([
      { startDate: "2026-07-01", endDate: "2026-07-12" },
      { startDate: "2026-08-01", endDate: "2026-08-02" },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ startDate: "2026-07-01", endDate: "2026-07-02" }];
    mergeDateRanges(input)[0]!.endDate = "2026-07-09";
    expect(input[0]!.endDate).toBe("2026-07-02");
  });
});
