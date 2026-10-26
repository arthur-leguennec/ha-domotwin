import { describe, expect, it } from "vitest";

import { DemoHome } from "../src/demo/home";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { Translator, addMessages, en, fr } from "../src/i18n";
import { historyEn, historyFr } from "../src/i18n/history";
import {
  MAX_CHANGES,
  canPutBack,
  canonical,
  changesBetween,
  editorPath,
  filterItems,
  itemName,
  putBack,
  refreshHistory,
  refusal,
  sayChange,
  sayValue,
  type HistoryItem,
  type HistoryKind,
  type HistoryVersion,
} from "../src/live/history";

addMessages({ en: historyEn, fr: historyFr });

const english = new Translator("en");
const french = new Translator("fr");

function entity(id: string, name: string): HassEntity {
  return {
    entity_id: id,
    state: "on",
    attributes: { friendly_name: name },
    last_changed: "",
    last_updated: "",
  };
}

/** Home Assistant knowing a few fictional entities; what it was asked is kept. */
function home(): { hass: HomeAssistant; asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    hass: {
      language: "en",
      states: {
        "light.living_lamp": entity("light.living_lamp", "Living lamp"),
        "light.hall": entity("light.hall", "Hall"),
        "binary_sensor.hall_motion": entity("binary_sensor.hall_motion", "Hall motion"),
      },
      callService: () => Promise.resolve(),
      callApi: (method: string, path: string, parameters?: Record<string, unknown>) => {
        asked.push({ api: method, path, parameters });
        return Promise.resolve({ result: "ok" } as never);
      },
      connection: {
        sendMessagePromise: (message: unknown) => {
          asked.push(message);
          return Promise.resolve(null as never);
        },
      } as unknown as HomeAssistant["connection"],
    },
  };
}

/** The changes between two configurations of a kind, in words. */
function said(
  kind: HistoryKind,
  before: unknown,
  after: unknown,
  t = english,
  hass = home().hass,
): string[] {
  return changesBetween(before, after).changes.map((change) => {
    const words = sayChange(t, kind, change, before, after, hass);
    return `${words.op} ${words.place}: ${words.text}`;
  });
}

const EVENING = {
  id: "1700000000001",
  alias: "Evening lights",
  triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
  conditions: [],
  actions: [{ action: "light.turn_on", target: { entity_id: "light.living_lamp" } }],
  mode: "single",
};

function item(changes: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "automation:1700000000001",
    kind: "automation",
    key: "1700000000001",
    name: "Evening lights",
    source: "editor",
    removed: false,
    versions: 3,
    changed: "2026-10-25T18:00:00+00:00",
    ...changes,
  };
}

function version(id: number, changes: Partial<HistoryVersion> = {}): HistoryVersion {
  return { id, at: "2026-10-20T18:00:00+00:00", removed: false, kept: true, ...changes };
}

describe("what changed between two versions (D-057)", () => {
  it("takes keys named as JavaScript's own (constructor) as any other", () => {
    expect(said("dashboard", { title: "Home" }, { title: "Home", constructor: "x" })).toEqual([
      "add constructor: “x”",
    ]);
    expect(changesBetween({ toString: 1 }, { toString: 1 }).changes).toEqual([]);
  });

  it("finds nothing between the same configurations, their keys in any order", () => {
    const reordered = Object.fromEntries(Object.entries(EVENING).reverse());
    expect(changesBetween(EVENING, reordered).changes).toEqual([]);
    expect(canonical(EVENING)).toBe(canonical(reordered));
  });

  it("says a value changed, where, in words", () => {
    const later = { ...EVENING, triggers: [{ ...EVENING.triggers[0], offset: "-00:20:00" }] };
    expect(said("automation", EVENING, later)).toEqual([
      "change Trigger 1 › offset: “-00:30:00” → “-00:20:00”",
    ]);
    expect(said("automation", EVENING, { ...EVENING, alias: "Dusk" }, french)).toEqual([
      "change Nom: “Evening lights” → “Dusk”",
    ]);
  });

  it("matches a list's items, so that one added does not change those after it", () => {
    const motion = { trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" };
    const time = { trigger: "time", at: "07:00:00" };
    const before = { ...EVENING, triggers: [time, ...EVENING.triggers] };
    const after = { ...EVENING, triggers: [time, motion, ...EVENING.triggers] };
    expect(said("automation", before, after)).toEqual([
      "add Trigger 2: state · Hall motion (to “on”)",
    ]);
    expect(said("automation", after, before)).toEqual([
      "remove Trigger 2: state · Hall motion (to “on”)",
    ]);
  });

  it("compares the items of a sort, and takes one of another sort as removed and added", () => {
    const off = { action: "light.turn_off", target: { entity_id: "light.hall" } };
    const after = {
      ...EVENING,
      actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }, off],
    };
    expect(said("automation", EVENING, after)).toEqual([
      "change Action 1 › target › entity_id: Living lamp → Hall",
      "add Action 2: light.turn_off · Hall",
    ]);
    const swapped = { ...EVENING, actions: [off] };
    expect(said("automation", EVENING, swapped)).toEqual([
      "remove Action 1: light.turn_on · Living lamp",
      "add Action 1: light.turn_off · Hall",
    ]);
  });

  it("says the entities added to or taken from a list, and a list put in another order", () => {
    const two = {
      ...EVENING,
      actions: [
        { action: "light.turn_on", target: { entity_id: ["light.living_lamp", "light.hall"] } },
      ],
    };
    const one = {
      ...EVENING,
      actions: [{ action: "light.turn_on", target: { entity_id: ["light.living_lamp"] } }],
    };
    expect(said("automation", one, two)).toEqual(["add Action 1 › target › entity_id: Hall"]);
    expect(said("automation", two, one)).toEqual(["remove Action 1 › target › entity_id: Hall"]);
    const swapped = {
      ...EVENING,
      actions: [
        { action: "light.turn_on", target: { entity_id: ["light.hall", "light.living_lamp"] } },
      ],
    };
    expect(said("automation", two, swapped)).toEqual([
      "change Action 1 › target › entity_id: Living lamp, Hall → Hall, Living lamp",
    ]);
  });

  it("says a field added or removed", () => {
    expect(said("automation", EVENING, { ...EVENING, description: "When the sun sets" })).toEqual([
      "add Description: “When the sun sets”",
    ]);
    const noMode: Record<string, unknown> = { ...EVENING };
    delete noMode.mode;
    expect(said("automation", EVENING, noMode)).toEqual(["remove Mode: “single”"]);
  });

  it("numbers a script's steps", () => {
    const before = { alias: "Good night", sequence: [{ action: "light.turn_off" }] };
    const after = { ...before, sequence: [...before.sequence, { delay: 5 }] };
    expect(said("script", before, after)).toEqual(["add Step 2: delay 5"]);
    expect(said("script", before, after, french)).toEqual(["add Étape 2: delay 5"]);
  });

  it("names a scene's entities and their states", () => {
    const before = {
      name: "Reading",
      entities: { "light.living_lamp": { state: "on", brightness: 120 } },
    };
    const after = {
      name: "Reading",
      entities: {
        "light.living_lamp": { state: "on", brightness: 200 },
        "light.hall": { state: "off" },
      },
    };
    expect(said("scene", before, after)).toEqual([
      "change Living lamp › brightness: 120 → 200",
      "add Hall: off",
    ]);
  });

  it("names a dashboard's views by their titles, and numbers their cards", () => {
    const card = { type: "tile", entity: "light.hall" };
    const before = { title: "Home", views: [{ title: "Kitchen", cards: [] as unknown[] }] };
    const after = {
      title: "Home",
      views: [{ title: "Kitchen", cards: [card] }, { path: "garden" }],
    };
    expect(said("dashboard", before, after)).toEqual([
      "add View “Kitchen” › Card 1: tile · Hall",
      "add View 2: path “garden”",
    ]);
    expect(said("dashboard", after, before, french)).toEqual([
      "remove Vue « Kitchen » › Carte 1: tile · Hall",
      "remove Vue 2: path “garden”",
    ]);
  });

  it("goes with an item's like when a neighbour beside it was removed", () => {
    const before = {
      views: [
        { title: "Garden", path: "garden" },
        { title: "Kitchen", icon: "mdi:fridge", cards: [] },
      ],
    };
    const after = { views: [{ title: "Kitchen", cards: [] }] };
    expect(said("dashboard", before, after)).toEqual([
      "remove View “Garden”: “Garden” (path “garden”)",
      "remove View “Kitchen” › Icon: “mdi:fridge”",
    ]);
    expect(said("dashboard", after, before)).toEqual([
      "add View “Garden”: “Garden” (path “garden”)",
      "add View “Kitchen” › Icon: “mdi:fridge”",
    ]);
  });

  it("says at most a number of changes and counts the rest", () => {
    const before = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, i]));
    const after = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, i + 1]));
    const { changes, more } = changesBetween(before, after);
    expect(changes).toHaveLength(MAX_CHANGES);
    expect(more).toBe(250 - MAX_CHANGES);
  });

  it("compares long lists item by item rather than matching them", () => {
    const before = Array.from({ length: 300 }, (_, i) => ({ type: "tile", n: i }));
    const after = before.map((card, i) => (i === 150 ? { ...card, n: -1 } : card));
    const { changes } = changesBetween({ cards: before }, { cards: after });
    expect(changes).toEqual([{ op: "change", path: ["cards", 150, "n"], before: 150, after: -1 }]);
  });
});

describe("a value in short", () => {
  it("quotes texts, cuts long ones, names entities, says yes and no", () => {
    const { hass } = home();
    expect(sayValue(english, "on")).toBe("“on”");
    expect(sayValue(english, "x".repeat(80))).toBe(`“${"x".repeat(59)}…”`);
    expect(sayValue(english, "light.hall", hass)).toBe("Hall");
    expect(sayValue(english, "light.unknown", hass)).toBe("light.unknown");
    expect(sayValue(english, true)).toBe("yes");
    expect(sayValue(french, false)).toBe("non");
    expect(sayValue(english, null)).toBe("nothing");
    expect(sayValue(english, [])).toBe("none");
    expect(sayValue(english, [1, 2, 3, 4, 5])).toBe("1, 2, 3 and 2 more");
    expect(sayValue(english, { nested: { deep: 1 }, list: [] })).toBe("2 settings");
    expect(sayValue(english, { alias: "Leave", mode: "single" })).toBe("“Leave” (mode “single”)");
  });
});

describe("the items and what can be done with them", () => {
  const items: HistoryItem[] = [
    item(),
    item({ id: "script:entree", kind: "script", key: "entree", name: "Entrée" }),
    item({ id: "dashboard:", kind: "dashboard", key: "", name: null }),
  ];

  it("filters by kind and by every word searched, accents and case aside", () => {
    expect(filterItems(items, "script", "").map((each) => each.id)).toEqual(["script:entree"]);
    expect(filterItems(items, undefined, "ENTREE").map((each) => each.id)).toEqual([
      "script:entree",
    ]);
    expect(filterItems(items, undefined, "evening lights").map((each) => each.id)).toEqual([
      "automation:1700000000001",
    ]);
    expect(filterItems(items, undefined, "evening kitchen")).toEqual([]);
  });

  it("names the default dashboard", () => {
    expect(itemName(english, items[2] as HistoryItem)).toBe("Overview");
    expect(itemName(french, items[2] as HistoryItem)).toBe("Aperçu");
    expect(itemName(english, item({ name: null }))).toBe("1700000000001");
  });

  it("puts back what Home Assistant's editors wrote, not the current version", () => {
    const newest = version(3);
    expect(canPutBack(item(), version(1), newest)).toBe(true);
    expect(canPutBack(item(), newest, newest)).toBe(false);
    expect(canPutBack(item(), version(1, { kept: false }), newest)).toBe(false);
    expect(canPutBack(item(), version(2, { removed: true, kept: false }), newest)).toBe(false);
    expect(canPutBack(item({ source: "yaml" }), version(1), newest)).toBe(false);
    // A removed automation comes back; a removed dashboard has nowhere to go.
    expect(canPutBack(item({ removed: true }), version(1), newest)).toBe(true);
    const dashboard = item({ kind: "dashboard", key: "home-wall", removed: true });
    expect(canPutBack(dashboard, version(1), newest)).toBe(false);
  });

  it("opens Home Assistant's editor of the item, or the dashboard", () => {
    expect(editorPath(item({ key: "a b" }))).toBe("/config/automation/edit/a%20b");
    expect(editorPath(item({ kind: "script", key: "leave" }))).toBe("/config/script/edit/leave");
    expect(editorPath(item({ source: "yaml" }))).toBeUndefined();
    expect(editorPath(item({ removed: true }))).toBeUndefined();
    expect(editorPath(item({ kind: "dashboard", key: "" }))).toBe("/lovelace");
    expect(editorPath(item({ kind: "dashboard", key: "wall-tablet", source: "yaml" }))).toBe(
      "/wall-tablet",
    );
  });
});

describe("putting a version back", () => {
  it("goes through Home Assistant's configuration API, then has the item read again", async () => {
    const { hass, asked } = home();
    await putBack(hass, item({ key: "1700000000001" }), EVENING);
    await refreshHistory(hass, "automation").catch(() => undefined);
    expect(asked).toEqual([
      { api: "POST", path: "config/automation/config/1700000000001", parameters: EVENING },
      { type: "domotwin/history/refresh", kind: "automation" },
    ]);
  });

  it("refuses where Home Assistant's configuration API is not at hand", async () => {
    const { hass } = home();
    delete hass.callApi;
    await expect(putBack(hass, item(), EVENING)).rejects.toThrow();
  });

  it("saves a dashboard with Lovelace's command, the default one without its path", async () => {
    const { hass, asked } = home();
    const config = { title: "Home", views: [] };
    await putBack(hass, item({ kind: "dashboard", key: "" }), config);
    await putBack(hass, item({ kind: "dashboard", key: "wall-tablet" }), config);
    expect(asked).toEqual([
      { type: "lovelace/config/save", config },
      { type: "lovelace/config/save", config, url_path: "wall-tablet" },
    ]);
  });

  it("says Home Assistant's refusal as it gives it", () => {
    const api = {
      error: "Response error: 400",
      status_code: 400,
      body: { message: "Message malformed: no entity" },
    };
    expect(refusal(api)).toBe("Message malformed: no entity");
    expect(refusal({ code: "config_not_found", message: "No config found." })).toBe(
      "No config found.",
    );
    expect(refusal({ body: "Bad gateway" })).toBe("Bad gateway");
    expect(refusal(new Error("callApi"))).toBeUndefined();
    expect(refusal("nope")).toBeUndefined();
  });
});

describe("the history's messages", () => {
  function keys(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) =>
      keys(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("have the same keys and placeholders in both languages, none the dictionaries'", () => {
    expect(keys(historyFr).sort()).toEqual(keys(historyEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(historyEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(historyEn)) {
      expect(placeholders(lookup(historyFr, key)), key).toEqual(
        placeholders(lookup(historyEn, key)),
      );
    }
  });
});

describe("the demo house's history", () => {
  it("answers as the integration would, and puts a version back in the page", async () => {
    const demo = new DemoHome({ language: "en" });
    const send = <T>(message: Record<string, unknown>): Promise<T> =>
      demo.hass.connection.sendMessagePromise<T>(message as never);
    const list = await send<{ items: HistoryItem[] }>({ type: "domotwin/history/list" });
    expect(list.items.map((each) => each.id)).toEqual([
      "automation:evening_lights",
      "automation:morning_curtains",
      "script:good_night",
      "dashboard:",
    ]);
    expect(list.items.find((each) => each.id === "script:good_night")?.removed).toBe(true);
    const detail = await send<{ versions: HistoryVersion[] }>({
      type: "domotwin/history/item",
      item: "automation:evening_lights",
    });
    expect(detail.versions).toHaveLength(3);
    const oldest = detail.versions.at(-1) as HistoryVersion;
    const config = await send<{ config: Record<string, unknown> }>({
      type: "domotwin/history/version",
      item: "automation:evening_lights",
      version: oldest.id,
    });
    expect(config.config.alias).toBe("Evening lights");
    await putBack(demo.hass, list.items[0] as HistoryItem, config.config);
    const after = await send<{ versions: HistoryVersion[] }>({
      type: "domotwin/history/item",
      item: "automation:evening_lights",
    });
    expect(after.versions).toHaveLength(4);
    expect(after.versions[0]?.same_as).toBe(oldest.id);
    await expect(
      send({ type: "domotwin/history/item", item: "automation:nothing" }),
    ).rejects.toMatchObject({ code: "unknown_item" });
  });
});
