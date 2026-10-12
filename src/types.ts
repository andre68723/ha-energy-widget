/** The few Home Assistant frontend types the card needs (the frontend does not publish its own). */

export interface HassLocale {
  language: string;
  time_zone?: "local" | "server";
}

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassEntityState | undefined>;
  locale: HassLocale;
  language?: string;
  config: { time_zone: string };
  callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: unknown): void;
}

export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
  interface HTMLElementTagNameMap {
    "ha-energy-widget": HTMLElement;
    "ha-energy-widget-editor": HTMLElement;
  }
}
