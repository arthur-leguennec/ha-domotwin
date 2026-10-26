import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import type { BindingsJson } from "../src/live/bindings";
import { glanceOf, weatherOf, type GlanceSources } from "../src/live/glance";
import type { PlanRoom } from "../src/live/layers";
import type { PeopleSettings } from "../src/live/people";

const ROOMS: PlanRoom[] = [
  { id: "living", name: "Living room" },
  { id: "study", name: "Study" },
];
const BINDINGS: BindingsJson = {
  version: 1,
  rooms: { living: { area: "lounge" }, study: { area: "study" } },
  elements: {},
};

/** A fictional home: [entity id, area, state, attributes]. */
function home(
  entities: [string, string | null, string, Record<string, unknown>][],
  hidden: string[] = [],
): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  const registry: NonNullable<HomeAssistant["entities"]> = {};
  for (const [id, area, state, attributes] of entities) {
    states[id] = { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
    registry[id] = {
      entity_id: id,
      ...(area ? { area_id: area } : {}),
      ...(hidden.includes(id) ? { hidden: true } : {}),
    };
  }
  return {
    states,
    entities: registry,
    devices: {},
    areas: {
      lounge: { area_id: "lounge", name: "Lounge" },
      study: { area_id: "study", name: "Study" },
    },
    user: { id: "viewer", name: "Viewer", is_admin: false },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

const sources = (extra: Partial<GlanceSources> = {}): GlanceSources => ({
  rooms: ROOMS,
  bindings: BINDINGS,
  closed: new Set(),
  ...extra,
});

describe("weatherOf", () => {
  it("prefers weather.home and skips what has no value", () => {
    const hass = home([
      ["weather.away", null, "rainy", { temperature: 9 }],
      ["weather.home", null, "unavailable", {}],
      ["weather.garden", null, "sunny", { temperature: 21.5, temperature_unit: "°C" }],
    ]);
    expect(weatherOf(hass)).toEqual({
      entity: "weather.away",
      condition: "rainy",
      temperature: 9,
      unit: "°C",
    });
    hass.states["weather.home"] = {
      entity_id: "weather.home",
      state: "cloudy",
      attributes: { temperature: 50, temperature_unit: "°F" },
      last_changed: "",
      last_updated: "",
    };
    expect(weatherOf(hass)).toMatchObject({ entity: "weather.home", temperature: 50, unit: "°F" });
  });

  it("is none without a weather entity", () => {
    expect(weatherOf(home([]))).toBeUndefined();
  });
});

describe("glanceOf", () => {
  it("counts the lamps on, its groups' lamps rather than the groups, hidden ones aside", () => {
    const hass = home(
      [
        ["light.pendant", "lounge", "on", {}],
        ["light.spare", "lounge", "on", {}],
        ["light.desk", "study", "off", {}],
        ["light.all", null, "on", { entity_id: ["light.pendant", "light.spare"] }],
        ["light.hidden", "lounge", "on", {}],
      ],
      ["light.hidden"],
    );
    expect(glanceOf(hass, sources()).lights).toEqual(["light.pendant", "light.spare"]);
  });

  it("lists the doors, windows and gates open, not the blinds nor motion", () => {
    const hass = home([
      ["binary_sensor.front_door", null, "on", { device_class: "door" }],
      ["binary_sensor.window", "lounge", "off", { device_class: "window" }],
      ["binary_sensor.motion", "lounge", "on", { device_class: "motion" }],
      ["cover.garage", null, "opening", { device_class: "garage" }],
      ["cover.blind", "lounge", "open", { device_class: "blind" }],
    ]);
    expect(glanceOf(hass, sources()).openings).toEqual([
      "binary_sensor.front_door",
      "cover.garage",
    ]);
  });

  it("says who is home and how many are away, without DomoTwin's people settings", () => {
    const hass = home([
      ["person.sam", null, "home", { friendly_name: "Sam" }],
      ["person.alex", null, "home", { friendly_name: "Alex" }],
      ["person.kim", null, "not_home", { friendly_name: "Kim" }],
    ]);
    const glance = glanceOf(hass, sources());
    expect(glance.people?.map((p) => [p.name, p.initials])).toEqual([
      ["Alex", "AL"],
      ["Sam", "SA"],
    ]);
    expect(glance.away).toBe(1);
  });

  it("reads Home Assistant's people while DomoTwin has none placed, but who hid themselves", () => {
    const hass = home([
      ["person.sam", null, "home", { friendly_name: "Sam" }],
      ["person.alex", null, "home", { friendly_name: "Alex" }],
    ]);
    const settings = {
      revision: 1,
      shown: "everyone",
      look: "figure",
      hidden: ["person.alex"],
      people: {},
    } satisfies PeopleSettings;
    expect(glanceOf(hass, sources({ people: settings })).people?.map((p) => p.name)).toEqual([
      "Sam",
    ]);
  });

  it("shows no one to whom DomoTwin's people are not shown", () => {
    const hass = home([["person.sam", null, "home", { friendly_name: "Sam" }]]);
    const settings = {
      revision: 1,
      shown: "admins",
      look: "figure",
      hidden: [],
      people: {},
    } satisfies PeopleSettings;
    const glance = glanceOf(hass, sources({ people: settings }));
    expect(glance.people).toBeUndefined();
    expect(glance.away).toBe(0);
  });

  it("leaves out what a private room holds, its dangers aside", () => {
    const hass = home([
      ["light.desk", "study", "on", {}],
      ["binary_sensor.study_window", "study", "on", { device_class: "window" }],
      ["binary_sensor.study_smoke", "study", "on", { device_class: "smoke" }],
      ["light.pendant", "lounge", "on", {}],
    ]);
    const glance = glanceOf(hass, sources({ closed: new Set(["study"]) }));
    expect(glance.lights).toEqual(["light.pendant"]);
    expect(glance.openings).toEqual([]);
    expect(glance.alerts.map((a) => [a.room, a.reason, a.level])).toEqual([
      ["study", "smoke", "danger"],
    ]);
  });

  it("leaves out what is linked to a piece in a private room, whatever its area", () => {
    const hass = home([
      ["light.bedside", null, "on", {}],
      ["light.pendant", "lounge", "on", {}],
    ]);
    const glance = glanceOf(
      hass,
      sources({ closed: new Set(["study"]), closedEntities: new Set(["light.bedside"]) }),
    );
    expect(glance.lights).toEqual(["light.pendant"]);
  });

  it("works without bindings", () => {
    const hass = home([["light.pendant", "lounge", "on", {}]]);
    expect(glanceOf(hass, { rooms: ROOMS, closed: new Set() }).lights).toEqual(["light.pendant"]);
  });
});
