/**
 * The home at a glance, on the Home tab (D-055): who is in, the weather, the alerts, the lamps on,
 * the doors and windows open, Hydro-Québec's next peak (D-057), read from Home Assistant's states.
 * What a private room holds (D-039) is left out for a viewer who may not see it, its dangers
 * aside, as the layers do.
 */
import { domainOf, type HomeAssistant } from "../ha/types";
import { NO_BINDINGS, areaOf, type BindingsJson } from "./bindings";
import { roomLayers, numberOf, type PlanRoom, type RoomAlert } from "./layers";
import { peakRooms, type PeakRooms } from "./peak-rooms";
import { peakNow, type PeakNow } from "./peaks";
import { colorOf, initials, peopleShown, type PeopleSettings } from "./people";
import { closedAreas, outOfSight } from "./privacy";

/** Someone at home, as the glance shows them. */
export interface GlancePerson {
  id: string;
  name: string;
  initials: string;
  color: string;
  picture?: string;
  /** The room they are in, when it may be said. */
  roomName?: string;
}

/** The weather outside, from a `weather` entity. */
export interface GlanceWeather {
  entity: string;
  condition: string;
  temperature?: number;
  unit: string;
}

/** The home now. */
export interface Glance {
  /** At home, by name; none when the viewer may not see the people (D-034). */
  people?: GlancePerson[];
  /** Away. */
  away: number;
  weather?: GlanceWeather;
  /** Dangers first. */
  alerts: RoomAlert[];
  /** Lamps on (light groups left out: their lamps are counted). */
  lights: string[];
  /** Doors, windows and gates open. */
  openings: string[];
  /** Hydro-Québec's peak (D-057), where an integration reads it, and what the rooms do. */
  peak?: { now: PeakNow; rooms: PeakRooms };
}

/** What the glance reads beyond the states. */
export interface GlanceSources {
  people?: PeopleSettings;
  /** The rooms of every storey. */
  rooms: PlanRoom[];
  bindings?: BindingsJson;
  /** Private rooms the viewer may not see (room ids). */
  closed: Set<string>;
  /** The entities linked to pieces in those rooms, whatever their area. */
  closedEntities?: ReadonlySet<string>;
  /** Their areas, when they were found already. */
  closedAreas?: ReadonlySet<string>;
  /** The home's own meters (its energy settings, D-049): not a room's draw. */
  meters?: ReadonlySet<string>;
}

/** Contact sensors that say a door or a window is open. */
const OPENING_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
/** Covers that are ways in, not blinds. */
const DOOR_COVERS = new Set(["door", "garage", "gate"]);

/** A light that groups others (a light group, a Hue room): its lamps count, not it. */
function groupsLights(hass: HomeAssistant, id: string): boolean {
  const members = hass.states[id]?.attributes.entity_id;
  return Array.isArray(members) && members.length > 0;
}

/** The weather entity to show: `weather.home` if there is one, else the first with a value. */
export function weatherOf(hass: HomeAssistant): GlanceWeather | undefined {
  const ids = Object.keys(hass.states)
    .filter((id) => domainOf(id) === "weather")
    .sort((a, b) => (a === "weather.home" ? -1 : b === "weather.home" ? 1 : a.localeCompare(b)));
  for (const id of ids) {
    const state = hass.states[id];
    if (!state || state.state === "unavailable" || state.state === "unknown") continue;
    const temperature = numberOf(state.attributes.temperature);
    const unit = state.attributes.temperature_unit;
    return {
      entity: id,
      condition: state.state,
      ...(temperature !== undefined ? { temperature } : {}),
      unit: typeof unit === "string" ? unit : (hass.config?.unit_system?.temperature ?? "°C"),
    };
  }
  return undefined;
}

/**
 * The people at home, and how many are away: DomoTwin's people when some are placed (D-034), else
 * every person of Home Assistant but those who hid themselves; nobody for a viewer DomoTwin's
 * people are not shown to.
 */
function peopleOf(
  hass: HomeAssistant,
  settings: PeopleSettings | undefined,
  closed: Set<string>,
): { people?: GlancePerson[]; away: number } {
  if (settings?.shown === "admins" && hass.user?.is_admin !== true) return { away: 0 };
  if (settings && Object.keys(settings.people).length > 0) {
    const shown = outOfSight(peopleShown(settings, hass), closed);
    return {
      people: shown
        .filter((p) => p.home)
        .map((p) => ({
          id: p.id,
          name: p.name,
          initials: p.initials,
          color: p.color,
          ...(p.picture ? { picture: p.picture } : {}),
          ...(p.roomName ? { roomName: p.roomName } : {}),
        })),
      away: shown.filter((p) => !p.home).length,
    };
  }
  const people: GlancePerson[] = [];
  let away = 0;
  const hidden = new Set(settings?.hidden ?? []);
  for (const id of Object.keys(hass.states)
    .filter((id) => domainOf(id) === "person")
    .sort()) {
    const state = hass.states[id];
    if (!state || hidden.has(id)) continue;
    if (state.state !== "home") {
      away += 1;
      continue;
    }
    const name =
      typeof state.attributes.friendly_name === "string"
        ? state.attributes.friendly_name
        : id.slice(id.indexOf(".") + 1);
    people.push({ id, name, initials: initials(name), color: colorOf(id) });
  }
  return { people: people.sort((a, b) => a.name.localeCompare(b.name)), away };
}

/** The home at a glance now. */
export function glanceOf(hass: HomeAssistant, sources: GlanceSources): Glance {
  const { closed, closedEntities } = sources;
  const bindings = sources.bindings ?? NO_BINDINGS;
  // What is in a private room the viewer may not see stays there.
  const areas = sources.closedAreas ?? closedAreas(hass, bindings, sources.rooms, closed);
  const seen = (id: string): boolean => {
    if (hass.entities?.[id]?.hidden === true || closedEntities?.has(id) === true) return false;
    const area = areas.size > 0 ? areaOf(hass, id) : undefined;
    return area === undefined || !areas.has(area);
  };
  const lights: string[] = [];
  const openings: string[] = [];
  for (const [id, state] of Object.entries(hass.states)) {
    if (!state) continue;
    const domain = domainOf(id);
    if (domain === "light") {
      if (state.state === "on" && !groupsLights(hass, id) && seen(id)) lights.push(id);
    } else if (domain === "binary_sensor") {
      const deviceClass = state.attributes.device_class;
      const open = state.state === "on" && typeof deviceClass === "string";
      if (open && OPENING_CLASSES.has(deviceClass) && seen(id)) openings.push(id);
    } else if (domain === "cover") {
      const deviceClass = state.attributes.device_class;
      const open = state.state === "open" || state.state === "opening";
      if (open && typeof deviceClass === "string" && DOOR_COVERS.has(deviceClass) && seen(id)) {
        openings.push(id);
      }
    }
  }
  const glance: Glance = {
    ...peopleOf(hass, sources.people, closed),
    alerts: roomLayers(hass, bindings, sources.rooms, {
      layer: "off",
      alerts: true,
      presence: false,
      closed,
    }).alerts,
    lights: lights.sort(),
    openings: openings.sort(),
  };
  const weather = weatherOf(hass);
  if (weather) glance.weather = weather;
  const now = peakNow(hass);
  if (now) {
    const rooms = peakRooms(hass, bindings, sources.rooms, now.phase, closed, sources.meters);
    glance.peak = { now, rooms };
  }
  return glance;
}
