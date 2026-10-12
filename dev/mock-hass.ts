/** Synthetic Home Assistant for the dev page and the tests: a sunny day with a battery, public demo data only. */
import type { HomeAssistant } from "../src/types";

export const MOCK_ENTITIES = {
  grid_import: "sensor.demo_grid_import",
  grid_export: "sensor.demo_grid_export",
  solar: "sensor.demo_solar",
  battery_charge: "sensor.demo_battery_charge",
  battery_discharge: "sensor.demo_battery_discharge",
  battery_level: "sensor.demo_battery_level",
} as const;

const PART = 5 * 60_000;

function solarKw(hour: number, cloud: number): number {
  if (hour < 6.5 || hour > 19) return 0;
  const x = ((hour - 6.5) / 12.5) * Math.PI;
  return Math.max(0, Math.sin(x) ** 1.4 * 6.2 * cloud);
}

function loadKw(hour: number): number {
  return (
    0.35 +
    (hour > 6 && hour < 8 ? 1.1 : 0) +
    (hour > 11.5 && hour < 13 ? 1.6 : 0) +
    (hour > 17 && hour < 21.5 ? 2.2 : 0)
  );
}

/** Five-minute energy flows in kWh for the period starting at `start`; `soc` carries the battery level. */
export function mockFlows(start: number, soc: { value: number }) {
  const d = new Date(start);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const cloud = 0.75 + 0.25 * Math.sin(start / 1_900_000);
  const h = PART / 3_600_000;
  const solar = solarKw(hour, cloud) * h;
  const load = loadKw(hour) * h;
  let surplus = solar - load;
  let charge = 0;
  let discharge = 0;
  const capacity = 10;
  if (surplus > 0) {
    charge = Math.min(surplus, 3 * h, ((100 - soc.value) / 100) * capacity);
    surplus -= charge;
  } else {
    discharge = Math.min(-surplus, 3 * h, (soc.value / 100) * capacity);
    surplus += discharge;
  }
  soc.value += ((charge - discharge) / capacity) * 100;
  return {
    solar,
    charge,
    discharge,
    export: Math.max(0, surplus),
    import: Math.max(0, -surplus),
    soc: soc.value,
  };
}

export type MockHass = HomeAssistant & { calls: Record<string, unknown>[] };

export function createMockHass(
  nowMs = Date.now(),
  options: { prefs?: boolean; timeZone?: string } = {},
): MockHass {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    states: {
      [MOCK_ENTITIES.battery_level]: { entity_id: MOCK_ENTITIES.battery_level, state: "72", attributes: {} },
    },
    locale: { language: "en", time_zone: options.timeZone ? "server" : "local" },
    config: { time_zone: options.timeZone ?? "UTC" },
    async callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T> {
      calls.push(message);
      if (message.type === "energy/get_prefs") {
        if (options.prefs === false) throw new Error("not_found");
        return {
          energy_sources: [
            {
              type: "grid",
              stat_energy_from: MOCK_ENTITIES.grid_import,
              stat_energy_to: MOCK_ENTITIES.grid_export,
            },
            { type: "solar", stat_energy_from: MOCK_ENTITIES.solar, config_entry_solar_forecast: ["demo"] },
            {
              type: "battery",
              stat_energy_from: MOCK_ENTITIES.battery_discharge,
              stat_energy_to: MOCK_ENTITIES.battery_charge,
            },
          ],
        } as T;
      }
      if (message.type === "recorder/statistics_during_period") {
        const start = Math.floor(Date.parse(message.start_time as string) / PART) * PART;
        const end = Date.parse(message.end_time as string);
        const out: Record<string, { start: number; end: number; change?: number; mean?: number }[]> = {};
        for (const id of message.statistic_ids as string[]) out[id] = [];
        const soc = { value: 40 };
        // Run the battery from two days back so its level at the window start is plausible.
        for (let t = start - 2 * 86_400_000; t < end; t += PART) {
          const f = mockFlows(t, soc);
          if (t < start) continue;
          const row = (id: string, change: number) => out[id]?.push({ start: t, end: t + PART, change });
          row(MOCK_ENTITIES.solar, f.solar);
          row(MOCK_ENTITIES.grid_import, f.import);
          row(MOCK_ENTITIES.grid_export, f.export);
          row(MOCK_ENTITIES.battery_charge, f.charge);
          row(MOCK_ENTITIES.battery_discharge, f.discharge);
          out[MOCK_ENTITIES.battery_level]?.push({ start: t, end: t + PART, mean: f.soc });
        }
        return out as T;
      }
      if (message.type === "energy/solar_forecast") {
        const wh: Record<string, number> = {};
        const day = new Date(nowMs);
        const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
        for (let i = 0; i < 48; i++) {
          const t = dayStart + i * 1_800_000;
          wh[new Date(t).toISOString()] = solarKw((i + 0.5) / 2, 0.9) * 0.5 * 1000;
        }
        return { demo: { wh_hours: wh } } as T;
      }
      throw new Error(`unsupported message ${message.type}`);
    },
  };
}
