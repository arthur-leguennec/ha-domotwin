import { describe, expect, it, vi } from "vitest";

import { DomoTwinClient, type StoredPlan } from "../src/ha/client";
import type { HassEntity } from "../src/ha/types";
import {
  appliancesAt,
  at,
  batteryAt,
  flowsAt,
  solarAt,
  sunAt,
  vacuumAt,
  wantedAt,
  weatherAt,
  whereAt,
} from "../src/demo/day";
import { DemoHome } from "../src/demo/home";
import { STOREYS, THINGS, demoBindings } from "../src/demo/house";
import { callService } from "../src/demo/services";

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: id, state, attributes, last_changed: "", last_updated: "" };
}

describe("the demo house's day (D-050)", () => {
  it("has a sun that rises, culminates and sets, and panels that follow it", () => {
    expect(sunAt(at(6, 0)).elevation).toBeLessThan(0);
    expect(sunAt(at(8, 0)).elevation).toBeGreaterThan(5);
    expect(sunAt(at(13, 20)).elevation).toBeGreaterThan(47);
    expect(sunAt(at(21, 0)).elevation).toBeLessThan(0);
    expect(sunAt(at(9, 0)).rising).toBe(true);
    expect(sunAt(at(16, 0)).rising).toBe(false);
    expect(solarAt(at(2, 0))).toBe(0);
    expect(solarAt(at(13, 0))).toBeGreaterThan(2500);
    expect(solarAt(at(13, 0))).toBeLessThanOrEqual(5000);
  });

  it("has a fine day with a storm at three, the panels darker under it (D-071)", () => {
    expect(weatherAt(at(2, 0)).condition).toBe("clear-night");
    expect(weatherAt(at(9, 0)).condition).toBe("sunny");
    expect(weatherAt(at(15, 10)).condition).toBe("rainy");
    expect(weatherAt(at(15, 40))).toEqual({ condition: "lightning-rainy", wind: 32, bearing: 225 });
    expect(weatherAt(at(21, 0)).condition).toBe("clear-night");
    expect(solarAt(at(15, 40))).toBeLessThan(solarAt(at(14, 0)) / 3);
  });

  it("has a family that leaves and comes back, a robot that cleans while they are out", () => {
    expect(whereAt("person.robin", at(3, 0)).room).toBe("u-children");
    expect(whereAt("person.robin", at(10, 0)).room).toBeNull();
    expect(whereAt("person.robin", at(17, 30))).toEqual({ room: "u-playroom", since: at(17, 0) });
    expect(whereAt("person.sam", at(10, 0)).room).toBe("office");
    expect(vacuumAt(at(9, 30))).toBe("cleaning");
    expect(vacuumAt(at(10, 22))).toBe("returning");
    expect(vacuumAt(at(12, 0))).toBe("docked");
    expect(appliancesAt(at(8, 20)).washer).toBeGreaterThan(1500);
    expect(appliancesAt(at(19, 2)).oven).toBeGreaterThan(0);
  });

  it("lights the evening and puts the house to bed", () => {
    const evening = wantedAt(at(21, 0));
    expect(evening.get("light.living_floor_lamp")).toEqual({
      state: "on",
      automation: "automation.evening_lights",
    });
    expect(evening.get("media_player.living_tv")?.state).toBe("playing");
    expect(evening.get("cover.living_curtains")?.state).toBe("closed");
    const night = wantedAt(at(23, 30));
    expect(night.get("light.living_floor_lamp")?.state).toBe("off");
    expect(night.get("lock.front_door")?.state).toBe("locked");
    expect(night.get("climate.bedroom")?.attributes).toEqual({ temperature: 18 });
  });

  it("charges the battery with the sun's surplus and draws it at night", () => {
    expect(flowsAt(3000, 1000, 50)).toEqual({ battery: -2000, grid: 0 });
    expect(flowsAt(6000, 1000, 50)).toEqual({ battery: -3000, grid: -2000 });
    expect(flowsAt(0, 800, 50)).toEqual({ battery: 800, grid: 0 });
    // Kept above its reserve, full once full.
    expect(flowsAt(0, 800, 10)).toEqual({ battery: 0, grid: 800 });
    expect(flowsAt(3000, 1000, 100)).toEqual({ battery: 0, grid: -2000 });
    expect(batteryAt(at(16, 0))).toBeGreaterThan(batteryAt(at(8, 0)));
    for (const minute of [0, at(6, 0), at(12, 0), at(23, 59)]) {
      const level = batteryAt(minute);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(100);
    }
  });
});

describe("the demo house's services (D-050)", () => {
  it("gives a fan a speed while on, none while off", () => {
    const states: Record<string, HassEntity | undefined> = {
      "fan.a": entity("fan.a", "off", { percentage: 0 }),
    };
    callService(states, "homeassistant", "toggle", {}, { entity_id: "fan.a" });
    expect(states["fan.a"]).toMatchObject({ state: "on", attributes: { percentage: 50 } });
    callService(states, "fan", "turn_off", {}, { entity_id: "fan.a" });
    expect(states["fan.a"]).toMatchObject({ state: "off", attributes: { percentage: 0 } });
  });

  it("gives a lamp a white or a colour in place of the one before", () => {
    const states: Record<string, HassEntity | undefined> = {
      "light.a": entity("light.a", "on", { rgb_color: [255, 0, 0], hs_color: [0, 100] }),
    };
    callService(states, "light", "turn_on", { color_temp_kelvin: 6500 }, { entity_id: "light.a" });
    expect(states["light.a"]?.attributes).toMatchObject({ color_temp_kelvin: 6500 });
    expect(states["light.a"]?.attributes.rgb_color).toBeUndefined();
    callService(states, "light", "turn_on", { rgb_color: [0, 0, 255] }, { entity_id: "light.a" });
    expect(states["light.a"]?.attributes.rgb_color).toEqual([0, 0, 255]);
    expect(states["light.a"]?.attributes.color_temp_kelvin).toBeUndefined();
  });

  it("switch, dim, open, lock, play and send the robot", () => {
    const states: Record<string, HassEntity | undefined> = {
      "light.a": entity("light.a", "off"),
      "light.b": entity("light.b", "on", { brightness: 255 }),
      "cover.c": entity("cover.c", "closed", { current_position: 0 }),
      "lock.d": entity("lock.d", "locked"),
      "media_player.e": entity("media_player.e", "playing", { volume_level: 0.3 }),
      "vacuum.f": entity("vacuum.f", "docked"),
    };
    expect(callService(states, "light", "toggle", {}, { entity_id: "light.a" })).toEqual([
      "light.a",
    ]);
    expect(states["light.a"]?.state).toBe("on");
    callService(states, "light", "turn_on", { brightness_pct: 40 }, { entity_id: "light.b" });
    expect(states["light.b"]?.attributes.brightness).toBe(102);
    callService(states, "cover", "set_cover_position", { position: 30 }, { entity_id: "cover.c" });
    expect(states["cover.c"]).toMatchObject({
      state: "open",
      attributes: { current_position: 30 },
    });
    callService(states, "lock", "unlock", {}, { entity_id: "lock.d" });
    callService(states, "media_player", "volume_up", {}, { entity_id: "media_player.e" });
    callService(states, "vacuum", "start", {}, { entity_id: "vacuum.f" });
    expect([states["lock.d"]?.state, states["vacuum.f"]?.state]).toEqual(["unlocked", "cleaning"]);
    expect(states["media_player.e"]?.attributes.volume_level).toBe(0.35);
    // A whole area, any domain through `homeassistant`.
    const area = (id: string): string | undefined => (id.startsWith("light.") ? "x" : undefined);
    expect(
      callService(states, "homeassistant", "turn_off", {}, { area_id: "x" }, area).sort(),
    ).toEqual(["light.a", "light.b"]);
    // Nothing for what is not known.
    expect(callService(states, "light", "turn_on", {}, { entity_id: "light.none" })).toEqual([]);
  });
});

describe("the demo house (D-050)", () => {
  it("links every piece it names to the plans, and every room to its area", () => {
    const bindings = demoBindings();
    const ids = new Set(
      STOREYS.flatMap((s) =>
        ["rooms", "doors", "windows", "items"].flatMap((key) =>
          ((s.plan[key] ?? []) as { id: string }[]).map((e) => e.id),
        ),
      ),
    );
    for (const piece of Object.keys(bindings.elements)) expect(ids).toContain(piece);
    for (const room of Object.keys(bindings.rooms)) expect(ids).toContain(room);
    // Every entity's id is one Home Assistant takes.
    for (const thing of THINGS) expect(thing.id).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
  });

  it("answers the panel's commands from memory, in the visitor's language", async () => {
    const home = new DemoHome({ language: "fr" });
    const client = DomoTwinClient.for(home.hass);
    const plan: StoredPlan = await client.getPlan();
    expect(plan.storey).toBe("ground");
    expect(plan.storeys.map((s) => s.name)).toEqual(["Rez-de-chaussée", "Étage"]);
    const rooms = (plan.plan?.rooms ?? []) as { id: string; name: string }[];
    expect(rooms.find((r) => r.id === "living")?.name).toBe("Salon");
    expect(home.hass.states["light.living_floor_lamp"]?.attributes.friendly_name).toBe(
      "Lampadaire",
    );
    const settings = await client.getSettings();
    expect(settings.settings.energy?.solar).toBe("sensor.solar_power");
    // What it does not have, it says so.
    await expect(
      home.hass.connection.sendMessagePromise({ type: "zha/devices" }),
    ).rejects.toMatchObject({ code: "unknown_command" });
    home.stop();
  });

  it("lives its day, keeping what the visitor changes until the day changes it", () => {
    const home = new DemoHome({ language: "en" });
    const seen: number[] = [];
    home.subscribe(() => seen.push(home.minute));
    home.jump(at(20, 58));
    const state = (id: string): string | undefined => home.hass.states[id]?.state;
    expect(state("light.living_floor_lamp")).toBe("on");
    expect(state("vacuum.robot")).toBe("docked");
    expect(home.hass.states["sensor.domotwin_alex_room"]?.attributes.room_id).toBe("living");
    // The visitor switches the lamp off: it stays off while the evening goes on.
    void home.hass.callService("light", "turn_off", {}, { entity_id: "light.living_floor_lamp" });
    expect(state("light.living_floor_lamp")).toBe("off");
    home.advance(10);
    expect(state("light.living_floor_lamp")).toBe("off");
    expect(seen.length).toBeGreaterThan(1);
    // The morning: the robot goes out, its automation runs.
    home.jump(at(8, 58));
    const before = home.hass.states["automation.clean_when_quiet"]?.attributes.last_triggered;
    home.advance(3);
    expect(state("vacuum.robot")).toBe("cleaning");
    const after = home.hass.states["automation.clean_when_quiet"]?.attributes.last_triggered;
    expect(after).not.toBe(before);
    // The energy adds up: what comes in is what goes out.
    const number = (id: string): number => Number(state(id));
    expect(number("sensor.solar_power")).toBeGreaterThan(0);
    expect(number("sensor.battery_level")).toBeGreaterThan(0);
    home.stop();
  });

  it("keeps the day's cleaning to its end, a run by hand to three quarters of an hour", () => {
    const home = new DemoHome({ language: "en" });
    const state = (id: string): string | undefined => home.hass.states[id]?.state;
    home.jump(at(8, 58));
    home.advance(80);
    expect(state("vacuum.robot")).toBe("cleaning");
    const battery = Number(state("sensor.robot_battery"));
    expect(battery).toBeLessThan(100);
    home.advance(30);
    expect(state("vacuum.robot")).toBe("docked");
    // Sent out by hand in the afternoon: home again by itself.
    home.jump(at(14, 0));
    void home.hass.callService("vacuum", "start", {}, { entity_id: "vacuum.robot" });
    home.advance(46);
    expect(state("vacuum.robot")).toBe("returning");
    home.advance(7);
    expect(state("vacuum.robot")).toBe("docked");
    home.stop();
  });

  it("credits each change to the automation that makes it, and the TV draws as it plays", () => {
    const home = new DemoHome({ language: "en" });
    const ran = (id: string): unknown => home.hass.states[id]?.attributes.last_triggered;
    home.jump(at(7, 28));
    home.advance(3);
    expect(home.hass.states["cover.living_curtains"]?.state).toBe("open");
    expect(ran("automation.morning_curtains")).not.toBeNull();
    expect(ran("automation.evening_lights")).toBeNull();
    home.jump(at(20, 0));
    home.advance(10);
    expect(Number(home.hass.states["sensor.tv_power"]?.state)).toBeGreaterThan(50);
    void home.hass.callService(
      "media_player",
      "turn_off",
      {},
      {
        entity_id: "media_player.living_tv",
      },
    );
    home.advance(1);
    expect(Number(home.hass.states["sensor.tv_power"]?.state)).toBeLessThan(1);
    home.stop();
  });

  it("tells its own time, refuses a storey it has not, and does actions later on its clock", async () => {
    const home = new DemoHome({ language: "en" });
    home.jump(at(12, 0));
    expect(new Date(home.hass.now?.() ?? 0).getHours()).toBe(12);
    const client = DomoTwinClient.for(home.hass);
    await expect(client.getPlan("storey-9")).rejects.toMatchObject({ code: "unknown_storey" });
    // Curtains too, as the integration does them.
    await client.addSchedule({ entities: ["cover.living_curtains"], at: "12:05", action: "off" });
    home.advance(6);
    expect(home.hass.states["cover.living_curtains"]?.state).toBe("closed");
    home.stop();
  });

  it("checks actions to do later as the integration does", async () => {
    const home = new DemoHome({ language: "en" });
    home.jump(at(0, 30));
    const client = DomoTwinClient.for(home.hass);
    const refused = (request: Parameters<typeof client.addSchedule>[0]) =>
      expect(client.addSchedule(request)).rejects;
    await refused({ entities: ["light.nowhere"], at: "01:00" }).toMatchObject({
      code: "unknown_entity",
    });
    await refused({
      entities: ["light.wc"],
      at: "01:00",
      action: "off",
      duration: 60,
    }).toMatchObject({ code: "off_with_end" });
    // An end at a time of day is the first after the start: 23:00 to 01:00 the next day.
    const { schedule } = await client.addSchedule({
      entities: ["light.wc"],
      at: "23:00",
      until: "01:00",
    });
    expect(Date.parse(schedule.until ?? "") - Date.parse(schedule.at)).toBe(2 * 3_600_000);
    home.stop();
  });

  it("holds its day while away, as the visitor left it", () => {
    vi.useFakeTimers();
    try {
      const home = new DemoHome({ language: "en" });
      home.play(true);
      home.away(true);
      vi.advanceTimersByTime(5000);
      expect(home.minute).toBe(at(8, 56));
      home.away(false);
      vi.advanceTimersByTime(3000);
      expect(home.minute).toBe(at(8, 59));
      // Held by the visitor, it stays held when they come back.
      home.play(false);
      home.away(true);
      home.away(false);
      vi.advanceTimersByTime(3000);
      expect(home.minute).toBe(at(8, 59));
      home.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does actions later on its own clock", async () => {
    const home = new DemoHome({ language: "en" });
    home.jump(at(12, 0));
    const client = DomoTwinClient.for(home.hass);
    await expect(
      client.addSchedule({ entities: ["light.office_ceiling"], at: "12:05", duration: 600 }),
    ).resolves.toMatchObject({ schedule: { entities: ["light.office_ceiling"] } });
    await expect(
      client.addSchedule({ entities: ["lock.front_door"], at: "12:05" }),
    ).rejects.toMatchObject({
      code: "not_schedulable",
    });
    home.advance(6);
    expect(home.hass.states["light.office_ceiling"]?.state).toBe("on");
    home.advance(10);
    expect(home.hass.states["light.office_ceiling"]?.state).toBe("off");
    home.stop();
  });
});

describe("the demo house put back after a measure (D-053)", () => {
  it("keeps its moment, its clock and what the visitor changed", () => {
    const home = new DemoHome({ language: "en" });
    home.play(true);
    void home.hass.callService("light", "turn_off", {}, { entity_id: "light.living_floor_lamp" });
    const before = home.snapshot();
    const minute = home.minute;
    const today = home.today();
    const lamp = structuredClone(home.hass.states["light.living_floor_lamp"]);
    home.play(false);
    home.jump(19 * 60 + 40);
    void home.hass.callService(
      "light",
      "turn_on",
      { brightness_pct: 20 },
      { entity_id: "light.living_pendant" },
    );
    home.restore(before);
    expect(home.minute).toBe(minute);
    expect(home.today()).toBe(today);
    expect(home.playing).toBe(true);
    expect(home.hass.states["light.living_floor_lamp"]).toEqual(lamp);
    expect(home.hass.states["light.living_pendant"]).toEqual(before.states["light.living_pendant"]);
    home.stop();
  });
});
