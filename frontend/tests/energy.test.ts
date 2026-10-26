import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import {
  energyCandidates,
  energyFlows,
  energyNow,
  preferredFromHome,
  readEnergy,
} from "../src/live/energy";

function entity(id: string, state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
}

function hass(states: ReturnType<typeof entity>[]): HomeAssistant {
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    entities: {},
    areas: {},
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
  };
}

const power = { device_class: "power", unit_of_measurement: "W" };

describe("the home's energy (D-049)", () => {
  it("reads its settings, keeping what is sound", () => {
    expect(readEnergy(undefined)).toBeUndefined();
    expect(readEnergy({ solar: "light.sun", grid: 3 })).toBeUndefined();
    expect(
      readEnergy({
        solar: "sensor.pv",
        battery: "sensor.battery",
        battery_reversed: true,
        grid_reversed: "yes",
      }),
    ).toEqual({ solar: "sensor.pv", battery: "sensor.battery", battery_reversed: true });
    // A sign turned without its sensor is not kept.
    expect(readEnergy({ solar: "sensor.pv", grid_reversed: true })).toEqual({ solar: "sensor.pv" });
  });

  it("reads the sensors in watts, signs turned as set", () => {
    const h = hass([
      entity("sensor.pv", "3.2", { ...power, unit_of_measurement: "kW" }),
      entity("sensor.grid", "-500", power),
      entity("sensor.battery", "700", power),
      entity("sensor.battery_level", "104", { device_class: "battery" }),
      entity("sensor.night", "-3", power),
    ]);
    expect(
      energyNow(h, {
        solar: "sensor.pv",
        grid: "sensor.grid",
        battery: "sensor.battery",
        battery_level: "sensor.battery_level",
        battery_reversed: true,
      }),
    ).toEqual({ solar: 3200, grid: -500, battery: -700, level: 100 });
    // A sun under 0 at night is 0; an unknown or missing sensor is left out.
    expect(energyNow(h, { solar: "sensor.night", grid: "sensor.gone" })).toEqual({ solar: 0 });
  });

  it("follows the power from where it comes to where it goes", () => {
    // A sunny day: the sun feeds the home, charges the battery, and sends the rest away.
    expect(energyFlows({ solar: 3200, grid: -500, battery: -700 })).toEqual({
      home: 2000,
      solarToHome: 2000,
      solarToBattery: 700,
      solarToGrid: 500,
      gridToHome: 0,
      gridToBattery: 0,
      batteryToHome: 0,
      batteryToGrid: 0,
    });
    // An evening: the battery and the grid feed the home.
    const evening = energyFlows({ solar: 0, grid: 300, battery: 900 });
    expect(evening.home).toBe(1200);
    expect(evening.batteryToHome).toBe(900);
    expect(evening.gridToHome).toBe(300);
    // A night of cheap power: the grid feeds the home and charges the battery.
    const night = energyFlows({ grid: 2500, battery: -2000 });
    expect(night.home).toBe(500);
    expect([night.gridToHome, night.gridToBattery]).toEqual([500, 2000]);
    // Sensors that do not add up: nothing below 0.
    expect(energyFlows({ solar: 100, grid: -900 }).home).toBe(0);
  });

  it("offers the likeliest sensors first, those Home Assistant names first of all", () => {
    const h = hass([
      entity("sensor.kettle", "0", power),
      entity("sensor.pv_power", "1", power),
      entity("sensor.inverter_out", "1", { ...power, friendly_name: "Onduleur" }),
      entity("sensor.house_battery", "50", { device_class: "battery", unit_of_measurement: "%" }),
      entity("sensor.phone_battery", "low", { device_class: "battery" }),
      entity("light.solar_lamp", "on", power),
    ]);
    expect(energyCandidates(h, "solar")).toEqual([
      "sensor.inverter_out",
      "sensor.pv_power",
      "sensor.kettle",
    ]);
    expect(energyCandidates(h, "solar", ["sensor.kettle"])[0]).toBe("sensor.kettle");
    expect(energyCandidates(h, "battery_level")).toEqual(["sensor.house_battery"]);
    // Home Assistant's energy settings: the power sensors of each source, not its counters.
    const preferred = preferredFromHome({
      energy_sources: [
        { type: "solar", stat_energy_from: "sensor.pv_energy", stat_rate: "sensor.pv_power" },
        {
          type: "grid",
          flow_from: [{ stat_energy_from: "sensor.grid_in" }],
          power: [{ stat_rate: "sensor.grid_power" }],
        },
        { type: "gas", stat_energy_from: "sensor.gas" },
      ],
    });
    expect(preferred).toEqual({
      solar: ["sensor.pv_power"],
      grid: ["sensor.grid_power"],
      battery: [],
      battery_level: [],
    });
    expect(preferredFromHome(null).solar).toEqual([]);
  });
});
