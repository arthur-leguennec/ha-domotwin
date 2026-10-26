/**
 * Hydro-Québec's peak now (D-057), from what the integrations that read it say
 * (`peak-sources.ts`): the one under way or the next, its pre-heating, and where it stands.
 * Nothing is fetched, nothing guessed but hydroqc's own pre-heating where it does not say it.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import { nowOf } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { peakEn, peakFr } from "../i18n/peak";
import type { PeakPhase } from "./peak-rooms";
import {
  HYDROQC_PREHEAT,
  SOURCES,
  entitiesOf,
  peakCalendars,
  peaksAvailable,
  type Kinds,
} from "./peak-sources";
import { whenText, type TimeStyle } from "./schedules";

addMessages({ en: peakEn, fr: peakFr });

/** A peak announced by Hydro-Québec: when it starts and ends, and when pre-heating starts. */
export interface Peak {
  start: number;
  end: number;
  preheat: number;
}

/** Where the integrations' peak stands now. */
export interface PeakNow {
  phase: PeakPhase;
  /** The peak under way, or the next one. */
  peak?: Peak;
  /** When the phase changes next (ms). */
  next?: number;
}

/** A timestamp state (an ISO date with its offset); undefined otherwise. */
function timeOf(entity: HassEntity | undefined): number | undefined {
  if (!entity) return undefined;
  const value = Date.parse(entity.state);
  return Number.isFinite(value) && /^\d{4}-\d\d-\d\dT/.test(entity.state) ? value : undefined;
}

/**
 * The time of a wall clock (`"2026-01-21 06:00:00"`, as a calendar's attributes say it) in
 * `timeZone`; the device's own without one, or for one it does not know.
 */
export function zonedTime(text: unknown, timeZone: string | undefined): number | undefined {
  const match =
    typeof text === "string"
      ? /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(text)
      : null;
  if (!match) return undefined;
  // The seconds may be left out.
  const field = (k: number): number => Number(match[k] ?? 0);
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map(field) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    return new Date(year, month - 1, day, hour, minute, second).getTime();
  }
  // How far the zone is from UTC at a time: its wall clock then, less the time.
  const offset = (at: number): number => {
    const parts = format.formatToParts(at);
    const part = (type: string): number =>
      Number(parts.find((each) => each.type === type)?.value ?? 0);
    return (
      Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
      ) - at
    );
  };
  // Twice, for a wall clock on the other side of a change of time from the first guess.
  const first = wall - offset(wall);
  return wall - offset(first);
}

/** The peaks the sensors of a source say, one for each device (a contract, an offer). */
function sensorPeaks(hass: HomeAssistant, kinds: Kinds): Peak[] {
  const byKind = entitiesOf(hass);
  const ids = (kind: string): string[] => byKind.get(`${kinds.platform}.${kind}`) ?? [];
  const deviceOf = (id: string): string => hass.entities?.[id]?.device_id ?? "";
  const peaks: Peak[] = [];
  for (const startId of ids(kinds.start)) {
    const device = deviceOf(startId);
    const sibling = (kind: string | undefined): HassEntity | undefined => {
      const id = kind ? ids(kind).find((each) => deviceOf(each) === device) : undefined;
      return id ? hass.states[id] : undefined;
    };
    const start = timeOf(hass.states[startId]);
    const end = timeOf(sibling(kinds.end));
    if (start === undefined || end === undefined || end <= start) continue;
    const preheat = timeOf(sibling(kinds.preheat));
    peaks.push({
      start,
      end,
      preheat: preheat !== undefined && preheat <= start ? preheat : start - kinds.lead * 60_000,
    });
  }
  return peaks;
}

/** The peak hydroqc wrote in a calendar (`peakCalendars`), in Home Assistant's time zone. */
function calendarPeak(hass: HomeAssistant, entity: HassEntity): Peak | undefined {
  const zone = hass.config?.time_zone;
  const start = zonedTime(entity.attributes.start_time, zone);
  const end = zonedTime(entity.attributes.end_time, zone);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return { start, end, preheat: start - HYDROQC_PREHEAT * 60_000 };
}

/** The peaks the integrations say, worked out once per update. */
const said = new WeakMap<object, { registry: unknown; peaks: Peak[] }>();

/** Every peak the integrations say, from their sensors and hydroqc's calendars. */
function peaksOf(hass: HomeAssistant): Peak[] {
  const registry = hass.entities;
  const known = said.get(hass.states);
  if (known && known.registry === registry) return known.peaks;
  const peaks = SOURCES.flatMap((kinds) => sensorPeaks(hass, kinds));
  for (const id of peakCalendars(hass)) {
    const entity = hass.states[id];
    const peak = entity ? calendarPeak(hass, entity) : undefined;
    if (peak) peaks.push(peak);
  }
  said.set(hass.states, { registry, peaks });
  return peaks;
}

/** Where a peak stands at `now`, and when that changes. */
export function phaseOf(peak: Peak | undefined, now: number): Omit<PeakNow, "peak"> {
  if (!peak || now >= peak.end) return { phase: "none" };
  if (now >= peak.start) return { phase: "peak", next: peak.end };
  if (now >= peak.preheat) return { phase: "preheat", next: peak.start };
  return { phase: "upcoming", next: peak.preheat };
}

/**
 * Hydro-Québec's peak now: the one under way, else the next to come, with its phase; undefined
 * where no integration reads the peaks.
 */
export function peakNow(hass: HomeAssistant, now = nowOf(hass)): PeakNow | undefined {
  if (!peaksAvailable(hass)) return undefined;
  const peak = peaksOf(hass)
    .filter((each) => each.end > now)
    .sort((a, b) => a.start - b.start || a.end - b.end)[0];
  return peak ? { ...phaseOf(peak, now), peak } : { phase: "none" };
}

/**
 * The peak in words, a line each: under way and until when, or pre-heating and when it comes,
 * or the next one and its pre-heating; that none is announced.
 */
export function peakWords(t: Translator, now: PeakNow, style: TimeStyle, at: Date): string[] {
  const peak = now.peak;
  if (!peak || now.phase === "none") return [t.t("peak.none")];
  const start = new Date(peak.start);
  const startText = whenText(start, at, style);
  // The end said as a time of the peak's own day.
  const endText = whenText(new Date(peak.end), start, style);
  switch (now.phase) {
    case "peak":
      return [t.t("peak.now", { end: whenText(new Date(peak.end), at, style) })];
    case "preheat":
      return [t.t("peak.preheat", { start: startText, end: endText })];
    default:
      return [
        t.t("peak.next", { start: startText, end: endText }),
        t.t("peak.preheat_from", { at: whenText(new Date(peak.preheat), at, style) }),
      ];
  }
}
