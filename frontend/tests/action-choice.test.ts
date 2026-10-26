import { describe, expect, it } from "vitest";

import {
  actionDraft,
  draftAction,
  parseData,
  validPath,
  validService,
  type ActionDraft,
} from "../src/live/action-choice";
import type { Action } from "../src/live/bindings";

const EMPTY: ActionDraft = {
  choice: "auto",
  preset: "",
  service: "",
  target: "",
  data: "",
  path: "",
};

describe("action drafts", () => {
  it("reads the actions the editor shows", () => {
    expect(actionDraft(undefined).choice).toBe("auto");
    expect(actionDraft({ action: "toggle" }).choice).toBe("toggle");
    expect(actionDraft({ action: "controls" }).choice).toBe("controls");
    expect(
      actionDraft({
        action: "perform-action",
        perform_action: "scene.turn_on",
        target: { entity_id: "scene.evening" },
      }),
    ).toEqual({
      ...EMPTY,
      choice: "perform-action",
      service: "scene.turn_on",
      target: "scene.evening",
    });
    expect(actionDraft({ action: "navigate", navigation_path: "/lovelace/1" })).toMatchObject({
      choice: "navigate",
      path: "/lovelace/1",
    });
  });

  it("reads a device's plain actions as such (D-047)", () => {
    const tv = ["media_player.tv"];
    const up: Action = {
      action: "perform-action",
      perform_action: "media_player.volume_up",
      target: { entity_id: "media_player.tv" },
    };
    expect(actionDraft(up, tv)).toMatchObject({
      choice: "preset",
      preset: "media_player.tv volume_up",
    });
    // Not one of the piece's devices: an action like any other.
    expect(actionDraft(up, []).choice).toBe("perform-action");
    // A bare toggle is the main device's.
    expect(actionDraft({ action: "toggle" }, ["light.a"], "light.a")).toMatchObject({
      choice: "preset",
      preset: "light.a toggle",
    });
  });

  it("writes a plain action, keeping one left as written", () => {
    const draft = { ...EMPTY, choice: "preset" as const, preset: "media_player.tv mute" };
    expect(draftAction(draft)).toEqual({
      action: "perform-action",
      perform_action: "media_player.volume_mute",
      target: { entity_id: "media_player.tv" },
      data: { is_volume_muted: true },
    });
    const bare: Action = { action: "toggle" };
    const toggle = { ...EMPTY, choice: "preset" as const, preset: "light.a toggle" };
    expect(draftAction(toggle, bare, ["light.a"], "light.a")).toBe(bare);
    expect(draftAction({ ...toggle, preset: "light.a nothing" })).toBeNull();
  });

  it("keeps an action left as it was, and fields it does not show", () => {
    const confirmed = {
      action: "perform-action" as const,
      perform_action: "script.film",
      confirmation: { text: "Sure?" },
    } as Action;
    expect(actionDraft(confirmed).choice).toBe("custom");
    expect(draftAction(actionDraft(confirmed), confirmed)).toBe(confirmed);
    // Read and written back unchanged: the very object, its order of keys kept.
    const written: Action = {
      target: { entity_id: "light.a" },
      perform_action: "light.turn_on",
      action: "perform-action",
      data: { brightness_pct: 30 },
    };
    expect(draftAction(actionDraft(written), written)).toBe(written);
  });

  it("keeps what it does not show as written", () => {
    const area: Action = {
      action: "perform-action",
      perform_action: "light.turn_on",
      target: { area_id: "living_room" },
    };
    expect(actionDraft(area).choice).toBe("custom");
    expect(draftAction(actionDraft(area), area)).toBe(area);
    expect(actionDraft({ action: "toggle", entity_id: "light.other" }).choice).toBe("custom");
    expect(actionDraft({ action: "call-service", service: "light.toggle" }).choice).toBe("custom");
    // Data too long to type again.
    const long: Action = {
      action: "perform-action",
      perform_action: "notify.phone",
      data: { message: "x".repeat(2500) },
    };
    expect(actionDraft(long).choice).toBe("custom");
  });

  it("writes actions back with their data, refusing invalid fields", () => {
    const base = { ...EMPTY, choice: "perform-action" as const, service: " light.turn_on " };
    expect(draftAction(base)).toEqual({
      action: "perform-action",
      perform_action: "light.turn_on",
    });
    expect(draftAction({ ...base, target: "light.a", data: '{"brightness_pct": 30}' })).toEqual({
      action: "perform-action",
      perform_action: "light.turn_on",
      target: { entity_id: "light.a" },
      data: { brightness_pct: 30 },
    });
    // Data written in the advanced mode reads back.
    const withData: Action = {
      action: "perform-action",
      perform_action: "light.turn_on",
      data: { brightness_pct: 30 },
    };
    expect(actionDraft(withData)).toMatchObject({ data: '{"brightness_pct":30}' });
    expect(draftAction({ ...base, data: "[1]" })).toBeNull();
    expect(draftAction({ ...base, service: "turn on" })).toBeNull();
    expect(draftAction({ ...base, choice: "navigate", path: "lovelace" })).toBeNull();
    expect(draftAction({ ...base, choice: "auto" })).toBeUndefined();
    expect(draftAction({ ...base, choice: "none" })).toEqual({ action: "none" });
  });

  it("checks services, pages and data", () => {
    expect(validService("scene.turn_on")).toBe(true);
    expect(validService("Scene.Turn")).toBe(false);
    expect(validPath("/config/areas")).toBe(true);
    expect(validPath("http://x")).toBe(false);
    expect(parseData("")).toBeUndefined();
    expect(parseData(' {"a": 1} ')).toEqual({ a: 1 });
    expect(parseData("{")).toBeNull();
    expect(parseData("null")).toBeNull();
    expect(parseData(`{"a": "${"x".repeat(3000)}"}`)).toBeNull();
  });
});
