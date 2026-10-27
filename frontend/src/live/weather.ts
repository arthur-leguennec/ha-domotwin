/**
 * The weather drawn around the home (`docs/DECISIONS.md`, D-072): read from a `weather` entity of
 * Home Assistant, the one chosen in the settings, else the one the Home tab shows. What falls, the
 * clouds and the storm are the engine's to draw; this reads what it needs.
 */
import { domainOf, type HomeAssistant } from "../ha/types";

/** The settings' choice: an entity, `none` (no weather drawn), or nothing (the usual one). */
export type WeatherChoice = string | undefined;

/** What the engine draws: Home Assistant's condition, the wind in m/s and where it comes from
 * (degrees clockwise from north; `NaN` when unknown). */
export interface WeatherShown {
  entity: string;
  condition: string;
  windSpeed: number;
  windBearing: number;
}

/** Metres per second in one of Home Assistant's wind speed units. */
const TO_METRES_PER_SECOND: Record<string, number> = {
  "m/s": 1,
  "km/h": 1 / 3.6,
  mph: 0.44704,
  kn: 0.514444,
  "ft/s": 0.3048,
};

/** The sixteen points of the compass, clockwise from north, as some integrations give a bearing. */
const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

/** A wind bearing in degrees: a number, or a point of the compass; `NaN` when unknown. */
export function bearingOf(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? ((value % 360) + 360) % 360 : NaN;
  if (typeof value !== "string" || value.trim() === "") return NaN;
  const number = Number(value);
  if (Number.isFinite(number)) return ((number % 360) + 360) % 360;
  const point = COMPASS.indexOf(value.trim().toUpperCase());
  return point < 0 ? NaN : point * 22.5;
}

/** A wind speed in m/s from a value and its unit (km/h when none is said); `NaN` when unknown. */
export function windSpeedOf(value: unknown, unit: unknown): number {
  const speed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(speed) || speed < 0) return NaN;
  // The Beaufort scale's numbers grow faster than the wind: v = 0.836 × B^1.5 m/s.
  if (unit === "Beaufort") return 0.836 * speed ** 1.5;
  const factor = TO_METRES_PER_SECOND[typeof unit === "string" ? unit : "km/h"];
  return factor === undefined ? NaN : speed * factor;
}

/**
 * The weather to draw: the chosen entity's (`none`: no weather), else the usual one (`weather.home`
 * first); `undefined` when there is none, or it says nothing now.
 */
export function weatherShown(
  hass: HomeAssistant | undefined,
  choice: WeatherChoice,
): WeatherShown | undefined {
  if (!hass || choice === "none") return undefined;
  const entity = choice ?? usualWeather(hass);
  const state = entity ? hass.states[entity] : undefined;
  if (!entity || !state || silent(state)) return undefined;
  const attributes = state.attributes;
  return {
    entity,
    condition: state.state,
    windSpeed: windSpeedOf(attributes.wind_speed, attributes.wind_speed_unit),
    windBearing: bearingOf(attributes.wind_bearing),
  };
}

/** Whether a weather entity says nothing now. */
function silent(state: { state: string } | undefined): boolean {
  return !state || state.state === "unavailable" || state.state === "unknown";
}

/** The usual weather entity of each set of states, worked out once (`null`: none). */
const usual = new WeakMap<object, string | null>();

/** The usual weather entity (the one the Home tab shows): `weather.home` if it says something,
 * else the first that does. */
export function usualWeather(hass: HomeAssistant): string | undefined {
  if (!silent(hass.states["weather.home"])) return "weather.home";
  let id = usual.get(hass.states);
  if (id === undefined) {
    id = weatherEntities(hass).find((entity) => !silent(hass.states[entity])) ?? null;
    usual.set(hass.states, id);
  }
  return id ?? undefined;
}

/** The `weather` entities to choose from, sorted by name. */
export function weatherEntities(hass: HomeAssistant | undefined): string[] {
  if (!hass) return [];
  return Object.keys(hass.states)
    .filter((id) => domainOf(id) === "weather")
    .sort((a, b) => a.localeCompare(b));
}
