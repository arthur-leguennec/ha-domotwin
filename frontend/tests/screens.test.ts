import { describe, expect, it } from "vitest";

import { drift } from "../src/components/saver";
import { folderName, freeName, layoutOf } from "../src/components/screens-dialog";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { practicalEn, practicalFr } from "../src/i18n/practical";
import { wallEn, wallFr } from "../src/i18n/wall";
import { readMediaFolder, shuffled } from "../src/live/media";
import {
  NO_SAVER,
  isNight,
  readSaver,
  readScreens,
  saverDue,
  screenNamed,
  someoneThere,
  wakeSensors,
} from "../src/live/screens";

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: id, state, attributes } as HassEntity;
}

function hassWith(...entities: HassEntity[]): HomeAssistant {
  return {
    states: Object.fromEntries(entities.map((e) => [e.entity_id, e])),
    language: "en",
  } as unknown as HomeAssistant;
}

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("the wall screens (D-076)", () => {
  it("reads the screens as the integration keeps them, what is not understood left out", () => {
    const screens = readScreens({
      screens: {
        hall: {
          start: "safety",
          saver: {
            after: 5,
            wake: ["binary_sensor.hall_motion", "light.hall", "binary_sensor.hall_motion"],
            weather: false,
            photos: "media-source://media_source/local/holidays",
            every: 20,
            dim: false,
          },
        },
        kitchen: { start: "garden", saver: { after: -3, every: 1, photos: "/media/x" } },
        "the attic": {},
        porch: "nothing",
      },
    });
    expect(screens).toEqual({
      hall: {
        start: "safety",
        saver: {
          after: 5,
          wake: ["binary_sensor.hall_motion"],
          weather: false,
          photos: "media-source://media_source/local/holidays",
          every: 20,
          dim: false,
        },
      },
      kitchen: { saver: { ...NO_SAVER, wake: [] } },
    });
    expect(readScreens(null)).toEqual({});
    expect(readSaver(undefined)).toEqual(NO_SAVER);
    // Names match whatever their case.
    expect(screenNamed(screens, "HALL")).toBe("hall");
    expect(screenNamed(screens, "attic")).toBeUndefined();
    expect(screenNamed(screens, undefined)).toBeUndefined();
  });

  it("comes once quiet long enough, never when it is set to", () => {
    const saver = { ...NO_SAVER, after: 2 };
    expect(saverDue(saver, 0, 119_999)).toBe(false);
    expect(saverDue(saver, 0, 120_000)).toBe(true);
    expect(saverDue({ ...saver, after: 0 }, 0, 10_000_000)).toBe(false);
    expect(saverDue(undefined, 0, 10_000_000)).toBe(false);
  });

  it("is woken by motion, occupancy and presence sensors; dims when the sun is down", () => {
    const hass = hassWith(
      entity("binary_sensor.hall_motion", "off", { device_class: "motion", friendly_name: "Hall" }),
      entity("binary_sensor.desk", "on", { device_class: "occupancy", friendly_name: "Desk" }),
      entity("binary_sensor.door", "on", { device_class: "door" }),
      entity("sensor.hall_motion", "on", { device_class: "motion" }),
      entity("sun.sun", "below_horizon"),
    );
    expect(wakeSensors(hass)).toEqual(["binary_sensor.desk", "binary_sensor.hall_motion"]);
    expect(someoneThere(hass, ["binary_sensor.hall_motion"])).toBe(false);
    expect(someoneThere(hass, ["binary_sensor.hall_motion", "binary_sensor.desk"])).toBe(true);
    expect(someoneThere(undefined, ["binary_sensor.desk"])).toBe(false);
    expect(isNight(hass)).toBe(true);
    expect(isNight(hassWith(entity("sun.sun", "above_horizon")))).toBe(false);
  });

  it("reads a folder of Home Assistant's media: its folders and its photos", () => {
    const folder = readMediaFolder({
      title: "holidays",
      children: [
        {
          title: "2025",
          media_content_id: "media-source://media_source/local/h/2025",
          can_expand: true,
        },
        {
          title: "a.jpg",
          media_class: "image",
          media_content_id: "media-source://media_source/local/h/a.jpg",
        },
        {
          title: "b.png",
          media_content_type: "image/png",
          media_content_id: "media-source://x/b.png",
        },
        { title: "song.mp3", media_class: "music", media_content_id: "media-source://x/song.mp3" },
        { title: "elsewhere", media_class: "image", media_content_id: "/local/c.jpg" },
        "nothing",
      ],
    });
    expect(folder.title).toBe("holidays");
    expect(folder.folders.map((f) => f.title)).toEqual(["2025"]);
    expect(folder.photos.map((p) => p.title)).toEqual(["a.jpg", "b.png"]);
    expect(readMediaFolder(undefined)).toEqual({ title: "", folders: [], photos: [] });
  });

  it("shows the photos in another order, every one once", () => {
    const items = [1, 2, 3, 4, 5];
    let seed = 0.3;
    const order = shuffled(items, () => {
      seed = (seed * 9301 + 0.49297) % 1;
      return seed;
    });
    expect([...order].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it("moves its clock a little every minute, back to its place after a while", () => {
    const places = Array.from({ length: 9 }, (_, minute) => drift(minute));
    for (const { x, y } of places) {
      expect(Math.abs(x)).toBeLessThanOrEqual(12);
      expect(Math.abs(y)).toBeLessThanOrEqual(12);
    }
    expect(new Set(places.map(({ x, y }) => `${String(x)},${String(y)}`)).size).toBeGreaterThan(4);
    expect(drift(9)).toEqual(drift(0));
  });

  it("names a new screen freely, says a folder by its last name, keeps a draft's layout", () => {
    const screens = readScreens({ screens: { screen: {}, screen_2: {} } });
    expect(freeName(screens, "screen")).toBe("screen_3");
    expect(freeName(screens, "kitchen")).toBe("kitchen");
    expect(folderName("media-source://media_source/local/holidays/")).toBe("holidays");
    expect(folderName("media-source://media_source/local/%C3%A9t%C3%A9")).toBe("été");
    const draft = {
      name: "hall",
      start: "" as const,
      voice: true,
      after: 5,
      wake: ["binary_sensor.hall_motion"],
      weather: true,
      every: 30,
      dim: false,
    };
    expect(layoutOf(draft)).toEqual({
      saver: {
        after: 5,
        wake: ["binary_sensor.hall_motion"],
        weather: true,
        every: 30,
        dim: false,
      },
    });
    // Voice off on the screen (D-085): kept; on, said by nothing.
    expect(layoutOf({ ...draft, voice: false }).voice).toBe(false);
    expect(
      readScreens({ screens: { hall: { voice: false }, desk: { voice: true }, x: {} } }),
    ).toMatchObject({
      hall: { voice: false },
    });
    const read = readScreens({ screens: { desk: { voice: true }, x: { voice: "no" } } });
    expect("voice" in (read.desk ?? {})).toBe(false);
    expect("voice" in (read.x ?? {})).toBe(false);
  });

  it("says everything in both languages, none of the main dictionaries' words", () => {
    expect(keys(wallFr).sort()).toEqual(keys(wallEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(wallEn).filter((key) => main.has(key))).toEqual([]);
    for (const key of ["screen", "screen_hint", "screen_none", "screen_gone"]) {
      expect(practicalEn.choices[key as keyof typeof practicalEn.choices]).toBeTruthy();
      expect(practicalFr.choices[key as keyof typeof practicalFr.choices]).toBeTruthy();
    }
    expect(en.screens.menu).toBe("Wall screens");
    expect(fr.screens.menu).toBe("Écrans muraux");
    for (const code of ["invalid_screen", "screen_exists", "too_many_screens"] as const) {
      expect(en.errors.ws[code]).toBeTruthy();
      expect(fr.errors.ws[code]).toBeTruthy();
    }
  });
});
