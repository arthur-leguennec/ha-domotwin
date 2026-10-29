import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { sunNow, sunnyRooms } from "../src/live/sun";

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
