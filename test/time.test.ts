import { describe, expect, it } from "vitest";
import { floorToSlot, SLOT_MS, startOfDay } from "../src/time";

const berlin = "Europe/Berlin";

describe("startOfDay", () => {
  it("finds local midnight in a zone", () => {
    const ts = Date.parse("2026-07-01T10:30:00Z"); // 12:30 CEST
    expect(new Date(startOfDay(ts, berlin)).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("handles the day clocks go back (25 hours)", () => {
    const ts = Date.parse("2026-10-25T12:00:00Z");
    expect(new Date(startOfDay(ts, berlin)).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("handles the day clocks go forward (23 hours)", () => {
    const ts = Date.parse("2026-03-29T12:00:00Z");
    expect(new Date(startOfDay(ts, berlin)).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("works in UTC and for half-hour zones", () => {
    const ts = Date.parse("2026-01-10T03:00:00Z");
    expect(new Date(startOfDay(ts, "UTC")).toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(new Date(startOfDay(ts, "Asia/Kolkata")).toISOString()).toBe("2026-01-09T18:30:00.000Z");
  });
});

describe("floorToSlot", () => {
  it("rounds down to the quarter hour", () => {
    const ts = Date.parse("2026-10-12T10:44:59Z");
    expect(floorToSlot(ts)).toBe(Date.parse("2026-10-12T10:30:00Z"));
    expect(floorToSlot(floorToSlot(ts))).toBe(floorToSlot(ts));
    expect(SLOT_MS).toBe(900_000);
  });
});
