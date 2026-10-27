import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import type { BindingsJson } from "../src/live/bindings";
import { celsius, formatHeat, formatPower, roomLayers, type PlanRoom } from "../src/live/layers";

const ROOMS: PlanRoom[] = [
  { id: "living", name: "Living room" },
  { id: "kitchen", name: "Kitchen" },
  { id: "study", name: "Study" },
];
const BINDINGS: BindingsJson = {
  version: 1,
  rooms: { living: { area: "lounge" } },
  elements: {},
};
const ALL_ON = { alerts: true, presence: true } as const;

/** A fictional home: [entity id, area, state, attributes]. */
function home(entities: [string, string | null, string, Record<string, unknown>][]): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  const registry: NonNullable<HomeAssistant["entities"]> = {};
  for (const [id, area, state, attributes] of entities) {
    states[id] = { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
    if (area) registry[id] = { entity_id: id, area_id: area };
  }
  return {
    states,
    entities: registry,
    devices: {},
    areas: {
      lounge: { area_id: "lounge", name: "Lounge" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
    },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

const temperature = (unit = "°C"): Record<string, unknown> => ({
  device_class: "temperature",
  unit_of_measurement: unit,
});

describe("roomLayers", () => {
  it("averages the sensors of each room's area, in °C", () => {
    const hass = home([
      ["sensor.lounge_a", "lounge", "20", temperature()],
      ["sensor.lounge_b", "lounge", "71.6", temperature("°F")],
      ["sensor.kitchen", "kitchen", "unavailable", temperature()],
      ["climate.kitchen", "kitchen", "heat", { current_temperature: 23.04 }],
      ["sensor.lounge_humidity", "lounge", "45", { device_class: "humidity" }],
    ]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "temperature", ...ALL_ON });
    // 20 °C and 22 °C; the kitchen has only its thermostat.
    expect(layers.values).toEqual({ living: 21, kitchen: 23 });
    expect(JSON.parse(layers.json)).toEqual({
      heat: "temperature",
      values: { living: 21, kitchen: 23 },
    });
    const humidity = roomLayers(hass, BINDINGS, ROOMS, { layer: "humidity", ...ALL_ON });
    expect(humidity.values).toEqual({ living: 45 });
  });

  it("follows Home Assistant's unit for thermostats", () => {
    const hass = home([["climate.kitchen", "kitchen", "heat", { current_temperature: 68 }]]);
    hass.config = { unit_system: { temperature: "°F" } };
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "temperature", ...ALL_ON });
    expect(layers.values).toEqual({ kitchen: 20 });
  });

  it("raises dangers before warnings, and only when asked", () => {
    const hass = home([
      ["binary_sensor.lounge_window", "lounge", "on", { device_class: "window" }],
      ["weather.home", null, "pouring", {}],
      ["binary_sensor.kitchen_smoke", "kitchen", "on", { device_class: "smoke" }],
      ["binary_sensor.kitchen_leak", "kitchen", "off", { device_class: "moisture" }],
    ]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "off", ...ALL_ON });
    expect(layers.alerts.map((a) => [a.room, a.level, a.reason])).toEqual([
      ["kitchen", "danger", "smoke"],
      ["living", "warning", "window_rain"],
    ]);
    expect(layers.alerts[0]?.name).toBe("Kitchen");
    expect(JSON.parse(layers.json)).toEqual({ alerts: { kitchen: "danger", living: "warning" } });
    const quiet = roomLayers(hass, BINDINGS, ROOMS, { ...ALL_ON, layer: "off", alerts: false });
    expect(quiet.alerts).toEqual([]);
    expect(quiet.json).toBe("{}");
  });

  it("an open window is not an alert in dry weather; an alarm going off is", () => {
    const hass = home([
      ["binary_sensor.lounge_window", "lounge", "on", { device_class: "window" }],
      ["weather.home", null, "sunny", {}],
      ["alarm_control_panel.home", "kitchen", "triggered", {}],
    ]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "off", ...ALL_ON });
    expect(layers.alerts.map((a) => [a.room, a.reason])).toEqual([["kitchen", "alarm"]]);
  });

  it("warns when the air needs changing", () => {
    const hass = home([
      ["sensor.kitchen_co2", "kitchen", "1650", { device_class: "carbon_dioxide" }],
      ["sensor.lounge_co2", "lounge", "900", { device_class: "carbon_dioxide" }],
    ]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "co2", ...ALL_ON });
    expect(layers.alerts.map((a) => [a.room, a.reason, a.entity])).toEqual([
      ["kitchen", "co2", "sensor.kitchen_co2"],
    ]);
    expect(layers.values).toEqual({ living: 900, kitchen: 1650 });
  });

  it("keeps a private room's dangers, not what would tell someone is in (D-039)", () => {
    const hass = home([
      ["binary_sensor.lounge_window", "lounge", "on", { device_class: "window" }],
      ["weather.home", null, "pouring", {}],
      ["binary_sensor.lounge_motion", "lounge", "on", { device_class: "motion" }],
      ["sensor.lounge_temperature", "lounge", "21", temperature()],
      ["sensor.kitchen_co2", "kitchen", "1650", { device_class: "carbon_dioxide" }],
      ["binary_sensor.kitchen_leak", "kitchen", "on", { device_class: "moisture" }],
    ]);
    const closed = new Set(["living", "kitchen"]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "temperature", ...ALL_ON, closed });
    expect(layers.values).toEqual({});
    expect(layers.presence).toEqual([]);
    expect(layers.alerts.map((a) => [a.room, a.reason])).toEqual([["kitchen", "moisture"]]);
    // The CO₂ alone, in the kitchen closed: nothing.
    delete hass.states["binary_sensor.kitchen_leak"];
    const air = roomLayers(hass, BINDINGS, ROOMS, { layer: "co2", ...ALL_ON, closed });
    expect(air.alerts).toEqual([]);
  });

  it("marks the rooms someone is in", () => {
    const hass = home([
      ["binary_sensor.lounge_motion", "lounge", "on", { device_class: "motion" }],
      ["binary_sensor.kitchen_presence", "kitchen", "off", { device_class: "presence" }],
    ]);
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "off", ...ALL_ON });
    expect(layers.presence).toEqual(["living"]);
    const off = roomLayers(hass, BINDINGS, ROOMS, { ...ALL_ON, layer: "off", presence: false });
    expect(off.presence).toEqual([]);
  });

  it("sends what the rooms do around a peak, and what they draw (D-063)", () => {
    const hass = home([]);
    const peak = { roles: { living: "shed" as const }, draws: { living: 40, kitchen: 900 } };
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "peak", ...ALL_ON, peak });
    expect(JSON.parse(layers.json)).toEqual({
      peak: { living: "shed" },
      draws: { living: 40, kitchen: 900 },
    });
    // Nothing to say: nothing sent.
    const quiet = roomLayers(hass, BINDINGS, ROOMS, {
      layer: "peak",
      ...ALL_ON,
      peak: { roles: {}, draws: {} },
    });
    expect(quiet.json).toBe("{}");
  });

  it("leaves out configuration entities and entities of no area", () => {
    const hass = home([["sensor.loose", null, "30", temperature()]]);
    hass.entities = {
      ...hass.entities,
      "sensor.firmware": {
        entity_id: "sensor.firmware",
        area_id: "lounge",
        entity_category: "diagnostic",
      },
    };
    hass.states["sensor.firmware"] = {
      entity_id: "sensor.firmware",
      state: "40",
      attributes: temperature(),
      last_changed: "",
      last_updated: "",
    };
    expect(roomLayers(hass, BINDINGS, ROOMS, { layer: "temperature", ...ALL_ON }).values).toEqual(
      {},
    );
  });
});

describe("hidden entities", () => {
  it("give no value and no presence, but still raise their alerts", () => {
    const hass = home([
      ["sensor.lounge_a", "lounge", "20", temperature()],
      ["sensor.lounge_probe", "lounge", "4", temperature()],
      ["binary_sensor.lounge_motion", "lounge", "on", { device_class: "motion" }],
      ["binary_sensor.lounge_smoke", "lounge", "on", { device_class: "smoke" }],
    ]);
    for (const id of [
      "sensor.lounge_probe",
      "binary_sensor.lounge_motion",
      "binary_sensor.lounge_smoke",
    ]) {
      hass.entities = {
        ...hass.entities,
        [id]: { entity_id: id, area_id: "lounge", hidden: true },
      };
    }
    const layers = roomLayers(hass, BINDINGS, ROOMS, { layer: "temperature", ...ALL_ON });
    expect(layers.values).toEqual({ living: 20 });
    expect(layers.presence).toEqual([]);
    expect(layers.alerts.map((a) => a.reason)).toEqual(["smoke"]);
  });
});

describe("units and labels", () => {
  it("converts temperatures", () => {
    expect(celsius(212, "°F")).toBe(100);
    expect(celsius(273.15, "K")).toBe(0);
    expect(celsius(20, undefined)).toBe(20);
    expect(celsius(20, "lux")).toBeUndefined();
  });

  it("formats values for the labels", () => {
    expect(formatPower(84.4, "en")).toBe("84 W");
    expect(formatPower(1250, "en")).toBe("1.3 kW");
    expect(formatPower(1250, "fr")).toBe("1,3 kW");
    expect(formatHeat(21.43, "°C", "en")).toBe("21.4 °C");
    expect(formatHeat(21, "°C", "fr")).toBe("21,0 °C");
    expect(formatHeat(812.6, "ppm", "en")).toBe("813 ppm");
    // Home Assistant in °F: temperatures shown in °F, other units as they are.
    expect(formatHeat(22, "°C", "en", true)).toBe("71.6 °F");
    expect(formatHeat(45, "%", "en", true)).toBe("45 %");
  });
});
