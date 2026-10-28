import { afterEach, describe, expect, it } from "vitest";

import { firstPageOf, opensFirst } from "../src/components/choices-dialog";
import type { HomeAssistant } from "../src/ha/types";
import { en, fr } from "../src/i18n";
import { practicalEn, practicalFr } from "../src/i18n/practical";
import {
  NO_CHOICES,
  isPressed,
  pathOf,
  readChoices,
  readDeviceStart,
  routeOf,
  startTab,
  writeDeviceStart,
} from "../src/live/choices";

afterEach(() => {
  localStorage.clear();
});

describe("the tab DomoTwin opens on", () => {
  it("is this device's own, else the user's, else Home; never 3D where it cannot be drawn", () => {
    expect(startTab(NO_CHOICES, undefined, true)).toBe("home");
    expect(startTab({ ...NO_CHOICES, start: "3d" }, undefined, true)).toBe("3d");
    expect(startTab({ ...NO_CHOICES, start: "3d" }, "rooms", true)).toBe("rooms");
    expect(startTab({ ...NO_CHOICES, start: "3d" }, undefined, false)).toBe("home");
  });

  it("of this device is kept by its browser", () => {
    expect(readDeviceStart()).toBeUndefined();
    writeDeviceStart("rooms");
    expect(readDeviceStart()).toBe("rooms");
    localStorage.setItem("domotwin-start", "garden");
    expect(readDeviceStart()).toBeUndefined();
    writeDeviceStart(undefined);
    expect(localStorage.getItem("domotwin-start")).toBeNull();
  });
});

describe("Home Assistant's address", () => {
  it("names a tab, and a room of the Rooms tab", () => {
    expect(routeOf(undefined)).toEqual({});
    expect(routeOf("")).toEqual({});
    expect(routeOf("/3d")).toEqual({ tab: "3d" });
    expect(routeOf("/rooms")).toEqual({ tab: "rooms" });
    expect(routeOf("/rooms/living_room")).toEqual({ tab: "rooms", area: "living_room" });
    expect(routeOf("/home/extra")).toEqual({ tab: "home" });
    expect(routeOf("/garden")).toEqual({});
    expect(pathOf("rooms", "a b")).toBe("/rooms/a%20b");
    expect(routeOf(pathOf("rooms", "a b"))).toEqual({ tab: "rooms", area: "a b" });
    expect(pathOf("home", "ignored")).toBe("/home");
  });
});

describe("readChoices", () => {
  it("keeps what it understands", () => {
    expect(
      readChoices({
        favourites: ["light.a", 3, "scene.b"],
        start: "rooms",
        cards: [
          { type: "calendar", entities: ["calendar.family", 1] },
          { type: "calendar", entities: [] },
          { type: "todo-list", entity: "todo.shopping" },
          { type: "entities" },
          null,
        ],
      }),
    ).toEqual({
      favourites: ["light.a", "scene.b"],
      start: "rooms",
      cards: [
        { type: "calendar", entities: ["calendar.family"] },
        { type: "todo-list", entity: "todo.shopping" },
      ],
      shortcuts: [],
    });
    expect(readChoices({ start: "garden" })).toEqual({ favourites: [], cards: [], shortcuts: [] });
    expect(readChoices(null)).toEqual(NO_CHOICES);
  });

  it("shows scenes and scripts as big buttons", () => {
    expect(isPressed("scene.evening")).toBe(true);
    expect(isPressed("script.bedtime")).toBe(true);
    expect(isPressed("light.lamp")).toBe(false);
  });
});

describe("the page Home Assistant opens first", () => {
  const base = { demo: false } as unknown as HomeAssistant;

  it("is this device's in 2025.1, the user's where Home Assistant keeps it for them", () => {
    // 2025.1 has the user's data (`userData`) already; everyone's came later.
    const v2025 = { ...base, defaultPanel: "lovelace", userData: { showAdvanced: true } };
    expect(firstPageOf(v2025)).toBe("device");
    expect(firstPageOf({ ...v2025, systemData: null })).toBe("user");
    expect(firstPageOf(base)).toBeUndefined();
    expect(firstPageOf({ ...v2025, demo: true })).toBeUndefined();
    expect(opensFirst({ ...v2025, defaultPanel: "domotwin" }, "domotwin")).toBe(true);
    const later = { ...base, systemData: {}, userData: { default_panel: "domotwin" } };
    expect(opensFirst(later, "domotwin")).toBe(true);
    expect(opensFirst({ ...later, userData: {} }, "domotwin")).toBe(false);
  });
});

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("the tabs' messages", () => {
  it("have the same keys in both languages, none of them the dictionaries'", () => {
    expect(keys(practicalFr).sort()).toEqual(keys(practicalEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(practicalEn).filter((key) => main.has(key))).toEqual([]);
  });

  it("have the same placeholders in both languages", () => {
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(practicalEn)) {
      expect(placeholders(lookup(practicalFr, key)), key).toEqual(
        placeholders(lookup(practicalEn, key)),
      );
    }
  });
});
