/**
 * When one is back, asked as a shortcut leaving home runs (D-091): not known, in a while, at a
 * time, on a day. The usual time of return comes first when it is filled in (within a day), or a
 * workplace's next opening; else "not known". The heating the shortcut turned down is brought
 * back as it was a little before: actions the integration keeps (D-046), done even if no screen is
 * open.
 */
import type { NewSchedule } from "../ha/client";
import { todayIn } from "./upkeep";
import { BACK_AHEAD, MAX_BACK_AHEAD, TIME, type Back, type Shortcut } from "./shortcut-model";
import type { Call } from "./shortcuts";
import { MAX_SCHEDULE_ENTITIES } from "./schedules";

/** How the return is said: not known, in a while, at a time of day, on a day at a time. */
export type BackWhen = "unknown" | "in" | "at" | "on";

export const BACK_WHENS: readonly BackWhen[] = ["unknown", "in", "at", "on"];

/** The return as chosen: each way's value is kept, so going back to one finds it as it was. */
export interface BackChoice {
  when: BackWhen;
  /** "In": how long (minutes), one of `BACK_IN`. */
  minutes: number;
  /** "At" and "on": the time of day ("HH:MM"), where the home is. */
  time: string;
  /** "On": the day ("YYYY-MM-DD"), where the home is. */
  date: string;
}

/** How long one may be away, as "back in" offers it (minutes). */
export const BACK_IN: readonly number[] = [
  30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320, 10_080,
];

/** The usual return is offered first only when it is this close (a day): a routine's. */
const USUAL_WITHIN_MS = 24 * 3_600_000;
/** An action is set at most this far ahead (the integration's `MAX_SCHEDULE_DAYS`). */
const MAX_AHEAD_MS = 365 * 86_400_000;

/** A shortcut that asks when one is back: one leaving home that turns the heating down. */
export function asksBack(shortcut: Shortcut): boolean {
  return shortcut.back !== undefined && shortcut.steps.some((step) => step.kind === "climate");
}

/** The day `days` after `date` ("YYYY-MM-DD"). */
function addDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Monday 0 … Sunday 6, of a day ("YYYY-MM-DD"). */
function weekday(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** How far `timeZone` is ahead of UTC at `at` (ms). */
function offsetAt(at: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type: string): number =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** A day and a time of day where the home is, as a moment (a time skipped by a clock change: after). */
export function zoned(date: string, time: string, timeZone?: string): Date | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return undefined;
  const [year, month, dayOf, hour, minute] = [day[1], day[2], day[3], clock[1], clock[2]].map(
    Number,
  ) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, dayOf, hour, minute);
  let at: number;
  try {
    at = wall - offsetAt(wall, timeZone);
    at = wall - offsetAt(at, timeZone);
  } catch {
    // A time zone this browser does not know: the device's.
    at = new Date(year, month - 1, dayOf, hour, minute).getTime();
  }
  return Number.isFinite(at) ? new Date(at) : undefined;
}

/** The time of day of a moment where the home is ("HH:MM"). */
function timeOf(at: Date, timeZone?: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  }
  const part = (type: string): string => parts.find((each) => each.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** The next usual return after `now`, within a week; none when no day has one. */
export function nextUsual(back: Back | undefined, now: Date, timeZone?: string): Date | undefined {
  const usual = back?.usual;
  if (!usual) return undefined;
  const today = todayIn(timeZone, now);
  for (let days = 0; days <= 7; days += 1) {
    const date = addDays(today, days);
    const time = usual[weekday(date)];
    if (typeof time !== "string" || !TIME.test(time)) continue;
    const at = zoned(date, time, timeZone);
    if (at && at.getTime() > now.getTime()) return at;
  }
  return undefined;
}

/**
 * The return first offered: the usual one when it is within a day, else a workplace's next
 * opening (`opens`), else not known. The other ways start from it, or from an hour from now.
 */
export function firstChoice(
  back: Back | undefined,
  now: Date,
  timeZone?: string,
  opens?: Date,
): BackChoice {
  const usual = nextUsual(back, now, timeZone);
  const soon = usual && usual.getTime() - now.getTime() <= USUAL_WITHIN_MS ? usual : undefined;
  const known = soon ?? (opens && opens.getTime() > now.getTime() ? opens : undefined);
  const start = known ?? new Date(now.getTime() + 3_600_000);
  const date = todayIn(timeZone, start);
  return {
    when: known ? (date === todayIn(timeZone, now) ? "at" : "on") : "unknown",
    minutes: 120,
    time: timeOf(start, timeZone),
    date,
  };
}

/** When one is back, as chosen; none when not known, not readable or not to come. */
export function backAt(choice: BackChoice, now: Date, timeZone?: string): Date | undefined {
  let at: Date | undefined;
  switch (choice.when) {
    case "unknown":
      return undefined;
    case "in":
      at = new Date(now.getTime() + choice.minutes * 60_000);
      break;
    case "at": {
      if (!TIME.test(choice.time)) return undefined;
      const today = todayIn(timeZone, now);
      at = zoned(today, choice.time, timeZone);
      // A time passed today is tomorrow's.
      if (at && at.getTime() <= now.getTime()) at = zoned(addDays(today, 1), choice.time, timeZone);
      break;
    }
    case "on":
      if (!TIME.test(choice.time) || !/^\d{4}-\d{2}-\d{2}$/.test(choice.date)) return undefined;
      at = zoned(choice.date, choice.time, timeZone);
      break;
  }
  if (!at || at.getTime() <= now.getTime() || at.getTime() - now.getTime() > MAX_AHEAD_MS) {
    return undefined;
  }
  return at;
}

/** When the heating comes back: `ahead` minutes before the return, not before a minute from now. */
export function heatingAt(back: Back | undefined, at: Date, now: Date): Date {
  const ahead = Math.min(Math.max(back?.ahead ?? BACK_AHEAD, 0), MAX_BACK_AHEAD);
  return new Date(Math.max(at.getTime() - ahead * 60_000, now.getTime() + 60_000));
}

/** What a heating call puts back, as the integration's "climate" action takes it. */
function climateOf(call: Call): Record<string, string | number> | undefined {
  const [domain, service, data] = call;
  if (domain !== "climate") return undefined;
  const key =
    service === "set_preset_mode"
      ? "preset_mode"
      : service === "set_hvac_mode"
        ? "hvac_mode"
        : service === "set_temperature"
          ? "temperature"
          : undefined;
  const value = key ? data[key] : undefined;
  return key && (typeof value === "string" || typeof value === "number")
    ? { [key]: value }
    : undefined;
}

/**
 * The actions that bring the heating back as it was at `at`, from the calls that undo what the
 * shortcut changed (taken before it ran): one for each setting, 25 devices at most each.
 */
export function heatingBack(calls: readonly Call[], at: Date): NewSchedule[] {
  const out: NewSchedule[] = [];
  for (const call of calls) {
    const climate = climateOf(call);
    if (!climate) continue;
    for (let i = 0; i < call[3].length; i += MAX_SCHEDULE_ENTITIES) {
      out.push({
        entities: call[3].slice(i, i + MAX_SCHEDULE_ENTITIES),
        action: "climate",
        at: at.toISOString(),
        climate,
      });
    }
  }
  return out;
}

/** A while as "back in" says it, in the viewer's language: "30 minutes", "2 hours", "1 week". */
export function durationText(minutes: number, language: string): string {
  const [value, unit] =
    minutes % 10_080 === 0
      ? [minutes / 10_080, "week"]
      : minutes % 1440 === 0
        ? [minutes / 1440, "day"]
        : minutes % 60 === 0
          ? [minutes / 60, "hour"]
          : [minutes, "minute"];
  try {
    return new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(
      value,
    );
  } catch {
    return `${value} ${unit}`;
  }
}

/** The calls that put the heating back now, as a waiting action would (D-091). */
export function heatingNow(item: {
  entities: string[];
  climate?: Record<string, string | number>;
}): Call | undefined {
  const [entry] = Object.entries(item.climate ?? {});
  if (!entry) return undefined;
  const [key, value] = entry;
  const service =
    key === "preset_mode"
      ? "set_preset_mode"
      : key === "hvac_mode"
        ? "set_hvac_mode"
        : key === "temperature"
          ? "set_temperature"
          : undefined;
  return service ? ["climate", service, { [key]: value }, [...item.entities]] : undefined;
}
