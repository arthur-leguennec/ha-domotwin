import { describe, expect, it } from "vitest";

import { Translator, en, fr, pickLanguage } from "../src/i18n";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("dictionaries", () => {
  it("French has exactly the English keys", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it("every placeholder of a message exists in both languages", () => {
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    for (const key of keys(en)) {
      expect(placeholders(lookup(fr, key)), key).toEqual(placeholders(lookup(en, key)));
    }
  });

  it("no message is empty", () => {
    const leaves = (value: unknown): unknown[] =>
      typeof value === "object" && value !== null ? Object.values(value).flatMap(leaves) : [value];
    for (const text of [...leaves(en), ...leaves(fr)]) expect(String(text).trim()).not.toBe("");
  });
});

describe("Translator", () => {
  it("picks the language Home Assistant speaks, English otherwise (D-082)", () => {
    expect(pickLanguage("fr")).toBe("fr");
    expect(pickLanguage("fr-CA")).toBe("fr");
    expect(pickLanguage("FR_be")).toBe("fr");
    expect(pickLanguage("de")).toBe("de");
    expect(pickLanguage("de-CH")).toBe("de");
    expect(pickLanguage("pt")).toBe("pt");
    expect(pickLanguage("pt-BR")).toBe("pt-BR");
    expect(pickLanguage("pt_br")).toBe("pt-BR");
    expect(pickLanguage("zh_Hant_TW")).toBe("zh-Hans");
    expect(pickLanguage("zh-Hant")).toBe("zh-Hans");
    expect(pickLanguage("sv")).toBe("en");
    expect(pickLanguage(undefined)).toBe("en");
  });

  it("formats placeholders", () => {
    expect(new Translator("en").t("panel.imported", { title: "Demo" })).toBe(
      "Plan imported: Demo.",
    );
    expect(new Translator("fr").t("panel.imported", { title: "Démo" })).toBe(
      "Plan importé : Démo.",
    );
  });

  it("uses the plural rules of the language", () => {
    const english = new Translator("en");
    expect(english.tp("view.rooms", 1)).toBe("1 room");
    expect(english.tp("view.rooms", 0)).toBe("0 rooms");
    const french = new Translator("fr");
    expect(french.tp("view.rooms", 0)).toBe("0 pièce");
    expect(french.tp("view.rooms", 1)).toBe("1 pièce");
    expect(french.tp("view.rooms", 5)).toBe("5 pièces");
  });

  it("translates engine and websocket error codes", () => {
    const t = new Translator("en");
    expect(t.error("not_a_plan")).toBe("it is not a DomoTwin plan.");
    expect(t.error("revision_conflict")).toContain("someone saved");
    expect(t.error("weird")).toBe("unexpected error (weird).");
  });
});
