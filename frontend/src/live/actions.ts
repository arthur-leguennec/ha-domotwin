/**
 * Runs a binding's action like a Home Assistant dashboard does: toggle, more-info, perform an
 * action (call a service), navigate, or nothing. `controls` is DomoTwin's own popover and is
 * handled by the view.
 */
import { fire } from "../components/define";
import { isHassError, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import type { Action, ElementBinding } from "./bindings";
import { primaryEntity } from "./bindings";
import { actionEntities } from "./rights";

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
  // A device the viewer may only look at (their rights, D-070): its panel, its controls
  // disabled, rather than Home Assistant's dialog or an action refused.
  const looks = entityId !== undefined && hass.canAct?.(entityId) === false;
  switch (action.action) {
    case "toggle": {
      if (!entityId) return "none";
      if (looks) return "controls";
      const on = hass.states[entityId]?.state === "locked";
      const [domain, service] = toggleService(entityId, on);
      await hass.callService(domain, service, {}, { entity_id: entityId });
      return "done";
    }
    case "more-info":
      if (!entityId) return "none";
      // The demo house's entities have no dialog in Home Assistant, nor a guest's page (D-067):
      // DomoTwin's own controls.
      if (hass.demo || hass.guest || looks) return "controls";
      fire(node, "hass-more-info", { entityId });
      return "done";
    case "perform-action":
    case "call-service": {
      const name = action.perform_action ?? action.service ?? "";
      const [domain, service] = name.split(".", 2);
      if (!domain || !service) return "none";
      // On what the viewer may only look at (D-070): the piece's own panel, when it has one.
      if (binding.entities.length > 0 && hass.canCall?.(actionEntities(hass, action)) === false) {
        return "controls";
      }
      await hass.callService(domain, service, action.data ?? {}, action.target);
      return "done";
    }
    case "navigate":
      if (!action.navigation_path || hass.demo || hass.guest) return "none";
      navigate(action.navigation_path);
      return "done";
    case "controls":
      return "controls";
    case "none":
      return "none";
  }
}

/** Goes to a page of Home Assistant, as its own links do (no reload). */
export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/** Why Home Assistant did not do an action, in the viewer's words. */
export function failureText(t: Translator, error: unknown): string {
  const reason = isHassError(error)
    ? error.message || t.error(error.code)
    : t.error(error instanceof Error ? error.name : "unknown");
  return t.t("view.action_failed", { reason });
}
