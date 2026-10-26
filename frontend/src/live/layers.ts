/**
 * The layers (`docs/DECISIONS.md`, D-023), read from Home Assistant for each room of the plan:
 * a quantity for the heatmap (the mean of the sensors of the room's area), the alerts and
 * presence. The engine draws them (`setLayers`); the view adds the legend, the values and the
 * alerts' banner.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import { areaOf, roomArea, type BindingsJson } from "./bindings";
import type { PeakRooms } from "./peak-rooms";

export const HEAT_KINDS = ["temperature", "humidity", "co2", "pm25"] as const;
export type HeatKind = (typeof HEAT_KINDS)[number];
/**
 * What the layer menu shows: nothing, a heatmap, the power layer, Hydro-Québec's peaks (D-058,
 * offered where an integration reads them), the network map (D-031, offered to administrators
 * with ZHA set up), every automation's wires (D-032, administrators) or upkeep (D-033: the pieces
 * tinted by their tasks, and the list of them).
 */
export type LayerName = "off" | HeatKind | "power" | "peak" | "network" | "automations" | "upkeep";
export const LAYER_NAMES: readonly LayerName[] = [
  "off",
  ...HEAT_KINDS,
  "power",
  "peak",
  "network",
  "automations",
  "upkeep",
];

/**
 * Whether every automation's wires can be offered (D-032): to administrators, as Home Assistant
 * keeps automations' configurations for them in its recent versions.
 */
export function automationsAvailable(hass: HomeAssistant | undefined): boolean {
  return hass?.user?.is_admin === true;
}

/** Whether the network map can be offered: to administrators, with ZHA set up (D-031). */
export function networkAvailable(hass: HomeAssistant | undefined): boolean {
  return hass?.user?.is_admin === true && (hass.config?.components ?? []).includes("zha");
}

/** The sensors' device class of each quantity. */
const DEVICE_CLASSES: Record<HeatKind, string> = {
  temperature: "temperature",
  humidity: "humidity",
  co2: "carbon_dioxide",
  pm25: "pm25",
};
/** The climate entities' attribute of a quantity, used when the area has no sensor of it. */
const CLIMATE_ATTRIBUTES: Partial<Record<HeatKind, string>> = {
  temperature: "current_temperature",
  humidity: "current_humidity",
};
/** Decimals kept: a value that changes less does not redraw. */
const DECIMALS: Record<HeatKind, number> = { temperature: 1, humidity: 0, co2: 0, pm25: 0 };

/** Binary sensors whose `on` is a danger. */
const DANGER_CLASSES = new Set(["smoke", "gas", "carbon_monoxide", "moisture", "safety"]);
/** Binary sensors whose `on` means someone is there. */
const PRESENCE_CLASSES = new Set(["occupancy", "motion", "presence"]);
/** Binary sensors of an open window. */
const WINDOW_CLASSES = new Set(["window", "opening"]);
/** Weather that comes in through an open window. */
const WET_WEATHER = new Set([
  "rainy",
  "pouring",
  "lightning-rainy",
  "snowy",
  "snowy-rainy",
  "hail",
]);
/** CO₂ above this (ppm) is a warning: the room needs air. */
export const CO2_WARNING = 1500;

/** Why a room has an alert. */
export type AlertReason =
  "smoke" | "gas" | "carbon_monoxide" | "moisture" | "safety" | "alarm" | "window_rain" | "co2";

export type AlertLevel = "warning" | "danger";

/** An alert of a room: the first entity that raised it. */
export interface RoomAlert {
  room: string;
  /** The room's name in the plan. */
  name: string;
  level: AlertLevel;
  reason: AlertReason;
  entity: string;
}

/** A room of the plan. */
export interface PlanRoom {
  id: string;
  name: string;
}

/** What is shown. */
export interface LayerChoice {
  layer: LayerName;
  /** Alerts (on unless turned off). */
  alerts: boolean;
  presence: boolean;
  /**
   * Private rooms the viewer may not see (D-039): no values nor presence, nor the warnings that
   * would tell someone is in (CO₂) or a window is open (rain); their dangers stay.
   */
  closed?: Set<string>;
  /** What the rooms do around a peak (D-058), when its layer is shown. */
  peak?: PeakRooms;
}

/** What the layers show now. */
export interface RoomLayers {
  /** What the engine's `setLayers` reads. */
  json: string;
  /** The heatmap's value of each room that has one. */
  values: Record<string, number>;
  /** Dangers first, then warnings, in plan order. */
  alerts: RoomAlert[];
  /** Rooms someone is in. */
  presence: string[];
}

/** An entity of an area: hidden ones raise alerts but give no value and no presence. */
export interface AreaEntity {
  id: string;
  hidden: boolean;
}

/** The entities of each area, built once per entity registry. */
const indexes = new WeakMap<object, { devices: unknown; byArea: Map<string, AreaEntity[]> }>();

function areaIndex(hass: HomeAssistant): Map<string, AreaEntity[]> {
  const entities = hass.entities;
  if (!entities) return new Map();
  const cached = indexes.get(entities);
  if (cached && cached.devices === hass.devices) return cached.byArea;
  const byArea = new Map<string, AreaEntity[]>();
  for (const entry of Object.values(entities)) {
    // Configuration and diagnostic entities say nothing about the room.
    if (!entry || entry.entity_category) continue;
    const area = areaOf(hass, entry.entity_id);
    if (!area) continue;
    const entity = { id: entry.entity_id, hidden: entry.hidden === true };
    const list = byArea.get(area);
    if (list) list.push(entity);
    else byArea.set(area, [entity]);
  }
  indexes.set(entities, { devices: hass.devices, byArea });
  return byArea;
}

const NO_AREAS = {};

/** The area of each room, found once per area registry and bindings. */
type RoomAreas = Map<string, string | undefined>;
const roomAreas = new WeakMap<object, WeakMap<object, RoomAreas>>();

function areaOfRoom(
  hass: HomeAssistant,
  bindings: BindingsJson,
  room: PlanRoom,
): string | undefined {
  const registry = hass.areas ?? NO_AREAS;
  let byBindings = roomAreas.get(registry);
  if (!byBindings) roomAreas.set(registry, (byBindings = new WeakMap<object, RoomAreas>()));
  let found = byBindings.get(bindings);
  if (!found) byBindings.set(bindings, (found = new Map<string, string | undefined>()));
  const key = `${room.id}\n${room.name}`;
  if (!found.has(key)) found.set(key, roomArea(hass, bindings, room.id, room.name));
  return found.get(key);
}

/**
 * The entities of a room's area, configuration and diagnostic ones left out; a hidden one says
 * so (it raises alerts but gives no value).
 */
export function roomEntities(
  hass: HomeAssistant,
  bindings: BindingsJson,
  room: PlanRoom,
): readonly AreaEntity[] {
  const area = areaOfRoom(hass, bindings, room);
  return (area ? areaIndex(hass).get(area) : undefined) ?? [];
}

/** A number from a state or an attribute (`"21.5"`, `21.5`); undefined otherwise. */
export function numberOf(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && !(typeof value === "string" && value.trim() === "") ? n : undefined;
}

/** A temperature in °C from a value in `unit` (°C, °F or K); undefined for another unit. */
export function celsius(value: number, unit: unknown): number | undefined {
  switch (unit) {
    case undefined:
    case null:
    case "°C":
      return value;
    case "°F":
      return ((value - 32) * 5) / 9;
    case "K":
      return value - 273.15;
    default:
      return undefined;
  }
}

/** The value of a sensor of `kind`, in the unit of the scale (°C, %, ppm, µg/m³). */
function sensorValue(entity: HassEntity, kind: HeatKind): number | undefined {
  if (entity.attributes.device_class !== DEVICE_CLASSES[kind]) return undefined;
  const value = numberOf(entity.state);
  if (value === undefined) return undefined;
  return kind === "temperature" ? celsius(value, entity.attributes.unit_of_measurement) : value;
}

function climateValue(hass: HomeAssistant, entity: HassEntity, kind: HeatKind): number | undefined {
  const attribute = CLIMATE_ATTRIBUTES[kind];
  const value = attribute ? numberOf(entity.attributes[attribute]) : undefined;
  if (value === undefined) return undefined;
  return kind === "temperature" ? celsius(value, hass.config?.unit_system?.temperature) : value;
}

function mean(values: number[]): number | undefined {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

function round(value: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(value * k) / k;
}

/**
 * Whether the weather comes in through open windows (any weather entity says so). Asked only
 * when a window is open, at most once per update.
 */
function wetWeather(hass: HomeAssistant): () => boolean {
  let wet: boolean | undefined;
  return () => {
    wet ??= Object.entries(hass.states).some(
      ([id, entity]) => id.startsWith("weather.") && !!entity && WET_WEATHER.has(entity.state),
    );
    return wet;
  };
}

/** What one room shows. */
interface RoomReading {
  value?: number;
  co2?: number;
  presence: boolean;
  alert?: { level: AlertLevel; reason: AlertReason; entity: string };
}

function readRoom(
  hass: HomeAssistant,
  entities: AreaEntity[],
  heat: HeatKind | undefined,
  wet: () => boolean,
): RoomReading {
  const reading: RoomReading = { presence: false };
  const values: number[] = [];
  const climate: number[] = [];
  const co2: number[] = [];
  const raise = (level: AlertLevel, reason: AlertReason, entity: string): void => {
    if (!reading.alert || (level === "danger" && reading.alert.level === "warning")) {
      reading.alert = { level, reason, entity };
    }
  };
  for (const { id, hidden } of entities) {
    const entity = hass.states[id];
    if (!entity) continue;
    const domain = id.slice(0, id.indexOf("."));
    const deviceClass = entity.attributes.device_class;
    // A hidden entity (a duplicate, a probe inside an appliance…) still raises its alerts.
    if (hidden && domain !== "binary_sensor" && domain !== "alarm_control_panel") continue;
    if (domain === "sensor") {
      if (heat) {
        const value = sensorValue(entity, heat);
        if (value !== undefined) values.push(value);
      }
      const ppm = sensorValue(entity, "co2");
      if (ppm !== undefined) co2.push(ppm);
    } else if (domain === "climate" && heat) {
      const value = climateValue(hass, entity, heat);
      if (value !== undefined) climate.push(value);
    } else if (domain === "binary_sensor" && entity.state === "on") {
      const kind = typeof deviceClass === "string" ? deviceClass : "";
      if (DANGER_CLASSES.has(kind)) raise("danger", kind as AlertReason, id);
      else if (PRESENCE_CLASSES.has(kind)) reading.presence ||= !hidden;
      else if (WINDOW_CLASSES.has(kind) && wet()) raise("warning", "window_rain", id);
    } else if (domain === "alarm_control_panel" && entity.state === "triggered") {
      raise("danger", "alarm", id);
    }
  }
  const value = mean(values) ?? mean(climate);
  if (value !== undefined && heat) reading.value = round(value, DECIMALS[heat]);
  const ppm = mean(co2);
  if (ppm !== undefined && ppm > CO2_WARNING) {
    const sensor = entities.find(({ id, hidden }) => {
      const entity = hass.states[id];
      return !hidden && entity !== undefined && sensorValue(entity, "co2") !== undefined;
    });
    if (sensor) raise("warning", "co2", sensor.id);
  }
  return reading;
}

/** What the layers show for the rooms of the plan. */
export function roomLayers(
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: PlanRoom[],
  choice: LayerChoice,
): RoomLayers {
  const heat = (HEAT_KINDS as readonly string[]).includes(choice.layer)
    ? (choice.layer as HeatKind)
    : undefined;
  const byArea = areaIndex(hass);
  const weather = wetWeather(hass);
  const wet = (): boolean => choice.alerts && weather();
  const values: Record<string, number> = {};
  const alerts: RoomAlert[] = [];
  const presence: string[] = [];
  for (const room of rooms) {
    const area = areaOfRoom(hass, bindings, room);
    const entities = area ? (byArea.get(area) ?? []) : [];
    if (entities.length === 0) continue;
    const reading = readRoom(hass, entities, heat, wet);
    const closed = choice.closed?.has(room.id) === true;
    if (!closed && reading.value !== undefined) values[room.id] = reading.value;
    if (!closed && choice.presence && reading.presence) presence.push(room.id);
    if (choice.alerts && reading.alert && (!closed || reading.alert.level === "danger")) {
      alerts.push({ room: room.id, name: room.name, ...reading.alert });
    }
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
  const json: Record<string, unknown> = {};
  if (heat) {
    json.heat = heat;
    json.values = values;
  }
  const peak = choice.peak;
  if (peak && Object.keys(peak.roles).length > 0) json.peak = peak.roles;
  if (peak && Object.keys(peak.draws).length > 0) json.draws = peak.draws;
  if (alerts.length > 0) json.alerts = Object.fromEntries(alerts.map((a) => [a.room, a.level]));
  if (presence.length > 0) json.presence = presence;
  return { json: JSON.stringify(json), values, alerts, presence };
}

/** A power in watts as people read it: `85 W`, `1.2 kW`. */
export function formatPower(watts: number, language: string): string {
  if (watts >= 1000) {
    const kw = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(watts / 1000);
    return `${kw} kW`;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(watts)} W`;
}

/**
 * A value of a heatmap with its unit: `21.5 °C`, `45 %`, `800 ppm`; temperatures in °F when
 * `fahrenheit` (Home Assistant's unit system).
 */
export function formatHeat(
  value: number,
  unit: string,
  language: string,
  fahrenheit = false,
): string {
  const temperature = unit === "°C";
  const [shown, shownUnit] =
    temperature && fahrenheit ? [(value * 9) / 5 + 32, "°F"] : [value, unit];
  const decimals = temperature ? 1 : 0;
  const text = new Intl.NumberFormat(language, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(shown);
  return `${text} ${shownUnit}`;
}
