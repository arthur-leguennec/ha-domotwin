/**
 * The weekly report (D-081): what the integration wrote on its day, read leniently; what each
 * item says in words; where it opens in Home Assistant; the rooms of the plans it is drawn on.
 * Loaded with the report's page, not with the first picture.
 */
import { readClosed, type ClosedEnergy } from "./closed-energy";
import type { HomeAssistant } from "../ha/types";
import { isEntityId } from "../ha/types";
import type { Translator } from "../i18n";

/** What needs a look, in the order the report says it. */
export const REPORT_SECTIONS = [
  "batteries",
  "unavailable",
  "updates",
  "repairs",
  "upkeep",
  "automations",
  "radios",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** An item to look at; each section adds what it knows (see `docs/report.md`). */
export interface ReportItem {
  key: string;
  name: string;
  /** The room it is in, when the report could tell. */
  room?: string;
  /** Not in the report before. */
  new?: boolean;
  entity?: string;
  device?: string;
  // Batteries.
  level?: number;
  battery?: string;
  // Devices unavailable.
  since?: string;
  // Updates.
  installed?: string;
  latest?: string;
  // Repairs, and what Watchman finds missing.
  domain?: string;
  severity?: string;
  missing?: "entity" | "action";
  // Upkeep.
  piece?: string;
  task?: string;
  due?: string;
  state?: string;
  warranty_end?: string;
  // Automations.
  id?: string;
  problem?: "failed" | "broken" | "never";
  runs?: number;
  last?: string;
  run_id?: string;
  error?: string;
  // Radios.
  lqi?: number;
  hops?: number;
  cut?: boolean;
}

/** A week's energy and the week before's (kWh). */
export interface EnergyPair {
  week?: number;
  before?: number;
}

export interface ReportEnergy {
  home?: EnergyPair;
  grid?: EnergyPair;
  solar?: EnergyPair;
  rooms?: Record<string, EnergyPair>;
}

/** A Hydro-Québec peak of the week, and what the home drew from the grid and each room. */
export interface ReportPeak {
  start: string;
  end: string;
  grid?: number;
  rooms?: Record<string, number>;
}

export interface ReportSummary {
  /** The AI task asked. */
  by?: string;
  text?: string;
  /** Why there is none: `no_ai_task`, `timeout`, `empty`, or the AI task's own words. */
  error?: string;
}

export interface Report {
  id: number;
  at: string;
  by: "schedule" | "hand";
  /** The seven days to the midnight before it was written. */
  week: { start: string; end: string };
  /** Only what was read: no radios without ZHA. */
  sections: Partial<Record<ReportSection, ReportItem[]>>;
  /** Items left out, past the most a section keeps. */
  more?: Partial<Record<ReportSection, number>>;
  /** What the report before had and this one has not: done since. */
  gone?: Partial<Record<ReportSection, { key: string; name: string }[]>>;
  energy?: ReportEnergy;
  /** Where an integration reads Hydro-Québec's peaks (D-063); none otherwise. */
  peaks?: ReportPeak[];
  /** A workplace with opening hours: what it used while closed (D-088). */
  closed?: { week?: ClosedEnergy; before?: ClosedEnergy };
  summary?: ReportSummary;
}

/** A report in the list of those kept. */
export interface ReportEntry {
  id: number;
  at: string;
  by: "schedule" | "hand";
  week: { start: string; end: string };
  counts: Partial<Record<ReportSection, number>>;
}

export interface ReportSettings {
  weekly: boolean;
  /** Monday 0 to Sunday 6. */
  weekday: number;
  hour: number;
  notify: boolean;
  /** The AI task that sums it up, if any. */
  summary: string | null;
  /** A battery is low at this level (%) or below. */
  battery: number;
}

export interface ReportAnswer {
  settings: ReportSettings;
  /** Newest first. */
  reports: ReportEntry[];
  /** The report asked for, or the newest; none yet. */
  report: Report | null;
}

export const DEFAULT_SETTINGS: ReportSettings = {
  weekly: true,
  weekday: 0,
  hour: 8,
  notify: true,
  summary: null,
  battery: 20,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pair(value: unknown): EnergyPair | undefined {
  if (!isObject(value)) return undefined;
  const found: EnergyPair = {};
  const week = number(value.week);
  const before = number(value.before);
  if (week !== undefined) found.week = week;
  if (before !== undefined) found.before = before;
  return week === undefined && before === undefined ? undefined : found;
}

function week(value: unknown): { start: string; end: string } | undefined {
  return isObject(value) && typeof value.start === "string" && typeof value.end === "string"
    ? { start: value.start, end: value.end }
    : undefined;
}

/** The settings as the integration answers them, the defaults for what is not understood. */
export function readSettings(raw: unknown): ReportSettings {
  const value = isObject(raw) ? raw : {};
  const whole = (key: string, low: number, high: number, fallback: number): number => {
    const n = value[key];
    return Number.isInteger(n) && (n as number) >= low && (n as number) <= high
      ? (n as number)
      : fallback;
  };
  return {
    weekly: typeof value.weekly === "boolean" ? value.weekly : DEFAULT_SETTINGS.weekly,
    weekday: whole("weekday", 0, 6, DEFAULT_SETTINGS.weekday),
    hour: whole("hour", 0, 23, DEFAULT_SETTINGS.hour),
    notify: typeof value.notify === "boolean" ? value.notify : DEFAULT_SETTINGS.notify,
    summary:
      typeof value.summary === "string" && value.summary.startsWith("ai_task.")
        ? value.summary
        : null,
    battery: whole("battery", 1, 99, DEFAULT_SETTINGS.battery),
  };
}

/** A report as kept, what is not understood left out; none when it is not one. */
export function readReport(raw: unknown): Report | undefined {
  if (!isObject(raw) || typeof raw.id !== "number" || typeof raw.at !== "string") return undefined;
  const span = week(raw.week);
  if (!span || !isObject(raw.sections)) return undefined;
  const report: Report = {
    id: raw.id,
    at: raw.at,
    by: raw.by === "hand" ? "hand" : "schedule",
    week: span,
    sections: {},
  };
  for (const [section, items] of Object.entries(raw.sections)) {
    if (!isSection(section) || !Array.isArray(items)) continue;
    report.sections[section] = items.filter(
      (item): item is ReportItem =>
        isObject(item) && typeof item.key === "string" && typeof item.name === "string",
    );
  }
  if (isObject(raw.more)) {
    const more: Partial<Record<ReportSection, number>> = {};
    for (const [section, count] of Object.entries(raw.more)) {
      if (isSection(section) && number(count)) more[section] = count as number;
    }
    report.more = more;
  }
  if (isObject(raw.gone)) {
    const gone: Partial<Record<ReportSection, { key: string; name: string }[]>> = {};
    for (const [section, items] of Object.entries(raw.gone)) {
      if (!isSection(section) || !Array.isArray(items)) continue;
      gone[section] = items.filter(
        (item): item is { key: string; name: string } =>
          isObject(item) && typeof item.key === "string" && typeof item.name === "string",
      );
    }
    report.gone = gone;
  }
  if (isObject(raw.energy)) {
    const energy: ReportEnergy = {};
    for (const key of ["home", "grid", "solar"] as const) {
      const found = pair(raw.energy[key]);
      if (found) energy[key] = found;
    }
    if (isObject(raw.energy.rooms)) {
      const rooms: Record<string, EnergyPair> = {};
      for (const [room, value] of Object.entries(raw.energy.rooms)) {
        const found = pair(value);
        if (found) rooms[room] = found;
      }
      energy.rooms = rooms;
    }
    report.energy = energy;
  }
  if (Array.isArray(raw.peaks)) {
    report.peaks = raw.peaks.flatMap((peak): ReportPeak[] => {
      if (!isObject(peak) || typeof peak.start !== "string" || typeof peak.end !== "string") {
        return [];
      }
      const found: ReportPeak = { start: peak.start, end: peak.end };
      const grid = number(peak.grid);
      if (grid !== undefined) found.grid = grid;
      if (isObject(peak.rooms)) {
        found.rooms = Object.fromEntries(
          Object.entries(peak.rooms).filter(([, kwh]) => number(kwh) !== undefined),
        ) as Record<string, number>;
      }
      return [found];
    });
  }
  if (isObject(raw.closed)) {
    const closed: NonNullable<Report["closed"]> = {};
    for (const key of ["week", "before"] as const) {
      const found = readClosed(raw.closed[key]);
      if (found) closed[key] = found;
    }
    report.closed = closed;
  }
  if (isObject(raw.summary)) {
    const summary: ReportSummary = {};
    for (const key of ["by", "text", "error"] as const) {
      const text = raw.summary[key];
      if (typeof text === "string" && text) summary[key] = text;
    }
    report.summary = summary;
  }
  return report;
}

/** The integration's answer, read leniently. */
export function readAnswer(raw: unknown): ReportAnswer {
  const value = isObject(raw) ? raw : {};
  const reports = Array.isArray(value.reports)
    ? value.reports.flatMap((entry): ReportEntry[] => {
        if (!isObject(entry) || typeof entry.id !== "number" || typeof entry.at !== "string") {
          return [];
        }
        const span = week(entry.week);
        if (!span) return [];
        const counts: Partial<Record<ReportSection, number>> = {};
        if (isObject(entry.counts)) {
          for (const [section, count] of Object.entries(entry.counts)) {
            if (isSection(section) && number(count) !== undefined) {
              counts[section] = count as number;
            }
          }
        }
        return [
          {
            id: entry.id,
            at: entry.at,
            by: entry.by === "hand" ? "hand" : "schedule",
            week: span,
            counts,
          },
        ];
      })
    : [];
  return {
    settings: readSettings(value.settings),
    reports,
    report: readReport(value.report) ?? null,
  };
}

export async function getReport(hass: HomeAssistant, report?: number): Promise<ReportAnswer> {
  return readAnswer(
    await hass.connection.sendMessagePromise<unknown>({
      type: "domotwin/report/get",
      ...(report === undefined ? {} : { report }),
    }),
  );
}

export async function writeReport(hass: HomeAssistant): Promise<ReportAnswer> {
  return readAnswer(
    await hass.connection.sendMessagePromise<unknown>({ type: "domotwin/report/write" }),
  );
}

export async function saveReportSettings(
  hass: HomeAssistant,
  settings: Partial<ReportSettings>,
): Promise<ReportSettings> {
  const answer = await hass.connection.sendMessagePromise<{ settings?: unknown }>({
    type: "domotwin/report/settings",
    settings,
  });
  return readSettings(answer.settings);
}

/** How many items a section has, those left out counted. */
export function countOf(report: Report, section: ReportSection): number {
  return (report.sections[section]?.length ?? 0) + (report.more?.[section] ?? 0);
}

/** A report in the list of those kept, as the integration lists it. */
export function summaryOf(report: Report): ReportEntry {
  const counts: Partial<Record<ReportSection, number>> = {};
  for (const section of REPORT_SECTIONS) {
    if (report.sections[section]) counts[section] = countOf(report, section);
  }
  return { id: report.id, at: report.at, by: report.by, week: report.week, counts };
}

/** How many items need a look in all. */
export function totalOf(report: Report): number {
  return REPORT_SECTIONS.reduce((sum, section) => sum + countOf(report, section), 0);
}

/** The items of each room, in the report's order. */
export function itemsByRoom(report: Report): Map<string, [ReportSection, ReportItem][]> {
  const rooms = new Map<string, [ReportSection, ReportItem][]>();
  for (const section of REPORT_SECTIONS) {
    for (const item of report.sections[section] ?? []) {
      if (!item.room) continue;
      rooms.set(item.room, [...(rooms.get(item.room) ?? []), [section, item]]);
    }
  }
  return rooms;
}

/** The change from the week before, in whole percent; none without both weeks. */
export function changeOf(energy: EnergyPair | undefined): number | undefined {
  if (energy?.week === undefined || energy.before === undefined || energy.before <= 0) {
    return undefined;
  }
  return Math.round(((energy.week - energy.before) / energy.before) * 100);
}

export { formatKwh } from "./closed-energy";

/** How a moment is written: its language, time zone and clock. */
export interface Moments {
  language: string;
  timeZone?: string;
  hour12?: boolean;
}

function format(at: string, style: Moments, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  try {
    return new Intl.DateTimeFormat(style.language, {
      ...options,
      timeZone: style.timeZone,
      hour12: options.hour === undefined ? undefined : style.hour12,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** A day: "Tuesday 20 October". */
export function dayText(at: string, style: Moments): string {
  return format(at, style, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * A day in short: "20 October". A calendar day (`YYYY-MM-DD`, an upkeep task's) is that day
 * wherever the viewer is; a moment is its day where they are.
 */
export function shortDay(at: string, style: Moments): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  if (day) {
    const utc = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    return format(
      utc.toISOString(),
      { ...style, timeZone: "UTC" },
      { day: "numeric", month: "long" },
    );
  }
  return format(at, style, { day: "numeric", month: "long" });
}

/** An hour: "06:00". */
export function hourText(at: string, style: Moments): string {
  return format(at, style, { hour: "2-digit", minute: "2-digit" });
}

/** The week's first and last days (its end is the midnight after its last day). */
export function weekDays(span: { start: string; end: string }): { first: string; last: string } {
  const end = Date.parse(span.end);
  return {
    first: span.start,
    last: Number.isFinite(end) ? new Date(end - 1000).toISOString() : span.end,
  };
}

/** What an item says beyond its name, in words, as it stood `at` (when the report was written). */
export function itemDetail(
  t: Translator,
  section: ReportSection,
  item: ReportItem,
  style: Moments,
  at: number,
): string {
  const parts: string[] = [];
  switch (section) {
    case "batteries":
      if (item.level !== undefined) parts.push(t.t("weekly.detail.level", { level: item.level }));
      if (item.battery) parts.push(item.battery);
      break;
    case "unavailable":
      if (item.since) {
        const days = Math.floor((at - Date.parse(item.since)) / 86_400_000);
        parts.push(
          days >= 1
            ? t.tp("weekly.detail.unavailable_days", days)
            : t.t("weekly.detail.unavailable_since", { at: hourText(item.since, style) }),
        );
      }
      break;
    case "updates":
      if (item.latest) {
        parts.push(
          item.installed
            ? t.t("weekly.detail.version", { from: item.installed, to: item.latest })
            : item.latest,
        );
      }
      break;
    case "repairs":
      if (item.missing) {
        parts.push(
          t.t(
            item.missing === "entity"
              ? "weekly.detail.missing_entity"
              : "weekly.detail.missing_action",
          ),
        );
      } else if (item.severity === "critical" || item.severity === "error") {
        parts.push(t.t(`weekly.severity.${item.severity}`));
      }
      break;
    case "upkeep":
      if (item.warranty_end) {
        parts.push(t.t("weekly.detail.warranty", { day: shortDay(item.warranty_end, style) }));
      } else if (item.task) {
        parts.push(item.task);
        if (item.due) {
          parts.push(
            t.t(item.state === "overdue" ? "weekly.detail.overdue" : "weekly.detail.due", {
              day: shortDay(item.due, style),
            }),
          );
        }
      }
      break;
    case "automations":
      if (item.problem === "failed") {
        parts.push(t.tp("weekly.detail.failed", item.runs ?? 1));
        if (item.error) parts.push(item.error);
      } else if (item.problem === "broken") {
        parts.push(t.t("weekly.detail.broken"));
      } else if (item.problem === "never") {
        parts.push(t.t("weekly.detail.never"));
      }
      break;
    case "radios":
      parts.push(
        item.cut || item.lqi === undefined
          ? t.t("weekly.detail.cut")
          : t.tp("weekly.detail.weak", item.hops ?? 1, { lqi: item.lqi }),
      );
      break;
  }
  return parts.join(" · ");
}

/** Where an item opens in Home Assistant: a page, or an entity's dialog. */
export type ItemLink = { path: string } | { entity: string };

/** Where an item opens; none for what Home Assistant has no page of (Watchman's findings). */
export function itemLink(section: ReportSection, item: ReportItem): ItemLink | undefined {
  const device = item.device
    ? { path: `/config/devices/device/${encodeURIComponent(item.device)}` }
    : undefined;
  const entity = item.entity && isEntityId(item.entity) ? { entity: item.entity } : undefined;
  switch (section) {
    case "batteries":
    case "unavailable":
    case "radios":
      return device ?? entity;
    case "updates":
      return entity;
    case "repairs":
      return item.domain === "watchman" ? undefined : { path: "/config/repairs" };
    case "automations": {
      if (!item.id) return entity;
      const id = encodeURIComponent(item.id);
      if (item.problem === "failed") {
        const run = item.run_id ? `?run_id=${encodeURIComponent(item.run_id)}` : "";
        return { path: `/config/automation/trace/${id}${run}` };
      }
      return { path: `/config/automation/edit/${id}` };
    }
    case "upkeep":
      return undefined;
  }
}

/** Whether Home Assistant has its Maintenance page (2026.5 and later): the batteries, by area. */
export function hasMaintenancePage(hass: HomeAssistant): boolean {
  return hass.panels?.maintenance !== undefined;
}

// The plan the report is drawn on.

/** A room of a storey, as drawn: its outline (cm) and where its label goes. */
export interface PlanRoom {
  id: string;
  name: string;
  points: [number, number][];
  label: [number, number];
}

/** A storey as drawn, with the box around its rooms. */
export interface PlanStorey {
  storey: string;
  name: string;
  rooms: PlanRoom[];
  box: { x: number; y: number; width: number; height: number };
}

/** Where a polygon's label goes: its centroid (inside for the convex rooms most rooms are). */
export function labelPoint(points: readonly [number, number][]): [number, number] {
  let area = 0;
  let x = 0;
  let y = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length] ?? [x0, y0];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  });
  if (Math.abs(area) < 1e-9) {
    const n = Math.max(points.length, 1);
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * area), y / (3 * area)];
}

/** The rooms of each storey's plan, their outlines read as the plan format writes them. */
export function planStoreys(
  plans: readonly { storey: string; name: string; plan: unknown }[],
): PlanStorey[] {
  return plans.flatMap(({ storey, name, plan }): PlanStorey[] => {
    const listed = isObject(plan) && Array.isArray(plan.rooms) ? plan.rooms : [];
    const rooms = listed.flatMap((room): PlanRoom[] => {
      if (!isObject(room) || typeof room.id !== "string" || !Array.isArray(room.outline)) return [];
      const points = room.outline.flatMap((p): [number, number][] =>
        Array.isArray(p) && number(p[0]) !== undefined && number(p[1]) !== undefined
          ? [[p[0] as number, p[1] as number]]
          : [],
      );
      if (points.length < 3) return [];
      return [
        {
          id: room.id,
          name: typeof room.name === "string" && room.name ? room.name : room.id,
          points,
          label: labelPoint(points),
        },
      ];
    });
    if (rooms.length === 0) return [];
    const xs = rooms.flatMap((room) => room.points.map((p) => p[0]));
    const ys = rooms.flatMap((room) => room.points.map((p) => p[1]));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      {
        storey,
        name,
        rooms,
        box: {
          x,
          y,
          width: Math.max(Math.max(...xs) - x, 1),
          height: Math.max(Math.max(...ys) - y, 1),
        },
      },
    ];
  });
}

/** How strongly a room is tinted: by how many items need a look in it. */
export function tintOf(count: number): 0 | 1 | 2 | 3 {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
}
