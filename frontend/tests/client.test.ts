import { describe, expect, it, vi } from "vitest";

import { DomoTwinClient, type UpdateEvent } from "../src/ha/client";
import type { HassConnection, HassMessage, HomeAssistant } from "../src/ha/types";

function fakeHass(): {
  hass: HomeAssistant;
  sent: HassMessage[];
  emit: (event: UpdateEvent) => void;
} {
  const sent: HassMessage[] = [];
  let listener: ((event: UpdateEvent) => void) | undefined;
  let revision = 0;
  const connection: HassConnection = {
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

  it("sends the expected revision when asked", async () => {
    const { hass, sent } = fakeHass();
    const client = DomoTwinClient.for(hass);
    await client.savePlan({ version: 1 }, 4);
    await client.savePlan(null);
    expect(sent).toEqual([
      { type: "domotwin/plan/save", plan: { version: 1 }, expected_revision: 4 },
      { type: "domotwin/plan/save", plan: null },
    ]);
  });
});
