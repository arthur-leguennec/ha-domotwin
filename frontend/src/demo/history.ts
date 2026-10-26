/**
 * The demo house's history (D-058): what its day (D-050) did minute by minute, the same day every
 * day back, as Home Assistant's history and logbook answer it. Kept ten days, as Home Assistant
 * keeps each change by default; no statistics, so that its hours are worked out in the page.
 * What the visitor changed is not in it.
 */
import { KEPT_DAYS, DAY_MS } from "../live/history";
import { DAY, sensorsAt, wantedAt } from "./day";

/** What the day says of an entity at a minute: its state, and the automation that set it. */
interface Said {
  state: string;
  automation?: string;
}

const MINUTE_MS = 60_000;
/** What the day says of each entity at each minute of the day, worked out once when first asked. */
let day: Map<string, Said[]> | undefined;

function dayStates(): Map<string, Said[]> {
  if (day) return day;
  const found = new Map<string, Said[]>();
  for (let minute = 0; minute < DAY; minute += 1) {
    for (const [id, change] of [...sensorsAt(minute), ...wantedAt(minute)]) {
      let list = found.get(id);
      if (!list) found.set(id, (list = []));
      list[minute] = change.automation
        ? { state: change.state, automation: change.automation }
        : { state: change.state };
    }
  }
  // A minute the day left out keeps the state of the minute before.
  for (const list of found.values()) {
    for (let minute = 0; minute < DAY; minute += 1) {
      list[minute] ??= list[(minute + DAY - 1) % DAY] ?? list.find(Boolean) ?? { state: "unknown" };
    }
  }
  day = found;
  return found;
}

/** The minute of the demo's day at `ms`: its clock is this device's wall clock (D-050). */
function minuteOf(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

/** What was kept of `[start, end)` at `now`: ten days back at most. */
function kept(start: number, end: number, now: number): { start: number; end: number } {
  return { start: Math.max(start, now - KEPT_DAYS * DAY_MS), end: Math.min(end, now) };
}

/**
 * Walks the day's minutes in `[start, end)` for an entity, calling `change` at each one whose
 * state differs from the minute before (the first included).
 */
function walk(
  said: Said[],
  start: number,
  end: number,
  change: (at: number, what: Said, first: boolean) => void,
): void {
  let minute = minuteOf(start);
  let last: string | undefined;
  // The first minute at `start`, then each whole minute after it.
  for (let at = start; at < end;) {
    const what = said[minute] ?? { state: "unknown" };
    if (what.state !== last) change(at, what, last === undefined);
    last = what.state;
    const next = (Math.floor(at / MINUTE_MS) + 1) * MINUTE_MS;
    at = next;
    minute = (minute + 1) % DAY;
  }
}

/**
 * `history/history_during_period` in the demo house: for each entity, its state at the start and
 * every change after, compressed as Home Assistant gives them (`s`, `lu` in seconds); an entity
 * the day does not change keeps its state now.
 */
export function demoHistory(
  entities: readonly string[],
  start: number,
  end: number,
  now: number,
  stateNow: (id: string) => string | undefined,
): Record<string, { s: string; lu: number }[]> {
  const period = kept(start, end, now);
  const answer: Record<string, { s: string; lu: number }[]> = {};
  if (period.end <= period.start) return answer;
  const states = dayStates();
  for (const id of entities) {
    const said = states.get(id);
    if (!said) {
      const state = stateNow(id);
      if (state !== undefined) answer[id] = [{ s: state, lu: period.start / 1000 }];
      continue;
    }
    const list: { s: string; lu: number }[] = [];
    walk(said, period.start, period.end, (at, what) => {
      list.push({ s: what.state, lu: at / 1000 });
    });
    answer[id] = list;
  }
  return answer;
}

/**
 * `logbook/get_events` in the demo house: every change in the period of the entities that are
 * not measurements (Home Assistant leaves sensors with a unit out), with the automation that made
 * it, oldest first.
 */
export function demoLogbook(
  entities: readonly string[],
  start: number,
  end: number,
  now: number,
  nameOf: (id: string) => string,
): Record<string, unknown>[] {
  const period = kept(start, end, now);
  const entries: Record<string, unknown>[] = [];
  if (period.end <= period.start) return entries;
  const states = dayStates();
  for (const id of entities) {
    const said = states.get(id);
    // The demo's sensors all have a unit: measurements.
    if (!said || id.startsWith("sensor.")) continue;
    walk(said, period.start, period.end, (at, what, first) => {
      if (first) return;
      const entry: Record<string, unknown> = { when: at / 1000, entity_id: id, state: what.state };
      if (what.automation) {
        entry.context_event_type = "automation_triggered";
        entry.context_domain = "automation";
        entry.context_entity_id = what.automation;
        entry.context_name = nameOf(what.automation);
      }
      entries.push(entry);
    });
  }
  return entries.sort((a, b) => Number(a.when) - Number(b.when));
}
