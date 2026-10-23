import { describe, expect, it } from "vitest";

import { parseColor } from "../src/color";

describe("parseColor", () => {
  it("reads hex colours", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor(" #1C1c1E ")).toEqual({ r: 28, g: 28, b: 30 });
  });

  it("reads rgb() and rgba()", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor("rgba(10 20 300 / 0.5)")).toEqual({ r: 10, g: 20, b: 255 });
  });

  it("leaves other syntaxes to the browser", () => {
    expect(parseColor("var(--x)")).toBeUndefined();
    expect(parseColor("#12345")).toBeUndefined();
  });
});
