/**
 * Bindings on the frontend side (`docs/bindings.md`): the entities of an element, their roles,
 * the default actions, and the entities of a Home Assistant area.
 */
import type { HomeAssistant } from "../ha/types";
import { nameWords } from "./text";

/** What an entity does for its element. */
export type Role =
  | "light"
  | "switch"
  | "fan"
  | "cover"
  | "media"
  | "contact"
  | "lock"
  | "camera"
  | "power"
  | "climate"
  | "sensor";

/** A dashboard-style action. */
export interface Action {
  action:
    "toggle" | "more-info" | "perform-action" | "call-service" | "navigate" | "controls" | "none";
  entity_id?: string;
  perform_action?: string;
  service?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  navigation_path?: string;
}

export interface BoundEntity {
  entity_id: string;
  role?: Role;
}

export interface ElementBinding {
  entities: BoundEntity[];
  /** The Home Assistant device the element stands for (the network map, D-031). */
  device?: string;
  tap_action?: Action;
  hold_action?: Action;
  /** A linked camera's angle of view (degrees, 10–180) and reach (cm, 50–3 000). */
  fov?: number;
  range?: number;
}

/** An action an administrator gave a room (D-047): its name and what it does. */
export interface RoomAction {
  name: string;
  action: Action;
}

/** A room's link: its Home Assistant area and its own actions. */
export interface RoomBinding {
  area?: string;
  actions?: RoomAction[];
}

export interface BindingsJson {
  version: 1;
  rooms: Record<string, RoomBinding>;
  elements: Record<string, ElementBinding>;
}

/** No links yet. */
export const NO_BINDINGS: BindingsJson = { version: 1, rooms: {}, elements: {} };

/** The roles shown in the scene, in the order a primary entity is chosen. */
const VISUAL: readonly Role[] = [
  "light",
  "switch",
  "fan",
  "cover",
  "media",
  "contact",
  "lock",
  "camera",
];

/** The role of an entity without an explicit one, from its domain and device class. */
export function deriveRole(entityId: string, hass?: HomeAssistant): Role {
  const domain = entityId.split(".")[0];
  const deviceClass = hass?.states[entityId]?.attributes.device_class;
  switch (domain) {
    case "light":
      return "light";
    case "switch":
    case "input_boolean":
      return "switch";
    case "fan":
      return "fan";
    case "cover":
      return "cover";
    case "media_player":
      return "media";
    case "lock":
      return "lock";
    case "camera":
      return "camera";
    case "climate":
      return "climate";
    case "binary_sensor":
      return ["door", "window", "opening", "garage_door"].includes(String(deviceClass))
        ? "contact"
        : "sensor";
    case "sensor":
      return deviceClass === "power" ? "power" : "sensor";
    default:
      return "sensor";
  }
}

export function roleOf(entity: BoundEntity, hass?: HomeAssistant): Role {
  return entity.role ?? deriveRole(entity.entity_id, hass);
}

/** The entity a tap acts on: the first one shown in the scene, else the first one. */
export function primaryEntity(binding: ElementBinding, hass?: HomeAssistant): string | undefined {
  for (const role of VISUAL) {
    const found = binding.entities.find((e) => roleOf(e, hass) === role);
    if (found) return found.entity_id;
  }
  return binding.entities[0]?.entity_id;
}

/**
 * The tap action: the binding's, else toggle for lights, switches, fans and covers, Home
 * Assistant's dialog for a camera (its live picture), and DomoTwin's controls for anything else (a
 * TV, a thermostat, a sensor: D-047).
 */
export function tapAction(binding: ElementBinding, hass?: HomeAssistant): Action {
  if (binding.tap_action) return binding.tap_action;
  const primary = binding.entities.find((e) => e.entity_id === primaryEntity(binding, hass));
  const role = primary ? roleOf(primary, hass) : "sensor";
  if (["light", "switch", "fan", "cover"].includes(role)) return { action: "toggle" };
  return role === "camera" ? { action: "more-info" } : { action: "controls" };
}

/** The long-press action: the binding's, else DomoTwin's controls. */
export function holdAction(binding: ElementBinding): Action {
  return binding.hold_action ?? { action: "controls" };
}

/** Whether a stored room action has a name and an action. */
function isRoomAction(value: unknown): value is RoomAction {
  if (typeof value !== "object" || value === null) return false;
  const { name, action } = value as { name?: unknown; action?: unknown };
  return (
    typeof name === "string" &&
    name.trim() !== "" &&
    typeof action === "object" &&
    action !== null &&
    typeof (action as { action?: unknown }).action === "string"
  );
}

/** Reads stored bindings leniently: anything malformed is left out. */
export function readBindings(value: unknown): BindingsJson {
  const out: BindingsJson = { version: 1, rooms: {}, elements: {} };
  if (typeof value !== "object" || value === null) return out;
  const raw = value as { rooms?: unknown; elements?: unknown };
  if (typeof raw.rooms === "object" && raw.rooms !== null) {
    for (const [room, entry] of Object.entries(raw.rooms as Record<string, unknown>)) {
      const stored = entry as { area?: unknown; actions?: unknown } | null;
      const binding: RoomBinding = {};
      if (typeof stored?.area === "string") binding.area = stored.area;
      const actions = Array.isArray(stored?.actions) ? stored.actions.filter(isRoomAction) : [];
      if (actions.length > 0) binding.actions = actions;
      if (binding.area !== undefined || binding.actions) out.rooms[room] = binding;
    }
  }
  if (typeof raw.elements === "object" && raw.elements !== null) {
    for (const [id, entry] of Object.entries(raw.elements as Record<string, unknown>)) {
      const binding = entry as Partial<ElementBinding> | null;
      const entities = Array.isArray(binding?.entities)
        ? binding.entities.filter(
            (e): e is BoundEntity =>
              typeof e === "object" && typeof (e as { entity_id?: unknown }).entity_id === "string",
          )
        : [];
      const device = typeof binding?.device === "string" ? binding.device : undefined;
      if (entities.length === 0 && !device) continue;
      const element: ElementBinding = { entities };
      if (device) element.device = device;
      if (binding?.tap_action) element.tap_action = binding.tap_action;
      if (binding?.hold_action) element.hold_action = binding.hold_action;
      for (const key of ["fov", "range"] as const) {
        const value = binding?.[key];
        if (typeof value === "number" && Number.isFinite(value)) element[key] = value;
      }
      out.elements[id] = element;
    }
  }
  return out;
}

/** Every entity bound to an element. */
export function boundEntityIds(bindings: BindingsJson): Set<string> {
  const ids = new Set<string>();
  for (const binding of Object.values(bindings.elements)) {
    for (const entity of binding.entities) ids.add(entity.entity_id);
  }
  return ids;
}

/** The area of an entity: its own, else its device's. */
export function areaOf(hass: HomeAssistant, entityId: string): string | undefined {
  const entry = hass.entities?.[entityId];
  if (!entry) return undefined;
  if (entry.area_id) return entry.area_id;
  return entry.device_id ? (hass.devices?.[entry.device_id]?.area_id ?? undefined) : undefined;
}

/** Most entities linked to one element (the integration refuses more). */
export const MAX_ENTITIES = 16;

/**
 * An entity worth linking: in Home Assistant now (not disabled), neither hidden nor a
 * configuration or diagnostic one (a device's identify button, its firmware, its signal).
 */
export function shownEntity(hass: HomeAssistant, id: string): boolean {
  const entry = hass.entities?.[id];
  return hass.states[id] !== undefined && entry?.hidden !== true && !entry?.entity_category;
}

/**
 * The visible entities of an area (hidden and configuration entities left out); with `present`,
 * only those Home Assistant has a state for.
 */
export function areaEntities(hass: HomeAssistant, areaId: string, present = true): string[] {
  return Object.values(hass.entities ?? {})
    .filter((e) => e && !e.hidden && !e.entity_category && areaOf(hass, e.entity_id) === areaId)
    .map((e) => e?.entity_id ?? "")
    .filter((id) => id !== "" && (!present || hass.states[id] !== undefined))
    .sort();
}

/** The area of a room: the bound one, else an area whose name matches the room's name. */
export function roomArea(
  hass: HomeAssistant,
  bindings: BindingsJson,
  roomId: string,
  roomName: string,
): string | undefined {
  const bound = bindings.rooms[roomId]?.area;
  if (bound) return bound;
  const wanted = nameWords(roomName);
  if (!wanted) return undefined;
  return Object.values(hass.areas ?? {}).find((a) => a && nameWords(a.name) === wanted)?.area_id;
}

/** The display name of an entity. */
export function entityName(hass: HomeAssistant, entityId: string): string {
  const name = hass.states[entityId]?.attributes.friendly_name;
  return typeof name === "string" && name.trim() !== "" ? name : entityId;
}
