import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { atMinute, minuteOfDay, startOfDay } from "../src/live/clock";
import { hasWindows, sunModel, sunNow, sunnyRooms, sunshineHours, sunTimes } from "../src/live/sun";

/** Two rooms side by side: the living room's window on the top wall, the kitchen's on the right. */
const plan = {
  rooms: [
    {
      id: "living",
      outline: [
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300],
      ],
    },
    {
      id: "kitchen",
      outline: [
        [400, 0],
        [700, 0],
        [700, 300],
        [400, 300],
      ],
    },
    {
      id: "garden",
      outside: true,
      outline: [
        [0, -500],
        [700, -500],
        [700, 0],
        [0, 0],
      ],
    },
  ],
  windows: [
    { id: "w1", from: [100, 0], to: [300, 0], room: "living" },
    { id: "w2", from: [700, 50], to: [700, 250], room: "kitchen" },
    { id: "w3", from: [100, 0], to: [300, 0], room: "garden" },
  ],
};

describe("the sun through the windows (D-023)", () => {
  it("shines into the rooms whose windows face it, while it is up", () => {
    // North at the top of the plan: the living room's window faces north, the kitchen's east.
    expect(sunnyRooms(plan, { azimuth: 0, elevation: 20 }, 0)).toEqual(["living"]);
    expect(sunnyRooms(plan, { azimuth: 90, elevation: 30 }, 0)).toEqual(["kitchen"]);
    expect(sunnyRooms(plan, { azimuth: 45, elevation: 30 }, 0)).toEqual(["living", "kitchen"]);
    expect(sunnyRooms(plan, { azimuth: 200, elevation: 40 }, 0)).toEqual([]);
    // Below the horizon: none.
    expect(sunnyRooms(plan, { azimuth: 0, elevation: -3 }, 0)).toEqual([]);
    // North turned a quarter clockwise: the top wall faces west.
    expect(sunnyRooms(plan, { azimuth: 270, elevation: 20 }, 90)).toEqual(["living"]);
    expect(sunnyRooms(undefined, { azimuth: 0, elevation: 20 }, 0)).toEqual([]);
  });

  it("knows which side is out in an L-shaped room, whose middle is outside it", () => {
    // An L: its inner wall at x = 200 (y 200 to 400) faces east, out to the yard in the corner.
    const corner = {
      rooms: [
        {
          id: "l",
          outline: [
            [0, 0],
            [400, 0],
            [400, 200],
            [200, 200],
            [200, 400],
            [0, 400],
          ],
        },
      ],
      windows: [{ id: "w", from: [200, 250], to: [200, 350], room: "l" }],
    };
    expect(sunnyRooms(corner, { azimuth: 90, elevation: 30 }, 0)).toEqual(["l"]);
    expect(sunnyRooms(corner, { azimuth: 270, elevation: 30 }, 0)).toEqual([]);
  });

  it("reads where the sun is from Home Assistant", () => {
    const hass = (attributes: Record<string, unknown>) =>
      ({
        states: { "sun.sun": { state: "above_horizon", attributes } },
      }) as unknown as HomeAssistant;
    expect(sunNow(hass({ azimuth: 180.5, elevation: 42 }))).toEqual({
      azimuth: 180.5,
      elevation: 42,
    });
    expect(sunNow(hass({}))).toBeUndefined();
    expect(sunNow(undefined)).toBeUndefined();
  });
});

/** Home Assistant set at a city's coordinates, as an atlas gives them (no one's home). */
function placed(latitude: unknown, longitude: unknown): HomeAssistant {
  return { states: {}, config: { latitude, longitude } } as unknown as HomeAssistant;
}

const MINUTE = 60_000;

describe("the sun at any hour (D-093)", () => {
  it("is worked out from where Home Assistant says the home is", () => {
    const model = sunModel(placed(48.8566, 2.3522));
    expect(model?.latitude).toBe(48.8566);
    // The sun at its highest on 21 June in Paris: 90° − 48.86° + 23.44°, due south.
    const noon = model?.at(Date.parse("2026-06-21T11:52:00Z"));
    expect(noon?.elevation).toBeCloseTo(64.58, 0);
    expect(noon?.azimuth).toBeGreaterThan(178);
    expect(noon?.azimuth).toBeLessThan(182);
    // In Sydney at noon in June, low in the north.
    const sydney = sunModel(placed(-33.87, 151.21))?.at(Date.parse("2026-06-21T01:58:00Z"));
    expect(sydney?.elevation).toBeCloseTo(32.7, 0);
    expect(Math.min(sydney?.azimuth ?? 99, 360 - (sydney?.azimuth ?? 0))).toBeLessThan(2);
    // Not said, or not a place.
    expect(sunModel(placed(undefined, undefined))).toBeUndefined();
    expect(sunModel(placed(null, 2))).toBeUndefined();
    expect(sunModel(placed(95, 2))).toBeUndefined();
    expect(sunModel(undefined)).toBeUndefined();
  });

  it("says when the sun rises and sets", () => {
    const model = sunModel(placed(48.8566, 2.3522));
    if (!model) throw new Error("no sun");
    const start = Date.parse("2026-06-21T00:00:00+02:00");
    const { rise, set } = sunTimes(model, start, start + 24 * 3600_000);
    // 05:47 and 21:58 in Paris, within two minutes.
    expect(Math.abs((rise ?? 0) - Date.parse("2026-06-21T03:47:00Z"))).toBeLessThan(2 * MINUTE);
    expect(Math.abs((set ?? 0) - Date.parse("2026-06-21T19:58:00Z"))).toBeLessThan(2 * MINUTE);
    // No sunset in a polar day.
    const north = sunModel(placed(78, 15));
    if (!north) throw new Error("no sun");
    expect(sunTimes(north, start, start + 24 * 3600_000)).toEqual({});
  });

  it("takes the demo house's own sun, which has no seasons", () => {
    const sun = (time: number) => ({ azimuth: 180, elevation: time > 0 ? 30 : -5 });
    const model = sunModel({ states: {}, sunAt: sun } as unknown as HomeAssistant);
    expect(model?.at(1)).toEqual({ azimuth: 180, elevation: 30 });
    expect(model?.latitude).toBeUndefined();
  });

  it("counts each room's hours of sun through its windows", () => {
    const model = sunModel(placed(48.8566, 2.3522));
    if (!model) throw new Error("no sun");
    const withStudy = {
      ...plan,
      rooms: [
        ...plan.rooms,
        {
          id: "study",
          outline: [
            [0, 300],
            [400, 300],
            [400, 600],
            [0, 600],
          ],
        },
      ],
    };
    const start = Date.parse("2026-06-21T00:00:00+02:00");
    const hours = sunshineHours([withStudy], model, 0, start, start + 24 * 3600_000);
    // Every room inside, none outside; the study has no window.
    expect(Object.keys(hours).sort()).toEqual(["kitchen", "living", "study"]);
    expect(hours.study).toBe(0);
    // The east window has the morning; the north one only the first and last hours.
    expect(hours.kitchen).toBeGreaterThan(5);
    expect(hours.kitchen).toBeLessThan(9);
    expect(hours.living).toBeGreaterThan(1);
    expect(hours.living).toBeLessThan(5);
    // A shorter day: less sun.
    const december = Date.parse("2026-12-21T00:00:00+01:00");
    const winter = sunshineHours([withStudy], model, 0, december, december + 24 * 3600_000);
    expect(winter.kitchen).toBeLessThan(hours.kitchen ?? 0);
    expect(winter.living).toBe(0);
    expect(hasWindows([withStudy])).toBe(true);
    expect(hasWindows([{ rooms: withStudy.rooms }, undefined])).toBe(false);
  });
});

describe("the home's clock (D-093)", () => {
  it("finds an hour of the home's day, on the days the clocks change too", () => {
    const paris = "Europe/Paris";
    // 29 March 2026: Paris goes from 02:00 to 03:00; 03:00 is then 01:00 UTC.
    const spring = Date.parse("2026-03-29T08:00:00Z");
    expect(new Date(startOfDay(spring, paris)).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(new Date(atMinute(spring, 3 * 60, paris)).toISOString()).toBe(
      "2026-03-29T01:00:00.000Z",
    );
    expect(new Date(atMinute(spring, 24 * 60, paris)).toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(minuteOfDay(spring, paris)).toBe(10 * 60);
    expect(minuteOfDay(Date.parse("2026-06-15T14:30:45Z"), "UTC")).toBe(14 * 60 + 30);
  });
});
