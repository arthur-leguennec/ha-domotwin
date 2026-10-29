import { describe, expect, it } from "vitest";

import {
  asksBack,
  backAt,
  durationText,
  firstChoice,
  heatingAt,
  heatingBack,
  heatingNow,
  nextUsual,
  zoned,
  type BackChoice,
} from "../src/live/back";
import type { Shortcut } from "../src/live/shortcut-model";
import type { Call } from "../src/live/shortcuts";

const PARIS = "Europe/Paris";
/** Monday 26 October 2026, 10:00 in Paris (winter time, UTC+1). */
const MONDAY_MORNING = new Date("2026-10-26T09:00:00Z");
/** Back at half past six on weekdays, none at the weekend. */
const usual = ["18:30", "18:30", "18:30", "18:30", "18:30", null, null];

const leaving: Shortcut = {
  id: "leave",
  name: "Leaving home",
  icon: "leave",
  steps: [
    { kind: "lights", do: "off" },
    { kind: "climate", do: "eco" },
  ],
  back: { usual, ahead: 45 },
};

describe("when one is back (D-091)", () => {
  it("is asked by a shortcut leaving home that turns the heating down", () => {
    expect(asksBack(leaving)).toBe(true);
    expect(asksBack({ ...leaving, back: undefined })).toBe(false);
    // Nothing to bring back without the heating.
    expect(asksBack({ ...leaving, steps: [{ kind: "lights", do: "off" }] })).toBe(false);
  });

  it("reads days and times where the home is", () => {
    // Winter time on 26 October, summer time in July.
    expect(zoned("2026-10-26", "18:30", PARIS)?.toISOString()).toBe("2026-10-26T17:30:00.000Z");
    expect(zoned("2026-07-01", "18:30", PARIS)?.toISOString()).toBe("2026-07-01T16:30:00.000Z");
    expect(zoned("2026-07-01", "18:30", "UTC")?.toISOString()).toBe("2026-07-01T18:30:00.000Z");
    expect(zoned("1 July", "18:30", PARIS)).toBeUndefined();
    expect(zoned("2026-07-01", "half past six", PARIS)).toBeUndefined();
  });

  it("finds the next usual return, this evening or another day's", () => {
    const back = { usual };
    expect(nextUsual(back, MONDAY_MORNING, PARIS)?.toISOString()).toBe("2026-10-26T17:30:00.000Z");
    // Past it: Tuesday's.
    const evening = new Date("2026-10-26T19:00:00Z");
    expect(nextUsual(back, evening, PARIS)?.toISOString()).toBe("2026-10-27T17:30:00.000Z");
    // On Friday night: Monday's, the weekend having none.
    const friday = new Date("2026-10-30T20:00:00Z");
    expect(nextUsual(back, friday, PARIS)?.toISOString()).toBe("2026-11-02T17:30:00.000Z");
    expect(nextUsual({}, MONDAY_MORNING, PARIS)).toBeUndefined();
    expect(nextUsual(undefined, MONDAY_MORNING, PARIS)).toBeUndefined();
  });

  it("offers the usual return first when it is within a day, else not known", () => {
    expect(firstChoice({ usual }, MONDAY_MORNING, PARIS)).toEqual({
      when: "at",
      minutes: 120,
      time: "18:30",
      date: "2026-10-26",
    });
    // Monday evening: tomorrow's, on its day.
    expect(firstChoice({ usual }, new Date("2026-10-26T19:00:00Z"), PARIS)).toMatchObject({
      when: "on",
      time: "18:30",
      date: "2026-10-27",
    });
    // Friday night: Monday is too far to be a routine's.
    expect(firstChoice({ usual }, new Date("2026-10-30T20:00:00Z"), PARIS).when).toBe("unknown");
    // None filled in: not known, the other ways starting an hour from now.
    expect(firstChoice({}, MONDAY_MORNING, PARIS)).toEqual({
      when: "unknown",
      minutes: 120,
      time: "11:00",
      date: "2026-10-26",
    });
    // A workplace closing: back when it opens again.
    const opens = new Date("2026-10-27T07:00:00Z");
    expect(firstChoice({}, new Date("2026-10-26T18:00:00Z"), PARIS, opens)).toMatchObject({
      when: "on",
      time: "08:00",
      date: "2026-10-27",
    });
  });

  it("says when one is back as chosen, only when it is to come", () => {
    const choice: BackChoice = { when: "in", minutes: 120, time: "18:30", date: "2026-10-27" };
    expect(backAt(choice, MONDAY_MORNING, PARIS)?.toISOString()).toBe("2026-10-26T11:00:00.000Z");
    expect(backAt({ ...choice, when: "at" }, MONDAY_MORNING, PARIS)?.toISOString()).toBe(
      "2026-10-26T17:30:00.000Z",
    );
    // A time passed today is tomorrow's.
    expect(
      backAt({ ...choice, when: "at", time: "08:00" }, MONDAY_MORNING, PARIS)?.toISOString(),
    ).toBe("2026-10-27T07:00:00.000Z");
    expect(backAt({ ...choice, when: "on" }, MONDAY_MORNING, PARIS)?.toISOString()).toBe(
      "2026-10-27T17:30:00.000Z",
    );
    // Not known, gone by, unreadable, or more than a year ahead: none.
    expect(backAt({ ...choice, when: "unknown" }, MONDAY_MORNING, PARIS)).toBeUndefined();
    expect(
      backAt({ ...choice, when: "on", date: "2026-10-25" }, MONDAY_MORNING, PARIS),
    ).toBeUndefined();
    expect(backAt({ ...choice, when: "at", time: "" }, MONDAY_MORNING, PARIS)).toBeUndefined();
    expect(
      backAt({ ...choice, when: "on", date: "2028-01-01" }, MONDAY_MORNING, PARIS),
    ).toBeUndefined();
  });

  it("brings the heating back a while before, never before a minute from now", () => {
    const back = new Date("2026-10-26T17:30:00Z");
    expect(heatingAt({ ahead: 45 }, back, MONDAY_MORNING).toISOString()).toBe(
      "2026-10-26T16:45:00.000Z",
    );
    // Half an hour when not said.
    expect(heatingAt({}, back, MONDAY_MORNING).toISOString()).toBe("2026-10-26T17:00:00.000Z");
    // Back in twenty minutes: the heating in a minute.
    const soon = new Date(MONDAY_MORNING.getTime() + 20 * 60_000);
    expect(heatingAt({ ahead: 45 }, soon, MONDAY_MORNING).toISOString()).toBe(
      "2026-10-26T09:01:00.000Z",
    );
  });

  it("asks the integration to put back the heating alone, each setting once", () => {
    const many = Array.from({ length: 30 }, (_, i) => `climate.room_${i}`);
    const calls: Call[] = [
      ["light", "turn_on", { brightness: 128 }, ["light.sofa"]],
      ["climate", "set_preset_mode", { preset_mode: "comfort" }, ["climate.living"]],
      ["climate", "set_temperature", { temperature: 20.5 }, many],
      ["media_player", "turn_on", {}, ["media_player.tv"]],
    ];
    const at = new Date("2026-10-26T16:45:00Z");
    const items = heatingBack(calls, at);
    expect(items.map((item) => [item.climate, item.entities.length])).toEqual([
      [{ preset_mode: "comfort" }, 1],
      [{ temperature: 20.5 }, 25],
      [{ temperature: 20.5 }, 5],
    ]);
    expect(items.every((item) => item.action === "climate" && item.at === at.toISOString())).toBe(
      true,
    );
    // Back early: the same, now.
    expect(heatingNow({ entities: ["climate.living"], climate: { hvac_mode: "heat" } })).toEqual([
      "climate",
      "set_hvac_mode",
      { hvac_mode: "heat" },
      ["climate.living"],
    ]);
    expect(heatingNow({ entities: ["climate.living"] })).toBeUndefined();
  });

  it("says how long one is away in the viewer's words", () => {
    expect(durationText(30, "en")).toBe("30 minutes");
    expect(durationText(120, "en")).toBe("2 hours");
    expect(durationText(1440, "en")).toBe("1 day");
    expect(durationText(10_080, "en")).toBe("1 week");
    // French puts a no-break space between the number and its unit.
    expect(durationText(60, "fr")).toMatch(/^1\s+heure$/u);
  });
});
