/**
 * Home Assistant's AI tasks (2025.8, D-068): the entities that generate data, which write an
 * automation in plain words. Without one nothing is offered: DomoTwin calls no model itself. In
 * the first load, for the menu; the rest comes with the dialog.
 */
import type { HomeAssistant } from "../ha/types";

/** The feature of an AI task entity that generates data (`AITaskEntityFeature.GENERATE_DATA`). */
const GENERATE_DATA = 1;

/** The AI task entities of the home that generate data, by name. */
export function aiTasks(hass: HomeAssistant | undefined): string[] {
  if (!hass || hass.demo || hass.sandbox) return [];
  if (hass.config?.components && !hass.config.components.includes("ai_task")) return [];
  const names = (id: string): string => {
    const name = hass.states[id]?.attributes.friendly_name;
    return typeof name === "string" ? name : id;
  };
  return Object.keys(hass.states)
    .filter((id) => {
      if (!id.startsWith("ai_task.")) return false;
      const entity = hass.states[id];
      const features = entity?.attributes.supported_features;
      return (
        entity?.state !== "unavailable" &&
        typeof features === "number" &&
        (features & GENERATE_DATA) !== 0
      );
    })
    .sort((a, b) => names(a).localeCompare(names(b)));
}

/** Whether an automation can be written in plain words here: an administrator, an AI task. */
export function plainWordsOffered(hass: HomeAssistant | undefined): boolean {
  return hass?.user?.is_admin === true && aiTasks(hass).length > 0;
}
