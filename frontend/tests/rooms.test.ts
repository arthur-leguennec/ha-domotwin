import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { NOTHING_UNSEEN, closedAreas, closedEntities } from "../src/live/privacy";
import { homeFloors, listed, searchEntities, sortEntities } from "../src/live/rooms";

const collator = new Intl.Collator("en");

function hass(): HomeAssistant {
  const state = (entity_id: string, friendly_name: string, value = "on") => ({
    entity_id,
    state: value,
    attributes: { friendly_name },
    last_changed: "",
    last_updated: "",
  });
  const states = {
    "light.sofa": state("light.sofa", "Sofa lamp"),
    "light.ceiling": state("light.ceiling", "Ceiling"),
    "sensor.living_temperature": state("sensor.living_temperature", "Temperature", "21"),
    "switch.kettle": state("switch.kettle", "Kettle"),
    "light.bedside": state("light.bedside", "Bedside lamp"),
    "light.porch": state("light.porch", "Porch"),
    "update.firmware": state("update.firmware", "Firmware"),
    "sensor.signal": state("sensor.signal", "Signal"),
    "light.hidden": state("light.hidden", "Hidden"),
    "light.cafe": state("light.cafe", "Café lamp"),
    "sensor.domotwin_living_people": state("sensor.domotwin_living_people", "People", "0"),
  };
  return {
    states,
    entities: {
      "light.sofa": { entity_id: "light.sofa", area_id: "living" },
      "light.ceiling": { entity_id: "light.ceiling", device_id: "dev1" },
      "sensor.living_temperature": { entity_id: "sensor.living_temperature", area_id: "living" },
      "switch.kettle": { entity_id: "switch.kettle", area_id: "kitchen" },
      "light.bedside": { entity_id: "light.bedside", area_id: "bedroom" },
      "light.porch": { entity_id: "light.porch" },
      "update.firmware": { entity_id: "update.firmware", area_id: "living" },
      "sensor.signal": {
        entity_id: "sensor.signal",
        area_id: "living",
        entity_category: "diagnostic",
      },
      "light.hidden": { entity_id: "light.hidden", area_id: "living", hidden: true },
      "light.cafe": { entity_id: "light.cafe", area_id: "kitchen" },
      "sensor.domotwin_living_people": {
        entity_id: "sensor.domotwin_living_people",
        area_id: "living",
        platform: "domotwin",
      },
    },
    devices: { dev1: { id: "dev1", area_id: "living" } },
    areas: {
      living: { area_id: "living", name: "Living room", floor_id: "ground" },
      kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      bedroom: { area_id: "bedroom", name: "Bedroom", floor_id: "upper" },
      garden: { area_id: "garden", name: "Garden" },
    },
    floors: {
      upper: { floor_id: "upper", name: "Upper floor", level: 1 },
      ground: { floor_id: "ground", name: "Ground floor", level: 0 },
    },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

describe("homeFloors", () => {
  it("lists Home Assistant's floors by level, their areas by name, then the areas of no floor", () => {
    const floors = homeFloors(hass(), NOTHING_UNSEEN, collator);
    expect(floors.map((floor) => floor.name)).toEqual(["Ground floor", "Upper floor", undefined]);
    expect(floors[0]?.areas.map((area) => area.name)).toEqual(["Kitchen", "Living room"]);
    expect(floors[2]?.areas.map((area) => area.id)).toEqual(["garden"]);
  });

  it("gives each area its entities, what one acts on first; its device's area counts", () => {
    const living = homeFloors(hass(), NOTHING_UNSEEN, collator)[0]?.areas[1];
    // Updates, diagnostic and hidden entities left out, and DomoTwin's own.
    expect(living?.entities).toEqual(["light.ceiling", "light.sofa", "sensor.living_temperature"]);
  });

  it("tells a private room's area, without what it holds", () => {
    const upper = homeFloors(
      hass(),
      { areas: new Set(["bedroom"]), entities: new Set() },
      collator,
    )[1];
    expect(upper?.areas[0]).toEqual({ id: "bedroom", name: "Bedroom", closed: true, entities: [] });
  });
});

describe("searchEntities", () => {
  it("finds every word in a name, an id or an area, without accents or case", () => {
    expect(searchEntities(hass(), "LAMP", NOTHING_UNSEEN, collator)).toEqual([
      "light.bedside",
      "light.cafe",
      "light.sofa",
    ]);
    expect(searchEntities(hass(), "cafe", NOTHING_UNSEEN, collator)).toEqual(["light.cafe"]);
    expect(searchEntities(hass(), "kitchen", NOTHING_UNSEEN, collator)).toEqual([
      "light.cafe",
      "switch.kettle",
    ]);
    expect(searchEntities(hass(), "living lamp", NOTHING_UNSEEN, collator)).toEqual(["light.sofa"]);
    // Entities of no area too.
    expect(searchEntities(hass(), "porch", NOTHING_UNSEEN, collator)).toEqual(["light.porch"]);
    expect(searchEntities(hass(), "  ", NOTHING_UNSEEN, collator)).toEqual([]);
  });

  it("finds nothing linked to a private room, whatever its area", () => {
    const unseen = { areas: new Set<string>(), entities: new Set(["light.porch"]) };
    expect(searchEntities(hass(), "porch", unseen, collator)).toEqual([]);
    expect(homeFloors(hass(), unseen, collator)[0]?.areas[1]?.entities).not.toContain(
      "light.porch",
    );
  });

  it("finds nothing in a private room", () => {
    expect(
      searchEntities(
        hass(),
        "bedside",
        { areas: new Set(["bedroom"]), entities: new Set() },
        collator,
      ),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("leaves out what has no tile worth showing", () => {
    const h = hass();
    expect(listed(h, "light.sofa")).toBe(true);
    expect(listed(h, "update.firmware")).toBe(false);
    expect(listed(h, "sensor.signal")).toBe(false);
    expect(listed(h, "light.unknown")).toBe(false);
  });

  it("orders by kind, then by name", () => {
    expect(
      sortEntities(hass(), ["sensor.living_temperature", "switch.kettle", "light.sofa"], collator),
    ).toEqual(["light.sofa", "switch.kettle", "sensor.living_temperature"]);
  });

  it("finds the areas of private rooms through the links or the rooms' names", () => {
    const rooms = [
      { id: "r1", name: "Bedroom" },
      { id: "r2", name: "Study" },
      { id: "r3", name: "Kitchen" },
    ];
    const bindings = { version: 1 as const, rooms: { r2: { area: "living" } }, elements: {} };
    expect([...closedAreas(hass(), bindings, rooms, new Set(["r1", "r2"]))].sort()).toEqual([
      "bedroom",
      "living",
    ]);
  });

  it("finds the entities linked to a private room and to what it holds, on any storey", () => {
    const bindings = {
      version: 1 as const,
      rooms: {},
      elements: {
        r1: { entities: [{ entity_id: "sensor.r1_motion" }] },
        lamp: { entities: [{ entity_id: "light.lamp" }] },
        moved: { entities: [{ entity_id: "light.moved" }] },
        added: { entities: [{ entity_id: "light.added" }] },
        upstairs: { entities: [{ entity_id: "light.upstairs" }] },
        hall: { entities: [{ entity_id: "light.hall" }] },
        bay: { entities: [{ entity_id: "binary_sensor.bay" }] },
      },
    };
    const ground = {
      plan: {
        format: "domotwin-plan",
        rooms: [{ id: "r1" }, { id: "r2" }],
        windows: [{ id: "bay", room: "r1" }],
        items: [
          { id: "lamp", kind: "lamp", room: "r1" },
          { id: "moved", kind: "lamp", room: "r2" },
          { id: "hall", kind: "lamp", room: "r2" },
        ],
      },
      layout: { moved: { room: "r1" }, added: { add: "lamp", room: "r1" } },
    };
    const upper = {
      plan: { format: "domotwin-plan", items: [{ id: "upstairs", kind: "lamp", room: "r3" }] },
    };
    expect([...closedEntities(bindings, [ground, upper], new Set(["r1", "r3"]))].sort()).toEqual([
      "binary_sensor.bay",
      "light.added",
      "light.lamp",
      "light.moved",
      "light.upstairs",
      "sensor.r1_motion",
    ]);
    expect(closedEntities(bindings, [ground], new Set()).size).toBe(0);
  });
});
