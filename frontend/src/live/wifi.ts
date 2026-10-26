/**
 * The home's Wi-Fi for guests (`docs/DECISIONS.md`, D-058): what `domotwin/wifi/get` says of it,
 * as the asker may see it. An administrator sees it all; a screen an administrator chose (a card's
 * `screen`, D-029) what draws the QR code; elsewhere only whether there is one.
 */

import { SCREEN_NAME } from "../config";
import { sameScreen } from "./show";

export { SCREEN_NAME };

export const WIFI_SECURITIES = ["WPA", "WEP", "nopass"] as const;
/** The most screens that show it, as the integration takes them. */
export const MAX_WIFI_SCREENS = 20;
export type WifiSecurity = (typeof WIFI_SECURITIES)[number];

export interface Wifi {
  /** Whether a network was given. */
  set: boolean;
  /** Whether it may be shown here. */
  shown: boolean;
  name?: string;
  password?: string;
  security?: WifiSecurity;
  hidden?: boolean;
  /** The router's own QR code (an `image` entity): shown as it is. */
  image?: string;
  /** The screens that show it (administrators only). */
  screens?: string[];
}

/** What is saved: the network typed, or the router's code; a password left out is kept. */
export interface WifiChange {
  name?: string;
  password?: string;
  security: WifiSecurity;
  hidden: boolean;
  image?: string;
  screens: string[];
}

export const NO_WIFI: Wifi = { set: false, shown: false };

const isSecurity = (value: unknown): value is WifiSecurity =>
  (WIFI_SECURITIES as readonly unknown[]).includes(value);

/**
 * The answer as kept while the dialog is closed: the password is asked for only when it opens
 * (`domotwin/wifi/get` with `password`).
 */
export function withoutPassword(wifi: Wifi): Wifi {
  const kept = { ...wifi };
  delete kept.password;
  return kept;
}

/** Whether a screen is one of those chosen, as cards match their `screen`: whatever the case. */
export function screenChosen(screens: readonly string[], screen: string): boolean {
  return screen !== "" && screens.some((chosen) => sameScreen(chosen, screen));
}

/** Reads `domotwin/wifi/get`'s answer; what cannot be read is no network. */
export function readWifi(raw: unknown): Wifi {
  if (typeof raw !== "object" || raw === null) return NO_WIFI;
  const value = raw as Record<string, unknown>;
  const wifi: Wifi = { set: value.set === true, shown: value.shown === true };
  if (typeof value.name === "string") wifi.name = value.name;
  if (typeof value.password === "string") wifi.password = value.password;
  if (isSecurity(value.security)) wifi.security = value.security;
  if (typeof value.hidden === "boolean") wifi.hidden = value.hidden;
  if (typeof value.image === "string") wifi.image = value.image;
  if (Array.isArray(value.screens)) {
    wifi.screens = value.screens.filter((s): s is string => typeof s === "string");
  }
  return wifi;
}

/** Whether there is something to draw: the router's code, or a network's name. */
export function drawable(wifi: Wifi | undefined): boolean {
  return wifi?.shown === true && (wifi.image !== undefined || wifi.name !== undefined);
}

/** The screens written in a field, one name after the other (commas or spaces between). */
export function screensOf(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((s) => s !== ""))];
}

/** Why a network's name cannot be joined, if it cannot: Wi-Fi takes 1 to 32 bytes. */
export function nameProblem(name: string): "no_name" | "long_name" | undefined {
  if (name === "") return "no_name";
  return new TextEncoder().encode(name).length > 32 ? "long_name" : undefined;
}

/**
 * Why a password does not suit its kind of network, as the integration says it (`bad_wpa`,
 * `bad_wep`), if it does not: WPA takes 8 to 63 printable characters or 64 hexadecimal, WEP 5 or 13
 * characters or 10 or 26 hexadecimal.
 */
export function passwordProblem(
  security: WifiSecurity,
  password: string,
): "bad_wpa" | "bad_wep" | undefined {
  const printable = /^[\x20-\x7e]*$/.test(password);
  const hexadecimal = /^[0-9a-fA-F]*$/.test(password);
  const length = password.length;
  if (security === "WEP") {
    const fits =
      ([5, 13].includes(length) && printable) || ([10, 26].includes(length) && hexadecimal);
    return fits ? undefined : "bad_wep";
  }
  if (security === "WPA") {
    const fits = (length >= 8 && length <= 63 && printable) || (length === 64 && hexadecimal);
    return fits ? undefined : "bad_wpa";
  }
  return undefined;
}

/** The network as a home kept in the page keeps it (D-050): what the integration would store. */
export type StoredWifi = WifiChange;

/** What `domotwin/wifi/get` answers for `stored`, as the integration does (`Wifi.get`). */
export function wifiAnswer(
  stored: StoredWifi | undefined,
  admin: boolean,
  screen = "",
  password = false,
): Wifi {
  if (!stored) return NO_WIFI;
  const shown = admin || screenChosen(stored.screens, screen);
  if (!shown) return { set: true, shown: false };
  const answer: Wifi = {
    set: true,
    shown: true,
    security: stored.security,
    hidden: stored.hidden,
  };
  if (stored.name !== undefined) answer.name = stored.name;
  if (password && stored.password !== undefined) answer.password = stored.password;
  if (stored.image !== undefined) answer.image = stored.image;
  if (admin) answer.screens = [...stored.screens];
  return answer;
}
