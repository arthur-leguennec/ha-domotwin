import { describe, expect, it } from "vitest";

import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { iphoneEn, iphoneFr } from "../src/i18n/iphone";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("an iPhone's key (D-075)", () => {
  it("has its messages in both languages, none of the dictionaries'", () => {
    expect(keys(iphoneFr).sort()).toEqual(keys(iphoneEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(iphoneEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(iphoneEn)) {
      expect(placeholders(lookup(iphoneFr, key)), key).toEqual(placeholders(lookup(iphoneEn, key)));
    }
    // Its refusals are said in both languages too.
    for (const code of ["invalid_key", "key_not_heard", "key_refused"] as const) {
      expect(en.errors.ws[code]).toBeTruthy();
      expect(fr.errors.ws[code]).toBeTruthy();
    }
  });
});
