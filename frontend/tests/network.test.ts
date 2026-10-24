import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import type { BindingsJson } from "../src/live/bindings";
import { networkAvailable } from "../src/live/layers";
import {
  neighboursOf,
  placeDevices,
  secondsSince,
  snapshot,
  zhaDevice,
  zhaSource,
  type NetworkAnalysis,
  type NetworkDevice,
} from "../src/live/network";

/** Noon on a fictional day, in the browser's local time (as ZHA's `last_seen` is read). */
const NOW = new Date(2026, 0, 2, 12, 0, 0).getTime();

function hass(admin: boolean, components: string[], send = vi.fn(), post = vi.fn()): HomeAssistant {
  return {
    states: {},
    language: "en",
    user: { id: "user", name: "User", is_admin: admin },
    config: { components },
    connection: {
      sendMessagePromise: send,
      sendMessage: post,
    } as unknown as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

/** A device as ZHA's `zha/devices` gives it (fictional addresses). */
const ROUTER = {
  ieee: "00:12:4B:00:00:00:00:02",
  nwk: 4660,
  name: "Fictional plug",
  user_given_name: "Hall plug",
  device_type: "Router",
  lqi: 180,
  rssi: -60,
  last_seen: "2026-01-02T11:59:20",
  available: true,
  device_reg_id: "dev-plug",
  manufacturer: "Example",
  model: "Plug 1",
  entities: [{ entity_id: "switch.hall_plug", name: "Hall plug" }, { name: "no id" }],
  neighbors: [
    { ieee: "00:12:4b:00:00:00:00:01", lqi: "215", relationship: "Parent", nwk: "0x0000" },
    { ieee: "00:12:4b:00:00:00:00:03", lqi: "", relationship: "Sibling", nwk: "0x1235" },
    { ieee: "00:12:4b:00:00:00:00:04", lqi: "90", relationship: "Mystery", nwk: "0x1236" },
    { lqi: "100", relationship: "Child" },
  ],
};

function device(id: string, extra: Partial<NetworkDevice> = {}): NetworkDevice {
  return { id, name: id, role: "router", available: true, entities: [], neighbours: [], ...extra };
}

function bindings(elements: BindingsJson["elements"]): BindingsJson {
  return { version: 1, rooms: {}, elements };
}

describe("network map data (D-031)", () => {
  it("is offered to administrators with ZHA only", () => {
    expect(networkAvailable(hass(true, ["domotwin", "zha"]))).toBe(true);
    expect(networkAvailable(hass(false, ["domotwin", "zha"]))).toBe(false);
    expect(networkAvailable(hass(true, ["domotwin"]))).toBe(false);
    expect(networkAvailable(undefined)).toBe(false);
  });

  it("reads ZHA's last seen in Home Assistant's time zone", () => {
    // Noon UTC is 21:00 in Tokyo (no summer time) and 13:00 in Paris in January.
    const noon = Date.UTC(2026, 0, 2, 12, 0, 0);
    expect(secondsSince("2026-01-02T20:59:20", noon, "Asia/Tokyo")).toBe(40);
    expect(secondsSince("2026-01-02T12:59:20", noon, "Europe/Paris")).toBe(40);
    // In July, Paris is two hours ahead.
    const summer = Date.UTC(2026, 6, 2, 12, 0, 0);
    expect(secondsSince("2026-07-02T13:59:20", summer, "Europe/Paris")).toBe(40);
    // A zone the browser does not know: its own.
    const local = new Date(2026, 0, 2, 12, 0, 0).getTime();
    expect(secondsSince("2026-01-02T11:59:20", local, "Nowhere/Fictional")).toBe(40);
  });

  it("reads ZHA's last seen as local time without a zone", () => {
    expect(secondsSince("2026-01-02T11:59:20", NOW)).toBe(40);
    expect(secondsSince("2026-01-01T12:00:00", NOW)).toBe(86_400);
    // A clock a little ahead never gives a negative age.
    expect(secondsSince("2026-01-02T12:00:05", NOW)).toBe(0);
    for (const bad of ["", "  ", "yesterday", 12, null, undefined]) {
      expect(secondsSince(bad, NOW)).toBeUndefined();
    }
  });

  it("maps a ZHA device", () => {
    expect(zhaDevice(ROUTER, NOW)).toEqual({
      id: "00:12:4b:00:00:00:00:02",
      name: "Hall plug",
      role: "router",
      lqi: 180,
      rssi: -60,
      seen: 40,
      available: true,
      deviceId: "dev-plug",
      manufacturer: "Example",
      model: "Plug 1",
      entities: ["switch.hall_plug"],
      neighbours: [
        { id: "00:12:4b:00:00:00:00:01", lqi: 215, relation: "parent" },
        { id: "00:12:4b:00:00:00:00:03", relation: "sibling" },
        { id: "00:12:4b:00:00:00:00:04", lqi: 90, relation: "other" },
      ],
    });
  });

  it("keeps what it can of a sparse device, and skips one without an address", () => {
    expect(
      zhaDevice({ ieee: "00:12:4b:00:00:00:00:09", name: " Sensor ", available: false }, NOW),
    ).toEqual({
      id: "00:12:4b:00:00:00:00:09",
      name: "Sensor",
      role: "unknown",
      available: false,
      entities: [],
      neighbours: [],
    });
    expect(zhaDevice({ ieee: "00:12:4b:00:00:00:00:0a" }, NOW)?.name).toBe(
      "00:12:4b:00:00:00:00:0a",
    );
    for (const bad of [null, "device", 3, {}, { ieee: "" }, { ieee: 12 }]) {
      expect(zhaDevice(bad, NOW)).toBeUndefined();
    }
  });

  it("asks ZHA for its devices and for a rescan", async () => {
    const send = vi.fn((): Promise<unknown> => Promise.resolve([ROUTER, { nwk: 1 }, null]));
    const post = vi.fn();
    const source = zhaSource(hass(true, ["zha"], send, post), () => NOW);
    const devices = await source.devices();
    expect(devices.map((d) => d.id)).toEqual(["00:12:4b:00:00:00:00:02"]);
    expect(devices[0]?.seen).toBe(40);
    // The rescan never answers: it is sent without waiting for one.
    source.rescan();
    expect(post).toHaveBeenCalledWith({ type: "zha/topology/update" });
    expect(send).toHaveBeenCalledTimes(1);
    // An answer that is not a list gives no devices.
    send.mockImplementationOnce(() => Promise.resolve({ error: true }));
    expect(await source.devices()).toEqual([]);
  });

  it("places devices by their device first, then by their entities", () => {
    const devices = [
      device("a", { deviceId: "dev-a", entities: ["light.a"] }),
      device("b", { entities: ["sensor.none", "switch.b"] }),
      device("c", { deviceId: "dev-c" }),
      device("d", { entities: ["light.gone"] }),
      device("e"),
    ];
    const placed = placeDevices(
      devices,
      bindings({
        lamp: { entities: [{ entity_id: "light.a" }] },
        sideboard: { device: "dev-a", entities: [] },
        plug: { entities: [{ entity_id: "switch.b" }] },
        other_plug: { entities: [{ entity_id: "switch.b" }] },
        removed: { device: "dev-c", entities: [] },
        gone: { entities: [{ entity_id: "light.gone" }] },
      }),
      (element) => element !== "removed" && element !== "gone",
    );
    expect([...placed]).toEqual([
      ["a", "sideboard"],
      ["b", "plug"],
    ]);
  });

  it("hands the engine a snapshot of the devices", () => {
    const text = snapshot(
      [
        device("a", {
          role: "coordinator",
          lqi: 255,
          seen: 3,
          entities: ["light.a"],
          neighbours: [{ id: "b", lqi: 120, relation: "child" }],
        }),
        device("b", { role: "end", available: false }),
      ],
      new Map([["a", "sideboard"]]),
    );
    expect(JSON.parse(text)).toEqual({
      devices: [
        {
          id: "a",
          name: "a",
          role: "coordinator",
          lqi: 255,
          seen: 3,
          available: true,
          element: "sideboard",
          neighbours: [{ id: "b", lqi: 120, relation: "child" }],
        },
        { id: "b", name: "b", role: "end", available: false, neighbours: [] },
      ],
    });
  });

  it("lists a device's neighbours, best link first", () => {
    const analysis: NetworkAnalysis = {
      devices: [],
      links: [
        { a: "a", b: "b", lqi: 90, quality: "fair" },
        { a: "c", b: "a", lqi: null, quality: "unknown" },
        { a: "d", b: "a", lqi: 200, quality: "good" },
        { a: "b", b: "c", lqi: 40, quality: "weak" },
      ],
      coordinator: "a",
      health: { weakLinks: 1, stale: [], weakRooms: [] },
    };
    expect(neighboursOf(analysis, "a")).toEqual([
      { id: "d", lqi: 200, quality: "good" },
      { id: "b", lqi: 90, quality: "fair" },
      { id: "c", lqi: null, quality: "unknown" },
    ]);
    expect(neighboursOf(analysis, "z")).toEqual([]);
  });
});
