import { describe, expect, it } from "vitest";
import {
  app,
  createInviteCode,
  createToken,
  hashToken,
  isRangeInsideSchedule,
} from "../src";

describe("credentials", () => {
  it("creates eight-character unambiguous invite codes", () => {
    const codes = Array.from({ length: 100 }, createInviteCode);
    expect(new Set(codes).size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  });

  it("hashes tokens deterministically without storing the token", async () => {
    const token = createToken();
    expect(token.length).toBeGreaterThan(40);
    expect(await hashToken(token)).toBe(await hashToken(token));
    expect(await hashToken(token)).not.toContain(token);
  });
});

describe("HTTP app", () => {
  it("serves health and rejects invalid schedule input", async () => {
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "publicalendar-api" });

    const invalid = await app.request("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(invalid.status).toBe(400);
  });
});

describe("availability date validation", () => {
  const dateRanges = [
    { startDate: "2026-07-01", endDate: "2026-07-03" },
    { startDate: "2026-07-10", endDate: "2026-07-12" },
  ];

  it("accepts a range contained by one allowed date range", () => {
    expect(isRangeInsideSchedule(
      {
        start: Date.parse("2026-07-02T01:00:00Z"),
        end: Date.parse("2026-07-03T23:00:00Z"),
      },
      { time_zone: "UTC" },
      dateRanges,
    )).toBe(true);
  });

  it("rejects a range crossing an activity gap", () => {
    expect(isRangeInsideSchedule(
      {
        start: Date.parse("2026-07-03T23:00:00Z"),
        end: Date.parse("2026-07-10T01:00:00Z"),
      },
      { time_zone: "UTC" },
      dateRanges,
    )).toBe(false);
  });
});
