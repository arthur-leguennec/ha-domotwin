import { describe, expect, it, vi } from "vitest";

import { Translator, en, languageReady, loadLanguage } from "../src/i18n";

// Arabic's module cannot be fetched here, as when the network goes while it loads.
vi.mock("../src/i18n/lang/ar", () => {
  throw new Error("offline");
});

describe("a right-to-left language that cannot be loaded (D-081)", () => {
  it("is spoken in English, left to right", async () => {
    await loadLanguage("ar");
    expect(languageReady("ar")).toBe(true);
    const arabic = new Translator("ar");
    expect(arabic.t("panel.cancel")).toBe(en.panel.cancel);
    expect(arabic.dir).toBe("ltr");
  });

  it("counts zero as Portugal does in Portuguese, as Brazil does in Brazil's", async () => {
    await Promise.all([loadLanguage("pt"), loadLanguage("pt-BR")]);
    const portugal = new Translator("pt");
    const brazil = new Translator("pt-BR");
    expect(portugal.tp("view.rooms", 0)).toBe(portugal.tp("view.rooms", 2).replace("2", "0"));
    expect(brazil.tp("view.rooms", 0)).toBe(brazil.tp("view.rooms", 1).replace("1", "0"));
  });
});
