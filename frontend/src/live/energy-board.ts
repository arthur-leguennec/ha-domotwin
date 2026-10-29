/**
 * The Energy tab's board (D-092): what the home used today, read from Home Assistant's energy
 * settings and its statistics, and what uses the most now, piece by piece and room by room, from
 * the pieces' power sensors.
 */
import type { HomeAssistant } from "../ha/types";
import { roleOf, type BindingsJson } from "./bindings";
import { watts } from "./devices";

/** The statistics of Home Assistant's energy settings, by what they count (kWh). */
export interface EnergyStats {
  solar: string[];
  /** Bought from the grid, and sold to it. */
  gridIn: string[];
  gridOut: string[];
  /** Drawn from the home battery, and stored in it. */
  batteryOut: string[];
  batteryIn: string[];
  /** The devices Home Assistant counts one by one. */
  devices: string[];
}

function ids(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))];
}

/** The statistics named by Home Assistant's energy settings (`energy/get_prefs`); none: none. */
export function energyStats(prefs: unknown): EnergyStats | undefined {
  const raw = prefs as { energy_sources?: unknown; device_consumption?: unknown } | null;
  const sources = Array.isArray(raw?.energy_sources) ? (raw.energy_sources as unknown[]) : [];
  const solar: unknown[] = [];
  const gridIn: unknown[] = [];
  const gridOut: unknown[] = [];
  const batteryOut: unknown[] = [];
  const batteryIn: unknown[] = [];
  for (const item of sources) {
    const source = item as Record<string, unknown> | null;
    if (!source) continue;
    switch (source.type) {
      case "solar":
        solar.push(source.stat_energy_from);
        break;
      case "battery":
        batteryOut.push(source.stat_energy_from);
        batteryIn.push(source.stat_energy_to);
        break;
      case "grid": {
        // Older settings list the flows; newer ones name them on the source.
        gridIn.push(source.stat_energy_from);
        gridOut.push(source.stat_energy_to);
        for (const flow of Array.isArray(source.flow_from) ? source.flow_from : []) {
          gridIn.push((flow as { stat_energy_from?: unknown } | null)?.stat_energy_from);
        }
        for (const flow of Array.isArray(source.flow_to) ? source.flow_to : []) {
          gridOut.push((flow as { stat_energy_to?: unknown } | null)?.stat_energy_to);
        }
        break;
      }
      default:
        break;
    }
  }
  const devices = (Array.isArray(raw?.device_consumption) ? raw.device_consumption : []).map(
    (device: unknown) => (device as { stat_consumption?: unknown } | null)?.stat_consumption,
  );
  const stats: EnergyStats = {
    solar: ids(solar),
    gridIn: ids(gridIn),
    gridOut: ids(gridOut),
    batteryOut: ids(batteryOut),
    batteryIn: ids(batteryIn),
    devices: ids(devices),
  };
  return allStats(stats).length > 0 ? stats : undefined;
}

/** Every statistic to ask for, each once. */
export function allStats(stats: EnergyStats): string[] {
  return [
    ...new Set([
      ...stats.solar,
      ...stats.gridIn,
      ...stats.gridOut,
      ...stats.batteryOut,
      ...stats.batteryIn,
      ...stats.devices,
    ]),
  ];
}

/** Each statistic's change over the period, from `recorder/statistics_during_period`'s answer. */
export function changesOf(answer: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (typeof answer !== "object" || answer === null) return out;
  for (const [id, rows] of Object.entries(answer as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    let sum = 0;
    let any = false;
    for (const row of rows) {
      const change = (row as { change?: unknown } | null)?.change;
      if (typeof change === "number" && Number.isFinite(change)) {
        sum += change;
        any = true;
      }
    }
    if (any) out.set(id, sum);
  }
  return out;
}

/** What the home used today (kWh), and where it came from. */
export interface EnergyToday {
  solar?: number;
  gridIn?: number;
  gridOut?: number;
  batteryOut?: number;
  batteryIn?: number;
  /** What the home used: all that came in, less what went out or was stored. */
  home?: number;
  /** Where what the home used came from (kWh): the sun, the battery, the grid. What was stored
   *  came from the sun first, and what was sold too, as Home Assistant's energy page says. */
  fromSun?: number;
  fromBattery?: number;
  fromGrid?: number;
  /** The share of it not bought from the grid (0–1). */
  ownShare?: number;
  /** The devices Home Assistant counts, the most first (kWh). */
  devices: { id: string; kwh: number }[];
}

/** Today's energy from the statistics' changes; a part none of whose statistics answered, none. */
export function energyToday(stats: EnergyStats, changes: ReadonlyMap<string, number>): EnergyToday {
  const sum = (list: string[]): number | undefined => {
    const known = list.filter((id) => changes.has(id));
    if (known.length === 0) return undefined;
    return known.reduce((total, id) => total + Math.max(changes.get(id) ?? 0, 0), 0);
  };
  const today: EnergyToday = {
    devices: stats.devices
      .filter((id) => changes.has(id))
      .map((id) => ({ id, kwh: Math.max(changes.get(id) ?? 0, 0) }))
      .filter((device) => device.kwh > 0)
      .sort((a, b) => b.kwh - a.kwh),
  };
  const parts = {
    solar: sum(stats.solar),
    gridIn: sum(stats.gridIn),
    gridOut: sum(stats.gridOut),
    batteryOut: sum(stats.batteryOut),
    batteryIn: sum(stats.batteryIn),
  };
  for (const [key, value] of Object.entries(parts) as [keyof typeof parts, number | undefined][]) {
    if (value !== undefined) today[key] = value;
  }
  if (parts.solar !== undefined || parts.gridIn !== undefined) {
    const solar = parts.solar ?? 0;
    const gridIn = parts.gridIn ?? 0;
    const gridOut = parts.gridOut ?? 0;
    const batteryIn = parts.batteryIn ?? 0;
    const batteryOut = parts.batteryOut ?? 0;
    // What was stored came from the sun first, the rest from the grid; what was sold, from the
    // sun left, the rest from the battery.
    const sunStored = Math.min(solar, batteryIn);
    const gridStored = batteryIn - sunStored;
    const sunSold = Math.min(solar - sunStored, gridOut);
    const batterySold = gridOut - sunSold;
    const fromSun = Math.max(solar - sunStored - sunSold, 0);
    const fromGrid = Math.max(gridIn - gridStored, 0);
    const fromBattery = Math.max(batteryOut - batterySold, 0);
    const home = fromSun + fromGrid + fromBattery;
    Object.assign(today, { home, fromSun, fromGrid, fromBattery });
    if (home > 0 && parts.gridIn !== undefined) {
      today.ownShare = Math.min(Math.max(1 - fromGrid / home, 0), 1);
    }
  }
  return today;
}

/** A plan's pieces and rooms, as the board names them. */
interface PlanNames {
  items?: { id?: unknown; name?: unknown; room?: unknown }[];
  rooms?: { id?: unknown; name?: unknown }[];
}

/**
 * What the board calls a statistic of Home Assistant's energy: the piece its entity is linked to
 * (its name on the plan), else its device, else the entity.
 */
export function statName(
  hass: HomeAssistant,
  bindings: BindingsJson,
  plans: readonly unknown[],
  id: string,
  hidden: (element: string) => boolean = () => false,
): string {
  for (const [element, binding] of Object.entries(bindings.elements)) {
    // A piece the viewer may not see does not lend its name (D-039).
    if (hidden(element) || !binding.entities.some((bound) => bound.entity_id === id)) continue;
    for (const plan of plans) {
      const item = (plan as PlanNames | null)?.items?.find((each) => each.id === element);
      if (typeof item?.name === "string" && item.name.trim()) return item.name;
    }
  }
  const device = hass.entities?.[id]?.device_id;
  const named = device ? hass.devices?.[device] : undefined;
  const name = named?.name_by_user ?? named?.name;
  if (typeof name === "string" && name.trim()) return name;
  const friendly = hass.states[id]?.attributes.friendly_name;
  return typeof friendly === "string" ? friendly : id;
}

/** A piece drawing power now. */
export interface PiecePower {
  element: string;
  name: string;
  room?: string;
  watts: number;
}

/** A room's power now: its pieces' together. */
export interface RoomPower {
  room: string;
  name: string;
  watts: number;
  pieces: number;
}

/** What `powerNow` leaves out. */
export interface PowerHidden {
  /** Elements the viewer may not see (D-039, D-071). */
  element?: (element: string) => boolean;
  /** Entities the viewer may not see, and the home's own meters (the grid's, the sun's, the
   *  battery's: they are the whole home's, not a piece's). */
  entity?: (entity: string) => boolean;
}

/**
 * The pieces of `plans` drawing power now (their power sensors', from 1 W), the most first; and
 * each room's together.
 */
export function powerNow(
  hass: HomeAssistant,
  bindings: BindingsJson,
  plans: readonly unknown[],
  hidden: PowerHidden = {},
): { pieces: PiecePower[]; rooms: RoomPower[] } {
  const items = new Map<string, { name?: string; room?: string }>();
  const roomNames = new Map<string, string>();
  for (const plan of plans) {
    const named = plan as PlanNames | null;
    for (const item of named?.items ?? []) {
      if (typeof item.id !== "string") continue;
      items.set(item.id, {
        ...(typeof item.name === "string" && item.name.trim() ? { name: item.name } : {}),
        ...(typeof item.room === "string" ? { room: item.room } : {}),
      });
    }
    for (const room of named?.rooms ?? []) {
      if (typeof room.id === "string" && typeof room.name === "string") {
        roomNames.set(room.id, room.name);
      }
    }
  }
  const pieces: PiecePower[] = [];
  for (const [element, binding] of Object.entries(bindings.elements)) {
    // Only what the plans shown hold: a tap shows it there.
    const item = items.get(element);
    if (!item || hidden.element?.(element)) continue;
    let power = 0;
    let measured = false;
    let first: string | undefined;
    let meter: string | undefined;
    for (const bound of binding.entities) {
      const entity = hass.states[bound.entity_id];
      if (!entity || hidden.entity?.(bound.entity_id)) continue;
      if (roleOf(bound, hass) === "power") {
        const value = watts(entity);
        if (value !== undefined) {
          power += Math.max(value, 0);
          measured = true;
          meter ??= bound.entity_id;
        }
      } else {
        first ??= bound.entity_id;
      }
    }
    if (!measured || power < 1) continue;
    const named = first ?? meter;
    const friendly = named ? hass.states[named]?.attributes.friendly_name : undefined;
    pieces.push({
      element,
      name: item.name ?? (typeof friendly === "string" ? friendly : element),
      ...(item.room ? { room: item.room } : {}),
      watts: power,
    });
  }
  pieces.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name));
  const rooms = new Map<string, RoomPower>();
  for (const piece of pieces) {
    if (!piece.room) continue;
    const known = rooms.get(piece.room);
    if (known) {
      known.watts += piece.watts;
      known.pieces += 1;
    } else {
      rooms.set(piece.room, {
        room: piece.room,
        name: roomNames.get(piece.room) ?? piece.room,
        watts: piece.watts,
        pieces: 1,
      });
    }
  }
  return {
    pieces,
    rooms: [...rooms.values()].sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name)),
  };
}

/** Energy as the board writes it: "4.2 kWh", in the viewer's language. */
export function formatEnergy(kwh: number, language: string): string {
  const digits = kwh < 10 ? 1 : 0;
  try {
    return `${new Intl.NumberFormat(language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(kwh)} kWh`;
  } catch {
    return `${kwh.toFixed(digits)} kWh`;
  }
}

/** The wall clock of `zone` at `time` (ms), read as if it were UTC; the device's own zone when
 *  `zone` is not known. */
function wallClock(time: number, zone: string | undefined): number {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }).formatToParts(time);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(time);
  }
  const part = (type: string): number =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
}

/**
 * The start of today where the home is, as Home Assistant's statistics take it (ISO 8601): its
 * midnight, on a day the clocks change too.
 */
export function startOfToday(now: Date, timeZone?: string): string {
  const at = Math.floor(now.getTime() / 1000) * 1000;
  const wall = wallClock(at, timeZone);
  const midnight = Math.floor(wall / 86_400_000) * 86_400_000;
  // The zone's offset now, then at the midnight found with it (it differs on a day the clocks
  // change: midnight was before the change).
  let start = midnight - (wall - at);
  start = midnight - (wallClock(start, timeZone) - start);
  return new Date(start).toISOString();
}
