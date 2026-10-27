import { describe, expect, it } from "vitest";

import { addMessages, translatorFor } from "../src/i18n";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { measuredEn, measuredFr } from "../src/i18n/measured";
import { measureTable, type LocatingMeasure } from "../src/live/measured";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

// The texts come with the Bluetooth settings' chunk.
addMessages({ en: measuredEn, fr: measuredFr });

describe("locating measured (D-073)", () => {
  it("copies the measurements as a table, the devices numbered (M41)", () => {
    const figures = {
      hours: 5.5,
      changes_per_hour: 6.8,
      storey_changes_per_hour: 1.9,
      short_stays: 2,
      unknown_share: 0.03,
      witnessed_hours: 2.4,
      right_share: 0.97,
    };
    const measure: LocatingMeasure = {
      since: "2026-03-02T09:00:00+00:00",
      devices: {
        sam_watch: { domotwin: { ...figures, right_share: null, witnessed_hours: 0 } },
        alex_phone: {
          domotwin: figures,
          domotwin_areas: { ...figures, changes_per_hour: 5.1 },
          bermuda: { ...figures, changes_per_hour: 38.4, short_stays: 157 },
          agreement: 0.88,
        },
      },
    };
    const t = translatorFor({ language: "en" });
    const table = measureTable(measure, (key, params) => t.t(key, params)).split("\n");
    expect(table[0]).toBe(
      "| Device | Way | Hours measured | Room changes / h | Storey changes / h | Stays < 30 s | Time in no room | Right when witnessed | Same as Bermuda |",
    );
    expect(table).toHaveLength(6);
    // Sorted by id, numbered: no names.
    expect(table[2]).toBe("| Device 1 | DomoTwin | 5.5 | 6.8 | 1.9 | 2 | 3 % | 97 % (2.4 h) |  |");
    // DomoTwin counted by area beside Bermuda, the agreement on its row.
    expect(table[3]).toBe(
      "| Device 1 | DomoTwin (areas) | 5.5 | 5.1 | 1.9 | 2 | 3 % | 97 % (2.4 h) | 88 % |",
    );
    expect(table[4]).toBe(
      "| Device 1 | Bermuda | 5.5 | 38.4 | 1.9 | 157 | 3 % | 97 % (2.4 h) |  |",
    );
    expect(table[5]).toBe("| Device 2 | DomoTwin | 5.5 | 6.8 | 1.9 | 2 | 3 % | – (0 h) |  |");
    expect(table.join("\n")).not.toContain("alex");
  });

  it("has its messages in both languages, none of the dictionaries'", () => {
    expect(keys(measuredFr).sort()).toEqual(keys(measuredEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(measuredEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(measuredEn)) {
      expect(placeholders(lookup(measuredFr, key)), key).toEqual(
        placeholders(lookup(measuredEn, key)),
      );
    }
  });
});
