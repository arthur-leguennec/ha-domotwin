/**
 * Guest access (`docs/DECISIONS.md`, D-067): the passes an administrator makes, and what a pass
 * offers. A pass opens rooms of the plan and gives devices, for a while; its link opens DomoTwin's
 * own page outside Home Assistant's sign-in, which reads and acts through the pass only
 * (`custom_components/domotwin/guests.py` checks each request).
 */
import type { HomeAssistant } from "../ha/types";
import { areaEntities, entityName, roomArea, type BindingsJson } from "./bindings";
import { planElements } from "./plan";

export { passLink, readPass, readPasses } from "./guest-pass";
export type { GuestPass, GuestPassChange, PassStatus } from "./guest-pass";

/** What a pass may give (the integration's `GUEST_DOMAINS`): what a guest may use or read. */
export const GUEST_DOMAINS: readonly string[] = [
  "light",
  "switch",
  "input_boolean",
  "siren",
  "humidifier",
  "fan",
  "cover",
  "valve",
  "media_player",
  "lock",
  "climate",
  "water_heater",
  "vacuum",
  "lawn_mower",
  "scene",
  "script",
  "button",
  "input_button",
  "sensor",
  "binary_sensor",
  "weather",
];
/** A pass lasts at most this many days (the integration's `MAX_GUEST_DAYS`). */
export const MAX_GUEST_DAYS = 31;
export const MAX_GUEST_ENTITIES = 100;
/** The covers a guest is not given unless an administrator ticks them. */
const GUARDED_COVERS = ["garage", "gate", "door"];

/** Whether a pass may give an entity. */
export function givable(entity: string): boolean {
  return GUEST_DOMAINS.includes(entity.slice(0, entity.indexOf(".")));
}

/**
 * Whether a device of the rooms chosen is given unless an administrator unticks it: not a lock, a
 * garage door, a gate or a door's cover.
 */
export function givenByDefault(hass: HomeAssistant, entity: string): boolean {
  const domain = entity.slice(0, entity.indexOf("."));
  if (domain === "lock") return false;
  const kind = hass.states[entity]?.attributes.device_class;
  return !(domain === "cover" && typeof kind === "string" && GUARDED_COVERS.includes(kind));
}

/** A room of the home, as the pass's form offers it. */
export interface PassRoom {
  id: string;
  name: string;
  /** Its storey's name, when there are several. */
  storey?: string;
}

/** A storey's plan and overlay, as stored. */
export interface PassStorey {
  plan?: unknown;
  layout?: Record<string, unknown>;
}

/**
 * The devices in each room: what is linked to the room and to the pieces, doors and windows in it
 * (in the room it names, or that its overlay moved it to), and the entities of its area, those
 * kept (by default, those a pass may give), each once, by name. The rights (D-071) list them all.
 */
export function roomDevices(
  hass: HomeAssistant,
  bindings: BindingsJson,
  storeys: readonly PassStorey[],
  rooms: readonly PassRoom[],
  keep: (entity: string) => boolean = givable,
): Map<string, string[]> {
  const byRoom = new Map<string, Set<string>>(rooms.map((room) => [room.id, new Set()]));
  const add = (room: unknown, element: string): void => {
    const found = typeof room === "string" ? byRoom.get(room) : undefined;
    for (const entity of bindings.elements[element]?.entities ?? []) found?.add(entity.entity_id);
  };
  for (const room of rooms) add(room.id, room.id);
  for (const { plan, layout = {} } of storeys) {
    const moved = (id: string): Record<string, unknown> | undefined => {
      const entry = layout[id];
      return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
    };
    for (const { id, type, fields } of planElements(plan)) {
      if (type !== "room") add(moved(id)?.room ?? fields.room, id);
    }
    for (const id of Object.keys(layout)) {
      const entry = moved(id);
      if (entry && "add" in entry) add(entry.room, id);
    }
  }
  for (const room of rooms) {
    const area = roomArea(hass, bindings, room.id, room.name);
    if (area !== undefined) for (const id of areaEntities(hass, area)) byRoom.get(room.id)?.add(id);
  }
  const sorted = new Map<string, string[]>();
  for (const [room, entities] of byRoom) {
    sorted.set(
      room,
      [...entities]
        .filter(keep)
        .sort((a, b) => entityName(hass, a).localeCompare(entityName(hass, b))),
    );
  }
  return sorted;
}

/** A moment for a `datetime-local` input, in this device's time (`YYYY-MM-DDTHH:MM`). */
export function localInput(moment: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  );
}

/** A `datetime-local` input's moment as ISO 8601 (UTC), `undefined` when it is not one. */
export function fromInput(value: string): string | undefined {
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) ? undefined : moment.toISOString();
}

/** A new pass's times: from now, until two days later at the next full hour. */
export function newPassTimes(now: number): { starts: string; ends: string } {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 2 * 86_400_000);
  end.setMinutes(0);
  end.setHours(end.getHours() + 1);
  return { starts: localInput(start), ends: localInput(end) };
}
