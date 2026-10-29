/**
 * The sun through the windows (D-023): the rooms it shines into now, from where it is (`sun.sun`'s
 * azimuth and elevation) and where north is on the plan, by the windows whose outside faces it;
 * and at any hour of the day, from where the home is, with each room's hours of sun (D-093).
 */
import type { HomeAssistant } from "../ha/types";
import { sunAt, sunDayOf } from "../sandbox/sun";

/** Where the sun is now: degrees clockwise from north, degrees above the horizon. */
export interface SunNow {
  azimuth: number;
  elevation: number;
}

/** Where `sun.sun` says the sun is; nothing when it says no position. */
export function sunNow(hass: HomeAssistant | undefined): SunNow | undefined {
  const sun = hass?.states["sun.sun"];
  const azimuth = Number(sun?.attributes.azimuth);
  const elevation = Number(sun?.attributes.elevation);
  return Number.isFinite(azimuth) && Number.isFinite(elevation)
    ? { azimuth, elevation }
    : undefined;
}

/** How the sun goes over the home (D-093): where it is at any moment. */
export interface SunModel {
  at(time: number): SunNow;
  /** What it is worked out from, to know when it changed. */
  key: string;
  /**
   * Where the home is, north positive: the sun of a place on Earth, whose days change with the
   * seasons; none for the demo house's sun, which has one day.
   */
  latitude?: number;
  /**
   * How high its centre is when it rises and sets (degrees): the demo house's at the horizon,
   * else Home Assistant's (its upper edge, refraction included).
   */
  horizon?: number;
}

/**
 * The sun over the home: the demo house's own (D-050), else the sun where Home Assistant says the
 * home is; nothing when it does not say.
 */
export function sunModel(hass: HomeAssistant | undefined): SunModel | undefined {
  const own = hass?.sunAt;
  if (own) return { at: own, key: "own", horizon: 0 };
  const latitude = hass?.config?.latitude;
  const longitude = hass?.config?.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90
  ) {
    return undefined;
  }
  return {
    at: (time) => sunAt(time, latitude, longitude),
    key: `${latitude},${longitude}`,
    latitude,
  };
}

/**
 * When the sun rises between `start` and `end` (ms), and sets after it (past midnight, near the
 * poles in summer); when it does.
 */
export function sunTimes(
  model: SunModel,
  start: number,
  end: number,
): { rise?: number; set?: number } {
  const elevation = (time: number): number => model.at(time).elevation;
  const day = sunDayOf(start, end, elevation, model.horizon);
  let set = day.setting;
  if (day.rising !== undefined && set !== undefined && set < day.rising) {
    set = sunDayOf(day.rising, day.rising + 86_400_000, elevation, model.horizon).setting;
  }
  return {
    ...(day.rising !== undefined ? { rise: day.rising } : {}),
    ...(set !== undefined ? { set } : {}),
  };
}

type Point = [number, number];

function point(value: unknown): Point | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [x, y] = value as unknown[];
  return typeof x === "number" && typeof y === "number" ? [x, y] : undefined;
}

/** The sun's light enters a window facing it within this (the cosine of 75°). */
const FACING = Math.cos((75 * Math.PI) / 180);
/** How far off a window (cm) its room is looked for, to know which side is out. */
const STEP = 5;
/** How often the sun is looked at to count a room's hours of sun (ms). */
const SAMPLE = 10 * 60_000;

/** Whether `p` is inside the polygon `corners` (even-odd). */
function inside([x, y]: Point, corners: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const [xi, yi] = corners[i] as Point;
    const [xj, yj] = corners[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** The rooms of a plan (outside ones left out), and which way each window looks out of its room. */
interface Openings {
  rooms: string[];
  windows: { room: string; out: Point }[];
}

/** The openings of each plan read, once. */
const openings = new WeakMap<object, Openings>();

function openingsOf(plan: unknown): Openings | undefined {
  if (typeof plan !== "object" || plan === null) return undefined;
  const known = openings.get(plan);
  if (known) return known;
  const { rooms, windows } = plan as { rooms?: unknown; windows?: unknown };
  const outlines = new Map<string, Point[]>();
  for (const room of Array.isArray(rooms)
    ? (rooms as { id?: unknown; outline?: unknown; outside?: unknown }[])
    : []) {
    if (typeof room.id !== "string" || room.outside === true || !Array.isArray(room.outline)) {
      continue;
    }
    const corners = room.outline.map(point).filter((p): p is Point => p !== undefined);
    if (corners.length >= 3) outlines.set(room.id, corners);
  }
  const found: Openings = { rooms: [...outlines.keys()], windows: [] };
  for (const window of Array.isArray(windows)
    ? (windows as { from?: unknown; to?: unknown; room?: unknown }[])
    : []) {
    const from = point(window.from);
    const to = point(window.to);
    const room = typeof window.room === "string" ? window.room : undefined;
    const corners = room === undefined ? undefined : outlines.get(room);
    if (!from || !to || !corners || room === undefined) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    // The window's normal, turned to face out of its room: the room is on the other side (an
    // L-shaped room's middle may be outside it, so the side is looked at, not the middle).
    let out: Point = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
    const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (inside([middle[0] + out[0] * STEP, middle[1] + out[1] * STEP], corners)) {
      out = [-out[0], -out[1]];
    }
    found.windows.push({ room, out });
  }
  openings.set(plan, found);
  return found;
}

/** The rooms with a window facing the sun (up or not). */
function facing(found: Openings, sun: SunNow, north: number): Set<string> {
  // Towards the sun on the plan: its top is north turned by `north`, y going down.
  const heading = (((Number.isFinite(north) ? north : 0) + sun.azimuth) * Math.PI) / 180;
  const towards: Point = [Math.sin(heading), -Math.cos(heading)];
  const sunny = new Set<string>();
  for (const { room, out } of found.windows) {
    if (out[0] * towards[0] + out[1] * towards[1] > FACING) sunny.add(room);
  }
  return sunny;
}

/**
 * The rooms of a plan the sun shines into now, by id, in the plan's order: those with a window
 * whose outside faces the sun while it is up. `north`: where north points on the plan, in degrees
 * clockwise from its top (the settings' north, as the engine lights it).
 */
export function sunnyRooms(plan: unknown, sun: SunNow, north: number): string[] {
  if (sun.elevation <= 0) return [];
  const found = openingsOf(plan);
  if (!found) return [];
  const sunny = facing(found, sun, north);
  return found.rooms.filter((id) => sunny.has(id));
}

/** Whether some room of these plans has a window: the sun has a way in. */
export function hasWindows(plans: readonly unknown[]): boolean {
  return plans.some((plan) => (openingsOf(plan)?.windows.length ?? 0) > 0);
}

/**
 * Each room's hours of direct sun through its windows between `start` and `end` (ms), to the tenth
 * of an hour (D-093): every room of the plans, 0 for one the sun never comes into. The sun is
 * looked at every ten minutes.
 */
export function sunshineHours(
  plans: readonly unknown[],
  model: SunModel,
  north: number,
  start: number,
  end: number,
): Record<string, number> {
  const all = plans.map(openingsOf).filter((found): found is Openings => found !== undefined);
  const minutes = new Map<string, number>();
  for (const found of all) for (const room of found.rooms) minutes.set(room, 0);
  for (let time = start + SAMPLE / 2; time < end; time += SAMPLE) {
    const sun = model.at(time);
    if (sun.elevation <= 0) continue;
    for (const found of all) {
      for (const room of facing(found, sun, north)) {
        minutes.set(room, (minutes.get(room) ?? 0) + SAMPLE / 60_000);
      }
    }
  }
  return Object.fromEntries(
    [...minutes].map(([room, count]) => [room, Math.round(count / 6) / 10]),
  );
}
