/**
 * Energy model: a rolling window of 96 quarter-hour slots filled from five-minute Recorder statistics.
 * Pure code (no DOM, no network). The mix rules are those of the BETTA HA Panel energy timeline.
 *
 * Measured values are the meters. Everything called "from_*" is an ESTIMATE: aggregate meters cannot say whether
 * grid energy charged the battery or served the home when flows overlap. Rules, in order:
 *   home use = import + solar + discharge - export - charge   (never negative)
 *   grid serves the home first, then charges the battery;
 *   solar serves the rest of the home, then the battery, then feeds in;
 *   the battery serves what the home still needs, then feeds in.
 */
import type { Channel } from "./config";
import { CHANNELS } from "./config";
import { floorToSlot, PART_MS, SLOT_MS, SLOTS } from "./time";

const PARTS_PER_SLOT = SLOT_MS / PART_MS;
const ALL_PARTS = (1 << PARTS_PER_SLOT) - 1;

export interface Series {
  /** UTC start of slot 0. The window ends with the slot that contains "now". */
  windowStart: number;
  configured: Record<Channel, boolean>;
  kwh: Record<Channel, Float64Array>;
  /** Bit n set: the n-th five-minute part of the slot was reported. */
  parts: Record<Channel, Uint8Array>;
}

export interface StatisticPoint {
  start: number;
  change?: number | null;
}

export function createSeries(nowMs: number, configured: Partial<Record<Channel, boolean>>): Series {
  const make = <T>(factory: (channel: Channel) => T) =>
    Object.fromEntries(CHANNELS.map((c) => [c, factory(c)])) as Record<Channel, T>;
  return {
    windowStart: floorToSlot(nowMs) - (SLOTS - 1) * SLOT_MS,
    configured: make((c) => configured[c] === true),
    kwh: make(() => new Float64Array(SLOTS)),
    parts: make(() => new Uint8Array(SLOTS)),
  };
}

/** Stores one five-minute change. Rejects negative or non-finite values (a meter reset) and anything off-grid. */
export function addPart(series: Series, channel: Channel, startMs: number, changeKwh: number): boolean {
  if (!Number.isFinite(changeKwh) || changeKwh < 0) return false;
  const offset = startMs - series.windowStart;
  if (offset < 0 || offset >= SLOTS * SLOT_MS || offset % PART_MS !== 0) return false;
  const slot = Math.floor(offset / SLOT_MS);
  const bit = 1 << ((offset % SLOT_MS) / PART_MS);
  const parts = series.parts[channel];
  if ((parts[slot] ?? 0) & bit) return false;
  parts[slot] = (parts[slot] ?? 0) | bit;
  series.kwh[channel][slot] = (series.kwh[channel][slot] ?? 0) + changeKwh;
  return true;
}

/** Adds the statistics of one or several entities (summed per period) to a channel. Returns the parts stored. */
export function addStatistics(
  series: Series,
  channel: Channel,
  lists: readonly (readonly StatisticPoint[])[],
): number {
  const summed = new Map<number, number>();
  for (const list of lists) {
    for (const point of list) {
      if (typeof point.change !== "number") continue; // a null change is a hole, not a zero
      summed.set(point.start, (summed.get(point.start) ?? 0) + point.change);
    }
  }
  let stored = 0;
  for (const [start, change] of summed) if (addPart(series, channel, start, change)) stored++;
  return stored;
}

export type SlotState = "empty" | "partial" | "complete";

export interface Slot {
  state: SlotState;
  battery: boolean;
  import: number;
  export: number;
  solar: number;
  charge: number;
  discharge: number;
  home: number;
  homeFromSolar: number;
  homeFromBattery: number;
  homeFromGrid: number;
  batteryFromSolar: number;
  batteryFromGrid: number;
  exportFromSolar: number;
  exportFromBattery: number;
}

const pos = (n: number) => (n > 0 ? n : 0);

export function slotAt(series: Series, index: number): Slot {
  const empty: Slot = {
    state: "empty",
    battery: false,
    import: 0,
    export: 0,
    solar: 0,
    charge: 0,
    discharge: 0,
    home: 0,
    homeFromSolar: 0,
    homeFromBattery: 0,
    homeFromGrid: 0,
    batteryFromSolar: 0,
    batteryFromGrid: 0,
    exportFromSolar: 0,
    exportFromBattery: 0,
  };
  if (index < 0 || index >= SLOTS) return empty;
  let seen = 0;
  let missing = false;
  for (const c of CHANNELS) {
    if (!series.configured[c]) continue;
    const parts = series.parts[c][index] ?? 0;
    if (parts !== 0) seen++;
    if (parts !== ALL_PARTS) missing = true;
  }
  if (seen === 0) return empty;

  const value = (c: Channel) => (series.configured[c] ? (series.kwh[c][index] ?? 0) : 0);
  const battery = series.configured.battery_charge && series.configured.battery_discharge;
  const s = { ...empty, state: (missing ? "partial" : "complete") as SlotState, battery };
  s.import = value("grid_import");
  s.export = value("grid_export");
  s.solar = value("solar");
  s.charge = battery ? value("battery_charge") : 0;
  s.discharge = battery ? value("battery_discharge") : 0;

  s.home = pos(s.import + s.solar + s.discharge - s.export - s.charge);
  s.homeFromGrid = Math.min(s.import, s.home);
  s.batteryFromGrid = Math.min(pos(s.import - s.homeFromGrid), s.charge);
  let homeRest = s.home - s.homeFromGrid;
  s.homeFromSolar = Math.min(s.solar, homeRest);
  let solarRest = s.solar - s.homeFromSolar;
  s.batteryFromSolar = Math.min(pos(s.charge - s.batteryFromGrid), solarRest);
  solarRest -= s.batteryFromSolar;
  s.exportFromSolar = Math.min(s.export, solarRest);
  homeRest -= s.homeFromSolar;
  s.homeFromBattery = Math.min(s.discharge, homeRest);
  s.exportFromBattery = Math.min(pos(s.export - s.exportFromSolar), pos(s.discharge - s.homeFromBattery));
  return s;
}

export interface Totals extends Omit<Slot, "state"> {
  slotsWithData: number;
  slotsPartial: number;
  /** The split rests on the mix rules (a battery or a solar meter is involved). */
  estimated: boolean;
}

/** Sums the slots from `fromMs` (inclusive) to the end of the window. */
export function totalsFrom(series: Series, fromMs = series.windowStart): Totals {
  const total: Totals = {
    battery: false,
    import: 0,
    export: 0,
    solar: 0,
    charge: 0,
    discharge: 0,
    home: 0,
    homeFromSolar: 0,
    homeFromBattery: 0,
    homeFromGrid: 0,
    batteryFromSolar: 0,
    batteryFromGrid: 0,
    exportFromSolar: 0,
    exportFromBattery: 0,
    slotsWithData: 0,
    slotsPartial: 0,
    estimated: false,
  };
  const first = Math.max(0, Math.ceil((fromMs - series.windowStart) / SLOT_MS));
  for (let i = first; i < SLOTS; i++) {
    const s = slotAt(series, i);
    if (s.state === "empty") continue;
    total.slotsWithData++;
    if (s.state === "partial") total.slotsPartial++;
    total.battery = s.battery;
    for (const key of [
      "import",
      "export",
      "solar",
      "charge",
      "discharge",
      "home",
      "homeFromSolar",
      "homeFromBattery",
      "homeFromGrid",
      "batteryFromSolar",
      "batteryFromGrid",
      "exportFromSolar",
      "exportFromBattery",
    ] as const) {
      total[key] += s[key];
    }
  }
  total.estimated = total.battery || series.configured.solar;
  return total;
}

/**
 * Forecast of solar production per quarter hour of one day, from the Energy dashboard's `energy/solar_forecast`.
 * Each value is the energy (Wh) of the period that starts at its timestamp (the Energy dashboard's convention);
 * the period length is the smallest spacing between timestamps (30 or 60 minutes). Several forecasts add up.
 * Returns kWh per slot, or undefined when nothing falls on the day.
 */
export function forecastForDay(
  forecasts: readonly Record<string, number>[],
  dayStartMs: number,
): Float64Array | undefined {
  const out = new Float64Array(SLOTS);
  let any = false;
  for (const whHours of forecasts) {
    const entries = Object.entries(whHours)
      .map(([iso, wh]) => [Date.parse(iso), wh] as const)
      .filter(([t, wh]) => Number.isFinite(t) && Number.isFinite(wh))
      .sort((a, b) => a[0] - b[0]);
    let period = 60 * 60_000;
    for (let i = 1; i < entries.length; i++) {
      const gap = (entries[i]?.[0] ?? 0) - (entries[i - 1]?.[0] ?? 0);
      if (gap > 0 && gap < period) period = gap;
    }
    const perSlot = Math.max(1, Math.round(period / SLOT_MS));
    for (const [t, wh] of entries) {
      for (let k = 0; k < perSlot; k++) {
        const slot = Math.floor((t + k * SLOT_MS - dayStartMs) / SLOT_MS);
        if (slot >= 0 && slot < SLOTS) {
          out[slot] = (out[slot] ?? 0) + wh / 1000 / perSlot;
          any = true;
        }
      }
    }
  }
  return any ? out : undefined;
}

export type TimelineRole = "solar" | "battery_charge" | "grid_export" | "battery_discharge" | "grid_import";

/** Stack order from the bottom, as in the iOS widget: solar, battery charge, feed-in, battery use, grid use. */
export const TIMELINE_ROLES: readonly TimelineRole[] = [
  "solar",
  "battery_charge",
  "grid_export",
  "battery_discharge",
  "grid_import",
];

export interface TimelineColumn {
  /** kWh per role, same order as TIMELINE_ROLES. */
  values: number[];
  /** Data from the previous day, shown faded after "now". */
  yesterday: boolean;
}

export interface Timeline {
  columns: TimelineColumn[];
  /** Index of the column holding the current slot; later columns are yesterday's. */
  nowIndex: number;
}

function roleValues(s: Slot): number[] {
  return [s.homeFromSolar, s.charge, s.export, s.homeFromBattery, s.homeFromGrid];
}

/**
 * 96 columns from midnight to midnight. Up to now they show today; after now, the same time yesterday
 * (every flow for "last_24h", only production for "today", as in the iOS widget).
 */
export function buildTimeline(series: Series, dayStartMs: number, timeRange: "last_24h" | "today"): Timeline {
  const currentSlotStart = series.windowStart + (SLOTS - 1) * SLOT_MS;
  const columns: TimelineColumn[] = [];
  let nowIndex = -1;
  for (let p = 0; p < SLOTS; p++) {
    const t = dayStartMs + p * SLOT_MS;
    if (t <= currentSlotStart) {
      const index = Math.round((t - series.windowStart) / SLOT_MS);
      const s = index >= 0 ? slotAt(series, index) : undefined;
      columns.push({ values: s && s.state !== "empty" ? roleValues(s) : [0, 0, 0, 0, 0], yesterday: false });
      nowIndex = p;
    } else {
      const index = Math.round((t - 24 * 3_600_000 - series.windowStart) / SLOT_MS);
      const s = index >= 0 && index < SLOTS ? slotAt(series, index) : undefined;
      let values = s && s.state !== "empty" ? roleValues(s) : [0, 0, 0, 0, 0];
      if (timeRange === "today") values = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, 0, 0];
      columns.push({ values, yesterday: true });
    }
  }
  return { columns, nowIndex };
}
