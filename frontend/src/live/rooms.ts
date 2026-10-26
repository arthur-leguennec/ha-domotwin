/**
 * The Rooms tab (D-055): Home Assistant's floors and areas, each area with its entities, and a
 * search through them all. An area of a private room the viewer may not see (D-039) shows its
 * name, not what it holds.
 */
import { domainOf, type HomeAssistant } from "../ha/types";
import { areaOf, entityName, shownEntity } from "./bindings";
import { seen, type Unseen } from "./privacy";
import { unaccented } from "./text";

/** An area as the Rooms tab lists it. */
export interface RoomsArea {
  id: string;
  name: string;
  icon?: string;
  /** A private room the viewer may not see: its entities are not listed. */
  closed: boolean;
  /** Its entities, what matters most first. */
  entities: string[];
}

/** A floor and its areas; the areas on no floor come last, without a floor. */
export interface RoomsFloor {
  id?: string;
  name?: string;
  areas: RoomsArea[];
}

/** What has no tile worth showing: updates, events, the voice pipeline's parts. */
const LEFT_OUT = new Set([
  "update",
  "event",
  "tts",
  "stt",
  "wake_word",
  "conversation",
  "assist_satellite",
  "image",
  "device_tracker",
  "person",
  "zone",
  "sun",
  "weather",
]);

/** The order of what a room holds: what one acts on first, then what one reads. */
const ORDER = [
  "light",
  "switch",
  "fan",
  "climate",
  "cover",
  "media_player",
  "lock",
  "vacuum",
  "lawn_mower",
  "humidifier",
  "water_heater",
  "valve",
  "scene",
  "script",
  "button",
  "input_boolean",
  "input_number",
  "input_select",
  "select",
  "number",
  "camera",
  "alarm_control_panel",
  "binary_sensor",
  "sensor",
];

function rank(id: string): number {
  const at = ORDER.indexOf(domainOf(id));
  return at === -1 ? ORDER.length : at;
}

/** Whether an entity has a place in the Rooms tab. */
export function listed(hass: HomeAssistant, id: string): boolean {
  return !LEFT_OUT.has(domainOf(id)) && shownEntity(hass, id);
}

/** Entities in the Rooms tab's order: by kind, then by name. */
export function sortEntities(
  hass: HomeAssistant,
  ids: string[],
  collator: Intl.Collator,
): string[] {
  return ids
    .map((id) => ({ id, rank: rank(id), name: entityName(hass, id) }))
    .sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name))
    .map(({ id }) => id);
}

/** Every entity of each area the viewer may see, those of no area under `""`. */
function byArea(hass: HomeAssistant, unseen: Unseen): Map<string, string[]> {
  const areas = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry || !listed(hass, entry.entity_id) || unseen.entities.has(entry.entity_id)) continue;
    const area = areaOf(hass, entry.entity_id) ?? "";
    const list = areas.get(area);
    if (list) list.push(entry.entity_id);
    else areas.set(area, [entry.entity_id]);
  }
  return areas;
}

/**
 * The floors of the home and their areas, in Home Assistant's order (floors by level, then
 * name; areas by name), without what the viewer may not see (D-039).
 */
export function homeFloors(
  hass: HomeAssistant,
  unseen: Unseen,
  collator: Intl.Collator,
): RoomsFloor[] {
  const entities = byArea(hass, unseen);
  const floors = Object.values(hass.floors ?? {})
    .filter((floor) => floor !== undefined)
    .sort(
      (a, b) =>
        (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER) ||
        collator.compare(a.name, b.name),
    );
  const known = new Set(floors.map((floor) => floor.floor_id));
  const grouped = new Map<string, RoomsArea[]>();
  for (const area of Object.values(hass.areas ?? {})) {
    if (!area) continue;
    const shut = unseen.areas.has(area.area_id);
    const item: RoomsArea = {
      id: area.area_id,
      name: area.name,
      closed: shut,
      entities: shut ? [] : sortEntities(hass, entities.get(area.area_id) ?? [], collator),
    };
    if (area.icon) item.icon = area.icon;
    const floor = area.floor_id && known.has(area.floor_id) ? area.floor_id : "";
    const list = grouped.get(floor);
    if (list) list.push(item);
    else grouped.set(floor, [item]);
  }
  const byName = (a: RoomsArea, b: RoomsArea): number => collator.compare(a.name, b.name);
  const result: RoomsFloor[] = floors
    .map((floor) => ({
      id: floor.floor_id,
      name: floor.name,
      areas: (grouped.get(floor.floor_id) ?? []).sort(byName),
    }))
    .filter((floor) => floor.areas.length > 0);
  const elsewhere = grouped.get("");
  if (elsewhere) result.push({ areas: elsewhere.sort(byName) });
  return result;
}

/**
 * The entities a search finds: every word in the entity's name, its id or its area's name; none
 * the viewer may not see (D-039).
 */
export function searchEntities(
  hass: HomeAssistant,
  query: string,
  unseen: Unseen,
  collator: Intl.Collator,
  limit = 60,
): string[] {
  const words = unaccented(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const found: string[] = [];
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry || !listed(hass, entry.entity_id)) continue;
    const area = areaOf(hass, entry.entity_id);
    if (!seen(unseen, entry.entity_id, area)) continue;
    const text = unaccented(
      [
        entityName(hass, entry.entity_id),
        entry.entity_id,
        area ? (hass.areas?.[area]?.name ?? "") : "",
      ].join(" "),
    );
    if (words.every((word) => text.includes(word))) found.push(entry.entity_id);
  }
  return sortEntities(hass, found, collator).slice(0, limit);
}
