import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { demoTexts } from "../scripts/demo-texts.mjs";

import {
  LANGUAGES,
  Translator,
  directionOf,
  en,
  languageReady,
  loadLanguage,
  type Language,
} from "../src/i18n";
import { englishChunks } from "../src/i18n/english";
import type { Pack } from "../src/i18n/pack";

/** The English of every message, as a pack has it: the demo house's by themselves. */
const english: Pack = {
  main: en,
  chunks: englishChunks,
  demo: Object.fromEntries(demoTexts(resolve(__dirname, "..")).map((text) => [text, text])),
};

const PLURAL_FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);

function isPlural(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "other" in value &&
    Object.keys(value).every((key) => PLURAL_FORMS.has(key))
  );
}

/** Every message of a pack: its path, and its text or plural forms. */
function messages(value: unknown, prefix = ""): [string, unknown][] {
  if (typeof value === "string" || isPlural(value)) return [[prefix, value]];
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    messages(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""))].sort();
}

const loaded = LANGUAGES.filter((language) => language !== "en" && language !== "fr");

describe("the languages loaded on demand (D-082)", async () => {
  const packs = new Map<Language, Pack>();
  for (const language of loaded) {
    const folder = language;
    packs.set(language, ((await import(`../src/i18n/lang/${folder}.ts`)) as { pack: Pack }).pack);
  }
  const englishMessages = new Map(messages(english));

  it("gives each message one place: no chunk says what the dictionary or another chunk says", () => {
    // A message is looked for in the dictionary, then in each chunk: one given twice would be
    // said by whichever was loaded first (the weekly report's title over a history report's).
    const places = new Map<string, string>();
    const twice: string[] = [];
    const parts: [string, unknown][] = [["main", en], ...Object.entries(englishChunks)];
    for (const [part, value] of parts) {
      for (const [key] of messages(value)) {
        const first = places.get(key);
        if (first) twice.push(`${key}: ${first} and ${part}`);
        else places.set(key, part);
      }
    }
    expect(twice).toEqual([]);
  });

  it.each(loaded)("%s has every English message, placeholders and plurals kept", (language) => {
    const pack = packs.get(language);
    if (!pack) throw new Error(language);
    const own = new Map(messages(pack));
    expect([...own.keys()].sort()).toEqual([...englishMessages.keys()].sort());
    const rules = new Intl.PluralRules(language);
    for (const [key, text] of englishMessages) {
      const translated = own.get(key);
      if (typeof text === "string") {
        expect(typeof translated, key).toBe("string");
        expect(String(translated).trim(), key).not.toBe("");
        expect(placeholders(String(translated)), key).toEqual(placeholders(text));
      } else {
        expect(isPlural(translated), key).toBe(true);
        const forms = translated as Record<string, string>;
        // Every form the language uses is given (else `other` is), each with the placeholders of
        // the English form it stands for (`other` for those English has not).
        const englishForms = text as Record<string, string>;
        for (const category of rules.resolvedOptions().pluralCategories) {
          const form = forms[category] ?? forms.other;
          expect(form, `${key}.${category}`).toBeTruthy();
          const wanted = placeholders(englishForms[category] ?? englishForms.other ?? "");
          expect(
            placeholders(form ?? "").filter((p) => p !== "count"),
            key,
          ).toEqual(wanted.filter((p) => p !== "count"));
        }
      }
    }
  });

  it.each(loaded)("%s is translated, not English", (language) => {
    const pack = packs.get(language);
    if (!pack) throw new Error(language);
    const own = new Map(messages(pack));
    let same = 0;
    let long = 0;
    for (const [key, text] of englishMessages) {
      // Short texts (a name, a unit) may well be the same.
      if (typeof text !== "string" || text.length < 24) continue;
      long += 1;
      if (own.get(key) === text) same += 1;
    }
    expect(same / long).toBeLessThan(0.05);
  });

  it.each(loaded)("%s names the demo house in its own words", (language) => {
    const demo = packs.get(language)?.demo ?? {};
    const texts = Object.keys(english.demo);
    // A name may be the same (TV, WC), not most of them.
    const same = texts.filter((text) => demo[text] === text).length;
    expect(same / texts.length).toBeLessThan(0.15);
  });

  it("loads a language when Home Assistant speaks it, and speaks it then", async () => {
    expect(languageReady("de")).toBe(false);
    expect(new Translator("de").t("panel.cancel")).toBe(en.panel.cancel);
    await loadLanguage("de");
    expect(languageReady("de")).toBe(true);
    const german = new Translator("de-DE");
    expect(german.t("panel.cancel")).toBe(packs.get("de")?.main.panel.cancel);
    expect(german.dir).toBe("ltr");
  });

  it("writes Arabic right to left, with its six plural forms", async () => {
    await loadLanguage("ar");
    expect(directionOf("ar")).toBe("rtl");
    const arabic = new Translator("ar");
    expect(arabic.dir).toBe("rtl");
    const forms = new Set([0, 1, 2, 3, 11, 100].map((n) => arabic.tp("view.rooms", n)));
    expect(forms.size).toBeGreaterThan(2);
  });
});
