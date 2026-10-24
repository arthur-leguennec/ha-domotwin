import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import {
  areaEntities,
  deriveRole,
  holdAction,
  primaryEntity,
  readBindings,
  roomArea,
  tapAction,
} from "../src/live/bindings";
import { runAction, toggleService } from "../src/live/actions";
import { StateSync } from "../src/live/states";

function entity(state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: "", state, attributes, last_changed: "", last_updated: "" };
}

function hass(): HomeAssistant {
  return {
    states: {
      "light.a": entity("on", { brightness: 200, friendly_name: "Lamp", supported_features: 1 }),
      "binary_sensor.door": entity("off", { device_class: "door" }),
      "cover.c": entity("open", { current_position: 70 }),
      "scene.evening": entity("scening"),
      "sensor.t": entity("21"),
    },
    entities: {
      "light.a": { entity_id: "light.a", area_id: "living_room" },
      "cover.c": { entity_id: "cover.c", device_id: "dev1" },
      "scene.evening": { entity_id: "scene.evening", area_id: "living_room" },
      "sensor.t": { entity_id: "sensor.t", area_id: "living_room", entity_category: "diagnostic" },
    },
    devices: { dev1: { id: "dev1", area_id: "living_room" } },
    areas: { living_room: { area_id: "living_room", name: "Living room" } },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
  };
}

describe("bindings", () => {
  it("derives roles and default actions", () => {
    const h = hass();
    expect(deriveRole("binary_sensor.door", h)).toBe("contact");
    expect(deriveRole("sensor.t", h)).toBe("sensor");
    const lamp = { entities: [{ entity_id: "sensor.t" }, { entity_id: "light.a" }] };
    expect(primaryEntity(lamp, h)).toBe("light.a");
    expect(tapAction(lamp, h)).toEqual({ action: "toggle" });
    expect(tapAction({ entities: [{ entity_id: "sensor.t" }] }, h)).toEqual({
      action: "more-info",
    });
    expect(holdAction(lamp)).toEqual({ action: "controls" });
  });

  it("reads stored bindings leniently", () => {
    const read = readBindings({
      rooms: { a: { area: "x" }, b: { area: 3 } },
      elements: { lamp: { entities: [{ entity_id: "light.a" }, 7] }, bad: { entities: [] } },
    });
    expect(read.rooms).toEqual({ a: { area: "x" } });
    expect(Object.keys(read.elements)).toEqual(["lamp"]);
    expect(readBindings(null).elements).toEqual({});
  });

  it("finds a room's area and its entities", () => {
    const h = hass();
    const bindings = readBindings({});
    expect(roomArea(h, bindings, "living", "Living Room")).toBe("living_room");
    expect(roomArea(h, bindings, "x", "Garage")).toBeUndefined();
    expect(areaEntities(h, "living_room")).toEqual(["cover.c", "light.a", "scene.evening"]);
  });
});

describe("actions", () => {
  it("toggles, performs actions and opens more-info", async () => {
    const h = hass();
    const callService = vi.fn(() => Promise.resolve());
    h.callService = callService;
    const node = document.createElement("div");
    const binding = { entities: [{ entity_id: "light.a" }] };
    await runAction(node, h, { action: "toggle" }, binding);
    expect(callService).toHaveBeenCalledWith(
      "homeassistant",
      "toggle",
      {},
      {
        entity_id: "light.a",
      },
    );
    await runAction(
      node,
      h,
      { action: "perform-action", perform_action: "light.turn_on", data: { brightness_pct: 30 } },
      binding,
    );
    expect(callService).toHaveBeenLastCalledWith(
      "light",
      "turn_on",
      { brightness_pct: 30 },
      undefined,
    );
    const seen: unknown[] = [];
    node.addEventListener("hass-more-info", (e) => seen.push((e as CustomEvent).detail));
    expect(await runAction(node, h, { action: "more-info" }, binding)).toBe("done");
    expect(seen).toEqual([{ entityId: "light.a" }]);
    expect(await runAction(node, h, { action: "controls" }, binding)).toBe("controls");
    expect(toggleService("cover.c", false)).toEqual(["cover", "toggle"]);
  });
});

describe("StateSync", () => {
  it("sends only what changed", () => {
    const h = hass();
    const sync = new StateSync();
    const ids = new Set(["light.a", "light.missing"]);
    const first = JSON.parse(sync.changes(h, ids) ?? "{}") as Record<string, unknown>;
    expect(first["light.a"]).toEqual({ state: "on", attributes: { brightness: 200 } });
    expect(first["light.missing"]).toBeNull();
    expect(sync.changes(h, ids)).toBeUndefined();
    h.states["light.a"] = entity("off");
    expect(JSON.parse(sync.changes(h, ids) ?? "{}")).toEqual({
      "light.a": { state: "off", attributes: {} },
    });
    expect(JSON.parse(sync.changes(h, new Set()) ?? "{}")).toEqual({
      "light.a": null,
      "light.missing": null,
    });
  });
});
