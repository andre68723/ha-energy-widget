import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import { createSeries } from "../src/model";
import { buildLegend } from "../src/view";

const config = resolveConfig({ type: "custom:ha-energy-widget", colors: { solar: "#ffd60a" } });

describe("buildLegend", () => {
  it("lists only configured channels, with the configured colors", () => {
    const series = createSeries(Date.now(), { solar: true, grid_import: true, grid_export: true });
    const items = buildLegend(series, config, false);
    expect(items.map((i) => i.id)).toEqual(["solar", "grid_import", "grid_export"]);
    expect(items[0]?.color).toBe("#ffd60a");
  });

  it("adds both battery directions and the forecast line when present", () => {
    const series = createSeries(Date.now(), { solar: true, battery_charge: true, battery_discharge: true });
    const items = buildLegend(series, config, true);
    expect(items.map((i) => i.id)).toEqual(["solar", "battery_discharge", "battery_charge", "forecast"]);
    expect(items.at(-1)?.line).toBe(true);
  });
});
