import { describe, expect, it } from "vitest";
import {
  addPart,
  addStatistics,
  buildTimeline,
  createSeries,
  forecastForDay,
  slotAt,
  totalsFrom,
} from "../src/model";
import { PART_MS, SLOT_MS, SLOTS } from "../src/time";

const NOW = Date.parse("2026-10-12T12:07:00Z");
const ALL = {
  grid_import: true,
  grid_export: true,
  solar: true,
  battery_charge: true,
  battery_discharge: true,
};

function fillSlot(
  series: ReturnType<typeof createSeries>,
  slot: number,
  kwh: Partial<Record<keyof typeof ALL, number>>,
) {
  for (const [channel, total] of Object.entries(kwh)) {
    for (let p = 0; p < 3; p++) {
      addPart(
        series,
        channel as keyof typeof ALL,
        series.windowStart + slot * SLOT_MS + p * PART_MS,
        (total as number) / 3,
      );
    }
  }
}

describe("series", () => {
  it("ends the window with the slot that contains now", () => {
    const s = createSeries(NOW, ALL);
    expect(s.windowStart + (SLOTS - 1) * SLOT_MS).toBe(Date.parse("2026-10-12T12:00:00Z"));
  });

  it("rejects resets, off-grid starts, outside the window and repeats", () => {
    const s = createSeries(NOW, ALL);
    expect(addPart(s, "solar", s.windowStart, -1)).toBe(false);
    expect(addPart(s, "solar", s.windowStart, Number.NaN)).toBe(false);
    expect(addPart(s, "solar", s.windowStart + 1000, 1)).toBe(false);
    expect(addPart(s, "solar", s.windowStart - PART_MS, 1)).toBe(false);
    expect(addPart(s, "solar", s.windowStart, 1)).toBe(true);
    expect(addPart(s, "solar", s.windowStart, 1)).toBe(false);
    expect(s.kwh.solar[0]).toBe(1);
  });

  it("sums several entities per period and skips null changes", () => {
    const s = createSeries(NOW, ALL);
    const start = s.windowStart;
    const stored = addStatistics(s, "solar", [
      [
        { start, change: 0.5 },
        { start: start + PART_MS, change: null },
      ],
      [
        { start, change: 0.25 },
        { start: start + PART_MS, change: 0.1 },
      ],
    ]);
    expect(stored).toBe(2);
    expect(s.kwh.solar[0]).toBeCloseTo(0.85);
  });
});

describe("slot mix", () => {
  it("is empty without data and partial with some parts", () => {
    const s = createSeries(NOW, ALL);
    expect(slotAt(s, 10).state).toBe("empty");
    addPart(s, "grid_import", s.windowStart + 10 * SLOT_MS, 0.1);
    expect(slotAt(s, 10).state).toBe("partial");
  });

  it("balances a sunny slot with battery charging and feed-in", () => {
    const s = createSeries(NOW, ALL);
    fillSlot(s, 5, {
      grid_import: 0,
      grid_export: 0.3,
      solar: 1.0,
      battery_charge: 0.4,
      battery_discharge: 0,
    });
    const slot = slotAt(s, 5);
    expect(slot.state).toBe("complete");
    expect(slot.home).toBeCloseTo(0.3); // 1.0 - 0.3 - 0.4
    expect(slot.homeFromSolar).toBeCloseTo(0.3);
    expect(slot.batteryFromSolar).toBeCloseTo(0.4);
    expect(slot.exportFromSolar).toBeCloseTo(0.3);
    expect(slot.homeFromGrid).toBe(0);
  });

  it("serves the home from grid, then battery, and never goes negative", () => {
    const s = createSeries(NOW, ALL);
    fillSlot(s, 6, { grid_import: 0.2, grid_export: 0, solar: 0, battery_charge: 0, battery_discharge: 0.5 });
    const slot = slotAt(s, 6);
    expect(slot.home).toBeCloseTo(0.7);
    expect(slot.homeFromGrid).toBeCloseTo(0.2);
    expect(slot.homeFromBattery).toBeCloseTo(0.5);
    fillSlot(s, 7, { grid_import: 0, grid_export: 2, solar: 0.5, battery_charge: 0, battery_discharge: 0 });
    expect(slotAt(s, 7).home).toBe(0);
  });

  it("ignores the battery unless both meters exist", () => {
    const s = createSeries(NOW, { ...ALL, battery_discharge: false });
    fillSlot(s, 1, { grid_import: 0.1, solar: 0.2, battery_charge: 0.2 });
    expect(slotAt(s, 1).battery).toBe(false);
    expect(slotAt(s, 1).charge).toBe(0);
  });

  it("totals respect the start time", () => {
    const s = createSeries(NOW, ALL);
    fillSlot(s, 0, { grid_import: 1 });
    fillSlot(s, 50, { grid_import: 2 });
    expect(totalsFrom(s).import).toBeCloseTo(3);
    expect(totalsFrom(s, s.windowStart + 40 * SLOT_MS).import).toBeCloseTo(2);
    expect(totalsFrom(s).slotsWithData).toBe(2);
  });
});

describe("forecast", () => {
  it("spreads half-hour values over quarter hours of the day only", () => {
    const day = Date.parse("2026-10-12T00:00:00Z");
    const f = forecastForDay(
      [
        {
          "2026-10-12T10:00:00Z": 1000,
          "2026-10-12T10:30:00Z": 500,
          "2026-10-11T10:00:00Z": 9999,
          "2026-10-13T00:00:00Z": 7,
        },
      ],
      day,
    );
    expect(f).toBeDefined();
    expect(f?.[40]).toBeCloseTo(0.5);
    expect(f?.[41]).toBeCloseTo(0.5);
    expect(f?.[42]).toBeCloseTo(0.25);
    expect(f?.reduce((a, b) => a + b, 0)).toBeCloseTo(1.5);
  });

  it("returns nothing when no value is on the day", () => {
    expect(
      forecastForDay([{ "2025-01-14T07:00:00Z": 10 }], Date.parse("2026-10-12T00:00:00Z")),
    ).toBeUndefined();
  });
});

describe("timeline", () => {
  it("shows today up to now and yesterday after it", () => {
    const s = createSeries(NOW, ALL);
    const day = Date.parse("2026-10-12T00:00:00Z");
    const yesterdaySlot = (NOW - 86_400_000 + 4 * 3_600_000 - s.windowStart) / SLOT_MS; // 16:07 yesterday
    fillSlot(s, Math.floor(yesterdaySlot), { grid_import: 0.6 });
    const t = buildTimeline(s, day, "last_24h");
    expect(t.columns).toHaveLength(96);
    expect(t.nowIndex).toBe(48);
    expect(t.columns[48]?.yesterday).toBe(false);
    expect(t.columns[49]?.yesterday).toBe(true);
    expect(t.columns[64]?.values[4]).toBeCloseTo(0.6);
    const today = buildTimeline(s, day, "today");
    expect(today.columns[64]?.values[4]).toBe(0);
  });
});
