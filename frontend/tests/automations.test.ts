import { describe, expect, it, vi } from "vitest";

import { lift } from "../src/components/automation-wires";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import {
  actedOn,
  allAutomations,
  automationConfig,
  colorOf,
  lastRuns,
  placeEnds,
  ranSince,
  readAutomations,
  relatedAutomations,
  rolesOf,
  type AutomationEnd,
  type Placing,
} from "../src/live/automations";

function state(id: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: id, state: "on", attributes, last_changed: "", last_updated: "" };
}

/** A fictional home: a hall with a motion sensor and a lamp, a kitchen. */
function hass(send = vi.fn()): HomeAssistant {
  return {
    states: {
      "binary_sensor.hall_motion": state("binary_sensor.hall_motion", {
        friendly_name: "Hall motion",
      }),
      "light.hall": state("light.hall", { friendly_name: "Hall lamp" }),
      "light.kitchen": state("light.kitchen"),
      "automation.b": state("automation.b", { last_triggered: "2026-01-02T08:00:00+00:00" }),
      "automation.a": state("automation.a", { last_triggered: "2026-01-02T07:00:00+00:00" }),
    },
    entities: {
      "binary_sensor.hall_motion": {
        entity_id: "binary_sensor.hall_motion",
        area_id: "hall",
        device_id: null,
      },
      "light.hall": { entity_id: "light.hall", labels: ["evening"] },
      "light.kitchen": {
        entity_id: "light.kitchen",
        device_id: "dev-kitchen",
        labels: ["evening"],
      },
    },
    devices: {
      "dev-kitchen": { id: "dev-kitchen", area_id: "kitchen", name: "Kitchen bulb" },
      "dev-remote": {
        id: "dev-remote",
        area_id: "hall",
        name: "Remote",
        name_by_user: "Hall remote",
      },
    },
    areas: {
      hall: { area_id: "hall", name: "Hall" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
      garden: { area_id: "garden", name: "Garden" },
    },
    floors: { ground: { floor_id: "ground", name: "Ground floor" } },
    language: "en",
    connection: { sendMessagePromise: send } as unknown as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

const placing: Placing = {
  bindings: {
    version: 1,
    rooms: { "room-hall": { area: "hall" } },
    elements: {
      "lamp-hall": { entities: [{ entity_id: "light.hall" }] },
      "lamp-kitchen": { entities: [{ entity_id: "light.kitchen" }] },
      gone: { entities: [{ entity_id: "light.gone" }] },
    },
  },
  rooms: [
    { id: "room-hall", name: "Hall" },
    { id: "room-kitchen", name: "Kitchen" },
  ],
  known: (id) => id !== "gone",
  label: (end) => (end.dynamic !== undefined ? "Decided when it runs" : (end.place ?? "")),
};

describe("automation wires (D-032)", () => {
  it("finds the automations related to a piece", async () => {
    const send = vi.fn((message: { item_type: string; item_id: string }) =>
      message.item_id === "light.hall"
        ? Promise.resolve({ automation: ["automation.b", "automation.gone"], script: ["x"] })
        : message.item_type === "area"
          ? Promise.resolve({ automation: ["automation.a", "automation.b"] })
          : Promise.reject(new Error("not found")),
    );
    const found = await relatedAutomations(hass(send), [
      { type: "entity", id: "light.hall" },
      { type: "device", id: "dev-x" },
      { type: "area", id: "hall" },
    ]);
    // Each once, sorted; one Home Assistant does not have left out.
    expect(found).toEqual(["automation.a", "automation.b"]);
    expect(send).toHaveBeenCalledWith({
      type: "search/related",
      item_type: "device",
      item_id: "dev-x",
    });
  });

  it("reads a configuration, or nothing when it is kept from the user", async () => {
    const send = vi.fn((message: { entity_id: string }) =>
      message.entity_id === "automation.a"
        ? Promise.resolve({ config: { alias: "A" } })
        : Promise.reject(Object.assign(new Error("Unauthorized"), { code: "unauthorized" })),
    );
    const home = hass(send);
    expect(await automationConfig(home, "automation.a")).toEqual({ alias: "A" });
    expect(await automationConfig(home, "automation.b")).toBeUndefined();
    expect(allAutomations(home)).toEqual(["automation.a", "automation.b"]);
  });

  it("loads the reader only once a configuration comes, and says when it cannot", async () => {
    // Kept from the user (not an administrator): nothing to read, nothing loaded.
    const kept = vi.fn(() => Promise.reject(new Error("Unauthorized")));
    expect(await readAutomations(hass(kept), ["automation.a", "automation.b"])).toEqual(new Map());
    // A configuration comes, but the analysis module cannot be loaded (none is built here).
    const given = vi.fn(() => Promise.resolve({ config: { alias: "A" } }));
    expect(await readAutomations(hass(given), ["automation.a"])).toBeUndefined();
  });

  it("places each end at a piece, in a room or above one", () => {
    const ends: AutomationEnd[] = [
      { role: "trigger", entity: "binary_sensor.hall_motion" },
      { role: "trigger", device: "dev-remote" },
      { role: "trigger", place: "sun" },
      { role: "condition", area: "garden" },
      { role: "action", entity: "light.hall" },
      { role: "action", device: "dev-kitchen" },
      { role: "action", area: "hall" },
      { role: "action", entity: "light.gone" },
      { role: "action", dynamic: "action" },
      // Twice: once.
      { role: "action", entity: "light.hall" },
    ];
    expect(placeEnds(hass(), placing, ends)).toEqual([
      // A sensor linked to no piece: a label above its area's room.
      { role: "trigger", above: "Hall motion", room: "room-hall" },
      { role: "trigger", above: "Hall remote", room: "room-hall" },
      { role: "trigger", above: "sun" },
      // An area with no room of the plan: above the home.
      { role: "condition", above: "Garden" },
      { role: "action", piece: "lamp-hall" },
      // A device placed by one of its entities' piece.
      { role: "action", piece: "lamp-kitchen" },
      { role: "action", room: "room-hall" },
      // On a piece the plan shown does not have: by its name, above the home.
      { role: "action", above: "light.gone" },
      { role: "action", above: "Decided when it runs", dynamic: true },
    ]);
  });

  it("places a label at its entities' pieces, a floor above the home", () => {
    const ends: AutomationEnd[] = [
      { role: "action", label: "evening" },
      { role: "action", label: "unused" },
      { role: "action", floor: "ground" },
      { role: "action", floor: "attic" },
    ];
    expect(placeEnds(hass(), placing, ends)).toEqual([
      { role: "action", piece: "lamp-hall" },
      { role: "action", piece: "lamp-kitchen" },
      // A label no piece carries, a floor Home Assistant does not name: as they are written.
      { role: "action", above: "unused" },
      { role: "action", above: "Ground floor" },
      { role: "action", above: "attic" },
    ]);
  });

  it("tells how a piece takes part", () => {
    const ends: AutomationEnd[] = [
      { role: "action", entity: "light.hall" },
      { role: "trigger", device: "dev-remote" },
      { role: "condition", area: "hall" },
      { role: "action", entity: "light.kitchen" },
    ];
    expect(rolesOf(ends, { entities: ["light.hall"], device: "dev-remote", area: "hall" })).toEqual(
      ["trigger", "condition", "action"],
    );
    expect(rolesOf(ends, { entities: [] })).toEqual([]);
    expect(actedOn(ends)).toEqual(["light.hall", "light.kitchen"]);
  });

  it("keeps an automation's colour, and sees when one ran", () => {
    expect(colorOf("automation.a")).toEqual(colorOf("automation.a"));
    expect(colorOf("automation.a")).not.toEqual(colorOf("automation.b"));
    const home = hass();
    const runs = lastRuns(home, ["automation.a", "automation.b"]);
    expect(ranSince(runs, home)).toEqual([]);
    const later = {
      ...home,
      states: {
        ...home.states,
        "automation.a": state("automation.a", { last_triggered: "2026-01-02T09:00:00+00:00" }),
      },
    };
    expect(ranSince(runs, later)).toEqual(["automation.a"]);
  });

  it("lifts labels that would cover one another or an end's marker", () => {
    const texts = ["Sun", "Time", undefined, "Far away", "On a marker"];
    const lifted = lift(
      [
        [100, 100],
        [105, 104],
        [300, 300],
        [400, 400],
        [300, 305],
      ],
      texts,
    );
    // The lower one stays; the one it covers goes above it; others are left.
    expect(lifted[1]).toEqual([105, 104]);
    expect(lifted[0]?.[1]).toBeLessThanOrEqual(104 - 22 - 2);
    expect(lifted[3]).toEqual([400, 400]);
    // A marker stays; a label on it goes above it.
    expect(lifted[2]).toEqual([300, 300]);
    expect(lifted[4]?.[1]).toBeLessThanOrEqual(300 - 12 - 2);
  });
});
