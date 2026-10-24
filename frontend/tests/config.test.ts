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
      layer: "off",
      alerts: true,
      presence: true,
      sun: "fixed",
      badges: true,
      cameras: true,
      names: true,
      spread: true,
      roof: true,
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
        layer: "co2",
        alerts: false,
        presence: false,
        sun: "real",
        badges: false,
        cameras: false,
        names: false,
        storey: " all ",
        spread: false,
        roof: false,
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
      layer: "co2",
      alerts: false,
      presence: false,
      sun: "real",
      badges: false,
      cameras: false,
      names: false,
      storey: "all",
      spread: false,
      roof: false,
    });
  });

  it("reads a number height as pixels", () => {
    expect(normalizeConfig({ height: 420 }).height).toBe("420px");
  });

  it("keeps a look and an accent only when given", () => {
    const config = normalizeConfig({ theme: "neon", accent: " #FF2D95 " });
    expect([config.theme, config.accent]).toEqual(["neon", "#ff2d95"]);
    const plain = normalizeConfig({ theme: "", accent: null });
    expect("theme" in plain || "accent" in plain).toBe(false);
  });

  it.each([
    [{ view: "4d" }, "config.bad_view"],
    [{ quality: "ultra" }, "config.bad_quality"],
    [{ cutaway: "sometimes" }, "config.bad_cutaway"],
    [{ lighting: "noon" }, "config.bad_lighting"],
    [{ layer: "noise" }, "config.bad_layer"],
    [{ alerts: "yes" }, "config.bad_alerts"],
    [{ presence: 1 }, "config.bad_presence"],
    [{ sun: "moon" }, "config.bad_sun"],
    [{ badges: "on" }, "config.bad_badges"],
    [{ cameras: 0 }, "config.bad_cameras"],
    [{ names: "yes" }, "config.bad_names"],
    [{ spread: "apart" }, "config.bad_spread"],
    [{ roof: 1 }, "config.bad_roof"],
    [{ theme: "dark" }, "config.bad_theme"],
    [{ accent: "red" }, "config.bad_accent"],
    [{ accent: "#12345" }, "config.bad_accent"],
    [{ height: "tall" }, "config.bad_height"],
    [{ height: "100%" }, "config.bad_height"],
    [{ height: -3 }, "config.bad_height"],
  ])("refuses %o", (config, key) => {
    expect(() => normalizeConfig(config)).toThrow(ConfigError);
    expect(() => normalizeConfig(config)).toThrow(key);
  });
});
