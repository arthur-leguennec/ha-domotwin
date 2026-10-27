import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";

import { entityRow, quickControls } from "../src/components/entity-rows";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { Translator } from "../src/i18n";
import { runAction } from "../src/live/actions";
import type { BindingsJson } from "../src/live/bindings";
import { roomDevices } from "../src/live/guests";
import {
  Gate,
  RightsCache,
  calledEntities,
  closedRooms,
  gatedHass,
  hiddenEntities,
  lookOnly,
  restricted,
  roomLevel,
  roomsAt,
  viewerOf,
  type Rights,
} from "../src/live/rights";
import { mayRun, roomCommands, usableActions } from "../src/live/room-actions";

const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) =>
  ({ entity_id, state: value, attributes, last_changed: "", last_updated: "" }) as HassEntity;

/**
 * A fictional home: a living room, a kitchen and a bedroom; Kim (not an administrator) viewing.
 * The kitchen's strip is in its area only; the movie scene in no room.
 */
function home(user: { id: string; is_admin: boolean } = { id: "u-kim", is_admin: false }) {
  const calls: unknown[][] = [];
  const hass: HomeAssistant = {
    language: "en",
    user: { id: user.id, name: "Kim", is_admin: user.is_admin },
    connection: {} as HomeAssistant["connection"],
    callService: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    },
    states: {
      "person.kim": state("person.kim", "home", { user_id: "u-kim" }),
      "person.sam": state("person.sam", "home", {}),
      "light.pendant": state("light.pendant", "on", { friendly_name: "Pendant" }),
      "light.floor_lamp": state("light.floor_lamp", "off", { friendly_name: "Floor lamp" }),
      "media_player.tv": state("media_player.tv", "off", { friendly_name: "TV" }),
      "light.kitchen": state("light.kitchen", "off", { friendly_name: "Kitchen" }),
      "light.strip": state("light.strip", "off", { friendly_name: "Strip" }),
      "light.bedside": state("light.bedside", "off", { friendly_name: "Bedside" }),
      "cover.bedroom": state("cover.bedroom", "open", {
        friendly_name: "Curtains",
        supported_features: 3,
      }),
      "scene.movie": state("scene.movie", "scening", { friendly_name: "Movie" }),
    },
    entities: {
      "light.strip": { entity_id: "light.strip", area_id: "kitchen" },
      "light.kitchen": { entity_id: "light.kitchen", device_id: "d-kitchen" },
    },
    devices: { "d-kitchen": { id: "d-kitchen", area_id: "kitchen" } },
    areas: {
      living_room: { area_id: "living_room", name: "Living room" },
      kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      bedroom: { area_id: "bedroom", name: "Bedroom" },
    },
  };
  return { hass, calls };
}

const PLAN = {
  format: "domotwin-plan",
  version: 1,
  rooms: [
    { id: "living", name: "Living room", outline: [] },
    { id: "kitchen", name: "Kitchen", outline: [] },
    { id: "bedroom", name: "Bedroom", outline: [] },
  ],
  items: [
    { id: "pendant", kind: "pendant", room: "living" },
    { id: "lamp", kind: "lamp", room: "living" },
    { id: "tv", kind: "tv", room: "living" },
    { id: "bedside", kind: "lamp", room: "bedroom" },
  ],
};

const BINDINGS: BindingsJson = {
  version: 1,
  rooms: {},
  elements: {
    pendant: { entities: [{ entity_id: "light.pendant" }] },
    lamp: { entities: [{ entity_id: "light.floor_lamp" }] },
    tv: { entities: [{ entity_id: "media_player.tv" }] },
    bedside: { entities: [{ entity_id: "light.bedside" }] },
    bedroom: { entities: [{ entity_id: "cover.bedroom" }] },
  },
};

/** Kim only looks at the living room, but uses its floor lamp, and does not see the TV; the
 * bedroom is hidden from everyone but Kim; the movie scene only looked at by everyone. */
const RIGHTS: Rights = {
  everyone: { rooms: { bedroom: "hidden" }, entities: { "scene.movie": "see" } },
  people: {
    "person.kim": {
      rooms: { living: "see", bedroom: "use" },
      entities: { "light.floor_lamp": "use", "media_player.tv": "hidden" },
    },
  },
};

const ROOMS = PLAN.rooms.map(({ id, name }) => ({ id, name }));

function gateFor(hass: HomeAssistant, rights: Rights = RIGHTS, rooms = {}): Gate {
  const viewer = viewerOf(rights, hass);
  if (!viewer) throw new Error("no viewer");
  return new Gate(hass, viewer, {
    bindings: BINDINGS,
    rooms: ROOMS,
    storeys: [{ plan: PLAN }],
    closed: closedRooms(rooms, rights, hass),
  });
}

describe("whose rights apply (D-071)", () => {
  it("are a person's own and everyone's, never an administrator's or the demo's", () => {
    const { hass } = home();
    const kim = viewerOf(RIGHTS, hass);
    if (!kim) throw new Error("Kim has rights");
    expect(kim.person).toBe("person.kim");
    expect(roomLevel(kim, "living")).toBe("see");
    expect(roomLevel(kim, "bedroom")).toBe("use");
    expect(roomLevel(kim, "kitchen")).toBe("use");
    expect(roomsAt(kim, "see")).toEqual(new Set(["living"]));
    expect(hiddenEntities(kim)).toEqual(new Set(["media_player.tv"]));
    expect(restricted(kim)).toBe(true);

    // A user who is nobody's: everyone's.
    const robin = viewerOf(RIGHTS, {
      ...hass,
      user: { id: "u-robin", name: "Robin", is_admin: false },
    });
    expect(robin?.person).toBeUndefined();
    expect(roomsAt(robin, "hidden")).toEqual(new Set(["bedroom"]));
    expect(hiddenEntities(robin)).toEqual(new Set());

    expect(viewerOf(RIGHTS, home({ id: "u-kim", is_admin: true }).hass)).toBeUndefined();
    expect(viewerOf(RIGHTS, { ...hass, demo: true })).toBeUndefined();
    expect(viewerOf(RIGHTS, { ...hass, sandbox: true })).toBeUndefined();
    expect(viewerOf(RIGHTS, { ...hass, guest: true })).toBeUndefined();
    // None set: everything used.
    expect(restricted(viewerOf(undefined, hass))).toBe(false);
    expect(restricted(viewerOf({ everyone: { rooms: { living: "use" } } }, hass))).toBe(false);
  });

  it("close the rooms hidden, with the private ones", () => {
    const { hass } = home();
    const robin = { ...hass, user: { id: "u-robin", name: "Robin", is_admin: false } };
    expect(closedRooms({ kitchen: { people: [] } }, RIGHTS, robin)).toEqual(
      new Set(["kitchen", "bedroom"]),
    );
    expect(closedRooms({}, RIGHTS, hass)).toEqual(new Set());
    // An administrator still has the private rooms closed (D-039), not the rights.
    const admin = home({ id: "u-admin", is_admin: true }).hass;
    expect(closedRooms({ kitchen: { people: [] } }, RIGHTS, admin)).toEqual(new Set(["kitchen"]));
  });
});

describe("a device's level", () => {
  it("is its own, else its rooms' strictest; a room closed hides all it holds", () => {
    const { hass } = home();
    const gate = gateFor(hass);
    expect(gate.level("light.pendant")).toBe("see");
    expect(gate.level("light.floor_lamp")).toBe("use");
    expect(gate.level("media_player.tv")).toBe("hidden");
    expect(gate.level("light.bedside")).toBe("use");
    expect(gate.level("scene.movie")).toBe("see");
    expect(gate.level("light.kitchen")).toBe("use");
    // In the kitchen by its area, its device's for the kitchen's light.
    const looking: Rights = { everyone: { rooms: { kitchen: "see" } } };
    const kitchen = gateFor(hass, looking);
    expect(kitchen.level("light.strip")).toBe("see");
    expect(kitchen.level("light.kitchen")).toBe("see");
    expect(kitchen.canAct("light.strip")).toBe(false);
    expect(kitchen.canSee("light.strip")).toBe(true);

    // Robin: the bedroom hidden, its curtains (linked to the room) and bedside lamp too, even
    // given their own level.
    const robin = { ...hass, user: { id: "u-robin", name: "Robin", is_admin: false } };
    const own: Rights = {
      ...RIGHTS,
      everyone: { ...RIGHTS.everyone, entities: { "light.bedside": "use" } },
    };
    const closed = gateFor(robin, own);
    expect(closed.level("cover.bedroom")).toBe("hidden");
    expect(closed.level("light.bedside")).toBe("hidden");
    expect(closed.canSee("cover.bedroom")).toBe(false);
    expect(closed.strictest(["light.pendant", "cover.bedroom"])).toBe("hidden");
    expect(closed.strictest([])).toBe("use");
  });
});

describe("a call under the rights", () => {
  it("names its entities: given, by area, by device, a script by its name", () => {
    const { hass } = home();
    expect(calledEntities(hass, "light", "turn_on", {}, { entity_id: "light.pendant" })).toEqual([
      "light.pendant",
    ]);
    expect(calledEntities(hass, "light", "turn_on", { entity_id: ["light.a", "light.b"] })).toEqual(
      ["light.a", "light.b"],
    );
    expect(calledEntities(hass, "light", "turn_off", {}, { area_id: "kitchen" })?.sort()).toEqual([
      "light.kitchen",
      "light.strip",
    ]);
    expect(calledEntities(hass, "light", "turn_off", {}, { device_id: ["d-kitchen"] })).toEqual([
      "light.kitchen",
    ]);
    expect(calledEntities(hass, "script", "wake_up")).toEqual(["script.wake_up"]);
    expect(calledEntities(hass, "script", "turn_on", {}, { entity_id: "script.a" })).toEqual([
      "script.a",
    ]);
    // Several in a string, as Home Assistant takes them; a floor's areas.
    expect(calledEntities(hass, "light", "turn_on", { entity_id: "light.a, light.b" })).toEqual([
      "light.a",
      "light.b",
    ]);
    expect(calledEntities(hass, "light", "turn_off", {}, { floor_id: "ground" })?.sort()).toEqual([
      "light.kitchen",
      "light.strip",
    ]);
    // Labels (of areas and devices too) and `all` cannot be told.
    expect(calledEntities(hass, "light", "turn_off", {}, { label_id: ["x"] })).toBeUndefined();
    expect(calledEntities(hass, "light", "turn_off", { entity_id: "all" })).toBeUndefined();
  });

  it("is refused before Home Assistant on what the viewer may not use", async () => {
    const { hass, calls } = home();
    const gate = gateFor(hass);
    const gated = gatedHass(hass, gate);
    expect(gatedHass(hass, gate)).toBe(gated);
    expect(gatedHass(hass, undefined)).toBe(hass);
    expect(gated.canAct?.("light.pendant")).toBe(false);
    expect(gated.canAct?.("light.floor_lamp")).toBe(true);
    expect(gated.canSee?.("media_player.tv")).toBe(false);
    await expect(
      gated.callService("light", "turn_on", {}, { entity_id: "light.pendant" }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await expect(
      gated.callService("light", "turn_off", {}, { label_id: "upstairs" }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    // Home Assistant's cards' own arguments go through.
    const args = ["light", "turn_on", {}, { entity_id: "light.floor_lamp" }, true, false];
    await gated.callService(...(args as Parameters<HomeAssistant["callService"]>));
    expect(calls).toEqual([
      ["light", "turn_on", {}, { entity_id: "light.floor_lamp" }, true, false],
    ]);
    // The states and everything else are Home Assistant's own.
    expect(gated.states).toBe(hass.states);
    // Another card's gate on the same `hass`: its own wrapper, each kept.
    const other = gateFor(hass, { everyone: { rooms: { kitchen: "see" } } });
    const second = gatedHass(hass, other);
    expect(second).not.toBe(gated);
    expect(gatedHass(hass, gate)).toBe(gated);
    expect(gatedHass(hass, other)).toBe(second);
  });

  it("lets a call that cannot be told through when only private rooms are closed", async () => {
    const { hass, calls } = home();
    const viewer = viewerOf(undefined, hass);
    if (!viewer) throw new Error("a viewer");
    const gate = new Gate(hass, viewer, {
      bindings: BINDINGS,
      rooms: ROOMS,
      storeys: [{ plan: PLAN }],
      closed: new Set(["bedroom"]),
    });
    const gated = gatedHass(hass, gate);
    await gated.callService("light", "turn_off", {}, { label_id: "upstairs" });
    expect(calls).toHaveLength(1);
    expect(gated.canCall?.(undefined)).toBe(true);
    // But not on what the closed room holds.
    await expect(
      gated.callService("light", "turn_on", {}, { entity_id: "light.bedside" }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  });
});

describe("what DomoTwin shows under the rights", () => {
  it("unlinks what is not seen outside the rooms closed, which close whole", () => {
    const { hass } = home();
    const robin = { ...hass, user: { id: "u-robin", name: "Robin", is_admin: false } };
    // Kim: the TV, hidden by its own level, unlinked; the rest as it was.
    const shown = gateFor(hass).shown(BINDINGS);
    expect(shown.elements.tv).toBeUndefined();
    expect(shown.elements.pendant).toBe(BINDINGS.elements.pendant);
    // Robin: the bedroom closed keeps its links (its dangers still show, D-039); a lamp of the
    // bedroom's area linked to a piece of the living room is unlinked there.
    const bedroomLamp = {
      ...robin,
      entities: {
        ...robin.entities,
        "light.pendant": { entity_id: "light.pendant", area_id: "bedroom" },
      },
    };
    const areas = new Gate(
      bedroomLamp,
      viewerOf(RIGHTS, bedroomLamp) ?? { own: {}, everyone: {} },
      {
        bindings: { ...BINDINGS, rooms: { bedroom: { area: "bedroom" } } },
        rooms: ROOMS,
        storeys: [{ plan: PLAN }],
        closed: closedRooms({}, RIGHTS, bedroomLamp),
      },
    );
    const robinShown = areas.shown(BINDINGS);
    expect(robinShown.elements.bedside).toBe(BINDINGS.elements.bedside);
    expect(robinShown.elements.bedroom).toBe(BINDINGS.elements.bedroom);
    expect(robinShown.elements.pendant).toBeUndefined();
    // Nothing hidden: the same bindings.
    const open = gateFor(hass, { everyone: { rooms: { living: "see" } } });
    expect(open.shown(BINDINGS)).toBe(BINDINGS);
    // A piece keeps what it may show.
    const two: BindingsJson = {
      ...BINDINGS,
      elements: {
        lamp: { entities: [{ entity_id: "media_player.tv" }, { entity_id: "light.b" }] },
      },
    };
    expect(gateFor(hass).shown(two).elements.lamp?.entities).toEqual([{ entity_id: "light.b" }]);
  });

  it("works the gate out once while nothing it reads changes; none for an administrator", () => {
    const { hass } = home();
    const cache = new RightsCache();
    const homeOf = vi.fn(() => ({ rooms: ROOMS, storeys: [{ plan: PLAN }] }));
    const seen = { bindings: BINDINGS, closed: new Set<string>() };
    const first = cache.read(hass, RIGHTS, seen, homeOf, [PLAN]);
    expect(first.gate).toBeDefined();
    expect(first.bindings.elements.tv).toBeUndefined();
    expect(cache.read({ ...hass }, RIGHTS, { ...seen }, homeOf, [PLAN])).toBe(first);
    expect(homeOf).toHaveBeenCalledTimes(1);
    const admin = home({ id: "u-admin", is_admin: true }).hass;
    const none = cache.read(admin, RIGHTS, seen, homeOf, [PLAN]);
    expect(none.gate).toBeUndefined();
    expect(none.bindings).toBe(BINDINGS);
    // Nothing restricted, nothing closed: no gate either; a private room closed, one.
    expect(cache.read(hass, { everyone: {} }, seen, homeOf, [PLAN]).gate).toBeUndefined();
    const closed = { bindings: BINDINGS, closed: new Set(["bedroom"]) };
    const gate = cache.read(hass, undefined, closed, homeOf, [PLAN]).gate;
    expect(gate?.level("light.bedside")).toBe("hidden");
    expect(gate?.level("light.pendant")).toBe("use");
  });

  it("makes Home Assistant's cards of what is only looked at do nothing on a tap", () => {
    const none = { action: "none" };
    expect(lookOnly({ type: "tile", entity: "light.pendant" })).toEqual({
      type: "tile",
      entity: "light.pendant",
      tap_action: none,
      icon_tap_action: none,
      hold_action: none,
      double_tap_action: none,
    });
    expect(lookOnly({ type: "button", entity: "scene.movie" }).type).toBe("tile");
    const weather = { type: "weather-forecast", entity: "weather.home" };
    expect(lookOnly(weather)).toBe(weather);
  });

  it("disables the controls of what is only looked at", () => {
    const { hass } = home();
    const gated = gatedHass(hass, gateFor(hass));
    const t = new Translator("en");
    const host = document.createElement("div");
    render(html`${entityRow(gated, t, "light.pendant", true)}`, host);
    const fieldset = host.querySelector("fieldset");
    expect(fieldset?.disabled).toBe(true);
    expect(fieldset?.title).toBe("You may look at this device, not use it.");
    expect(quickControls(gated, t, "light.pendant")).toBe(quickControls(gated, t, "light.none"));
    render(html`${entityRow(gated, t, "light.floor_lamp", true)}`, host);
    expect(host.querySelector("fieldset")).toBeNull();
  });

  it("opens DomoTwin's own panel for a tap on what is only looked at", async () => {
    const { hass, calls } = home();
    const gated = gatedHass(hass, gateFor(hass));
    const node = document.createElement("div");
    const binding = { entities: [{ entity_id: "light.pendant" }] };
    expect(await runAction(node, gated, { action: "toggle" }, binding)).toBe("controls");
    expect(await runAction(node, gated, { action: "more-info" }, binding)).toBe("controls");
    expect(calls).toEqual([]);
    const lamp = { entities: [{ entity_id: "light.floor_lamp" }] };
    expect(await runAction(node, gated, { action: "toggle" }, lamp)).toBe("done");
    expect(calls).toHaveLength(1);
    // An action of the piece's on what is only looked at: its panel too.
    const scene = {
      action: "perform-action" as const,
      perform_action: "light.turn_on",
      target: { entity_id: "light.pendant" },
    };
    expect(await runAction(node, gated, scene, binding)).toBe("controls");
    expect(calls).toHaveLength(1);
  });

  it("offers a room's commands and own actions on what the viewer may use only", () => {
    const { hass } = home();
    const gated = gatedHass(hass, gateFor(hass));
    const devices = {
      lights: ["light.pendant", "light.floor_lamp"],
      covers: [],
      media: [],
      all: ["light.pendant", "light.floor_lamp"],
    };
    const commands = roomCommands(gated, devices);
    expect(commands.map((c) => c.calls)).toEqual([
      [["light", "turn_on", ["light.floor_lamp"]]],
      [["light", "turn_off", ["light.floor_lamp"]]],
    ]);
    expect(roomCommands(gated, { ...devices, lights: ["light.pendant"] })).toEqual([]);
    const scene = {
      name: "Movie",
      action: {
        action: "perform-action" as const,
        perform_action: "scene.turn_on",
        target: { entity_id: "scene.movie" },
      },
    };
    const lamp = {
      name: "Lamp",
      action: { action: "toggle" as const, entity_id: "light.floor_lamp" },
    };
    const upstairs = {
      name: "Up",
      action: {
        action: "perform-action" as const,
        perform_action: "light.turn_off",
        target: { label_id: "up" },
      },
    };
    const away = { name: "Away", action: { action: "navigate" as const, navigation_path: "/x" } };
    expect(usableActions(gated, [scene, lamp, upstairs, away])).toEqual([lamp, away]);
    expect(mayRun(hass, scene.action)).toBe(true);
    expect(usableActions(hass, [scene])).toEqual([scene]);
  });

  it("lists every device of each room for the rights' dialog", () => {
    const { hass } = home();
    const devices = roomDevices(hass, BINDINGS, [{ plan: PLAN }], ROOMS, () => true);
    expect(devices.get("living")).toEqual(["light.floor_lamp", "light.pendant", "media_player.tv"]);
    expect(devices.get("kitchen")).toEqual(["light.kitchen", "light.strip"]);
    expect(devices.get("bedroom")).toEqual(["light.bedside", "cover.bedroom"]);
  });
});
