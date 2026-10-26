/**
 * Time for the sandbox (D-057): its day runs on Home Assistant's clock, in Home Assistant's time
 * zone, whatever this device's is.
 */

/** A moment's wall clock in a time zone. */
export interface Zoned {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 for Monday to 6 for Sunday, as Python's `weekday()`. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formats = new Map<string, Intl.DateTimeFormat>();

function format(zone: string): Intl.DateTimeFormat {
  let found = formats.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formats.set(zone, found);
  }
  return found;
}

/** A time zone that can be used: `zone`, else UTC. */
export function usableZone(zone: string | undefined): string {
  if (!zone) return "UTC";
  try {
    format(zone);
    return zone;
  } catch {
    return "UTC";
  }
}

/** The wall clock of `ms` in `zone`, read through `Intl` (slow: see `zoned`). */
function readZoned(ms: number, zone: string): Zoned {
  const parts: Record<string, string> = {};
  for (const part of format(zone).formatToParts(new Date(ms))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? "Mon"] ?? 0,
  };
}

/** A zone's offsets from UTC (ms), by quarter of an hour: zones change on quarter-hours. */
const offsets = new Map<string, Map<number, number>>();
const QUARTER = 900_000;

function offsetAt(ms: number, zone: string): number {
  let byZone = offsets.get(zone);
  if (!byZone || byZone.size > 20_000) {
    byZone = new Map();
    offsets.set(zone, byZone);
  }
  const quarter = Math.floor(ms / QUARTER);
  let offset = byZone.get(quarter);
  if (offset === undefined) {
    const at = quarter * QUARTER;
    const read = readZoned(at, zone);
    offset =
      Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute, read.second) - at;
    byZone.set(quarter, offset);
  }
  return offset;
}

/** The wall clock of `ms` in `zone`. */
export function zoned(ms: number, zone: string): Zoned {
  const local = new Date(ms + offsetAt(ms, zone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: (local.getUTCDay() + 6) % 7,
  };
}

/**
 * The moment the wall clock reads `minute` (of the day, `HH*60+MM`) on the day starting at
 * `dayStart` in `zone`: on a day the clocks change, not `dayStart` plus that many minutes.
 */
export function clockOn(dayStart: number, zone: string, minute: number, second = 0): number {
  const day = zoned(dayStart, zone);
  return moment(zone, day.year, day.month, day.day, Math.floor(minute / 60), minute % 60, second);
}

/** The moment a wall clock in `zone` reads `year-month-day hour:minute:second`. */
export function moment(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wanted;
  // Twice: the zone's offset may differ on either side of a change of time.
  for (let k = 0; k < 2; k += 1) {
    const read = zoned(guess, zone);
    const shown = Date.UTC(
      read.year,
      read.month - 1,
      read.day,
      read.hour,
      read.minute,
      read.second,
    );
    guess += wanted - shown;
  }
  return guess;
}

/** A date written `YYYY-MM-DD`, or `undefined`. */
export function parseDate(text: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

/**
 * A moment written as Home Assistant writes one (`2026-06-15 07:00:00`, `2026-06-15T07:00:00+02:00`,
 * `2026-06-15`): one without its offset is a wall clock in `zone`, as Home Assistant reads it, not
 * the device's.
 */
export function parseMoment(text: string, zone: string): number | undefined {
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(
    text.trim(),
  );
  if (naive) {
    const date = parseDate(`${naive[1]}-${naive[2]}-${naive[3]}`);
    if (!date) return undefined;
    const [hour, minute, second] = [naive[4], naive[5], naive[6]].map((n) => Number(n ?? 0));
    return moment(zone, date.year, date.month, date.day, hour, minute, second);
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text.trim())) return undefined;
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : undefined;
}

/** A time of day written `HH:MM` or `HH:MM:SS`, in seconds, or `undefined`. */
export function parseClock(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return hour * 3600 + minute * 60 + second;
}

/**
 * A duration as Home Assistant writes one (`HH:MM:SS`, `HH:MM`, seconds, or `{hours, minutes,
 * seconds, milliseconds, days}`), in milliseconds, or `undefined`.
 */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 1000;
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1000;
    const match = /^(-)?(\d+):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?$/.exec(text);
    if (!match) return undefined;
    const ms =
      (Number(match[2]) * 3600 +
        Number(match[3]) * 60 +
        Number(match[4] ?? 0) +
        Number(`0.${match[5] ?? 0}`)) *
      1000;
    return match[1] ? -ms : ms;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const parts = value as Record<string, unknown>;
    const keys = ["days", "hours", "minutes", "seconds", "milliseconds"];
    if (!Object.keys(parts).every((key) => keys.includes(key))) return undefined;
    const n = (key: string): number | undefined => {
      const part = parts[key];
      if (part === undefined) return 0;
      return typeof part === "number" && Number.isFinite(part) ? part : undefined;
    };
    const [days, hours, minutes, seconds, ms] = keys.map(n);
    if ([days, hours, minutes, seconds, ms].some((part) => part === undefined)) return undefined;
    return (
      ((days ?? 0) * 86_400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000 +
      (ms ?? 0)
    );
  }
  return undefined;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** `ms` as Home Assistant writes a time: ISO with the zone's offset. */
export function isoIn(ms: number, zone: string): string {
  const read = zoned(ms, zone);
  const offset = Math.round(
    (Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute, read.second) -
      Math.floor(ms / 1000) * 1000) /
      60_000,
  );
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${read.year}-${pad(read.month)}-${pad(read.day)}T${pad(read.hour)}:${pad(read.minute)}:` +
    `${pad(read.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The time of day of `ms` in `zone`, `HH:MM`. */
export function clockOf(ms: number, zone: string): string {
  const read = zoned(ms, zone);
  return `${pad(read.hour)}:${pad(read.minute)}`;
}
