/**
 * What each room's heating does around a Hydro-Québec peak (D-063): pre-heating before it, shed
 * or still heating during it, and what the room draws. Read from the thermostats and the power
 * sensors of each room's area, as the layers read their sensors (D-023).
 */
import { domainOf, type HassEntity, type HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";
import { watts } from "./devices";
import { celsius, numberOf, roomEntities, roomAreaOf, type PlanRoom } from "./layers";

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

/** What a thermostat does: heats, is set back below the room (or off), or holds the room. */
export type Heating = "heating" | "setback" | "holding";

/** A thermostat asks for heat, or is set back, when its target is this far from the room (°C). */
const DEMAND = 0.3;
/** Above this (W), a room draws: under it, it is on standby. */
const DRAWING = 5;

/** What a thermostat's `hvac_action` says, when it says it: heating, off, or neither. */
const ACTIONS: Record<string, Heating | "idle"> = {
  heating: "heating",
  preheating: "heating",
  off: "setback",
  idle: "idle",
  cooling: "idle",
  drying: "idle",
  fan: "idle",
  defrosting: "idle",
};

/**
 * What a thermostat does now: it heats when it says so (`hvac_action`), else when its target is
 * above the room; it is set back when it is off or its target is below the room; otherwise it
 * holds the room. Undefined when it says nothing, or does not heat at all (cooling). The
 * sandbox's copy (D-057) does not move its `hvac_action`, nor its rooms' temperatures: there,
 * the target alone says.
 */
export function heatingOf(hass: HomeAssistant, entity: HassEntity): Heating | undefined {
  const state = entity.state;
  // Off, a thermostat that heats is set back; an air conditioner off says nothing of the heat.
  if (state === "off") return heatsAtAll(entity) ? "setback" : undefined;
  if (state !== "heat" && state !== "heat_cool" && state !== "auto") return undefined;
  const unit = hass.config?.unit_system?.temperature;
  const read = (value: unknown): number | undefined => {
    const n = numberOf(value);
    return n === undefined ? undefined : celsius(n, unit);
  };
  const target = read(entity.attributes.temperature) ?? read(entity.attributes.target_temp_low);
  const current = read(entity.attributes.current_temperature);
  const said = entity.attributes.hvac_action;
  const action =
    hass.sandbox !== true && typeof said === "string" && Object.hasOwn(ACTIONS, said)
      ? ACTIONS[said]
      : undefined;
  if (action === "heating" || action === "setback") return action;
  if (target === undefined || current === undefined)
    return action === "idle" ? "holding" : undefined;
  if (target <= current - DEMAND) return "setback";
  // An idle thermostat is not heating, whatever its target.
  return action === undefined && target >= current + DEMAND ? "heating" : "holding";
}

/** Whether a thermostat can heat: its modes say so, or say nothing. */
function heatsAtAll(entity: HassEntity): boolean {
  const modes = entity.attributes.hvac_modes;
  return (
    !Array.isArray(modes) ||
    modes.some((mode) => mode === "heat" || mode === "heat_cool" || mode === "auto")
  );
}

/** What the viewer may not see (D-039): the areas of private rooms, what their pieces link. */
export interface PeakUnseen {
  areas?: ReadonlySet<string>;
  entities?: ReadonlySet<string>;
}

/**
 * What the rooms do in `phase`: before the peak, the rooms whose heating runs pre-heat; during
 * it, those whose heating is set back are shed, those whose heating runs still heat, and those
 * that hold their temperature are neither. Each room draws what its power sensors read (the
 * home's own meters, `exclude`, left out). An area shared by several rooms counts once, for the
 * first. Nothing outside the pre-heating and the peak, and nothing of a private room the viewer
 * may not see (D-039): neither the room, nor its area, nor what its pieces link.
 */
export function peakRooms(
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: readonly PlanRoom[],
  phase: PeakPhase,
  closed: ReadonlySet<string>,
  exclude: ReadonlySet<string> = new Set(),
  unseen: PeakUnseen = {},
): PeakRooms {
  const found: PeakRooms = { roles: {}, draws: {} };
  if (phase !== "preheat" && phase !== "peak") return found;
  const counted = new Set<string>();
  for (const room of rooms) {
    if (closed.has(room.id)) continue;
    const area = roomAreaOf(hass, bindings, room);
    if (area === undefined || counted.has(area) || unseen.areas?.has(area) === true) continue;
    counted.add(area);
    let heating = false;
    let setback = false;
    let draw: number | undefined;
    for (const { id, hidden } of roomEntities(hass, bindings, room)) {
      const entity = hass.states[id];
      if (!entity || hidden || exclude.has(id) || unseen.entities?.has(id) === true) continue;
      const domain = domainOf(id);
      if (domain === "climate") {
        const now = heatingOf(hass, entity);
        if (now === "heating") heating = true;
        else if (now === "setback") setback = true;
      } else if (domain === "sensor" && entity.attributes.device_class === "power") {
        const value = watts(entity);
        if (value !== undefined && value > 0) draw = (draw ?? 0) + value;
      }
    }
    if (phase === "preheat" && heating) found.roles[room.id] = "preheat";
    else if (phase === "peak" && heating) found.roles[room.id] = "heating";
    else if (phase === "peak" && setback) found.roles[room.id] = "shed";
    if (draw !== undefined && draw >= DRAWING) found.draws[room.id] = Math.round(draw);
  }
  return found;
}
