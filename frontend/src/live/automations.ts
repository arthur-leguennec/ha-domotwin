/**
 * Automations and the home (`DECISIONS.md`, D-032): which automations involve a piece (its
 * entities, its Home Assistant device, its room's area), what each one's configuration involves,
 * where each end of it is in the home, and when one runs. Loaded with the automations section or
 * layer, not before.
 */
import { automationReader } from "../analysis/analysis";
import type { HomeAssistant } from "../ha/types";
import { areaOf, entityName, roomArea, type BindingsJson } from "./bindings";
import type { PlanRoom } from "./layers";

export type EndRole = "trigger" | "condition" | "action";

/** An end of an automation, as the analysis module reads it (`readAutomation`, D-043). */
export interface AutomationEnd {
  role: EndRole;
  entity?: string;
  device?: string;
  area?: string;
  /** A floor of Home Assistant's, or a label: what an action targets as a whole. */
  floor?: string;
  label?: string;
  /** Something with no place in the home: a trigger's kind (`sun`…), or the action called. */
  place?: string;
  /** Known only when it runs (a template). */
  dynamic?: string;
}

export interface ReadAutomation {
  ends: AutomationEnd[];
  skipped: number;
}

/** An end placed for the engine (`setAutomations`). */
export interface PlacedEnd {
  role: EndRole;
  piece?: string;
  room?: string;
  above?: string;
  dynamic?: boolean;
}

/** What Home Assistant's related search looks for. */
export interface RelatedItem {
  type: "entity" | "device" | "area";
  id: string;
}

/** The automations (their entity ids) that involve any of `items`, sorted. */
export async function relatedAutomations(
  hass: HomeAssistant,
  items: readonly RelatedItem[],
): Promise<string[]> {
  const found = new Set<string>();
  await Promise.all(
    items.map(async (item) => {
      try {
        const result = await hass.connection.sendMessagePromise<Record<string, unknown>>({
          type: "search/related",
          item_type: item.type,
          item_id: item.id,
        });
        const list = result.automation;
        if (Array.isArray(list)) {
          for (const id of list) if (typeof id === "string") found.add(id);
        }
      } catch {
        // An item Home Assistant does not know: nothing involves it.
      }
    }),
  );
  return [...found].filter((id) => hass.states[id] !== undefined).sort();
}

/**
 * An automation's configuration, or `undefined` when it cannot be read: Home Assistant keeps it
 * for administrators in its recent versions, and an automation written in YAML may be gone.
 */
export async function automationConfig(hass: HomeAssistant, entityId: string): Promise<unknown> {
  try {
    const answer = await hass.connection.sendMessagePromise<{ config?: unknown }>({
      type: "automation/config",
      entity_id: entityId,
    });
    return answer.config;
  } catch {
    return undefined;
  }
}

/**
 * What each automation of `ids` involves, read from its configuration by the analysis module;
 * those whose configuration cannot be had, or read, are left out. The module is loaded once a
 * configuration comes (Home Assistant gives them to administrators only), while the others are
 * still asked for. Nothing when it cannot be loaded.
 */
export async function readAutomations(
  hass: HomeAssistant,
  ids: readonly string[],
): Promise<Map<string, ReadAutomation> | undefined> {
  const reads = new Map<string, ReadAutomation>();
  let reader: Promise<(config: string) => string> | undefined;
  try {
    await Promise.all(
      ids.map(async (id) => {
        const config = await automationConfig(hass, id);
        if (config === undefined) return;
        reader ??= automationReader();
        const read = await reader;
        try {
          reads.set(id, JSON.parse(read(JSON.stringify(config))) as ReadAutomation);
        } catch {
          // One the reader cannot make sense of is left out; the others are kept.
        }
      }),
    );
  } catch {
    return undefined;
  }
  return reads;
}

/** The automations of the home: every `automation.*` entity, sorted. */
export function allAutomations(hass: HomeAssistant): string[] {
  return Object.keys(hass.states)
    .filter((id) => id.startsWith("automation."))
    .sort();
}

/** What the plan offers to place ends at. */
export interface Placing {
  bindings: BindingsJson;
  rooms: readonly PlanRoom[];
  /** Whether the plan shown has an element (pieces of other storeys are left out). */
  known: (element: string) => boolean;
  /** The label of something with no place in the home (`sun`, `template`…) or of an end known
   *  only when it runs. */
  label: (end: AutomationEnd) => string;
}

/** Where each end of an automation is: at a piece, in a room, or as a label above one or the home. */
export function placeEnds(
  hass: HomeAssistant,
  placing: Placing,
  ends: readonly AutomationEnd[],
): PlacedEnd[] {
  return placer(hass, placing)(ends);
}

/**
 * Places the ends of many automations: what the plan and the registries say is looked up once,
 * then each automation's ends placed (`placeEnds`, for one).
 */
export function placer(
  hass: HomeAssistant,
  placing: Placing,
): (ends: readonly AutomationEnd[]) => PlacedEnd[] {
  const { bindings, rooms, known } = placing;
  const byEntity = new Map<string, string>();
  const byDevice = new Map<string, string>();
  for (const [element, binding] of Object.entries(bindings.elements)) {
    if (!known(element)) continue;
    if (binding.device && !byDevice.has(binding.device)) byDevice.set(binding.device, element);
    for (const entity of binding.entities) {
      if (!byEntity.has(entity.entity_id)) byEntity.set(entity.entity_id, element);
    }
  }
  const roomOfArea = new Map<string, string>();
  for (const room of rooms) {
    const area = roomArea(hass, bindings, room.id, room.name);
    if (area && !roomOfArea.has(area) && known(room.id)) roomOfArea.set(area, room.id);
  }
  const deviceArea = (id: string) => hass.devices?.[id]?.area_id ?? undefined;
  const deviceName = (id: string) =>
    hass.devices?.[id]?.name_by_user || hass.devices?.[id]?.name || id;
  // A piece standing for each device, or for one of its entities.
  const byDeviceEntity = new Map<string, string>();
  for (const entry of Object.values(hass.entities ?? {})) {
    const piece = entry?.device_id ? byEntity.get(entry.entity_id) : undefined;
    if (entry?.device_id && piece && !byDeviceEntity.has(entry.device_id)) {
      byDeviceEntity.set(entry.device_id, piece);
    }
  }
  const pieceOfDevice = (id: string): string | undefined =>
    byDevice.get(id) ?? byDeviceEntity.get(id);
  // The pieces whose entities carry each label of Home Assistant's.
  const byLabel = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    const piece = entry ? byEntity.get(entry.entity_id) : undefined;
    if (!entry || !piece) continue;
    for (const label of entry.labels ?? []) {
      const pieces = byLabel.get(label) ?? [];
      if (!pieces.includes(piece)) pieces.push(piece);
      byLabel.set(label, pieces);
    }
  }
  /** A label above the room of `area`, or above the home. */
  const above = (role: EndRole, label: string, area: string | undefined): PlacedEnd => {
    const room = area ? roomOfArea.get(area) : undefined;
    return room ? { role, above: label, room } : { role, above: label };
  };
  return (ends) => {
    const placed: PlacedEnd[] = [];
    const keys = new Set<string>();
    const add = (spot: PlacedEnd) => {
      const key = JSON.stringify(spot);
      if (!keys.has(key)) {
        keys.add(key);
        placed.push(spot);
      }
    };
    for (const end of ends) {
      let spot: PlacedEnd;
      if (end.label) {
        // At every piece the label's entities are linked to; with none, a label above the home.
        const pieces = byLabel.get(end.label) ?? [];
        for (const piece of pieces) add({ role: end.role, piece });
        if (pieces.length > 0) continue;
        spot = { role: end.role, above: end.label };
      } else if (end.floor) {
        spot = { role: end.role, above: hass.floors?.[end.floor]?.name ?? end.floor };
      } else if (end.entity) {
        const piece = byEntity.get(end.entity);
        spot = piece
          ? { role: end.role, piece }
          : above(end.role, entityName(hass, end.entity), areaOf(hass, end.entity));
      } else if (end.device) {
        const piece = pieceOfDevice(end.device);
        spot = piece
          ? { role: end.role, piece }
          : above(end.role, deviceName(end.device), deviceArea(end.device));
      } else if (end.area) {
        const room = roomOfArea.get(end.area);
        spot = room
          ? { role: end.role, room }
          : above(end.role, hass.areas?.[end.area]?.name ?? end.area, undefined);
      } else if (end.dynamic !== undefined) {
        spot = { role: end.role, above: placing.label(end), dynamic: true };
      } else {
        spot = { role: end.role, above: placing.label(end) };
      }
      add(spot);
    }
    return placed;
  };
}

/** How a piece takes part in an automation: the roles of the ends that are its entities, its
 *  device or its room's area. */
export function rolesOf(
  ends: readonly AutomationEnd[],
  piece: { entities: readonly string[]; device?: string; area?: string },
): EndRole[] {
  const roles: EndRole[] = [];
  for (const end of ends) {
    const mine =
      (end.entity !== undefined && piece.entities.includes(end.entity)) ||
      (end.device !== undefined && end.device === piece.device) ||
      (end.area !== undefined && end.area === piece.area);
    if (mine && !roles.includes(end.role)) roles.push(end.role);
  }
  const order: EndRole[] = ["trigger", "condition", "action"];
  return roles.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * The colours of the automations' wires (linear RGB): hues apart, light enough on every look.
 * An automation keeps its colour from one view to the next (its id picks it).
 */
export const AUTOMATION_COLORS: readonly (readonly [number, number, number])[] = [
  [0.98, 0.45, 0.1],
  [0.16, 0.55, 1.0],
  [0.72, 0.3, 0.95],
  [0.1, 0.78, 0.62],
  [0.98, 0.25, 0.5],
  [0.85, 0.75, 0.05],
  [0.35, 0.85, 0.2],
  [0.2, 0.8, 0.95],
  [0.95, 0.55, 0.75],
  [0.6, 0.5, 1.0],
];

export function colorOf(id: string): readonly [number, number, number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AUTOMATION_COLORS[hash % AUTOMATION_COLORS.length] ?? [0.3, 0.6, 1.0];
}

/** When each automation last ran (`last_triggered`), to see which run next. */
export function lastRuns(hass: HomeAssistant, ids: readonly string[]): Map<string, string> {
  const runs = new Map<string, string>();
  for (const id of ids) {
    const at = hass.states[id]?.attributes.last_triggered;
    runs.set(id, typeof at === "string" ? at : "");
  }
  return runs;
}

/** The automations of `before` that ran since: their `last_triggered` moved on. */
export function ranSince(before: ReadonlyMap<string, string>, hass: HomeAssistant): string[] {
  const ran: string[] = [];
  for (const [id, at] of before) {
    const now = hass.states[id]?.attributes.last_triggered;
    if (typeof now === "string" && now !== at && (at === "" || Date.parse(now) > Date.parse(at))) {
      ran.push(id);
    }
  }
  return ran;
}

/** The entities an automation acts on, to show those that changed when it ran. */
export function actedOn(ends: readonly AutomationEnd[]): string[] {
  return ends.flatMap((e) => (e.role === "action" && e.entity ? [e.entity] : []));
}
