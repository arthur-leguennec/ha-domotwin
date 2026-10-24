import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { readBindings } from "../src/live/bindings";
import {
  applyLink,
  fit,
  planElement,
  searchEntities,
  suggestions,
  type PlanElementInfo,
} from "../src/live/suggest";

function entity(state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: "", state, attributes, last_changed: "", last_updated: "" };
}

function hass(): HomeAssistant {
  const states = {
    "light.reading": entity("on", { friendly_name: "Reading lamp" }),
    "light.ceiling": entity("off", { friendly_name: "Ceiling" }),
    "switch.plug": entity("off", { friendly_name: "Plug" }),
    "cover.curtains": entity("open", { device_class: "curtain", friendly_name: "Curtains" }),
    "cover.blind": entity("open", { device_class: "blind", friendly_name: "Blind" }),
    "binary_sensor.window": entity("off", { device_class: "window", friendly_name: "Window" }),
    "binary_sensor.door": entity("off", { device_class: "door", friendly_name: "Front door" }),
    "lock.front": entity("locked", { friendly_name: "Front lock" }),
    "sensor.fridge_power": entity("40", { device_class: "power", friendly_name: "Fridge power" }),
    "media_player.tv": entity("off", { friendly_name: "Télévision" }),
  };
  return {
    states,
    entities: Object.fromEntries(
      Object.keys(states).map((id) => [id, { entity_id: id, area_id: "living" }]),
    ),
    areas: { living: { area_id: "living", name: "Living room" } },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
  };
}

const lamp: PlanElementInfo = { id: "lamp", type: "furniture", name: "Lamp", kind: "lamp" };
const curtain: PlanElementInfo = { id: "c", type: "furniture", name: "C", kind: "curtain" };
const door: PlanElementInfo = { id: "d", type: "door", name: "Door" };
const window_: PlanElementInfo = { id: "w", type: "window", name: "Window" };
const fridge: PlanElementInfo = { id: "f", type: "furniture", name: "Fridge", kind: "fridge" };

describe("suggestions", () => {
  it("fits entities to the kind of element", () => {
    const h = hass();
    expect(fit(lamp, "light.reading", h)).toBeGreaterThan(fit(lamp, "switch.plug", h));
    expect(fit(lamp, "cover.curtains", h)).toBe(0);
    expect(fit(curtain, "cover.curtains", h)).toBeGreaterThan(fit(curtain, "cover.blind", h));
    expect(fit(door, "binary_sensor.door", h)).toBeGreaterThan(0);
    expect(fit(door, "lock.front", h)).toBeGreaterThan(0);
    expect(fit(door, "binary_sensor.window", h)).toBe(0);
    expect(fit(window_, "binary_sensor.window", h)).toBeGreaterThan(0);
    expect(fit(fridge, "sensor.fridge_power", h)).toBeGreaterThan(0);
  });

  it("suggests the area's entities that fit, best first, not those already linked", () => {
    const h = hass();
    expect(suggestions(h, lamp, "living", [])).toEqual([
      "light.ceiling",
      "light.reading",
      "switch.plug",
    ]);
    expect(suggestions(h, lamp, "living", ["light.ceiling"])).toEqual([
      "light.reading",
      "switch.plug",
    ]);
    expect(suggestions(h, lamp, undefined, [])).toEqual([]);
  });

  it("searches names and ids, accents ignored", () => {
    const h = hass();
    expect(searchEntities(h, lamp, "tele", [])).toEqual(["media_player.tv"]);
    expect(searchEntities(h, lamp, "front lo", [])).toEqual(["lock.front"]);
    expect(searchEntities(h, lamp, "l", [])).toEqual([]);
    expect(searchEntities(h, lamp, "reading", ["light.reading"])).toEqual([]);
  });
});

describe("editing bindings", () => {
  it("reads plan elements", () => {
    const plan = { elements: [{ id: "lamp", type: "furniture", name: "Lamp", kind: "lamp" }] };
    expect(planElement(plan, "lamp")).toEqual(lamp);
    expect(planElement(plan, "x")).toBeUndefined();
    expect(planElement(null, "lamp")).toBeUndefined();
  });

  it("sets and removes element and room links", () => {
    const start = readBindings({
      version: 1,
      rooms: { living: { area: "living" } },
      elements: { tv: { entities: [{ entity_id: "media_player.tv" }] } },
    });
    const linked = applyLink(start, {
      element: "lamp",
      binding: { entities: [{ entity_id: "light.reading" }], tap_action: { action: "none" } },
    });
    expect(Object.keys(linked.elements)).toEqual(["tv", "lamp"]);
    expect(start.elements.lamp).toBeUndefined();
    expect(applyLink(linked, { element: "tv", binding: { entities: [] } }).elements.tv).toBe(
      undefined,
    );
    expect(applyLink(linked, { room: "living", area: null }).rooms).toEqual({});
    expect(applyLink(linked, { room: "bed", area: "bedroom" }).rooms.bed).toEqual({
      area: "bedroom",
    });
  });
});
