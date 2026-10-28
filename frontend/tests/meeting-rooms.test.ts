import { describe, expect, it } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { NO_BINDINGS } from "../src/live/bindings";
import type { PlanRoom } from "../src/live/layers";
import { bookingOf, meetingRoomsOf, serviceTime } from "../src/live/meeting-rooms";
import { NOTHING_UNSEEN } from "../src/live/privacy";

/** 10:00 in Montreal. */
const NOW = Date.parse("2026-10-28T14:00:00Z");

const rooms = [
  { id: "board", name: "Board room" },
  { id: "huddle", name: "Huddle" },
  { id: "kitchen", name: "Kitchen" },
] as PlanRoom[];

function home(states: Record<string, { state: string; attributes?: object }>): HomeAssistant {
  return {
    states: Object.fromEntries(
      Object.entries(states).map(([id, { state, attributes }]) => [
        id,
        { entity_id: id, state, attributes: attributes ?? {} },
      ]),
    ),
    entities: {
      "binary_sensor.huddle_motion": {
        entity_id: "binary_sensor.huddle_motion",
        area_id: "huddle",
      },
    },
    devices: {},
    areas: {
      board: { area_id: "board", name: "Board room" },
      huddle: { area_id: "huddle", name: "Huddle" },
    },
    config: { time_zone: "America/Toronto" },
    now: () => NOW,
  } as unknown as HomeAssistant;
}

describe("a workplace's meeting rooms (D-089)", () => {
  it("are free, taken by someone, or booked in their calendar, with their next booking", () => {
    const hass = home({
      // A meeting under way until 11:00 where the place is.
      "calendar.board": {
        state: "on",
        attributes: {
          supported_features: 7,
          start_time: "2026-10-28 09:30:00",
          end_time: "2026-10-28 11:00:00",
        },
      },
      // Nothing now; a meeting at 15:00.
      "calendar.huddle": {
        state: "off",
        attributes: { start_time: "2026-10-28 15:00:00", end_time: "2026-10-28 16:00:00" },
      },
      "binary_sensor.huddle_motion": { state: "on", attributes: { device_class: "motion" } },
    });
    const found = meetingRoomsOf(
      hass,
      rooms,
      NO_BINDINGS,
      { board: { calendar: "calendar.board" }, huddle: { calendar: "calendar.huddle" } },
      NOTHING_UNSEEN,
      new Set(),
    );
    expect(found).toEqual([
      {
        room: "board",
        name: "Board room",
        calendar: "calendar.board",
        state: "booked",
        until: Date.parse("2026-10-28T15:00:00Z"),
        bookable: true,
      },
      {
        room: "huddle",
        name: "Huddle",
        calendar: "calendar.huddle",
        state: "taken",
        next: Date.parse("2026-10-28T19:00:00Z"),
        bookable: false,
      },
    ]);
  });

  it("says booked what its calendar's times say, what was booked from here, a whole day", () => {
    const hass = home({
      // Under way since 9:55 by its times, its state not yet on.
      "calendar.board": {
        state: "off",
        attributes: {
          supported_features: 1,
          start_time: "2026-10-28 09:55:00",
          end_time: "2026-10-28 10:30:00",
        },
      },
      // Its server cannot be read: nothing said, not booked from here.
      "calendar.huddle": {
        state: "unavailable",
        attributes: { supported_features: 1, start_time: "2026-10-28 08:00:00" },
      },
      // A whole day, and the next booking tomorrow.
      "calendar.kitchen": {
        state: "on",
        attributes: {
          supported_features: 1,
          all_day: true,
          start_time: "2026-10-28 00:00:00",
          end_time: "2026-10-29 00:00:00",
        },
      },
    });
    const marked = {
      board: { calendar: "calendar.board" },
      huddle: { calendar: "calendar.huddle" },
      kitchen: { calendar: "calendar.kitchen" },
    };
    const [board, huddle, kitchen] = meetingRoomsOf(
      hass,
      rooms,
      NO_BINDINGS,
      marked,
      NOTHING_UNSEEN,
      new Set(),
    );
    expect(board).toMatchObject({ state: "booked", until: Date.parse("2026-10-28T14:30:00Z") });
    expect(huddle).toMatchObject({ state: "free", bookable: false });
    expect(huddle?.next).toBeUndefined();
    expect(kitchen).toMatchObject({ state: "booked", allDay: true });
    // Booked from here, its calendar not saying it yet (one that reads its server now and then).
    const off = home({
      "calendar.huddle": {
        state: "off",
        attributes: {
          supported_features: 1,
          start_time: "2026-10-29 09:00:00",
          end_time: "2026-10-29 10:00:00",
        },
      },
    });
    const held = { huddle: { start: NOW, end: NOW + 1_800_000 } };
    const found = meetingRoomsOf(off, rooms, NO_BINDINGS, marked, NOTHING_UNSEEN, new Set(), held);
    expect(found[1]).toMatchObject({ state: "booked", until: NOW + 1_800_000 });
    // Once it ends, free again, with the next booking tomorrow.
    off.now = () => NOW + 1_800_000;
    const after = meetingRoomsOf(off, rooms, NO_BINDINGS, marked, NOTHING_UNSEEN, new Set(), held);
    expect(after[1]).toMatchObject({
      state: "free",
      next: Date.parse("2026-10-29T13:00:00Z"),
      bookable: true,
    });
  });

  it("is booked only by who may use its calendar, taken only by sensors they may see", () => {
    const hass = home({
      "calendar.huddle": { state: "off", attributes: { supported_features: 1 } },
      "binary_sensor.huddle_motion": { state: "on", attributes: { device_class: "motion" } },
    });
    hass.canAct = (entity) => entity !== "calendar.huddle";
    const marked = { huddle: { calendar: "calendar.huddle" } };
    expect(meetingRoomsOf(hass, rooms, NO_BINDINGS, marked, NOTHING_UNSEEN, new Set())).toEqual([
      {
        room: "huddle",
        name: "Huddle",
        calendar: "calendar.huddle",
        state: "taken",
        bookable: false,
      },
    ]);
    const unseen = { areas: new Set<string>(), entities: new Set(["binary_sensor.huddle_motion"]) };
    expect(meetingRoomsOf(hass, rooms, NO_BINDINGS, marked, unseen, new Set())[0]?.state).toBe(
      "free",
    );
  });

  it("leaves out a private room the viewer may not see, and a calendar they may not", () => {
    const hass = home({
      "calendar.board": { state: "off", attributes: { supported_features: 1 } },
    });
    const marked = { board: { calendar: "calendar.board" }, huddle: {} };
    expect(
      meetingRoomsOf(hass, rooms, NO_BINDINGS, marked, NOTHING_UNSEEN, new Set(["huddle"])).map(
        (room) => room.room,
      ),
    ).toEqual(["board"]);
    const [board] = meetingRoomsOf(
      hass,
      rooms,
      NO_BINDINGS,
      marked,
      { areas: new Set(["huddle"]), entities: new Set(["calendar.board"]) },
      new Set(),
    );
    expect(board).toEqual({ room: "board", name: "Board room", state: "free", bookable: false });
  });

  it("is booked from the minute under way, never over its next booking", () => {
    const free = {
      room: "board",
      name: "Board room",
      state: "free" as const,
      bookable: true,
      next: NOW + 20 * 60_000,
    };
    expect(bookingOf(free, 30, NOW + 25_000)).toEqual({ start: NOW, end: NOW + 20 * 60_000 });
    expect(bookingOf({ ...free, next: undefined }, 60, NOW)).toEqual({
      start: NOW,
      end: NOW + 3_600_000,
    });
    expect(bookingOf({ ...free, state: "booked" }, 30, NOW)).toBeUndefined();
    expect(bookingOf({ ...free, bookable: false }, 30, NOW)).toBeUndefined();
    expect(serviceTime(NOW)).toBe("2026-10-28T14:00:00+00:00");
  });
});
