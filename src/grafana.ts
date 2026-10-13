/**
 * Grafana as a fallback source: InfluxQL through the data source proxy (`/api/datasources/proxy/…/query`),
 * the same call the iOS widget makes. Read only: one GET request per refresh.
 */
import type { GrafanaKey, ResolvedGrafana } from "./config";
import { PART_MS, SLOT_MS } from "./time";

/** What the placeholders in a query expand to, in UTC epoch milliseconds. */
export interface QueryWindow {
  /** `${time-range}`: statistics of the last 24 hours, one interval earlier so `difference()` has a base. */
  startMs: number;
  endMs: number;
  /** `${time-range-forecast}`: the whole local day. */
  dayStartMs: number;
  dayEndMs: number;
}

export type GrafanaValues = Map<number, number>;

/** Replaces `${time-range}`, `${time-range-forecast}` and `${time-interval}` (5 minutes, the forecast 15). */
export function expandQuery(query: string, key: GrafanaKey, w: QueryWindow): string {
  return query
    .replace(/\$\{time-range-forecast\}/gi, ` (time >= ${w.dayStartMs}ms AND time < ${w.dayEndMs}ms) `)
    .replace(/\$\{time-range\}/gi, ` (time >= ${w.startMs}ms AND time <= ${w.endMs}ms) `)
    .replace(/\$\{time-interval\}/gi, key === "forecast" ? " time(15m) " : " time(5m) ");
}

export function buildUrl(grafana: ResolvedGrafana, statements: string[]): string {
  const id = String(grafana.dataSource);
  const source = /^\d+$/.test(id) ? id : `uid/${encodeURIComponent(id)}`;
  const params = new URLSearchParams({
    db: grafana.database,
    epoch: "ms",
    q: statements.join(";"),
  });
  return `${grafana.url}/api/datasources/proxy/${source}/query?${params}`;
}

interface InfluxReply {
  results?: { error?: string; series?: { values?: [number, number | null][] }[] }[];
}

/** Timestamp to value of the first series of every statement; null values are holes and left out. */
export function parseReply(reply: InfluxReply, count: number): GrafanaValues[] {
  if (!Array.isArray(reply.results)) throw new Error("unexpected Grafana reply");
  return Array.from({ length: count }, (_, i) => {
    const out: GrafanaValues = new Map();
    for (const row of reply.results?.[i]?.series?.[0]?.values ?? []) {
      const [t, v] = row;
      if (typeof t === "number" && typeof v === "number" && Number.isFinite(v)) out.set(t, v);
    }
    return out;
  });
}

export async function queryGrafana(
  grafana: ResolvedGrafana,
  keys: GrafanaKey[],
  window: QueryWindow,
  fetchImpl: typeof fetch = fetch,
): Promise<Partial<Record<GrafanaKey, GrafanaValues>>> {
  const statements = keys.map((key) => expandQuery(grafana.queries[key] ?? "", key, window));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (grafana.token) headers.Authorization = `Bearer ${grafana.token}`;
  const response = await fetchImpl(buildUrl(grafana, statements), { headers, credentials: "omit" });
  if (!response.ok) throw new Error(`Grafana answered ${response.status}`);
  const parsed = parseReply((await response.json()) as InfluxReply, keys.length);
  return Object.fromEntries(keys.map((key, i) => [key, parsed[i]]));
}

/** Window of a snapshot: 24 hours plus one slot before it, and the local day for the forecast. */
export function windowFor(
  windowStartMs: number,
  nowMs: number,
  dayStartMs: number,
  dayEndMs: number,
): QueryWindow {
  return { startMs: windowStartMs - SLOT_MS, endMs: nowMs + PART_MS - 1, dayStartMs, dayEndMs };
}
