import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import type { BindingsJson } from "../src/live/bindings";
import { deviceBadges, elementNames, pieceKinds, MAX_BADGES } from "../src/live/devices";

function hass(states: [string, string, Record<string, unknown>?][]): HomeAssistant {
  const all: Record<string, HassEntity> = {};
  for (const [id, state, attributes] of states) {
    all[id] = {
      entity_id: id,
      state,
      attributes: attributes ?? {},
      last_changed: "",
      last_updated: "",
    };
  }
  return {
    states: all,
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

function bindings(elements: Record<string, string[]>): BindingsJson {
  return {
    version: 1,
    rooms: {},
    elements: Object.fromEntries(
      Object.entries(elements).map(([id, entities]) => [
        id,
        { entities: entities.map((entity_id) => ({ entity_id })) },
      ]),
    ),
  };
}

const BATTERY = { device_class: "battery", unit_of_measurement: "%" };
const POWER = { device_class: "power", unit_of_measurement: "W" };

describe("deviceBadges", () => {
  it("shows a lock's state, the most urgent first", () => {
    const home = hass([
      ["lock.front", "jammed"],
      ["sensor.front_battery", "9", BATTERY],
      ["lock.back", "locked"],
      ["lock.side", "unknown"],
    ]);
    const badges = deviceBadges(
      home,
      bindings({
        front: ["sensor.front_battery", "lock.front"],
        back: ["lock.back"],
        side: ["lock.side"],
      }),
      {},
    );
    expect(badges.get("front")?.map((b) => [b.kind, b.tone, b.text])).toEqual([
      ["jammed", "danger", undefined],
      ["battery_low", "warning", "9 %"],
    ]);
    expect(badges.get("back")?.map((b) => b.kind)).toEqual(["locked"]);
    expect(badges.has("side")).toBe(false);
  });

  it("shows cameras, what plays and low batteries", () => {
    const home = hass([
      ["camera.hall", "recording"],
      ["camera.yard", "unavailable"],
      ["media_player.tv", "playing", { media_title: "A film" }],
      ["media_player.radio", "paused"],
      ["binary_sensor.remote_battery", "on", { device_class: "battery" }],
      ["sensor.ok_battery", "80", BATTERY],
    ]);
    const badges = deviceBadges(
      home,
      bindings({
        hall: ["camera.hall"],
        yard: ["camera.yard"],
        tv: ["media_player.tv", "binary_sensor.remote_battery"],
        radio: ["media_player.radio", "sensor.ok_battery"],
      }),
      {},
    );
    expect(badges.get("hall")?.[0]).toMatchObject({ kind: "recording", tone: "danger" });
    expect(badges.get("yard")?.[0]).toMatchObject({ kind: "camera_off" });
    expect(badges.get("tv")?.map((b) => b.kind)).toEqual(["battery_low", "playing"]);
    expect(badges.get("tv")?.[1]?.text).toBe("A film");
    expect(badges.has("radio")).toBe(false);
  });

  it("shows appliances running, not on standby, and not other pieces", () => {
    const home = hass([
      ["sensor.washer_power", "0.45", { ...POWER, unit_of_measurement: "kW" }],
      ["sensor.dryer_power", "3", POWER],
      ["binary_sensor.dryer_running", "on", { device_class: "running" }],
      ["sensor.fridge_power", "120", POWER],
      ["sensor.oven_power", "2", POWER],
    ]);
    const badges = deviceBadges(
      home,
      bindings({
        washer: ["sensor.washer_power"],
        dryer: ["sensor.dryer_power", "binary_sensor.dryer_running"],
        fridge: ["sensor.fridge_power"],
        oven: ["sensor.oven_power"],
      }),
      { washer: "washer", dryer: "dryer", fridge: "fridge", oven: "stove" },
    );
    expect(badges.get("washer")?.[0]).toMatchObject({ kind: "running", appliance: "washer" });
    expect(badges.get("dryer")?.[0]).toMatchObject({ kind: "running", appliance: "dryer" });
    expect(badges.has("fridge")).toBe(false);
    expect(badges.has("oven")).toBe(false);
  });

  it("keeps at most two badges per element", () => {
    const home = hass([
      ["lock.a", "open"],
      ["camera.a", "idle"],
      ["media_player.a", "playing"],
    ]);
    const badges = deviceBadges(
      home,
      bindings({ a: ["lock.a", "camera.a", "media_player.a"] }),
      {},
    );
    expect(badges.get("a")).toHaveLength(MAX_BADGES);
    expect(badges.get("a")?.[0]?.kind).toBe("lock_open");
  });
});

describe("plan helpers", () => {
  it("reads the pieces' kinds, overlay pieces included, and the elements' names", () => {
    const plan = {
      elements: [
        { id: "w", type: "furniture", kind: "washer", name: "Washer" },
        { id: "r", type: "room", name: "" },
      ],
    };
    expect(pieceKinds(plan, { added: { kind: "dryer" }, w: { x: 3 } })).toEqual({
      w: "washer",
      added: "dryer",
    });
    expect(elementNames(plan)).toEqual({
      w: { name: "Washer", type: "furniture" },
      r: { name: "r", type: "room" },
    });
    expect(pieceKinds(null, null)).toEqual({});
  });
});
