/**
 * History as reports (D-058): what Home Assistant's history, statistics and logbook answer, read
 * into rows (one for each change or each hour), filtered by value and by how long, searched, and
 * written as CSV. Pure functions: the report's chunk only asks and draws.
 */
import type { HomeAssistant } from "../ha/types";
import { areaEntities } from "./bindings";
import { numberOf } from "./layers";
import { unaccented } from "./text";

/** Most entities in a report. */
export const MAX_REPORT_ENTITIES = 8;
/** Most days of changes or of the logbook read at once (Home Assistant keeps 10 by default). */
export const MAX_CHANGE_DAYS = 31;
/** How many days Home Assistant keeps each change unless set otherwise. */
export const KEPT_DAYS = 10;
/** Rows the table shows (the CSV has them all). */
export const SHOWN_ROWS = 500;

const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY_MS = 86_400_000;

/** How the report reads the history: a row for each change, for each hour, or the logbook. */
export type ReportMode = "changes" | "hours" | "logbook";

/** The periods offered, ending now, and one of two dates. */
export type PeriodChoice = "day" | "week" | "month" | "year" | "custom";

const PERIOD_DAYS: Record<Exclude<PeriodChoice, "custom">, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** How a row's value is compared (`any`: not filtered by value). */
export type Compare = "any" | "above" | "below" | "equal" | "not_equal";

/** What the rows are filtered by: a value, and how long at least (ms; 0: any time). */
export interface RowFilter {
  compare: Compare;
  value: string;
  atLeast: number;
}

export const NO_FILTER: RowFilter = { compare: "any", value: "", atLeast: 0 };

/** The entity took `state` at `at` (ms). */
export interface Change {
  at: number;
  state: string;
}

/**
 * A row of the report: an entity from `start` to `end` (ms). A change, with its state; an hour,
 * with a number's mean, lowest and highest (or a meter's change), else the state held longest
 * and for how long; or a period of rows in a row that matched a filter by value.
 */
export interface Row {
  kind: "change" | "hour" | "period";
  entity: string;
  start: number;
  end: number;
  state?: string;
  /** How long `state` was held in an hour (ms). */
  held?: number;
  mean?: number;
  min?: number;
  max?: number;
  /** A meter's change over the hour (statistics' `change`). */
  change?: number;
  /** It goes on: the period ends now and nothing changed since. */
  ongoing?: boolean;
  /** How many rows a period is made of. */
  rows?: number;
}

/** An entry of Home Assistant's logbook. */
export interface LogEntry {
  /** When (ms). */
  when: number;
  entity?: string;
  state?: string;
  /** An event's own name and words (an automation that ran: its name, "triggered by …"). */
  name?: string;
  message?: string;
  /** What caused it, as Home Assistant recorded it. */
  cause?: LogCause;
}

/** What caused a logbook entry: an automation or a script, an entity, a person, an action. */
export interface LogCause {
  /** An automation's or a script's name. */
  name?: string;
  entity?: string;
  user?: string;
  /** An action called (`light.turn_on`). */
  service?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The period of a choice ending at `now` (ms), or of two dates; undefined when it is none. */
export function periodOf(
  choice: PeriodChoice,
  now: number,
  from?: number,
  to?: number,
): { start: number; end: number } | undefined {
  if (choice !== "custom") return { start: now - PERIOD_DAYS[choice] * DAY_MS, end: now };
  if (from === undefined || to === undefined) return undefined;
  const end = Math.min(to, now);
  return from < end ? { start: from, end } : undefined;
}

/** Why a period cannot be read in a mode: in the future or empty, or too long for the changes. */
export function periodProblem(
  mode: ReportMode,
  period: { start: number; end: number } | undefined,
): "no_period" | "too_long" | undefined {
  if (!period || period.end <= period.start) return "no_period";
  // An hour of slack: 31 days across a change of time back are 31 days and an hour.
  if (mode !== "hours" && period.end - period.start > MAX_CHANGE_DAYS * DAY_MS + HOUR + MINUTE) {
    return "too_long";
  }
  return undefined;
}

/** Whether a period reaches further back than Home Assistant keeps each change by default. */
export function beyondKept(period: { start: number }, now: number): boolean {
  return period.start < now - KEPT_DAYS * DAY_MS;
}

/** Home Assistant's own History or Logbook page, on the same entities and period. */
export function haPagePath(
  page: "history" | "logbook",
  entities: readonly string[],
  period: { start: number; end: number },
): string {
  const params = new URLSearchParams({
    entity_id: entities.join(","),
    start_date: new Date(period.start).toISOString(),
    end_date: new Date(period.end).toISOString(),
  });
  return `/${page}?${params.toString()}`;
}

/**
 * The changes of each entity from `history/history_during_period`'s answer (its compressed
 * states: `s` the state, `lu` and `lc` in seconds), from `start` on (the state at the start
 * first), oldest first; the same state twice in a row (attributes that changed) once.
 */
export function readHistory(answer: unknown, start: number): Map<string, Change[]> {
  const found = new Map<string, Change[]>();
  if (!isRecord(answer)) return found;
  for (const [entity, list] of Object.entries(answer)) {
    if (!Array.isArray(list)) continue;
    const read: Change[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const state = item.s;
      const seconds = finite(item.lc) ?? finite(item.lu);
      if (typeof state !== "string" || seconds === undefined) continue;
      read.push({ at: Math.max(start, Math.round(seconds * 1000)), state });
    }
    read.sort((a, b) => a.at - b.at);
    const changes: Change[] = [];
    for (const change of read) {
      // Two states at the same moment (the start's and a change then): the later one.
      if (changes[changes.length - 1]?.at === change.at) changes.pop();
      if (changes[changes.length - 1]?.state === change.state) continue;
      changes.push(change);
    }
    if (changes.length > 0) found.set(entity, changes);
  }
  return found;
}

/** An hour of `recorder/statistics_during_period` (`start` and `end` in milliseconds). */
export interface StatisticsHour {
  start: number;
  end: number;
  mean?: number;
  min?: number;
  max?: number;
  change?: number;
}

/** The hours of each statistic from `recorder/statistics_during_period`'s answer, oldest first. */
export function readStatistics(answer: unknown): Map<string, StatisticsHour[]> {
  const found = new Map<string, StatisticsHour[]>();
  if (!isRecord(answer)) return found;
  for (const [id, list] of Object.entries(answer)) {
    if (!Array.isArray(list)) continue;
    const hours: StatisticsHour[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const start = finite(item.start);
      const end = finite(item.end);
      if (start === undefined || end === undefined || end <= start) continue;
      const hour: StatisticsHour = { start, end };
      for (const key of ["mean", "min", "max", "change"] as const) {
        const value = finite(item[key]);
        if (value !== undefined) hour[key] = value;
      }
      if (hour.mean !== undefined || hour.change !== undefined) hours.push(hour);
    }
    hours.sort((a, b) => a.start - b.start);
    if (hours.length > 0) found.set(id, hours);
  }
  return found;
}

/** A row for each change of `entity` in `[start, end)`, lasting until the next or the end. */
export function changeRows(
  entity: string,
  changes: readonly Change[],
  period: { start: number; end: number },
  now: number,
): Row[] {
  const rows: Row[] = [];
  changes.forEach((change, i) => {
    const start = Math.max(change.at, period.start);
    const next = changes[i + 1];
    const end = Math.min(next ? next.at : period.end, period.end);
    if (end <= start) return;
    const row: Row = { kind: "change", entity, start, end, state: change.state };
    const value = numberOf(change.state);
    if (value !== undefined) row.mean = row.min = row.max = value;
    if (!next && period.end >= now - MINUTE) row.ongoing = true;
    rows.push(row);
  });
  return rows;
}

/** The hours that ended within `[start, end)`, aligned as Home Assistant's statistics are. */
export function wholeHours(period: { start: number; end: number }, now: number): number[] {
  const hours: number[] = [];
  const last = Math.min(period.end, now);
  for (let hour = Math.ceil(period.start / HOUR) * HOUR; hour + HOUR <= last; hour += HOUR) {
    hours.push(hour);
  }
  return hours;
}

/** The rows of an entity's statistics, for the hours that ended in the period. */
export function statisticsRows(
  entity: string,
  hours: readonly StatisticsHour[],
  period: { start: number; end: number },
  now: number,
): Row[] {
  const last = Math.min(period.end, now);
  return hours
    .filter((hour) => hour.start >= period.start && hour.end <= last)
    .map((hour) => {
      const row: Row = { kind: "hour", entity, start: hour.start, end: hour.end };
      if (hour.mean !== undefined) row.mean = hour.mean;
      if (hour.min !== undefined) row.min = hour.min;
      if (hour.max !== undefined) row.max = hour.max;
      if (hour.change !== undefined) row.change = hour.change;
      return row;
    });
}

/**
 * The rows of an entity without statistics, for the hours that ended in the period, from its
 * changes: a number's mean weighted by time, its lowest and its highest; otherwise the state held
 * longest and for how long. An hour before anything was recorded has no row.
 */
export function hoursFromChanges(
  entity: string,
  changes: readonly Change[],
  period: { start: number; end: number },
  now: number,
): Row[] {
  const rows: Row[] = [];
  let i = 0;
  for (const hour of wholeHours(period, now)) {
    const end = hour + HOUR;
    // The change in force at the start of the hour.
    while (i + 1 < changes.length && (changes[i + 1]?.at ?? Infinity) <= hour) i += 1;
    const first = changes[i];
    if (!first || first.at >= end) continue;
    let weighted = 0;
    let numbered = 0;
    let min = Infinity;
    let max = -Infinity;
    const held = new Map<string, number>();
    for (let k = i; k < changes.length; k += 1) {
      const change = changes[k];
      if (!change || change.at >= end) break;
      const from = Math.max(change.at, hour);
      const to = Math.min(changes[k + 1]?.at ?? end, end);
      if (to <= from) continue;
      const value = numberOf(change.state);
      if (value !== undefined) {
        weighted += value * (to - from);
        numbered += to - from;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      held.set(change.state, (held.get(change.state) ?? 0) + (to - from));
    }
    const row: Row = { kind: "hour", entity, start: hour, end };
    if (numbered > 0) {
      row.mean = weighted / numbered;
      row.min = min;
      row.max = max;
    } else {
      let longest = 0;
      for (const [state, time] of held) {
        if (time > longest) {
          longest = time;
          row.state = state;
          row.held = time;
        }
      }
      if (row.state === undefined) continue;
    }
    rows.push(row);
  }
  return rows;
}

/** A row's number: a change's state, an hour's mean or a meter's change, a period's mean. */
export function rowNumber(row: Row): number | undefined {
  return row.mean ?? row.change;
}

/** Whether a filter can be used: above and below need a number, equal and not equal a value. */
export function filterProblem(filter: RowFilter): "number_needed" | "value_needed" | undefined {
  if (filter.compare === "any") return undefined;
  if (filter.compare === "above" || filter.compare === "below") {
    return numberOf(filter.value.trim()) === undefined ? "number_needed" : undefined;
  }
  return filter.value.trim() === "" ? "value_needed" : undefined;
}

/** Whether a row matches a filter's value; `shown` is a state as Home Assistant shows it. */
export function matchesValue(
  row: Row,
  filter: RowFilter,
  shown: (row: Row) => string | undefined = () => undefined,
): boolean {
  if (filter.compare === "any") return true;
  const wanted = numberOf(filter.value.trim());
  const value = rowNumber(row);
  if (filter.compare === "above")
    return wanted !== undefined && value !== undefined && value > wanted;
  if (filter.compare === "below")
    return wanted !== undefined && value !== undefined && value < wanted;
  let equal: boolean;
  if (wanted !== undefined && value !== undefined) {
    equal = Math.abs(value - wanted) < 1e-9;
  } else {
    const target = unaccented(filter.value.trim());
    const own = shown(row);
    equal =
      row.state !== undefined &&
      (unaccented(row.state) === target ||
        (own !== undefined && unaccented(own.trim()) === target));
  }
  return filter.compare === "equal" ? equal : !equal;
}

/** The rows in a row of one entity that match, as one period. */
function period(rows: readonly Row[]): Row {
  const first = rows[0] as Row;
  const last = rows[rows.length - 1] as Row;
  const merged: Row = {
    kind: "period",
    entity: first.entity,
    start: first.start,
    end: last.end,
    rows: rows.length,
  };
  let weighted = 0;
  let numbered = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const value = rowNumber(row);
    if (value === undefined) continue;
    weighted += value * (row.end - row.start);
    numbered += row.end - row.start;
    min = Math.min(min, row.min ?? value);
    max = Math.max(max, row.max ?? value);
  }
  if (numbered > 0) {
    merged.mean = weighted / numbered;
    merged.min = min;
    merged.max = max;
  }
  const states = new Set(rows.map((row) => row.state));
  if (states.size === 1 && first.state !== undefined) merged.state = first.state;
  if (last.ongoing) merged.ongoing = true;
  return merged;
}

/**
 * The rows a filter keeps, oldest first. With a value, the rows in a row of an entity that match
 * (each starting where the one before ended) make one period; with a time, only the rows or
 * periods that lasted that long are kept.
 */
export function filterRows(
  rows: readonly Row[],
  filter: RowFilter,
  shown?: (row: Row) => string | undefined,
): Row[] {
  const lasted = (row: Row): boolean => row.end - row.start >= filter.atLeast;
  if (filter.compare === "any") return byTime(rows.filter(lasted));
  const kept: Row[] = [];
  const byEntity = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byEntity.get(row.entity);
    if (list) list.push(row);
    else byEntity.set(row.entity, [row]);
  }
  for (const list of byEntity.values()) {
    list.sort((a, b) => a.start - b.start);
    let run: Row[] = [];
    const close = (): void => {
      if (run.length > 0) {
        const merged = period(run);
        if (lasted(merged)) kept.push(merged);
      }
      run = [];
    };
    for (const row of list) {
      if (!matchesValue(row, filter, shown)) {
        close();
        continue;
      }
      const before = run[run.length - 1];
      if (before && before.end !== row.start) close();
      run.push(row);
    }
    close();
  }
  return byTime(kept);
}

/** Oldest first, then in the order the entities were given. */
function byTime(rows: Row[]): Row[] {
  return rows.sort((a, b) => a.start - b.start);
}

/** How long the rows last in all (ms). */
export function totalTime(rows: readonly Row[]): number {
  return rows.reduce((sum, row) => sum + (row.end - row.start), 0);
}

/**
 * The entries of `logbook/get_events`'s answer, oldest first: `when` in seconds, a state change's
 * `state`, an event's `name` and `message`, what caused it in `context_*`.
 */
export function readLogbook(answer: unknown): LogEntry[] {
  if (!Array.isArray(answer)) return [];
  const entries: LogEntry[] = [];
  for (const item of answer) {
    if (!isRecord(item)) continue;
    const seconds =
      finite(item.when) ?? (typeof item.when === "string" ? Date.parse(item.when) / 1000 : NaN);
    if (!Number.isFinite(seconds)) continue;
    const entry: LogEntry = { when: Math.round(seconds * 1000) };
    const entity = text(item.entity_id);
    if (entity) entry.entity = entity;
    if (typeof item.state === "string") entry.state = item.state;
    const name = text(item.name);
    if (name) entry.name = name;
    const message = text(item.message);
    if (message) entry.message = message;
    const cause: LogCause = {};
    const causeName = text(item.context_name);
    if (causeName) cause.name = causeName;
    const causeEntity = text(item.context_entity_id);
    if (causeEntity) cause.entity = causeEntity;
    const user = text(item.context_user_id);
    if (user) cause.user = user;
    const domain = text(item.context_domain);
    const service = text(item.context_service);
    if (domain && service) cause.service = `${domain}.${service}`;
    if (Object.keys(cause).length > 0) entry.cause = cause;
    if (entry.entity === undefined && entry.message === undefined && entry.name === undefined) {
      continue;
    }
    entries.push(entry);
  }
  return entries.sort((a, b) => a.when - b.when);
}

/** The words of a search, accents and case aside. */
export function searchWords(query: string): string[] {
  return unaccented(query).split(/\s+/).filter(Boolean);
}

/** The entries whose words hold every word of the search (all of them without one). */
export function searchLogbook(
  entries: readonly LogEntry[],
  query: string,
  words: (entry: LogEntry) => string,
): LogEntry[] {
  const wanted = searchWords(query);
  if (wanted.length === 0) return [...entries];
  return entries.filter((entry) => {
    const found = unaccented(words(entry));
    return wanted.every((word) => found.includes(word));
  });
}

/** A number as written in the CSV: a point, four decimals at most. */
function csvNumber(value: number | undefined): string {
  return value === undefined ? "" : String(Math.round(value * 10_000) / 10_000);
}

/**
 * A CSV cell: quoted when it holds a comma, a quote or a line break; text a spreadsheet would read
 * as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) starts with `'`.
 */
export function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell) && numberOf(cell) === undefined) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** What the CSV needs of an entity: its name and its unit. */
export interface CsvNames {
  name(entity: string): string;
  unit(entity: string): string | undefined;
}

/** The rows as CSV, oldest first, with column names that stay the same in every language. */
export function rowsCsv(rows: readonly Row[], names: CsvNames): string {
  let out = csvLine([
    "entity_id",
    "name",
    "start",
    "end",
    "duration_s",
    "state",
    "held_s",
    "mean",
    "min",
    "max",
    "change",
    "unit",
  ]);
  for (const row of [...rows].sort((a, b) => a.start - b.start)) {
    const numbers = row.kind !== "change";
    out += csvLine([
      row.entity,
      names.name(row.entity),
      iso(row.start),
      iso(row.end),
      String(Math.round((row.end - row.start) / 1000)),
      row.state ?? "",
      row.held === undefined ? "" : String(Math.round(row.held / 1000)),
      numbers ? csvNumber(row.mean) : "",
      numbers ? csvNumber(row.min) : "",
      numbers ? csvNumber(row.max) : "",
      csvNumber(row.change),
      names.unit(row.entity) ?? "",
    ]);
  }
  return out;
}

/** The logbook's entries as CSV, oldest first; `cause` says what caused each, in words. */
export function logbookCsv(
  entries: readonly LogEntry[],
  names: CsvNames,
  cause: (entry: LogEntry) => string,
): string {
  let out = csvLine(["when", "entity_id", "name", "state", "message", "caused_by"]);
  for (const entry of [...entries].sort((a, b) => a.when - b.when)) {
    out += csvLine([
      iso(entry.when),
      entry.entity ?? "",
      entry.name ?? (entry.entity ? names.name(entry.entity) : ""),
      entry.state ?? "",
      entry.message ?? "",
      cause(entry),
    ]);
  }
  return out;
}

/** The fields of `ms` on the wall clock of `timeZone` (this device's without one). */
function wallClock(ms: number, timeZone?: string): number[] {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(ms));
      const part = (type: string): number =>
        Number(parts.find((p) => p.type === type)?.value ?? NaN);
      return [
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
      ];
    } catch {
      // An unknown time zone: this device's.
    }
  }
  const date = new Date(ms);
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `ms` as a date and time field's value (`YYYY-MM-DDTHH:mm`) where the home is. */
export function inputValue(ms: number, timeZone?: string): string {
  const [year = 0, month = 0, day = 1, hour = 0, minute = 0] = wallClock(ms, timeZone);
  return `${String(year).padStart(4, "0")}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** The moment a date and time field's value means where the home is (ms), if it is one. */
export function fromInputValue(value: string, timeZone?: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const fields = Date.UTC(year, month - 1, day, hour, minute, match[6] ? Number(match[6]) : 0);
  if (Number.isNaN(fields)) return undefined;
  // The offset of the time zone then, from the wall clock it shows for a first guess; checked
  // again once moved by it (a change of time between).
  const offset = (ms: number): number => {
    const [y = 0, mo = 0, d = 1, h = 0, mi = 0, s = 0] = wallClock(ms, timeZone);
    return Date.UTC(y, mo, d, h, mi, s) - Math.floor(ms / 1000) * 1000;
  };
  let guess = fields - offset(fields);
  const again = offset(guess);
  if (fields - again !== guess) guess = fields - again;
  return guess;
}

/** Device classes of a room's air sensors, in the order a room's report lists them. */
const AIR_CLASSES = ["temperature", "humidity", "carbon_dioxide", "pm25"];

/** A room's air sensors (its area's temperature, humidity, CO₂ and fine particles), for its report. */
export function roomSensors(hass: HomeAssistant, area: string): string[] {
  const rank = (id: string): number => {
    const kind = hass.states[id]?.attributes.device_class;
    return typeof kind === "string" ? AIR_CLASSES.indexOf(kind) : -1;
  };
  return areaEntities(hass, area)
    .filter((id) => id.startsWith("sensor.") && rank(id) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_REPORT_ENTITIES);
}
