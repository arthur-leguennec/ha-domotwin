/**
 * Actions done later (`docs/DECISIONS.md`, D-046): a device switched on at a time, and off again
 * after a while, or switched off; the integration keeps them and lists them live. Here: what a
 * piece's sheet lists, the clock badge over a piece with an action waiting, and how their times
 * read.
 */
import type { HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";
import { todayIn } from "./upkeep";
import type { Badge } from "./devices";

/** An action switches this many devices at most (the integration's `MAX_SCHEDULE_ENTITIES`). */
export const MAX_SCHEDULE_ENTITIES = 25;

/** What an action can switch (the integration's `SCHEDULABLE_DOMAINS`). */
const SCHEDULABLE = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "media_player",
  "climate",
  "humidifier",
  "siren",
  "cover",
]);

/** Whether an action can switch `entity`. */
export function schedulable(entity: string): boolean {
  return SCHEDULABLE.has(entity.split(".")[0] ?? "");
}

/** An action waiting, as the integration lists it (times in ISO 8601, UTC). */
export interface Schedule {
  id: string;
  entities: string[];
  /** Switch on, off, or put the heating back as it was (D-091). */
  action: "on" | "off" | "climate";
  at: string;
  /** For "on": when the devices are switched off again. */
  until: string | null;
  /** For lights switched on: their brightness (%). */
  brightness: number | null;
  /** Switched on already, waiting for `until`. */
  started: boolean;
  /** For "climate": what the heating is put back to. */
  climate?: Record<string, string | number>;
}

/** The actions of a `domotwin/schedules/subscribe` event, read leniently. */
export function readSchedules(raw: unknown): Schedule[] {
  const list = (raw as { schedules?: unknown } | null | undefined)?.schedules;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown): Schedule[] => {
    const read = item as Partial<Record<keyof Schedule, unknown>> | null;
    if (
      !read ||
      typeof read.id !== "string" ||
      !Array.isArray(read.entities) ||
      !read.entities.every((entity) => typeof entity === "string") ||
      (read.action !== "on" && read.action !== "off" && read.action !== "climate") ||
      typeof read.at !== "string" ||
      Number.isNaN(Date.parse(read.at))
    ) {
      return [];
    }
    return [
      {
        id: read.id,
        entities: read.entities,
        action: read.action,
        at: read.at,
        until: typeof read.until === "string" ? read.until : null,
        brightness: typeof read.brightness === "number" ? read.brightness : null,
        started: read.started === true,
        ...(read.action === "climate" ? { climate: climateOf(read.climate) } : {}),
      },
    ];
  });
}

/** What the heating is put back to, read leniently. */
function climateOf(raw: unknown): Record<string, string | number> {
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "string" || typeof entry[1] === "number",
    ),
  );
}

/** An action's next step: its start, or its end once started. */
export function nextStep(item: Schedule): { action: Schedule["action"]; at: Date } {
  if (item.started && item.until) return { action: "off", at: new Date(item.until) };
  return { action: item.action, at: new Date(item.at) };
}

/** The actions on any of `entities`, the soonest first. */
export function schedulesOf(items: readonly Schedule[], entities: readonly string[]): Schedule[] {
  const wanted = new Set(entities);
  return items
    .filter((item) => item.entities.some((entity) => wanted.has(entity)))
    .sort((a, b) => nextStep(a).at.getTime() - nextStep(b).at.getTime());
}

/**
 * A clock badge over each element with an action waiting on one of its entities, with the time
 * of the soonest step (`format` writes it).
 */
export function scheduleBadges(
  bindings: BindingsJson,
  items: readonly Schedule[],
  format: (at: Date) => string,
): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  if (items.length === 0) return out;
  // Each entity's soonest action, the list read once.
  const soonest = new Map<string, { item: Schedule; at: Date }>();
  for (const item of items) {
    const at = nextStep(item).at;
    for (const entity of item.entities) {
      const known = soonest.get(entity);
      if (!known || at < known.at) soonest.set(entity, { item, at });
    }
  }
  for (const [element, binding] of Object.entries(bindings.elements)) {
    let first: { entity: string; at: Date } | undefined;
    for (const bound of binding.entities) {
      const next = soonest.get(bound.entity_id);
      if (next && (!first || next.at < first.at)) first = { entity: bound.entity_id, at: next.at };
    }
    if (!first) continue;
    out.set(element, [
      { element, kind: "scheduled", tone: "info", entity: first.entity, text: format(first.at) },
    ]);
  }
  return out;
}

/** How times are written: the language, Home Assistant's time zone, and its 12 or 24 hours. */
export interface TimeStyle {
  language: string;
  timeZone?: string;
  hour12?: boolean;
}

/** The formatters made, by language, time zone and what they write: made once each. */
const FORMATS = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormat(
  key: string,
  language: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${key}|${language}|${options.timeZone ?? ""}|${String(options.hour12)}`;
  let format = FORMATS.get(id) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(language, options);
    FORMATS.set(id, format);
  }
  return format;
}

/** `timeZone` when this browser knows it, else none (the browser's own). */
function knownZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    dateFormat("zone", "en", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** How the times of `hass` are written: its language, its time zone, 12 or 24 hours. */
export function timeStyle(hass: HomeAssistant): TimeStyle {
  const format = (hass.locale as { time_format?: string } | undefined)?.time_format;
  return {
    language: hass.locale?.language ?? hass.language,
    timeZone: knownZone(hass.config?.time_zone),
    hour12: format === "12" ? true : format === "24" ? false : undefined,
  };
}

/** The calendar day of `at` in `timeZone`, as a count of days. */
function dayOf(at: Date, timeZone?: string): number {
  return Date.parse(todayIn(timeZone, at)) / 86_400_000;
}

/**
 * A time as a sheet or a badge says it: "06:30" today, "tomorrow 06:30", "Tue 06:30" within the
 * week, else "28 Oct 06:30".
 */
export function whenText(at: Date, now: Date, style: TimeStyle): string {
  const { language, timeZone, hour12 } = style;
  const clock = dateFormat("clock", language, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  }).format(at);
  const days = dayOf(at, timeZone) - dayOf(now, timeZone);
  if (days === 0) return clock;
  if (days === 1 || days === -1) {
    const id = `relative|${language}`;
    let relative = FORMATS.get(id) as Intl.RelativeTimeFormat | undefined;
    if (!relative) {
      relative = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
      FORMATS.set(id, relative);
    }
    return `${relative.format(days, "day")} ${clock}`;
  }
  const date =
    days > 1 && days < 7
      ? dateFormat("weekday", language, { timeZone, weekday: "short" })
      : dateFormat("date", language, { timeZone, day: "numeric", month: "short" });
  return `${date.format(at)} ${clock}`;
}

/**
 * The time of day half an hour after `now`, to the next five minutes, in `timeZone` ("HH:MM"):
 * what the sheet offers first. The integration reads it in Home Assistant's time zone too.
 */
export function soonIn(now: Date, timeZone?: string): string {
  const parts = dateFormat("hhmm", "en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now.getTime() + 30 * 60_000));
  const part = (type: string): number =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const minutes = Math.ceil((part("hour") * 60 + part("minute")) / 5) * 5;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}
