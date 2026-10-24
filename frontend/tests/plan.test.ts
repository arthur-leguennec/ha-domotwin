import { beforeEach, describe, expect, it } from "vitest";

import { DOOR_STYLES, FLOORS, parseLength } from "../src/components/plan-bar";
import { PLAN_TOOLS, sideLabel } from "../src/components/plan-editor";
import { planCommandFor } from "../src/components/view";
import { en, fr } from "../src/i18n";
import {
  clearPlanDraft,
  readDraft,
  readPlanDraft,
  writeDraft,
  writePlanDraft,
} from "../src/live/draft";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("plan bar fields", () => {
  it("reads lengths in centimetres within their limits", () => {
    expect(parseLength("90", 20, 300)).toBe(90);
    expect(parseLength(" 82,5 ", 20, 300)).toBe(82.5);
    expect(parseLength("82.55", 20, 300)).toBe(82.6);
    expect(parseLength("5", 20, 300)).toBeUndefined();
    expect(parseLength("301", 20, 300)).toBeUndefined();
    expect(parseLength("12a", 1, 100)).toBeUndefined();
    expect(parseLength("-3", 1, 100)).toBeUndefined();
    expect(parseLength("", 1, 100)).toBeUndefined();
  });

  it("names every tool, floor and kind of door in both languages", () => {
    for (const dictionary of [en, fr]) {
      const plan = dictionary.plan as Record<string, string>;
      for (const tool of PLAN_TOOLS) {
        expect(plan[`tool_${tool}`]).toBeTruthy();
        expect(plan[`hint_${tool}`]).toBeTruthy();
      }
      for (const floor of FLOORS) expect(plan[`floor_${floor.replace(/-/g, "_")}`]).toBeTruthy();
      for (const style of DOOR_STYLES)
        expect(plan[`style_${style.replace(/-/g, "_")}`]).toBeTruthy();
    }
  });
});

describe("plan editor", () => {
  it("has keys to undo, redo, remove and let go", () => {
    expect(planCommandFor(key({ key: "Delete" }))).toBe("remove");
    expect(planCommandFor(key({ key: "Backspace" }))).toBe("remove");
    expect(planCommandFor(key({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(planCommandFor(key({ key: "Z", metaKey: true, shiftKey: true }))).toBe("redo");
    expect(planCommandFor(key({ key: "y", ctrlKey: true }))).toBe("redo");
    expect(planCommandFor(key({ key: "Escape" }))).toBe("clear");
    expect(planCommandFor(key({ key: "r" }))).toBeUndefined();
    expect(planCommandFor(key({ key: "z" }))).toBeUndefined();
  });

  it("writes a side's length outside the room, further beside an upright side", () => {
    const centre = { x: 50, y: 50 };
    // The top side: above it.
    expect(sideLabel({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, centre)).toEqual({
      x: 50,
      y: -18,
    });
    // The right side, either way round: to its right, clear of the text's width.
    for (const [a, b] of [
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      [
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ],
    ] as const) {
      const label = sideLabel(a, b, { x: 100, y: 50 }, centre);
      expect(label.x).toBeCloseTo(140);
      expect(label.y).toBeCloseTo(50);
    }
  });
});

describe("plan draft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the plan drawn for the revision and storey it started from, apart from edit mode's", () => {
    writePlanDraft({ revision: 4, storey: "storey-2", plan: { version: 1, elements: [] } });
    writeDraft({ revision: 4, storey: "storey-2", layout: { sofa: { x: 1 } } });
    expect(readPlanDraft(4, "storey-2")?.plan).toEqual({ version: 1, elements: [] });
    expect(readDraft(4, "storey-2")?.layout).toEqual({ sofa: { x: 1 } });
    // Another storey's draft stays for it, even when this one's is cleared.
    writePlanDraft({ revision: 4, storey: "", plan: { version: 1, elements: [], title: "New" } });
    expect(readPlanDraft(4, "")?.plan.title).toBe("New");
    clearPlanDraft("");
    expect(readPlanDraft(4, "")).toBeUndefined();
    expect(readPlanDraft(4, "storey-2")).toBeDefined();
    // Saved again since: stale, forgotten.
    expect(readPlanDraft(5, "storey-2")).toBeUndefined();
    expect(readPlanDraft(4, "storey-2")).toBeUndefined();
    expect(readDraft(4, "storey-2")).toBeDefined();
  });

  it("forgets a broken draft, and one from before storeys", () => {
    localStorage.setItem("domotwin-plan-draft:", "{");
    expect(readPlanDraft(1, "")).toBeUndefined();
    localStorage.setItem("domotwin-plan-draft:", JSON.stringify({ revision: 1, plan: [] }));
    expect(readPlanDraft(1, "")).toBeUndefined();
    localStorage.setItem("domotwin-plan-draft", JSON.stringify({ revision: 1, plan: {} }));
    expect(readPlanDraft(1, "")).toBeUndefined();
    expect(localStorage.getItem("domotwin-plan-draft")).toBeNull();
  });
});
