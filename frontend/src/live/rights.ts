/**
 * Per-person rights (D-071): what DomoTwin shows each person and lets them do. The same rule as
 * the integration's (`rights.py`): an administrator sets, room by room and device by device, what
 * each person uses (`use`, the default), only sees (`see`) or does not see (`hidden`), and the
 * same for everyone else. A person is one through the Home Assistant user of their `person`; a
 * user who is nobody's (a shared screen) has everyone's. Rights apply to users who are not
 * administrators: an administrator sets them, and Home Assistant gives them everything.
 *
 * A device's level is its own when it has one (the person's, else everyone's), else the strictest
 * of the rooms it is in; a room hidden, or private and closed to the viewer (D-039), hides all it
 * holds. A device is in a room when it is linked to the room or to something of it, or when its
 * area is the room's.
 *
 * DomoTwin hides and refuses in its own views and controls: Home Assistant still lets every user
 * act on every entity elsewhere.
 */

import type { CardConfig } from "../ha/cards";
import type { PrivateRoom } from "../ha/client";
import type { HassError, HomeAssistant } from "../ha/types";
import { areaEntities, areaOf, type BindingsJson } from "./bindings";
import type { PlanRoom } from "./layers";
import { planElements } from "./plan";
import { closedAreas, closedEntities, privateRooms, unseenOf, type Unseen } from "./privacy";

export type Level = "use" | "see" | "hidden";

export const LEVELS: readonly Level[] = ["use", "see", "hidden"];

/** One person's rights, or everyone's: the rooms and devices given a level. */
export interface RightsSet {
  rooms?: Record<string, Level>;
  entities?: Record<string, Level>;
}

/** The home's rights (`settings.rights`). */
export interface Rights {
  everyone?: RightsSet;
  people?: Record<string, RightsSet>;
}

/** The rights that apply to one viewer: their person's own, and everyone's. */
export interface Viewer {
  person?: string;
  own: RightsSet;
  everyone: RightsSet;
}

const RANK: Record<Level, number> = { use: 0, see: 1, hidden: 2 };

/**
 * The rights that apply to the viewer of `hass` (none set: everything used); none for an
 * administrator, the demo house, the sandbox or a guest's page (D-067).
 */
export function viewerOf(
  rights: Rights | undefined,
  hass: HomeAssistant | undefined,
): Viewer | undefined {
  if (!hass || hass.user?.is_admin !== false) return undefined;
  if (hass.demo || hass.sandbox || hass.guest) return undefined;
  const user = hass.user.id;
  const person = Object.keys(rights?.people ?? {}).find(
    (p) => hass.states[p]?.attributes.user_id === user,
  );
  return {
    ...(person !== undefined ? { person } : {}),
    own: (person !== undefined ? rights?.people?.[person] : undefined) ?? {},
    everyone: rights?.everyone ?? {},
  };
}

function levelOf(viewer: Viewer, kind: "rooms" | "entities", key: string): Level | undefined {
  return viewer.own[kind]?.[key] ?? viewer.everyone[kind]?.[key];
}

/** A room's level for the viewer. */
export function roomLevel(viewer: Viewer, room: string): Level {
  return levelOf(viewer, "rooms", room) ?? "use";
}

/** The rooms at `level` for the viewer (among those given one). */
export function roomsAt(viewer: Viewer | undefined, level: Level): Set<string> {
  const found = new Set<string>();
  if (!viewer) return found;
  for (const room of [
    ...Object.keys(viewer.own.rooms ?? {}),
    ...Object.keys(viewer.everyone.rooms ?? {}),
  ]) {
    if (roomLevel(viewer, room) === level) found.add(room);
  }
  return found;
}

/** The devices hidden from the viewer by their own level. */
export function hiddenEntities(viewer: Viewer | undefined): Set<string> {
  const found = new Set<string>();
  if (!viewer) return found;
  for (const entity of [
    ...Object.keys(viewer.own.entities ?? {}),
    ...Object.keys(viewer.everyone.entities ?? {}),
  ]) {
    if (levelOf(viewer, "entities", entity) === "hidden") found.add(entity);
  }
  return found;
}

/** Whether the viewer's rights see only or hide anything. */
export function restricted(viewer: Viewer | undefined): boolean {
  if (!viewer) return false;
  return [viewer.own, viewer.everyone].some((set) =>
    [...Object.values(set.rooms ?? {}), ...Object.values(set.entities ?? {})].some(
      (level) => level !== "use",
    ),
  );
}

/**
 * The rooms the viewer may not see now (room ids): private ones (D-039), and those their rights
 * hide (D-071).
 */
export function closedRooms(
  rooms: Record<string, PrivateRoom> | undefined,
  rights: Rights | undefined,
  hass: HomeAssistant | undefined,
): Set<string> {
  const closed = privateRooms(rooms, hass);
  for (const room of roomsAt(viewerOf(rights, hass), "hidden")) closed.add(room);
  return closed;
}

/**
 * What the viewer may not see of the home: the areas of the rooms closed to them (`closed`) among
 * `rooms`, what is linked to those rooms and to what they hold on any of `storeys` (D-039), and
 * the devices their rights hide (D-071).
 */
export function viewerUnseen(
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: readonly PlanRoom[],
  storeys: readonly { plan?: unknown; layout?: Record<string, unknown> }[],
  closed: ReadonlySet<string>,
  rights: Rights | undefined,
): Unseen {
  const unseen = unseenOf(hass, bindings, rooms, storeys, closed);
  const hidden = hiddenEntities(viewerOf(rights, hass));
  return hidden.size === 0
    ? unseen
    : { ...unseen, entities: new Set([...unseen.entities, ...hidden]) };
}

/** What the gate reads of the home: its rooms, and its storeys' plans and overlays. */
export interface GateHome {
  bindings: BindingsJson;
  rooms: readonly PlanRoom[];
  storeys: readonly { plan?: unknown; layout?: Record<string, unknown> }[];
  /** The rooms closed to the viewer (`closedRooms`). */
  closed: ReadonlySet<string>;
}

/** The rooms `rooms` and the elements in them on any storey (where their overlay puts them). */
function elementsIn(storeys: GateHome["storeys"], rooms: ReadonlySet<string>): Set<string> {
  const found = new Set(rooms);
  if (rooms.size === 0) return found;
  for (const { plan, layout = {} } of storeys) {
    const edited = (id: string): Record<string, unknown> | undefined => {
      const entry = layout[id];
      return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
    };
    for (const { id, type, fields } of planElements(plan)) {
      if (type === "room") continue;
      const room = edited(id)?.room ?? fields.room;
      if (typeof room === "string" && rooms.has(room)) found.add(id);
    }
    for (const id of Object.keys(layout)) {
      const entry = edited(id);
      if (entry && "add" in entry && typeof entry.room === "string" && rooms.has(entry.room)) {
        found.add(id);
      }
    }
  }
  return found;
}

/** Each entity's level for one viewer, worked out once for the home as it is. */
export class Gate {
  /** Whether the viewer's rights see only or hide anything (not only rooms closed). */
  readonly restricts: boolean;
  private readonly closedLinked: Set<string>;
  private readonly closedAreas: Set<string>;
  private readonly seeLinked: Set<string>;
  private readonly seeAreas: Set<string>;
  /** The rooms closed and what is in them, which the view closes whole (D-039). */
  private readonly closedElements: Set<string>;

  constructor(
    private readonly hass: HomeAssistant,
    readonly viewer: Viewer,
    home: GateHome,
  ) {
    const { bindings, rooms, storeys, closed } = home;
    const see = roomsAt(viewer, "see");
    for (const room of closed) see.delete(room);
    this.restricts = restricted(viewer);
    this.closedLinked = closedEntities(bindings, storeys, closed);
    this.closedAreas = closedAreas(hass, bindings, rooms, closed);
    this.seeLinked = closedEntities(bindings, storeys, see);
    this.seeAreas = closedAreas(hass, bindings, rooms, see);
    this.closedElements = elementsIn(storeys, closed);
  }

  /**
   * The bindings without what the viewer may not see, outside the rooms closed to them: those the
   * view closes whole, their dangers still shown (D-039).
   */
  shown(bindings: BindingsJson): BindingsJson {
    let changed = false;
    const elements: BindingsJson["elements"] = {};
    for (const [id, binding] of Object.entries(bindings.elements)) {
      const entities = this.closedElements.has(id)
        ? binding.entities
        : binding.entities.filter((entity) => this.canSee(entity.entity_id));
      if (entities.length === binding.entities.length) {
        elements[id] = binding;
        continue;
      }
      changed = true;
      // A piece left with nothing to show is as one linked to nothing.
      if (entities.length > 0) elements[id] = { ...binding, entities };
    }
    return changed ? { ...bindings, elements } : bindings;
  }

  /** Whether the viewer may make a call: on what they may use, or on what cannot be told when
   * their rights restrict nothing (only rooms closed). */
  readonly allows = (entities: string[] | undefined): boolean =>
    entities === undefined ? !this.restricts : this.strictest(entities) === "use";

  /** An entity's level: hidden in a room closed to the viewer, else its own, else its rooms'. */
  level(entity: string): Level {
    const area = areaOf(this.hass, entity);
    if (this.closedLinked.has(entity) || (area !== undefined && this.closedAreas.has(area))) {
      return "hidden";
    }
    const own = levelOf(this.viewer, "entities", entity);
    if (own !== undefined) return own;
    if (this.seeLinked.has(entity) || (area !== undefined && this.seeAreas.has(area))) return "see";
    return "use";
  }

  /** Whether the viewer may act on an entity: the same function for the same gate. */
  readonly canAct = (entity: string): boolean => this.level(entity) === "use";

  /** Whether the viewer may see an entity: the same function for the same gate. */
  readonly canSee = (entity: string): boolean => this.level(entity) !== "hidden";

  /** The strictest level of these entities (`use` for none). */
  strictest(entities: Iterable<string>): Level {
    let found: Level = "use";
    for (const entity of entities) {
      const level = this.level(entity);
      if (RANK[level] > RANK[found]) found = level;
    }
    return found;
  }
}

/** The services of a script's own name (`script.wake_up`), its entity. */
const SCRIPT_SERVICES = new Set(["turn_on", "turn_off", "toggle", "reload"]);

/** The ids a target names: a list, or a string of them separated by commas (as Home Assistant
 * takes them). */
function ids(value: unknown): string[] {
  const listed = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return listed.flatMap((v) => (typeof v === "string" && v.trim() !== "" ? [v.trim()] : []));
}

/**
 * The entities a call acts on, as far as they can be told: those it names, those of the areas,
 * floors and devices it names, and a script called by its own name. `undefined`: it names
 * labels (given to areas and devices too, which the page does not know) or `all`.
 */
export function calledEntities(
  hass: HomeAssistant,
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  target: Record<string, unknown> = {},
): string[] | undefined {
  const named = { ...data, ...target };
  const entities = ids(named.entity_id);
  if (ids(named.label_id).length > 0 || entities.includes("all")) return undefined;
  const found = new Set(entities);
  const areas = new Set(ids(named.area_id));
  const floors = new Set(ids(named.floor_id));
  if (floors.size > 0) {
    for (const area of Object.values(hass.areas ?? {})) {
      if (area?.floor_id && floors.has(area.floor_id)) areas.add(area.area_id);
    }
  }
  for (const area of areas) {
    for (const entity of areaEntities(hass, area, false)) found.add(entity);
  }
  const devices = new Set(ids(named.device_id));
  if (devices.size > 0) {
    for (const entry of Object.values(hass.entities ?? {})) {
      if (entry?.device_id && devices.has(entry.device_id)) found.add(entry.entity_id);
    }
  }
  if (domain === "script" && !SCRIPT_SERVICES.has(service)) found.add(`script.${service}`);
  return [...found];
}

/** The entities an action calling a service acts on (`calledEntities`). */
export function actionEntities(
  hass: HomeAssistant,
  action: {
    perform_action?: string;
    service?: string;
    data?: Record<string, unknown>;
    target?: Record<string, unknown>;
  },
): string[] | undefined {
  const [domain = "", service = ""] = (action.perform_action ?? action.service ?? "").split(".", 2);
  return calledEntities(hass, domain, service, action.data, action.target);
}

/** A call refused by the viewer's rights, as Home Assistant's refusals read (`HassError`). */
class NotAllowed extends Error implements HassError {
  readonly code = "not_allowed";

  constructor() {
    super("");
    this.name = "NotAllowed";
  }
}

/** The `hass` given to DomoTwin's views, the last one for each gate (a card each, its own). */
const gated = new WeakMap<Gate, { hass: HomeAssistant; wrapped: HomeAssistant }>();

/**
 * `hass` as DomoTwin's views get it under the viewer's rights: `canAct` and `canSee` say what
 * they may do and see, and a call on an entity they may not use is refused (`not_allowed`)
 * before it reaches Home Assistant. The same object for the same `hass` and gate.
 */
export function gatedHass(hass: HomeAssistant, gate: Gate | undefined): HomeAssistant {
  if (!gate) return hass;
  const known = gated.get(gate);
  if (known?.hass === hass) return known.wrapped;
  // Home Assistant's own calls take more than DomoTwin's (whether to say an error, the answer).
  const callService = (...args: unknown[]): Promise<unknown> => {
    const [domain, service, data, target] = args as [
      string,
      string,
      Record<string, unknown> | undefined,
      Record<string, unknown> | undefined,
    ];
    if (!gate.allows(calledEntities(hass, domain, service, data, target))) {
      return Promise.reject(new NotAllowed());
    }
    // Every argument given, as many as there are (the tuple's type names DomoTwin's four).
    return hass.callService(...(args as Parameters<HomeAssistant["callService"]>));
  };
  const wrapped: HomeAssistant = {
    ...hass,
    canAct: gate.canAct,
    canSee: gate.canSee,
    canCall: gate.allows,
    callService,
  };
  gated.set(gate, { hass, wrapped });
  return wrapped;
}

/**
 * The gate of the viewer of `hass` and what it shows of the bindings, the same while nothing it
 * reads changes. None when no rights apply, or when nothing is seen only, hidden or closed.
 */
export class RightsCache {
  private from?: unknown[];
  private found?: { gate?: Gate; bindings: BindingsJson };

  /**
   * `rooms` and `storeys` are asked for only when worked out again; `keys` are what they are made
   * from, the same while they are.
   */
  read(
    hass: HomeAssistant,
    rights: Rights | undefined,
    seen: { bindings: BindingsJson; closed: ReadonlySet<string> },
    home: () => Pick<GateHome, "rooms" | "storeys">,
    keys: readonly unknown[],
  ): { gate?: Gate; bindings: BindingsJson } {
    const { bindings, closed } = seen;
    const viewer = viewerOf(rights, hass);
    const from = [
      rights,
      bindings,
      [...closed].sort().join("\n"),
      hass.user?.id,
      hass.user?.is_admin,
      hass.entities,
      hass.devices,
      hass.areas,
      viewer?.person,
      ...keys,
    ];
    if (this.found && this.from?.every((value, i) => value === from[i])) return this.found;
    this.from = from;
    const gate =
      viewer && (restricted(viewer) || closed.size > 0)
        ? new Gate(hass, viewer, { ...home(), bindings, closed })
        : undefined;
    this.found = gate
      ? {
          gate,
          bindings: gate.shown(bindings),
        }
      : { bindings };
    return this.found;
  }
}

/** A Home Assistant card made to be looked at only: a tap, a hold or a double tap does nothing. */
export function lookOnly(config: CardConfig): CardConfig {
  if (config.type !== "tile" && config.type !== "button") return config;
  const none = { action: "none" };
  return {
    type: "tile",
    entity: config.entity,
    tap_action: none,
    icon_tap_action: none,
    hold_action: none,
    double_tap_action: none,
  };
}
