import { describe, expect, it } from "vitest";
import { createMockHass, MOCK_ENTITIES } from "../dev/mock-hass";
import { resolveConfig } from "../src/config";
import { fetchPrefs, loadSnapshot, mergeSources, sourcesFromPrefs } from "../src/data";
import { slotAt } from "../src/model";
import { SLOTS } from "../src/time";
import { buildRings, buildTimelineView } from "../src/view";

const NOW = Date.parse("2026-10-12T14:08:00Z");

async function snapshotFor(raw = {}) {
  const hass = createMockHass(NOW, { timeZone: "Europe/Berlin" });
  const config = resolveConfig({
    type: "x",
    entities: { battery_level: MOCK_ENTITIES.battery_level },
    ...raw,
  });
  const sources = mergeSources(config, sourcesFromPrefs(await fetchPrefs(hass)));
  const snapshot = await loadSnapshot(hass, config, sources, NOW);
  return { hass, config, snapshot };
}

describe("loadSnapshot with the demo Home Assistant", () => {
  it("requests five-minute change statistics in kWh for the 24 hour window", async () => {
    const { hass, snapshot } = await snapshotFor();
    const call = hass.calls.find((c) => c.type === "recorder/statistics_during_period");
    expect(call?.period).toBe("5minute");
    expect(call?.types).toEqual(["change", "mean"]);
    expect(call?.units).toEqual({ energy: "kWh" });
    expect(Date.parse(call?.start_time as string)).toBe(snapshot.series.windowStart);
  });

  it("fills the slots, the battery level and the forecast", async () => {
    const { snapshot } = await snapshotFor();
    const complete = Array.from({ length: SLOTS - 1 }, (_, i) => slotAt(snapshot.series, i)).filter(
      (s) => s.state === "complete",
    );
    expect(complete.length).toBe(SLOTS - 1);
    expect(snapshot.batteryLevel).toBeGreaterThan(0);
    expect(snapshot.forecast).toBeDefined();
    expect(snapshot.dayStart).toBe(Date.parse("2026-10-11T22:00:00Z"));
  });

  it("builds rings and a timeline view that stay inside the drawing area", async () => {
    const { config, snapshot } = await snapshotFor();
    const rings = buildRings(snapshot.series, config, snapshot.dayStart, snapshot.batteryLevel);
    expect(rings.map((r) => r.id)).toEqual(["consumption", "feed", "production", "battery"]);
    for (const r of rings) expect(r.max).toBeGreaterThanOrEqual(r.sum);
    const view = buildTimelineView(snapshot.series, config, snapshot.dayStart, snapshot.forecast);
    expect(view.bars.length).toBeGreaterThan(50);
    for (const bar of view.bars) {
      expect(bar.y).toBeGreaterThanOrEqual(-0.001);
      expect(bar.y + bar.height).toBeLessThanOrEqual(100.001);
    }
    expect(view.forecast?.startsWith("M")).toBe(true);
  });

  it("works without an Energy dashboard when entities are given, and reports none otherwise", async () => {
    const hass = createMockHass(NOW, { prefs: false });
    expect(await fetchPrefs(hass)).toBeNull();
    const config = resolveConfig({ type: "x", entities: { grid_import: MOCK_ENTITIES.grid_import } });
    const sources = mergeSources(config, sourcesFromPrefs(null));
    expect(Object.keys(sources.channels)).toEqual(["grid_import"]);
    const snapshot = await loadSnapshot(hass, config, sources, NOW);
    expect(snapshot.forecast).toBeUndefined();
  });
});
