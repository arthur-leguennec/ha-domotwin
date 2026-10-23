import { describe, expect, it } from "vitest";

import { ConfigError, normalizeConfig } from "../src/config";

describe("normalizeConfig", () => {
  it("fills in the defaults", () => {
    expect(normalizeConfig({ type: "custom:domotwin-card" })).toEqual({
      type: "custom:domotwin-card",
      view: "3d",
      quality: "auto",
      cutaway: "auto",
      lighting: "auto",
    });
  });

  it("keeps valid options and trims texts", () => {
    expect(
      normalizeConfig({
        type: "custom:domotwin-card",
        title: "  Home ",
        view: "2d",
        height: "60vh",
        quality: "eco",
        cutaway: "off",
        lighting: "night",
        room: "living",
        font_family: "Inter",
      }),
    ).toEqual({
      type: "custom:domotwin-card",
      title: "Home",
      view: "2d",
      height: "60vh",
      quality: "eco",
      cutaway: "off",
      lighting: "night",
      room: "living",
      font_family: "Inter",
    });
  });

  it("reads a number height as pixels", () => {
    expect(normalizeConfig({ height: 420 }).height).toBe("420px");
  });

  it.each([
    [{ view: "4d" }, "config.bad_view"],
    [{ quality: "ultra" }, "config.bad_quality"],
    [{ cutaway: "sometimes" }, "config.bad_cutaway"],
    [{ lighting: "noon" }, "config.bad_lighting"],
    [{ height: "tall" }, "config.bad_height"],
    [{ height: "100%" }, "config.bad_height"],
    [{ height: -3 }, "config.bad_height"],
  ])("refuses %o", (config, key) => {
    expect(() => normalizeConfig(config)).toThrow(ConfigError);
    expect(() => normalizeConfig(config)).toThrow(key);
  });
});
