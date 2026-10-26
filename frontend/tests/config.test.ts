import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_ACCENT,
  NEON_ACCENT,
  defaultAccent,
  normalizeConfig,
} from "../src/config";

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
      people: true,
      sun: "fixed",
      badges: true,
      cameras: true,
      names: true,
      small_rooms: false,
      spread: true,
      roof: true,
      idle: 0,
      orbit: false,
      night_dim: false,
      tools: true,
      voice: true,
      demo: false,
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
        people: false,
        sun: "real",
        badges: false,
        cameras: false,
        names: false,
        small_rooms: true,
        storey: " all ",
        spread: false,
        roof: false,
        idle: 120,
        orbit: true,
        night_dim: true,
        tools: false,
        screen: " hallway ",
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
      people: false,
      sun: "real",
      badges: false,
      cameras: false,
      names: false,
      small_rooms: true,
      storey: "all",
      spread: false,
      roof: false,
      idle: 120,
      orbit: true,
      night_dim: true,
      tools: false,
      voice: true,
      screen: "hallway",
      demo: false,
    });
  });

  it("reads the kiosk's wait from the visual editor's text", () => {
    expect(normalizeConfig({ idle: "300" }).idle).toBe(300);
    expect(normalizeConfig({ idle: "" }).idle).toBe(0);
  });

  it("reads a number height as pixels", () => {
    expect(normalizeConfig({ height: 420 }).height).toBe("420px");
  });

  it("keeps a look and an accent only when given", () => {
    const config = normalizeConfig({ theme: "neon", accent: " #FF2D95 " });
    expect([config.theme, config.accent]).toEqual(["neon", "#ff2d95"]);
    expect(normalizeConfig({ theme: "cartoon" }).theme).toBe("cartoon");
    expect(normalizeConfig({ theme: "clay" }).theme).toBe("clay");
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
    [{ people: "yes" }, "config.bad_people"],
    [{ sun: "moon" }, "config.bad_sun"],
    [{ badges: "on" }, "config.bad_badges"],
    [{ cameras: 0 }, "config.bad_cameras"],
    [{ names: "yes" }, "config.bad_names"],
    [{ small_rooms: 1 }, "config.bad_small_rooms"],
    [{ spread: "apart" }, "config.bad_spread"],
    [{ roof: 1 }, "config.bad_roof"],
    [{ idle: -1 }, "config.bad_idle"],
    [{ idle: 1.5 }, "config.bad_idle"],
    [{ idle: 90_000 }, "config.bad_idle"],
    [{ idle: "soon" }, "config.bad_idle"],
    [{ orbit: "yes" }, "config.bad_orbit"],
    [{ demo: "yes" }, "config.bad_demo"],
    [{ night_dim: 1 }, "config.bad_night_dim"],
    [{ tools: "no" }, "config.bad_tools"],
    [{ screen: "hall way" }, "config.bad_screen"],
    [{ screen: 3 }, "config.bad_screen"],
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

describe("defaultAccent", () => {
  it("gives each look its own", () => {
    expect(defaultAccent("neon")).toBe(NEON_ACCENT);
    for (const look of ["day", "blueprint", "cartoon", "clay"] as const) {
      expect(defaultAccent(look)).toBe(DEFAULT_ACCENT);
    }
  });
});
