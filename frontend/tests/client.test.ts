import { describe, expect, it, vi } from "vitest";

import { DomoTwinClient, type UpdateEvent } from "../src/ha/client";
import {
  isEntityId,
  type HassConnection,
  type HassMessage,
  type HomeAssistant,
} from "../src/ha/types";

function fakeHass(): {
  hass: HomeAssistant;
  sent: HassMessage[];
  emit: (event: UpdateEvent) => void;
} {
  const sent: HassMessage[] = [];
  let listener: ((event: UpdateEvent) => void) | undefined;
  let revision = 0;
  const connection: HassConnection = {
    sendMessage: (message: HassMessage) => {
      sent.push(message);
    },
    sendMessagePromise: <T>(message: HassMessage): Promise<T> => {
      sent.push(message);
      if (message.type === "domotwin/plan/save") revision += 1;
      return Promise.resolve({ plan: null, layout: {}, revision } as T);
    },
    subscribeMessage: (callback) => {
      listener = callback as (event: UpdateEvent) => void;
      return Promise.resolve(() => Promise.resolve());
    },
  };
  const hass = { connection } as HomeAssistant;
  return { hass, sent, emit: (event) => listener?.(event) };
}

describe("DomoTwinClient", () => {
  it("keeps what a workplace used while closed ten minutes, for its hours, and not a failure", async () => {
    let fail = false;
    const asked: HassMessage[] = [];
    const connection = {
      sendMessagePromise: (message: HassMessage) => {
        asked.push(message);
        return fail
          ? Promise.reject(Object.assign(new Error("busy"), { code: "home_assistant_error" }))
          : Promise.resolve({ week: { kwh: 31.5, share: 38 }, month: { since: "x" } });
      },
    } as unknown as HassConnection;
    const client = DomoTwinClient.for({ connection } as HomeAssistant);
    const now = Date.parse("2026-10-28T14:00:00Z");
    const found = await client.getClosedEnergy("schedule.opening", now);
    // A month without its kWh is left out.
    expect(found).toEqual({ week: { kwh: 31.5, share: 38 } });
    expect(await client.getClosedEnergy("schedule.opening", now + 9 * 60_000)).toBe(found);
    expect(asked).toHaveLength(1);
    // Other opening hours, or ten minutes on: asked again.
    await client.getClosedEnergy("schedule.shop", now + 9 * 60_000);
    await client.getClosedEnergy("schedule.shop", now + 20 * 60_000);
    expect(asked).toHaveLength(3);
    // A failure is not kept: asked again at once.
    fail = true;
    await expect(client.getClosedEnergy("schedule.opening", now + 21 * 60_000)).rejects.toEqual(
      expect.objectContaining({ code: "home_assistant_error" }),
    );
    fail = false;
    await client.getClosedEnergy("schedule.opening", now + 21 * 60_000);
    expect(asked).toHaveLength(5);
  });

  it("is shared per connection and caches the plan until it changes", async () => {
    const { hass, sent, emit } = fakeHass();
    const client = DomoTwinClient.for(hass);
    expect(DomoTwinClient.for(hass)).toBe(client);
    await client.getPlan();
    await client.getPlan();
    expect(sent.filter((m) => m.type === "domotwin/plan/get")).toHaveLength(1);

    const listener = vi.fn();
    const stop = client.subscribe(listener);
    emit({ kind: "plan", revision: 2 });
    expect(listener).toHaveBeenCalledWith({ kind: "plan", revision: 2 });
    await client.getPlan();
    expect(sent.filter((m) => m.type === "domotwin/plan/get")).toHaveLength(2);
    stop();
  });

  it("caches the settings until any save", async () => {
    const { hass, sent, emit } = fakeHass();
    const client = DomoTwinClient.for(hass);
    await client.getSettings();
    await client.getSettings();
    expect(sent.filter((m) => m.type === "domotwin/settings/get")).toHaveLength(1);
    await client.saveSettings({ north: 45 });
    expect(sent.at(-1)).toEqual({ type: "domotwin/settings/save", settings: { north: 45 } });
    await client.getSettings();
    const stop = client.subscribe(() => undefined);
    emit({ kind: "settings", revision: 3 });
    await client.getSettings();
    expect(sent.filter((m) => m.type === "domotwin/settings/get")).toHaveLength(3);
    stop();
  });

  it("reads again what it read once nobody follows the home any more", async () => {
    const { hass, sent } = fakeHass();
    const client = DomoTwinClient.for(hass);
    const stop = client.subscribe(() => undefined);
    await client.getPlan();
    await client.getSettings();
    stop();
    await client.getPlan();
    await client.getSettings();
    expect(sent.filter((m) => m.type === "domotwin/plan/get")).toHaveLength(2);
    expect(sent.filter((m) => m.type === "domotwin/settings/get")).toHaveLength(2);
  });

  it("sends the expected revision when asked", async () => {
    const { hass, sent } = fakeHass();
    const client = DomoTwinClient.for(hass);
    await client.savePlan({ version: 1 }, 4);
    await client.savePlan(null);
    await client.saveLayout({ sofa: { x: 10 } }, 6);
    expect(sent).toEqual([
      { type: "domotwin/plan/save", plan: { version: 1 }, expected_revision: 4 },
      { type: "domotwin/plan/save", plan: null },
      { type: "domotwin/plan/save", layout: { sofa: { x: 10 } }, expected_revision: 6 },
    ]);
  });
});

describe("isEntityId", () => {
  it("takes the ids Home Assistant takes, and only those", () => {
    for (const id of ["input_boolean.guests", "binary_sensor.door_2", "a.b"]) {
      expect(isEntityId(id), id).toBe(true);
    }
    for (const id of [
      "",
      "guests",
      "Input_boolean.guests",
      "input_boolean.guests ",
      "_input_boolean.guests",
      "input_boolean._guests",
      "input_boolean.guests_",
      "input__boolean.guests",
      "input_boolean.my__guests",
      "input_boolean.guests.on",
    ]) {
      expect(isEntityId(id), id).toBe(false);
    }
  });
});
