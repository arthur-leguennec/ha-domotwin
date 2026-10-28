import { describe, expect, it } from "vitest";

import { DemoHome } from "../src/demo/home";
import type { HomeAssistant } from "../src/ha/types";
import { Translator, addMessages } from "../src/i18n";
import { reportEn, reportFr } from "../src/i18n/report";
import {
  DEFAULT_SETTINGS,
  REPORT_SECTIONS,
  changeOf,
  countOf,
  formatKwh,
  getReport,
  hasMaintenancePage,
  itemDetail,
  itemLink,
  itemsByRoom,
  labelPoint,
  planStoreys,
  readAnswer,
  readReport,
  readSettings,
  saveReportSettings,
  summaryOf,
  tintOf,
  totalOf,
  weekDays,
  writeReport,
  type Moments,
  type Report,
  type ReportItem,
} from "../src/live/report";

addMessages({ en: reportEn, fr: reportFr });

const english = new Translator("en");
const french = new Translator("fr");
const utc: Moments = { language: "en", timeZone: "UTC", hour12: false };

/** A report as the integration writes it (fictional). */
function written(): Record<string, unknown> {
  return {
    id: 7,
    at: "2026-10-26T12:00:00+00:00",
    by: "schedule",
    week: { start: "2026-10-19T04:00:00+00:00", end: "2026-10-26T04:00:00+00:00" },
    sections: {
      batteries: [
        {
          key: "battery:a",
          name: "Hall motion",
          level: 8,
          battery: "CR2032",
          room: "hall",
          new: true,
        },
        { key: "battery:b", name: "Door", entity: "binary_sensor.door_battery" },
        { name: "no key" },
      ],
      unavailable: [
        {
          key: "unavailable:p",
          name: "Plug",
          device: "dev1",
          since: "2026-10-23T12:00:00+00:00",
          room: "hall",
        },
      ],
      updates: [],
      automations: [
        {
          key: "automation:x:failed",
          name: "Evening",
          id: "17",
          problem: "failed",
          runs: 2,
          run_id: "r 1",
          error: "Boom",
        },
        { key: "automation:y:never", name: "Never", id: "18", problem: "never", room: "kitchen" },
      ],
      gardens: [{ key: "g", name: "not a section" }],
    },
    more: { batteries: 3, gardens: 2 },
    gone: { updates: [{ key: "update:u", name: "Router" }] },
    energy: {
      home: { week: 90, before: 100 },
      grid: { week: 80 },
      rooms: { kitchen: { week: 7, before: 5 }, hall: { nothing: 1 } },
    },
    peaks: [
      {
        start: "2026-10-20T10:00:00+00:00",
        end: "2026-10-20T13:00:00+00:00",
        grid: 1.5,
        rooms: { kitchen: 0.4 },
      },
      { start: 3 },
    ],
    closed: {
      week: { kwh: 31.5, share: 38, rooms: { kitchen: 4.2, hall: "much" } },
      before: { share: 35 },
    },
    summary: { by: "ai_task.helper", text: "All is well." },
  };
}

describe("reading the report", () => {
  it("reads what the integration wrote, what it does not understand left out", () => {
    const report = readReport(written());
    expect(report).toBeDefined();
    const read = report as Report;
    expect(read.sections.batteries?.map((item) => item.name)).toEqual(["Hall motion", "Door"]);
    expect(Object.keys(read.sections)).toEqual([
      "batteries",
      "unavailable",
      "updates",
      "automations",
    ]);
    expect(read.more).toEqual({ batteries: 3 });
    expect(read.gone).toEqual({ updates: [{ key: "update:u", name: "Router" }] });
    expect(read.energy?.rooms).toEqual({ kitchen: { week: 7, before: 5 } });
    expect(read.peaks).toEqual([
      {
        start: "2026-10-20T10:00:00+00:00",
        end: "2026-10-20T13:00:00+00:00",
        grid: 1.5,
        rooms: { kitchen: 0.4 },
      },
    ]);
    // A workplace's energy while closed (D-088): a week without its kWh is left out.
    expect(read.closed).toEqual({ week: { kwh: 31.5, share: 38, rooms: { kitchen: 4.2 } } });
    expect(read.summary).toEqual({ by: "ai_task.helper", text: "All is well." });
    expect(countOf(read, "batteries")).toBe(5);
    expect(totalOf(read)).toBe(5 + 1 + 0 + 2);
    expect(readReport({ id: 1 })).toBeUndefined();
    expect(readReport(null)).toBeUndefined();
  });

  it("reads the answer and the settings leniently", () => {
    const answer = readAnswer({
      settings: {
        weekly: false,
        weekday: 9,
        hour: 18,
        notify: "yes",
        summary: "light.x",
        battery: 15,
      },
      reports: [
        {
          id: 7,
          at: "2026-10-26T12:00:00+00:00",
          by: "hand",
          week: written().week,
          counts: { batteries: 5, x: 1 },
        },
        { id: "8" },
      ],
      report: written(),
    });
    expect(answer.settings).toEqual({ ...DEFAULT_SETTINGS, weekly: false, hour: 18, battery: 15 });
    expect(answer.reports).toEqual([
      {
        id: 7,
        at: "2026-10-26T12:00:00+00:00",
        by: "hand",
        week: written().week,
        counts: { batteries: 5 },
      },
    ]);
    expect(answer.report?.id).toBe(7);
    expect(readAnswer(undefined)).toEqual({
      settings: DEFAULT_SETTINGS,
      reports: [],
      report: null,
    });
    expect(readSettings({ summary: "ai_task.helper" }).summary).toBe("ai_task.helper");
  });

  it("lists a report as the integration lists it", () => {
    const report = readReport(written()) as Report;
    expect(summaryOf(report)).toEqual({
      id: 7,
      at: report.at,
      by: "schedule",
      week: report.week,
      counts: { batteries: 5, unavailable: 1, updates: 0, automations: 2 },
    });
  });

  it("asks the integration its commands", async () => {
    const asked: unknown[] = [];
    const hass = {
      language: "en",
      states: {},
      callService: () => Promise.resolve(),
      connection: {
        sendMessagePromise: (message: unknown) => {
          asked.push(message);
          return Promise.resolve({ settings: { hour: 9 }, reports: [], report: null } as never);
        },
        sendMessage: () => undefined,
        subscribeMessage: () => Promise.resolve(() => Promise.resolve()),
      },
    } as HomeAssistant;
    await getReport(hass);
    await getReport(hass, 3);
    await writeReport(hass);
    expect((await saveReportSettings(hass, { hour: 9 })).hour).toBe(9);
    expect(asked).toEqual([
      { type: "domotwin/report/get" },
      { type: "domotwin/report/get", report: 3 },
      { type: "domotwin/report/write" },
      { type: "domotwin/report/settings", settings: { hour: 9 } },
    ]);
  });
});

describe("what each item says", () => {
  const report = readReport(written()) as Report;
  const now = Date.parse("2026-10-26T12:00:00Z");

  it("in words, in English and French", () => {
    const [motion, door] = report.sections.batteries ?? [];
    expect(itemDetail(english, "batteries", motion as ReportItem, utc, now)).toBe("8 % · CR2032");
    expect(itemDetail(english, "batteries", door as ReportItem, utc, now)).toBe("");
    const plug = report.sections.unavailable?.[0] as ReportItem;
    expect(itemDetail(english, "unavailable", plug, utc, now)).toBe("unavailable for 3 days");
    expect(itemDetail(french, "unavailable", plug, utc, now)).toBe("indisponible depuis 3 jours");
    expect(
      itemDetail(english, "unavailable", { ...plug, since: "2026-10-26T10:30:00Z" }, utc, now),
    ).toBe("unavailable since 10:30");
    const [evening, never] = report.sections.automations ?? [];
    expect(itemDetail(english, "automations", evening as ReportItem, utc, now)).toBe(
      "failed 2 times this week · Boom",
    );
    expect(itemDetail(french, "automations", never as ReportItem, utc, now)).toBe(
      "n’a jamais tourné",
    );
    expect(
      itemDetail(
        english,
        "updates",
        { key: "u", name: "Router", installed: "1.2", latest: "1.3" },
        utc,
        now,
      ),
    ).toBe("1.2 → 1.3");
    expect(
      itemDetail(
        english,
        "upkeep",
        { key: "u", name: "Washer", task: "Clean the filter", due: "2026-10-20", state: "overdue" },
        utc,
        now,
      ),
    ).toBe("Clean the filter · overdue since October 20");
    expect(
      itemDetail(
        english,
        "upkeep",
        { key: "w", name: "Fridge", warranty_end: "2026-11-10" },
        utc,
        now,
      ),
    ).toBe("warranty ends November 10");
    expect(
      itemDetail(english, "radios", { key: "r", name: "Plug", lqi: 60, hops: 2 }, utc, now),
    ).toBe("its way's weakest link: LQI 60, 2 hops");
    expect(itemDetail(french, "radios", { key: "r", name: "Plug", cut: true }, utc, now)).toBe(
      "aucun chemin jusqu’au coordinateur",
    );
    expect(
      itemDetail(english, "repairs", { key: "w", name: "light.old", missing: "entity" }, utc, now),
    ).toBe("named in your configuration, not in Home Assistant");
    expect(
      itemDetail(french, "repairs", { key: "r", name: "x", severity: "error" }, utc, now),
    ).toBe("Erreur");
  });

  it("opens where Home Assistant shows it", () => {
    const [motion, door] = report.sections.batteries ?? [];
    expect(itemLink("batteries", motion as ReportItem)).toBeUndefined();
    expect(itemLink("batteries", door as ReportItem)).toEqual({
      entity: "binary_sensor.door_battery",
    });
    expect(itemLink("unavailable", report.sections.unavailable?.[0] as ReportItem)).toEqual({
      path: "/config/devices/device/dev1",
    });
    const [evening, never] = report.sections.automations ?? [];
    expect(itemLink("automations", evening as ReportItem)).toEqual({
      path: "/config/automation/trace/17?run_id=r%201",
    });
    expect(itemLink("automations", never as ReportItem)).toEqual({
      path: "/config/automation/edit/18",
    });
    expect(itemLink("repairs", { key: "r", name: "x", domain: "spook" })).toEqual({
      path: "/config/repairs",
    });
    expect(itemLink("repairs", { key: "w", name: "x", domain: "watchman" })).toBeUndefined();
    expect(itemLink("upkeep", { key: "u", name: "x", piece: "washer" })).toBeUndefined();
  });

  it("by room, with the week's change", () => {
    const rooms = itemsByRoom(report);
    expect([...rooms.keys()]).toEqual(["hall", "kitchen"]);
    expect(rooms.get("hall")?.map(([section, item]) => `${section}:${item.name}`)).toEqual([
      "batteries:Hall motion",
      "unavailable:Plug",
    ]);
    expect(changeOf({ week: 90, before: 100 })).toBe(-10);
    expect(changeOf({ week: 7, before: 5 })).toBe(40);
    expect(changeOf({ week: 7 })).toBeUndefined();
    expect(changeOf({ week: 7, before: 0 })).toBeUndefined();
    expect(formatKwh(12.44, "en")).toBe("12 kWh");
    expect(formatKwh(1.46, "fr")).toBe("1,5 kWh");
    expect(weekDays(report.week).last).toBe("2026-10-26T03:59:59.000Z");
    // A calendar day is that day wherever the viewer is.
    const montreal = { language: "en", timeZone: "America/Toronto" };
    expect(
      itemDetail(
        english,
        "upkeep",
        { key: "w", name: "F", warranty_end: "2026-11-10" },
        montreal,
        0,
      ),
    ).toBe("warranty ends November 10");
    expect([0, 1, 2, 3, 4, 9].map(tintOf)).toEqual([0, 1, 2, 2, 3, 3]);
  });
});

describe("Home Assistant around the report", () => {
  it("says where its Maintenance page is", () => {
    const hass = { states: {}, panels: {} } as unknown as HomeAssistant;
    expect(hasMaintenancePage(hass)).toBe(false);
    expect(
      hasMaintenancePage({ ...hass, panels: { maintenance: { url_path: "maintenance" } } }),
    ).toBe(true);
  });
});

describe("the plans the report is drawn on", () => {
  it("reads each storey's rooms and where their labels go", () => {
    const storeys = planStoreys([
      {
        storey: "ground",
        name: "Ground floor",
        plan: {
          rooms: [
            {
              id: "a",
              name: "Living",
              outline: [
                [0, 0],
                [400, 0],
                [400, 200],
                [0, 200],
              ],
            },
            {
              id: "b",
              outline: [
                [400, 0],
                [600, 0],
                [600, 200],
              ],
            },
            {
              id: "c",
              outline: [
                [0, 0],
                [1, 1],
              ],
            },
            { id: "d", name: "Bad", outline: "no" },
          ],
        },
      },
      { storey: "empty", name: "Attic", plan: { rooms: [] } },
    ]);
    expect(storeys).toHaveLength(1);
    const ground = storeys[0];
    expect(ground?.rooms.map((room) => [room.id, room.name])).toEqual([
      ["a", "Living"],
      ["b", "b"],
    ]);
    expect(ground?.rooms[0]?.label).toEqual([200, 100]);
    expect(ground?.box).toEqual({ x: 0, y: 0, width: 600, height: 200 });
    // An L-shaped room: its centroid.
    const l = labelPoint([
      [0, 0],
      [200, 0],
      [200, 100],
      [100, 100],
      [100, 200],
      [0, 200],
    ]);
    expect(l[0]).toBeCloseTo(83.33, 1);
    expect(l[1]).toBeCloseTo(83.33, 1);
  });
});

describe("the demo house's report", () => {
  it("answers as the integration would, another one written in the page", async () => {
    const demo = new DemoHome({ language: "fr" });
    const send = <T>(message: Record<string, unknown>): Promise<T> =>
      demo.hass.connection.sendMessagePromise<T>(message as never);
    const answer = readAnswer(await send({ type: "domotwin/report/get" }));
    expect(answer.reports.map((entry) => entry.id)).toEqual([2, 1]);
    const report = answer.report as Report;
    expect(report.sections.batteries?.[0]?.name).toBe("Détecteur de fuite de la buanderie");
    expect(report.sections.batteries?.[0]?.new).toBe(true);
    expect(report.gone?.batteries?.[0]?.name).toBe("Détecteur de fumée du palier");
    expect(Object.keys(report.energy?.rooms ?? {})).toContain("u-bathroom");
    // Every room it names is a room of the demo house.
    const rooms = new Set(
      planStoreys(
        await Promise.all(
          ["ground", "upper"].map(async (storey) => ({
            storey,
            name: storey,
            plan: (await send<{ plan: unknown }>({ type: "domotwin/plan/get", storey })).plan,
          })),
        ),
      ).flatMap((storey) => storey.rooms.map((room) => room.id)),
    );
    const named = REPORT_SECTIONS.flatMap((section) =>
      (report.sections[section] ?? []).flatMap((item) => (item.room ? [item.room] : [])),
    );
    for (const room of [...named, ...Object.keys(report.energy?.rooms ?? {})]) {
      expect(rooms.has(room), room).toBe(true);
    }
    const first = readAnswer(await send({ type: "domotwin/report/get", report: 1 }));
    expect(first.report?.id).toBe(1);
    const again = readAnswer(await send({ type: "domotwin/report/write" }));
    expect(again.report?.by).toBe("hand");
    expect(again.report?.id).toBe(3);
    expect(again.report?.sections.batteries?.some((item) => item.new)).toBe(false);
    const saved = await send<{ settings: unknown }>({
      type: "domotwin/report/settings",
      settings: { hour: 19 },
    });
    expect(readSettings(saved.settings).hour).toBe(19);
    await expect(send({ type: "domotwin/report/get", report: 99 })).rejects.toMatchObject({
      code: "unknown_report",
    });
  });
});

describe("its messages", () => {
  it("have the same placeholders in both languages", () => {
    const leaves = (value: unknown, prefix = ""): [string, string][] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            leaves(child, prefix ? `${prefix}.${key}` : key),
          )
        : [[prefix, String(value)]];
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    const french = new Map(leaves(reportFr));
    for (const [key, text] of leaves(reportEn)) {
      expect(french.has(key), key).toBe(true);
      expect(placeholders(french.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });
});
