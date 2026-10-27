import { describe, expect, it } from "vitest";

import {
  NO_WIFI,
  drawable,
  nameProblem,
  passwordProblem,
  readWifi,
  screenChosen,
  screensOf,
  wifiAnswer,
  withoutPassword,
  type StoredWifi,
} from "../src/live/wifi";

// A fictional guest network.
const GUESTS: StoredWifi = {
  name: "Fictional Guests",
  password: "tea-and-cake-42",
  security: "WPA",
  hidden: false,
  screens: ["hall"],
};

describe("the Wi-Fi for guests (D-062)", () => {
  it("reads the integration's answer, what cannot be read being no network", () => {
    expect(readWifi(null)).toEqual(NO_WIFI);
    expect(
      readWifi({ set: true, shown: true, name: "N", security: "WPA2", screens: [1, "a"] }),
    ).toEqual({ set: true, shown: true, name: "N", screens: ["a"] });
    expect(drawable(readWifi({ set: true, shown: true, name: "N" }))).toBe(true);
    expect(drawable(readWifi({ set: true, shown: false }))).toBe(false);
    expect(drawable(undefined)).toBe(false);
  });

  it("answers as the integration does: the password only when asked for", () => {
    expect(wifiAnswer(GUESTS, true)).toEqual({
      set: true,
      shown: true,
      name: "Fictional Guests",
      security: "WPA",
      hidden: false,
      screens: ["hall"],
    });
    expect(wifiAnswer(GUESTS, true, "", true).password).toBe("tea-and-cake-42");
    // A screen chosen, whatever the case of its name; the list of screens for administrators only.
    const seen = wifiAnswer(GUESTS, false, "HALL", true);
    expect(seen.password).toBe("tea-and-cake-42");
    expect(seen.screens).toBeUndefined();
    expect(wifiAnswer(GUESTS, false, "kitchen", true)).toEqual({ set: true, shown: false });
    expect(wifiAnswer(GUESTS, false, "", true)).toEqual({ set: true, shown: false });
    expect(wifiAnswer(undefined, true)).toEqual(NO_WIFI);
    expect(withoutPassword(wifiAnswer(GUESTS, true, "", true))).toEqual(wifiAnswer(GUESTS, true));
  });

  it("takes the screens written one after the other, whatever their case", () => {
    expect(screensOf(" hall, kitchen  hall,,")).toEqual(["hall", "kitchen"]);
    expect(screenChosen(["Hall"], "hall")).toBe(true);
    expect(screenChosen(["hall"], "")).toBe(false);
    expect(screenChosen([], "hall")).toBe(false);
  });

  it("checks a name and a password as phones take them", () => {
    expect(nameProblem("")).toBe("no_name");
    expect(nameProblem("n".repeat(32))).toBeUndefined();
    // 17 accented letters are 34 bytes.
    expect(nameProblem("é".repeat(17))).toBe("long_name");
    expect(passwordProblem("WPA", "tea-and-cake-42")).toBeUndefined();
    expect(passwordProblem("WPA", "short")).toBe("bad_wpa");
    expect(passwordProblem("WPA", "a".repeat(64))).toBeUndefined();
    expect(passwordProblem("WPA", "g".repeat(64))).toBe("bad_wpa");
    expect(passwordProblem("WPA", "thé-et-gâteau")).toBe("bad_wpa");
    expect(passwordProblem("WEP", "abcde")).toBeUndefined();
    expect(passwordProblem("WEP", "0123456789")).toBeUndefined();
    expect(passwordProblem("WEP", "abcdefg")).toBe("bad_wep");
    expect(passwordProblem("nopass", "")).toBeUndefined();
  });
});
