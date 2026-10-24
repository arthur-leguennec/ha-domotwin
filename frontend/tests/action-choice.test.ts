import { describe, expect, it } from "vitest";

import { actionDraft, draftAction, validPath, validService } from "../src/live/action-choice";

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
      choice: "perform-action",
      service: "scene.turn_on",
      target: "scene.evening",
      path: "",
    });
    expect(actionDraft({ action: "navigate", navigation_path: "/lovelace/1" })).toMatchObject({
      choice: "navigate",
      path: "/lovelace/1",
    });
  });

  it("keeps what it does not show as written", () => {
    const withData = {
      action: "perform-action" as const,
      perform_action: "light.turn_on",
      data: { brightness_pct: 30 },
    };
    expect(actionDraft(withData).choice).toBe("custom");
    expect(draftAction(actionDraft(withData), withData)).toBe(withData);
    expect(actionDraft({ action: "toggle", entity_id: "light.other" }).choice).toBe("custom");
    expect(actionDraft({ action: "call-service", service: "light.toggle" }).choice).toBe("custom");
  });

  it("writes actions back, refusing invalid fields", () => {
    const base = {
      choice: "perform-action" as const,
      service: " light.turn_on ",
      target: "",
      path: "",
    };
    expect(draftAction(base)).toEqual({
      action: "perform-action",
      perform_action: "light.turn_on",
    });
    expect(draftAction({ ...base, target: "light.a" })).toEqual({
      action: "perform-action",
      perform_action: "light.turn_on",
      target: { entity_id: "light.a" },
    });
    expect(draftAction({ ...base, service: "turn on" })).toBeNull();
    expect(draftAction({ ...base, choice: "navigate", path: "lovelace" })).toBeNull();
    expect(draftAction({ ...base, choice: "auto" })).toBeUndefined();
    expect(draftAction({ ...base, choice: "none" })).toEqual({ action: "none" });
  });

  it("checks services and pages", () => {
    expect(validService("scene.turn_on")).toBe(true);
    expect(validService("Scene.Turn")).toBe(false);
    expect(validPath("/config/areas")).toBe(true);
    expect(validPath("http://x")).toBe(false);
  });
});
