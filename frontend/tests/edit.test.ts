import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { catalogueGroups, GROUPS, pieceKey, styleName } from "../src/components/edit-bar";
import type { CatalogueKind } from "../src/engine/engine";
import { Translator, en, fr } from "../src/i18n";
import { libraryEn, libraryFr } from "../src/i18n/library";
import {
  clearDemoDrafts,
  clearDraft,
  readDraft,
  readPlanDraft,
  writeDraft,
  writePlanDraft,
} from "../src/live/draft";

const kinds: CatalogueKind[] = [
  {
    kind: "sofa",
    w: 210,
    d: 90,
    h: 85,
    light: false,
    styles: [
      { style: "leather", w: 210, d: 90, h: 85 },
      { style: "chesterfield", w: 215, d: 92, h: 76 },
    ],
  },
  { kind: "table-lamp", w: 30, d: 30, h: 48, light: true, styles: [] },
  {
    kind: "floor-lamp",
    w: 35,
    d: 35,
    h: 160,
    light: true,
    styles: [{ style: "arc", w: 40, d: 150, h: 205 }],
  },
  { kind: "heat-pump", w: 90, d: 22, h: 30, light: false, styles: [] },
  { kind: "somethingnew", w: 10, d: 10, h: 10, light: false, styles: [] },
];

const keys = (groups: ReturnType<typeof catalogueGroups>): string[] =>
  groups.flatMap((g) => g.pieces.map(pieceKey));

describe("catalogue", () => {
  it("groups the pieces by room, each kind then its styles, unknown kinds last", () => {
    const groups = catalogueGroups(kinds, new Translator("en"));
    expect(groups.map((g) => g.group)).toEqual(["living", "climate", "lights", "other"]);
    expect(keys(groups.slice(0, 1))).toEqual(["sofa", "sofa.leather", "sofa.chesterfield"]);
    expect(keys(groups.slice(2, 3))).toEqual(["floor-lamp", "floor-lamp.arc", "table-lamp"]);
    // A style's usual size is its own.
    expect(groups[0]?.pieces[2]).toEqual({
      kind: "sofa",
      style: "chesterfield",
      w: 215,
      d: 92,
      h: 76,
    });
  });

  it("searches names, styles and other words, accents and case aside", () => {
    const fr = new Translator("fr");
    expect(keys(catalogueGroups(kinds, fr, "canape"))).toEqual([
      "sofa",
      "sofa.leather",
      "sofa.chesterfield",
    ]);
    expect(keys(catalogueGroups(kinds, fr, "CUIR"))).toEqual(["sofa.leather"]);
    expect(keys(catalogueGroups(kinds, fr, "lampadaire arc"))).toEqual(["floor-lamp.arc"]);
    expect(keys(catalogueGroups(kinds, fr, "LAMP"))).toEqual([
      "floor-lamp",
      "floor-lamp.arc",
      "table-lamp",
    ]);
    // Other words: the French "pompe à chaleur" is a thermopompe; the English a mini-split.
    expect(keys(catalogueGroups(kinds, fr, "pompe a chaleur"))).toEqual(["heat-pump"]);
    expect(keys(catalogueGroups(kinds, new Translator("en"), "mini-split"))).toEqual(["heat-pump"]);
    expect(catalogueGroups(kinds, fr, "zzz")).toEqual([]);
  });

  it("names every style in both languages, else the style itself", () => {
    const english = new Translator("en");
    const french = new Translator("fr");
    expect(styleName(english, "speaker", "soundbar")).toBe("Soundbar");
    expect(styleName(french, "speaker", "soundbar")).toBe("Barre de son");
    expect(styleName(english, "sofa", "unknown")).toBe("unknown");
    const words = (dict: Record<string, Record<string, string>>): string[] =>
      Object.entries(dict).flatMap(([kind, styles]) =>
        Object.keys(styles).map((s) => `${kind}.${s}`),
      );
    expect(words(libraryFr.library.styles).sort()).toEqual(words(libraryEn.library.styles).sort());
    expect(Object.keys(libraryFr.library.search).sort()).toEqual(
      Object.keys(libraryEn.library.search).sort(),
    );
    for (const kind of Object.keys(libraryEn.library.search)) {
      expect(Object.keys(en.kinds)).toContain(kind);
    }
  });

  it("names every kind of the groups in both languages, each in one group", () => {
    const names = Object.keys(en.kinds);
    const grouped = GROUPS.flatMap(([, list]) => list);
    for (const kind of grouped) expect(names).toContain(kind);
    expect(new Set(grouped).size).toBe(grouped.length);
    // Every kind but stairs (the plan editor's) has a group.
    expect(names.filter((k) => !grouped.includes(k as never)).sort()).toEqual(["box", "stairs"]);
    expect(new Translator("fr").kind("sofa")).toBe("Canapé");
    expect(new Translator("fr").kind("heat-pump")).toBe("Thermopompe");
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
