import { describe, expect, it } from "vitest";
import { DEFAULT_MAX, resolveConfig, toList } from "../src/config";
import { mergeSources, sourcesFromPrefs } from "../src/data";

describe("resolveConfig", () => {
  it("applies defaults", () => {
    const c = resolveConfig({ type: "custom:ha-energy-widget" });
    expect(c.layout).toBe("rings_timeline");
    expect(c.timeRange).toBe("last_24h");
    expect(c.forecast).toBe(true);
    expect(c.legend).toBe(true);
    expect(c.max).toEqual(DEFAULT_MAX);
    expect(c.tapAction.action).toBe("navigate");
  });

  it("falls back for invalid values and accepts overrides", () => {
    const c = resolveConfig({
      type: "x",
      layout: "bogus" as never,
      time_range: "today",
      max: { consumption: -1, feed: 30 },
      colors: { solar: " #ffd60a " },
      forecast: false,
      legend: false,
    });
    expect(c.layout).toBe("rings_timeline");
    expect(c.timeRange).toBe("today");
    expect(c.max.consumption).toBe(DEFAULT_MAX.consumption);
    expect(c.max.feed).toBe(30);
    expect(c.colors.solar).toBe("#ffd60a");
    expect(c.forecast).toBe(false);
    expect(c.legend).toBe(false);
  });

  it("normalizes entity lists", () => {
    expect(toList("sensor.a")).toEqual(["sensor.a"]);
    expect(toList(["sensor.a", "sensor.a", "nope", "sensor.b"])).toEqual(["sensor.a", "sensor.b"]);
    expect(toList(undefined)).toEqual([]);
  });
});

describe("Energy dashboard sources", () => {
  const prefs = {
    energy_sources: [
      { type: "grid", stat_energy_from: "sensor.in", stat_energy_to: "sensor.out" },
      { type: "solar", stat_energy_from: "sensor.pv1", config_entry_solar_forecast: ["a"] },
      { type: "solar", stat_energy_from: "sensor.pv2", config_entry_solar_forecast: ["b", "a"] },
      { type: "battery", stat_energy_from: "sensor.dis", stat_energy_to: "sensor.chg" },
      { type: "gas", stat_energy_from: "sensor.gas" },
    ],
  };

  it("maps sources and sums several inverters", () => {
    const s = sourcesFromPrefs(prefs);
    expect(s.channels.grid_import).toEqual(["sensor.in"]);
    expect(s.channels.grid_export).toEqual(["sensor.out"]);
    expect(s.channels.solar).toEqual(["sensor.pv1", "sensor.pv2"]);
    expect(s.channels.battery_charge).toEqual(["sensor.chg"]);
    expect(s.channels.battery_discharge).toEqual(["sensor.dis"]);
    expect(s.forecastEntries).toEqual(["a", "b"]);
  });

  it("reads the older grid flow format", () => {
    const s = sourcesFromPrefs({
      energy_sources: [
        {
          type: "grid",
          flow_from: [{ stat_energy_from: "sensor.i1" }],
          flow_to: [{ stat_energy_to: "sensor.o1" }],
        },
      ],
    });
    expect(s.channels.grid_import).toEqual(["sensor.i1"]);
    expect(s.channels.grid_export).toEqual(["sensor.o1"]);
  });

  it("lets explicit entities win per channel", () => {
    const config = resolveConfig({
      type: "x",
      entities: { solar: "sensor.mine", battery_level: "sensor.soc" },
    });
    const merged = mergeSources(config, sourcesFromPrefs(prefs));
    expect(merged.channels.solar).toEqual(["sensor.mine"]);
    expect(merged.channels.grid_import).toEqual(["sensor.in"]);
    expect(merged.batteryLevel).toBe("sensor.soc");
  });

  it("handles a missing Energy dashboard", () => {
    expect(sourcesFromPrefs(null).channels.grid_import).toEqual([]);
  });
});
