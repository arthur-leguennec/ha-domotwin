import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import {
  colorOf,
  homePicture,
  ownHidden,
  initials,
  peopleByRoom,
  peopleByStorey,
  peopleJson,
  peopleShown,
  SEEN_COLOR,
  SEEN_SENSOR,
  seenShown,
  type PeopleSettings,
} from "../src/live/people";

/** Fictional people: Alex in the kitchen, Sam somewhere at home, Kim away, Lou hidden. */
const settings: PeopleSettings = {
  revision: 3,
  shown: "everyone",
  look: "figure",
  hidden: ["person.lou"],
  people: {
    "person.alex": {
      sources: ["sensor.alex_phone_area"],
      color: "#e8508a",
      sensor: "sensor.domotwin_alex_room",
    },
    "person.sam": { sources: [], color: "#2f9fd8", sensor: "sensor.domotwin_sam_room" },
    "person.kim": { sources: [], color: "#3fae5a", sensor: "sensor.domotwin_kim_room" },
    "person.lou": { sources: [], color: "#8a63d2", sensor: "sensor.domotwin_lou_room" },
  },
};

function hass(admin = true): HomeAssistant {
  const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) => ({
    entity_id,
    state: value,
    attributes,
    last_changed: "",
    last_updated: "",
  });
  return {
    language: "en",
    user: { id: "user-alex", name: "Alex", is_admin: admin },
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    states: {
      "person.alex": state("person.alex", "home", {
        friendly_name: "Alex Martin",
        user_id: "user-alex",
        entity_picture: "/api/image/serve/alex/512x512",
      }),
      "person.sam": state("person.sam", "home", {
        friendly_name: "Sam",
        entity_picture: "https://example.invalid/sam.png",
      }),
      "person.kim": state("person.kim", "not_home", { friendly_name: "Kim" }),
      "person.lou": state("person.lou", "home", { friendly_name: "Lou" }),
      "sensor.domotwin_alex_room": state("sensor.domotwin_alex_room", "Kitchen", {
        room_id: "kitchen",
        storey_id: "ground",
        since: "2026-10-25T08:00:00+00:00",
        source: "sensor.alex_phone_area",
      }),
      "sensor.domotwin_sam_room": state("sensor.domotwin_sam_room", "unknown", {}),
      "sensor.domotwin_kim_room": state("sensor.domotwin_kim_room", "not_home", {}),
    },
  };
}

describe("people (D-034)", () => {
  it("reads initials and pictures from Home Assistant only", () => {
    expect(initials("Alex Martin")).toBe("AM");
    expect(initials("Sam")).toBe("SA");
    expect(initials("élodie")).toBe("ÉL");
    expect(initials("  ")).toBe("?");
    expect(homePicture("/api/image/serve/x/512x512")).toBe("/api/image/serve/x/512x512");
    expect(homePicture("https://example.invalid/x.png")).toBeUndefined();
    expect(homePicture("//example.invalid/x.png")).toBeUndefined();
    expect(homePicture(42)).toBeUndefined();
  });

  it("shows the people at home, not hidden, in their rooms", () => {
    const people = peopleShown(settings, hass());
    expect(people.map((p) => [p.id, p.room ?? null, p.home])).toEqual([
      ["person.alex", "kitchen", true],
      ["person.kim", null, false],
      ["person.sam", null, true],
    ]);
    expect(people[0]).toMatchObject({
      name: "Alex Martin",
      initials: "AM",
      roomName: "Kitchen",
      storey: "ground",
      source: "sensor.alex_phone_area",
      picture: "/api/image/serve/alex/512x512",
      self: true,
    });
    expect(people[2]?.picture).toBeUndefined();
    // The engine draws those in a room.
    expect(JSON.parse(peopleJson(people, "pin"))).toEqual([
      { id: "person.alex", room: "kitchen", color: "#e8508a", look: "pin" },
    ]);
    expect([...peopleByRoom(people)].map(([room, list]) => [room, list.length])).toEqual([
      ["kitchen", 1],
    ]);
    expect([...peopleByStorey(people)]).toEqual([["ground", 1]]);
  });

  it("stands someone where the locating says they are in their room (D-079)", () => {
    const placed = hass();
    const sensor = placed.states["sensor.domotwin_alex_room"];
    if (!sensor) throw new Error("no sensor");
    sensor.attributes = { ...sensor.attributes, x: 2.4, y: 1.15 };
    const [alex] = peopleShown(settings, placed);
    expect(alex?.at).toEqual([240, 115]);
    expect(JSON.parse(peopleJson(alex ? [alex] : [], "figure"))).toEqual([
      { id: "person.alex", room: "kitchen", color: "#e8508a", look: "figure", at: [240, 115] },
    ]);
    // Not a number: no spot.
    sensor.attributes = { ...sensor.attributes, x: "2.4" };
    expect(peopleShown(settings, placed)[0]?.at).toBeUndefined();
  });

  it("gives the colours the integration gives, and finds oneself hidden", () => {
    // The same as `people.color_of` in the integration.
    expect(["person.alex", "person.sam", "person.kim", "person.élodie"].map(colorOf)).toEqual([
      "#8a63d2",
      "#e3912b",
      "#e3912b",
      "#d8573c",
    ]);
    expect(ownHidden(settings, hass())).toBeUndefined();
    expect(ownHidden({ ...settings, hidden: ["person.alex"] }, hass())).toBe("person.alex");
    expect(ownHidden({ ...settings, hidden: ["person.lou"] }, hass())).toBeUndefined();
  });

  it("shows the people the radars see whom no device names (D-080)", () => {
    const seen = hass();
    const sensor = {
      entity_id: SEEN_SENSOR,
      state: "3",
      attributes: {
        seen: [
          { id: 4, room_id: "living", storey_id: "ground", x: 1.95, y: 2.03 },
          { id: 7, room_id: "bedroom", storey_id: "ground", x: 6.1, y: 5.0 },
          // Not what the sensor says: left out.
          { id: "8", room_id: "living", x: 1, y: 1 },
          { id: 9, room_id: "living", x: "1", y: 1 },
          null,
        ],
      },
      last_changed: "",
      last_updated: "",
    };
    seen.states[SEEN_SENSOR] = sensor;
    const shown = seenShown(settings, seen);
    expect(shown).toEqual([
      { id: "seen.4", room: "living", storey: "ground", at: [195, 203] },
      { id: "seen.7", room: "bedroom", storey: "ground", at: [610, 500] },
    ]);
    // Not in a room the viewer may not see; to nobody but administrators when so shown.
    expect(seenShown(settings, seen, new Set(["bedroom"])).map((s) => s.id)).toEqual(["seen.4"]);
    const viewer: HomeAssistant = {
      ...seen,
      user: { id: "user-sam", name: "Sam", is_admin: false },
    };
    expect(seenShown({ ...settings, shown: "admins" }, viewer)).toEqual([]);
    expect(seenShown(settings, viewer)).toHaveLength(2);
    expect(seenShown(undefined, seen)).toEqual([]);
    expect(seenShown(settings, hass())).toEqual([]);
    // As the settings name its sensor (renamed); none when not shown to the viewer.
    const renamed: HomeAssistant = { ...seen, states: { "sensor.radar_people": sensor } };
    expect(seenShown({ ...settings, seen: "sensor.radar_people" }, renamed)).toHaveLength(2);
    expect(seenShown({ ...settings, seen: null }, seen)).toEqual([]);
    // Drawn as figures of no one's colour.
    expect(JSON.parse(peopleJson([], "pin", shown.slice(0, 1)))).toEqual([
      { id: "seen.4", room: "living", color: SEEN_COLOR, look: "pin", at: [195, 203] },
    ]);
  });

  it("counts a workplace's people, naming none (D-086)", () => {
    const counted: PeopleSettings = { ...settings, counted: true };
    expect(peopleShown(counted, hass())).toEqual([]);
    // Those in a room drawn as figures of no one's colour, numbered, never named.
    const shown = seenShown(counted, hass());
    expect(shown).toEqual([{ id: "counted.0", room: "kitchen", storey: "ground" }]);
    // Numbered in the order placed: the same while others hide.
    expect(seenShown({ ...counted, hidden: ["person.sam", "person.lou"] }, hass())).toEqual(shown);
    expect(JSON.stringify(shown)).not.toContain("alex");
    expect(seenShown(counted, hass(), new Set(["kitchen"]))).toEqual([]);
    expect(JSON.parse(peopleJson([], "figure", shown))).toEqual([
      { id: "counted.0", room: "kitchen", color: SEEN_COLOR, look: "figure" },
    ]);
  });

  it("shows nobody to others when shown to administrators only", () => {
    const admins: PeopleSettings = { ...settings, shown: "admins" };
    expect(peopleShown(admins, hass(false))).toEqual([]);
    expect(peopleShown(admins, hass(true))).toHaveLength(3);
    expect(peopleShown(undefined, hass())).toEqual([]);
  });
});
