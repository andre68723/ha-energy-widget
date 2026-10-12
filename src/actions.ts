import type { ActionConfig } from "./config";

/** The few actions a tap can trigger; they use the same events as the built-in cards. */
export function runAction(node: HTMLElement, action: ActionConfig): void {
  switch (action.action) {
    case "navigate":
      if (action.navigation_path) {
        history.pushState(null, "", action.navigation_path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
      break;
    case "url":
      if (action.url_path) window.open(action.url_path, "_blank", "noopener,noreferrer");
      break;
    case "more-info":
      if (action.entity) {
        node.dispatchEvent(
          new CustomEvent("hass-more-info", {
            bubbles: true,
            composed: true,
            detail: { entityId: action.entity },
          }),
        );
      }
      break;
    default:
      break;
  }
}
