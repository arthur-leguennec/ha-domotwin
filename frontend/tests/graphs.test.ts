import { describe, expect, it } from "vitest";

import { graphTitle } from "../src/components/room-graphs";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { translatorFor } from "../src/i18n";
import { addMessages } from "../src/i18n";
import { practicalEn, practicalFr } from "../src/i18n/practical";
import { pathOf, routeOf } from "../src/live/choices";
import {
  MAX_GRAPHS,
  MAX_GRAPH_ENTITIES,
  graphCard,
  graphEntities,
  graphSpan,
  roomGraphs,
} from "../src/live/graphs";
import { energyPage, energySetUp } from "../src/live/overview";

addMessages({ en: practicalEn, fr: practicalFr });

const state = (entity_id: string, value: string, attributes = {}): HassEntity => ({
  entity_id,
  state: value,
  attributes,
  last_changed: "",
  last_updated: "",
});

/** A fictional living room on Home Assistant 2026.10, its sensors in its area or its devices'. */
function hass(extra: Partial<HomeAssistant> = {}): HomeAssistant {
  const states = [
    state("sensor.living_temperature", "21.4", {
      friendly_name: "Living temperature",
      device_class: "temperature",
      unit_of_measurement: "°C",
      state_class: "measurement",
    }),
    state("sensor.bookshelf_temperature", "21.1", {
      friendly_name: "Bookshelf temperature",
      device_class: "temperature",
      unit_of_measurement: "°C",
      state_class: "measurement",
    }),
    state("climate.living", "heat", { friendly_name: "Living thermostat", temperature: 21 }),
    state("sensor.living_humidity", "44", {
      friendly_name: "Living humidity",
      device_class: "humidity",
      unit_of_measurement: "%",
      state_class: "measurement",
    }),
    state("sensor.living_co2", "640", {
      friendly_name: "Living CO₂",
      device_class: "carbon_dioxide",
      unit_of_measurement: "ppm",
      state_class: "measurement",
    }),
    state("sensor.tv_power", "85", {
      friendly_name: "TV power",
      device_class: "power",
      unit_of_measurement: "W",
      state_class: "measurement",
    }),
    state("sensor.tv_energy", "12.5", {
      friendly_name: "TV energy",
      device_class: "energy",
      unit_of_measurement: "kWh",
      state_class: "total_increasing",
    }),
    state("sensor.radon", "40", {
      friendly_name: "Radon",
      unit_of_measurement: "Bq/m³",
      state_class: "measurement",
    }),
    state("sensor.noise", "38", {
      friendly_name: "Noise",
      device_class: "sound_pressure",
      unit_of_measurement: "dB",
    }),
    state("sensor.radio", "Jazz FM", { friendly_name: "Radio" }),
    state("sensor.last_boot", "2026-10-26T06:00:00+00:00", {
      friendly_name: "Last boot",
      device_class: "timestamp",
    }),
    state("sensor.tv_signal", "-60", {
      friendly_name: "TV signal",
      device_class: "signal_strength",
      unit_of_measurement: "dBm",
    }),
    state("binary_sensor.living_window", "off", {
      friendly_name: "Living window",
      device_class: "window",
    }),
    state("binary_sensor.living_motion", "on", {
      friendly_name: "Living motion",
      device_class: "motion",
    }),
    state("binary_sensor.tv_update", "off", { friendly_name: "TV update", device_class: "update" }),
    state("light.living", "on", { friendly_name: "Living lamp" }),
    state("sensor.kitchen_temperature", "22", {
      friendly_name: "Kitchen temperature",
      device_class: "temperature",
      unit_of_measurement: "°C",
    }),
  ];
  const entity = (entity_id: string, more: Record<string, unknown> = { area_id: "living" }) => ({
    entity_id,
    ...more,
  });
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    entities: {
      "sensor.living_temperature": entity("sensor.living_temperature"),
      "sensor.bookshelf_temperature": entity("sensor.bookshelf_temperature"),
      "climate.living": entity("climate.living"),
      "sensor.living_humidity": entity("sensor.living_humidity"),
      "sensor.living_co2": entity("sensor.living_co2"),
      // In the room through its device.
      "sensor.tv_power": entity("sensor.tv_power", { device_id: "tv" }),
      "sensor.tv_energy": entity("sensor.tv_energy", { device_id: "tv" }),
      "sensor.radon": entity("sensor.radon"),
      "sensor.noise": entity("sensor.noise"),
      "sensor.radio": entity("sensor.radio"),
      "sensor.last_boot": entity("sensor.last_boot"),
      "sensor.tv_signal": entity("sensor.tv_signal", {
        device_id: "tv",
        entity_category: "diagnostic",
      }),
      "binary_sensor.living_window": entity("binary_sensor.living_window"),
      "binary_sensor.living_motion": entity("binary_sensor.living_motion"),
      "binary_sensor.tv_update": entity("binary_sensor.tv_update", { device_id: "tv" }),
      "light.living": entity("light.living"),
      "sensor.kitchen_temperature": entity("sensor.kitchen_temperature", { area_id: "kitchen" }),
    },
    devices: { tv: { id: "tv", area_id: "living" } },
    areas: {
      living: { area_id: "living", name: "Living room" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
    },
    panels: { home: { url_path: "home" }, energy: { url_path: "energy" } },
    config: { version: "2026.10.0", time_zone: "America/Toronto" },
    user: { id: "u", name: "U", is_admin: false },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    ...extra,
  };
}

describe("a room's graphs (D-067)", () => {
  it("puts each kind of measure in a card of its own, in the order of what matters", () => {
    const graphs = roomGraphs(hass(), "living");
    expect(graphs.map((graph) => [graph.kind, graph.meter, graph.unit])).toEqual([
      ["temperature", false, "°C"],
      ["humidity", false, "%"],
      ["carbon_dioxide", false, "ppm"],
      ["sound_pressure", false, "dB"],
      ["power", false, "W"],
      ["unit:Bq/m³", false, "Bq/m³"],
      ["energy", true, "kWh"],
      ["openings", false, undefined],
      ["presence", false, undefined],
    ]);
  });

  it("draws the thermostats with the temperatures, each entity by name", () => {
    const [temperature] = roomGraphs(hass(), "living");
    expect(temperature?.entities).toEqual([
      "sensor.bookshelf_temperature",
      "sensor.living_temperature",
      "climate.living",
    ]);
  });

  it("leaves out words, dates, diagnostics, updates, lamps and other rooms", () => {
    const all = graphEntities(roomGraphs(hass(), "living"));
    for (const id of [
      "sensor.radio",
      "sensor.last_boot",
      "sensor.tv_signal",
      "binary_sensor.tv_update",
      "light.living",
      "sensor.kitchen_temperature",
    ]) {
      expect(all).not.toContain(id);
    }
    expect(all).toContain("sensor.tv_power");
    expect(roomGraphs(hass(), "kitchen").map((graph) => graph.entities)).toEqual([
      ["sensor.kitchen_temperature"],
    ]);
    expect(roomGraphs(hass(), "nowhere")).toEqual([]);
  });

  it("leaves out what the viewer may not see (D-039)", () => {
    const graphs = roomGraphs(
      hass(),
      "living",
      new Intl.Collator("en"),
      new Set(["sensor.tv_power", "sensor.tv_energy"]),
    );
    expect(graphs.map((graph) => graph.kind)).not.toContain("power");
    expect(graphs.map((graph) => graph.kind)).not.toContain("energy");
  });

  it("keeps a card readable and the cards few", () => {
    const home = hass();
    const states = { ...home.states };
    const entities = { ...home.entities };
    for (let i = 0; i < 12; i++) {
      const id = `sensor.probe_${String(i).padStart(2, "0")}`;
      states[id] = state(id, "20", { device_class: "temperature", unit_of_measurement: "°C" });
      entities[id] = { entity_id: id, area_id: "living" };
    }
    for (let i = 0; i < 12; i++) {
      const id = `sensor.unit_${i}`;
      states[id] = state(id, "1", { unit_of_measurement: `u${i}` });
      entities[id] = { entity_id: id, area_id: "living" };
    }
    const graphs = roomGraphs({ ...home, states, entities }, "living");
    expect(graphs).toHaveLength(MAX_GRAPHS);
    expect(graphs[0]?.entities).toHaveLength(MAX_GRAPH_ENTITIES);
  });

  it("makes Home Assistant's history-graph and statistics-graph cards over a day or a week", () => {
    const [temperature] = roomGraphs(hass(), "living");
    const energy = roomGraphs(hass(), "living").find((graph) => graph.meter);
    if (!temperature || !energy) throw new Error("no graph");
    expect(graphCard(temperature, "day", "Temperature")).toEqual({
      type: "history-graph",
      title: "Temperature",
      entities: ["sensor.bookshelf_temperature", "sensor.living_temperature", "climate.living"],
      hours_to_show: 24,
    });
    expect(graphCard(temperature, "week", "Temperature")).toMatchObject({ hours_to_show: 168 });
    expect(graphCard(energy, "day", "Energy")).toEqual({
      type: "statistics-graph",
      title: "Energy",
      entities: ["sensor.tv_energy"],
      days_to_show: 1,
      period: "hour",
      stat_types: ["change"],
      chart_type: "bar",
    });
    expect(graphCard(energy, "week", "Energy")).toMatchObject({ days_to_show: 7, period: "day" });
    // The same card for the same configuration: made once.
    expect(graphCard(temperature, "day", "Temperature")).toBe(
      graphCard(temperature, "day", "Temperature"),
    );
  });

  it("says each kind in both languages, its unit when it has no name", () => {
    const en = translatorFor(hass());
    const fr = translatorFor(hass({ language: "fr" }));
    const title = (kind: string, meter = false, unit?: string) => {
      const graph = { kind, meter, entities: [], ...(unit ? { unit } : {}) };
      return [graphTitle(en, graph), graphTitle(fr, graph)];
    };
    expect(title("temperature", false, "°C")).toEqual(["Temperature", "Température"]);
    expect(title("energy", true, "kWh")).toEqual(["Energy, counted", "Énergie, compté"]);
    expect(title("openings")).toEqual(["Doors and windows", "Portes et fenêtres"]);
    expect(title("unit:Bq/m³", false, "Bq/m³")).toEqual(["In Bq/m³", "En Bq/m³"]);
    expect(title("unit:")).toEqual(["Other measures", "Autres mesures"]);
    // A device class DomoTwin does not name: its unit, else its own words.
    expect(title("wind_speed", false, "km/h")).toEqual(["In km/h", "En km/h"]);
    expect(title("wind_speed")).toEqual(["Wind speed", "Wind speed"]);
  });

  it("reads the same period as Home Assistant's History", () => {
    const now = Date.UTC(2026, 9, 27, 12);
    expect(graphSpan("day", now)).toEqual({ start: now - 24 * 3_600_000, end: now });
    expect(graphSpan("week", now)).toEqual({ start: now - 7 * 24 * 3_600_000, end: now });
  });

  it("has an address of its own, under its room's", () => {
    expect(pathOf("rooms", "living room", true)).toBe("/rooms/living%20room/graphs");
    expect(routeOf("/rooms/living%20room/graphs")).toEqual({
      tab: "rooms",
      area: "living room",
      graphs: true,
    });
    expect(routeOf("/rooms/living/other")).toEqual({ tab: "rooms", area: "living" });
    expect(pathOf("rooms", undefined, true)).toBe("/rooms");
    expect(pathOf("home", "living", true)).toBe("/home");
  });
});

describe("Home Assistant's Energy page (D-067)", () => {
  it("is opened where Home Assistant has it, its back arrow leading back to DomoTwin", () => {
    const page = energyPage(hass(), "/domotwin/rooms/living");
    expect(page).toBe("/energy?historyBack=1&backPath=%2Fdomotwin%2Frooms%2Fliving");
    const params = new URL(page ?? "", "http://ha.local").searchParams;
    expect(params.get("backPath")).toBe("/domotwin/rooms/living");
    // Not knowing where it is, the back arrow alone: Home Assistant's own way back.
    expect(energyPage(hass())).toBe("/energy?historyBack=1");
  });

  it("is offered once something is set up, as the page itself asks", () => {
    expect(energySetUp({ energy_sources: [{ type: "grid" }], device_consumption: [] })).toBe(true);
    expect(
      energySetUp({ energy_sources: [], device_consumption: [{ stat_consumption: "sensor.tv" }] }),
    ).toBe(true);
    expect(
      energySetUp({
        energy_sources: [],
        device_consumption: [],
        device_consumption_water: [{ stat_consumption: "sensor.shower" }],
      }),
    ).toBe(true);
    // Nothing yet: its setup wizard alone.
    expect(energySetUp({ energy_sources: [], device_consumption: [] })).toBe(false);
    expect(energySetUp(null)).toBe(false);
    expect(energySetUp("No prefs")).toBe(false);
  });

  it("is not where Home Assistant has none, nor in the demo house or the sandbox", () => {
    expect(energyPage(hass({ panels: { home: {} } }), "/domotwin/home")).toBeUndefined();
    expect(energyPage(hass({ panels: undefined }), "/domotwin/home")).toBeUndefined();
    expect(energyPage(hass({ demo: true }), "/domotwin/home")).toBeUndefined();
    expect(energyPage(hass({ sandbox: true }), "/domotwin/home")).toBeUndefined();
    expect(energyPage(undefined, "/domotwin/home")).toBeUndefined();
  });
});
