/**
 * The home at a glance, on the Home tab (D-055): who is in, the weather, the lamps on, the doors
 * and windows open, Hydro-Québec's next peak (D-063), read from Home Assistant's states. What a
 * private room holds (D-039) is left out for a viewer who may not see it. The alerts are above
 * every tab since D-068. A workplace (D-086) counts its people, and says whether it is open and,
 * closed, what is left on.
 */
import type { Workplace } from "../ha/client";
import { domainOf, type HomeAssistant } from "../ha/types";
import { NO_BINDINGS, areaOf, type BindingsJson } from "./bindings";
import { numberOf, type PlanRoom } from "./layers";
import { peakRooms, type PeakRooms } from "./peak-rooms";
import { peakNow, type PeakNow } from "./peaks";
import {
  colorOf,
  countedHere,
  initials,
  peopleShown,
  type OnSite,
  type PeopleSettings,
} from "./people";
import { closedAreas, outOfSight } from "./privacy";
import { usualWeather } from "./weather";

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

/** A workplace's hours now (D-086), as its schedule says. */
export interface GlanceHours {
  open: boolean;
  /** When that changes (ISO), when the schedule says. */
  until?: string;
}

/** The home now. */
export interface Glance {
  /** At home, by name; none when the viewer may not see the people (D-034), nor in a workplace. */
  people?: GlancePerson[];
  /** Away. */
  away: number;
  /** In a workplace (D-086): how many are here, named nowhere. */
  here?: number;
  /** A workplace's hours (D-086), when it has a schedule. */
  hours?: GlanceHours;
  /** A workplace closed: what is left on (lamps, doors and windows, locks, media playing). */
  leftOn?: string[];
  weather?: GlanceWeather;
  /** Lamps on (light groups left out: their lamps are counted). */
  lights: string[];
  /** Doors, windows and gates open. */
  openings: string[];
  /** Hydro-Québec's peak (D-063), where an integration reads it, and what the rooms do. */
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
  /** A workplace (D-086). */
  workplace?: Workplace;
  /**
   * One site of several (D-090): `rooms` are its rooms alone, and the closed areas and entities
   * hold the other sites'; `onSite` says whether someone on a storey is on it. `ownHours`: its
   * hours are its own, not the workplace's.
   */
  site?: { onSite: OnSite; ownHours: boolean };
}

/** Contact sensors that say a door or a window is open. */
const OPENING_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
/** Covers that are ways in, not blinds. */
const DOOR_COVERS = new Set(["door", "garage", "gate"]);

/** A lock left open, and media left on, when a workplace closes (D-086). */
const LOCK_OPEN = new Set(["unlocked", "open", "opening", "unlocking"]);
const MEDIA_ON = new Set(["on", "playing", "paused", "buffering"]);

/** A workplace's hours now (D-086): its schedule on while open; nothing while it is not known. */
function hoursOf(hass: HomeAssistant, workplace: Workplace | undefined): GlanceHours | undefined {
  const id = workplace?.hours;
  const state = id ? hass.states[id] : undefined;
  if (state?.state !== "on" && state?.state !== "off") return undefined;
  const next = state.attributes.next_event;
  // When it changes, only as a time that can be read.
  const until = typeof next === "string" && Number.isFinite(Date.parse(next)) ? next : undefined;
  return { open: state.state === "on", ...(until ? { until } : {}) };
}

/** A light that groups others (a light group, a Hue room): its lamps count, not it. */
function groupsLights(hass: HomeAssistant, id: string): boolean {
  const members = hass.states[id]?.attributes.entity_id;
  return Array.isArray(members) && members.length > 0;
}

/** The weather entity to show: `weather.home` if there is one, else the first with a value. */
export function weatherOf(hass: HomeAssistant): GlanceWeather | undefined {
  const id = usualWeather(hass);
  const state = id ? hass.states[id] : undefined;
  if (!id || !state) return undefined;
  const temperature = numberOf(state.attributes.temperature);
  const unit = state.attributes.temperature_unit;
  return {
    entity: id,
    condition: state.state,
    ...(temperature !== undefined ? { temperature } : {}),
    unit: typeof unit === "string" ? unit : (hass.config?.unit_system?.temperature ?? "°C"),
  };
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
  workplace: boolean,
  onSite?: OnSite,
): { people?: GlancePerson[]; away: number; here?: number } {
  if (settings?.shown === "admins" && hass.user?.is_admin !== true) return { away: 0 };
  // A workplace (D-086): how many, named nowhere, as `domotwin.where` counts them.
  if (workplace || settings?.counted === true) {
    return { away: 0, here: countedHere(settings, hass, closed, onSite) };
  }
  if (settings && Object.keys(settings.people).length > 0) {
    const shown = outOfSight(peopleShown(settings, hass), closed);
    return {
      people: shown
        .filter((p) => p.home && (!onSite || onSite(p.storey)))
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
  // Home Assistant's home zone is one place: the first site's (D-090).
  if (onSite && !onSite(undefined)) return { people, away };
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
  // A workplace closed (D-086): the locks open and the media playing are left on too.
  const hours = hoursOf(hass, sources.workplace);
  const closedNow = hours?.open === false;
  const others: string[] = [];
  for (const [id, state] of Object.entries(hass.states)) {
    if (!state) continue;
    const domain = domainOf(id);
    if (closedNow && (domain === "lock" || domain === "media_player")) {
      const on = domain === "lock" ? LOCK_OPEN : MEDIA_ON;
      if (on.has(state.state) && seen(id)) others.push(id);
    } else if (domain === "light") {
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
    ...peopleOf(
      hass,
      sources.people,
      closed,
      sources.workplace !== undefined,
      sources.site?.onSite,
    ),
    lights: lights.sort(),
    openings: openings.sort(),
  };
  if (hours) {
    glance.hours = hours;
    if (closedNow) glance.leftOn = [...glance.lights, ...glance.openings, ...others.sort()];
  }
  const weather = weatherOf(hass);
  if (weather) glance.weather = weather;
  const now = peakNow(hass);
  if (now) {
    const rooms = peakRooms(hass, bindings, sources.rooms, now.phase, closed, sources.meters, {
      areas,
      ...(closedEntities ? { entities: closedEntities } : {}),
    });
    glance.peak = { now, rooms };
  }
  return glance;
}
