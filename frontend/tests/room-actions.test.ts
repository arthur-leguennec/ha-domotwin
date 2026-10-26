import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { readBindings } from "../src/live/bindings";
import { presetByKey, presetOf, presets } from "../src/live/presets";
import {
  presentDevices,
  roomActions,
  roomCommands,
  roomDevices,
  runCommand,
  schedulableGroups,
} from "../src/live/room-actions";
import { applyLink } from "../src/live/suggest";

function hass(
  states: Record<string, string>,
  areas: Record<string, string> = {},
  attributes: Record<string, Record<string, unknown>> = {},
): HomeAssistant {
  return {
    states: Object.fromEntries(
      Object.entries(states).map(([id, state]) => [
        id,
        { entity_id: id, state, attributes: attributes[id] ?? {} },
      ]),
    ),
    entities: Object.fromEntries(
      Object.keys(states).map((id) => [id, { entity_id: id, area_id: areas[id] }]),
    ),
    devices: {},
    areas: { living: { area_id: "living", name: "Living room" } },
    callService: vi.fn(() => Promise.resolve()),
  } as unknown as HomeAssistant;
}

describe("plain actions (D-047)", () => {
  it("offers each kind of device what it does", () => {
    const keys = (id: string) => presets(id).map((p) => p.key);
    expect(keys("light.a")).toEqual(["toggle", "on", "off", "brighter", "dimmer"]);
    expect(keys("media_player.tv")).toContain("volume_up");
    expect(keys("cover.blind")).toEqual(["toggle", "open", "close", "stop"]);
    expect(keys("vacuum.robot")).toEqual(["start", "pause", "home", "locate"]);
    expect(keys("sensor.temperature")).toEqual([]);
    expect(presetByKey("vacuum.robot home")?.action).toEqual({
      action: "perform-action",
      perform_action: "vacuum.return_to_base",
      target: { entity_id: "vacuum.robot" },
    });
  });

  it("finds an action among them, whatever the order of its fields", () => {
    const action = {
      action: "perform-action" as const,
      data: { brightness_step_pct: -20 },
      target: { entity_id: "light.a" },
      perform_action: "light.turn_on",
    };
    expect(presetOf(action, ["light.a"])?.key).toBe("dimmer");
    expect(presetOf({ ...action, data: { brightness_step_pct: -10 } }, ["light.a"])).toBe(
      undefined,
    );
    // A TV's power is its own toggle, not DomoTwin's (which plays or pauses).
    expect(presetOf({ action: "toggle" }, ["media_player.tv"], "media_player.tv")).toBe(undefined);
  });
});

describe("room actions (D-047)", () => {
  const bindings = readBindings({
    version: 1,
    rooms: {
      living: {
        area: "living",
        actions: [
          { name: "Film", action: { action: "perform-action", perform_action: "scene.turn_on" } },
          { name: " ", action: { action: "none" } },
          { name: "Broken" },
        ],
      },
    },
    elements: {
      lamp: { entities: [{ entity_id: "switch.plug", role: "light" }] },
    },
  });

  it("reads a room's devices from its area and its pieces", () => {
    const home = hass(
      {
        "light.ceiling": "on",
        "switch.plug": "off",
        "cover.blind": "open",
        "media_player.tv": "playing",
      },
      { "light.ceiling": "living", "cover.blind": "living", "media_player.tv": "living" },
      // A TV that can switch off (`TURN_OFF`), a blind that opens and closes.
      { "media_player.tv": { supported_features: 256 }, "cover.blind": { supported_features: 15 } },
    );
    const devices = presentDevices(home, roomDevices(home, bindings, "living", ["lamp"]));
    expect(devices.lights).toEqual(["light.ceiling", "switch.plug"]);
    expect(devices.covers).toEqual(["cover.blind"]);
    expect(roomCommands(home, devices).map((c) => c.key)).toEqual([
      "lights_on",
      "lights_off",
      "covers_open",
      "covers_close",
      "media_off",
    ]);
    // A lamp on a plug is switched through `homeassistant`.
    expect(roomCommands(home, devices)[1]?.calls).toEqual([
      ["light", "turn_off", ["light.ceiling"]],
      ["homeassistant", "turn_off", ["switch.plug"]],
    ]);
    expect(schedulableGroups(devices).map((g) => g.key)).toEqual(["lights", "covers"]);
    // Nothing plays: no "media off".
    const tv = home.states["media_player.tv"];
    if (tv) home.states["media_player.tv"] = { ...tv, state: "off" };
    expect(roomCommands(home, devices).map((c) => c.key)).not.toContain("media_off");
  });

  it("leaves out garage doors, covers and players that cannot do it, and what is not there", () => {
    const home = hass(
      {
        "cover.garage": "closed",
        "cover.blind": "open",
        "cover.tilt": "open",
        "media_player.speaker": "playing",
        "light.gone": "on",
      },
      {
        "cover.garage": "living",
        "cover.blind": "living",
        "cover.tilt": "living",
        "media_player.speaker": "living",
        "light.gone": "living",
      },
      {
        "cover.garage": { device_class: "garage", supported_features: 3 },
        "cover.blind": { supported_features: 15 },
        "cover.tilt": { supported_features: 128 },
        "media_player.speaker": { supported_features: 1 },
      },
    );
    const devices = roomDevices(home, bindings, "living", []);
    // Read from the registry, whatever their state…
    delete home.states["light.gone"];
    expect(devices.lights).toEqual(["light.gone"]);
    // …kept while Home Assistant has them.
    const present = presentDevices(home, devices);
    expect(present.lights).toEqual([]);
    expect(present.covers).toEqual(["cover.blind"]);
    expect(roomCommands(home, present).map((c) => c.key)).toEqual(["covers_open", "covers_close"]);
  });

  it("says when Home Assistant refused", async () => {
    const home = hass({ "light.a": "on" }, { "light.a": "living" });
    const [on] = roomCommands(
      home,
      presentDevices(home, roomDevices(home, bindings, "living", [])),
    );
    if (!on) throw new Error("no command");
    await expect(runCommand(home, on)).resolves.toBeUndefined();
    home.callService = vi.fn(() => Promise.reject(new Error("no")));
    await expect(runCommand(home, on)).rejects.toThrow("no");
  });

  it("keeps the well-formed actions, and keeps them when the area changes", () => {
    expect(roomActions(bindings, "living").map((a) => a.name)).toEqual(["Film"]);
    const moved = applyLink(bindings, { room: "living", area: "kitchen" });
    expect(moved.rooms.living).toEqual({
      area: "kitchen",
      actions: bindings.rooms.living?.actions,
    });
    // Without an area, its actions keep the room linked; without either, it is gone.
    const bare = applyLink(bindings, { room: "living", area: null });
    expect(bare.rooms.living?.actions).toHaveLength(1);
    expect(applyLink(bare, { room: "living", area: null, actions: [] }).rooms).toEqual({});
  });
});
