import { describe, expect, it } from "vitest";

import type { HomeStorey } from "../src/engine/engine";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { en, fr } from "../src/i18n";
import { placementEn, placementFr } from "../src/i18n/placement";
import type { BindingsJson } from "../src/live/bindings";
import { coverageAvailable, roomLayers } from "../src/live/layers";
import type { LocatingSettings } from "../src/live/locating";
import type { NetworkAnalysis, NetworkDevice } from "../src/live/network";
import { homeStoreys } from "../src/live/storeys";
import {
  bluetoothReadings,
  coverageValues,
  homeNames,
  pieceIds,
  placementInput,
  wifiReadings,
  wifiSignal,
  worstFirst,
  zigbeeReadings,
  type PlacementAdvice,
} from "../src/live/placement";

/** A fictional home of two storeys: a hall and a kitchen below, an office above. */
const STOREYS: HomeStorey[] = [
  {
    id: "ground",
    name: "",
    elevation: 0,
    plan: {
      rooms: [
        { id: "hall", name: "Hall", outline: [] },
        { id: "kitchen", name: "Kitchen", outline: [] },
      ],
      items: [
        { id: "shelf", name: "Shelf", kind: "shelf" },
        { id: "fridge", kind: "fridge" },
      ],
    },
    layout: { "lamp-added-1": { add: { name: "Reading lamp", kind: "floor-lamp" } } },
  },
  {
    id: "upper",
    name: "First floor",
    elevation: 280,
    plan: { rooms: [{ id: "office", name: "Office", outline: [] }], items: [] },
  },
];

function state(id: string, value: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: id,
    state: value,
    attributes,
    last_changed: "2026-01-02T08:00:00Z",
    last_updated: "2026-01-02T08:00:00Z",
  };
}

const WIFI = { device_class: "signal_strength", unit_of_measurement: "dBm" };

function home(): HomeAssistant {
  return {
    states: {
      "sensor.plug_wifi_signal": state("sensor.plug_wifi_signal", "-71", {
        ...WIFI,
        friendly_name: "Plug WiFi signal",
      }),
      "sensor.plug_power": state("sensor.plug_power", "12", { device_class: "power" }),
      "sensor.display_rssi": state("sensor.display_rssi", "-58", {
        ...WIFI,
        friendly_name: "Display signal",
      }),
      "sensor.lamp_wifi": state("sensor.lamp_wifi", "-63.4", { ...WIFI, friendly_name: "Lamp" }),
      "sensor.desk_wifi_signal": state("sensor.desk_wifi_signal", "-80", WIFI),
      "sensor.nowhere_wifi_signal": state("sensor.nowhere_wifi_signal", "-60", WIFI),
      "sensor.broken_wifi_signal": state("sensor.broken_wifi_signal", "unavailable", WIFI),
      "sensor.zigbee_rssi_wifi": state("sensor.zigbee_rssi_wifi", "-70", WIFI),
      "sensor.phone_wifi_signal_strength": state("sensor.phone_wifi_signal_strength", "-50", WIFI),
      "sensor.tag_rssi": state("sensor.tag_rssi", "-70", WIFI),
      "sensor.plug_wifi_percent": state("sensor.plug_wifi_percent", "70", {
        device_class: "signal_strength",
        unit_of_measurement: "%",
      }),
    },
    entities: {
      // At the shelf through another of its device's entities.
      "sensor.plug_wifi_signal": {
        entity_id: "sensor.plug_wifi_signal",
        device_id: "plug",
        platform: "esphome",
      },
      "sensor.plug_power": { entity_id: "sensor.plug_power", device_id: "plug" },
      // In the kitchen's area, named after nothing but a Wi-Fi integration's.
      "sensor.display_rssi": {
        entity_id: "sensor.display_rssi",
        area_id: "kitchen",
        platform: "shelly",
      },
      // At the lamp the overlay added, linked to it.
      "sensor.lamp_wifi": { entity_id: "sensor.lamp_wifi", platform: "wled" },
      // The office's device's area, upstairs.
      "sensor.desk_wifi_signal": { entity_id: "sensor.desk_wifi_signal", device_id: "desk" },
      "sensor.nowhere_wifi_signal": { entity_id: "sensor.nowhere_wifi_signal" },
      "sensor.zigbee_rssi_wifi": { entity_id: "sensor.zigbee_rssi_wifi", platform: "zha" },
      "sensor.phone_wifi_signal_strength": {
        entity_id: "sensor.phone_wifi_signal_strength",
        platform: "mobile_app",
        area_id: "hall",
      },
      "sensor.tag_rssi": { entity_id: "sensor.tag_rssi", platform: "esphome", area_id: "hall" },
    },
    devices: { plug: { id: "plug" }, desk: { id: "desk", area_id: "office" } },
    areas: {
      hall: { area_id: "hall", name: "Hall" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
      office: { area_id: "office", name: "Office" },
    },
    language: "en",
    user: { id: "u", name: "Admin", is_admin: true },
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
  };
}

const BINDINGS: BindingsJson = {
  version: 1,
  rooms: {},
  elements: {
    shelf: { entities: [{ entity_id: "sensor.plug_power" }] },
    "lamp-added-1": { entities: [{ entity_id: "sensor.lamp_wifi" }] },
    // A piece no storey has: it places nothing.
    gone: { entities: [{ entity_id: "sensor.nowhere_wifi_signal" }] },
  },
};

describe("the Bluetooth receivers (D-035)", () => {
  it("are placed where the locating places them, with what each learned", () => {
    const locating = {
      revision: 1,
      status: "ready",
      learn: true,
      receivers: [
        {
          source: "AA",
          name: "Living proxy",
          idle: 1,
          placed_by: "device_area",
          place: { storey: "ground", at: [100, 200], z: 120 },
        },
        { source: "BB", name: "Hall proxy", idle: 2, placed_by: null, place: null },
        // Known to the settings, not to Home Assistant now.
        { source: "CC", name: null, idle: null, placed_by: null },
      ],
      devices: {},
      learned: { hall: 30 },
      heard: { hall: { AA: { signal: -84.5, readings: 30 }, ZZ: { signal: -90, readings: 2 } } },
      rooms: [],
    } satisfies LocatingSettings;
    expect(bluetoothReadings(locating)).toEqual({
      radios: [{ id: "AA", name: "Living proxy", storey: "ground", at: [100, 200], z: 120 }],
      measured: [
        { room: "hall", radio: "AA", signal: -84.5, readings: 30, name: "Living proxy" },
        { room: "hall", radio: "ZZ", signal: -90, readings: 2, name: "ZZ" },
      ],
      unplaced: ["Hall proxy"],
    });
    // An integration before D-061: nothing placed, nothing learned.
    const older: LocatingSettings = { ...locating, receivers: [] };
    delete older.heard;
    expect(bluetoothReadings(older)).toEqual({
      radios: [],
      measured: [],
      unplaced: [],
    });
  });
});

describe("the Zigbee mesh (D-031)", () => {
  const device = (id: string, role: NetworkDevice["role"]): NetworkDevice => ({
    id,
    name: `Device ${id}`,
    role,
    available: true,
    entities: [],
    neighbours: [],
  });
  const devices = [
    device("c", "coordinator"),
    device("r", "router"),
    device("far", "router"),
    device("s", "end"),
    device("old", "router"),
    device("lost", "end"),
  ];
  const analysis: NetworkAnalysis = {
    devices: [
      { id: "c", role: "coordinator", quality: "unknown", stale: false },
      { id: "r", role: "router", quality: "good", stale: false },
      { id: "far", role: "router", quality: "fair", stale: false },
      { id: "s", role: "end", quality: "weak", stale: false },
      { id: "old", role: "router", quality: "good", stale: true },
      { id: "lost", role: "end", quality: "unknown", stale: false },
    ],
    links: [
      { a: "c", b: "r", lqi: 200, quality: "good" },
      { a: "r", b: "s", lqi: 60, quality: "weak" },
      { a: "s", b: "far", lqi: 100, quality: "fair" },
      // To a router not heard from for a day: it relays for no one.
      { a: "s", b: "old", lqi: 220, quality: "good" },
      { a: "lost", b: "c", lqi: null, quality: "unknown" },
    ],
    coordinator: "c",
    health: { weakLinks: 1, stale: ["old"], weakRooms: [] },
  };
  const placed = new Map([
    ["c", "sideboard"],
    ["r", "lamp"],
    ["s", "washer"],
    ["old", "bedside"],
    ["lost", "shelf"],
  ]);

  it("relays through the coordinator and the routers heard from, at their pieces", () => {
    const readings = zigbeeReadings(devices, placed, analysis);
    expect(readings.radios).toEqual([
      { id: "c", name: "Device c", piece: "sideboard" },
      { id: "r", name: "Device r", piece: "lamp" },
    ]);
    expect(readings.unplaced).toEqual(["Device far"]);
  });

  it("measures each end device placed by its best link of known quality to a relay", () => {
    // A relay covers its own room: its links to the others are the network map's. The plug's
    // link to the router not heard from for a day does not count; the shelf's has no quality.
    expect(zigbeeReadings(devices, placed, analysis).measured).toEqual([
      { piece: "washer", level: "fair", name: "Device s" },
    ]);
  });
});

describe("Wi-Fi", () => {
  it("knows a Wi-Fi signal from another radio's", () => {
    const hass = home();
    expect(wifiSignal(hass, "sensor.plug_wifi_signal")).toBe(true);
    expect(wifiSignal(hass, "sensor.display_rssi")).toBe(true);
    expect(wifiSignal(hass, "sensor.lamp_wifi")).toBe(true);
    expect(wifiSignal(hass, "sensor.zigbee_rssi_wifi")).toBe(false);
    expect(wifiSignal(hass, "sensor.phone_wifi_signal_strength")).toBe(false);
    // ESPHome hears Bluetooth tags too: named after nothing Wi-Fi, it is not.
    expect(wifiSignal(hass, "sensor.tag_rssi")).toBe(false);
    expect(wifiSignal(hass, "sensor.plug_wifi_percent")).toBe(false);
    expect(wifiSignal(hass, "sensor.plug_power")).toBe(false);
    expect(wifiSignal(hass, "light.nothing")).toBe(false);
  });

  it("places the devices' signals, to a decibel, at their pieces, else in their area's room", () => {
    const readings = wifiReadings(home(), BINDINGS, STOREYS, [
      { storey: "ground", at: [10, 20], name: "Hall access point" },
      { storey: "upper", at: [30, 40] },
    ]);
    expect(readings.radios).toEqual([
      { id: "ap-1", name: "Hall access point", storey: "ground", at: [10, 20] },
      { id: "ap-2", storey: "upper", at: [30, 40] },
    ]);
    expect(readings.measured).toEqual([
      { room: "office", signal: -80, name: "sensor.desk_wifi_signal" },
      { room: "kitchen", signal: -58, name: "Display signal" },
      { piece: "lamp-added-1", signal: -63, name: "Lamp" },
      { piece: "shelf", signal: -71, name: "Plug WiFi signal" },
    ]);
  });
});

describe("the home's storeys", () => {
  it("are all there, lowest first, one without a plan too: it is a floor", () => {
    const storeys = homeStoreys(
      [
        { id: "upper", name: "First floor", elevation: 280 },
        { id: "attic", name: "", elevation: 560 },
        { id: "ground", name: "", elevation: 0 },
      ],
      (id) => STOREYS.find((storey) => storey.id === id),
    );
    expect(storeys.map((s) => [s.id, s.elevation, s.plan === null])).toEqual([
      ["ground", 0, false],
      ["upper", 280, false],
      ["attic", 560, true],
    ]);
    expect(storeys[0]?.layout).toEqual(STOREYS[0]?.layout);
    expect("layout" in (storeys[2] ?? {})).toBe(false);
  });
});

describe("the home's pieces and names", () => {
  it("are every storey's, those an overlay adds too", () => {
    expect([...pieceIds(STOREYS)].sort()).toEqual(["fridge", "lamp-added-1", "shelf"]);
    const names = homeNames(STOREYS);
    expect(names.get("office")).toBe("Office");
    expect(names.get("shelf")).toBe("Shelf");
    expect(names.get("fridge")).toBe("fridge");
    expect(names.get("lamp-added-1")).toBe("Reading lamp");
  });
});

describe("the advice", () => {
  const advice: PlacementAdvice = {
    rooms: [
      { id: "hall", storey: "ground", level: "fair", predicted: -86 },
      { id: "kitchen", storey: "ground", level: "good", predicted: -60 },
      { id: "office", storey: "upper", level: "out" },
      { id: "bath", storey: "ground", level: "weak", measured: { level: "weak", signal: -95 } },
    ],
    radios: [],
    spots: [],
  };

  it("lists the rooms worst covered first", () => {
    expect(worstFirst(advice.rooms).map((room) => room.id)).toEqual([
      "office",
      "bath",
      "hall",
      "kitchen",
    ]);
  });

  it("colours the rooms by their level's rank, private rooms left out", () => {
    const values = coverageValues(advice);
    expect(values).toEqual({ hall: 2, kitchen: 3, office: 0, bath: 1 });
    const hass = home();
    const layers = roomLayers(hass, BINDINGS, [], {
      layer: "coverage",
      alerts: false,
      presence: false,
      coverage: values,
      closed: new Set(["bath"]),
    });
    expect(JSON.parse(layers.json)).toEqual({
      heat: "coverage",
      values: { hall: 2, kitchen: 3, office: 0 },
    });
    // Another layer: the coverage is not drawn.
    const other = roomLayers(hass, BINDINGS, [], {
      layer: "off",
      alerts: false,
      presence: false,
      coverage: values,
    });
    expect(JSON.parse(other.json)).toEqual({});
  });

  it("is asked for with the storeys, the radios and what was measured", () => {
    const input = JSON.parse(
      placementInput("wifi", STOREYS, {
        radios: [{ id: "ap-1", storey: "ground", at: [1, 2] }],
        measured: [{ room: "hall", signal: -70 }],
        unplaced: [],
      }),
    ) as Record<string, unknown>;
    expect(input.radio).toBe("wifi");
    expect(input.spots).toBe(3);
    expect((input.storeys as { id: string; name?: string }[]).map((s) => s.id)).toEqual([
      "ground",
      "upper",
    ]);
    expect((input.storeys as { name?: string }[])[1]?.name).toBeUndefined();
    expect(input.radios).toEqual([{ id: "ap-1", storey: "ground", at: [1, 2] }]);
    expect(input.measured).toEqual([{ room: "hall", signal: -70 }]);
  });

  it("is offered to administrators only", () => {
    expect(coverageAvailable(home())).toBe(true);
    expect(coverageAvailable({ ...home(), user: { id: "u", name: "U", is_admin: false } })).toBe(
      false,
    );
    expect(coverageAvailable(undefined)).toBe(false);
  });
});

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("the coverage's messages", () => {
  it("have the same keys and placeholders in both languages, none of the dictionaries'", () => {
    expect(keys(placementFr).sort()).toEqual(keys(placementEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(placementEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(placementEn)) {
      expect(placeholders(lookup(placementFr, key)), key).toEqual(
        placeholders(lookup(placementEn, key)),
      );
    }
  });
});
