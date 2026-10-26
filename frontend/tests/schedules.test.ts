import { describe, expect, it } from "vitest";

import {
  nextStep,
  readSchedules,
  scheduleBadges,
  schedulesOf,
  soonIn,
  timeStyle,
  whenText,
  type Schedule,
} from "../src/live/schedules";

const lantern: Schedule = {
  id: "a",
  entities: ["light.lantern"],
  action: "on",
  at: "2026-10-27T05:30:00+00:00",
  until: "2026-10-27T05:45:00+00:00",
  brightness: 100,
  started: false,
};
const blind: Schedule = {
  id: "b",
  entities: ["cover.blind", "light.lantern"],
  action: "off",
  at: "2026-10-26T21:00:00+00:00",
  until: null,
  brightness: null,
  started: false,
};

describe("actions done later", () => {
  it("reads the integration's list leniently", () => {
    expect(
      readSchedules({ schedules: [lantern, { id: 3 }, null, { ...blind, at: "soon" }] }),
    ).toEqual([lantern]);
    expect(readSchedules({ schedules: [{ ...lantern, until: 4, brightness: "x" }] })).toEqual([
      { ...lantern, until: null, brightness: null },
    ]);
    expect(readSchedules(null)).toEqual([]);
    expect(readSchedules({})).toEqual([]);
  });

  it("knows each action's next step: its start, or its end once started", () => {
    expect(nextStep(lantern)).toEqual({ action: "on", at: new Date(lantern.at) });
    expect(nextStep({ ...lantern, started: true })).toEqual({
      action: "off",
      at: new Date("2026-10-27T05:45:00Z"),
    });
    expect(nextStep(blind).action).toBe("off");
  });

  it("lists a piece's actions, the soonest first", () => {
    expect(schedulesOf([lantern, blind], ["light.lantern"]).map((s) => s.id)).toEqual(["b", "a"]);
    expect(schedulesOf([lantern, blind], ["cover.blind"]).map((s) => s.id)).toEqual(["b"]);
    expect(schedulesOf([lantern, blind], ["switch.kettle"])).toEqual([]);
  });

  it("puts a clock over the pieces with an action waiting", () => {
    const bindings = {
      version: 1,
      elements: {
        lamp: { entities: [{ entity_id: "light.lantern" }] },
        window: { entities: [{ entity_id: "cover.blind" }] },
        kettle: { entities: [{ entity_id: "switch.kettle" }] },
      },
    };
    const badges = scheduleBadges(bindings as never, [lantern, blind], (at) => at.toISOString());
    expect([...badges.keys()].sort()).toEqual(["lamp", "window"]);
    expect(badges.get("lamp")).toEqual([
      {
        element: "lamp",
        kind: "scheduled",
        tone: "info",
        entity: "light.lantern",
        text: "2026-10-26T21:00:00.000Z",
      },
    ]);
    expect(scheduleBadges(bindings as never, [], String).size).toBe(0);
  });

  it("says when, in Home Assistant's time zone", () => {
    const now = new Date("2026-10-26T20:00:00Z"); // 21:00 in Paris
    const en = { language: "en", timeZone: "Europe/Paris", hour12: false };
    const fr = { language: "fr", timeZone: "Europe/Paris" };
    expect(whenText(new Date("2026-10-26T21:30:00Z"), now, en)).toBe("22:30");
    expect(whenText(new Date("2026-10-27T05:30:00Z"), now, en)).toBe("tomorrow 06:30");
    expect(whenText(new Date("2026-10-27T05:30:00Z"), now, fr)).toBe("demain 06:30");
    expect(whenText(new Date("2026-10-29T05:30:00Z"), now, en)).toBe("Thu 06:30");
    expect(whenText(new Date("2026-11-20T05:30:00Z"), now, en)).toBe("Nov 20 06:30");
    expect(whenText(new Date("2026-11-20T05:30:00Z"), now, fr)).toBe("20 nov. 06:30");
    expect(whenText(new Date("2026-10-26T21:30:00Z"), now, { ...en, hour12: true })).toBe(
      "10:30 PM",
    );
    // Late in the evening in Paris, it is already tomorrow in UTC.
    expect(whenText(new Date("2026-10-26T22:30:00Z"), now, en)).toBe("23:30");
  });

  it("offers half an hour from now, in Home Assistant's time zone, not the browser's", () => {
    const now = new Date("2026-10-26T20:58:00Z"); // 21:58 in Paris, 16:58 in New York
    expect(soonIn(now, "Europe/Paris")).toBe("22:30");
    expect(soonIn(now, "America/New_York")).toBe("17:30");
    expect(soonIn(new Date("2026-10-26T22:50:00Z"), "Europe/Paris")).toBe("00:20");
  });

  it("falls back on the browser's time zone when it does not know Home Assistant's", () => {
    const hass = { language: "en", config: { time_zone: "Mars/Olympus_Mons" } };
    const style = timeStyle(hass as never);
    expect(style.timeZone).toBeUndefined();
    expect(() => whenText(new Date(), new Date(), style)).not.toThrow();
    const paris = timeStyle({ language: "fr", config: { time_zone: "Europe/Paris" } } as never);
    expect(paris).toEqual({ language: "fr", timeZone: "Europe/Paris", hour12: undefined });
  });
});
