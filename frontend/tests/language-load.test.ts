import type { ReactiveElement } from "lit";
import { describe, expect, it, vi } from "vitest";

import { inLanguage } from "../src/components/define";
import { Translator, en, languageReady, loadLanguage, speak } from "../src/i18n";

// Korean's module cannot be fetched here, as when the network goes while it loads.
vi.mock("../src/i18n/lang/ko", () => {
  throw new Error("offline");
});

/** A root element as `inLanguage` sees it: its `dir`, and whether it was asked to draw again. */
function host(): ReactiveElement & { drawn: number } {
  const element = {
    dir: "",
    drawn: 0,
    requestUpdate() {
      element.drawn += 1;
    },
  };
  return element as unknown as ReactiveElement & { drawn: number };
}

describe("languages loaded on demand (D-081)", () => {
  it("speaks English and French at once", () => {
    const ready = vi.fn();
    expect(speak({ language: "en" }, ready)).toBe(true);
    expect(speak({ locale: { language: "fr-CA" } }, ready)).toBe(true);
    expect(speak(undefined, ready)).toBe(true);
    expect(ready).not.toHaveBeenCalled();
  });

  it("waits for another language's messages, then draws the element again in it", async () => {
    const element = host();
    const hass = { language: "es" };
    expect(inLanguage(element, hass)).toBe(false);
    expect(element.dir).toBe("ltr");
    // Meanwhile, what is asked for is said in English.
    expect(new Translator("es").tp("view.rooms", 2)).toBe(
      new Translator("en").tp("view.rooms", 2),
    );
    await loadLanguage("es");
    await Promise.resolve();
    expect(element.drawn).toBeGreaterThan(0);
    expect(inLanguage(element, hass)).toBe(true);
    expect(new Translator("es").t("panel.cancel")).not.toBe("");
  });

  it("writes Arabic right to left on the element", async () => {
    const element = host();
    inLanguage(element, { locale: { language: "ar" } });
    expect(element.dir).toBe("rtl");
    await loadLanguage("ar");
    expect(inLanguage(element, { language: "en" })).toBe(true);
    expect(element.dir).toBe("ltr");
  });

  it("speaks English when a language cannot be loaded, without asking for it again and again", async () => {
    expect(languageReady("ko")).toBe(false);
    const element = host();
    expect(inLanguage(element, { language: "ko" })).toBe(false);
    await loadLanguage("ko");
    await Promise.resolve();
    // Drawn again once, then ready: in English.
    expect(element.drawn).toBe(1);
    expect(languageReady("ko")).toBe(true);
    expect(inLanguage(element, { language: "ko" })).toBe(true);
    expect(new Translator("ko").t("panel.cancel")).toBe(en.panel.cancel);
  });
});
