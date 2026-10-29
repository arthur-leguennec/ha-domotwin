import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import type { BindingsJson } from "../src/live/bindings";
import {
  allStats,
  changesOf,
  energyStats,
  energyToday,
  formatEnergy,
  powerNow,
  startOfToday,
  statName,
} from "../src/live/energy-board";

function entity(id: string, state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
}

function hass(
  states: ReturnType<typeof entity>[],
  more: Partial<Pick<HomeAssistant, "entities" | "devices">> = {},
): HomeAssistant {
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    entities: {},
    areas: {},
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
    ...more,
  };
}

const power = { device_class: "power", unit_of_measurement: "W" };

const PLAN = {
  rooms: [
    { id: "kitchen", name: "Kitchen" },
    { id: "lounge", name: "Lounge" },
  ],
  items: [
    { id: "oven", name: "Oven", room: "kitchen" },
    { id: "kettle", name: "Kettle", room: "kitchen" },
    { id: "tv", name: "TV", room: "lounge" },
    { id: "lamp", name: "", room: "lounge" },
  ],
};

describe("the Energy tab's board (D-092)", () => {
  it("reads the statistics of Home Assistant's energy settings", () => {
    expect(energyStats(undefined)).toBeUndefined();
    expect(energyStats({ energy_sources: [], device_consumption: [] })).toBeUndefined();
    const stats = energyStats({
      energy_sources: [
        { type: "solar", stat_energy_from: "sensor.pv_energy" },
        {
          type: "grid",
          flow_from: [{ stat_energy_from: "sensor.grid_in" }, { stat_energy_from: "" }],
          flow_to: [{ stat_energy_to: "sensor.grid_out" }],
        },
        // Newer settings name the flows on the source; the same one is asked for once.
        { type: "grid", stat_energy_from: "sensor.grid_in", stat_energy_to: null },
        {
          type: "battery",
          stat_energy_from: "sensor.battery_out",
          stat_energy_to: "sensor.battery_in",
        },
        { type: "gas", stat_energy_from: "sensor.gas" },
        null,
      ],
      device_consumption: [{ stat_consumption: "sensor.oven_energy" }, { name: "no stat" }],
    });
    expect(stats).toEqual({
      solar: ["sensor.pv_energy"],
      gridIn: ["sensor.grid_in"],
      gridOut: ["sensor.grid_out"],
      batteryOut: ["sensor.battery_out"],
      batteryIn: ["sensor.battery_in"],
      devices: ["sensor.oven_energy"],
    });
    expect(stats && allStats(stats)).toEqual([
      "sensor.pv_energy",
      "sensor.grid_in",
      "sensor.grid_out",
      "sensor.battery_out",
      "sensor.battery_in",
      "sensor.oven_energy",
    ]);
  });

  it("adds each statistic's changes, leaving out those without any", () => {
    expect(changesOf(null).size).toBe(0);
    const changes = changesOf({
      "sensor.a": [{ change: 1.5 }, { change: 2 }, { change: null }],
      "sensor.b": [{ change: Number.NaN }],
      "sensor.c": "not rows",
    });
    expect([...changes]).toEqual([["sensor.a", 3.5]]);
  });

  it("works out what the home used today, and its own share", () => {
    const stats = {
      solar: ["sensor.pv"],
      gridIn: ["sensor.in"],
      gridOut: ["sensor.out"],
      batteryOut: ["sensor.bat_out"],
      batteryIn: ["sensor.bat_in"],
      devices: ["sensor.oven", "sensor.tv", "sensor.idle"],
    };
    const today = energyToday(
      stats,
      new Map([
        ["sensor.pv", 10],
        ["sensor.in", 4],
        ["sensor.out", 3],
        ["sensor.bat_out", 2],
        ["sensor.bat_in", 1],
        ["sensor.oven", 1.2],
        ["sensor.tv", 2.5],
        ["sensor.idle", 0],
      ]),
    );
    // 10 + 4 + 2 − 3 − 1: 12 kWh used. The battery stored 1 of the sun's, 3 more were sold:
    // 6 from the sun, 2 from the battery, all 4 bought.
    expect(today.home).toBe(12);
    expect(today.fromSun).toBe(6);
    expect(today.fromBattery).toBe(2);
    expect(today.fromGrid).toBe(4);
    expect(today.ownShare).toBeCloseTo(2 / 3);
    expect(today.devices).toEqual([
      { id: "sensor.tv", kwh: 2.5 },
      { id: "sensor.oven", kwh: 1.2 },
    ]);
  });

  it("counts the battery charged from the grid as the grid's, not the home's own", () => {
    const stats = {
      solar: ["sensor.pv"],
      gridIn: ["sensor.in"],
      gridOut: [],
      batteryOut: ["sensor.bat_out"],
      batteryIn: ["sensor.bat_in"],
      devices: [],
    };
    // A little sun, all stored; the grid filled the battery for the evening.
    const today = energyToday(
      stats,
      new Map([
        ["sensor.pv", 1],
        ["sensor.in", 9],
        ["sensor.bat_in", 5],
        ["sensor.bat_out", 5],
      ]),
    );
    expect(today.home).toBe(10);
    expect(today.fromSun).toBe(0);
    expect(today.fromBattery).toBe(5);
    expect(today.fromGrid).toBe(5);
    expect(today.ownShare).toBeCloseTo(0.5);
  });

  it("says nothing of a part none of whose statistics answered", () => {
    const stats = {
      solar: ["sensor.pv"],
      gridIn: ["sensor.in"],
      gridOut: [],
      batteryOut: [],
      batteryIn: [],
      devices: [],
    };
    const nothing = energyToday(stats, new Map());
    expect(nothing.home).toBeUndefined();
    expect(nothing.ownShare).toBeUndefined();
    // Solar only: what the home used is known, the share bought is not.
    const sunny = energyToday(stats, new Map([["sensor.pv", 5]]));
    expect(sunny.home).toBe(5);
    expect(sunny.gridIn).toBeUndefined();
    expect(sunny.ownShare).toBeUndefined();
    // A meter set back to zero counts nothing, not less than nothing.
    expect(energyToday(stats, new Map([["sensor.in", -2]])).home).toBe(0);
  });

  it("names a statistic after its piece, else its device, else the entity", () => {
    const h = hass(
      [
        entity("sensor.oven_energy", "3", { friendly_name: "Oven energy" }),
        entity("sensor.washer_energy", "1", { friendly_name: "Washer energy" }),
        entity("sensor.heater_energy", "1", { friendly_name: "Heater energy" }),
      ],
      {
        entities: {
          "sensor.washer_energy": { entity_id: "sensor.washer_energy", device_id: "d1" },
        } as unknown as HomeAssistant["entities"],
        devices: { d1: { id: "d1", name: "Washing machine", name_by_user: null } },
      },
    );
    const bindings: BindingsJson = {
      version: 1,
      rooms: {},
      elements: { oven: { entities: [{ entity_id: "sensor.oven_energy" }] } },
    };
    expect(statName(h, bindings, [PLAN], "sensor.oven_energy")).toBe("Oven");
    expect(statName(h, bindings, [PLAN], "sensor.washer_energy")).toBe("Washing machine");
    expect(statName(h, bindings, [PLAN], "sensor.heater_energy")).toBe("Heater energy");
    expect(statName(h, bindings, [PLAN], "sensor.gone")).toBe("sensor.gone");
  });

  it("lists the pieces drawing power now, and each room's together", () => {
    const h = hass([
      entity("sensor.oven_power", "2.1", { ...power, unit_of_measurement: "kW" }),
      entity("sensor.kettle_power", "0.4", power),
      entity("sensor.tv_power", "90", power),
      entity("light.lamp", "on", { friendly_name: "Reading lamp" }),
      entity("sensor.lamp_power", "8", power),
      entity("sensor.hidden_power", "500", power),
      entity("sensor.odd_power", "3", { ...power, unit_of_measurement: "Wh" }),
    ]);
    const bindings: BindingsJson = {
      version: 1,
      rooms: {},
      elements: {
        oven: { entities: [{ entity_id: "sensor.oven_power" }] },
        // Under a watt: not drawing.
        kettle: { entities: [{ entity_id: "sensor.kettle_power" }] },
        tv: { entities: [{ entity_id: "sensor.tv_power" }] },
        lamp: { entities: [{ entity_id: "light.lamp" }, { entity_id: "sensor.lamp_power" }] },
        safe: { entities: [{ entity_id: "sensor.hidden_power" }] },
        odd: { entities: [{ entity_id: "sensor.odd_power" }] },
        // Not on the plans shown: not listed (a tap would show nothing).
        elsewhere: { entities: [{ entity_id: "sensor.tv_power" }] },
      },
    };
    const plan = { ...PLAN, items: [...PLAN.items, { id: "safe" }, { id: "odd" }] };
    const now = powerNow(h, bindings, [plan], { element: (element) => element === "safe" });
    expect(now.pieces).toEqual([
      { element: "oven", name: "Oven", room: "kitchen", watts: 2100 },
      { element: "tv", name: "TV", room: "lounge", watts: 90 },
      // Unnamed on the plan: its first other entity's name.
      { element: "lamp", name: "Reading lamp", room: "lounge", watts: 8 },
    ]);
    expect(now.rooms).toEqual([
      { room: "kitchen", name: "Kitchen", watts: 2100, pieces: 1 },
      { room: "lounge", name: "Lounge", watts: 98, pieces: 2 },
    ]);
  });

  it("leaves out the home's own meters and what the viewer may not see", () => {
    const h = hass([
      entity("sensor.grid_power", "2400", power),
      entity("sensor.kettle_power", "1800", power),
      entity("sensor.lamp_power", "9", { ...power, friendly_name: "Lamp power" }),
    ]);
    const bindings: BindingsJson = {
      version: 1,
      rooms: {},
      elements: {
        // The electrical panel holds the grid's meter: the whole home's, not a piece's.
        panel: { entities: [{ entity_id: "sensor.grid_power" }] },
        kettle: { entities: [{ entity_id: "sensor.kettle_power" }] },
        lamp: { entities: [{ entity_id: "sensor.lamp_power" }] },
      },
    };
    const plan = { ...PLAN, items: [...PLAN.items, { id: "panel", name: "Panel" }] };
    const now = powerNow(h, bindings, [plan], {
      entity: (id) => id === "sensor.grid_power" || id === "sensor.kettle_power",
    });
    // A piece with only a power sensor, unnamed on the plan, is named after it.
    expect(now.pieces.map((piece) => piece.element)).toEqual(["lamp"]);
    expect(now.pieces[0]?.name).toBe("Lamp power");
    // A device in a private room lends no name.
    expect(
      statName(h, bindings, [PLAN], "sensor.kettle_power", (element) => element === "kettle"),
    ).toBe("sensor.kettle_power");
    expect(statName(h, bindings, [PLAN], "sensor.kettle_power")).toBe("Kettle");
  });

  it("writes energy in the viewer's language", () => {
    expect(formatEnergy(4.25, "en")).toBe("4.3 kWh");
    expect(formatEnergy(12.4, "en")).toBe("12 kWh");
    expect(formatEnergy(4.25, "fr")).toBe("4,3 kWh");
  });

  it("starts today at midnight where the home is", () => {
    const now = new Date("2026-06-15T14:30:45.500Z");
    expect(startOfToday(now, "UTC")).toBe("2026-06-15T00:00:00.000Z");
    // Paris is two hours ahead in summer.
    expect(startOfToday(now, "Europe/Paris")).toBe("2026-06-14T22:00:00.000Z");
    expect(startOfToday(now, "America/New_York")).toBe("2026-06-15T04:00:00.000Z");
  });

  it("starts today at midnight on the days the clocks change", () => {
    // Paris goes back an hour at 03:00 on 25 October 2026: midnight was still summer time.
    expect(startOfToday(new Date("2026-10-25T09:00:00Z"), "Europe/Paris")).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    // And forward an hour at 02:00 on 29 March 2026: midnight was still winter time.
    expect(startOfToday(new Date("2026-03-29T08:00:00Z"), "Europe/Paris")).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(startOfToday(new Date("2026-11-01T15:00:00Z"), "America/New_York")).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });
});
