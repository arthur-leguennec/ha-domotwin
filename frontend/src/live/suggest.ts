/**
 * Linking elements to entities (the bindings editor): which entities fit an element, the
 * suggestions from its room's area, the entity search, and applying an edit to the bindings.
 */
import type { HomeAssistant } from "../ha/types";
import type { KindName } from "../i18n";
import {
  areaEntities,
  entityName,
  type BindingsJson,
  type ElementBinding,
  type RoomAction,
  type RoomBinding,
} from "./bindings";
import { APPLIANCES } from "./devices";
import { unaccented } from "./text";
import { planElements } from "./plan";

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

/** One edit of the bindings: an element's entities and tap, or a room's area and actions (kept when not said). */
export type LinkChange =
  | { element: string; binding: ElementBinding | null }
  | { room: string; area: string | null; actions?: RoomAction[] };

const MAX_RESULTS = 8;

/** Kinds of items that give light (the catalogue's lamps). */
const LIGHT_KINDS = new Set<string>([
  "floor-lamp",
  "table-lamp",
  "desk-lamp",
  "lantern",
  "pendant",
  "chandelier",
  "ceiling-light",
  "spotlight",
  "nightstand",
  "wall-light",
  "light-strip",
  "track-light",
  "aquarium",
] satisfies KindName[]);
/** Kinds of items a camera is often placed on or drawn as. */
const CAMERA_KINDS = new Set<string>([
  "box",
  "shelf",
  "open-shelving",
  "bookcase",
  "spotlight",
  "picture",
] satisfies KindName[]);
/** Kinds with rules of their own. */
const FAN: KindName = "ceiling-fan";
const CURTAIN: KindName = "curtain";
const TV: KindName = "tv";
const RADIATOR: KindName = "radiator";
/** Furniture kinds with a plug: power sensors and switches fit them. */
const APPLIANCE_KINDS = new Set([...APPLIANCES, "fridge", "freezer", "wine-cooler"]);
/**
 * The library's devices (D-073): the domains, and device classes where they matter, of the
 * entities that are them, the best first. A power sensor or a switch fits them too, less.
 */
const DEVICE_FITS: Partial<Record<KindName, [string, string[]?][]>> = {
  speaker: [["media_player"]],
  "wall-tablet": [["media_player"], ["light"]],
  monitor: [["media_player"]],
  thermostat: [["climate"]],
  "heat-pump": [["climate"]],
  furnace: [["climate"]],
  boiler: [["climate"], ["water_heater"]],
  "towel-radiator": [["climate"], ["switch"]],
  "water-heater": [["water_heater"], ["climate"]],
  fireplace: [["switch"], ["climate"]],
  fan: [["fan"], ["switch"]],
  "air-purifier": [["fan"]],
  humidifier: [["humidifier"]],
  dehumidifier: [["humidifier"]],
  "smoke-detector": [["binary_sensor", ["smoke", "gas", "carbon_monoxide", "safety"]]],
  sensor: [["binary_sensor"], ["sensor"]],
  router: [["binary_sensor", ["connectivity"]], ["device_tracker"]],
  "access-point": [["binary_sensor", ["connectivity"]], ["device_tracker"]],
  car: [["device_tracker"], ["sensor", ["battery"]]],
  "ev-charger": [["sensor", ["power", "energy", "current"]], ["switch"]],
  "electrical-panel": [["sensor", ["power", "energy"]]],
  "pet-feeder": [["button"], ["switch"]],
  "litter-box": [["sensor"], ["switch"]],
};

/** The plan element with this id, from the plan JSON. */
export function planElement(plan: unknown, id: string): PlanElementInfo | undefined {
  const found = planElements(plan).find((e) => e.id === id);
  if (!found) return undefined;
  const { fields } = found;
  const info: PlanElementInfo = {
    id,
    type: found.type,
    name: typeof fields.name === "string" ? fields.name : "",
  };
  if (found.type === "furniture") {
    const kind = typeof fields.model === "string" ? undefined : fields.kind;
    info.kind = typeof kind === "string" ? kind : "box";
  }
  if (typeof fields.room === "string") info.parent = fields.room;
  return info;
}

/** The ids of the elements of the plan JSON that stand in `room` (its pieces). */
export function roomPieces(plan: unknown, room: string): string[] {
  return planElements(plan)
    .filter(({ fields }) => fields.room === room)
    .map(({ id }) => id);
}

/** The rooms of the plan JSON, in plan order (for the card editor). */
export function planRooms(plan: unknown): { id: string; name: string }[] {
  return planElements(plan)
    .filter((e) => e.type === "room")
    .map(({ id, fields }) => ({
      id,
      name: typeof fields.name === "string" && fields.name ? fields.name : id,
    }));
}

/** How well an entity fits an element: 0 does not fit, higher fits better. */
export function fit(element: PlanElementInfo, entityId: string, hass: HomeAssistant): number {
  const domain = entityId.split(".")[0] ?? "";
  const raw = hass.states[entityId]?.attributes.device_class;
  const deviceClass = typeof raw === "string" ? raw : "";
  const power = domain === "sensor" && deviceClass === "power";
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
  // A camera is drawn as one, stands on a shelf, hangs on a wall or is a model of its own.
  if (domain === "camera") return kind === "camera" ? 4 : CAMERA_KINDS.has(kind) ? 2 : 0;
  if (LIGHT_KINDS.has(kind)) return domain === "light" ? 3 : domain === "switch" ? 2 : 0;
  if (kind === FAN) return domain === "fan" ? 3 : domain === "light" ? 2 : 0;
  if (kind === CURTAIN) {
    if (domain !== "cover") return 0;
    return deviceClass === "curtain" ? 4 : 2;
  }
  if (kind === TV) return domain === "media_player" ? 3 : domain === "switch" || power ? 1 : 0;
  // A robot vacuum's dock (D-049): its vacuum moves the robot on the floor.
  if (kind === "robot-vacuum") return domain === "vacuum" ? 3 : 0;
  if (kind === RADIATOR) return domain === "climate" ? 3 : domain === "switch" ? 2 : 0;
  const fits = DEVICE_FITS[kind as KindName];
  if (fits) {
    const at = fits.findIndex(
      ([d, classes]) => d === domain && (!classes || classes.includes(deviceClass)),
    );
    if (at >= 0) return at === 0 ? 3 : 2;
    return power || domain === "switch" ? 1 : 0;
  }
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

/** Entities whose id or name holds every word of `query`, those that fit first. */
export function searchEntities(
  hass: HomeAssistant,
  element: PlanElementInfo,
  query: string,
  linked: readonly string[],
): string[] {
  const words = unaccented(query).split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.join("").length < 2) return [];
  return Object.keys(hass.states)
    .filter((id) => {
      if (linked.includes(id)) return false;
      const text = unaccented(`${id} ${entityName(hass, id)}`);
      return words.every((word) => text.includes(word));
    })
    .sort(byFitThenName(element, hass))
    .slice(0, MAX_RESULTS);
}

/**
 * The bindings after an edit (an element without entities or device, a room without area or
 * actions: removed).
 */
export function applyLink(bindings: BindingsJson, change: LinkChange): BindingsJson {
  const without = <T>(entries: Record<string, T>, id: string): Record<string, T> =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => key !== id));
  if ("element" in change) {
    const elements = without(bindings.elements, change.element);
    if (change.binding && (change.binding.entities.length > 0 || change.binding.device)) {
      elements[change.element] = change.binding;
    }
    return { version: 1, rooms: { ...bindings.rooms }, elements };
  }
  const rooms = without(bindings.rooms, change.room);
  const room: RoomBinding = {};
  if (change.area) room.area = change.area;
  // Actions not said: those it had.
  const actions = change.actions ?? bindings.rooms[change.room]?.actions;
  if (actions && actions.length > 0) room.actions = actions;
  if (room.area || room.actions) rooms[change.room] = room;
  return { version: 1, rooms, elements: { ...bindings.elements } };
}
