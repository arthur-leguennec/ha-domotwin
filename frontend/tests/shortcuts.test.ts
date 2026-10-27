import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { Translator, addMessages } from "../src/i18n";
import { shortcutsEn, shortcutsFr } from "../src/i18n/shortcuts";
import { readChoices } from "../src/live/choices";
import {
  MAX_NAME,
  MAX_SHORTCUTS,
  candidates,
  carBatteries,
  changeShortcuts,
  clipName,
  firstSuggestions,
  newId,
  readShortcuts,
  runShortcut,
  shortcutCalls,
  shownState,
  suggestions,
  targets,
  type Shortcut,
} from "../src/live/shortcuts";

addMessages({ en: shortcutsEn, fr: shortcutsFr });

interface Thing {
  state: string;
  area?: string;
  device?: string;
  platform?: string;
  hidden?: boolean;
  attributes?: Record<string, unknown>;
}

/** A fictional home: two floors, three rooms. */
function home(things: Record<string, Thing>, extra: Partial<HomeAssistant> = {}): HomeAssistant {
  return {
    states: Object.fromEntries(
      Object.entries(things).map(([id, thing]) => [
        id,
        { entity_id: id, state: thing.state, attributes: thing.attributes ?? {} },
      ]),
    ),
    entities: Object.fromEntries(
      Object.entries(things).map(([id, thing]) => [
        id,
        {
          entity_id: id,
          area_id: thing.area ?? null,
          device_id: thing.device ?? null,
          ...(thing.platform ? { platform: thing.platform } : {}),
          ...(thing.hidden ? { hidden: true } : {}),
        },
      ]),
    ),
    devices: {
      car: { id: "car", name: "Family car" },
      phone: { id: "phone", name: "Pixel" },
    },
    areas: {
      living: { area_id: "living", name: "Living room", floor_id: "ground" },
      kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      bedroom: { area_id: "bedroom", name: "Bedroom", floor_id: "upstairs" },
    },
    floors: {
      ground: { floor_id: "ground", name: "Ground floor", level: 0 },
      upstairs: { floor_id: "upstairs", name: "Upstairs", level: 1 },
    },
    language: "en",
    config: { unit_system: { temperature: "°C" } },
    callService: vi.fn(() => Promise.resolve()),
    ...extra,
  } as unknown as HomeAssistant;
}

const blind = { device_class: "shutter", supported_features: 15 };

const HOUSE: Record<string, Thing> = {
  "light.sofa": { state: "on", area: "living" },
  "light.ceiling": { state: "off", area: "living" },
  "light.kitchen": { state: "on", area: "kitchen" },
  "light.bed": { state: "on", area: "bedroom" },
  "light.all": { state: "on", attributes: { entity_id: ["light.sofa", "light.kitchen"] } },
  "light.hidden": { state: "on", area: "living", hidden: true },
  "cover.living": { state: "open", area: "living", attributes: blind },
  "cover.garage": {
    state: "closed",
    attributes: { device_class: "garage", supported_features: 3 },
  },
  "lock.front": { state: "unlocked", area: "living" },
  "climate.living": {
    state: "heat",
    area: "living",
    // A target temperature and presets (`ClimateEntityFeature`).
    attributes: {
      preset_modes: ["eco", "comfort"],
      hvac_modes: ["off", "heat"],
      supported_features: 17,
    },
  },
  "climate.bedroom": {
    state: "off",
    area: "bedroom",
    attributes: { hvac_modes: ["off", "heat"], supported_features: 1 },
  },
  // A heat pump of a range only: no single temperature to set.
  "climate.heat_pump": {
    state: "heat_cool",
    attributes: { hvac_modes: ["off", "heat_cool"], supported_features: 2 },
  },
  "media_player.tv": { state: "playing", area: "living", attributes: { supported_features: 257 } },
  "vacuum.robot": {
    state: "docked",
    area: "kitchen",
    attributes: { supported_features: 8192 | 16 },
  },
  // Away and at home, no night arming.
  "alarm_control_panel.home": { state: "disarmed", attributes: { supported_features: 3 } },
  "scene.evening": { state: "unknown", attributes: { friendly_name: "Evening" } },
  "sensor.car_battery": {
    state: "78",
    device: "car",
    platform: "renault",
    attributes: { device_class: "battery", unit_of_measurement: "%" },
  },
  "sensor.phone_battery": {
    state: "40",
    device: "phone",
    attributes: { device_class: "battery", unit_of_measurement: "%" },
  },
};

const en = new Translator("en");

describe("shortcuts (D-084)", () => {
  it("reads what the integration keeps, leaving out what it cannot understand", () => {
    const read = readShortcuts([
      { id: "a1", name: "Off", icon: "lights_off", steps: [{ kind: "lights", do: "off" }] },
      // Twice the same id, a kind and a deed unknown, nothing to do or show.
      { id: "a1", name: "Again", icon: "lights_off", steps: [{ kind: "lights", do: "off" }] },
      { id: "b", name: "Fly", icon: "rocket", steps: [{ kind: "rockets", do: "go" }] },
      { id: "c", name: "Nothing", icon: "home", steps: [{ kind: "locks", do: "fly" }] },
      // A run step without what it runs is left out; the shortcut keeps what it shows.
      {
        id: "d",
        name: "Car",
        icon: "car",
        steps: [{ kind: "run", do: "run" }],
        show: "sensor.car_battery",
        confirm: true,
      },
      { id: "Bad id", name: "x", icon: "home", steps: [{ kind: "locks", do: "lock" }] },
      // A number out of its range, a position without one: those steps are left out.
      {
        id: "e",
        name: "Numbers",
        icon: "home",
        steps: [
          { kind: "lights", do: "on", value: 500 },
          { kind: "covers", do: "position" },
          { kind: "lights", do: "on" },
          { kind: "locks", do: "lock", value: 3 },
        ],
      },
    ]);
    expect(read.map((s) => s.id)).toEqual(["a1", "d", "e"]);
    expect(read[2]?.steps).toEqual([
      { kind: "lights", do: "on" },
      { kind: "locks", do: "lock" },
    ]);
    expect(read[1]).toEqual({
      id: "d",
      name: "Car",
      icon: "car",
      steps: [],
      show: "sensor.car_battery",
      confirm: true,
    });
    expect(readShortcuts("nope")).toEqual([]);
    // Kept with the user's other choices, read by the Home tab.
    expect(readShortcuts(readChoices({ shortcuts: [read[0], "x"] }).shortcuts)).toEqual([read[0]]);
    const many = Array.from({ length: MAX_SHORTCUTS + 3 }, (_, n) => ({
      id: `s${n}`,
      name: "Lock",
      icon: "lock",
      steps: [{ kind: "locks", do: "lock" }],
    }));
    expect(readShortcuts(many)).toHaveLength(MAX_SHORTCUTS);
  });

  it("acts on what is in its place, what is left out and what may not be used aside", () => {
    const hass = home(HOUSE);
    // The lamps of the home: no group, no hidden one.
    expect(targets(hass, { kind: "lights", do: "off" })).toEqual([
      "light.bed",
      "light.ceiling",
      "light.kitchen",
      "light.sofa",
    ]);
    expect(targets(hass, { kind: "lights", do: "off", floor: "ground" })).toEqual([
      "light.ceiling",
      "light.kitchen",
      "light.sofa",
    ]);
    expect(
      targets(hass, { kind: "lights", do: "off", area: "living", except: ["light.ceiling"] }),
    ).toEqual(["light.sofa"]);
    expect(
      targets(hass, { kind: "lights", do: "off", entities: ["light.bed", "cover.living"] }),
    ).toEqual(["light.bed"]);
    // Blinds, never the garage door; eco where a thermostat has it.
    expect(targets(hass, { kind: "covers", do: "close" })).toEqual(["cover.living"]);
    expect(targets(hass, { kind: "climate", do: "eco" })).toEqual(["climate.living"]);
    // The viewer's rights (D-071), and what they may not see (D-039).
    const limited = home(HOUSE, { canAct: (id: string) => id !== "light.bed" });
    expect(targets(limited, { kind: "lights", do: "off" })).not.toContain("light.bed");
    const unseen = { areas: new Set(["kitchen"]), entities: new Set<string>() };
    expect(targets(hass, { kind: "lights", do: "off" }, unseen)).not.toContain("light.kitchen");
  });

  it("calls Home Assistant's services, step after step", async () => {
    const hass = home(HOUSE);
    const night: Shortcut = {
      id: "night",
      name: "Good night",
      icon: "moon",
      steps: [
        { kind: "lights", do: "off", floor: "ground" },
        { kind: "covers", do: "position", value: 140 },
        { kind: "locks", do: "lock" },
        { kind: "climate", do: "temperature", value: 18 },
        { kind: "media", do: "pause" },
        { kind: "run", do: "run", entities: ["scene.evening"] },
      ],
    };
    expect(shortcutCalls(hass, night)).toEqual([
      ["light", "turn_off", {}, ["light.ceiling", "light.kitchen", "light.sofa"]],
      ["cover", "set_cover_position", { position: 100 }, ["cover.living"]],
      ["lock", "lock", {}, ["lock.front"]],
      ["climate", "set_temperature", { temperature: 18 }, ["climate.bedroom", "climate.living"]],
      ["media_player", "media_pause", {}, ["media_player.tv"]],
      ["scene", "turn_on", {}, ["scene.evening"]],
    ]);
    // Switched on or off together: on while all are off, else off.
    expect(
      shortcutCalls(hass, {
        ...night,
        steps: [{ kind: "lights", do: "toggle", area: "living" }],
      }),
    ).toEqual([["light", "turn_off", {}, ["light.ceiling", "light.sofa"]]]);
    expect(
      shortcutCalls(hass, {
        ...night,
        steps: [{ kind: "lights", do: "on", area: "living", value: 30 }],
      }),
    ).toEqual([["light", "turn_on", { brightness_pct: 30 }, ["light.ceiling", "light.sofa"]]]);
    // One refused does not stop the others.
    let calls = 0;
    const refusing = home(HOUSE, {
      callService: vi.fn(() => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error("no")) : Promise.resolve();
      }),
    });
    const ran = await runShortcut(refusing, night);
    expect(ran.done).toBe(5);
    expect(ran.failures).toHaveLength(1);
    // Nothing in its place: nothing called.
    const empty = await runShortcut(hass, {
      ...night,
      steps: [{ kind: "lights", do: "off", area: "garage" }],
    });
    expect(empty).toEqual({ done: 0, failures: [] });
  });

  it("says how many are on, open or unlocked, or what a value is", () => {
    const hass = home(HOUSE);
    const lights: Shortcut = {
      id: "l",
      name: "Lights",
      icon: "lights_off",
      steps: [{ kind: "lights", do: "off" }],
    };
    expect(shownState(hass, lights)).toEqual({
      count: "shortcuts.state.lights",
      n: 3,
      active: true,
    });
    const quietHome = home({ ...HOUSE, "light.sofa": { state: "off", area: "living" } });
    expect(
      shownState(quietHome, { ...lights, steps: [{ kind: "lights", do: "off", area: "living" }] }),
    ).toEqual({ key: "shortcuts.state.lights_none", active: false });
    expect(shownState(hass, { ...lights, steps: [{ kind: "locks", do: "lock" }] })).toEqual({
      count: "shortcuts.state.locks",
      n: 1,
      active: true,
    });
    // A value, as Home Assistant says it.
    expect(shownState(hass, { ...lights, steps: [], show: "sensor.car_battery" })).toEqual({
      text: "78 %",
      active: false,
    });
    expect(shownState(hass, { ...lights, quiet: true })).toBeUndefined();
    expect(
      shownState(hass, {
        ...lights,
        steps: [{ kind: "run", do: "run", entities: ["scene.evening"] }],
      }),
    ).toBeUndefined();
  });

  it("suggests what the home has, in the viewer's words, not twice", () => {
    const hass = home(HOUSE);
    const all = suggestions(hass, en);
    const keys = all.map((s) => s.key);
    expect(keys).toEqual([
      "lights_off",
      "lights_off:ground",
      "lights_off:upstairs",
      "good_night",
      "leaving",
      "covers_close",
      "covers_open",
      "locks_lock",
      "alarm_away",
      "climate_eco",
      "climate_temperature",
      "battery:sensor.car_battery",
      "media_pause",
      "vacuum_start",
      "run:scene.evening",
    ]);
    const night = all.find((s) => s.key === "good_night");
    // The alarm cannot be armed for the night: not in it.
    expect(night?.shortcut.steps.map((s) => s.kind)).toEqual(["lights", "covers", "locks"]);
    expect(all.find((s) => s.key === "lights_off:ground")?.shortcut.name).toBe(
      "Lights off: Ground floor",
    );
    expect(all.find((s) => s.key === "battery:sensor.car_battery")?.shortcut).toMatchObject({
      name: "Family car: battery",
      show: "sensor.car_battery",
    });
    expect(all.find((s) => s.key === "climate_temperature")?.shortcut.name).toBe(
      "Heating at 19 °C",
    );
    // Leaving asks first.
    expect(all.find((s) => s.key === "leaving")?.shortcut.confirm).toBe(true);
    // In French.
    const fr = suggestions(hass, new Translator("fr"));
    expect(fr[0]?.shortcut.name).toBe("Éteindre toutes les lumières");
    // Added: not suggested again.
    const added = all[0];
    if (!added) throw new Error("no suggestion");
    const after = suggestions(hass, en, [{ ...added.shortcut, id: "x" }]);
    expect(after.map((s) => s.key)).not.toContain("lights_off");
    // The first three, one of each kind.
    expect(firstSuggestions(all).map((s) => s.key)).toEqual([
      "lights_off",
      "good_night",
      "covers_close",
    ]);
  });

  it("acts only on what can do it", () => {
    const hass = home(HOUSE);
    // The heat pump keeps a range: no single temperature for it.
    expect(targets(hass, { kind: "climate", do: "temperature" })).toEqual([
      "climate.bedroom",
      "climate.living",
    ]);
    expect(targets(hass, { kind: "climate", do: "heat" })).toEqual([
      "climate.bedroom",
      "climate.living",
    ]);
    expect(targets(hass, { kind: "vacuum", do: "start" })).toEqual(["vacuum.robot"]);
    expect(targets(hass, { kind: "alarm", do: "arm_night" })).toEqual([]);
    expect(targets(hass, { kind: "alarm", do: "arm_away" })).toEqual(["alarm_control_panel.home"]);
    // A robot without a dock, an alarm that wants a code, a TV that cannot pause.
    const other = home({
      ...HOUSE,
      "vacuum.robot": { state: "docked", attributes: { supported_features: 8192 } },
      "alarm_control_panel.home": {
        state: "disarmed",
        attributes: { supported_features: 3, code_arm_required: true },
      },
      "media_player.tv": { state: "playing", attributes: { supported_features: 256 } },
    });
    expect(targets(other, { kind: "vacuum", do: "dock" })).toEqual([]);
    expect(targets(other, { kind: "alarm", do: "arm_away" })).toEqual([]);
    expect(targets(other, { kind: "media", do: "pause" })).toEqual([]);
    expect(targets(other, { kind: "media", do: "off" })).toEqual(["media_player.tv"]);
    // A window or a skylight is not a shutter; a lock that asks for a code is left alone.
    const windows = home({
      ...HOUSE,
      "cover.skylight": {
        state: "closed",
        area: "bedroom",
        attributes: { device_class: "window", supported_features: 15 },
      },
      "lock.back": { state: "unlocked", attributes: { code_format: "^\\d{4}$" } },
    });
    expect(targets(windows, { kind: "covers", do: "open" })).toEqual(["cover.living"]);
    expect(targets(windows, { kind: "locks", do: "lock" })).toEqual(["lock.front"]);
    const keys = suggestions(other, en).map((s) => s.key);
    expect(keys).not.toContain("alarm_away");
    expect(keys).not.toContain("media_pause");
    expect(keys).toContain("media_off");
  });

  it("cuts a long name where the integration does, never in a character", () => {
    const long = `${"🚗".repeat(MAX_NAME - 1)}ab`;
    expect(Array.from(clipName(long))).toHaveLength(MAX_NAME);
    expect(clipName(long).endsWith("a")).toBe(true);
    expect(clipName("Car")).toBe("Car");
    // A family (five code points) or a flag (two) is kept whole, or left out whole.
    const family = "👩‍👩‍👧";
    expect(clipName(`${"a".repeat(MAX_NAME - 2)}${family}`)).toBe("a".repeat(MAX_NAME - 2));
    expect(clipName(`${"a".repeat(MAX_NAME - 1)}🇫🇷`)).toBe("a".repeat(MAX_NAME - 1));
    expect(clipName(`${"a".repeat(MAX_NAME - 2)}🇫🇷b`)).toBe(`${"a".repeat(MAX_NAME - 2)}🇫🇷`);
    const hass = home({
      ...HOUSE,
      "sensor.long_car_battery": {
        state: "60",
        platform: "tesla",
        attributes: {
          device_class: "battery",
          unit_of_measurement: "%",
          friendly_name: "A".repeat(60),
        },
      },
    });
    for (const suggestion of suggestions(hass, en)) {
      expect(Array.from(suggestion.shortcut.name).length).toBeLessThanOrEqual(MAX_NAME);
    }
  });

  it("finds a car's battery by its integration or its name, one per car", () => {
    const hass = home({
      ...HOUSE,
      "sensor.voiture_batterie": {
        state: "55",
        attributes: {
          device_class: "battery",
          unit_of_measurement: "%",
          friendly_name: "Voiture batterie",
        },
      },
    });
    expect(carBatteries(hass)).toEqual([
      { entity: "sensor.car_battery", name: "Family car" },
      { entity: "sensor.voiture_batterie", name: "Voiture batterie" },
    ]);
    // Never a phone, whatever it is called; never a bicycle nor a garage.
    const battery = { device_class: "battery", unit_of_measurement: "%" };
    const others = home({
      "sensor.zoe_phone_battery": {
        state: "40",
        platform: "mobile_app",
        attributes: { ...battery, friendly_name: "Zoe's car phone battery" },
      },
      "sensor.bike_battery": {
        state: "70",
        attributes: { ...battery, friendly_name: "自転車 バッテリー" },
      },
      "sensor.zoe_battery": { state: "70", attributes: { ...battery, friendly_name: "Zoe" } },
    });
    expect(carBatteries(others)).toEqual([]);
  });

  it("makes one change at a time, as the integration does", () => {
    const a: Shortcut = {
      id: "a",
      name: "A",
      icon: "lock",
      steps: [{ kind: "locks", do: "lock" }],
    };
    const b: Shortcut = { ...a, id: "b", name: "B" };
    const c: Shortcut = { ...a, id: "c", name: "C" };
    expect(changeShortcuts([a, b], { set: c }).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(changeShortcuts([a, b], { set: { ...a, name: "Z" } })[0]?.name).toBe("Z");
    expect(changeShortcuts([a, b, c], { remove: "b" }).map((s) => s.id)).toEqual(["a", "c"]);
    expect(changeShortcuts([a, b, c], { move: "c", by: -1 }).map((s) => s.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(changeShortcuts([a, b], { move: "a", by: -1 }).map((s) => s.id)).toEqual(["a", "b"]);
    expect(changeShortcuts([a, b], { move: "x", by: 1 }).map((s) => s.id)).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_SHORTCUTS }, (_, n) => ({ ...a, id: `s${n}` }));
    expect(changeShortcuts(full, { set: c })).toHaveLength(MAX_SHORTCUTS);
  });

  it("works out each kind's devices once for each of Home Assistant's states", () => {
    const hass = home(HOUSE);
    const first = candidates(hass, "lights");
    expect(candidates(hass, "lights")).toBe(first);
    const later = { ...hass, states: { ...hass.states } };
    expect(candidates(later, "lights")).not.toBe(first);
    expect(candidates(later, "lights")).toEqual(first);
  });

  it("makes ids none of the others has", () => {
    const values = [0.1, 0.1, 0.2];
    const random = () => values.shift() ?? 0.3;
    const first = newId([], random);
    expect(first).toMatch(/^[a-z0-9]{8}$/);
    expect(newId([first], random)).not.toBe(first);
  });
});
