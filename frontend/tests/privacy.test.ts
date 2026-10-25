import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { outOfSight, privateRooms } from "../src/live/privacy";

/** Fictional people and switches: Alex has a user, Sam none. */
function hass(user: string | undefined): HomeAssistant {
  const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) => ({
    entity_id,
    state: value,
    attributes,
    last_changed: "",
    last_updated: "",
  });
  return {
    language: "en",
    ...(user ? { user: { id: user, name: "Viewer", is_admin: true } } : {}),
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    states: {
      "person.alex": state("person.alex", "home", { user_id: "user-alex" }),
      "person.sam": state("person.sam", "home"),
      "input_boolean.guests": state("input_boolean.guests", "off"),
      "input_boolean.night": state("input_boolean.night", "on"),
      "binary_sensor.gone": state("binary_sensor.gone", "unavailable"),
    },
  };
}

const ROOMS = {
  bedroom: { people: ["person.alex"] },
  office: { people: [] },
  guest: { people: [], while: "input_boolean.guests" },
  kids: { people: ["person.alex"], while: "input_boolean.night" },
  attic: { people: [], while: "binary_sensor.gone" },
  cellar: { people: [], while: "switch.missing" },
};

describe("private rooms (D-039)", () => {
  it("are closed to whoever is not among their people, as the integration says", () => {
    expect([...privateRooms(ROOMS, hass("user-alex"))].sort()).toEqual([
      "attic",
      "cellar",
      "office",
    ]);
    // Another user (even an administrator), or a screen nobody is.
    for (const user of ["user-other", undefined]) {
      expect([...privateRooms(ROOMS, hass(user))].sort()).toEqual([
        "attic",
        "bedroom",
        "cellar",
        "kids",
        "office",
      ]);
    }
    expect(privateRooms(undefined, hass("user-alex")).size).toBe(0);
    expect(privateRooms({ bedroom: { people: ["person.sam"] } }, undefined).has("bedroom")).toBe(
      true,
    );
  });

  it("keep people and things there out of sight: there, but not where", () => {
    const closed = new Set(["bedroom"]);
    const people = [
      {
        id: "a",
        room: "bedroom",
        roomName: "Bedroom",
        storey: "up",
        since: "now",
        source: "binary_sensor.bedroom_motion",
        home: true,
      },
      { id: "b", room: "kitchen", roomName: "Kitchen", home: true },
      { id: "c", home: false },
    ];
    expect(outOfSight(people, closed)).toEqual([
      { id: "a", home: true, private: true },
      people[1],
      people[2],
    ]);
    expect(outOfSight(people, new Set())).toBe(people);
  });
});
