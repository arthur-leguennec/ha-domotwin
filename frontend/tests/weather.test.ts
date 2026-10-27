import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { bearingOf, weatherEntities, weatherShown, windSpeedOf } from "../src/live/weather";

const state = (entity_id: string, value: string, attributes = {}): HassEntity => ({
  entity_id,
  state: value,
  attributes,
  last_changed: "",
  last_updated: "",
});

/** A fictional home with two weather services. */
function hass(states: HassEntity[]): HomeAssistant {
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    user: { id: "u", name: "U", is_admin: true },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

describe("the weather around the home (D-069)", () => {
  it("reads the wind as Home Assistant gives it", () => {
    expect(windSpeedOf(36, "km/h")).toBeCloseTo(10);
    expect(windSpeedOf("10", "m/s")).toBe(10);
    expect(windSpeedOf(10, "mph")).toBeCloseTo(4.4704);
    expect(windSpeedOf(10, "kn")).toBeCloseTo(5.14444);
    // No unit said: Home Assistant's default, km/h.
    expect(windSpeedOf(18, undefined)).toBeCloseTo(5);
    expect(windSpeedOf(-1, "m/s")).toBeNaN();
    expect(windSpeedOf("calm", "m/s")).toBeNaN();
    expect(windSpeedOf(3, "furlongs")).toBeNaN();
    // Beaufort: force 6 is a strong breeze, about 12 m/s.
    expect(windSpeedOf(6, "Beaufort")).toBeCloseTo(12.29, 1);
    expect(bearingOf(270)).toBe(270);
    expect(bearingOf(-90)).toBe(270);
    expect(bearingOf("W")).toBe(270);
    expect(bearingOf("nne")).toBe(22.5);
    expect(bearingOf("225")).toBe(225);
    expect(bearingOf("somewhere")).toBeNaN();
    expect(bearingOf(undefined)).toBeNaN();
  });

  it("follows the chosen entity, else the usual one", () => {
    const home = hass([
      state("weather.coast", "pouring", {
        wind_speed: 54,
        wind_speed_unit: "km/h",
        wind_bearing: "SW",
      }),
      state("weather.home", "rainy", { wind_speed: 5, wind_speed_unit: "m/s", wind_bearing: 90 }),
      state("weather.broken", "unavailable"),
    ]);
    expect(weatherShown(home, undefined)).toEqual({
      entity: "weather.home",
      condition: "rainy",
      windSpeed: 5,
      windBearing: 90,
    });
    const coast = weatherShown(home, "weather.coast");
    expect(coast?.condition).toBe("pouring");
    expect(coast?.windSpeed).toBeCloseTo(15);
    expect(coast?.windBearing).toBe(225);
    // None wanted, one that says nothing now, one gone: nothing drawn.
    expect(weatherShown(home, "none")).toBeUndefined();
    expect(weatherShown(home, "weather.broken")).toBeUndefined();
    expect(weatherShown(home, "weather.gone")).toBeUndefined();
    expect(weatherShown(undefined, undefined)).toBeUndefined();
    expect(weatherEntities(home)).toEqual(["weather.broken", "weather.coast", "weather.home"]);
  });
});
