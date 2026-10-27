import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { layerAsked } from "../src/live/layers";
import { areaPage, isSummary, summaryPath, versionAtLeast } from "../src/live/overview";
import {
  automationsSummary,
  peopleSummary,
  robotsSummary,
  upkeepSummary,
} from "../src/live/summaries";

const state = (entity_id: string, value: string, attributes = {}): HassEntity => ({
  entity_id,
  state: value,
  attributes,
  last_changed: "",
  last_updated: "",
});

/** A fictional home on Home Assistant 2026.10, with its Overview. */
function hass(extra: Partial<HomeAssistant> = {}): HomeAssistant {
  const states = [
    state("person.alex", "home"),
    state("person.sam", "home"),
    state("person.kim", "not_home"),
    state("sensor.domotwin_kitchen_people", "2", {
      room: "Kitchen",
      people: ["person.alex", "person.sam"],
    }),
    state("sensor.domotwin_hall_people", "unknown", { room: "Hall", private: true }),
    state("sensor.domotwin_bedroom_people", "0", { room: "Bedroom", people: [] }),
    // Renamed in Home Assistant: still DomoTwin's upkeep sensor.
    state("sensor.chores", "1", {
      tasks: [{ piece: "washer", piece_name: "Washer", task: "Clean the filter", state: "due" }],
    }),
    state("automation.morning", "on", { last_triggered: "2026-10-24T06:30:00+00:00" }),
    // Ran at 21:30 UTC: still the 24th in Paris.
    state("automation.evening", "on", { last_triggered: "2026-10-24T21:30:00+00:00" }),
    // Ran at 23:30 UTC: the 25th already in Paris.
    state("automation.night", "off", { last_triggered: "2026-10-24T23:30:00+00:00" }),
    state("vacuum.robbie", "cleaning"),
    state("vacuum.dusty", "docked"),
    state("vacuum.old", "unavailable"),
  ];
  const own = (entity_id: string, translation_key: string) => ({
    entity_id,
    platform: "domotwin",
    translation_key,
  });
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    entities: {
      "sensor.domotwin_kitchen_people": own("sensor.domotwin_kitchen_people", "room_people"),
      "sensor.domotwin_hall_people": own("sensor.domotwin_hall_people", "room_people"),
      "sensor.domotwin_bedroom_people": own("sensor.domotwin_bedroom_people", "room_people"),
      "sensor.chores": own("sensor.chores", "upkeep_due"),
    },
    areas: { kitchen: { area_id: "kitchen", name: "Kitchen" } },
    panels: { home: { url_path: "home" } },
    config: { version: "2026.10.0", time_zone: "Europe/Paris" },
    user: { id: "u", name: "U", is_admin: false },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    ...extra,
  };
}

describe("into Home Assistant's Overview (D-061)", () => {
  it("knows the versions whose Overview has a page for each area", () => {
    expect(versionAtLeast("2026.2.0", [2026, 2])).toBe(true);
    expect(versionAtLeast("2026.10.0b1", [2026, 2])).toBe(true);
    expect(versionAtLeast("2027.1.0", [2026, 2])).toBe(true);
    expect(versionAtLeast("2026.1.3", [2026, 2])).toBe(false);
    expect(versionAtLeast("2025.12.0", [2026, 2])).toBe(false);
    expect(versionAtLeast(undefined, [2026, 2])).toBe(false);
    expect(versionAtLeast("dev", [2026, 2])).toBe(false);
  });

  it("opens an area's page where Home Assistant has one, and only there", () => {
    expect(areaPage(hass(), "kitchen")).toBe("/home/areas-kitchen");
    // An area Home Assistant does not have, a version before the Overview, no `home` panel.
    expect(areaPage(hass(), "garage")).toBeUndefined();
    expect(areaPage(hass({ config: { version: "2026.1.0" } }), "kitchen")).toBeUndefined();
    expect(areaPage(hass({ panels: {} }), "kitchen")).toBeUndefined();
    // The demo house's and the sandbox's areas are not the home's.
    expect(areaPage(hass({ demo: true }), "kitchen")).toBeUndefined();
    expect(areaPage(hass({ sandbox: true }), "kitchen")).toBeUndefined();
    expect(areaPage(undefined, "kitchen")).toBeUndefined();
  });

  it("opens the 3D view on what each summary sums up", () => {
    expect(summaryPath("upkeep")).toBe("/domotwin/3d?layer=upkeep");
    expect(summaryPath("network")).toBe("/domotwin/3d?layer=network");
    expect(summaryPath("automations")).toBe("/domotwin/3d?layer=automations");
    expect(summaryPath("people")).toBe("/domotwin/3d");
    expect(summaryPath("robots")).toBe("/domotwin/3d");
    expect(isSummary("people")).toBe(true);
    expect(isSummary("weather")).toBe(false);
    // A layer asked for in the address: one the view knows (it shows none this user may not see).
    expect(layerAsked("upkeep")).toBe("upkeep");
    expect(layerAsked("automations")).toBe("automations");
    expect(layerAsked("nonsense")).toBeUndefined();
    expect(layerAsked(null)).toBeUndefined();
  });

  it("sums up the people, the upkeep, the automations and the robots", () => {
    const home = hass();
    // A private room says nothing (its sensor is unknown); nor a room of someone this viewer may
    // not see, nor any before the people's settings are known.
    const everyone = new Set(["person.alex", "person.sam", "person.kim"]);
    expect(peopleSummary(home, everyone)).toEqual({ home: 2, rooms: ["Kitchen"] });
    expect(peopleSummary(home, new Set(["person.kim"]))).toEqual({ home: 2, rooms: [] });
    expect(peopleSummary(home, undefined)).toEqual({ home: 2, rooms: [] });
    expect(upkeepSummary(home)).toEqual({
      due: 1,
      next: { task: "Clean the filter", piece: "Washer", state: "due" },
    });
    expect(upkeepSummary(hass({ states: {} }))).toBeUndefined();
    // DomoTwin starting: its sensor says nothing yet, which is not "not set up".
    const starting = hass();
    starting.states["sensor.chores"] = state("sensor.chores", "unavailable");
    expect(upkeepSummary(starting)).toBe("unavailable");
    // The 24th where the home is (Paris): two ran that day, the third the next.
    const noon = Date.parse("2026-10-24T10:00:00Z");
    expect(automationsSummary(home, noon)).toEqual({ total: 3, on: 2, today: 2 });
    const robots = robotsSummary(home);
    expect(robots.total).toBe(3);
    expect(Object.fromEntries(robots.states)).toEqual({
      cleaning: 1,
      docked: 1,
      unavailable: 1,
    });
  });
});
