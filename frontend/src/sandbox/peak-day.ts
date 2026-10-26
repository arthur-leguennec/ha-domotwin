/**
 * Hydro-Québec's announced peak played in the sandbox (D-058): on the peak's day, the entities of
 * the integrations that read it go through the pre-heating and the peak as they would, so that
 * the home's automations set off by them run on the copy, and the peak's layer shows what the
 * rooms then do. Only what those integrations say of a peak under way: their timestamps keep the
 * copy's (the peak announced), their other sensors are left as they are.
 */
import type { HassEntity, HassEntityEntry } from "../ha/types";
import { hydroqcEvent } from "../live/peak-sources";
import type { Peak } from "../live/peaks";
import type { Happening } from "./engine";
import { zoned } from "./time";

/** When an entity is on: through the pre-heating, through the peak. */
type Window = "preheat" | "peak";

/** The integrations' on/off entities that say a peak goes on, by `<platform>.<kind>`. */
const WINDOWS: Record<string, Window> = {
  "hydroqc.dpc_pre_heat": "preheat",
  "hydroqc.wc_pre_heat": "preheat",
  "hydroqc.dpc_peak_in_progress": "peak",
  "hydroqc.wc_critical_peak_in_progress": "peak",
  "hydropeak.preheat_active": "preheat",
  "hydropeak.peak_active": "peak",
};

/** hydroqc's states of its contract: a critical peak under way, else a day like another. */
const STATES = new Set(["hydroqc.dpc_state", "hydroqc.wc_state"]);

/** The integrations' entities that say a peak comes today (the morning's at 6, the evening's at 4). */
const TODAY: Record<string, "AM" | "PM"> = {
  "hydroqc.dpc_critical_morning_peak_today": "AM",
  "hydroqc.dpc_critical_evening_peak_today": "PM",
  "hydroqc.wc_critical_morning_peak_today": "AM",
  "hydroqc.wc_critical_evening_peak_today": "PM",
  "hydropeak.peak_today_AM": "AM",
  "hydropeak.peak_today_PM": "PM",
};

/** What the day of an announced peak makes the integrations say: at midnight, then through it. */
export interface PeakDay {
  /** The states at midnight. */
  initial: [string, string][];
  happenings: Happening[];
}

/** Whether `peak` falls on the day from `start` to `end` (ms). */
export function peakOnDay(peak: Peak | undefined, start: number, end: number): peak is Peak {
  return peak !== undefined && peak.end > start && peak.start < end;
}

/**
 * The announced peak's day for the copy (`states`, its registry `entities`): its on/off sensors
 * off at midnight, on through the pre-heating or the peak; hydroqc's contract's state a critical
 * peak through it; today's peaks said from midnight; hydroqc's calendar on through the peak.
 */
export function peakDay(
  states: Record<string, HassEntity | undefined>,
  entities: Record<string, HassEntityEntry | undefined>,
  peak: Peak,
  start: number,
  end: number,
  zone: string,
): PeakDay {
  const day: PeakDay = { initial: [], happenings: [] };
  const within = (at: number): number => Math.min(Math.max(at, start), end);
  const between = (id: string, from: number, to: number, on: string, off: string): void => {
    day.initial.push([id, from <= start && to > start ? on : off]);
    if (from > start && from < end) day.happenings.push({ at: from, entity: id, state: on });
    if (to > start && to < end) day.happenings.push({ at: to, entity: id, state: off });
  };
  const hour = zoned(peak.start, zone).hour;
  for (const [id, entry] of Object.entries(entities)) {
    if (!entry?.platform || !entry.translation_key || !states[id]) continue;
    const kind = `${entry.platform}.${entry.translation_key}`;
    const window = WINDOWS[kind];
    if (window === "preheat") between(id, within(peak.preheat), within(peak.start), "on", "off");
    else if (window === "peak") between(id, within(peak.start), within(peak.end), "on", "off");
    else if (STATES.has(kind)) {
      between(id, within(peak.start), within(peak.end), "critical_peak", "normal");
    } else if (kind in TODAY) {
      // The morning's peak starts before noon, the evening's after.
      const today = (hour < 12 ? "AM" : "PM") === TODAY[kind];
      day.initial.push([id, today ? "on" : "off"]);
    }
  }
  for (const [id, entity] of Object.entries(states)) {
    if (id.startsWith("calendar.") && entity && hydroqcEvent(entity)) {
      between(id, within(peak.start), within(peak.end), "on", "off");
    }
  }
  // At one moment, what ends before what starts: the pre-heating off, then the peak on.
  const ending = (state: string): number => (state === "off" || state === "normal" ? 0 : 1);
  day.happenings.sort((a, b) => a.at - b.at || ending(a.state) - ending(b.state));
  return day;
}
