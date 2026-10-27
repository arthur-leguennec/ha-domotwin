import { describe, expect, it } from "vitest";

import type { HassEntity, HassEntityEntry } from "../src/ha/types";
import { peakNow } from "../src/live/peaks";
import type { HomeCopy } from "../src/sandbox/copy";
import { SandboxHome } from "../src/sandbox/home";
import { peakDay, peakOnDay } from "../src/sandbox/peak-day";
import { clockOf, clockOn, isoIn, moment } from "../src/sandbox/time";

const ZONE = "America/Toronto";
/** Copied at noon on 21 January 2026; the peak announced for the next day, 16:00 to 20:00. */
const COPIED = moment(ZONE, 2026, 1, 21, 12);
const PEAK_DAY = moment(ZONE, 2026, 1, 22);
const PEAK = {
  start: moment(ZONE, 2026, 1, 22, 16),
  end: moment(ZONE, 2026, 1, 22, 20),
  preheat: moment(ZONE, 2026, 1, 22, 14),
};

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  const iso = isoIn(COPIED, ZONE);
  return { entity_id: id, state, attributes, last_changed: iso, last_updated: iso };
}

/** A fictional home on Flex D: hydroqc's entities, two rooms heated, an automation that sheds. */
function copy(): HomeCopy {
  const hydroqc = (translation_key: string): HassEntityEntry => ({
    entity_id: "",
    platform: "hydroqc",
    translation_key,
    device_id: "hq",
  });
  const rows: [HassEntity, Partial<HassEntityEntry>?][] = [
    [entity("sensor.hq_debut", isoIn(PEAK.start, "UTC")), hydroqc("dpc_next_peak_start")],
    [entity("sensor.hq_fin", isoIn(PEAK.end, "UTC")), hydroqc("dpc_next_peak_end")],
    [entity("binary_sensor.hq_pointe", "off"), hydroqc("dpc_peak_in_progress")],
    [entity("binary_sensor.hq_prechauffage", "off"), hydroqc("dpc_pre_heat")],
    [entity("sensor.hq_etat", "normal"), hydroqc("dpc_state")],
    [entity("binary_sensor.hq_soir", "off"), hydroqc("dpc_critical_evening_peak_today")],
    [entity("binary_sensor.hq_matin", "on"), hydroqc("dpc_critical_morning_peak_today")],
    [
      entity("climate.living", "heat", { temperature: 21, current_temperature: 20.5 }),
      { area_id: "living" },
    ],
    [
      entity("climate.bedroom", "heat", { temperature: 22, current_temperature: 20 }),
      { area_id: "bedroom" },
    ],
    [entity("automation.shed", "on", { id: "shed", friendly_name: "Shed the living room" })],
  ];
  const states = Object.fromEntries(rows.map(([e]) => [e.entity_id, e]));
  const entities = Object.fromEntries(
    rows.map(([e, entry]) => [e.entity_id, { ...entry, entity_id: e.entity_id }]),
  );
  return {
    states,
    entities,
    devices: {},
    areas: {
      living: { area_id: "living", name: "Living room" },
      bedroom: { area_id: "bedroom", name: "Bedroom" },
    },
    floors: {},
    store: {
      revision: 1,
      storeys: [
        {
          info: { id: "storey-1", name: "", elevation: 0 },
          plan: {
            rooms: [
              { id: "living", name: "Living room" },
              { id: "bedroom", name: "Bedroom" },
            ],
          },
          layout: {},
        },
      ],
      bindings: {
        version: 1,
        rooms: { living: { area: "living" }, bedroom: { area: "bedroom" } },
        elements: {},
      },
      settings: {},
      people: { revision: 1, shown: "everyone", look: "figure", hidden: [], people: {} },
    } as unknown as HomeCopy["store"],
    automations: [
      {
        id: "automation.shed",
        config: {
          triggers: [{ trigger: "state", entity_id: "binary_sensor.hq_pointe", to: "on" }],
          actions: [
            {
              action: "climate.set_temperature",
              target: { entity_id: "climate.living" },
              data: { temperature: 16 },
            },
          ],
        },
      },
    ],
    scripts: [],
    scenes: [],
    registry: {},
    zone: ZONE,
  };
}

describe("Hydro-Québec's announced peak in the sandbox (D-062)", () => {
  it("says what the integrations say through the peak's day", () => {
    const home = copy();
    const end = moment(ZONE, 2026, 1, 23);
    expect(peakOnDay(PEAK, PEAK_DAY, end)).toBe(true);
    expect(peakOnDay(PEAK, end, moment(ZONE, 2026, 1, 24))).toBe(false);
    const on = { start: PEAK_DAY, end, zone: ZONE, copied: COPIED };
    const day = peakDay(home.states, home.entities, PEAK, new Set(["hq"]), on);
    expect(Object.fromEntries(day.initial)).toEqual({
      "binary_sensor.hq_pointe": "off",
      "binary_sensor.hq_prechauffage": "off",
      "sensor.hq_etat": "normal",
      // The evening's peak today; the morning's as the copy said it the day before: none.
      "binary_sensor.hq_soir": "on",
      "binary_sensor.hq_matin": "off",
    });
    expect(day.another).toBe(false);
    expect(day.happenings.map((h) => [clockOf(h.at, ZONE), h.entity, h.state])).toEqual([
      ["14:00", "binary_sensor.hq_prechauffage", "on"],
      ["16:00", "binary_sensor.hq_prechauffage", "off"],
      ["16:00", "binary_sensor.hq_pointe", "on"],
      ["16:00", "sensor.hq_etat", "critical_peak"],
      ["20:00", "binary_sensor.hq_pointe", "off"],
      ["20:00", "sensor.hq_etat", "normal"],
    ]);
  });

  it("plays no pre-heating of no minutes, and nothing for another contract", () => {
    const home = copy();
    const end = moment(ZONE, 2026, 1, 23);
    const on = { start: PEAK_DAY, end, zone: ZONE, copied: COPIED };
    const none = peakDay(
      home.states,
      home.entities,
      { ...PEAK, preheat: PEAK.start },
      new Set(["hq"]),
      on,
    );
    expect(none.happenings.filter((h) => h.entity === "binary_sensor.hq_prechauffage")).toEqual([]);
    expect(Object.fromEntries(none.initial)["binary_sensor.hq_prechauffage"]).toBe("off");
    // Another contract's peak: nothing of this one is played on its sensors.
    const other = peakDay(home.states, home.entities, PEAK, new Set(["another"]), on);
    expect(other.happenings).toEqual([]);
    expect(Object.fromEntries(other.initial)).toMatchObject({
      "binary_sensor.hq_pointe": "off",
      "sensor.hq_etat": "normal",
      "binary_sensor.hq_soir": "off",
    });
  });

  it("says another peak announced that day, from the copy's sensors of the day after", () => {
    const home = copy();
    const tomorrow = (id: string, key: string): void => {
      home.states[id] = entity(id, "on");
      home.entities[id] = {
        entity_id: id,
        platform: "hydroqc",
        translation_key: key,
        device_id: "hq",
      };
    };
    tomorrow("binary_sensor.hq_matin_demain", "dpc_critical_morning_peak_tomorrow");
    const end = moment(ZONE, 2026, 1, 23);
    const day = peakDay(home.states, home.entities, PEAK, new Set(["hq"]), {
      start: PEAK_DAY,
      end,
      zone: ZONE,
      copied: COPIED,
    });
    expect(Object.fromEntries(day.initial)["binary_sensor.hq_matin"]).toBe("on");
    expect(day.another).toBe(true);
    const sandbox = new SandboxHome(home, { language: "en", peakDay: true }, COPIED);
    expect(sandbox.peakAnother).toBe(true);
    sandbox.stop();
  });

  it("plays the announced peak on its day: what it sets off, and what the rooms did", () => {
    const home = new SandboxHome(copy(), { language: "en" }, COPIED);
    expect(home.announced).toEqual(PEAK);
    // The copy's own day: no peak in it.
    expect(home.peakToday()).toBeUndefined();
    expect(home.peakReport()).toBeUndefined();
    home.setScenario({ ...home.scenario, date: "2026-01-22" });
    expect(home.peakToday()).toEqual(PEAK);
    // The peak sets the automation off, which sheds the living room.
    home.seek(clockOn(PEAK_DAY, ZONE, 17 * 60));
    expect(home.hass.states["binary_sensor.hq_pointe"]?.state).toBe("on");
    expect(home.hass.states["climate.living"]?.attributes.temperature).toBe(16);
    expect(home.dayReport().owners.find((o) => o.id === "automation.shed")?.runs).toHaveLength(1);
    // The peak's layer reads the sandbox's clock.
    expect(peakNow(home.hass)?.phase).toBe("peak");
    const spans = (room: string) =>
      home
        .peakReport()
        ?.find((r) => r.room === room)
        ?.spans.map((s) => [s.role, clockOf(s.from, ZONE), clockOf(s.to, ZONE)]);
    expect(spans("living")).toEqual([
      ["preheat", "14:00", "16:00"],
      ["shed", "16:00", "20:00"],
    ]);
    expect(spans("bedroom")).toEqual([
      ["preheat", "14:00", "16:00"],
      ["heating", "16:00", "20:00"],
    ]);
    // Another day: no peak played.
    home.setScenario({ ...home.scenario, date: "2026-01-23" });
    expect(home.peakToday()).toBeUndefined();
    home.stop();
  });

  it("opens on the peak's day at its pre-heating, when asked", () => {
    const home = new SandboxHome(copy(), { language: "en", peakDay: true }, COPIED);
    expect(home.scenario.date).toBe("2026-01-22");
    expect(clockOf(home.cursor, ZONE)).toBe("14:00");
    home.stop();
  });

  it("reports nothing of a private room, of its area, nor of a pre-heating off the hour", () => {
    const base = copy();
    // The bedroom is private, kept for nobody; the walk-in shares its area.
    const store = base.store as unknown as {
      storeys: { plan: { rooms: { id: string; name: string }[] } }[];
      bindings: { rooms: Record<string, { area: string }> };
      settings: Record<string, unknown>;
    };
    store.storeys[0]?.plan.rooms.push({ id: "walk-in", name: "Walk-in" });
    store.bindings.rooms["walk-in"] = { area: "bedroom" };
    store.settings.rooms = { bedroom: { people: [] } };
    // The pre-heating at 14:07.
    base.states["sensor.hq_prechauffage_debut"] = entity(
      "sensor.hq_prechauffage_debut",
      isoIn(moment(ZONE, 2026, 1, 22, 14, 7), "UTC"),
    );
    base.entities["sensor.hq_prechauffage_debut"] = {
      entity_id: "sensor.hq_prechauffage_debut",
      platform: "hydroqc",
      translation_key: "dpc_next_pre_heat_start",
      device_id: "hq",
    };
    const home = new SandboxHome(base, { language: "en", peakDay: true }, COPIED);
    const rooms = home.peakReport() ?? [];
    expect(rooms.map((r) => r.room)).toEqual(["living"]);
    expect(
      rooms[0]?.spans.map((s) => [s.role, clockOf(s.from, ZONE), clockOf(s.to, ZONE)]),
    ).toEqual([
      ["preheat", "14:07", "16:00"],
      ["shed", "16:00", "20:00"],
    ]);
    home.stop();
  });

  it("has nothing to play where no integration reads the peaks", () => {
    const plain = copy();
    plain.entities = {};
    const home = new SandboxHome(plain, { language: "en" }, COPIED);
    expect(home.announced).toBeUndefined();
    home.stop();
  });
});
