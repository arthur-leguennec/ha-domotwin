/**
 * What a room does with a tap (`DECISIONS.md`, D-047): its lights on or off together, its blinds
 * open or closed, its media off, and the actions an administrator gave it (a scene, a script, any
 * Home Assistant action). A room's devices are those of its Home Assistant area and those linked to
 * its pieces.
 */
import type { HomeAssistant } from "../ha/types";
import type { MessageKey } from "../i18n";
import { runAction } from "./actions";
import {
  areaEntities,
  roleOf,
  type Action,
  type BindingsJson,
  type BoundEntity,
  type Role,
  type RoomAction,
} from "./bindings";
import { actionEntities } from "./rights";

export type { RoomAction } from "./bindings";

/** At most this many actions per room (the integration's `MAX_ROOM_ACTIONS`). */
export const MAX_ROOM_ACTIONS = 8;
/** A room action's name, at most this long. */
export const MAX_ACTION_NAME = 40;

/** What a room does together. */
export type RoomCommandKey =
  "lights_on" | "lights_off" | "covers_open" | "covers_close" | "media_off";

export interface RoomCommand {
  key: RoomCommandKey;
  label: MessageKey;
  /** The services called: domain, service, the entities. */
  calls: [string, string, string[]][];
}

/** A room's devices, by what they do there. */
export interface RoomDevices {
  lights: string[];
  covers: string[];
  media: string[];
  /** Every one, for the actions an administrator writes. */
  all: string[];
}

const NOT_ON = new Set(["off", "standby", "idle", "unavailable", "unknown"]);
/** Covers that are not blinds: a garage door, a gate, a door, a damper. */
export const NOT_BLINDS: ReadonlySet<string> = new Set(["garage", "gate", "door", "damper"]);
/** A media player that can switch off (`MediaPlayerEntityFeature.TURN_OFF`). */
export const TURN_OFF = 256;
/** A cover that opens and closes (`CoverEntityFeature.OPEN | CLOSE`). */
export const OPEN_CLOSE = 3;

/**
 * The devices of a room from the registries and the links: those of its area (when it has one)
 * and those linked to its pieces (`pieces`: the ids of the pieces in it). Read whatever their
 * state; `presentDevices` keeps those that can act now.
 */
export function roomDevices(
  hass: HomeAssistant,
  bindings: BindingsJson,
  area: string | undefined,
  pieces: readonly string[],
): RoomDevices {
  return devicesFrom(
    hass,
    area,
    pieces.flatMap((piece) => bindings.elements[piece]?.entities ?? []),
  );
}

/** The devices of an area (when there is one) and `linked`, by what they do in the room. */
export function devicesFrom(
  hass: HomeAssistant,
  area: string | undefined,
  linked: readonly BoundEntity[],
): RoomDevices {
  const roles = new Map<string, Role>();
  if (area) {
    for (const id of areaEntities(hass, area, false)) {
      roles.set(id, roleOf({ entity_id: id }, hass));
    }
  }
  for (const entity of linked) roles.set(entity.entity_id, roleOf(entity, hass));
  const all = [...roles.keys()].sort();
  const domain = (id: string): string => id.split(".")[0] ?? "";
  return {
    // A lamp on a smart plug is a light of the room too.
    lights: all.filter((id) => roles.get(id) === "light"),
    covers: all.filter((id) => domain(id) === "cover"),
    media: all.filter((id) => domain(id) === "media_player"),
    all,
  };
}

/**
 * A room's devices Home Assistant has now; its blinds without a garage door or a gate, which a
 * tap on the room must not open, and only those that open and close.
 */
export function presentDevices(hass: HomeAssistant, devices: RoomDevices): RoomDevices {
  const present = (id: string): boolean => hass.states[id] !== undefined;
  return {
    lights: devices.lights.filter(present),
    // Those that open and close: one that cannot would fail the whole call.
    covers: devices.covers.filter((id) => {
      const attributes = hass.states[id]?.attributes;
      const kind = attributes?.device_class;
      const features = Number(attributes?.supported_features ?? 0);
      return (
        present(id) &&
        !(typeof kind === "string" && NOT_BLINDS.has(kind)) &&
        (features & OPEN_CLOSE) === OPEN_CLOSE
      );
    }),
    media: devices.media.filter(present),
    all: devices.all.filter(present),
  };
}

/** Switches `entities` on or off: lights through `light`, the others through `homeassistant`. */
function switching(entities: string[], on: boolean): [string, string, string[]][] {
  const service = on ? "turn_on" : "turn_off";
  const lights = entities.filter((id) => id.startsWith("light."));
  const others = entities.filter((id) => !id.startsWith("light."));
  const calls: [string, string, string[]][] = [];
  if (lights.length > 0) calls.push(["light", service, lights]);
  if (others.length > 0) calls.push(["homeassistant", service, others]);
  return calls;
}

/**
 * What the room does together, in the order offered; media off only while one plays. On the
 * devices the viewer may use (their rights, D-071).
 */
export function roomCommands(hass: HomeAssistant, given: RoomDevices): RoomCommand[] {
  const commands: RoomCommand[] = [];
  const canAct = hass.canAct;
  const devices = canAct
    ? {
        lights: given.lights.filter(canAct),
        covers: given.covers.filter(canAct),
        media: given.media.filter(canAct),
        all: given.all.filter(canAct),
      }
    : given;
  if (devices.lights.length > 0) {
    commands.push(
      { key: "lights_on", label: "room.lights_on", calls: switching(devices.lights, true) },
      { key: "lights_off", label: "room.lights_off", calls: switching(devices.lights, false) },
    );
  }
  if (devices.covers.length > 0) {
    commands.push(
      {
        key: "covers_open",
        label: "room.covers_open",
        calls: [["cover", "open_cover", devices.covers]],
      },
      {
        key: "covers_close",
        label: "room.covers_close",
        calls: [["cover", "close_cover", devices.covers]],
      },
    );
  }
  // Those playing that can switch off: one that cannot would fail the whole call.
  const playing = devices.media.filter((id) => {
    const entity = hass.states[id];
    const features = Number(entity?.attributes.supported_features ?? 0);
    return entity !== undefined && !NOT_ON.has(entity.state) && (features & TURN_OFF) !== 0;
  });
  if (playing.length > 0) {
    commands.push({
      key: "media_off",
      label: "room.media_off",
      calls: [["media_player", "turn_off", playing]],
    });
  }
  return commands;
}

/** Runs a room command; throws when Home Assistant refused one of its calls. */
export async function runCommand(hass: HomeAssistant, command: RoomCommand): Promise<void> {
  // Every call made, then the first refusal said.
  const results = await Promise.allSettled(
    command.calls.map(([domain, service, entities]) =>
      hass.callService(domain, service, {}, { entity_id: entities }),
    ),
  );
  const refused = results.find((result) => result.status === "rejected");
  if (refused) throw refused.reason;
}

/**
 * A command of the room or one of its own actions, run; throws what Home Assistant said. Returns
 * whether it was done (not a dialog of Home Assistant's that the demo house has not, D-050).
 */
export async function runRoom(
  node: HTMLElement,
  hass: HomeAssistant,
  what: RoomCommand | RoomAction,
): Promise<boolean> {
  if ("calls" in what) {
    await runCommand(hass, what);
    return true;
  }
  const result = await runAction(node, hass, what.action, { entities: [] });
  return !(hass.demo && result === "controls");
}

/** The actions an administrator gave a room (`readBindings` left out anything malformed). */
export function roomActions(bindings: BindingsJson, room: string): RoomAction[] {
  return bindings.rooms[room]?.actions ?? [];
}

/**
 * Whether the viewer may run an action on the devices it names (their rights, D-071): one on a
 * device they may only look at, or on floors or labels, is not offered.
 */
export function mayRun(hass: HomeAssistant, action: Action): boolean {
  const { canAct, canCall } = hass;
  if (!canAct || !canCall) return true;
  switch (action.action) {
    case "toggle":
    case "more-info":
      return action.entity_id === undefined || canAct(action.entity_id);
    case "perform-action":
    case "call-service":
      return canCall(actionEntities(hass, action));
    default:
      return true;
  }
}

/** The room's own actions the viewer may run (`mayRun`). */
export function usableActions(hass: HomeAssistant, actions: RoomAction[]): RoomAction[] {
  return hass.canAct ? actions.filter((what) => mayRun(hass, what.action)) : actions;
}

/**
 * The devices a room's group switches together, for an action done later (D-046): its lights, its
 * blinds, or both when it has both.
 */
export function schedulableGroups(
  devices: RoomDevices,
): { key: "lights" | "covers"; entities: string[] }[] {
  const groups: { key: "lights" | "covers"; entities: string[] }[] = [];
  if (devices.lights.length > 0) groups.push({ key: "lights", entities: devices.lights });
  if (devices.covers.length > 0) groups.push({ key: "covers", entities: devices.covers });
  return groups;
}
