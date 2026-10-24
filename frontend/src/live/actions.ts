/**
 * Runs a binding's action like a Home Assistant dashboard does: toggle, more-info, perform an
 * action (call a service), navigate, or nothing. `controls` is DomoTwin's own popover and is
 * handled by the view.
 */
import { fire } from "../components/define";
import type { HomeAssistant } from "../ha/types";
import type { Action, ElementBinding } from "./bindings";
import { primaryEntity } from "./bindings";

/** What the view must do after an action. */
export type ActionResult = "done" | "controls" | "none";

/** The service that toggles an entity of this domain. */
export function toggleService(entityId: string, on: boolean): [string, string] {
  const domain = entityId.split(".")[0] ?? "";
  switch (domain) {
    case "cover":
      return ["cover", "toggle"];
    case "media_player":
      return ["media_player", "media_play_pause"];
    case "lock":
      return ["lock", on ? "unlock" : "lock"];
    case "scene":
    case "script":
      return [domain, "turn_on"];
    case "button":
    case "input_button":
      return [domain, "press"];
    default:
      return ["homeassistant", "toggle"];
  }
}

export async function runAction(
  node: HTMLElement,
  hass: HomeAssistant,
  action: Action,
  binding: ElementBinding,
): Promise<ActionResult> {
  const entityId = action.entity_id ?? primaryEntity(binding, hass);
  switch (action.action) {
    case "toggle": {
      if (!entityId) return "none";
      const on = hass.states[entityId]?.state === "locked";
      const [domain, service] = toggleService(entityId, on);
      await hass.callService(domain, service, {}, { entity_id: entityId });
      return "done";
    }
    case "more-info":
      if (entityId) fire(node, "hass-more-info", { entityId });
      return entityId ? "done" : "none";
    case "perform-action":
    case "call-service": {
      const name = action.perform_action ?? action.service ?? "";
      const [domain, service] = name.split(".", 2);
      if (!domain || !service) return "none";
      await hass.callService(domain, service, action.data ?? {}, action.target);
      return "done";
    }
    case "navigate":
      if (!action.navigation_path) return "none";
      history.pushState(null, "", action.navigation_path);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return "done";
    case "controls":
      return "controls";
    case "none":
      return "none";
  }
}
