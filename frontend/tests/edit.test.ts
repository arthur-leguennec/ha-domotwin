import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { catalogueGroups, GROUPS } from "../src/components/edit-bar";
import type { CatalogueKind } from "../src/engine/engine";
import { Translator, en, fr } from "../src/i18n";
import {
  clearDemoDrafts,
  clearDraft,
  readDraft,
  readPlanDraft,
  writeDraft,
  writePlanDraft,
} from "../src/live/draft";

const kinds: CatalogueKind[] = [
  { kind: "sofa", w: 90, d: 210, h: 85, light: false },
  { kind: "table-lamp", w: 30, d: 30, h: 48, light: true },
  { kind: "floor-lamp", w: 35, d: 35, h: 160, light: true },
  { kind: "somethingnew", w: 10, d: 10, h: 10, light: false },
];

describe("catalogue", () => {
  it("groups kinds by room, unknown ones last", () => {
    const groups = catalogueGroups(kinds, new Translator("en"));
    expect(groups.map((g) => g.group)).toEqual(["living", "lights", "other"]);
    expect(groups[1]?.kinds.map((k) => k.kind)).toEqual(["floor-lamp", "table-lamp"]);
  });

  it("searches translated names without accents", () => {
    const fr = new Translator("fr");
    expect(catalogueGroups(kinds, fr, "canape").flatMap((g) => g.kinds.map((k) => k.kind))).toEqual(
      ["sofa"],
    );
    expect(catalogueGroups(kinds, fr, "LAMP").flatMap((g) => g.kinds.map((k) => k.kind))).toEqual([
      "floor-lamp",
      "table-lamp",
    ]);
    expect(catalogueGroups(kinds, fr, "zzz")).toEqual([]);
  });

  it("names every kind of the groups in both languages", () => {
    const names = Object.keys(en.kinds);
    for (const [, list] of GROUPS) {
      for (const kind of list) expect(names).toContain(kind);
    }
    expect(new Translator("fr").kind("sofa")).toBe("Canapé");
    expect(new Translator("en").kind("unknown-kind")).toBe("unknown-kind");
  });

  it("names the kinds of the plan format, and only those", () => {
    // The schema's kinds are the core's (crates/domotwin-core/tests/schema.rs).
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, "../../schema/plan.schema.json"), "utf8"),
    ) as { $defs: { item: { properties: { kind: { enum: string[] } } } } };
    const kinds = schema.$defs.item.properties.kind.enum;
    expect(Object.keys(en.kinds).sort()).toEqual([...kinds].sort());
    expect(Object.keys(fr.kinds).sort()).toEqual([...kinds].sort());
  });
});

describe("draft", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is kept for the revision and storey it started from", () => {
    writeDraft({ revision: 3, storey: "storey-1", layout: { sofa: { x: 1 } } });
    expect(readDraft(3, "storey-1")).toEqual({
      revision: 3,
      storey: "storey-1",
      layout: { sofa: { x: 1 } },
    });
    // Another storey's draft is its own, and stays.
    writeDraft({ revision: 3, storey: "storey-2", layout: { bed: { x: 2 } } });
    expect(readDraft(3, "storey-2")?.layout).toEqual({ bed: { x: 2 } });
    clearDraft("storey-2");
    expect(readDraft(3, "storey-1")?.layout).toEqual({ sofa: { x: 1 } });
    // Saved again since: stale, forgotten.
    expect(readDraft(4, "storey-1")).toBeUndefined();
    expect(readDraft(3, "storey-1")).toBeUndefined();
  });

  it("of the demo house are forgotten together, the home's kept (D-050)", () => {
    writeDraft({ revision: 1, storey: "demo/ground", layout: { sofa: { x: 1 } } });
    writePlanDraft({ revision: 1, storey: "demo/", plan: { version: 1 } });
    writeDraft({ revision: 1, storey: "ground", layout: { bed: { x: 2 } } });
    clearDemoDrafts();
    expect(readDraft(1, "demo/ground")).toBeUndefined();
    expect(readPlanDraft(1, "demo/")).toBeUndefined();
    expect(readDraft(1, "ground")?.layout).toEqual({ bed: { x: 2 } });
  });

  it("ignores what is not a draft, and a draft from before storeys", () => {
    window.localStorage.setItem("domotwin-edit-draft:s", "not json");
    expect(readDraft(1, "s")).toBeUndefined();
    window.localStorage.setItem(
      "domotwin-edit-draft:s",
      JSON.stringify({ revision: 1, layout: [] }),
    );
    expect(readDraft(1, "s")).toBeUndefined();
    window.localStorage.setItem(
      "domotwin-edit-draft",
      JSON.stringify({ revision: 1, layout: { sofa: { x: 1 } } }),
    );
    expect(readDraft(1, "")).toBeUndefined();
    expect(window.localStorage.getItem("domotwin-edit-draft")).toBeNull();
  });
});
