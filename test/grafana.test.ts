import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config";
import { loadSnapshot } from "../src/data";
import { buildUrl, expandQuery, parseReply } from "../src/grafana";
import { SLOT_MS } from "../src/time";
import type { HomeAssistant } from "../src/types";

const grafana = {
  url: "https://grafana.local:3000/",
  token: "secret",
  data_source: 3,
  database: "measurements",
  queries: {
    solar:
      'SELECT difference(last("value")) FROM "pv" WHERE ${time-range} GROUP BY ${time-interval} fill(null)',
    battery_level:
      'SELECT last("value") FROM "soc" WHERE ${time-range} GROUP BY ${time-interval} fill(previous)',
    forecast:
      'SELECT difference(last("value")) FROM "fc" WHERE ${time-range-forecast} GROUP BY ${time-interval}',
  },
};

describe("grafana config", () => {
  it("is absent without queries and normalizes the URL", () => {
    expect(resolveConfig({ type: "x", grafana: { ...grafana, queries: {} } }).grafana).toBeUndefined();
    const g = resolveConfig({ type: "x", grafana }).grafana;
    expect(g?.url).toBe("https://grafana.local:3000");
    expect(g?.token).toBe("secret");
  });

  it("rejects incomplete connection details", () => {
    expect(() => resolveConfig({ type: "x", grafana: { ...grafana, url: "grafana" } })).toThrow(/url/);
    expect(() => resolveConfig({ type: "x", grafana: { ...grafana, database: "" } })).toThrow(/database/);
  });
});

describe("queries", () => {
  const window = { startMs: 1000, endMs: 2000, dayStartMs: 3000, dayEndMs: 4000 };

  it("expands the placeholders, the forecast with 15 minute buckets", () => {
    const q = expandQuery("A ${time-range} B ${TIME-INTERVAL}", "solar", window);
    expect(q).toContain("time >= 1000ms AND time <= 2000ms");
    expect(q).toContain("time(5m)");
    const f = expandQuery("${time-range-forecast} ${time-interval}", "forecast", window);
    expect(f).toContain("time >= 3000ms AND time < 4000ms");
    expect(f).toContain("time(15m)");
  });

  it("addresses the data source by id or uid", () => {
    const base = { url: "https://g", database: "db", queries: {} };
    expect(buildUrl({ ...base, dataSource: 3 }, ["SELECT 1"])).toContain(
      "/api/datasources/proxy/3/query?db=db&epoch=ms&q=SELECT+1",
    );
    expect(buildUrl({ ...base, dataSource: "abc" }, ["x"])).toContain("/proxy/uid/abc/query");
  });

  it("keeps numbers and drops holes", () => {
    const [a, b] = parseReply(
      {
        results: [
          {
            series: [
              {
                values: [
                  [1, 0.5],
                  [2, null],
                ],
              },
            ],
          },
          {},
        ],
      },
      2,
    );
    expect([...(a ?? [])]).toEqual([[1, 0.5]]);
    expect(b?.size).toBe(0);
    expect(() => parseReply({}, 1)).toThrow();
  });
});

describe("Grafana as fallback", () => {
  const now = Date.UTC(2026, 9, 12, 12, 7);
  const config = resolveConfig({ type: "x", grafana });
  const quarter = Math.floor(now / SLOT_MS) * SLOT_MS - 2 * SLOT_MS;

  function reply() {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            series: [
              {
                values: [
                  [quarter, 0.4],
                  [quarter + 300_000, 0.6],
                ],
              },
            ],
          },
          {
            series: [
              {
                values: [
                  [quarter, 55],
                  [quarter + 300_000, 61],
                ],
              },
            ],
          },
          { series: [{ values: [[Date.UTC(2026, 9, 12, 12), 1.2]] }] },
        ],
      }),
    } as Response;
  }

  it("fills channels, battery level and forecast that Home Assistant lacks", async () => {
    const fetchImpl = vi.fn(async () => reply());
    const hass = { callWS: vi.fn(), locale: { language: "en" }, config: { time_zone: "UTC" }, states: {} };
    const snapshot = await loadSnapshot(
      hass as unknown as HomeAssistant,
      config,
      { channels: {}, forecastEntries: [] },
      now,
      fetchImpl as unknown as typeof fetch,
    );
    expect(hass.callWS).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/datasources/proxy/3/query");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(snapshot.series.configured.solar).toBe(true);
    expect(snapshot.series.kwh.solar.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0);
    expect(snapshot.batteryLevel).toBe(61);
    expect(snapshot.forecast).toBeDefined();
  });

  it("keeps Home Assistant data and survives a failing Grafana", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 }) as Response);
    const hass = {
      callWS: vi.fn(async () => ({
        "sensor.pv": [{ start: quarter, change: 2 }],
      })),
      locale: { language: "en" },
      config: { time_zone: "UTC" },
      states: {},
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const snapshot = await loadSnapshot(
      hass as unknown as HomeAssistant,
      config,
      { channels: { solar: ["sensor.pv"] }, forecastEntries: [] },
      now,
      fetchImpl as unknown as typeof fetch,
    );
    warn.mockRestore();
    // solar has statistics, so only battery level and forecast were asked for
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshot.series.kwh.solar.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
