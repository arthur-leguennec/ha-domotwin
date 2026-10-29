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
  const centres = new Map<string, Point>();
  for (const room of rooms as { id?: unknown; outline?: unknown; outside?: unknown }[]) {
    if (typeof room.id !== "string" || room.outside === true || !Array.isArray(room.outline)) {
      continue;
    }
    const corners = room.outline.map(point).filter((p): p is Point => p !== undefined);
    if (corners.length < 3) continue;
    const sum = corners.reduce<Point>((s, [x, y]) => [s[0] + x, s[1] + y], [0, 0]);
    centres.set(room.id, [sum[0] / corners.length, sum[1] / corners.length]);
  }
  const sunny = new Set<string>();
  for (const window of windows as { from?: unknown; to?: unknown; room?: unknown }[]) {
    const from = point(window.from);
    const to = point(window.to);
    const centre = typeof window.room === "string" ? centres.get(window.room) : undefined;
    if (!from || !to || !centre || typeof window.room !== "string") continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    // The window's normal, turned to face out of its room.
    let normal: Point = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
    const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (normal[0] * (middle[0] - centre[0]) + normal[1] * (middle[1] - centre[1]) < 0) {
      normal = [-normal[0], -normal[1]];
    }
    if (normal[0] * towards[0] + normal[1] * towards[1] > FACING) sunny.add(window.room);
  }
  return [...centres.keys()].filter((id) => sunny.has(id));
}
