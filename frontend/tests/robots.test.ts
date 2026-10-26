import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { readBindings } from "../src/live/bindings";
import { robotDocks, robotsShown } from "../src/live/robots";
import { fit, type PlanElementInfo } from "../src/live/suggest";

function entity(state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: "", state, attributes, last_changed: "", last_updated: "" };
}

function hass(): HomeAssistant {
  const states = {
    "vacuum.robbie": entity("cleaning", { friendly_name: "Robbie" }),
    "vacuum.upstairs": entity("docked"),
    "sensor.robbie_battery": entity("80", { device_class: "battery" }),
    "light.hall": entity("on"),
  };
  return {
    states,
    entities: {},
    areas: {},
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
  };
}

describe("robot vacuums (D-049)", () => {
  it("are the robot-vacuum pieces linked to a vacuum, with its state", () => {
    const bindings = readBindings({
      version: 1,
      rooms: {},
      elements: {
        dock: {
          entities: [{ entity_id: "sensor.robbie_battery" }, { entity_id: "vacuum.robbie" }],
        },
        "dock-2": { entities: [{ entity_id: "vacuum.upstairs" }] },
        // Not a dock, or a vacuum Home Assistant does not know, or no vacuum at all.
        lamp: { entities: [{ entity_id: "vacuum.robbie" }] },
        "dock-3": { entities: [{ entity_id: "vacuum.gone" }] },
        "dock-4": { entities: [{ entity_id: "light.hall" }] },
      },
    });
    const kinds = {
      dock: "robot-vacuum",
      "dock-2": "robot-vacuum",
      "dock-3": "robot-vacuum",
      "dock-4": "robot-vacuum",
      lamp: "floor-lamp",
    };
    const docks = robotDocks(bindings, kinds);
    expect(docks).toEqual([
      { id: "dock", vacuum: "vacuum.robbie" },
      { id: "dock-2", vacuum: "vacuum.upstairs" },
      { id: "dock-3", vacuum: "vacuum.gone" },
    ]);
    expect(robotsShown(hass(), docks)).toEqual([
      { id: "dock", state: "cleaning" },
      { id: "dock-2", state: "docked" },
    ]);
    expect(robotsShown(undefined, docks)).toEqual([]);
    expect(robotDocks(undefined, kinds)).toEqual([]);
  });

  it("are suggested a vacuum when linked", () => {
    const dock: PlanElementInfo = { id: "dock", type: "furniture", kind: "robot-vacuum", name: "" };
    const h = hass();
    expect(fit(dock, "vacuum.robbie", h)).toBe(3);
    expect(fit(dock, "light.hall", h)).toBe(0);
  });
});
