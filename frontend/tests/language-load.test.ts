import type { ReactiveElement } from "lit";
import { describe, expect, it, vi } from "vitest";

import { inLanguage } from "../src/components/define";
import { Translator, en, languageReady, loadLanguage } from "../src/i18n";

// Korean's module cannot be fetched here, as when the network goes while it loads.
vi.mock("../src/i18n/lang/ko", () => {
  throw new Error("offline");
});

/** A root element as `inLanguage` sees it: its `dir`. */
function host(): ReactiveElement {
  return { dir: "" } as unknown as ReactiveElement;
}

describe("languages loaded on demand (D-082)", () => {
  it("draws in English and French at once", () => {
    const element = host();
    const update = vi.fn();
    expect(inLanguage(element, () => ({ language: "en" }), update)).toBeUndefined();
    expect(inLanguage(element, () => ({ locale: { language: "fr-CA" } }), update)).toBeUndefined();
    expect(inLanguage(element, () => undefined, update)).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(3);
    expect(element.dir).toBe("ltr");
  });

  it("draws once another language's messages are here, in it", async () => {
    const element = host();
    const update = vi.fn(() => {
      // Drawn in Spanish, not in English.
      expect(new Translator("es").t("panel.cancel")).not.toBe(en.panel.cancel);
    });
    const waiting = inLanguage(element, () => ({ language: "es" }), update);
    expect(waiting).toBeInstanceOf(Promise);
    expect(update).not.toHaveBeenCalled();
    await waiting;
    expect(update).toHaveBeenCalledTimes(1);
    expect(element.dir).toBe("ltr");
  });

  it("waits for the language spoken when it is drawn, changed meanwhile", async () => {
    const element = host();
    let hass = { language: "it" };
    const update = vi.fn();
    const waiting = inLanguage(element, () => hass, update);
    hass = { language: "ar" };
    await waiting;
    expect(languageReady("it")).toBe(true);
    expect(languageReady("ar")).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    // Turned round once drawn in Arabic.
    expect(element.dir).toBe("rtl");
    expect(inLanguage(element, () => ({ language: "en" }), update)).toBeUndefined();
    expect(element.dir).toBe("ltr");
  });

  it("speaks English when a language cannot be loaded, without asking for it again", async () => {
    expect(languageReady("ko")).toBe(false);
    const update = vi.fn();
    await inLanguage(host(), () => ({ language: "ko" }), update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(languageReady("ko")).toBe(true);
    expect(inLanguage(host(), () => ({ language: "ko" }), update)).toBeUndefined();
    expect(new Translator("ko").t("panel.cancel")).toBe(en.panel.cancel);
    await loadLanguage("ko");
  });
});
