import { describe, expect, it } from "vitest";

import { storeyField } from "../src/components/card-editor";
import type { StoreyInfo } from "../src/ha/client";
import type { HomeAssistant } from "../src/ha/types";
import { Translator } from "../src/i18n";
import {
  ALL_STOREYS,
  loadHome,
  roomsElsewhere,
  storeyCounts,
  storeyLevels,
  storeyName,
  storeyShort,
  withAlertsElsewhere,
} from "../src/live/storeys";

const storey = (id: string, elevation: number, name = ""): StoreyInfo => ({ id, name, elevation });

describe("storeys", () => {
  it("number the storeys up and down from the one nearest the ground", () => {
    const levels = storeyLevels([
      storey("attic", 560),
      storey("ground", 10),
      storey("cellar", -260),
      storey("first", 280),
    ]);
    expect(levels.map(({ storey: s, level }) => [s.id, level])).toEqual([
      ["cellar", -1],
      ["ground", 0],
      ["first", 1],
      ["attic", 2],
    ]);
    // A home all above the ground: its lowest storey is the ground floor.
    expect(storeyLevels([storey("b", 300), storey("a", 100)]).map((l) => l.level)).toEqual([0, 1]);
  });

  it("call a storey by its name, else by its place", () => {
    const en = new Translator("en");
    const fr = new Translator("fr");
    expect(storeyName(en, storey("a", 0), 0)).toBe("Ground floor");
    expect(storeyName(en, storey("a", 280), 2)).toBe("Floor 2");
    expect(storeyName(fr, storey("a", -250), -1)).toBe("Sous-sol 1");
    expect(storeyName(fr, storey("a", 0, "Rez-de-jardin"), 0)).toBe("Rez-de-jardin");
    expect(storeyShort(-1)).toBe("−1");
    expect(storeyShort(3)).toBe("3");
  });

  it("are offered to a card highest first, a storey since removed kept", () => {
    const t = new Translator("en");
    const home = [storey("storey-1", 0), storey("storey-2", 280, "Attic")];
    const labels = (current: unknown): string[] | undefined =>
      (
        storeyField(t, home, current)?.selector.select as
          { options: { value: string; label: string }[] } | undefined
      )?.options.map((option) => `${option.value}:${option.label}`);
    expect(labels(undefined)).toEqual([
      ":The ground floor",
      "all:Every storey at once",
      "storey-2:Attic",
      "storey-1:Ground floor",
    ]);
    // Every storey at once is a choice like a storey.
    expect(labels(ALL_STOREYS)?.filter((l) => l.startsWith("all:"))).toHaveLength(1);
    expect(labels("storey-7")?.at(-1)).toBe("storey-7:storey-7");
    // One storey: nothing to pick, unless the card names another.
    expect(storeyField(t, home.slice(0, 1), undefined)).toBeUndefined();
    expect(storeyField(t, home.slice(0, 1), "storey-1")).toBeUndefined();
    expect(storeyField(t, home.slice(0, 1), "storey-2")).toBeDefined();
  });

  it("fetch the rooms of the storeys not shown, leaving out a plan that cannot be had", async () => {
    const plans: Record<string, unknown> = {
      up: { elements: [{ id: "office", type: "room", name: "Office" }] },
    };
    const client = {
      getPlan: (id?: string) =>
        id && id in plans
          ? Promise.resolve({ plan: plans[id], layout: {}, storey: id, storeys: [], revision: 1 })
          : Promise.reject(new Error("gone")),
    };
    const home = [storey("ground", 0), storey("up", 280), storey("gone", 560)];
    expect(await roomsElsewhere(client as never, home, "ground")).toEqual([
      { storey: "up", rooms: [{ id: "office", name: "Office" }] },
    ]);
  });

  it("put the alerts of the other storeys after those shown, dangers first", () => {
    const hass = {
      states: {
        "binary_sensor.office_smoke": {
          entity_id: "binary_sensor.office_smoke",
          state: "on",
          attributes: { device_class: "smoke" },
        },
        "binary_sensor.office_window": {
          entity_id: "binary_sensor.office_window",
          state: "on",
          attributes: { device_class: "window" },
        },
      },
      entities: {
        "binary_sensor.office_smoke": {
          entity_id: "binary_sensor.office_smoke",
          area_id: "office",
        },
      },
      areas: { office: { area_id: "office", name: "Office" } },
      devices: {},
    } as unknown as HomeAssistant;
    const bindings = { version: 1 as const, rooms: {}, elements: {} };
    const here = [
      {
        room: "hall",
        name: "Hall",
        level: "warning" as const,
        reason: "rain" as never,
        entity: "x",
      },
    ];
    const elsewhere = [{ storey: "up", rooms: [{ id: "office", name: "Office" }] }];
    const alerts = withAlertsElsewhere(hass, bindings, here, elsewhere, "ground");
    expect(alerts.map((a) => [a.storey, a.room, a.level])).toEqual([
      ["up", "office", "danger"],
      [undefined, "hall", "warning"],
    ]);
    // The storey shown is not counted twice.
    expect(withAlertsElsewhere(hass, bindings, [], elsewhere, "up")).toEqual([]);
    // A sensor raises one alert: a room of the same name shown here keeps it.
    const office = { room: "office", name: "Office", level: "danger" as const, reason: "smoke" };
    const shownHere = [{ ...office, entity: "binary_sensor.office_smoke" }] as never[];
    const twin = [{ storey: "up", rooms: [{ id: "office-2", name: "Office" }] }];
    expect(withAlertsElsewhere(hass, bindings, shownHere, twin, "ground")).toHaveLength(1);
  });

  it("fetch every storey's plan to show the home whole, lowest first", async () => {
    const asked: (string | undefined)[] = [];
    const client = {
      getPlan: (id?: string) => {
        asked.push(id);
        return Promise.resolve({
          plan: { elements: [{ type: "room", id: `room-${id ?? ""}` }] },
          layout: { moved: { x: 1 } },
          revision: 1,
          storey: id ?? null,
          storeys: [],
        });
      },
    };
    const home = await loadHome(client, [storey("up", 280, "Up"), storey("down", 0)]);
    expect(home.map((s) => [s.id, s.name, s.elevation])).toEqual([
      ["down", "", 0],
      ["up", "Up", 280],
    ]);
    expect(home[1]?.plan).toEqual({ elements: [{ type: "room", id: "room-up" }] });
    expect(home[0]?.layout).toEqual({ moved: { x: 1 } });
    expect(asked.sort()).toEqual(["down", "up"]);
  });

  it("leave out of the home a storey without a plan; a plan not fetched fails it", async () => {
    const client = (lost: boolean) => ({
      getPlan: (id?: string) =>
        lost && id === "attic"
          ? Promise.reject(new Error("gone"))
          : Promise.resolve({
              plan: id === "empty" ? null : { elements: [] },
              layout: {},
              revision: 1,
              storey: id ?? null,
              storeys: [],
            }),
    });
    const storeys = [storey("ground", 0), storey("empty", 280), storey("attic", 560)];
    const home = await loadHome(client(false), storeys);
    expect(home.map((s) => s.id)).toEqual(["ground", "attic"]);
    await expect(loadHome(client(true), storeys)).rejects.toThrow("gone");
  });

  it("count a storey's rooms and the lights linked to it that are on", () => {
    const plan = {
      elements: [
        { type: "room", id: "office" },
        { type: "room", id: "landing" },
        { type: "furniture", id: "lamp" },
        { type: "furniture", id: "desk" },
      ],
    };
    const hass = {
      states: {
        "light.desk": { state: "on" },
        "light.off": { state: "off" },
        "switch.fan": { state: "on" },
      },
    } as unknown as HomeAssistant;
    const bindings = {
      version: 1 as const,
      rooms: {},
      elements: {
        lamp: { entities: [{ entity_id: "light.desk" }, { entity_id: "light.off" }] },
        desk: { entities: [{ entity_id: "switch.fan" }, { entity_id: "light.desk" }] },
        elsewhere: { entities: [{ entity_id: "light.hall" }] },
      },
    };
    // The same light linked twice counts once; switches are not lights.
    expect(storeyCounts(hass, bindings, plan)).toEqual({ rooms: 2, lights: 1 });
    expect(storeyCounts(undefined, undefined, plan)).toEqual({ rooms: 2, lights: 0 });
    expect(storeyCounts(hass, bindings, null)).toEqual({ rooms: 0, lights: 0 });
    // A lamp added in edit mode counts too.
    const added = { ...bindings, elements: { added: { entities: [{ entity_id: "light.new" }] } } };
    const lit = { states: { "light.new": { state: "on" } } } as unknown as HomeAssistant;
    expect(storeyCounts(lit, added, plan)).toEqual({ rooms: 2, lights: 0 });
    expect(storeyCounts(lit, added, plan, { added: { add: { kind: "lamp" } } })).toEqual({
      rooms: 2,
      lights: 1,
    });
  });
});
