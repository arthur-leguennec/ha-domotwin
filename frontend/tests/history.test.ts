import { describe, expect, it } from "vitest";

import { demoHistory, demoLogbook } from "../src/demo/history";
import { at } from "../src/demo/day";
import type { HomeAssistant } from "../src/ha/types";
import { en, fr } from "../src/i18n";
import { historyEn, historyFr } from "../src/i18n/history";
import {
  DAY_MS,
  HOUR,
  NO_FILTER,
  beyondKept,
  changeRows,
  csvCell,
  filterProblem,
  filterRows,
  fromInputValue,
  haPagePath,
  hoursFromChanges,
  inputValue,
  logbookCsv,
  matchesValue,
  periodOf,
  periodProblem,
  readHistory,
  readLogbook,
  readStatistics,
  roomSensors,
  rowsCsv,
  searchLogbook,
  statisticsRows,
  totalTime,
  wholeHours,
  type Change,
  type Row,
} from "../src/live/history";

/** A fictional afternoon: 2026-03-02, from noon (UTC). */
const NOON = Date.UTC(2026, 2, 2, 12);
const MIN = 60_000;
const s = (ms: number): number => ms / 1000;

describe("periods (D-058)", () => {
  it("end now, or are two dates not in the future", () => {
    expect(periodOf("day", NOON)).toEqual({ start: NOON - DAY_MS, end: NOON });
    expect(periodOf("year", NOON)).toEqual({ start: NOON - 365 * DAY_MS, end: NOON });
    expect(periodOf("custom", NOON, NOON - HOUR, NOON + HOUR)).toEqual({
      start: NOON - HOUR,
      end: NOON,
    });
    expect(periodOf("custom", NOON, NOON + HOUR, NOON + 2 * HOUR)).toBeUndefined();
    expect(periodOf("custom", NOON, undefined, NOON)).toBeUndefined();
  });

  it("read changes and the logbook 31 days at most, hours further back", () => {
    const month = { start: NOON - 30 * DAY_MS, end: NOON };
    const year = { start: NOON - 365 * DAY_MS, end: NOON };
    expect(periodProblem("changes", month)).toBeUndefined();
    expect(periodProblem("changes", year)).toBe("too_long");
    expect(periodProblem("logbook", year)).toBe("too_long");
    expect(periodProblem("hours", year)).toBeUndefined();
    expect(periodProblem("hours", undefined)).toBe("no_period");
    // A month of 31 days across the change of time back is 31 days and an hour.
    const october = {
      start: fromInputValue("2026-10-01T00:00", "Europe/Paris") ?? 0,
      end: fromInputValue("2026-11-01T00:00", "Europe/Paris") ?? 0,
    };
    expect(october.end - october.start).toBe(31 * DAY_MS + HOUR);
    expect(periodProblem("changes", october)).toBeUndefined();
    expect(periodProblem("changes", { ...october, end: october.end + DAY_MS })).toBe("too_long");
    expect(beyondKept(month, NOON)).toBe(true);
    expect(beyondKept({ start: NOON - 7 * DAY_MS }, NOON)).toBe(false);
  });

  it("open Home Assistant's own pages on the same entities and period", () => {
    const path = haPagePath("history", ["sensor.a", "light.b"], { start: NOON - HOUR, end: NOON });
    const url = new URL(path, "http://ha.invalid");
    expect(url.pathname).toBe("/history");
    expect(url.searchParams.get("entity_id")).toBe("sensor.a,light.b");
    expect(url.searchParams.get("start_date")).toBe("2026-03-02T11:00:00.000Z");
    expect(url.searchParams.get("end_date")).toBe("2026-03-02T12:00:00.000Z");
    expect(haPagePath("logbook", ["light.b"], { start: NOON, end: NOON })).toMatch(/^\/logbook\?/);
  });

  it("are written and read where the home is, through changes of time", () => {
    // Paris: UTC+1 in March, UTC+2 from the last Sunday of March (2026-03-29).
    expect(inputValue(NOON, "Europe/Paris")).toBe("2026-03-02T13:00");
    expect(fromInputValue("2026-03-02T13:00", "Europe/Paris")).toBe(NOON);
    expect(fromInputValue("2026-03-30T14:00", "Europe/Paris")).toBe(Date.UTC(2026, 2, 30, 12));
    expect(inputValue(Date.UTC(2026, 6, 1, 4), "America/Toronto")).toBe("2026-07-01T00:00");
    expect(fromInputValue("2026-07-01T00:00", "America/Toronto")).toBe(Date.UTC(2026, 6, 1, 4));
    // An unknown time zone is this device's; what is not a date is none.
    const local = new Date(2026, 2, 2, 9, 30).getTime();
    expect(fromInputValue("2026-03-02T09:30", "Nowhere/Fictional")).toBe(local);
    expect(fromInputValue("tomorrow", "Europe/Paris")).toBeUndefined();
  });
});

describe("reading Home Assistant's answers (D-058)", () => {
  it("reads the history's compressed states, the state at the start first, once each", () => {
    const answer = {
      "sensor.bedroom_temperature": [
        // The state at the start: its time is the start's.
        { s: "23.5", lu: s(NOON) },
        { s: "24.2", lu: s(NOON + 10 * MIN) },
        // An attribute changed: the same state again.
        { s: "24.2", lu: s(NOON + 12 * MIN) },
        { s: "24.6", lu: s(NOON + 20 * MIN), lc: s(NOON + 19 * MIN) },
        { s: 25, lu: s(NOON + 30 * MIN) },
        { lu: s(NOON + 31 * MIN) },
      ],
      "light.bedside": [
        { s: "off", lu: s(NOON - HOUR) },
        { s: "on", lu: s(NOON + 5 * MIN) },
        // Two states at the same moment: the later one.
        { s: "off", lu: s(NOON + 5 * MIN) },
      ],
      "switch.nothing": "not a list",
    };
    const read = readHistory(answer, NOON);
    expect(read.get("sensor.bedroom_temperature")).toEqual([
      { at: NOON, state: "23.5" },
      { at: NOON + 10 * MIN, state: "24.2" },
      { at: NOON + 19 * MIN, state: "24.6" },
    ]);
    expect(read.get("light.bedside")).toEqual([{ at: NOON, state: "off" }]);
    expect(read.has("switch.nothing")).toBe(false);
    expect(readHistory(null, NOON).size).toBe(0);
  });

  it("reads the hours of the statistics, in milliseconds", () => {
    const read = readStatistics({
      "sensor.bedroom_temperature": [
        { start: NOON + HOUR, end: NOON + 2 * HOUR, mean: 24.4, min: 24.1, max: 24.9 },
        { start: NOON, end: NOON + HOUR, mean: 23.9, min: 23.5, max: 24.2, change: null },
        { start: NOON, end: NOON, mean: 1 },
      ],
      "sensor.energy": [{ start: NOON, end: NOON + HOUR, change: 1.25 }],
      "sensor.empty": [{ start: NOON, end: NOON + HOUR }],
    });
    expect(read.get("sensor.bedroom_temperature")).toEqual([
      { start: NOON, end: NOON + HOUR, mean: 23.9, min: 23.5, max: 24.2 },
      { start: NOON + HOUR, end: NOON + 2 * HOUR, mean: 24.4, min: 24.1, max: 24.9 },
    ]);
    expect(read.get("sensor.energy")).toEqual([{ start: NOON, end: NOON + HOUR, change: 1.25 }]);
    expect(read.has("sensor.empty")).toBe(false);
  });

  it("reads the logbook, its causes, oldest first", () => {
    const entries = readLogbook([
      {
        when: s(NOON + 20 * MIN),
        entity_id: "lock.front_door",
        state: "locked",
        context_event_type: "automation_triggered",
        context_domain: "automation",
        context_entity_id: "automation.lock_when_away",
        context_name: "Lock when away",
      },
      { when: s(NOON), entity_id: "light.hall", state: "on", context_user_id: "user-1" },
      {
        when: s(NOON + 5 * MIN),
        name: "Good night",
        message: "triggered by time",
        domain: "automation",
        entity_id: "automation.good_night",
      },
      {
        when: s(NOON + 6 * MIN),
        entity_id: "light.hall",
        state: "off",
        context_domain: "light",
        context_service: "turn_off",
      },
      { when: "not a time", entity_id: "light.hall", state: "on" },
      { when: s(NOON), state: "on" },
    ]);
    expect(entries.map((entry) => entry.when)).toEqual([
      NOON,
      NOON + 5 * MIN,
      NOON + 6 * MIN,
      NOON + 20 * MIN,
    ]);
    expect(entries[0]).toEqual({
      when: NOON,
      entity: "light.hall",
      state: "on",
      cause: { user: "user-1" },
    });
    expect(entries[1]).toMatchObject({ name: "Good night", message: "triggered by time" });
    expect(entries[2]?.cause).toEqual({ service: "light.turn_off" });
    expect(entries[3]?.cause).toEqual({
      name: "Lock when away",
      entity: "automation.lock_when_away",
    });
    expect(readLogbook({})).toEqual([]);
  });

  it("searches the logbook: every word, accents and case aside", () => {
    const entries = readLogbook([
      { when: 1, entity_id: "light.entree", state: "on" },
      { when: 2, entity_id: "light.salon", state: "off" },
    ]);
    const words = (entry: (typeof entries)[number]): string =>
      `${entry.entity === "light.entree" ? "Entrée" : "Salon"} ${entry.state ?? ""}`;
    expect(searchLogbook(entries, "ENTREE on", words).map((e) => e.entity)).toEqual([
      "light.entree",
    ]);
    expect(searchLogbook(entries, "  ", words)).toHaveLength(2);
    expect(searchLogbook(entries, "kitchen", words)).toEqual([]);
  });
});

describe("rows (D-058)", () => {
  const period = { start: NOON, end: NOON + 3 * HOUR };
  const temperature: Change[] = [
    { at: NOON - HOUR, state: "23.0" },
    { at: NOON + 30 * MIN, state: "24.5" },
    { at: NOON + 60 * MIN, state: "25.0" },
    { at: NOON + 150 * MIN, state: "23.8" },
  ];

  it("lasts from each change to the next, the last one until now", () => {
    const rows = changeRows("sensor.t", temperature, period, NOON + 3 * HOUR);
    expect(rows.map((row) => [row.start, row.end, row.state])).toEqual([
      [NOON, NOON + 30 * MIN, "23.0"],
      [NOON + 30 * MIN, NOON + 60 * MIN, "24.5"],
      [NOON + 60 * MIN, NOON + 150 * MIN, "25.0"],
      [NOON + 150 * MIN, NOON + 180 * MIN, "23.8"],
    ]);
    expect(rows[0]?.mean).toBe(23);
    expect(rows[3]?.ongoing).toBe(true);
    // A period that ended before now: nothing goes on.
    expect(changeRows("sensor.t", temperature, period, NOON + 9 * HOUR)[3]?.ongoing).toBe(
      undefined,
    );
  });

  it("are the hours that ended, aligned on whole hours", () => {
    expect(
      wholeHours({ start: NOON - 20 * MIN, end: NOON + 2 * HOUR + 5 * MIN }, NOON + 9 * HOUR),
    ).toEqual([NOON, NOON + HOUR]);
    // The hour going on is not one yet.
    expect(wholeHours(period, NOON + 90 * MIN)).toEqual([NOON]);
  });

  it("works an hour out from the changes: a mean weighted by time, or the state held longest", () => {
    const hours = hoursFromChanges("sensor.t", temperature, period, NOON + 3 * HOUR);
    expect(hours).toHaveLength(3);
    expect(hours[0]).toMatchObject({ kind: "hour", start: NOON, min: 23, max: 24.5 });
    expect(hours[0]?.mean).toBeCloseTo(23.75);
    expect(hours[1]).toMatchObject({ mean: 25, min: 25, max: 25 });
    expect(hours[2]?.mean).toBeCloseTo((25 * 30 + 23.8 * 30) / 60);
    const door: Change[] = [
      { at: NOON + 10 * MIN, state: "off" },
      { at: NOON + 20 * MIN, state: "on" },
      { at: NOON + 55 * MIN, state: "off" },
    ];
    const doorHours = hoursFromChanges("binary_sensor.door", door, period, NOON + 3 * HOUR);
    // Before anything was recorded, no hour; then the state held longest, and how long.
    expect(doorHours[0]).toMatchObject({ start: NOON, state: "on", held: 35 * MIN });
    expect(doorHours[0]?.mean).toBeUndefined();
    expect(doorHours[1]).toMatchObject({ state: "off", held: HOUR });
    expect(hoursFromChanges("x.y", [], period, NOON + 3 * HOUR)).toEqual([]);
  });

  it("keeps the statistics' hours that ended in the period", () => {
    const rows = statisticsRows(
      "sensor.t",
      [
        { start: NOON - HOUR, end: NOON, mean: 1 },
        { start: NOON, end: NOON + HOUR, mean: 23.9, min: 23.5, max: 24.2 },
        { start: NOON + HOUR, end: NOON + 2 * HOUR, change: 0.5 },
      ],
      period,
      NOON + 90 * MIN,
    );
    expect(rows).toEqual([
      {
        kind: "hour",
        entity: "sensor.t",
        start: NOON,
        end: NOON + HOUR,
        mean: 23.9,
        min: 23.5,
        max: 24.2,
      },
    ]);
  });
});

describe("filters (D-058)", () => {
  const row = (state: string, start = 0, end = HOUR): Row => {
    const made: Row = { kind: "change", entity: "x.y", start, end, state };
    const value = Number(state);
    if (state.trim() !== "" && Number.isFinite(value)) made.mean = made.min = made.max = value;
    return made;
  };

  it("say what they need", () => {
    expect(filterProblem(NO_FILTER)).toBeUndefined();
    expect(filterProblem({ compare: "above", value: "warm", atLeast: 0 })).toBe("number_needed");
    expect(filterProblem({ compare: "above", value: "24,5", atLeast: 0 })).toBe("number_needed");
    expect(filterProblem({ compare: "below", value: " 18 ", atLeast: 0 })).toBeUndefined();
    expect(filterProblem({ compare: "equal", value: " ", atLeast: 0 })).toBe("value_needed");
  });

  it("compare numbers as numbers, other states as stored or as shown", () => {
    const above = { compare: "above" as const, value: "24", atLeast: 0 };
    expect(matchesValue(row("24.1"), above)).toBe(true);
    expect(matchesValue(row("24"), above)).toBe(false);
    expect(matchesValue(row("unavailable"), above)).toBe(false);
    expect(matchesValue(row("17.5"), { compare: "below", value: "18", atLeast: 0 })).toBe(true);
    const equal = { compare: "equal" as const, value: "20", atLeast: 0 };
    expect(matchesValue(row("20.0"), equal)).toBe(true);
    const on = { compare: "equal" as const, value: " Allumé ", atLeast: 0 };
    expect(matchesValue(row("on"), on, () => "allumé")).toBe(true);
    expect(matchesValue(row("on"), { ...on, value: "ON" })).toBe(true);
    expect(matchesValue(row("off"), on, () => "Éteint")).toBe(false);
    expect(matchesValue(row("off"), { ...on, compare: "not_equal" }, () => "Éteint")).toBe(true);
  });

  it("make the bedroom above 24 °C for more than an hour one period each time", () => {
    const rows: Row[] = [
      row("23.0", 0, 30 * MIN),
      row("24.5", 30 * MIN, 60 * MIN),
      row("25.2", 60 * MIN, 100 * MIN),
      row("24.1", 100 * MIN, 120 * MIN),
      row("23.5", 120 * MIN, 200 * MIN),
      row("24.8", 200 * MIN, 230 * MIN),
    ];
    const filter = { compare: "above" as const, value: "24", atLeast: HOUR };
    const kept = filterRows(rows, filter);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      kind: "period",
      start: 30 * MIN,
      end: 120 * MIN,
      rows: 3,
      min: 24.1,
      max: 25.2,
    });
    expect(kept[0]?.mean).toBeCloseTo((24.5 * 30 + 25.2 * 40 + 24.1 * 20) / 90);
    // Without the time, the short one too; the total of both.
    const both = filterRows(rows, { ...filter, atLeast: 0 });
    expect(both.map((p) => [p.start, p.end])).toEqual([
      [30 * MIN, 120 * MIN],
      [200 * MIN, 230 * MIN],
    ]);
    expect(totalTime(both)).toBe(120 * MIN);
  });

  it("do not join rows with a gap between them, and keep each entity apart", () => {
    const hour = (entity: string, start: number, mean: number): Row => ({
      kind: "hour",
      entity,
      start,
      end: start + HOUR,
      mean,
      min: mean - 0.5,
      max: mean + 0.5,
    });
    const rows = [
      hour("sensor.a", 0, 25),
      hour("sensor.b", 0, 26),
      hour("sensor.a", HOUR, 25),
      // A missing hour.
      hour("sensor.a", 3 * HOUR, 25),
    ];
    const kept = filterRows(rows, { compare: "above", value: "24", atLeast: 0 });
    expect(kept.map((p) => [p.entity, p.start, p.end, p.state])).toEqual([
      ["sensor.a", 0, 2 * HOUR, undefined],
      ["sensor.b", 0, HOUR, undefined],
      ["sensor.a", 3 * HOUR, 4 * HOUR, undefined],
    ]);
    expect(kept[0]).toMatchObject({ min: 24.5, max: 25.5 });
  });

  it("keep, without a value, the rows that lasted long enough", () => {
    const rows = [row("on", 0, 5 * MIN), row("off", 5 * MIN, 40 * MIN), row("on", 40 * MIN, HOUR)];
    const kept = filterRows(rows, { ...NO_FILTER, atLeast: 10 * MIN });
    expect(kept.map((r) => r.state)).toEqual(["off", "on"]);
    // The same state in a row is one period: the door open for more than 10 minutes.
    const open = filterRows(rows, { compare: "equal", value: "on", atLeast: 10 * MIN });
    expect(open.map((r) => [r.start, r.end, r.state])).toEqual([[40 * MIN, HOUR, "on"]]);
  });
});

describe("CSV (D-058)", () => {
  it("quotes what needs it, and keeps formulas from running", () => {
    expect(csvCell("on")).toBe("on");
    expect(csvCell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+33 1 23")).toBe("'+33 1 23");
    expect(csvCell("-3.5")).toBe("-3.5");
  });

  const names = {
    name: (id: string) => (id === "sensor.t" ? "Bedroom, temperature" : id),
    unit: (id: string) => (id === "sensor.t" ? "°C" : undefined),
  };

  it("writes the rows oldest first, times in UTC, with columns of their own", () => {
    const rows: Row[] = [
      {
        kind: "period",
        entity: "sensor.t",
        start: NOON + HOUR,
        end: NOON + 2 * HOUR,
        mean: 24.56789,
        min: 24.1,
        max: 25.2,
        rows: 2,
      },
      { kind: "change", entity: "light.b", start: NOON, end: NOON + 90_500, state: "on" },
      {
        kind: "hour",
        entity: "binary_sensor.d",
        start: NOON,
        end: NOON + HOUR,
        state: "on",
        held: 35 * MIN,
      },
    ];
    const lines = rowsCsv(rows, names).split("\r\n");
    expect(lines[0]).toBe(
      "entity_id,name,start,end,duration_s,state,held_s,mean,min,max,change,unit",
    );
    expect(lines[1]).toBe(
      "light.b,light.b,2026-03-02T12:00:00.000Z,2026-03-02T12:01:30.500Z,91,on,,,,,,",
    );
    expect(lines[2]).toBe(
      "binary_sensor.d,binary_sensor.d,2026-03-02T12:00:00.000Z,2026-03-02T13:00:00.000Z,3600,on,2100,,,,,",
    );
    expect(lines[3]).toBe(
      'sensor.t,"Bedroom, temperature",2026-03-02T13:00:00.000Z,2026-03-02T14:00:00.000Z,3600,,,24.5679,24.1,25.2,,°C',
    );
    expect(lines[4]).toBe("");
  });

  it("writes the logbook with what caused each entry", () => {
    const entries = readLogbook([
      { when: s(NOON + MIN), entity_id: "lock.front", state: "locked", context_name: "Away" },
      { when: s(NOON), name: "=Trick", message: "ran" },
    ]);
    const lines = logbookCsv(entries, names, (entry) => entry.cause?.name ?? "").split("\r\n");
    expect(lines).toEqual([
      "when,entity_id,name,state,message,caused_by",
      "2026-03-02T12:00:00.000Z,,'=Trick,,ran,",
      "2026-03-02T12:01:00.000Z,lock.front,lock.front,locked,,Away",
      "",
    ]);
  });
});

describe("a room's report (D-058)", () => {
  it("is of its air sensors, temperature first", () => {
    const sensor = (id: string, deviceClass: string) => ({
      entity_id: id,
      state: "1",
      attributes: { device_class: deviceClass },
      last_changed: "",
      last_updated: "",
    });
    const hass = {
      states: {
        "sensor.bedroom_humidity": sensor("sensor.bedroom_humidity", "humidity"),
        "sensor.bedroom_temperature": sensor("sensor.bedroom_temperature", "temperature"),
        "sensor.bedroom_battery": sensor("sensor.bedroom_battery", "battery"),
        "binary_sensor.bedroom_window": sensor("binary_sensor.bedroom_window", "temperature"),
        "sensor.kitchen_temperature": sensor("sensor.kitchen_temperature", "temperature"),
      },
      entities: {
        "sensor.bedroom_humidity": { entity_id: "sensor.bedroom_humidity", area_id: "bedroom" },
        "sensor.bedroom_temperature": {
          entity_id: "sensor.bedroom_temperature",
          area_id: "bedroom",
        },
        "sensor.bedroom_battery": { entity_id: "sensor.bedroom_battery", area_id: "bedroom" },
        "binary_sensor.bedroom_window": {
          entity_id: "binary_sensor.bedroom_window",
          area_id: "bedroom",
        },
        "sensor.kitchen_temperature": {
          entity_id: "sensor.kitchen_temperature",
          area_id: "kitchen",
        },
      },
      language: "en",
      connection: {} as HomeAssistant["connection"],
      callService: () => Promise.resolve(),
    } satisfies HomeAssistant;
    expect(roomSensors(hass, "bedroom")).toEqual([
      "sensor.bedroom_temperature",
      "sensor.bedroom_humidity",
    ]);
    expect(roomSensors(hass, "garage")).toEqual([]);
  });
});

describe("the demo house's history (D-058)", () => {
  // The demo's clock is this device's wall clock: a day of it, from midnight.
  const midnight = new Date(2026, 2, 2).getTime();
  const now = midnight + at(23, 0) * MIN;

  it("is its day, minute by minute, kept ten days", () => {
    const answer = demoHistory(
      [
        "light.living_floor_lamp",
        "sensor.bathroom_humidity",
        "input_boolean.guests",
        "weather.home",
      ],
      midnight,
      now,
      now,
      (id) => (id === "input_boolean.guests" ? "off" : undefined),
    );
    const lamp = answer["light.living_floor_lamp"] ?? [];
    // Off at midnight, on with the evening's scene (19:30), off with the good night (22:45).
    expect(lamp.map((state) => state.s)).toEqual(["off", "on", "off"]);
    expect(lamp[0]?.lu).toBe(midnight / 1000);
    expect(lamp[1]?.lu).toBe((midnight + at(19, 30) * MIN) / 1000);
    expect((answer["sensor.bathroom_humidity"] ?? []).length).toBeGreaterThan(10);
    // What the day does not change keeps its state; the weather follows the day (D-071).
    expect(answer["input_boolean.guests"]).toEqual([{ s: "off", lu: midnight / 1000 }]);
    expect((answer["weather.home"] ?? []).map((state) => state.s)).toContain("lightning-rainy");
    // Asked from a month ago: ten days back at most, as Home Assistant keeps them.
    const month = demoHistory(
      ["light.living_floor_lamp"],
      now - 30 * DAY_MS,
      now,
      now,
      () => undefined,
    );
    expect(month["light.living_floor_lamp"]?.[0]?.lu).toBe((now - 10 * DAY_MS) / 1000);
    expect(demoHistory(["light.x"], now + HOUR, now + 2 * HOUR, now, () => "on")).toEqual({});
  });

  it("has a logbook of its changes, with the automations that made them, and no measurements", () => {
    const entries = demoLogbook(
      ["light.living_floor_lamp", "sensor.bathroom_humidity"],
      midnight,
      now,
      now,
      (id) => (id === "automation.evening_lights" ? "Evening lights" : id),
    );
    expect(entries.every((entry) => entry.entity_id === "light.living_floor_lamp")).toBe(true);
    expect(entries[0]).toEqual({
      when: (midnight + at(19, 30) * MIN) / 1000,
      entity_id: "light.living_floor_lamp",
      state: "on",
      context_event_type: "automation_triggered",
      context_domain: "automation",
      context_entity_id: "automation.evening_lights",
      context_name: "Evening lights",
    });
    expect(readLogbook(entries)[0]?.cause?.name).toBe("Evening lights");
  });
});

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("the reports' messages (D-058)", () => {
  it("have the same keys and placeholders in both languages, none of them the dictionaries'", () => {
    expect(keys(historyFr).sort()).toEqual(keys(historyEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(historyEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(historyEn)) {
      expect(placeholders(lookup(historyFr, key)), key).toEqual(
        placeholders(lookup(historyEn, key)),
      );
    }
  });
});
