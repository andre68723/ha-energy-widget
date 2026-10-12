/** Turns the model into what is drawn: ring specs and timeline geometry. Pure, no DOM. */
import type { ResolvedConfig } from "./config";
import { buildTimeline, type Series, TIMELINE_ROLES, type Timeline, totalsFrom } from "./model";

export interface RingSegment {
  value: number;
  color: string;
}

export interface RingSpec {
  id: "consumption" | "feed" | "production" | "battery";
  segments: RingSegment[];
  /** Value that fills the whole ring. */
  max: number;
  /** The sum of the segments. */
  sum: number;
  text: string;
  textColor: string;
}

const TEXT_COLOR = "var(--primary-text-color, currentColor)";

function ring(
  id: RingSpec["id"],
  segments: RingSegment[],
  configuredMax: number,
  textColor: string,
): RingSpec {
  const sum = segments.reduce((total, s) => total + s.value, 0);
  return { id, segments, max: Math.max(configuredMax, sum), sum, text: sum.toFixed(1), textColor };
}

/** The rings of the iOS widget: consumption mix, grid feed, production mix and the battery level. */
export function buildRings(
  series: Series,
  config: ResolvedConfig,
  dayStartMs: number,
  batteryLevel: number | undefined,
): RingSpec[] {
  const from = config.timeRange === "today" ? dayStartMs : series.windowStart;
  const t = totalsFrom(series, from);
  const c = config.colors;
  const rings: RingSpec[] = [
    ring(
      "consumption",
      [
        { value: t.homeFromSolar, color: c.solar },
        { value: t.homeFromBattery, color: c.battery_discharge },
        { value: t.homeFromGrid, color: c.grid_import },
      ],
      config.max.consumption,
      TEXT_COLOR,
    ),
  ];
  if (series.configured.grid_export) {
    rings.push(ring("feed", [{ value: t.export, color: c.grid_export }], config.max.feed, c.grid_export));
  }
  if (series.configured.solar) {
    rings.push(
      ring(
        "production",
        [
          { value: t.homeFromSolar, color: c.solar },
          { value: t.batteryFromSolar, color: c.battery_charge },
          { value: t.export, color: c.grid_export },
        ],
        config.max.production,
        c.solar,
      ),
    );
  }
  if (batteryLevel !== undefined && Number.isFinite(batteryLevel)) {
    const level = Math.min(100, Math.max(0, batteryLevel));
    rings.push({
      id: "battery",
      segments: [{ value: level, color: c.battery_level }],
      max: 100,
      sum: level,
      text: `${Math.round(level)}%`,
      textColor: c.battery_level,
    });
  }
  return rings;
}

export interface Bar {
  x: number;
  y: number;
  height: number;
  color: string;
  faded: boolean;
}

export interface TimelineView {
  /** Drawing area: 96 columns of 10 units, height 100. */
  bars: Bar[];
  forecast: string | undefined;
  nowX: number;
  scale: number;
  timeline: Timeline;
}

export const COLUMN = 10;
export const HEIGHT = 100;

export function buildTimelineView(
  series: Series,
  config: ResolvedConfig,
  dayStartMs: number,
  forecast: Float64Array | undefined,
): TimelineView {
  const timeline = buildTimeline(series, dayStartMs, config.timeRange);
  const colors = TIMELINE_ROLES.map((role) => config.colors[role === "solar" ? "solar" : role]);
  let peak = config.max.interval;
  for (const column of timeline.columns)
    peak = Math.max(
      peak,
      column.values.reduce((a, b) => a + b, 0),
    );
  if (forecast) for (const v of forecast) peak = Math.max(peak, v);

  const bars: Bar[] = [];
  timeline.columns.forEach((column, p) => {
    let base = HEIGHT;
    column.values.forEach((value, r) => {
      if (!(value > 0)) return;
      const height = (value / peak) * HEIGHT;
      base -= height;
      // After "now" in the "today" range only production of yesterday is drawn, in a neutral gray.
      const ghost = column.yesterday && config.timeRange === "today";
      bars.push({
        x: p * COLUMN + COLUMN / 8,
        y: base,
        height,
        color: ghost ? "var(--secondary-text-color, gray)" : (colors[r] ?? "gray"),
        faded: column.yesterday,
      });
    });
  });

  let line: string | undefined;
  if (forecast) {
    line = Array.from(
      forecast,
      (v, p) =>
        `${p === 0 ? "M" : "L"}${(p * COLUMN + COLUMN / 2).toFixed(1)} ${(HEIGHT - (v / peak) * HEIGHT).toFixed(2)}`,
    ).join("");
  }
  return { bars, forecast: line, nowX: (timeline.nowIndex + 1) * COLUMN, scale: peak, timeline };
}
