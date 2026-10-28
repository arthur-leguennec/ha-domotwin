/**
 * The day one picks for the sandbox (D-057): its date, its weather, who is home and who leaves
 * and comes back when. What it makes happen to the copy: the people and their trackers, the
 * weather's entities, the sun.
 */
import type { HassEntity } from "../ha/types";
import type { Happening, HandCall } from "./engine";
import { sunAt, sunDay, type SunDay } from "./sun";
import { clockOn, isoIn, moment, parseDate, zoned } from "./time";

export const WEATHERS = ["sunny", "cloudy", "rainy", "snowy"] as const;
export type Weather = (typeof WEATHERS)[number];

/** A person's day: home at midnight or not, and when they go out and come back (minutes). */
export interface PersonDay {
  id: string;
  home: boolean;
  leaves?: number;
  back?: number;
}

export interface Scenario {
  /** `YYYY-MM-DD`, in Home Assistant's time zone. */
  date: string;
  weather: Weather;
  /** The day's lowest and highest outdoor temperatures. */
  low: number;
  high: number;
  people: PersonDay[];
  /** What was done by hand in the sandbox, in the day's order. */
  calls: HandCall[];
}

const DAY_MINUTES = 24 * 60;

/** A minute of the day as `HH:MM`. */
export function minuteText(minute: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The weather the scenario starts from: what the home's weather entity says, else sunny. */
function weatherNow(states: Record<string, HassEntity | undefined>): Weather {
  const weather = Object.values(states).find((s) => s?.entity_id.startsWith("weather."));
  const state = weather?.state ?? "";
  if (state.includes("snow")) return "snowy";
  if (state.includes("rain") || state.includes("pour") || state.includes("lightning")) {
    return "rainy";
  }
  if (state.includes("cloud") || state === "fog") return "cloudy";
  return "sunny";
}

/**
 * A first scenario: today, the weather as it is, everyone home at midnight; on a working day
 * each person goes out at half past eight and is back at six.
 */
export function firstScenario(
  states: Record<string, HassEntity | undefined>,
  zone: string,
  now: number,
): Scenario {
  const today = zoned(now, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekend = today.weekday >= 5;
  const people = Object.keys(states)
    .filter((id) => id.startsWith("person."))
    .sort()
    .map((id): PersonDay =>
      weekend ? { id, home: true } : { id, home: true, leaves: 510, back: 1080 },
    );
  const temperature = Number(
    Object.values(states).find((s) => s?.entity_id.startsWith("weather."))?.attributes.temperature,
  );
  const mid = Number.isFinite(temperature) ? Math.round(temperature) : 15;
  return {
    date: `${today.year}-${pad(today.month)}-${pad(today.day)}`,
    weather: weatherNow(states),
    low: mid - 5,
    high: mid + 4,
    people,
    calls: [],
  };
}

/** The day's start and end (ms) for `scenario`, in `zone`. */
export function dayOf(scenario: Scenario, zone: string): { start: number; end: number } {
  const date = parseDate(scenario.date);
  if (!date) throw new Error("bad date");
  const start = moment(zone, date.year, date.month, date.day);
  const end = moment(zone, date.year, date.month, date.day + 1);
  return { start, end };
}

/** What a weather says in Home Assistant, by day and by night. */
function weatherState(weather: Weather, up: boolean): string {
  if (weather === "sunny") return up ? "sunny" : "clear-night";
  if (weather === "cloudy") return "cloudy";
  return weather;
}

/** The outdoor temperature at `minute`: lowest at dawn, highest at three in the afternoon. */
export function temperatureAt(scenario: Scenario, minute: number): number {
  const coldest = 6 * 60;
  const warmest = 15 * 60;
  let phase: number;
  if (minute >= coldest && minute <= warmest) {
    phase = (minute - coldest) / (warmest - coldest);
  } else {
    const since = (minute - warmest + DAY_MINUTES) % DAY_MINUTES;
    phase = 1 - since / (DAY_MINUTES - (warmest - coldest));
  }
  const t = (1 - Math.cos(Math.PI * phase)) / 2;
  return Math.round((scenario.low + (scenario.high - scenario.low) * t) * 10) / 10;
}

/**
 * What the people of the scenario are: their state, their trackers', and the room DomoTwin says
 * they are in (their room sensor: away, or back in the room it said when copied).
 */
function personStates(
  states: Record<string, HassEntity | undefined>,
  copy: Record<string, HassEntity | undefined>,
  person: string,
  home: boolean,
  room = `sensor.domotwin_${person.slice(person.indexOf(".") + 1)}_room`,
): [string, string][] {
  const state = home ? "home" : "not_home";
  const trackers = states[person]?.attributes.device_trackers;
  const ids = Array.isArray(trackers)
    ? trackers.filter((t): t is string => typeof t === "string" && states[t] !== undefined)
    : [];
  const found: [string, string][] = [
    [person, state],
    ...ids.map((id): [string, string] => [id, state]),
  ];
  if (states[room]) {
    const was = copy[room]?.state;
    found.push([room, home ? (was && was !== "not_home" ? was : "unknown") : "not_home"]);
  }
  return found;
}

export interface Prepared {
  /** The states at midnight (the copy's, the scenario's people, weather and sun set). */
  states: Record<string, HassEntity>;
  /** What happens through the day. */
  happenings: Happening[];
}

/**
 * The copy at midnight of the scenario's day, and what the day makes happen: the people going
 * and coming, the weather's temperatures each hour and its night and day, the sun every ten
 * minutes and as it rises and sets.
 */
export function prepare(
  copy: Record<string, HassEntity | undefined>,
  scenario: Scenario,
  zone: string,
  sun: SunDay,
  start: number,
  place?: { latitude: number; longitude: number },
  /** Each person's room sensor, as DomoTwin's people settings name it. */
  rooms: Record<string, string | undefined> = {},
): Prepared {
  const states: Record<string, HassEntity> = {};
  const iso = isoIn(start, zone);
  for (const [id, entity] of Object.entries(copy)) {
    if (entity) states[id] = { ...entity, last_changed: iso, last_updated: iso };
  }
  // The home's automations and scripts at midnight: none running, and none ran yet on the day
  // played (what the home ran later, the day says again).
  for (const [id, entity] of Object.entries(states)) {
    if (!id.startsWith("automation.") && !id.startsWith("script.")) continue;
    const last = entity.attributes.last_triggered;
    const ran = typeof last === "string" ? Date.parse(last) : NaN;
    states[id] = {
      ...entity,
      state: id.startsWith("script.") ? "off" : entity.state,
      attributes: {
        ...entity.attributes,
        ...("last_triggered" in entity.attributes
          ? { last_triggered: ran < start ? last : null }
          : {}),
        ...("current" in entity.attributes ? { current: 0 } : {}),
      },
    };
  }
  const set = (id: string, state: string, attributes?: Record<string, unknown>): void => {
    const entity = states[id];
    if (!entity) return;
    states[id] = { ...entity, state, attributes: attributes ?? entity.attributes };
  };
  const happenings: Happening[] = [];
  // People go by the wall clock; the weather and the sun by the hour and ten minutes gone, so a
  // day the clocks change has each of its hours.
  const minuteAt = (minute: number) => clockOn(start, zone, minute);
  const day = zoned(start, zone);
  const end = moment(zone, day.year, day.month, day.day + 1);
  const clockMinute = (ms: number): number => {
    const read = zoned(ms, zone);
    return read.hour * 60 + read.minute;
  };
  /** Who is home, by person, as the day goes: at midnight, then at each move. */
  const homeAt: { minute: number; person: string; home: boolean }[] = [];
  for (const person of scenario.people) {
    if (!states[person.id]) continue;
    const room = rooms[person.id];
    for (const [id, state] of personStates(states, copy, person.id, person.home, room)) {
      set(id, state);
    }
    homeAt.push({ minute: -1, person: person.id, home: person.home });
    const moves = [
      ...(person.leaves !== undefined ? [{ minute: person.leaves, home: false }] : []),
      ...(person.back !== undefined ? [{ minute: person.back, home: true }] : []),
    ].sort((a, b) => a.minute - b.minute);
    for (const move of moves) {
      for (const [id, state] of personStates(states, copy, person.id, move.home, room)) {
        happenings.push({ at: minuteAt(move.minute), entity: id, state });
      }
      homeAt.push({ minute: move.minute, person: person.id, home: move.home });
    }
  }
  // The home zone counts who is in it, as Home Assistant's zones do (`persons` too): its state
  // follows the people (D-070: "when the last person leaves" is a zone back to 0).
  const home = states["zone.home"];
  if (home && homeAt.length > 0) {
    const within = new Map<string, boolean>();
    const say = (): { state: string; attributes: Record<string, unknown> } => {
      const persons = [...within].filter(([, inside]) => inside).map(([person]) => person);
      return {
        state: String(persons.length),
        attributes: { ...home.attributes, persons: persons.sort() },
      };
    };
    homeAt.sort((a, b) => a.minute - b.minute);
    let k = 0;
    while (k < homeAt.length) {
      const minute = homeAt[k]?.minute ?? 0;
      for (; k < homeAt.length && homeAt[k]?.minute === minute; k += 1) {
        const move = homeAt[k];
        if (move) within.set(move.person, move.home);
      }
      const said = say();
      if (minute < 0) set("zone.home", said.state, said.attributes);
      else happenings.push({ at: minuteAt(minute), entity: "zone.home", ...said });
    }
  }
  // The weather's entities: its state by day and night, its temperature each hour.
  const weathers = Object.keys(states).filter((id) => id.startsWith("weather."));
  const upAt = (ms: number): boolean => {
    if (sun.rising !== undefined && sun.setting !== undefined) {
      return sun.rising < sun.setting
        ? ms >= sun.rising && ms < sun.setting
        : ms >= sun.rising || ms < sun.setting;
    }
    if (sun.rising !== undefined) return ms >= sun.rising;
    if (sun.setting !== undefined) return ms < sun.setting;
    return sun.upAtStart;
  };
  for (const id of weathers) {
    const attributes = (minute: number) => ({
      ...states[id]?.attributes,
      temperature: temperatureAt(scenario, minute),
    });
    set(id, weatherState(scenario.weather, upAt(start)), attributes(0));
    for (let at = start + 3_600_000; at < end; at += 3_600_000) {
      happenings.push({
        at,
        entity: id,
        state: weatherState(scenario.weather, upAt(at)),
        attributes: attributes(clockMinute(at)),
      });
    }
    for (const edge of [sun.rising, sun.setting]) {
      if (edge === undefined) continue;
      happenings.push({
        at: edge,
        entity: id,
        state: weatherState(scenario.weather, upAt(edge)),
        attributes: attributes(clockMinute(edge)),
      });
    }
  }
  // The sun: below or above the horizon, where it is, and what comes next, as `sun.sun` says.
  if (states["sun.sun"]) {
    const after = place
      ? sunDay(end, moment(zone, day.year, day.month, day.day + 2), place.latitude, place.longitude)
      : undefined;
    const HALF_DAY = 12 * 3_600_000;
    const midnight = (of: SunDay | undefined) =>
      of?.noon !== undefined ? of.noon + HALF_DAY : undefined;
    const NEXT = [
      "next_rising",
      "next_setting",
      "next_dawn",
      "next_dusk",
      "next_noon",
      "next_midnight",
    ];
    const attributes = (ms: number): Record<string, unknown> => {
      const copied = states["sun.sun"]?.attributes ?? {};
      if (!place) return { ...copied };
      // The copy's own next times are the home's, not the day's: they are worked out again.
      const found: Record<string, unknown> = Object.fromEntries(
        Object.entries(copied).filter(([key]) => !NEXT.includes(key)),
      );
      const position = sunAt(ms, place.latitude, place.longitude);
      found.elevation = Math.round(position.elevation * 100) / 100;
      found.azimuth = Math.round(position.azimuth * 100) / 100;
      // Today's, until it has passed; then tomorrow's.
      const coming: [string, number | undefined, number | undefined][] = [
        ["next_rising", sun.rising, after?.rising],
        ["next_setting", sun.setting, after?.setting],
        ["next_dawn", sun.dawn, after?.dawn],
        ["next_dusk", sun.dusk, after?.dusk],
        ["next_noon", sun.noon, after?.noon],
        ["next_midnight", midnight(sun), midnight(after)],
      ];
      for (const [key, today, tomorrow] of coming) {
        const at = today !== undefined && today > ms ? today : tomorrow;
        if (at !== undefined) found[key] = isoIn(at, zone);
      }
      // Rising between the solar midnight and noon.
      const noon = sun.noon;
      found.rising =
        noon !== undefined && (ms < noon ? ms >= noon - HALF_DAY : ms >= noon + HALF_DAY);
      return found;
    };
    const state = (ms: number) => (upAt(ms) ? "above_horizon" : "below_horizon");
    set("sun.sun", state(start), attributes(start));
    const times = new Set<number>();
    for (let at = start + 600_000; at < end; at += 600_000) times.add(at);
    for (const edge of [sun.rising, sun.setting, sun.dawn, sun.dusk, sun.noon]) {
      if (edge !== undefined) times.add(edge);
    }
    for (const at of [...times].sort((a, b) => a - b)) {
      happenings.push({ at, entity: "sun.sun", state: state(at), attributes: attributes(at) });
    }
  }
  happenings.sort((a, b) => a.at - b.at);
  return { states, happenings };
}
