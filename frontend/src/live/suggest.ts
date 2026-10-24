/**
 * Linking elements to entities (the bindings editor): which entities fit an element, the
 * suggestions from its room's area, the entity search, and applying an edit to the bindings.
 */
import type { HomeAssistant } from "../ha/types";
import { areaEntities, entityName, type BindingsJson, type ElementBinding } from "./bindings";

/** What the editor needs to know about a plan element. */
export interface PlanElementInfo {
  id: string;
  type: string;
  name: string;
  /** Furniture kind (`lamp`, `tv`, `curtain`…). */
  kind?: string;
  /** Room it belongs to. */
  parent?: string;
}

/** One edit of the bindings: an element's entities and tap, or a room's area. */
export type LinkChange =
  { element: string; binding: ElementBinding | null } | { room: string; area: string | null };

const MAX_RESULTS = 8;

/** Furniture kinds that give light (the catalogue's light kinds). */
const LIGHT_KINDS = new Set([
  "lamp",
  "tablelamp",
  "desklamp",
  "lantern",
  "pendant",
  "chandelier",
  "ceilinglight",
  "spot",
  "nightstand",
]);
/** Furniture kinds a camera is often placed on or drawn as. */
const CAMERA_KINDS = new Set(["custom", "shelf", "openshelf", "bookcase", "spot", "frame"]);
/** Furniture kinds with a plug: power sensors and switches fit them. */
const APPLIANCE_KINDS = new Set([
  "fridge",
  "washer",
  "dryer",
  "dishwasher",
  "stove",
  "hood",
  "printer",
  "printer3d",
]);

/** The plan element with this id, from the plan JSON. */
export function planElement(plan: unknown, id: string): PlanElementInfo | undefined {
  const elements = (plan as { elements?: unknown } | null | undefined)?.elements;
  if (!Array.isArray(elements)) return undefined;
  for (const raw of elements as unknown[]) {
    const e = raw as Record<string, unknown> | null;
    if (e?.id !== id) continue;
    const info: PlanElementInfo = {
      id,
      type: typeof e.type === "string" ? e.type : "",
      name: typeof e.name === "string" ? e.name : "",
    };
    if (typeof e.kind === "string") info.kind = e.kind;
    if (typeof e.parent === "string") info.parent = e.parent;
    return info;
  }
  return undefined;
}

/** The rooms of the plan JSON, in plan order (for the card editor). */
export function planRooms(plan: unknown): { id: string; name: string }[] {
  const elements = (plan as { elements?: unknown } | null | undefined)?.elements;
  if (!Array.isArray(elements)) return [];
  return (elements as unknown[]).flatMap((raw) => {
    const e = raw as Record<string, unknown> | null;
    if (e?.type !== "room" || typeof e.id !== "string") return [];
    return [{ id: e.id, name: typeof e.name === "string" && e.name ? e.name : e.id }];
  });
}

/** How well an entity fits an element: 0 does not fit, higher fits better. */
export function fit(element: PlanElementInfo, entityId: string, hass: HomeAssistant): number {
  const domain = entityId.split(".")[0] ?? "";
  const raw = hass.states[entityId]?.attributes.device_class;
  const deviceClass = typeof raw === "string" ? raw : "";
  const power = domain === "sensor" && deviceClass === "power";
  // A device's battery fits whatever the device is linked to.
  if (deviceClass === "battery" && (domain === "sensor" || domain === "binary_sensor")) return 1;
  if (element.type === "door") {
    if (domain === "binary_sensor" && ["door", "opening", "garage_door"].includes(deviceClass))
      return 3;
    if (domain === "lock") return 3;
    if (domain === "cover" && ["door", "garage", "gate"].includes(deviceClass)) return 2;
    return 0;
  }
  if (element.type === "window") {
    if (domain === "binary_sensor" && ["window", "opening"].includes(deviceClass)) return 3;
    if (domain === "cover") return ["blind", "shutter", "window", ""].includes(deviceClass) ? 3 : 1;
    return 0;
  }
  if (element.type !== "furniture") return 0;
  const kind = element.kind ?? "";
  // A camera stands on a shelf, hangs on a wall or is a model of its own.
  if (domain === "camera") return CAMERA_KINDS.has(kind) ? 2 : 1;
  if (LIGHT_KINDS.has(kind)) return domain === "light" ? 3 : domain === "switch" ? 2 : 0;
  if (kind === "fan") return domain === "fan" ? 3 : domain === "light" ? 2 : 0;
  if (kind === "curtain") {
    if (domain !== "cover") return 0;
    return deviceClass === "curtain" ? 4 : 2;
  }
  if (kind === "tv") return domain === "media_player" ? 3 : domain === "switch" || power ? 1 : 0;
  if (kind === "heater") return domain === "climate" ? 3 : domain === "switch" ? 2 : 0;
  if (APPLIANCE_KINDS.has(kind)) return power || domain === "switch" ? 2 : 0;
  return domain === "switch" || power ? 1 : 0;
}

function byFitThenName(
  element: PlanElementInfo,
  hass: HomeAssistant,
): (a: string, b: string) => number {
  return (a, b) =>
    fit(element, b, hass) - fit(element, a, hass) ||
    entityName(hass, a).localeCompare(entityName(hass, b));
}

/** Entities of the room's area that fit the element and are not linked yet, best first. */
export function suggestions(
  hass: HomeAssistant,
  element: PlanElementInfo,
  area: string | undefined,
  linked: readonly string[],
): string[] {
  if (!area) return [];
  return areaEntities(hass, area)
    .filter((id) => !linked.includes(id) && fit(element, id, hass) > 0)
    .sort(byFitThenName(element, hass))
    .slice(0, MAX_RESULTS);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Entities whose id or name holds every word of `query`, those that fit first. */
export function searchEntities(
  hass: HomeAssistant,
  element: PlanElementInfo,
  query: string,
  linked: readonly string[],
): string[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.join("").length < 2) return [];
  return Object.keys(hass.states)
    .filter((id) => {
      if (linked.includes(id)) return false;
      const text = normalize(`${id} ${entityName(hass, id)}`);
      return words.every((word) => text.includes(word));
    })
    .sort(byFitThenName(element, hass))
    .slice(0, MAX_RESULTS);
}

/** The bindings after an edit (an element without entities, a room without area: removed). */
export function applyLink(bindings: BindingsJson, change: LinkChange): BindingsJson {
  const without = <T>(entries: Record<string, T>, id: string): Record<string, T> =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => key !== id));
  if ("element" in change) {
    const elements = without(bindings.elements, change.element);
    if (change.binding && change.binding.entities.length > 0) {
      elements[change.element] = change.binding;
    }
    return { version: 1, rooms: { ...bindings.rooms }, elements };
  }
  const rooms = without(bindings.rooms, change.room);
  if (change.area) rooms[change.room] = { area: change.area };
  return { version: 1, rooms, elements: { ...bindings.elements } };
}
