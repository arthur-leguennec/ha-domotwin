import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { guideExample } from "../src/live/guide";

/** A fictional home: [entity id, area, attributes, registry extras]. */
function home(
  entities: [string, string, Record<string, unknown>, Record<string, unknown>?][],
): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  const registry: NonNullable<HomeAssistant["entities"]> = {};
  for (const [id, area, attributes, extra] of entities) {
    states[id] = { entity_id: id, state: "off", attributes, last_changed: "", last_updated: "" };
    registry[id] = { entity_id: id, area_id: area, ...extra };
  }
  return {
    states,
    entities: registry,
    devices: {},
    areas: {
      hall: { area_id: "hall", name: "Hall" },
      attic: { area_id: "attic", name: "Attic" },
      bedroom: { area_id: "bedroom", name: "Bedroom" },
    },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

describe("the guide to making an automation's example (D-093)", () => {
  it("joins a motion sensor and a light of the same area, else a door sensor", () => {
    const hass = home([
      ["binary_sensor.hall_door", "hall", { device_class: "door", friendly_name: "Hall door" }],
      ["light.hall", "hall", { friendly_name: "Hall light" }],
      [
        "binary_sensor.bedroom_motion",
        "bedroom",
        { device_class: "motion", friendly_name: "Bedroom motion" },
      ],
      ["light.bedroom", "bedroom", { friendly_name: "Bedroom lamp" }],
      // A motion sensor alone in its area: no light to switch on there.
      ["binary_sensor.attic_motion", "attic", { device_class: "motion" }],
    ]);
    expect(guideExample(hass)).toEqual({
      kind: "motion",
      sensor: "Bedroom motion",
      light: "Bedroom lamp",
    });
    // A private bedroom the viewer may not see (D-039): not in the example.
    expect(guideExample(hass, (id) => id.includes("bedroom"))).toEqual({
      kind: "door",
      sensor: "Hall door",
      light: "Hall light",
    });
    delete hass.states["binary_sensor.bedroom_motion"];
    expect(guideExample(hass)).toEqual({ kind: "door", sensor: "Hall door", light: "Hall light" });
  });

  it("leaves hidden and diagnostic entities out, and says nothing without a pair", () => {
    const hass = home([
      ["binary_sensor.hall_motion", "hall", { device_class: "motion" }, { hidden: true }],
      ["light.hall", "hall", {}],
      [
        "binary_sensor.hall_door",
        "hall",
        { device_class: "door" },
        { entity_category: "diagnostic" },
      ],
    ]);
    expect(guideExample(hass)).toBeUndefined();
    expect(guideExample(undefined)).toBeUndefined();
  });
});
