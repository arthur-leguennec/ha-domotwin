import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { NO_BINDINGS, type BindingsJson } from "../src/live/bindings";
import {
  SHAPES,
  STOREY_HEIGHT,
  areaKind,
  buildHome,
  devicePieces,
  homeStoreys,
  placeDevices,
  type BuiltStorey,
} from "../src/live/first-launch";

type P = [number, number];

interface Device {
  id: string;
  area: string;
  name: string;
  entities: [string, Record<string, unknown>?, Record<string, unknown>?][];
}

/** A fictional home: two floors, a garden, a garage on no floor, and their devices. */
function home(): HomeAssistant {
  const devices: Device[] = [
    {
      id: "d-kitchen-light",
      area: "kitchen",
      name: "Kitchen light",
      entities: [["light.kitchen"]],
    },
    {
      id: "d-tv",
      area: "living",
      name: "Living room TV",
      entities: [["media_player.tv", { device_class: "tv" }], ["switch.tv_power"]],
    },
    {
      id: "d-vacuum",
      area: "hall",
      name: "Robot",
      entities: [["vacuum.robot"], ["sensor.robot_battery", { device_class: "battery" }]],
    },
    {
      id: "d-motion",
      area: "hall",
      name: "Hall motion",
      entities: [["binary_sensor.hall_motion", { device_class: "motion" }]],
    },
    {
      id: "d-door",
      area: "hall",
      name: "Front door contact",
      entities: [["binary_sensor.front_door", { device_class: "door" }]],
    },
    {
      id: "d-thermostat",
      area: "bedroom",
      name: "Bedroom radiator",
      entities: [["climate.bedroom", { hvac_modes: ["off", "heat"] }]],
    },
    {
      id: "d-fan",
      area: "bedroom",
      name: "Bedroom fan",
      entities: [["fan.bedroom"], ["light.bedroom_fan"]],
    },
    {
      id: "d-office-climate",
      area: "office",
      name: "Office sensor",
      entities: [
        ["sensor.office_temperature", { device_class: "temperature" }],
        ["sensor.office_humidity", { device_class: "humidity" }],
        ["sensor.office_battery", { device_class: "battery" }, { entity_category: "diagnostic" }],
      ],
    },
    { id: "d-plug", area: "office", name: "Desk plug", entities: [["switch.desk"]] },
    {
      id: "d-kids",
      area: "kids",
      name: "Night light",
      entities: [["light.kids"], ["light.kids_hidden", {}, { hidden: true }]],
    },
  ];
  const states: Record<string, HassEntity> = {};
  const entities: NonNullable<HomeAssistant["entities"]> = {};
  for (const device of devices) {
    for (const [id, attributes = {}, entry = {}] of device.entities) {
      states[id] = { entity_id: id, state: "on", attributes } as HassEntity;
      entities[id] = { entity_id: id, device_id: device.id, ...entry };
    }
  }
  // A group of the living room's lights, in the area itself: not a lamp of its own.
  states["light.living_all"] = {
    entity_id: "light.living_all",
    state: "on",
    attributes: { entity_id: ["light.kitchen"], friendly_name: "All the lights" },
  } as unknown as HassEntity;
  entities["light.living_all"] = { entity_id: "light.living_all", area_id: "living" };
  return {
    states,
    entities,
    devices: Object.fromEntries(
      devices.map((d) => [d.id, { id: d.id, area_id: d.area, name: d.name }]),
    ),
    floors: {
      up: { floor_id: "up", name: "Upstairs", level: 1 },
      ground: { floor_id: "ground", name: "Ground floor", level: 0 },
    },
    areas: {
      kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      living: { area_id: "living", name: "Living room", floor_id: "ground" },
      hall: { area_id: "hall", name: "Hall", floor_id: "ground" },
      garden: { area_id: "garden", name: "Garden", floor_id: "ground", icon: "mdi:flower" },
      bedroom: { area_id: "bedroom", name: "Bedroom", floor_id: "up" },
      bathroom: { area_id: "bathroom", name: "Bathroom", floor_id: "up" },
      office: { area_id: "office", name: "Office", floor_id: "up" },
      kids: { area_id: "kids", name: "Léa", floor_id: "up", icon: "mdi:bed-empty" },
      garage: { area_id: "garage", name: "Garage" },
    },
    language: "en",
  } as unknown as HomeAssistant;
}

function devicesOf(hass: HomeAssistant): Map<string, ReturnType<typeof devicePieces>> {
  return new Map(Object.keys(hass.areas ?? {}).map((area) => [area, devicePieces(hass, area)]));
}

interface Rect {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  outside: boolean;
}

function rectsOf(storey: BuiltStorey): Rect[] {
  const rooms = storey.plan.rooms as { id: string; outline: P[]; outside?: boolean }[];
  return rooms.map((room) => {
    const xs = room.outline.map((p) => p[0]);
    const ys = room.outline.map((p) => p[1]);
    return {
      id: room.id,
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      outside: room.outside === true,
    };
  });
}

/** The rooms whose side a segment lies on. */
function roomsBy(rects: Rect[], a: P, b: P): string[] {
  const on = (r: Rect, p: P): boolean =>
    ((p[0] === r.x0 || p[0] === r.x1) && p[1] >= r.y0 && p[1] <= r.y1) ||
    ((p[1] === r.y0 || p[1] === r.y1) && p[0] >= r.x0 && p[0] <= r.x1);
  return rects.filter((r) => on(r, a) && on(r, b)).map((r) => r.id);
}

function corners(at: P, size: number[], rotation: number): P[] {
  const r = (rotation * Math.PI) / 180;
  const [u, v]: [P, P] = [
    [Math.cos(r), Math.sin(r)],
    [-Math.sin(r), Math.cos(r)],
  ];
  const [hw, hd] = [(size[0] ?? 0) / 2, (size[1] ?? 0) / 2];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a = 0, b = 0]) => [
    at[0] + u[0] * a * hw + v[0] * b * hd,
    at[1] + u[1] * a * hw + v[1] * b * hd,
  ]);
}

describe("a first launch in five minutes (D-083)", () => {
  it("tells what an area is from its name, else its icon", () => {
    expect(areaKind({ id: "a", name: "Cuisine" })).toBe("kitchen");
    expect(areaKind({ id: "a", name: "Léa", icon: "mdi:bed-empty" })).toBe("bedroom");
    expect(areaKind({ id: "a", name: "Wohnzimmer", icon: "mdi:sofa-outline" })).toBe("living");
    expect(areaKind({ id: "a", name: "Somewhere" })).toBe("room");
  });

  it("takes Home Assistant's floors as storeys, by level; an area on no floor on the ground floor", () => {
    const storeys = homeStoreys(home(), "Home");
    expect(storeys.map((s) => [s.name, s.level])).toEqual([
      ["Ground floor", 0],
      ["Upstairs", 1],
    ]);
    expect(storeys[0]?.areas.map((a) => a.id)).toEqual([
      "garage",
      "garden",
      "hall",
      "kitchen",
      "living",
    ]);
    const flat = { ...home(), floors: {} } as HomeAssistant;
    const one = homeStoreys(flat, "Home");
    expect(one).toHaveLength(1);
    expect(one[0]?.name).toBe("Home");
    expect(one[0]?.areas).toHaveLength(9);
  });

  it("draws each device as what its entities say, linked to those that fit it", () => {
    const hass = home();
    expect(devicePieces(hass, "living")).toEqual([
      { kind: "tv", name: "Living room TV", entities: ["media_player.tv", "switch.tv_power"] },
    ]);
    const hall = devicePieces(hass, "hall");
    expect(hall.map((p) => [p.kind, p.style])).toEqual([
      ["robot-vacuum", undefined],
      ["sensor", "motion"],
    ]);
    expect(hall[0]?.entities[0]).toBe("vacuum.robot");
    const bedroom = devicePieces(hass, "bedroom");
    expect(bedroom.map((p) => p.kind).sort()).toEqual(["ceiling-fan", "radiator"]);
    expect(bedroom.find((p) => p.kind === "ceiling-fan")?.entities).toEqual([
      "fan.bedroom",
      "light.bedroom_fan",
    ]);
    // A climate sensor; its battery is a diagnostic entity, left out; the plug says nothing.
    const office = devicePieces(hass, "office");
    expect(office).toHaveLength(1);
    expect(office[0]?.kind).toBe("sensor");
    expect(office[0]?.entities.sort()).toEqual([
      "sensor.office_humidity",
      "sensor.office_temperature",
    ]);
    // Hidden entities and those linked already are left out.
    expect(devicePieces(hass, "kids")[0]?.entities).toEqual(["light.kids"]);
    expect(devicePieces(hass, "kids", new Set(["light.kids"]))).toEqual([]);
  });

  it("draws a storey per floor, a room per area linked to it, side by side without overlapping", () => {
    const hass = home();
    const built = buildHome({
      storeys: homeStoreys(hass, "Home"),
      devices: devicesOf(hass),
      furnish: true,
    });
    expect(built.storeys.map((s) => [s.name, s.elevation])).toEqual([
      ["Ground floor", 0],
      ["Upstairs", STOREY_HEIGHT],
    ]);
    expect(built.rooms).toBe(9);
    expect(built.bindings.rooms["area-kitchen"]).toEqual({ area: "kitchen" });
    expect(Object.keys(built.bindings.rooms)).toHaveLength(9);
    for (const storey of built.storeys) {
      expect(storey.plan.format).toBe("domotwin-plan");
      const rects = rectsOf(storey);
      for (const [i, a] of rects.entries()) {
        expect(a.x1 - a.x0).toBeGreaterThanOrEqual(100);
        for (const b of rects.slice(i + 1)) {
          const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
      }
    }
    const garden = rectsOf(built.storeys[0] as BuiltStorey).find((r) => r.id === "area-garden");
    expect(garden?.outside).toBe(true);
  });

  it("joins every room by doors, an entrance outside, a window on each room's outer wall", () => {
    const built = buildHome({ storeys: homeStoreys(home(), "Home"), furnish: false });
    for (const storey of built.storeys) {
      const rects = rectsOf(storey);
      const doors = storey.plan.doors as { from: P; to: P; room: string }[];
      const joined = new Map(rects.map((r) => [r.id, new Set([r.id])]));
      let outside = 0;
      for (const door of doors) {
        const length = Math.hypot(door.to[0] - door.from[0], door.to[1] - door.from[1]);
        expect(length).toBeGreaterThanOrEqual(80);
        const by = roomsBy(rects, door.from, door.to);
        expect(by).toContain(door.room);
        if (by.length === 1) outside++;
        const [a, b] = by;
        if (a && b) {
          const merged = new Set([...(joined.get(a) ?? []), ...(joined.get(b) ?? [])]);
          for (const id of merged) joined.set(id, merged);
        }
      }
      // One group: every room reached from every other.
      expect(joined.get(rects[0]?.id ?? "")?.size).toBe(rects.length);
      if (storey.elevation === 0) expect(outside).toBe(1);
      const windows = storey.plan.windows as { from: P; to: P; room: string }[];
      expect(windows.length).toBeGreaterThan(0);
      for (const window of windows) {
        // On one room's side only: an outer wall.
        expect(
          roomsBy(
            rects.filter((r) => !r.outside),
            window.from,
            window.to,
          ),
        ).toEqual([window.room]);
      }
    }
  });

  it("places the devices and the furniture inside their rooms, apart, linked", () => {
    const hass = home();
    const built = buildHome({
      storeys: homeStoreys(hass, "Home"),
      devices: devicesOf(hass),
      furnish: true,
    });
    expect(built.devices).toBe(8);
    expect(built.left).toBe(0);
    expect(built.furniture).toBeGreaterThan(10);
    const ids = new Set<string>();
    for (const storey of built.storeys) {
      const rects = new Map(rectsOf(storey).map((r) => [r.id, r]));
      const items = storey.plan.items as {
        id: string;
        kind: string;
        at: P;
        size: number[];
        rotation: number;
        room: string;
        lift?: number;
      }[];
      for (const element of ["rooms", "doors", "windows", "items"]) {
        for (const { id } of storey.plan[element] as { id: string }[]) {
          expect(ids.has(id), id).toBe(false);
          ids.add(id);
        }
      }
      for (const item of items) {
        const room = rects.get(item.room);
        expect(room, item.id).toBeDefined();
        for (const [x, y] of corners(item.at, item.size, item.rotation)) {
          expect(x, item.id).toBeGreaterThanOrEqual((room?.x0 ?? 0) - 0.5);
          expect(x, item.id).toBeLessThanOrEqual((room?.x1 ?? 0) + 0.5);
          expect(y, item.id).toBeGreaterThanOrEqual((room?.y0 ?? 0) - 0.5);
          expect(y, item.id).toBeLessThanOrEqual((room?.y1 ?? 0) + 0.5);
        }
      }
    }
    const items = built.storeys.flatMap(
      (s) => s.plan.items as { id: string; kind: string; room: string }[],
    );
    expect(items.find((i) => i.room === "area-kids")?.kind).toBe("ceiling-light");
    expect(items.some((i) => i.room === "area-bedroom" && i.kind === "bed")).toBe(true);
    expect(items.some((i) => i.room === "area-living" && i.kind === "tv-stand")).toBe(true);
    const tv = items.find((i) => i.kind === "tv");
    expect(built.bindings.elements[tv?.id ?? ""]).toEqual({
      entities: [{ entity_id: "media_player.tv" }, { entity_id: "switch.tv_power" }],
    });
    expect(Object.keys(built.bindings.elements)).toHaveLength(8);
    // Without furniture, only the devices.
    const bare = buildHome({
      storeys: homeStoreys(hass, "Home"),
      devices: devicesOf(hass),
      furnish: false,
    });
    expect(bare.furniture).toBe(0);
    expect(bare.devices).toBe(8);
  });

  it("places the devices of an area in a plan of one's own, by its rooms' links or names", () => {
    const hass = home();
    const plan = {
      format: "domotwin-plan",
      version: 1,
      rooms: [
        // An L-shaped kitchen, linked by its name.
        {
          id: "k",
          name: "Kitchen",
          outline: [
            [0, 0],
            [400, 0],
            [400, 200],
            [200, 200],
            [200, 400],
            [0, 400],
          ],
        },
        {
          id: "b",
          name: "Chambre",
          outline: [
            [400, 0],
            [800, 0],
            [800, 400],
            [400, 400],
          ],
        },
      ],
      doors: [{ id: "door", from: [400, 50], to: [400, 130], room: "k" }],
      items: [{ id: "bed", kind: "bed", at: [600, 110], size: [160, 200, 55], room: "b" }],
    };
    const bindings: BindingsJson = {
      ...NO_BINDINGS,
      rooms: { b: { area: "bedroom" } },
      elements: { lamp: { entities: [{ entity_id: "climate.bedroom" }] } },
    };
    const placed = placeDevices(hass, plan, bindings, ["k", "b", "door", "bed", "lamp"]);
    // The kitchen's light; the bedroom's fan (its radiator is linked already).
    expect(placed.devices).toBe(2);
    const items = placed.plan.items as { id: string; kind: string; room: string }[];
    expect(items.map((i) => [i.kind, i.room])).toEqual([
      ["bed", "b"],
      ["ceiling-light", "k"],
      ["ceiling-fan", "b"],
    ]);
    expect(Object.keys(placed.elements)).toEqual(["ceiling-light-1", "ceiling-fan-1"]);
    // The plan given is left as it was.
    expect(plan.items).toHaveLength(1);
  });

  it("keeps a plan within its 500 elements, telling the devices left out", () => {
    const areas = Array.from({ length: 30 }, (_, i) => ({ id: `room${i}`, name: `Room ${i}` }));
    const many = Array.from({ length: 40 }, (_, i) => ({
      kind: "sensor",
      name: `Sensor ${i}`,
      entities: [`sensor.s${i}`],
    }));
    const started = performance.now();
    const built = buildHome({
      storeys: [{ name: "Home", level: 0, areas }],
      devices: new Map(areas.map((a) => [a.id, many])),
      furnish: true,
    });
    const took = performance.now() - started;
    const plan = built.storeys[0]?.plan ?? {};
    const count = ["rooms", "doors", "windows", "items"].reduce(
      (sum, key) => sum + (plan[key] as unknown[]).length,
      0,
    );
    expect(count).toBeLessThanOrEqual(500);
    expect(built.left).toBeGreaterThan(0);
    expect(built.devices + built.left).toBe(30 * 40);
    expect(took).toBeLessThan(5000);
  });

  it("gives the pieces the catalogue's sizes and lifts", () => {
    const source = readFileSync(
      resolve(__dirname, "../../crates/domotwin-core/src/plan/catalogue.rs"),
      "utf8",
    );
    const kinds = new Map<string, { name: string; size: number[]; lift: number }>();
    for (const [, variant = "", name = "", w, d, h, lift] of source.matchAll(
      /(\w+) = "([\w-]+)", \[(\d+), (\d+), (\d+)\], 0x[0-9a-f]+, (\d+),/g,
    )) {
      kinds.set(variant, { name, size: [Number(w), Number(d), Number(h)], lift: Number(lift) });
    }
    const styles = new Map<string, { size: number[]; lift?: number }>();
    for (const [, variant = "", style = "", w, d, h, lift] of source.matchAll(
      /\(Kind::(\w+), "([\w-]+)"\) => \(\[(\d+), (\d+), (\d+)\], (?:Some\(0x[0-9a-f]+\)|None), (?:Some\((\d+)\)|None)\)/g,
    )) {
      const kind = kinds.get(variant);
      if (!kind) continue;
      styles.set(`${kind.name}:${style}`, {
        size: [Number(w), Number(d), Number(h)],
        ...(lift === undefined ? {} : { lift: Number(lift) }),
      });
    }
    const byName = new Map([...kinds.values()].map((k) => [k.name, k]));
    for (const [key, shape] of Object.entries(SHAPES)) {
      const [kind = "", style] = key.split(":");
      const known = byName.get(kind);
      expect(known, key).toBeDefined();
      const own = style ? styles.get(key) : undefined;
      if (style) expect(own, key).toBeDefined();
      expect(shape.size, key).toEqual(own?.size ?? known?.size);
      // A television stands on its stand.
      if (key !== "tv") expect(shape.lift ?? 0, key).toBe(own?.lift ?? known?.lift);
    }
  });
});
