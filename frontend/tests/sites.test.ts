import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { NO_BINDINGS, type BindingsJson } from "../src/live/bindings";
import type { PlanRoom } from "../src/live/layers";
import { countedHere, type PeopleSettings } from "../src/live/people";
import {
  homeSites,
  siteGround,
  siteHours,
  siteOf,
  siteScope,
  siteStoreys,
} from "../src/live/sites";

const storeys = [
  { id: "storey-1", name: "", elevation: 0 },
  { id: "storey-2", name: "", elevation: 280 },
  { id: "storey-3", name: "Shop floor", elevation: 0 },
  { id: "storey-4", name: "Stockroom", elevation: -250 },
];

const settings = {
  sites: [
    { id: "home", name: "Main street", storeys: ["storey-1", "gone"] },
    {
      id: "shop",
      name: "Harbour",
      storeys: ["storey-3", "storey-4", "storey-1"],
      hours: "schedule.shop",
    },
  ],
  workplace: { hours: "schedule.office" },
};

describe("several sites (D-090)", () => {
  it("each has its storeys; a storey in none, or in two, is the first's", () => {
    const sites = homeSites(settings, storeys);
    expect(sites.map((site) => site.storeys)).toEqual([
      ["storey-1", "storey-2"],
      ["storey-3", "storey-4"],
    ]);
    // Fewer than two: no sites, the whole home.
    expect(homeSites({ sites: settings.sites.slice(0, 1) }, storeys)).toEqual([]);
    expect(homeSites(undefined, storeys)).toEqual([]);
  });

  it("the site shown is the storey's, its ground floor the nearest the ground", () => {
    const sites = homeSites(settings, storeys);
    expect(siteOf(sites, "storey-4")?.id).toBe("shop");
    expect(siteOf(sites, undefined)?.id).toBe("home");
    expect(siteOf(sites, "unknown")?.id).toBe("home");
    expect(siteOf([], "storey-1")).toBeUndefined();
    expect(siteStoreys(storeys, sites[1]).map((storey) => storey.id)).toEqual([
      "storey-3",
      "storey-4",
    ]);
    expect(siteStoreys(storeys, undefined)).toHaveLength(4);
    expect(siteGround(storeys, sites[1])?.id).toBe("storey-3");
    // Its own hours, else the workplace's.
    expect(siteHours(settings, sites[1])).toBe("schedule.shop");
    expect(siteHours(settings, sites[0])).toBe("schedule.office");
  });

  it("shows its rooms, and leaves the others' areas and linked entities out", () => {
    const hass = {
      states: {},
      entities: {},
      devices: {},
      areas: {
        kitchen: { area_id: "kitchen", name: "Kitchen" },
        counter: { area_id: "counter", name: "Counter" },
      },
    } as unknown as HomeAssistant;
    const rooms = (...names: string[]): PlanRoom[] =>
      names.map((name): PlanRoom => ({ id: name.toLowerCase(), name }));
    // The counter room's own light.
    const bindings = {
      ...NO_BINDINGS,
      elements: { counter: { entities: [{ entity_id: "light.counter" }] } },
    } as BindingsJson;
    const [home, shop] = homeSites(settings, storeys);
    if (!home || !shop) throw new Error("two sites");
    const sites = [home, shop];
    const all = [
      { storey: "storey-1", rooms: rooms("Kitchen") },
      { storey: "storey-3", rooms: rooms("Counter") },
    ];
    const here = siteScope(hass, bindings, sites, home, all);
    expect(here.rooms.map((room) => room.id)).toEqual(["kitchen"]);
    expect([...here.areas]).toEqual(["counter"]);
    expect([...here.entities]).toEqual(["light.counter"]);
    // Someone on no storey is on the first site.
    expect(here.onSite(undefined)).toBe(true);
    expect(here.onSite("storey-3")).toBe(false);
    const there = siteScope(hass, bindings, sites, shop, all);
    expect([...there.areas]).toEqual(["kitchen"]);
    expect(there.onSite(undefined)).toBe(false);
    expect(there.onSite("storey-4")).toBe(true);
  });
});

describe("people on a site (D-090)", () => {
  it("are counted on the storeys of the site shown; someone in no room, on the first", () => {
    const sensor = (room: string | undefined, storey: string | undefined): object => ({
      state: room ?? "unknown",
      attributes: room ? { room_id: room, storey_id: storey } : {},
    });
    const hass = {
      states: {
        "person.alex": { state: "home", attributes: {} },
        "person.sam": { state: "home", attributes: {} },
        "person.lee": { state: "home", attributes: {} },
        "person.kim": { state: "not_home", attributes: {} },
        "sensor.alex_room": sensor("kitchen", "storey-1"),
        "sensor.sam_room": sensor("counter", "storey-3"),
        "sensor.lee_room": sensor(undefined, undefined),
        "sensor.kim_room": sensor(undefined, undefined),
      },
      user: { is_admin: true },
    } as unknown as HomeAssistant;
    const people: PeopleSettings = {
      revision: 1,
      shown: "everyone",
      look: "figure",
      hidden: [],
      counted: true,
      people: Object.fromEntries(
        ["alex", "sam", "lee", "kim"].map((name) => [
          `person.${name}`,
          { sources: [], color: "#888888", sensor: `sensor.${name}_room` },
        ]),
      ),
    };
    const home = new Set(["storey-1", "storey-2"]);
    const shop = new Set(["storey-3"]);
    expect(countedHere(people, hass)).toBe(3);
    // Alex in the kitchen, and Lee in no room: the first site's.
    expect(
      countedHere(people, hass, new Set(), (storey) => (storey ? home.has(storey) : true)),
    ).toBe(2);
    expect(
      countedHere(people, hass, new Set(), (storey) => (storey ? shop.has(storey) : false)),
    ).toBe(1);
  });
});
