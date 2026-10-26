/**
 * The home's energy at a glance (D-049): where power comes from (the sun, the grid, the home
 * battery) and where it goes (the home, the battery, back to the grid), from the sensors chosen
 * in the settings.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import { numberOf } from "./layers";
import { watts } from "./devices";

/** Where the energy is read: power sensors, the battery's charge, and signs counted the other way. */
export interface EnergySettings {
  /** Power from the sun (W, positive). */
  solar?: string;
  /** Power from the grid (positive: drawn from it, negative: sent to it). */
  grid?: string;
  /** Power from the home battery (positive: drawn from it, negative: charging it). */
  battery?: string;
  /** The battery's charge (%). */
  battery_level?: string;
  grid_reversed?: boolean;
  battery_reversed?: boolean;
}

/** The sensors of the settings, in the order they are shown. */
export const ENERGY_SENSORS = ["solar", "grid", "battery", "battery_level"] as const;
export type EnergySensor = (typeof ENERGY_SENSORS)[number];

/** The energy settings of stored settings, as far as they are sound. */
export function readEnergy(raw: unknown): EnergySettings | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const energy: EnergySettings = {};
  for (const key of ENERGY_SENSORS) {
    const sensor = value[key];
    if (typeof sensor === "string" && sensor.startsWith("sensor.")) energy[key] = sensor;
  }
  // A sign turned only with its sensor.
  if (value.grid_reversed === true && energy.grid) energy.grid_reversed = true;
  if (value.battery_reversed === true && energy.battery) energy.battery_reversed = true;
  return ENERGY_SENSORS.some((key) => energy[key]) ? energy : undefined;
}

/** What the sensors say now: powers in watts, the charge in %; absent when not set or unknown. */
export interface EnergyNow {
  solar?: number;
  grid?: number;
  battery?: number;
  level?: number;
}

/** The energy now, from the settings' sensors. */
export function energyNow(hass: HomeAssistant, settings: EnergySettings): EnergyNow {
  const power = (id: string | undefined, reversed = false): number | undefined => {
    const entity = id ? hass.states[id] : undefined;
    const value = entity ? watts(entity) : undefined;
    return value === undefined ? undefined : reversed ? -value : value;
  };
  const now: EnergyNow = {};
  const solar = power(settings.solar);
  // The sun gives; a sensor that dips under 0 at night means nothing.
  if (solar !== undefined) now.solar = Math.max(solar, 0);
  const grid = power(settings.grid, settings.grid_reversed);
  if (grid !== undefined) now.grid = grid;
  const battery = power(settings.battery, settings.battery_reversed);
  if (battery !== undefined) now.battery = battery;
  const level = settings.battery_level ? hass.states[settings.battery_level] : undefined;
  const percent = level ? numberOf(level.state) : undefined;
  if (percent !== undefined) now.level = Math.min(Math.max(percent, 0), 100);
  return now;
}

/** Where the power goes now (W, each at least 0), and what the home uses. */
export interface EnergyFlows {
  home: number;
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  batteryToGrid: number;
}

/**
 * The flows between the sun, the grid, the battery and the home: what comes in (the sun, the
 * grid drawn from, the battery drawn from) goes to the home first, then to charging the battery,
 * then back to the grid. What the home uses is what is left of all that comes and goes.
 */
export function energyFlows(now: EnergyNow): EnergyFlows {
  const solar = now.solar ?? 0;
  const grid = now.grid ?? 0;
  const battery = now.battery ?? 0;
  const fromGrid = Math.max(grid, 0);
  const toGrid = Math.max(-grid, 0);
  const fromBattery = Math.max(battery, 0);
  const toBattery = Math.max(-battery, 0);
  const home = Math.max(solar + grid + battery, 0);
  // The sun first feeds the home, then the battery, then the grid.
  const solarToHome = Math.min(solar, home);
  let solarLeft = solar - solarToHome;
  const solarToBattery = Math.min(solarLeft, toBattery);
  solarLeft -= solarToBattery;
  const solarToGrid = Math.min(solarLeft, toGrid);
  // The battery feeds what the sun leaves of the home, and the grid with the rest.
  const batteryToHome = Math.min(fromBattery, home - solarToHome);
  const batteryToGrid = Math.min(fromBattery - batteryToHome, toGrid - solarToGrid);
  // The grid feeds what is left of the home, and charges what the sun does not.
  const gridToHome = Math.min(fromGrid, Math.max(home - solarToHome - batteryToHome, 0));
  const gridToBattery = Math.min(fromGrid - gridToHome, toBattery - solarToBattery);
  const positive = (value: number): number => (value > 0.5 ? value : 0);
  return {
    home: positive(home),
    solarToHome: positive(solarToHome),
    solarToBattery: positive(solarToBattery),
    solarToGrid: positive(solarToGrid),
    gridToHome: positive(gridToHome),
    gridToBattery: positive(gridToBattery),
    batteryToHome: positive(batteryToHome),
    batteryToGrid: positive(batteryToGrid),
  };
}

/** Words that name each kind of sensor, in English and French. */
const NAMES: Record<EnergySensor, RegExp> = {
  solar: /solar|sun|pv|photovolta|inverter|onduleur|panneau|panel/i,
  grid: /grid|réseau|reseau|meter|compteur|linky|import|export|mains/i,
  battery: /batter|storage|stockage/i,
  battery_level: /batter|storage|stockage/i,
};

/** Whether an entity can be the sensor `kind` (a power sensor; a battery charge in %). */
function fitsKind(entity: HassEntity, kind: EnergySensor): boolean {
  if (!entity.entity_id.startsWith("sensor.")) return false;
  const deviceClass = entity.attributes.device_class;
  if (kind === "battery_level") {
    return deviceClass === "battery" && entity.attributes.unit_of_measurement === "%";
  }
  return deviceClass === "power";
}

/**
 * The sensors that can be the sensor `kind`, the likeliest first: those Home Assistant's energy
 * settings name for it (`preferred`), then those whose name says it, then the others; at most
 * `limit`.
 */
export function energyCandidates(
  hass: HomeAssistant,
  kind: EnergySensor,
  preferred: readonly string[] = [],
  limit = 60,
): string[] {
  const name = (entity: HassEntity): string => {
    const friendly = entity.attributes.friendly_name;
    return `${entity.entity_id} ${typeof friendly === "string" ? friendly : ""}`;
  };
  const score = (entity: HassEntity): number =>
    preferred.includes(entity.entity_id) ? 0 : NAMES[kind].test(name(entity)) ? 1 : 2;
  return Object.values(hass.states)
    .filter((entity): entity is HassEntity => entity !== undefined && fitsKind(entity, kind))
    .sort(
      (a, b) =>
        score(a) - score(b) || name(a).localeCompare(name(b), undefined, { sensitivity: "base" }),
    )
    .slice(0, limit)
    .map((entity) => entity.entity_id);
}

/**
 * The power sensors Home Assistant's own energy settings name (`energy/get_prefs`, from the
 * versions that keep power sensors with the sources), by kind; nothing when it names none.
 */
export function preferredFromHome(prefs: unknown): Record<EnergySensor, string[]> {
  const found: Record<EnergySensor, string[]> = {
    solar: [],
    grid: [],
    battery: [],
    battery_level: [],
  };
  const sources = (prefs as { energy_sources?: unknown } | null)?.energy_sources;
  if (!Array.isArray(sources)) return found;
  // Any power sensor named in a source, at any depth (`stat_rate`, `power`…).
  const sensors = (value: unknown, out: string[]): string[] => {
    if (typeof value === "string" && value.startsWith("sensor.")) out.push(value);
    else if (Array.isArray(value)) for (const item of value) sensors(item, out);
    else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        // Energy counters (kWh) are not powers.
        if (!key.startsWith("stat_energy") && key !== "stat_cost") sensors(item, out);
      }
    }
    return out;
  };
  for (const source of sources as { type?: unknown }[]) {
    const kind =
      source.type === "solar"
        ? "solar"
        : source.type === "grid"
          ? "grid"
          : source.type === "battery"
            ? "battery"
            : undefined;
    if (kind) found[kind].push(...sensors(source, []));
  }
  return found;
}
