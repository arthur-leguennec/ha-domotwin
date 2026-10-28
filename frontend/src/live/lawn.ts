/**
 * The lawns' grass (D-077): as long as it has grown since the lawn was last mown, from the season
 * where the home is. A lawn is mown when someone says so (its room's sheet) or when a robot mower
 * docked on its storey stops mowing; the integration keeps both (`domotwin/garden/get`).
 */

/** When each lawn was last said mown and each robot mower last mowed (ISO times). */
export interface Garden {
  lawns: Record<string, string>;
  mowers: Record<string, string>;
}

/** A lawn as the engine draws it (`setLawns`): its grass (cm), and how fresh its mowing (0–1). */
export interface LawnShown {
  length: number;
  fresh: number;
}

/** How fast grass grows in each month, from January (mm a day), in a temperate climate. */
const GROWTH = [0, 0.5, 1.5, 3, 4, 3.5, 2, 2, 2.5, 1.5, 0.5, 0];
/** How fast it grows in the tropics, all year round (mm a day). */
const TROPICS = 3;
/** The latitude past which a climate has seasons (degrees). */
const TROPIC = 23.5;
/** The grass just mown, and the longest it is drawn (cm). */
export const CUT = 4;
export const LONGEST = 20;
/** How long a mowing's stripes show (hours). */
const STRIPES = 96;
const DAY = 86_400_000;

/**
 * How much grass grows a day (cm) on `day`, at `latitude` (degrees, south below 0; unknown: a
 * northern home).
 */
export function growth(day: Date, latitude?: number): number {
  if (latitude !== undefined && Math.abs(latitude) < TROPIC) return TROPICS / 10;
  // South of the equator, the seasons are the other way round.
  const month = (day.getUTCMonth() + (latitude !== undefined && latitude < 0 ? 6 : 0)) % 12;
  return (GROWTH[month] ?? 0) / 10;
}

/** How long a lawn's grass is (cm) at `now`, mown at `mown`: grown day by day since. */
export function grassLength(mown: Date, now: Date, latitude?: number): number {
  let length = CUT;
  // Day by day, up to the longest drawn (a year at most, so a date far back costs nothing).
  for (let at = mown.getTime(); at < now.getTime() && length < LONGEST; at += DAY) {
    const day = Math.min(DAY, now.getTime() - at);
    length += growth(new Date(at), latitude) * (day / DAY);
    if (at - mown.getTime() > 366 * DAY) break;
  }
  return Math.min(length, LONGEST);
}

/** How fresh a mowing is at `now` (1 just mown, 0 four days on): its stripes fade. */
export function freshness(mown: Date, now: Date): number {
  const hours = (now.getTime() - mown.getTime()) / 3_600_000;
  return Math.min(1, Math.max(0, 1 - hours / STRIPES));
}

/** A time stored, or none when it cannot be read or is ahead of `now` by more than a minute. */
function readTime(text: string | undefined, now: Date): Date | undefined {
  if (!text) return undefined;
  const at = new Date(text);
  const time = at.getTime();
  if (Number.isNaN(time) || time > now.getTime() + 60_000) return undefined;
  return time > now.getTime() ? now : at;
}

/**
 * When a lawn (its room's id) was last mown: when someone said so, or when one of the robot
 * mowers of its storey last stopped mowing (`mowers`: lawn mower entity → the lawns it mows), the
 * later of them; none when neither is known.
 */
export function lastMown(
  room: string,
  garden: Garden | undefined,
  mowers: Readonly<Record<string, readonly string[]>>,
  now: Date,
): Date | undefined {
  if (!garden) return undefined;
  let mown = readTime(garden.lawns[room], now);
  for (const [mower, rooms] of Object.entries(mowers)) {
    if (!rooms.includes(room)) continue;
    const at = readTime(garden.mowers[mower], now);
    if (at && (!mown || at > mown)) mown = at;
  }
  return mown;
}

/**
 * The lawns to draw: each of `lawns` (room ids) as long as it grew since it was last mown
 * (`lastMown`). A lawn whose mowing is not known is left out: the engine draws it with about a
 * week's grass.
 */
export function lawnsShown(
  lawns: readonly string[],
  garden: Garden | undefined,
  mowers: Readonly<Record<string, readonly string[]>>,
  now: Date,
  latitude?: number,
): Record<string, LawnShown> {
  const shown: Record<string, LawnShown> = {};
  for (const room of lawns) {
    const mown = lastMown(room, garden, mowers, now);
    if (!mown) continue;
    shown[room] = {
      length: Math.round(grassLength(mown, now, latitude) * 10) / 10,
      fresh: Math.round(freshness(mown, now) * 100) / 100,
    };
  }
  return shown;
}
