/**
 * The demo house's weekly report (D-066): last week's and this week's, made up for its rooms and
 * devices, answered as the integration would; another one written in the page. No AI task, no
 * radios, no Hydro-Québec peaks: the demo house has none of them.
 */
import type { Report, ReportAnswer, ReportItem, ReportSettings } from "../live/report";
import { DEFAULT_SETTINGS, readSettings, summaryOf } from "../live/report";
import { DemoError } from "./home";
import { say, type Words } from "./house";

const DAY_MS = 86_400_000;

/** Midnight before `at` (ms), in this device's time zone: the demo's clock is a wall clock. */
function midnight(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export class DemoReport {
  private readonly reports: Report[];
  private settings: ReportSettings = { ...DEFAULT_SETTINGS };

  /** Last week's and this week's, written on Monday mornings before `now` (ms), in `language`. */
  constructor(
    now: number,
    language: string,
    private readonly clock: () => number,
  ) {
    const named = (words: Words): string => say(words, language);
    const iso = (at: number): string => new Date(at).toISOString();
    // This week's was written on the last Monday at 8, the one before a week earlier.
    const today = new Date(midnight(now));
    const back = (today.getDay() + 6) % 7;
    const monday = midnight(today.getTime() - back * DAY_MS + DAY_MS / 2);
    const week = (end: number): Report["week"] => ({
      start: iso(midnight(end - 7 * DAY_MS + DAY_MS / 2)),
      end: iso(end),
    });
    const day = (from: number, days: number): string => {
      const at = new Date(from + days * DAY_MS + DAY_MS / 2);
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    };
    const lock: ReportItem = {
      key: "battery:demo-front-door-lock",
      name: named(["Front door lock", "Serrure de la porte d’entrée"]),
      entity: "sensor.front_door_lock_battery",
      level: 14,
      battery: "4x AA",
      room: "hall",
    };
    const leak: ReportItem = {
      key: "battery:demo-laundry-leak",
      name: named(["Laundry leak sensor", "Détecteur de fuite de la buanderie"]),
      entity: "binary_sensor.laundry_leak",
      level: 9,
      battery: "CR2032",
      room: "laundry",
    };
    const smoke: ReportItem = {
      key: "battery:demo-landing-smoke",
      name: named(["Landing smoke alarm", "Détecteur de fumée du palier"]),
      entity: "binary_sensor.landing_smoke",
      level: 11,
      room: "u-landing",
    };
    const window_: ReportItem = {
      key: "unavailable:demo-guest-window",
      name: named(["Guest room window sensor", "Capteur de fenêtre de la chambre d’amis"]),
      since: iso(monday - 2 * DAY_MS - 5 * 3_600_000),
      room: "u-guest",
    };
    const robot: ReportItem = {
      key: "update:update.robot_firmware:3.4.0",
      name: named(["Robot vacuum firmware", "Micrologiciel de l’aspirateur robot"]),
      installed: "3.2.1",
      latest: "3.4.0",
      room: "living",
    };
    const core: ReportItem = {
      key: "update:update.home_assistant_core:2026.10.2",
      name: "Home Assistant Core",
      installed: "2026.10.1",
      latest: "2026.10.2",
    };
    const weather: ReportItem = {
      key: "repair:demo:weather_login",
      name: named([
        "The weather service needs you to sign in again",
        "Le service météo demande de se reconnecter",
      ]),
      domain: "demo",
      severity: "error",
    };
    const filter: ReportItem = {
      key: "upkeep:washer:Clean the filter",
      name: named(["Washing machine", "Lave-linge"]),
      piece: "washer",
      task: named(["Clean the filter", "Nettoyer le filtre"]),
      due: day(monday, 5),
      state: "due",
      room: "laundry",
    };
    const curtains: ReportItem = {
      key: "automation:automation.morning_curtains:failed",
      name: named(["Curtains in the morning", "Rideaux le matin"]),
      entity: "automation.morning_curtains",
      problem: "failed",
      runs: 1,
      last: iso(monday - 3 * DAY_MS + 7 * 3_600_000),
      error: named(["Bedroom curtains: unavailable", "Rideaux de la chambre : indisponibles"]),
    };
    const clean: ReportItem = {
      key: "automation:automation.clean_when_quiet:never",
      name: named(["Clean when nobody is home", "Nettoyer quand personne n’est là"]),
      entity: "automation.clean_when_quiet",
      problem: "never",
    };
    const before = monday - 7 * DAY_MS;
    this.reports = [
      {
        id: 1,
        at: iso(before + 8 * 3_600_000),
        by: "schedule",
        week: week(before),
        sections: {
          batteries: [smoke, lock],
          unavailable: [],
          updates: [core],
          repairs: [],
          upkeep: [],
          automations: [clean],
        },
        energy: {
          home: { week: 196.1, before: 188.7 },
          grid: { week: 150.2, before: 141.5 },
          solar: { week: 52.3, before: 55.0 },
        },
      },
      {
        id: 2,
        at: iso(monday + 8 * 3_600_000),
        by: "schedule",
        week: week(monday),
        sections: {
          batteries: [{ ...leak, new: true }, lock],
          unavailable: [{ ...window_, new: true }],
          updates: [{ ...robot, new: true }, core],
          repairs: [{ ...weather, new: true }],
          upkeep: [{ ...filter, new: true }],
          automations: [{ ...curtains, new: true }, clean],
        },
        gone: { batteries: [{ key: smoke.key, name: smoke.name }] },
        energy: {
          home: { week: 182.4, before: 196.1 },
          grid: { week: 120.4, before: 150.2 },
          solar: { week: 70.1, before: 52.3 },
          rooms: {
            kitchen: { week: 28.3, before: 31.0 },
            laundry: { week: 22.5, before: 19.8 },
            living: { week: 14.2, before: 15.1 },
            office: { week: 9.6, before: 9.9 },
            "u-bathroom": { week: 11.4, before: 12.6 },
            "u-children": { week: 3.2, before: 3.4 },
          },
        },
      },
    ];
  }

  /** As `domotwin/report/get` answers. */
  get(id?: number): ReportAnswer {
    const report = id === undefined ? this.reports.at(-1) : this.reports.find((r) => r.id === id);
    if (!report) throw new DemoError("unknown_report", "no report has this id");
    return this.answer(report);
  }

  /** As `domotwin/report/write` answers: one written now, saying what this week's says. */
  write(): ReportAnswer {
    const newest = this.reports.at(-1);
    if (!newest) throw new DemoError("unknown_report", "no report");
    const sections = Object.fromEntries(
      Object.entries(newest.sections).map(([section, items]) => [
        section,
        items.map((item) => {
          const kept = { ...item };
          delete kept.new;
          return kept;
        }),
      ]),
    );
    const written: Report = {
      ...structuredClone(newest),
      id: newest.id + 1,
      at: new Date(this.clock()).toISOString(),
      by: "hand",
      sections,
    };
    delete written.gone;
    this.reports.push(written);
    return this.answer(written);
  }

  /** As `domotwin/report/settings` answers. */
  save(change: unknown): { settings: ReportSettings } {
    if (typeof change !== "object" || change === null) throw new DemoError("invalid", "settings");
    this.settings = readSettings({ ...this.settings, ...change });
    return { settings: this.settings };
  }

  private answer(report: Report): ReportAnswer {
    return {
      settings: this.settings,
      reports: [...this.reports].reverse().map(summaryOf),
      report: structuredClone(report),
    };
  }
}
