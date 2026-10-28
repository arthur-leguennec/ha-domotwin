import { describe, expect, it, vi } from "vitest";

import { DomoTwinClient } from "../src/ha/client";
import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { GuestConnection, guestHass, readRefusal, readSnapshot } from "../src/guest/home";
import type { BindingsJson } from "../src/live/bindings";
import {
  fromInput,
  givable,
  givenByDefault,
  newPassTimes,
  passLink,
  readPasses,
  roomDevices,
} from "../src/live/guests";

const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) =>
  ({ entity_id, state: value, attributes, last_changed: "", last_updated: "" }) as HassEntity;

/** A fictional home: a living room and a garage, their devices and areas. */
function home(): HomeAssistant {
  return {
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    states: {
      "light.pendant": state("light.pendant", "on", { friendly_name: "Pendant" }),
      "sensor.living_temperature": state("sensor.living_temperature", "21", {
        friendly_name: "Temperature",
      }),
      "media_player.tv": state("media_player.tv", "off", { friendly_name: "TV" }),
      "camera.living": state("camera.living", "idle", { friendly_name: "Camera" }),
      "cover.garage": state("cover.garage", "closed", {
        friendly_name: "Garage door",
        device_class: "garage",
      }),
      "cover.blind": state("cover.blind", "open", { friendly_name: "Blind" }),
      "lock.side": state("lock.side", "locked", { friendly_name: "Side door" }),
    },
    entities: {
      "sensor.living_temperature": {
        entity_id: "sensor.living_temperature",
        area_id: "living_room",
      },
      "cover.garage": { entity_id: "cover.garage", area_id: "garage" },
      "camera.living": { entity_id: "camera.living", area_id: "living_room" },
    },
    areas: {
      living_room: { area_id: "living_room", name: "Living room" },
      garage: { area_id: "garage", name: "Garage" },
    },
  };
}

const PLAN = {
  format: "domotwin-plan",
  version: 1,
  rooms: [
    { id: "living", name: "Living room", outline: [] },
    { id: "garage", name: "Garage", outline: [] },
  ],
  doors: [{ id: "side-door", room: "garage", from: [0, 0], to: [90, 0] }],
  items: [
    { id: "tv", kind: "tv", room: "living" },
    { id: "pendant", kind: "pendant" },
  ],
};

const BINDINGS: BindingsJson = {
  version: 1,
  rooms: { living: { area: "living_room" } },
  elements: {
    tv: { entities: [{ entity_id: "media_player.tv" }] },
    pendant: { entities: [{ entity_id: "light.pendant" }] },
    "side-door": { entities: [{ entity_id: "lock.side" }] },
    garage: { entities: [{ entity_id: "cover.blind" }] },
  },
};

describe("guest passes, as an administrator makes them (D-067)", () => {
  it("reads the passes, leaving out what cannot be read", () => {
    const passes = readPasses({
      passes: [
        {
          id: "p1",
          name: "Sam",
          rooms: ["living", 3],
          entities: ["light.pendant"],
          starts: "2026-01-15T08:00:00+00:00",
          ends: "2026-01-17T08:00:00+00:00",
          act: false,
          wifi: true,
          anywhere: true,
          path: "/api/domotwin/guest/secret",
          url: null,
          status: "open",
        },
        { id: "p2", name: "No status" },
        "nonsense",
      ],
    });
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ rooms: ["living"], act: false, anywhere: true });
    // Its link: as Home Assistant knows its address, else the page's.
    const [pass] = passes;
    if (!pass) throw new Error("no pass read");
    expect(passLink(pass, "http://127.0.0.1:8123")).toBe(
      "http://127.0.0.1:8123/api/domotwin/guest/secret",
    );
    expect(passLink({ ...pass, url: "http://localhost:8123/api/domotwin/guest/secret" }, "x")).toBe(
      "http://localhost:8123/api/domotwin/guest/secret",
    );
    expect(readPasses(null)).toEqual([]);
  });

  it("offers the devices of each room, never a camera, a person or an alarm", () => {
    const devices = roomDevices(
      home(),
      BINDINGS,
      [{ plan: PLAN, layout: {} }],
      [
        { id: "living", name: "Living room" },
        { id: "garage", name: "Garage" },
      ],
    );
    // The TV linked in the room, the temperature of its area, by name; the pendant names no
    // room. The camera of the area is not offered.
    expect(devices.get("living")).toEqual(["sensor.living_temperature", "media_player.tv"]);
    // The garage's own link, its door's lock, and its area's door, by name.
    expect(devices.get("garage")).toEqual(["cover.blind", "cover.garage", "lock.side"]);
    expect(givable("camera.living")).toBe(false);
    expect(givable("person.alex")).toBe(false);
    expect(givable("alarm_control_panel.home")).toBe(false);
    expect(givable("script.movie_night")).toBe(true);
  });

  it("follows a piece moved to another room in edit mode", () => {
    const devices = roomDevices(
      home(),
      BINDINGS,
      [{ plan: PLAN, layout: { pendant: { at: [1, 1], room: "living" } } }],
      [{ id: "living", name: "Living room" }],
    );
    expect(devices.get("living")).toContain("light.pendant");
  });

  it("leaves locks, garage doors and gates to an administrator's tick", () => {
    const hass = home();
    expect(givenByDefault(hass, "lock.side")).toBe(false);
    expect(givenByDefault(hass, "cover.garage")).toBe(false);
    expect(givenByDefault(hass, "cover.blind")).toBe(true);
    expect(givenByDefault(hass, "light.pendant")).toBe(true);
  });

  it("starts a new pass now, until two days later at the next full hour", () => {
    const now = new Date(2026, 0, 15, 9, 41, 30).getTime();
    expect(newPassTimes(now)).toEqual({ starts: "2026-01-15T09:41", ends: "2026-01-17T10:00" });
    expect(fromInput("2026-01-15T09:41")).toBe(new Date(2026, 0, 15, 9, 41).toISOString());
    expect(fromInput("nonsense")).toBeUndefined();
  });
});

/** A pass's link, as the guest's page has it in its address. */
const LINK = "/api/domotwin/guest/fictional-guest-link-secret-0123456789abcdefghij";

/** What the integration answers through a pass: the living room open, the garage closed. */
const SNAPSHOT = {
  pass: {
    name: "Sam and Lee",
    starts: "2026-01-15T08:00:00+00:00",
    ends: "2026-01-17T08:00:00+00:00",
    act: true,
    entities: ["light.pendant"],
  },
  home: "Fictional home",
  storeys: [
    { info: { id: "upstairs", name: "Upstairs", elevation: 280 }, plan: PLAN, layout: {} },
    { info: { id: "ground", name: "", elevation: 0 }, plan: PLAN, layout: { tv: { at: [1, 2] } } },
    { info: {}, plan: PLAN },
  ],
  bindings: { version: 1, rooms: {}, elements: { pendant: BINDINGS.elements.pendant } },
  settings: { theme: "day", rooms: { garage: { people: [] } } },
  states: {
    "light.pendant": state("light.pendant", "on"),
    "light.other": { entity_id: "light.mismatch", state: "on" },
  },
  entities: {},
  areas: {},
  wifi: { name: "Fictional Guests", password: "tea-and-cake", security: "WPA", hidden: false },
  config: { time_zone: "America/Toronto", unit_system: { temperature: "°C" } },
};

describe("a guest's page (D-067)", () => {
  it("reads what the pass shows, leniently", () => {
    const snapshot = readSnapshot(SNAPSHOT);
    expect(snapshot.storeys.map((s) => s.info.id)).toEqual(["upstairs", "ground"]);
    expect(Object.keys(snapshot.states)).toEqual(["light.pendant"]);
    expect(snapshot.wifi).toMatchObject({ set: true, shown: true, name: "Fictional Guests" });
    expect(snapshot.timeZone).toBe("America/Toronto");
    expect(readSnapshot(null).storeys).toEqual([]);
    expect(readRefusal({ code: "ended", ends: "2026-01-17T08:00:00+00:00" })).toEqual({
      code: "ended",
      ends: "2026-01-17T08:00:00+00:00",
    });
    expect(readRefusal("nonsense")).toEqual({ code: "unknown" });
  });

  it("answers DomoTwin's commands from it, refusing the rest", async () => {
    const connection = new GuestConnection(readSnapshot(SNAPSHOT));
    const hass = guestHass(readSnapshot(SNAPSHOT), connection, () => Promise.resolve(), LINK, {
      language: "fr",
      dark: true,
    });
    expect(hass.guest).toBe(true);
    expect(hass.user).toEqual({ id: "guest", name: "Sam and Lee", is_admin: false });
    expect(hass.config?.components).toEqual([]);
    expect(hass.themes?.darkMode).toBe(true);
    const client = DomoTwinClient.for(hass);
    // The ground floor first; every storey, lowest first.
    const plan = await client.getPlan();
    expect(plan.storey).toBe("ground");
    expect(plan.layout).toEqual({ tv: { at: [1, 2] } });
    expect(plan.storeys.map((s) => s.id)).toEqual(["ground", "upstairs"]);
    await expect(client.getPlan("attic")).rejects.toMatchObject({ code: "unknown_storey" });
    expect((await client.getSettings()).settings.rooms).toEqual({ garage: { people: [] } });
    expect((await client.getPeople()).people).toEqual({});
    // The Wi-Fi's password only when asked for, as the integration's.
    expect((await client.getWifi()).password).toBeUndefined();
    expect((await client.getWifi("", true)).password).toBe("tea-and-cake");
    // Nothing else of Home Assistant: no history, no schedules, no saving.
    await expect(
      hass.connection.sendMessagePromise({ type: "history/history_during_period" }),
    ).rejects.toMatchObject({ code: "unknown_command" });
    await expect(
      hass.connection.sendMessagePromise({ type: "domotwin/plan/save", plan: {} }),
    ).rejects.toMatchObject({ code: "unknown_command" });
    await expect(
      hass.connection.subscribeMessage(() => undefined, { type: "domotwin/schedules/subscribe" }),
    ).rejects.toMatchObject({ code: "unknown_command" });
  });

  it("reads the 3D files of its pieces through the pass, nothing else", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: URL) => {
        asked.push(url.pathname);
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }),
    );
    try {
      const connection = new GuestConnection(readSnapshot(SNAPSHOT));
      const hass = guestHass(readSnapshot(SNAPSHOT), connection, () => Promise.resolve(), LINK, {
        language: "en",
        dark: false,
      });
      const file = `${"a".repeat(64)}.glb`;
      const response = await hass.fetchWithAuth?.(`/api/domotwin/models/${file}`);
      expect(response?.ok).toBe(true);
      expect(asked).toEqual([`${LINK}/models/${file}`]);
      // Not an upload, nor anything else of Home Assistant.
      await expect(
        hass.fetchWithAuth?.("/api/domotwin/models?format=glb", { method: "POST" }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      await expect(hass.fetchWithAuth?.("/api/states")).rejects.toMatchObject({
        code: "not_allowed",
      });
      expect(asked).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells the card when the home is read again", async () => {
    const connection = new GuestConnection(readSnapshot(SNAPSHOT));
    const kinds: string[] = [];
    const stop = await connection.subscribeMessage<{ kind: string }>(
      (event) => kinds.push(event.kind),
      { type: "domotwin/subscribe" },
    );
    connection.replace(readSnapshot({ ...SNAPSHOT, wifi: null }));
    expect(kinds).toEqual(["plan", "bindings", "settings", "wifi"]);
    const wifi = await connection.sendMessagePromise<{ set: boolean }>({
      type: "domotwin/wifi/get",
    });
    expect(wifi.set).toBe(false);
    await stop();
    connection.replace(readSnapshot(SNAPSHOT));
    expect(kinds).toHaveLength(4);
  });
});
