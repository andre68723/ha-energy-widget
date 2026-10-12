import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { runAction } from "./actions";
import { type CardConfig, type ResolvedConfig, resolveConfig } from "./config";
import {
  type EnergyPrefs,
  fetchPrefs,
  loadSnapshot,
  mergeSources,
  type Snapshot,
  type Sources,
  sourcesFromPrefs,
} from "./data";
import { type Key, localize } from "./localize";
import { totalsFrom } from "./model";
import { cardStyles } from "./styles";
import { nestedRingsTemplate, ringTemplate, timelineTemplate } from "./templates";
import { PART_MS } from "./time";
import type { HomeAssistant } from "./types";
import { buildRings, buildTimelineView } from "./view";

declare const __VERSION__: string;
const VERSION = __VERSION__;
const REFRESH_DELAY_MS = 20_000; // statistics of a period are compiled shortly after it ends

export class HaEnergyWidget extends LitElement {
  static override styles = cardStyles;
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    snapshot: { state: true },
    status: { state: true },
  };

  declare hass: HomeAssistant;
  declare config: ResolvedConfig | undefined;
  declare snapshot: Snapshot | undefined;
  declare status: "loading" | "ready" | "error" | "empty";

  private prefs: Promise<EnergyPrefs | null> | undefined;
  private timer: number | undefined;
  private generation = 0;
  private loadedKey = "";

  constructor() {
    super();
    this.status = "loading";
  }

  // --- Home Assistant card API ---------------------------------------------------------------------------

  static getConfigElement(): HTMLElement {
    return document.createElement("ha-energy-widget-editor");
  }

  static getStubConfig(): CardConfig {
    // Empty entities: the card reads the Energy dashboard configuration.
    return { type: "custom:ha-energy-widget", layout: "rings_timeline", time_range: "last_24h" };
  }

  setConfig(config: CardConfig): void {
    this.config = resolveConfig(config);
    this.snapshot = undefined;
    this.status = "loading";
    this.loadedKey = "";
    if (this.isConnected && this.hass) void this.refresh();
  }

  getCardSize(): number {
    const c = this.config;
    if (!c) return 3;
    return c.layout === "timeline" || c.layout === "rings" ? 2 : c.layout === "nested_rings" ? 4 : 3;
  }

  getGridOptions() {
    // Default height in grid rows (56 px each); the card grows with whatever the dashboard gives it.
    const rows = { rings_timeline: 4, timeline: 3, rings: 2, nested_rings: 4 }[
      this.config?.layout ?? "rings_timeline"
    ];
    return { columns: 12, rows, min_columns: 4, min_rows: 2 };
  }

  // --- lifecycle -----------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.hass && this.config) void this.refresh();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.clearTimeout(this.timer);
    this.generation++;
  }

  private onVisibility = () => {
    if (
      document.visibilityState === "visible" &&
      this.snapshot &&
      Date.now() - this.snapshot.nowMs > PART_MS
    ) {
      void this.refresh();
    }
  };

  /** Re-render for live state only when the battery level entity changed; `hass` itself changes constantly. */
  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size === 1 && changed.has("hass")) {
      const previous = changed.get("hass") as HomeAssistant | undefined;
      const id = this.config?.batteryLevel;
      if (previous === undefined) return true;
      return !!id && previous.states?.[id] !== this.hass.states?.[id];
    }
    return true;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass") && this.hass && this.config && this.loadedKey === "") void this.refresh();
  }

  // --- data ----------------------------------------------------------------------------------------------

  private async sources(): Promise<Sources> {
    const config = this.config as ResolvedConfig;
    const needsPrefs = !(
      ["grid_import", "grid_export", "solar", "battery_charge", "battery_discharge"] as const
    ).every((c) => (config.entities[c]?.length ?? 0) > 0);
    if (!this.prefs && (needsPrefs || config.forecast)) this.prefs = fetchPrefs(this.hass);
    const prefs = this.prefs ? sourcesFromPrefs(await this.prefs) : { channels: {}, forecastEntries: [] };
    return mergeSources(config, prefs);
  }

  private async refresh(): Promise<void> {
    if (!this.config || !this.hass) return;
    window.clearTimeout(this.timer);
    const generation = ++this.generation;
    this.loadedKey = "loading";
    try {
      const sources = await this.sources();
      if (Object.keys(sources.channels).length === 0) {
        if (generation === this.generation) {
          this.status = "empty";
          this.snapshot = undefined;
        }
      } else {
        const snapshot = await loadSnapshot(this.hass, this.config, sources, Date.now());
        if (generation !== this.generation) return;
        this.snapshot = snapshot;
        this.status = "ready";
      }
    } catch (error) {
      console.warn("ha-energy-widget: loading failed", error);
      if (generation !== this.generation) return;
      if (!this.snapshot) this.status = "error"; // keep the last good data on a failed refresh
      this.prefs = undefined;
    }
    if (generation === this.generation) this.schedule();
  }

  private schedule(): void {
    const now = Date.now();
    const next = Math.ceil(now / PART_MS) * PART_MS + REFRESH_DELAY_MS;
    this.timer = window.setTimeout(() => void this.refresh(), Math.max(15_000, next - now));
  }

  // --- rendering -----------------------------------------------------------------------------------------

  private t(key: Key): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key);
  }

  private liveBattery(): number | undefined {
    const id = this.config?.batteryLevel;
    const state = id ? this.hass?.states?.[id]?.state : undefined;
    const value = state === undefined ? Number.NaN : Number(state);
    return Number.isFinite(value) ? value : this.snapshot?.batteryLevel;
  }

  private onTap = () => {
    if (this.config) runAction(this, this.config.tapAction);
  };

  private onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.onTap();
    }
  };

  protected override render(): TemplateResult {
    const config = this.config;
    if (!config) return html``;
    const actionable = config.tapAction.action !== "none";
    const body = this.body(config);
    return html`<ha-card
      class=${actionable ? "actionable" : ""}
      tabindex=${actionable ? 0 : -1}
      @click=${actionable ? this.onTap : nothing}
      @keydown=${actionable ? this.onKey : nothing}
    >
      ${config.title ? html`<div class="title">${config.title}</div>` : nothing} ${body}
    </ha-card>`;
  }

  private body(config: ResolvedConfig): TemplateResult {
    if (this.status === "empty") return html`<div class="message">${this.t("no_sources")}</div>`;
    const snapshot = this.snapshot;
    if (!snapshot) {
      return this.status === "error"
        ? html`<div class="message error">${this.t("error")}</div>`
        : html`<div class="message">${this.t("loading")}</div>`;
    }
    const rings = buildRings(snapshot.series, config, snapshot.dayStart, this.liveBattery());
    const names: Record<string, string> = {
      consumption: this.t("consumption"),
      feed: this.t("feed"),
      production: this.t("production"),
      battery: this.t("battery"),
    };
    const ringsRow = html`<div class="rings" style="--ring-count:${rings.length}">
      ${rings.map((r) => ringTemplate(r, names[r.id] ?? r.id))}
    </div>`;
    const timeline = () => {
      const view = buildTimelineView(snapshot.series, config, snapshot.dayStart, snapshot.forecast);
      const totals = totalsFrom(snapshot.series);
      const label = `${this.t("timeline")}: ${totals.home.toFixed(1)} kWh`;
      return timelineTemplate(view, label);
    };
    switch (config.layout) {
      case "rings":
        return ringsRow;
      case "timeline":
        return timeline();
      case "nested_rings": {
        // Outermost first: battery, feed, production, consumption.
        const order = ["battery", "feed", "production", "consumption"] as const;
        const specs = order.flatMap((id) => rings.filter((r) => r.id === id));
        return nestedRingsTemplate(
          specs,
          specs.map((s) => names[s.id] ?? s.id),
        );
      }
      default:
        return html`${ringsRow}${timeline()}`;
    }
  }
}

if (!customElements.get("ha-energy-widget")) {
  customElements.define("ha-energy-widget", HaEnergyWidget);
} else {
  console.warn("ha-energy-widget: custom element already defined, this copy is ignored");
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "ha-energy-widget",
  name: "Energy Widget",
  description:
    "Energy rings and a 15-minute timeline of the last 24 hours, inspired by aharren/ios-energy-widget.",
  preview: false,
  documentationURL: "https://github.com/andre68723/ha-energy-widget",
});

console.info(
  `%c HA-ENERGY-WIDGET %c ${VERSION} `,
  "color:#fff;background:#ff9800;font-weight:700",
  "color:#ff9800",
);

import "./editor";
