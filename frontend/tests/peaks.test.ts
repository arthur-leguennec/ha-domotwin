import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { Translator, en } from "../src/i18n";
import { peakEn, peakFr } from "../src/i18n/peak";
import type { BindingsJson } from "../src/live/bindings";
import { heats, peakRooms } from "../src/live/peak-rooms";
import { peaksAvailable } from "../src/live/peak-sources";
import { peakNow, peakWords, phaseOf, zonedTime } from "../src/live/peaks";

/** An entity of a fictional home: [entity id, state, attributes, registry entry]. */
type Row = [string, string, Record<string, unknown>?, Record<string, unknown>?];

function home(rows: Row[], zone = "America/Toronto"): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  const entities: NonNullable<HomeAssistant["entities"]> = {};
  for (const [id, state, attributes = {}, entry] of rows) {
    states[id] = { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
    if (entry) entities[id] = { entity_id: id, ...entry };
  }
  return {
    states,
    entities,
    devices: {},
    areas: {
      lounge: { area_id: "lounge", name: "Lounge" },
      office: { area_id: "office", name: "Office" },
      laundry: { area_id: "laundry", name: "Laundry" },
    },
    language: "en",
    config: { time_zone: zone },
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

/** hydroqc's sensor of `key`, for the contract `device`, named as a French home names it. */
const hydroqc = (key: string, state: string, device = "contract-1"): Row => [
  `sensor.hydro_quebec_${device.replaceAll("-", "_")}_${key}_fr`,
  state,
  { device_class: "timestamp" },
  { platform: "hydroqc", translation_key: key, device_id: device },
];
const hydropeak = (key: string, state: string): Row => [
  `sensor.credit_hivernal_${key}`,
  state,
  { device_class: "timestamp" },
  { platform: "hydropeak", translation_key: key, device_id: "offer" },
];

const at = (iso: string): number => Date.parse(iso);

describe("Hydro-Québec's peaks (D-058)", () => {
  it("are offered only where an integration reads them", () => {
    const none = home([["sensor.next_peak_start", "2026-01-21T11:00:00+00:00", {}, {}]]);
    expect(peaksAvailable(none)).toBe(false);
    expect(peakNow(none)).toBeUndefined();
    expect(peaksAvailable(undefined)).toBe(false);
  });

  it("read hydroqc's Flex D peak by its kind, whatever its entity is called", () => {
    const hass = home([
      hydroqc("dpc_next_peak_start", "2026-01-21T21:00:00+00:00"),
      hydroqc("dpc_next_peak_end", "2026-01-22T01:00:00+00:00"),
    ]);
    expect(peaksAvailable(hass)).toBe(true);
    // Its pre-heating sensor is off by default: hydroqc's own two hours.
    const peak = { start: at("2026-01-21T21:00:00Z"), end: at("2026-01-22T01:00:00Z") };
    const preheat = at("2026-01-21T19:00:00Z");
    expect(peakNow(hass, at("2026-01-21T12:00:00Z"))).toEqual({
      phase: "upcoming",
      next: preheat,
      peak: { ...peak, preheat },
    });
    expect(peakNow(hass, at("2026-01-21T20:00:00Z"))?.phase).toBe("preheat");
    expect(peakNow(hass, at("2026-01-21T20:00:00Z"))?.next).toBe(peak.start);
    expect(peakNow(hass, at("2026-01-21T21:00:00Z"))?.phase).toBe("peak");
    expect(peakNow(hass, at("2026-01-21T23:00:00Z"))?.next).toBe(peak.end);
    // Over, until hydroqc says the next one.
    expect(peakNow(hass, at("2026-01-22T01:00:00Z"))).toEqual({ phase: "none" });
  });

  it("take the pre-heating the integration says, and its offset as given", () => {
    const hass = home([
      hydroqc("dpc_next_peak_start", "2026-01-21T21:00:00+00:00"),
      hydroqc("dpc_next_peak_end", "2026-01-22T01:00:00+00:00"),
      hydroqc("dpc_next_pre_heat_start", "2026-01-21T19:15:00+00:00"),
    ]);
    expect(peakNow(hass, at("2026-01-21T12:00:00Z"))?.peak?.preheat).toBe(
      at("2026-01-21T19:15:00Z"),
    );
    const peak = home([
      hydropeak("event_start", "2026-01-21T06:00:00-05:00"),
      hydropeak("event_end", "2026-01-21T10:00:00-05:00"),
      hydropeak("preheat_start", "2026-01-21T03:00:00-05:00"),
    ]);
    expect(peakNow(peak, at("2026-01-21T08:30:00Z"))).toEqual({
      phase: "preheat",
      next: at("2026-01-21T11:00:00Z"),
      peak: {
        start: at("2026-01-21T11:00:00Z"),
        end: at("2026-01-21T15:00:00Z"),
        preheat: at("2026-01-21T08:00:00Z"),
      },
    });
  });

  it("show the winter credit's critical peaks, and nothing off season", () => {
    const off = home([
      hydroqc("wc_next_critical_peak_start", "unknown"),
      hydroqc("wc_next_critical_peak_end", "unknown"),
      // The daily windows are not announced peaks.
      hydroqc("wc_next_peak_start", "2026-01-21T11:00:00+00:00"),
      hydroqc("wc_next_peak_end", "2026-01-21T15:00:00+00:00"),
    ]);
    expect(peaksAvailable(off)).toBe(true);
    expect(peakNow(off, at("2026-01-21T08:00:00Z"))).toEqual({ phase: "none" });
    const critical = home([
      hydroqc("wc_next_critical_peak_start", "2026-01-22T11:00:00+00:00"),
      hydroqc("wc_next_critical_peak_end", "2026-01-22T15:00:00+00:00"),
    ]);
    expect(peakNow(critical, at("2026-01-21T08:00:00Z"))?.peak?.start).toBe(
      at("2026-01-22T11:00:00Z"),
    );
  });

  it("pick the soonest of several contracts, each with its own end", () => {
    const hass = home([
      hydroqc("dpc_next_peak_start", "2026-01-23T11:00:00+00:00", "far"),
      hydroqc("dpc_next_peak_end", "2026-01-23T15:00:00+00:00", "far"),
      hydroqc("dpc_next_peak_start", "2026-01-21T21:00:00+00:00", "near"),
      hydroqc("dpc_next_peak_end", "2026-01-22T01:00:00+00:00", "near"),
      // A start without its end says nothing.
      hydroqc("dpc_next_peak_start", "2026-01-20T21:00:00+00:00", "lone"),
    ]);
    expect(peakNow(hass, at("2026-01-21T08:00:00Z"))?.peak?.end).toBe(at("2026-01-22T01:00:00Z"));
  });

  it("read the peak hydroqc wrote in a calendar, in Home Assistant's time zone", () => {
    const description =
      "Pointe critique\nDébut: 16:00\nFin: 20:00\n--- Métadonnées ---\nTarif: DPC\nCritique: Oui\nID: hydroqc_opendata_maison_2026-01-21T16:00:00-05:00";
    const hass = home([
      [
        "calendar.pointes",
        "off",
        {
          message: "🔴 Pointe critique",
          description,
          start_time: "2026-01-21 16:00:00",
          end_time: "2026-01-21 20:00:00",
        },
      ],
      [
        "calendar.family",
        "off",
        { message: "Dentist", start_time: "2026-01-21 09:00:00", end_time: "2026-01-21 10:00:00" },
      ],
    ]);
    expect(peaksAvailable(hass)).toBe(true);
    expect(peakNow(hass, at("2026-01-21T12:00:00Z"))?.peak).toEqual({
      start: at("2026-01-21T21:00:00Z"),
      end: at("2026-01-22T01:00:00Z"),
      preheat: at("2026-01-21T19:00:00Z"),
    });
    const notCritical = home([
      [
        "calendar.pointes",
        "off",
        {
          description: description.replace("Critique: Oui", "Critique: Non"),
          start_time: "2026-01-21 16:00:00",
          end_time: "2026-01-21 20:00:00",
        },
      ],
    ]);
    expect(peaksAvailable(notCritical)).toBe(false);
  });

  it("turn a wall clock into a time, across a change of time", () => {
    expect(zonedTime("2026-01-21 06:00:00", "America/Toronto")).toBe(at("2026-01-21T11:00:00Z"));
    // Summer time from 8 March 2026.
    expect(zonedTime("2026-03-08 06:00:00", "America/Toronto")).toBe(at("2026-03-08T10:00:00Z"));
    expect(zonedTime("2026-03-07 23:30", "America/Toronto")).toBe(at("2026-03-08T04:30:00Z"));
    expect(zonedTime("tomorrow", "America/Toronto")).toBeUndefined();
    expect(zonedTime(undefined, "America/Toronto")).toBeUndefined();
    // A zone this browser does not know: its own.
    expect(zonedTime("2026-01-21 06:00:00", "Mars/Olympus_Mons")).toBe(
      new Date(2026, 0, 21, 6).getTime(),
    );
  });

  it("know where a peak stands", () => {
    const peak = { start: 100, end: 200, preheat: 40 };
    expect(phaseOf(undefined, 0)).toEqual({ phase: "none" });
    expect(phaseOf(peak, 0)).toEqual({ phase: "upcoming", next: 40 });
    expect(phaseOf(peak, 40)).toEqual({ phase: "preheat", next: 100 });
    expect(phaseOf(peak, 150)).toEqual({ phase: "peak", next: 200 });
    expect(phaseOf(peak, 200)).toEqual({ phase: "none" });
  });

  it("say it in words, in Home Assistant's time zone", () => {
    const style = { language: "en", timeZone: "America/Toronto", hour12: false };
    const en = new Translator("en");
    const fr = new Translator("fr");
    const peak = {
      start: at("2026-01-22T11:00:00Z"),
      end: at("2026-01-22T15:00:00Z"),
      preheat: at("2026-01-22T09:00:00Z"),
    };
    const evening = new Date("2026-01-21T23:00:00Z");
    expect(peakWords(en, { phase: "upcoming", peak }, style, evening)).toEqual([
      "Next peak: tomorrow 06:00 to 10:00",
      "Pre-heating from tomorrow 04:00",
    ]);
    expect(
      peakWords(fr, { phase: "upcoming", peak }, { ...style, language: "fr" }, evening),
    ).toEqual(["Prochaine pointe : demain 06:00 à 10:00", "Préchauffage dès demain 04:00"]);
    const morning = new Date("2026-01-22T09:30:00Z");
    expect(peakWords(en, { phase: "preheat", peak }, style, morning)).toEqual([
      "Pre-heating, then the peak from 06:00 to 10:00",
    ]);
    expect(peakWords(en, { phase: "peak", peak }, style, morning)).toEqual(["Peak until 10:00"]);
    expect(peakWords(en, { phase: "none" }, style, morning)).toEqual(["No peak announced"]);
  });
});

describe("the peak's texts (D-058)", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, child]) =>
          keys(child, prefix ? `${prefix}.${key}` : key),
        )
      : [prefix];

  it("are the same in both languages, and not the dictionaries' own", () => {
    expect(keys(peakFr).sort()).toEqual(keys(peakEn).sort());
    const main = new Set(keys(en));
    expect(keys(peakEn).filter((key) => main.has(key))).toEqual([]);
    // The layer's name, in the menu before its chunk loads, stays in the dictionaries.
    expect(main.has("layers.peak")).toBe(true);
  });
});

describe("the rooms around a peak (D-058)", () => {
  const ROOMS = [
    { id: "living", name: "Living room" },
    { id: "office", name: "Office" },
    { id: "laundry", name: "Laundry" },
  ];
  const BINDINGS: BindingsJson = {
    version: 1,
    rooms: { living: { area: "lounge" } },
    elements: {},
  };
  const heater = (state: string, attributes: Record<string, unknown>) => ({
    entity_id: "climate.x",
    state,
    attributes,
    last_changed: "",
    last_updated: "",
  });

  it("know a thermostat heats from what it says, else from its target", () => {
    const hass = home([]);
    expect(heats(hass, heater("heat", { hvac_action: "heating" }))).toBe(true);
    expect(heats(hass, heater("heat", { hvac_action: "idle", temperature: 25 }))).toBe(false);
    expect(heats(hass, heater("off", {}))).toBe(false);
    expect(heats(hass, heater("unavailable", {}))).toBeUndefined();
    expect(heats(hass, heater("heat", { temperature: 22, current_temperature: 20 }))).toBe(true);
    expect(heats(hass, heater("heat", { temperature: 17, current_temperature: 20 }))).toBe(false);
    expect(heats(hass, heater("cool", { temperature: 25, current_temperature: 20 }))).toBe(false);
    expect(heats(hass, heater("heat", { temperature: 22 }))).toBeUndefined();
    // In °F, as Home Assistant's unit system says.
    const fahrenheit = { ...hass, config: { unit_system: { temperature: "°F" } } };
    expect(heats(fahrenheit, heater("heat", { temperature: 70, current_temperature: 68 }))).toBe(
      true,
    );
  });

  const rows: Row[] = [
    ["climate.lounge", "heat", { hvac_action: "heating" }, { area_id: "lounge" }],
    [
      "sensor.lounge_baseboard_power",
      "1.2",
      { device_class: "power", unit_of_measurement: "kW" },
      { area_id: "lounge" },
    ],
    ["climate.office", "heat", { temperature: 17, current_temperature: 20 }, { area_id: "office" }],
    ["sensor.office_power", "3", { device_class: "power", unit_of_measurement: "W" }],
    [
      "sensor.water_heater_power",
      "3000",
      { device_class: "power", unit_of_measurement: "W" },
      { area_id: "laundry" },
    ],
    [
      "sensor.grid_power",
      "4500",
      { device_class: "power", unit_of_measurement: "W" },
      { area_id: "laundry" },
    ],
    [
      "sensor.hidden_power",
      "800",
      { device_class: "power", unit_of_measurement: "W" },
      { area_id: "laundry", hidden: true },
    ],
  ];

  it("pre-heat, shed or still heat, and say what they draw", () => {
    const hass = home(rows);
    // The office's sensor has no area: not the office's.
    const meters = new Set(["sensor.grid_power"]);
    expect(peakRooms(hass, BINDINGS, ROOMS, "peak", new Set(), meters)).toEqual({
      roles: { living: "heating", office: "shed" },
      draws: { living: 1200, laundry: 3000 },
    });
    expect(peakRooms(hass, BINDINGS, ROOMS, "preheat", new Set(), meters).roles).toEqual({
      living: "preheat",
    });
    // Nothing before the pre-heating, nor after the peak.
    expect(peakRooms(hass, BINDINGS, ROOMS, "upcoming", new Set(), meters)).toEqual({
      roles: {},
      draws: {},
    });
    expect(peakRooms(hass, BINDINGS, ROOMS, "none", new Set(), meters).draws).toEqual({});
  });

  it("say nothing of a room the viewer may not see", () => {
    const hass = home(rows);
    const rooms = peakRooms(hass, BINDINGS, ROOMS, "peak", new Set(["living"]));
    expect(rooms.roles.living).toBeUndefined();
    expect(rooms.draws.living).toBeUndefined();
    // Without the meters left out, the grid counts in the laundry.
    expect(rooms.draws.laundry).toBe(7500);
  });
});
