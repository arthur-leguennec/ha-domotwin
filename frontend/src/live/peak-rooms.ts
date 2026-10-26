/**
 * What each room's heating does around a Hydro-Québec peak (D-058): pre-heating before it, shed
 * or still heating during it, and what the room draws. Read from the thermostats and the power
 * sensors of each room's area, as the layers read their sensors (D-023).
 */
import { domainOf, type HassEntity, type HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";
import { watts } from "./devices";
import { celsius, numberOf, roomEntities, type PlanRoom } from "./layers";

/** What a room's heating does around a peak (`layers.rs`' `PeakRole`). */
export type PeakRole = "preheat" | "shed" | "heating";

/** Where a peak stands now. */
export type PeakPhase = "none" | "upcoming" | "preheat" | "peak";

/** What the rooms do now, by room id. */
export interface PeakRooms {
  /** The roles of the rooms whose heating says something. */
  roles: Record<string, PeakRole>;
  /** What each room draws now (W), where its power sensors say. */
  draws: Record<string, number>;
}

/** A thermostat asks for heat when its target is this much above the room (°C). */
const DEMAND = 0.3;
/** Above this (W), a room draws: under it, it is on standby. */
const DRAWING = 5;

/** What a thermostat's `hvac_action` says, when it says it: heating or not. */
const ACTIONS: Record<string, boolean> = {
  heating: true,
  preheating: true,
  idle: false,
  off: false,
  cooling: false,
  drying: false,
  fan: false,
  defrosting: false,
};

/**
 * Whether a thermostat heats now: what it says it does (`hvac_action`), else whether its target
 * is above the room's temperature; undefined when it says neither.
 */
export function heats(hass: HomeAssistant, entity: HassEntity): boolean | undefined {
  const state = entity.state;
  if (state === "unavailable" || state === "unknown") return undefined;
  if (state === "off") return false;
  const action = entity.attributes.hvac_action;
  if (typeof action === "string" && action in ACTIONS) return ACTIONS[action];
  if (state !== "heat" && state !== "heat_cool" && state !== "auto") return false;
  const unit = hass.config?.unit_system?.temperature;
  const read = (value: unknown): number | undefined => {
    const n = numberOf(value);
    return n === undefined ? undefined : celsius(n, unit);
  };
  const target = read(entity.attributes.temperature) ?? read(entity.attributes.target_temp_low);
  const current = read(entity.attributes.current_temperature);
  if (target === undefined || current === undefined) return undefined;
  return target > current + DEMAND;
}

/**
 * What the rooms do in `phase`: before the peak, the rooms whose heating runs pre-heat; during
 * it, those whose heating is set back or off are shed, the others still heat. Each room draws
 * what its power sensors read (the home's own meters, `exclude`, left out). Nothing outside
 * the pre-heating and the peak, and nothing of a room the viewer may not see (D-039).
 */
export function peakRooms(
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: readonly PlanRoom[],
  phase: PeakPhase,
  closed: ReadonlySet<string>,
  exclude: ReadonlySet<string> = new Set(),
): PeakRooms {
  const found: PeakRooms = { roles: {}, draws: {} };
  if (phase !== "preheat" && phase !== "peak") return found;
  for (const room of rooms) {
    if (closed.has(room.id)) continue;
    let heating = false;
    let resting = false;
    let draw: number | undefined;
    for (const { id, hidden } of roomEntities(hass, bindings, room)) {
      const entity = hass.states[id];
      if (!entity || hidden || exclude.has(id)) continue;
      const domain = domainOf(id);
      if (domain === "climate") {
        const now = heats(hass, entity);
        if (now === true) heating = true;
        else if (now === false) resting = true;
      } else if (domain === "sensor" && entity.attributes.device_class === "power") {
        const value = watts(entity);
        if (value !== undefined && value > 0) draw = (draw ?? 0) + value;
      }
    }
    if (phase === "preheat" && heating) found.roles[room.id] = "preheat";
    else if (phase === "peak" && heating) found.roles[room.id] = "heating";
    else if (phase === "peak" && resting) found.roles[room.id] = "shed";
    if (draw !== undefined && draw >= DRAWING) found.draws[room.id] = Math.round(draw);
  }
  return found;
}
