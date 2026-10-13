import { html, LitElement, type TemplateResult } from "lit";
import { type CardConfig, CHANNELS, COLOR_ROLES, GRAFANA_KEYS, LAYOUTS, TIME_RANGES, toList } from "./config";
import { type Key, localize } from "./localize";
import type { HomeAssistant } from "./types";

interface FormSchema {
  name?: string;
  type?: "expandable" | "grid";
  title?: string;
  flatten?: boolean;
  schema?: FormSchema[];
  selector?: Record<string, unknown>;
}

/** The editor keeps entity lists as arrays (the multi-entity selector); the saved YAML stays minimal. */
function toFormData(config: CardConfig): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  for (const c of CHANNELS) {
    const list = toList(config.entities?.[c]);
    if (list.length > 0) entities[c] = list;
  }
  if (config.entities?.battery_level) entities.battery_level = config.entities.battery_level;
  return { ...config, entities };
}

/** Drops empty values at any depth and unwraps one-element entity lists, so the saved YAML stays minimal. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : value.length === 0 ? undefined : value;
  if (value === null || value === "") return undefined;
  if (typeof value === "object") {
    const out = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, clean(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

function fromFormData(data: Record<string, unknown>): CardConfig {
  return (clean(data) ?? {}) as unknown as CardConfig;
}

export class HaEnergyWidgetEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
  };

  declare hass: HomeAssistant;
  declare config: CardConfig | undefined;

  setConfig(config: CardConfig): void {
    this.config = config;
  }

  private t(key: Key): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key);
  }

  private schema(): FormSchema[] {
    const t = (k: Key) => this.t(k);
    const entity = (name: string, deviceClass: string, multiple = true): FormSchema => ({
      name,
      selector: { entity: { domain: "sensor", device_class: deviceClass, multiple } },
    });
    const number = (name: string): FormSchema => ({
      name,
      selector: { number: { min: 0.1, max: 1000, step: 0.1, mode: "box", unit_of_measurement: "kWh" } },
    });
    return [
      { name: "title", selector: { text: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "layout",
            selector: {
              select: {
                mode: "dropdown",
                options: LAYOUTS.map((value) => ({ value, label: t(`layout_${value}` as Key) })),
              },
            },
          },
          {
            name: "time_range",
            selector: {
              select: {
                mode: "dropdown",
                options: TIME_RANGES.map((value) => ({ value, label: t(`range_${value}` as Key) })),
              },
            },
          },
        ],
      },
      { name: "forecast", selector: { boolean: {} } },
      { name: "legend", selector: { boolean: {} } },
      { name: "ring_labels", selector: { boolean: {} } },
      {
        type: "expandable",
        name: "entities",
        title: t("entities"),
        schema: [
          entity("solar", "energy"),
          entity("grid_import", "energy"),
          entity("grid_export", "energy"),
          entity("battery_charge", "energy"),
          entity("battery_discharge", "energy"),
          entity("battery_level", "battery", false),
        ],
      },
      {
        type: "expandable",
        name: "grafana",
        title: t("grafana"),
        schema: [
          { name: "url", selector: { text: { type: "url" } } },
          { name: "token", selector: { text: { type: "password" } } },
          { name: "data_source", selector: { text: {} } },
          { name: "database", selector: { text: {} } },
          {
            type: "expandable",
            name: "queries",
            title: t("grafana_queries"),
            schema: GRAFANA_KEYS.map((key) => ({ name: key, selector: { text: { multiline: true } } })),
          },
        ],
      },
      {
        type: "expandable",
        name: "max",
        title: t("max"),
        schema: [number("consumption"), number("production"), number("feed"), number("interval")],
      },
      {
        type: "expandable",
        name: "colors",
        title: t("colors"),
        schema: COLOR_ROLES.map((role) => ({ name: role, selector: { text: {} } })),
      },
      { name: "tap_action", selector: { ui_action: { default_action: "navigate" } } },
    ];
  }

  private label = (schema: { name: string }): string => {
    const names: Record<string, Key> = {
      title: "title",
      layout: "layout",
      time_range: "time_range",
      forecast: "forecast_line",
      legend: "show_legend",
      ring_labels: "show_ring_labels",
      tap_action: "tap_action",
      solar: "solar",
      grid_import: "grid_import",
      grid_export: "grid_export",
      battery_charge: "battery_charge",
      battery_discharge: "battery_discharge",
      battery_level: "battery_level",
      consumption: "max_consumption",
      production: "max_production",
      feed: "max_feed",
      interval: "max_interval",
      url: "grafana_url",
      token: "grafana_token",
      data_source: "grafana_data_source",
      database: "grafana_database",
    };
    // Color fields share the channel names; the schema name alone is enough as they sit in their own group.
    const key = names[schema.name];
    return key ? this.t(key) : schema.name;
  };

  private onChange = (event: CustomEvent<{ value: Record<string, unknown> }>) => {
    event.stopPropagation();
    const config = fromFormData(event.detail.value);
    this.config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }),
    );
  };

  protected override render(): TemplateResult {
    if (!this.config) return html``;
    return html`<ha-form
      .hass=${this.hass}
      .data=${toFormData(this.config)}
      .schema=${this.schema()}
      .computeLabel=${this.label}
      @value-changed=${this.onChange}
    ></ha-form>`;
  }
}

if (!customElements.get("ha-energy-widget-editor")) {
  customElements.define("ha-energy-widget-editor", HaEnergyWidgetEditor);
}
