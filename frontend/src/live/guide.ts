/**
 * The guide to making an automation (D-093): its example, taken from the home when it can be — a
 * motion or door sensor and a light of the same area, what a first automation often joins.
 */
import type { HomeAssistant } from "../ha/types";
import { areaOf, entityName } from "./bindings";

/** An automation the home could have: what starts it, what it switches on. */
export interface GuideExample {
  kind: "motion" | "door";
  sensor: string;
  light: string;
}

const MOTION = new Set(["motion", "occupancy", "presence"]);
const DOOR = new Set(["door", "garage_door", "opening"]);

/**
 * The home's example: in the first area (by name) with a light, its motion sensor, else its door
 * sensor; none when no area has both. Hidden, configuration and diagnostic entities are left out,
 * and those the viewer may not see (`unseen`: a private room's, D-039).
 */
export function guideExample(
  hass: HomeAssistant | undefined,
  unseen: (entity: string) => boolean = () => false,
): GuideExample | undefined {
  if (!hass) return undefined;
  const byArea = new Map<string, { motion?: string; door?: string; light?: string }>();
  for (const id of Object.keys(hass.states).sort()) {
    const entry = hass.entities?.[id];
    if (entry?.hidden === true || entry?.entity_category || unseen(id)) continue;
    const area = areaOf(hass, id);
    if (!area) continue;
    const found = byArea.get(area) ?? {};
    const deviceClass = hass.states[id]?.attributes.device_class;
    if (id.startsWith("light.")) found.light ??= id;
    else if (id.startsWith("binary_sensor.") && typeof deviceClass === "string") {
      if (MOTION.has(deviceClass)) found.motion ??= id;
      else if (DOOR.has(deviceClass)) found.door ??= id;
    }
    byArea.set(area, found);
  }
  const name = (area: string): string => hass.areas?.[area]?.name ?? area;
  const areas = [...byArea.keys()].sort((a, b) => name(a).localeCompare(name(b)));
  for (const kind of ["motion", "door"] as const) {
    for (const area of areas) {
      const found = byArea.get(area);
      const sensor = found?.[kind];
      if (sensor && found.light) {
        return { kind, sensor: entityName(hass, sensor), light: entityName(hass, found.light) };
      }
    }
  }
  return undefined;
}
