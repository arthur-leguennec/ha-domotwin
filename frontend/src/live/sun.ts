/**
 * The sun through the windows (D-023): the rooms it shines into now, from where it is (`sun.sun`'s
 * azimuth and elevation) and where north is on the plan, by the windows whose outside faces it.
 */
import type { HomeAssistant } from "../ha/types";

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

/**
 * The rooms of a plan the sun shines into now, by id, in the plan's order: those with a window
 * whose outside faces the sun while it is up. `north`: where north points on the plan, in degrees
 * clockwise from its top (the settings' north, as the engine lights it).
 */
export function sunnyRooms(plan: unknown, sun: SunNow, north: number): string[] {
  if (sun.elevation <= 0 || typeof plan !== "object" || plan === null) return [];
  const { rooms, windows } = plan as { rooms?: unknown; windows?: unknown };
  if (!Array.isArray(rooms) || !Array.isArray(windows)) return [];
  // Towards the sun on the plan: its top is north turned by `north`, y going down.
  const heading = (((Number.isFinite(north) ? north : 0) + sun.azimuth) * Math.PI) / 180;
  const towards: Point = [Math.sin(heading), -Math.cos(heading)];
  const outlines = new Map<string, Point[]>();
  for (const room of rooms as { id?: unknown; outline?: unknown; outside?: unknown }[]) {
    if (typeof room.id !== "string" || room.outside === true || !Array.isArray(room.outline)) {
      continue;
    }
    const corners = room.outline.map(point).filter((p): p is Point => p !== undefined);
    if (corners.length >= 3) outlines.set(room.id, corners);
  }
  const sunny = new Set<string>();
  for (const window of windows as { from?: unknown; to?: unknown; room?: unknown }[]) {
    const from = point(window.from);
    const to = point(window.to);
    const corners = typeof window.room === "string" ? outlines.get(window.room) : undefined;
    if (!from || !to || !corners || typeof window.room !== "string") continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    // The window's normal, turned to face out of its room: the room is on the other side (an
    // L-shaped room's middle may be outside it, so the side is looked at, not the middle).
    let normal: Point = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
    const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (inside([middle[0] + normal[0] * STEP, middle[1] + normal[1] * STEP], corners)) {
      normal = [-normal[0], -normal[1]];
    }
    if (normal[0] * towards[0] + normal[1] * towards[1] > FACING) sunny.add(window.room);
  }
  return [...outlines.keys()].filter((id) => sunny.has(id));
}
