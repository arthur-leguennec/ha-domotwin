/**
 * The wall clock where the home is: an instant read on its time zone's clock, and the instant a
 * time on that clock is, on the days the clocks change too (the Energy tab's today, D-092; the
 * sun at an hour of the day, D-093).
 */

const DAY = 86_400_000;

/**
 * The wall clock of `zone` at `time` (ms), read as if it were UTC; this device's zone when `zone`
 * is not known.
 */
export function wallTime(time: number, zone: string | undefined): number {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }).formatToParts(time);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(time);
  }
  const part = (type: string): number =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
}

/** How far the zone's clock is ahead of UTC at `time` (ms). */
function offsetAt(time: number, zone: string | undefined): number {
  const at = Math.floor(time / 1000) * 1000;
  return wallTime(at, zone) - at;
}

/**
 * The instant (ms) the clock of `zone` reads `wall` (a wall time read as if it were UTC): its
 * offset then, found from a first guess and checked once moved by it (the clocks changed between).
 */
export function atWall(wall: number, zone: string | undefined): number {
  const guess = wall - offsetAt(wall, zone);
  return wall - offsetAt(guess, zone);
}

/** The midnight that starts the day of `time` where the home is (ms). */
export function startOfDay(time: number, zone: string | undefined): number {
  return atMinute(time, 0, zone);
}

/**
 * The instant the clock of `zone` reads `minute` minutes past the midnight that starts the day of
 * `time` (24 hours past it: the next midnight).
 */
export function atMinute(time: number, minute: number, zone: string | undefined): number {
  return atWall(Math.floor(wallTime(time, zone) / DAY) * DAY + minute * 60_000, zone);
}

/** The minutes past midnight the clock of `zone` reads at `time`. */
export function minuteOfDay(time: number, zone: string | undefined): number {
  return Math.floor((wallTime(time, zone) % DAY) / 60_000);
}
