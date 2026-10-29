/**
 * The sun over the sandbox's day (D-057): where it is from the home's latitude and longitude,
 * and when it rises and sets, to the second, as Home Assistant's `sun` sees it (the sun's upper
 * edge at the horizon, refraction included: −0.833°).
 */

const RAD = Math.PI / 180;
/** The sun's centre when its upper edge is at the horizon, refraction included. */
const HORIZON = -0.833;

export interface SunPosition {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees from north, clockwise. */
  azimuth: number;
}

/** The sun at `ms` seen from `latitude`, `longitude` (degrees, east positive). */
export function sunAt(ms: number, latitude: number, longitude: number): SunPosition {
  // Days from J2000.0, and the sun's ecliptic place (the Astronomical Almanac's low-precision
  // formulas, within a hundredth of a degree for centuries around now).
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const hour = (gmst * 15 + longitude) * RAD - ra;
  const lat = latitude * RAD;
  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour),
  );
  const azimuth = Math.atan2(
    -Math.sin(hour) * Math.cos(dec),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hour),
  );
  return {
    elevation: elevation / RAD,
    azimuth: (((azimuth / RAD) % 360) + 360) % 360,
  };
}

export interface SunDay {
  /** When the sun rises and sets within the day, if it does (none in a polar day or night). */
  rising?: number;
  setting?: number;
  /** Whether the sun is up when the day starts. */
  upAtStart: boolean;
  /** Dawn and dusk (the sun 6° below the horizon), and the sun at its highest. */
  dawn?: number;
  dusk?: number;
  noon?: number;
}

/** When the sun's centre goes above and below `horizon` (degrees) between `start` and `end`. */
function crossings(
  start: number,
  end: number,
  elevation: (ms: number) => number,
  horizon: number,
): { up?: number; down?: number; upAtStart: boolean } {
  const above = (ms: number): boolean => elevation(ms) > horizon;
  const step = 10 * 60_000;
  const found: { up?: number; down?: number; upAtStart: boolean } = { upAtStart: above(start) };
  let before = found.upAtStart;
  for (let t = start + step; t <= end + step; t += step) {
    const at = Math.min(t, end);
    const now = above(at);
    if (now !== before) {
      // To the second, between the two samples.
      let low = at - step;
      let high = at;
      while (high - low > 1000) {
        const mid = (low + high) / 2;
        if (above(mid) === before) low = mid;
        else high = mid;
      }
      const when = Math.round(high / 1000) * 1000;
      if (now) found.up ??= when;
      else found.down ??= when;
      before = now;
    }
    if (at === end) break;
  }
  return found;
}

/** When the sun rises and sets between `start` and `end` (ms), its dawn, dusk and noon. */
export function sunDay(start: number, end: number, latitude: number, longitude: number): SunDay {
  return sunDayOf(start, end, (ms) => sunAt(ms, latitude, longitude).elevation);
}

/**
 * When a sun rises and sets between `start` and `end` (ms), its dawn, dusk and noon, from how high
 * it is at each moment (degrees): the sun of a place on Earth, or the demo house's (D-093).
 */
export function sunDayOf(start: number, end: number, elevation: (ms: number) => number): SunDay {
  const sun = crossings(start, end, elevation, HORIZON);
  const twilight = crossings(start, end, elevation, -6);
  // The sun at its highest: the best of each ten minutes, then to the second.
  let noon = start;
  for (let t = start; t <= end; t += 10 * 60_000) if (elevation(t) > elevation(noon)) noon = t;
  let low = Math.max(start, noon - 10 * 60_000);
  let high = Math.min(end, noon + 10 * 60_000);
  while (high - low > 1000) {
    const a = low + (high - low) / 3;
    const b = high - (high - low) / 3;
    if (elevation(a) < elevation(b)) low = a;
    else high = b;
  }
  return {
    upAtStart: sun.upAtStart,
    ...(sun.up !== undefined ? { rising: sun.up } : {}),
    ...(sun.down !== undefined ? { setting: sun.down } : {}),
    ...(twilight.up !== undefined ? { dawn: twilight.up } : {}),
    ...(twilight.down !== undefined ? { dusk: twilight.down } : {}),
    noon: Math.round((low + high) / 2000) * 1000,
  };
}
