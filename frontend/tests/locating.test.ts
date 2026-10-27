import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import {
  deviceId,
  kindOf,
  locatedShown,
  sameMatch,
  settingsOf,
  type LocatedDevice,
} from "../src/live/locating";

function state(entity_id: string, value: string, attributes: Record<string, unknown>): HassEntity {
  return { entity_id, state: value, attributes, last_changed: "", last_updated: "" };
}

/** Fictional devices followed by Bluetooth: Alex's phone in the kitchen, keys left behind in the
 * hall, Lou's watch (Lou hid themselves), a tag not heard; and an entity that only looks alike. */
function hass(): HomeAssistant {
  const located = (
    entity_id: string,
    room: string | undefined,
    attributes: Record<string, unknown>,
  ): HassEntity =>
    state(entity_id, room ?? "unknown", {
      ...attributes,
      ...(room ? { room_id: room.toLowerCase() } : {}),
    });
  const states = [
    located("sensor.domotwin_alex_phone_bluetooth", "Kitchen", {
      device_name: "Alex's phone",
      kind: "phone",
      person: "person.alex",
      left_behind: false,
    }),
    located("sensor.domotwin_keys_bluetooth", "Hall", {
      device_name: "Keys",
      kind: "thing",
      person: "person.alex",
      left_behind: true,
    }),
    located("sensor.domotwin_lou_watch_bluetooth", "Bedroom", {
      device_name: "Watch",
      kind: "watch",
      person: "person.lou",
    }),
    located("sensor.domotwin_bag_bluetooth", undefined, { device_name: "Bag", kind: "thing" }),
    located("sensor.other_bluetooth", "Kitchen", { device_name: "Other", kind: "thing" }),
  ];
  const entities = Object.fromEntries(
    states.map((s) => [
      s.entity_id,
      {
        entity_id: s.entity_id,
        platform: s.entity_id.startsWith("sensor.domotwin") ? "domotwin" : "bermuda",
        translation_key: "located",
      },
    ]),
  );
  return {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    entities,
    language: "en",
    callService: () => Promise.resolve(),
    connection: {} as HomeAssistant["connection"],
  };
}

describe("Bluetooth locating (D-035)", () => {
  it("names a device's id after it, once", () => {
    expect(deviceId("Alex's phone", [])).toBe("alex_s_phone");
    expect(deviceId("Clés de l’entrée", [])).toBe("cles_de_l_entree");
    expect(deviceId("Keys", ["keys", "keys_2"])).toBe("keys_3");
    expect(deviceId("!!!", [])).toBe("device");
    expect(deviceId("x".repeat(80), []).length).toBe(32);
  });

  it("knows a device the same way whatever the case", () => {
    expect(sameMatch({ address: "aa:bb:cc:dd:ee:ff" }, { address: "AA:BB:CC:DD:EE:FF" })).toBe(
      true,
    );
    expect(sameMatch({ key: "entry" }, { key: "entry", title: "Watch" })).toBe(true);
    const beacon = { uuid: "E2C56DB5-DFFB-48D2-B060-D0F5A71096E0", major: 1, minor: 2 };
    expect(sameMatch({ beacon }, { beacon: { ...beacon, uuid: beacon.uuid.toLowerCase() } })).toBe(
      true,
    );
    expect(sameMatch({ beacon }, { beacon: { ...beacon, minor: 3 } })).toBe(false);
    expect(sameMatch({ key: "entry" }, { address: "entry" })).toBe(false);
    expect(kindOf({ address: "AA:BB:CC:DD:EE:FF" })).toBe("thing");
    expect(kindOf({ key: "entry" })).toBe("phone");
  });

  it("saves a device without what the integration adds", () => {
    const device: LocatedDevice = {
      name: "Watch",
      kind: "watch",
      person: "person.sam",
      match: { key: "entry", title: "Sam's watch" },
      sensor: "sensor.domotwin_watch_bluetooth",
      room: "bedroom",
      confidence: 0.9,
      last_seen: null,
      left_behind: false,
      missing_key: false,
    };
    expect(settingsOf(device)).toEqual({
      name: "Watch",
      kind: "watch",
      person: "person.sam",
      match: { key: "entry" },
    });
    expect(settingsOf({ ...device, person: undefined })).not.toHaveProperty("person");
    // Paired with Bermuda's sensor (M41): kept.
    expect(settingsOf({ ...device, bermuda: "sensor.watch_area" }).bermuda).toBe(
      "sensor.watch_area",
    );
  });

  it("shows the devices followed, not those of people not told about", () => {
    const shown = locatedShown(hass(), (person) => person !== "person.lou");
    expect(shown.map((d) => d.name)).toEqual(["Alex's phone", "Bag", "Keys"]);
    const keys = shown.find((d) => d.name === "Keys");
    expect(keys).toEqual({
      sensor: "sensor.domotwin_keys_bluetooth",
      name: "Keys",
      kind: "thing",
      person: "person.alex",
      room: "hall",
      roomName: "Hall",
      leftBehind: true,
    });
    const bag = shown.find((d) => d.name === "Bag");
    expect(bag?.room).toBeUndefined();
    // Nobody's: only the devices of no one when nobody is to be told about.
    expect(locatedShown(hass(), () => false).map((d) => d.name)).toEqual(["Bag"]);
  });
});
