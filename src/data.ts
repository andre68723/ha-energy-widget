/** Loads the statistics, the Energy dashboard preferences and the solar forecast through the Home Assistant API. */
import type { Channel, GrafanaKey, ResolvedConfig } from "./config";
import { CHANNELS } from "./config";
import { type GrafanaValues, queryGrafana, windowFor } from "./grafana";
import {
  addPart,
  addStatistics,
  createSeries,
  forecastForDay,
  forecastFromSlots,
  type Series,
  type StatisticPoint,
} from "./model";
import { startOfDay } from "./time";
import type { HomeAssistant } from "./types";

interface EnergyFlow {
  stat_energy_from?: string;
  stat_energy_to?: string;
}

interface EnergySource extends EnergyFlow {
  type: string;
  flow_from?: EnergyFlow[]; // grid, before Home Assistant 2023.12 flattened it
  flow_to?: EnergyFlow[];
  config_entry_solar_forecast?: string[] | null;
}

export interface EnergyPrefs {
  energy_sources: EnergySource[];
}

export interface Sources {
  channels: Partial<Record<Channel, string[]>>;
  batteryLevel?: string;
  /** Config entries whose forecast `energy/solar_forecast` should be summed (all, if empty). */
  forecastEntries: string[];
}

const unique = (list: (string | undefined)[]) => [...new Set(list.filter((v): v is string => !!v))];

/** Maps the Energy dashboard configuration to the card's channels. Several inverters or batteries are summed. */
export function sourcesFromPrefs(prefs: EnergyPrefs | null): Sources {
  const sources = prefs?.energy_sources ?? [];
  const of = (type: string) => sources.filter((s) => s.type === type);
  const grid = of("grid");
  const battery = of("battery");
  const solar = of("solar");
  return {
    channels: {
      grid_import: unique(
        grid.flatMap((g) => [g.stat_energy_from, ...(g.flow_from ?? []).map((f) => f.stat_energy_from)]),
      ),
      grid_export: unique(
        grid.flatMap((g) => [g.stat_energy_to, ...(g.flow_to ?? []).map((f) => f.stat_energy_to)]),
      ),
      solar: unique(solar.map((s) => s.stat_energy_from)),
      battery_charge: unique(battery.map((b) => b.stat_energy_to)),
      battery_discharge: unique(battery.map((b) => b.stat_energy_from)),
    },
    forecastEntries: unique(solar.flatMap((s) => s.config_entry_solar_forecast ?? [])),
  };
}

/** Explicit entities win per channel; the rest comes from the Energy dashboard. */
export function mergeSources(config: ResolvedConfig, prefs: Sources): Sources {
  const channels: Partial<Record<Channel, string[]>> = {};
  for (const c of CHANNELS) {
    const explicit = config.entities[c];
    const list = explicit && explicit.length > 0 ? explicit : prefs.channels[c];
    if (list && list.length > 0) channels[c] = list;
  }
  return { channels, batteryLevel: config.batteryLevel, forecastEntries: prefs.forecastEntries };
}

export async function fetchPrefs(hass: HomeAssistant): Promise<EnergyPrefs | null> {
  try {
    return await hass.callWS<EnergyPrefs>({ type: "energy/get_prefs" });
  } catch {
    return null; // the Energy dashboard is not set up
  }
}

interface StatisticsReply {
  [statisticId: string]: { start: number; change?: number | null; mean?: number | null }[];
}

export interface Snapshot {
  series: Series;
  /** kWh per quarter hour of today, 96 values. */
  forecast?: Float64Array;
  /** Last reported battery level in percent. */
  batteryLevel?: number;
  nowMs: number;
  dayStart: number;
  channels: Partial<Record<Channel, string[]>>;
}

export function timeZoneOf(hass: HomeAssistant): string | undefined {
  return hass.locale?.time_zone === "server" ? hass.config?.time_zone : undefined;
}

export async function loadSnapshot(
  hass: HomeAssistant,
  config: ResolvedConfig,
  sources: Sources,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Snapshot> {
  const configured = Object.fromEntries(
    CHANNELS.map((c) => [c, (sources.channels[c]?.length ?? 0) > 0]),
  ) as Record<Channel, boolean>;
  const series = createSeries(nowMs, configured);
  const dayStart = startOfDay(nowMs, timeZoneOf(hass));

  const ids = unique([...CHANNELS.flatMap((c) => sources.channels[c] ?? []), sources.batteryLevel]);
  let batteryLevel: number | undefined;
  if (ids.length > 0) {
    let reply: StatisticsReply = {};
    try {
      reply = await hass.callWS<StatisticsReply>({
        type: "recorder/statistics_during_period",
        start_time: new Date(series.windowStart).toISOString(),
        end_time: new Date(nowMs + 5 * 60_000).toISOString(),
        statistic_ids: ids,
        period: "5minute",
        types: ["change", "mean"],
        units: { energy: "kWh" },
      });
    } catch (error) {
      if (!config.grafana) throw error; // without a fallback the card shows its error state
      console.warn("ha-energy-widget: statistics failed, trying Grafana", error);
    }
    for (const c of CHANNELS) {
      const lists = (sources.channels[c] ?? []).map((id) => (reply[id] ?? []) as StatisticPoint[]);
      addStatistics(series, c, lists);
    }
    const levels = sources.batteryLevel ? (reply[sources.batteryLevel] ?? []) : [];
    for (const point of levels) if (typeof point.mean === "number") batteryLevel = point.mean;
  }

  let forecast: Float64Array | undefined;
  if (config.forecast && configured.solar) {
    try {
      const reply = await hass.callWS<Record<string, { wh_hours: Record<string, number> }>>({
        type: "energy/solar_forecast",
      });
      const wanted = sources.forecastEntries;
      const chosen = Object.entries(reply)
        .filter(([entry]) => wanted.length === 0 || wanted.includes(entry))
        .map(([, f]) => f.wh_hours);
      forecast = forecastForDay(chosen, dayStart);
    } catch {
      forecast = undefined; // no forecast configured: the line is simply left out
    }
  }

  // Grafana only fills what Home Assistant could not: a channel without entities or without any statistics.
  const grafana = config.grafana;
  if (grafana) {
    const wanted: GrafanaKey[] = CHANNELS.filter(
      (c) => grafana.queries[c] && (!configured[c] || !series.parts[c].some((parts) => parts !== 0)),
    );
    if (grafana.queries.battery_level && batteryLevel === undefined) wanted.push("battery_level");
    if (grafana.queries.forecast && config.forecast && forecast === undefined) wanted.push("forecast");
    if (wanted.length > 0) {
      try {
        const dayEnd = startOfDay(dayStart + 36 * 3_600_000, timeZoneOf(hass));
        const window = windowFor(series.windowStart, nowMs, dayStart, dayEnd);
        const values = await queryGrafana(grafana, wanted, window, fetchImpl);
        for (const key of wanted) {
          const points: GrafanaValues = values[key] ?? new Map();
          if (key === "forecast") {
            forecast = forecastFromSlots(points, dayStart);
          } else if (key === "battery_level") {
            const last = [...points].sort((a, b) => a[0] - b[0]).at(-1);
            if (last) batteryLevel = last[1];
          } else {
            let stored = 0;
            for (const [start, kwh] of points) if (addPart(series, key, start, kwh)) stored++;
            if (stored > 0) series.configured[key] = true;
          }
        }
      } catch (error) {
        console.warn("ha-energy-widget: Grafana query failed", error);
      }
    }
  }
  return { series, forecast, batteryLevel, nowMs, dayStart, channels: sources.channels };
}
