import "../src/ha-energy-widget";
import type { CardConfig } from "../src/config";
import { createMockHass } from "./mock-hass";

// Plain stand-in for Home Assistant's <ha-card>.
if (!customElements.get("ha-card")) {
  customElements.define(
    "ha-card",
    class extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML =
          "<style>:host{display:block;background:var(--ha-card-background);color:var(--primary-text-color);" +
          "border-radius:12px;box-shadow:0 1px 3px #0003}</style><slot></slot>";
      }
    },
  );
}

const params = new URLSearchParams(location.search);
if (params.get("theme") === "dark") document.documentElement.dataset.theme = "dark";

const variants: CardConfig[] = [
  {
    type: "custom:ha-energy-widget",
    layout: "rings_timeline",
    time_range: "last_24h",
    entities: { battery_level: "sensor.demo_battery_level" },
  },
  {
    type: "custom:ha-energy-widget",
    layout: "rings_timeline",
    time_range: "today",
    entities: { battery_level: "sensor.demo_battery_level" },
  },
  { type: "custom:ha-energy-widget", layout: "timeline", time_range: "last_24h" },
  {
    type: "custom:ha-energy-widget",
    layout: "rings",
    entities: { battery_level: "sensor.demo_battery_level" },
  },
  {
    type: "custom:ha-energy-widget",
    layout: "nested_rings",
    entities: { battery_level: "sensor.demo_battery_level" },
  },
  {
    type: "custom:ha-energy-widget",
    title: "Energy",
    layout: "rings_timeline",
    tap_action: { action: "none" },
  },
];

const hass = createMockHass();
const tall = params.get("tall") === "1"; // a card that is given a lot of height, as in a sections view
const grid = document.getElementById("grid");
for (const config of variants) {
  const card = document.createElement("ha-energy-widget") as HTMLElement & {
    setConfig(c: CardConfig): void;
    hass: unknown;
  };
  card.setConfig(config);
  card.hass = hass;
  if (tall) card.style.height = "480px";
  grid?.append(card);
}
