import { beforeEach, describe, expect, it } from "vitest";

import { catalogueGroups, GROUPS } from "../src/components/edit-bar";
import type { CatalogueKind } from "../src/engine/engine";
import { Translator, en } from "../src/i18n";
import { clearDraft, readDraft, writeDraft } from "../src/live/draft";

const kinds: CatalogueKind[] = [
  { kind: "sofa", w: 90, d: 210, h: 85, light: false },
  { kind: "tablelamp", w: 30, d: 30, h: 48, light: true },
  { kind: "lamp", w: 35, d: 35, h: 160, light: true },
  { kind: "somethingnew", w: 10, d: 10, h: 10, light: false },
];

describe("catalogue", () => {
  it("groups kinds by room, unknown ones last", () => {
    const groups = catalogueGroups(kinds, new Translator("en"));
    expect(groups.map((g) => g.group)).toEqual(["living", "lights", "other"]);
    expect(groups[1]?.kinds.map((k) => k.kind)).toEqual(["lamp", "tablelamp"]);
  });

  it("searches translated names without accents", () => {
    const fr = new Translator("fr");
    expect(catalogueGroups(kinds, fr, "canape").flatMap((g) => g.kinds.map((k) => k.kind))).toEqual(
      ["sofa"],
    );
    expect(catalogueGroups(kinds, fr, "LAMP").flatMap((g) => g.kinds.map((k) => k.kind))).toEqual([
      "lamp",
      "tablelamp",
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
});

describe("draft", () => {
  beforeEach(() => {
    clearDraft();
  });

  it("is kept for the revision it started from", () => {
    writeDraft({ revision: 3, layout: { sofa: { x: 1 } } });
    expect(readDraft(3)).toEqual({ revision: 3, layout: { sofa: { x: 1 } } });
    // Saved again since: stale, forgotten.
    expect(readDraft(4)).toBeUndefined();
    expect(readDraft(3)).toBeUndefined();
  });

  it("ignores what is not a draft", () => {
    window.localStorage.setItem("domotwin-edit-draft", "not json");
    expect(readDraft(1)).toBeUndefined();
    window.localStorage.setItem("domotwin-edit-draft", JSON.stringify({ revision: 1, layout: [] }));
    expect(readDraft(1)).toBeUndefined();
  });
});
