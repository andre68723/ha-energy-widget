/** Card configuration: the user-facing YAML shape and its normalized form. */

export const LAYOUTS = ["rings_timeline", "rings", "timeline", "nested_rings"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const TIME_RANGES = ["last_24h", "today"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const CHANNELS = [
  "grid_import",
  "grid_export",
  "solar",
  "battery_charge",
  "battery_discharge",
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Queries that can be answered by Grafana: the five meters, the battery level and the solar forecast. */
export const GRAFANA_KEYS = [...CHANNELS, "battery_level", "forecast"] as const;
export type GrafanaKey = (typeof GRAFANA_KEYS)[number];

export interface GrafanaConfig {
  /** Base URL of Grafana, e.g. `https://grafana.local:3000`. */
  url: string;
  /** Service account token or API key with the Viewer role. */
  token?: string;
  /** Numeric id or uid of the InfluxDB data source. */
  data_source: number | string;
  /** InfluxDB database (or bucket mapped by DBRP) the InfluxQL queries run against. */
  database: string;
  /** InfluxQL per key; see the README for the placeholders. */
  queries?: Partial<Record<GrafanaKey, string>>;
}

/** One entity or several (e.g. two inverters): their energy is summed. */
export type EntityList = string | string[];

export interface ActionConfig {
  action: "navigate" | "url" | "more-info" | "none";
  navigation_path?: string;
  url_path?: string;
  entity?: string;
}

export interface CardConfig {
  type: string;
  title?: string;
  layout?: Layout;
  time_range?: TimeRange;
  /** Missing channels fall back to the Energy dashboard configuration. */
  entities?: Partial<Record<Channel, EntityList>> & { battery_level?: string };
  /** Fallback source: used per channel where Home Assistant has no statistics. */
  grafana?: GrafanaConfig;
  /** Draw the solar forecast of the Energy dashboard as a line (default true). */
  forecast?: boolean;
  /** Show a legend naming the colors of solar, battery, grid and feed-in (default true). */
  legend?: boolean;
  /** Ring and timeline scale in kWh; values above the maximum grow the scale, they are never clipped. */
  max?: { consumption?: number; production?: number; feed?: number; interval?: number };
  /** Any CSS color, e.g. `#ffd60a` or `var(--energy-solar-color)`. */
  colors?: Partial<Record<ColorRole, string>>;
  tap_action?: ActionConfig;
}

export const COLOR_ROLES = [
  "solar",
  "grid_import",
  "grid_export",
  "battery_charge",
  "battery_discharge",
  "battery_level",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Defaults follow the Energy dashboard theme variables, with the iOS widget's palette as fallback. */
export const DEFAULT_COLORS: Record<ColorRole, string> = {
  solar: "var(--energy-solar-color, #ff9800)",
  grid_import: "var(--energy-grid-consumption-color, #488fc2)",
  grid_export: "var(--energy-grid-return-color, #8353d1)",
  battery_charge: "var(--energy-battery-in-color, #4db6ac)",
  battery_discharge: "var(--energy-battery-out-color, #f06292)",
  battery_level: "var(--energy-battery-out-color, #f06292)",
};

export const DEFAULT_MAX = { consumption: 20, production: 20, feed: 20, interval: 1.5 };

export interface ResolvedGrafana {
  url: string;
  token?: string;
  dataSource: number | string;
  database: string;
  queries: Partial<Record<GrafanaKey, string>>;
}

export interface ResolvedConfig {
  title?: string;
  layout: Layout;
  timeRange: TimeRange;
  /** Explicitly configured entities per channel; empty = use the Energy dashboard. */
  entities: Partial<Record<Channel, string[]>>;
  batteryLevel?: string;
  /** Only present when at least one query is configured. */
  grafana?: ResolvedGrafana;
  forecast: boolean;
  legend: boolean;
  max: typeof DEFAULT_MAX;
  colors: Record<ColorRole, string>;
  tapAction: ActionConfig;
}

export function toList(value: EntityList | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string" && v.includes(".")))];
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveGrafana(raw: GrafanaConfig | undefined): ResolvedGrafana | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const queries: Partial<Record<GrafanaKey, string>> = {};
  for (const key of GRAFANA_KEYS) {
    const query = raw.queries?.[key];
    if (typeof query === "string" && query.trim() !== "") queries[key] = query.trim();
  }
  if (Object.keys(queries).length === 0) return undefined;
  const url = typeof raw.url === "string" ? raw.url.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/./i.test(url)) throw new Error("grafana.url must start with http:// or https://");
  const dataSource =
    typeof raw.data_source === "number" ? raw.data_source : String(raw.data_source ?? "").trim();
  if (dataSource === "") throw new Error("grafana.data_source is required");
  const database = typeof raw.database === "string" ? raw.database.trim() : "";
  if (database === "") throw new Error("grafana.database is required");
  const token = typeof raw.token === "string" && raw.token.trim() !== "" ? raw.token.trim() : undefined;
  return { url, token, dataSource, database, queries };
}

/** Throws for a config that cannot work, so Home Assistant shows its error card. */
export function resolveConfig(raw: CardConfig): ResolvedConfig {
  if (!raw || typeof raw !== "object") throw new Error("Invalid configuration");
  const entities: Partial<Record<Channel, string[]>> = {};
  for (const channel of CHANNELS) {
    const list = toList(raw.entities?.[channel]);
    if (list.length > 0) entities[channel] = list;
  }
  const colors = { ...DEFAULT_COLORS };
  for (const role of COLOR_ROLES) {
    const color = raw.colors?.[role];
    if (typeof color === "string" && color.trim() !== "") colors[role] = color.trim();
  }
  return {
    title: raw.title || undefined,
    layout: oneOf(LAYOUTS, raw.layout, "rings_timeline"),
    timeRange: oneOf(TIME_RANGES, raw.time_range, "last_24h"),
    entities,
    batteryLevel: raw.entities?.battery_level || undefined,
    grafana: resolveGrafana(raw.grafana),
    forecast: raw.forecast !== false,
    legend: raw.legend !== false,
    max: {
      consumption: positive(raw.max?.consumption, DEFAULT_MAX.consumption),
      production: positive(raw.max?.production, DEFAULT_MAX.production),
      feed: positive(raw.max?.feed, DEFAULT_MAX.feed),
      interval: positive(raw.max?.interval, DEFAULT_MAX.interval),
    },
    colors,
    tapAction: raw.tap_action ?? { action: "navigate", navigation_path: "/energy" },
  };
}
