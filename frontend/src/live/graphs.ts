/**
 * A room's graphs (D-067): what its area's entities measured, drawn by Home Assistant's own
 * history-graph and statistics-graph cards, one card for each kind of measure. Nothing is drawn
 * by DomoTwin (D-054).
 */
import { card, type CardConfig } from "../ha/cards";
import { domainOf, type HassEntity, type HomeAssistant } from "../ha/types";
import { areaEntities, entityName } from "./bindings";

/**
 * The periods the graphs show: within the 10 days Home Assistant keeps each change by default,
 * which is all its history-graph card reads in 2025.1 (its statistics fill older days since).
 */
export type GraphPeriod = "day" | "week";
export const GRAPH_PERIODS: readonly GraphPeriod[] = ["day", "week"];
const HOURS: Record<GraphPeriod, number> = { day: 24, week: 7 * 24 };

/** A card of a room's graphs. */
export interface RoomGraph {
  /**
   * What it shows: a sensor's device class (`temperature`), `unit:<unit>` for a sensor that has
   * none, `openings` or `presence` for the binary sensors that say them.
   */
  kind: string;
  /** A meter, which only counts up (`total_increasing`, `total`): bars of what each hour or day
   * added (`statistics-graph`), rather than a line. */
  meter: boolean;
  /** The unit of its sensors (the first's), which names a kind DomoTwin has no words for. */
  unit?: string;
  entities: string[];
}

/** As many entities as a card shows, and as many cards as a room's graphs. */
export const MAX_GRAPH_ENTITIES = 8;
export const MAX_GRAPHS = 10;

/** The measures a room's graphs show first, in this order; the others after them, by name. */
const FIRST = [
  "temperature",
  "humidity",
  "carbon_dioxide",
  "pm25",
  "pm10",
  "pm1",
  "volatile_organic_compounds",
  "volatile_organic_compounds_parts",
  "nitrogen_dioxide",
  "illuminance",
  "atmospheric_pressure",
  "sound_pressure",
  "power",
  "current",
  "voltage",
  "energy",
  "water",
  "gas",
];

/** What a sensor says that is not a measure over time. */
const NOT_MEASURES = new Set(["timestamp", "date", "enum"]);

/** The binary sensors whose changes a room's graphs show, as a timeline. */
const OPENINGS = new Set(["door", "window", "opening", "garage_door"]);
const PRESENCE = new Set(["motion", "occupancy", "presence"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The card an entity goes in, if any: its kind, and whether it is a meter. */
function kindOf(entity: HassEntity): { kind: string; meter: boolean; unit?: string } | undefined {
  const domain = domainOf(entity.entity_id);
  const deviceClass = text(entity.attributes.device_class);
  if (domain === "climate") {
    // Home Assistant draws a thermostat's room and target temperatures, and when it heats, with
    // the temperatures of its unit.
    return { kind: "temperature", meter: false };
  }
  if (domain === "binary_sensor") {
    if (deviceClass && OPENINGS.has(deviceClass)) return { kind: "openings", meter: false };
    if (deviceClass && PRESENCE.has(deviceClass)) return { kind: "presence", meter: false };
    return undefined;
  }
  if (domain !== "sensor" || (deviceClass && NOT_MEASURES.has(deviceClass))) return undefined;
  const unit = text(entity.attributes.unit_of_measurement);
  const stateClass = text(entity.attributes.state_class);
  // A measure has a unit or is kept as one (its statistics); a word (`on`, `idle`) is not one.
  if (!unit && !stateClass) return undefined;
  const meter = stateClass === "total_increasing" || stateClass === "total";
  const kind = deviceClass ?? (unit ? `unit:${unit}` : "unit:");
  return unit ? { kind, meter, unit } : { kind, meter };
}

/**
 * Where a card goes: the measures first in their order, then the others by their device class or
 * unit, the meters, the timelines.
 */
function rank(graph: RoomGraph): [number, number, string] {
  const at = FIRST.indexOf(graph.kind);
  const group = graph.kind === "openings" ? 3 : graph.kind === "presence" ? 4 : graph.meter ? 2 : 1;
  return [group, at === -1 ? FIRST.length : at, graph.kind];
}

/**
 * The graphs of a room: the entities of its area that measure (sensors with a unit, or kept as
 * statistics; thermostats with the temperatures) and its doors, windows and presence, one card for
 * each kind of measure and the meters apart, each entity by name. Hidden, configuration and
 * diagnostic entities are left out, as in the Rooms tab, and those the viewer may not see
 * (`unseen`: linked to a private room, D-039).
 */
export function roomGraphs(
  hass: HomeAssistant,
  area: string,
  collator: Intl.Collator = new Intl.Collator("en"),
  unseen: ReadonlySet<string> = new Set(),
): RoomGraph[] {
  const graphs = new Map<string, RoomGraph>();
  for (const id of areaEntities(hass, area)) {
    const entity = hass.states[id];
    const kind = entity && !unseen.has(id) ? kindOf(entity) : undefined;
    if (!kind) continue;
    // A meter and a measure of the same kind (energy counted, energy measured) are two cards:
    // bars and a line.
    const key = `${kind.meter ? "meter" : "measure"}:${kind.kind}`;
    const graph = graphs.get(key);
    if (graph) {
      graph.entities.push(id);
      // A thermostat has no unit of its own: the sensors with it name the kind.
      if (!graph.unit && kind.unit) graph.unit = kind.unit;
    } else graphs.set(key, { ...kind, entities: [id] });
  }
  return [...graphs.values()]
    .map((graph) => ({
      ...graph,
      entities: graph.entities
        .sort((a, b) => collator.compare(entityName(hass, a), entityName(hass, b)))
        .slice(0, MAX_GRAPH_ENTITIES),
    }))
    .sort((a, b) => {
      const [ga, ra, ka] = rank(a);
      const [gb, rb, kb] = rank(b);
      return ga - gb || ra - rb || ka.localeCompare(kb);
    })
    .slice(0, MAX_GRAPHS);
}

/** Whether an entity has a place in a room's graphs. */
export function graphable(entity: HassEntity | undefined): boolean {
  return entity !== undefined && kindOf(entity) !== undefined;
}

/** Whether a room has something to graph (`roomGraphs` finds at least one card). */
export function hasGraphs(hass: HomeAssistant, area: string): boolean {
  return areaEntities(hass, area).some((id) => graphable(hass.states[id]));
}

/** Home Assistant's card for a graph over a period, the same object for the same card. */
export function graphCard(graph: RoomGraph, period: GraphPeriod, title: string): CardConfig {
  if (graph.meter) {
    // What each hour of the day, or each day of the week, added.
    return card({
      type: "statistics-graph",
      title,
      entities: graph.entities,
      days_to_show: HOURS[period] / 24,
      period: period === "day" ? "hour" : "day",
      stat_types: ["change"],
      chart_type: "bar",
    });
  }
  return card({
    type: "history-graph",
    title,
    entities: graph.entities,
    hours_to_show: HOURS[period],
  });
}

/** The period a room's graphs show, from now (ms): as Home Assistant's History reads it. */
export function graphSpan(period: GraphPeriod, now: number): { start: number; end: number } {
  return { start: now - HOURS[period] * 3_600_000, end: now };
}

/** Every entity of a room's graphs, in their order. */
export function graphEntities(graphs: readonly RoomGraph[]): string[] {
  return [...new Set(graphs.flatMap((graph) => graph.entities))];
}
