import { describe, expect, it } from "vitest";

import { fontFamily } from "../src/fonts";

describe("the card's font (D-042)", () => {
  it("is a font's name, or the theme's", () => {
    expect(fontFamily("Atkinson Hyperlegible")).toBe("Atkinson Hyperlegible");
    expect(fontFamily("Theme")).toContain("var(--ha-font-family-body");
  });
});
