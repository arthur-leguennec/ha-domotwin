/**
 * Hydro-Québec's announced peak played in the sandbox (D-058): on the peak's day, the entities of
 * the integrations that say it go through the pre-heating and the peak as they would, so that the
 * home's automations set off by them run on the copy, and the peak's layer shows what the rooms
 * then do. Only what the integrations say of a peak under way, and only where this peak is said
 * (its devices, its calendars): their timestamps keep the copy's, their other sensors are left as
 * they are.
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

/**
 * The integrations' entities that say a peak comes today, the morning's (from 6) or the
 * evening's (from 4), and the one that said it the day before.
 */
const TODAY: Record<string, { half: "AM" | "PM"; tomorrow: string }> = {
  "hydroqc.dpc_critical_morning_peak_today": {
    half: "AM",
    tomorrow: "hydroqc.dpc_critical_morning_peak_tomorrow",
  },
  "hydroqc.dpc_critical_evening_peak_today": {
    half: "PM",
    tomorrow: "hydroqc.dpc_critical_evening_peak_tomorrow",
  },
  "hydroqc.wc_critical_morning_peak_today": {
    half: "AM",
    tomorrow: "hydroqc.wc_critical_morning_peak_tomorrow",
  },
  "hydroqc.wc_critical_evening_peak_today": {
    half: "PM",
    tomorrow: "hydroqc.wc_critical_evening_peak_tomorrow",
  },
  "hydropeak.peak_today_AM": { half: "AM", tomorrow: "hydropeak.peak_tomorrow_AM" },
  "hydropeak.peak_today_PM": { half: "PM", tomorrow: "hydropeak.peak_tomorrow_PM" },
};

/** What the day of an announced peak makes the integrations say: at midnight, then through it. */
export interface PeakDay {
  /** The states at midnight. */
  initial: [string, string][];
  happenings: Happening[];
  /**
   * Another peak is announced that day (the other half's): said by the integrations from
   * midnight, but not played, its times being unknown here.
   */
  another: boolean;
}

/** Whether `peak` falls on the day from `start` to `end` (ms). */
export function peakOnDay(peak: Peak | undefined, start: number, end: number): peak is Peak {
  return peak !== undefined && peak.end > start && peak.start < end;
}

/** The calendar day of `at` in `zone`, as a count of days. */
function dayNumber(at: number, zone: string): number {
  const read = zoned(at, zone);
  return Date.UTC(read.year, read.month - 1, read.day) / 86_400_000;
}

/**
 * The announced peak's day for the copy (`states`, its registry `entities`, copied at `copied`),
 * for the devices and calendars that say it (`sources`): their on/off sensors off at midnight,
 * on through the pre-heating or the peak; hydroqc's contract's state a critical peak through it;
 * today's peaks said from midnight (the other half's as the copy said it of that day); the
 * calendar on through the peak. What other devices and calendars say is no peak.
 */
export function peakDay(
  states: Record<string, HassEntity | undefined>,
  entities: Record<string, HassEntityEntry | undefined>,
  peak: Peak,
  sources: ReadonlySet<string>,
  day: { start: number; end: number; zone: string; copied: number },
): PeakDay {
  const { start, end, zone } = day;
  const found: PeakDay = { initial: [], happenings: [], another: false };
  const within = (at: number): number => Math.min(Math.max(at, start), end);
  const between = (id: string, from: number, to: number, on: string, off: string): void => {
    // Nothing between: a pre-heating of no minutes, a peak outside the day.
    if (to <= from) {
      found.initial.push([id, off]);
      return;
    }
    found.initial.push([id, from <= start && to > start ? on : off]);
    if (from > start && from < end) found.happenings.push({ at: from, entity: id, state: on });
    if (to > start && to < end) found.happenings.push({ at: to, entity: id, state: off });
  };
  // The copy's own day, the day before the peak's, or another: what its sensors say of the day.
  const daysAfter = dayNumber(start, zone) - dayNumber(day.copied, zone);
  const half = zoned(peak.start, zone).hour < 12 ? "AM" : "PM";
  const kindOf = (entry: HassEntityEntry | undefined): string | undefined =>
    entry?.platform && entry.translation_key
      ? `${entry.platform}.${entry.translation_key}`
      : undefined;
  for (const [id, entry] of Object.entries(entities)) {
    const kind = kindOf(entry);
    const entity = states[id];
    if (!kind || !entity) continue;
    const device = entry?.device_id ?? "";
    // Another contract, another offer: no peak of its own is played.
    const played = sources.has(device);
    const window = WINDOWS[kind];
    if (window) {
      const from = within(window === "preheat" ? peak.preheat : peak.start);
      const to = within(window === "preheat" ? peak.start : peak.end);
      if (played) between(id, from, to, "on", "off");
      else found.initial.push([id, "off"]);
    } else if (STATES.has(kind)) {
      if (played) between(id, within(peak.start), within(peak.end), "critical_peak", "normal");
      else found.initial.push([id, "normal"]);
    } else if (kind in TODAY) {
      const today = TODAY[kind];
      if (!today) continue;
      if (played && today.half === half) {
        found.initial.push([id, "on"]);
        continue;
      }
      // The other half of the day: as the copy said it of that day, the day before or that day.
      const said = (wanted: string): string | undefined => {
        const sibling = Object.entries(entities).find(
          ([, each]) => kindOf(each) === wanted && (each?.device_id ?? "") === device,
        )?.[0];
        return sibling ? states[sibling]?.state : undefined;
      };
      const other =
        daysAfter === 0 ? entity.state : daysAfter === 1 ? said(today.tomorrow) : undefined;
      const on = other === "on";
      if (on && played) found.another = true;
      found.initial.push([id, on ? "on" : "off"]);
    }
  }
  for (const [id, entity] of Object.entries(states)) {
    if (!id.startsWith("calendar.") || !entity || !hydroqcEvent(entity)) continue;
    if (sources.has(id)) between(id, within(peak.start), within(peak.end), "on", "off");
    else found.initial.push([id, "off"]);
  }
  // At one moment, what ends before what starts: the pre-heating off, then the peak on.
  const ending = (state: string): number => (state === "off" || state === "normal" ? 0 : 1);
  found.happenings.sort((a, b) => a.at - b.at || ending(a.state) - ending(b.state));
  return found;
}
