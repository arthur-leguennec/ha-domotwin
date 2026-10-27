/**
 * The wall screens (`docs/DECISIONS.md`, D-076): a device left on a wall names itself a screen
 * (kept on the device), and the integration keeps each screen's layout, set by an administrator:
 * the tab it opens on and its screen saver (the clock, the weather, photos of Home Assistant's
 * media), which comes once nothing is touched and nobody moves, and goes when someone does.
 */
import { SCREEN_NAME } from "../config";
import { domainOf, type HomeAssistant } from "../ha/types";
import { isTab, type Tab } from "./choices";
import { sameScreen } from "./show";

export { SCREEN_NAME };

/** What a screen saver shows and when it comes. */
export interface SaverLayout {
  /** Minutes with nothing touched and no one moving before it comes; 0: it never comes. */
  after: number;
  /** The binary sensors that wake the screen (motion, occupancy, presence). */
  wake: string[];
  /** Whether it shows the weather (the home's weather entity, D-072). */
  weather: boolean;
  /** A folder of Home Assistant's media whose photos it shows, one after another. */
  photos?: string;
  /** Seconds each photo is shown. */
  every: number;
  /** At night (the sun down), the clock alone, dimmed. */
  dim: boolean;
}

/** A screen's layout. */
export interface ScreenLayout {
  /** The tab it opens on and goes back to (else the device's own, else the user's). */
  start?: Tab;
  saver: SaverLayout;
}

/** Every screen's layout, by name. */
export type Screens = Record<string, ScreenLayout>;

export const NO_SAVER: SaverLayout = { after: 0, wake: [], weather: true, every: 30, dim: true };

/** As the integration keeps them: screens, sensors waking one, minutes before a saver. */
export const MAX_SCREENS = 20;
export const MAX_WAKE_SENSORS = 10;
export const MAX_SAVER_MINUTES = 240;
export const PHOTO_SECONDS: readonly [number, number] = [5, 3600];

/** The kinds of binary sensor that say someone is there. */
const WAKING = new Set(["motion", "occupancy", "presence"]);

/** Where this device keeps the screen it is, when it is one. */
const DEVICE_KEY = "domotwin-screen";

function wholeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** A saver as the integration answered it, what is not understood the default. */
export function readSaver(raw: unknown): SaverLayout {
  if (typeof raw !== "object" || raw === null) return { ...NO_SAVER, wake: [] };
  const value = raw as Record<string, unknown>;
  const wake = Array.isArray(value.wake)
    ? [
        ...new Set(
          value.wake.filter(
            (id): id is string => typeof id === "string" && domainOf(id) === "binary_sensor",
          ),
        ),
      ].slice(0, MAX_WAKE_SENSORS)
    : [];
  const saver: SaverLayout = {
    after: wholeNumber(value.after, 0, MAX_SAVER_MINUTES, 0),
    wake,
    weather: value.weather !== false,
    every: wholeNumber(value.every, PHOTO_SECONDS[0], PHOTO_SECONDS[1], NO_SAVER.every),
    dim: value.dim !== false,
  };
  if (typeof value.photos === "string" && value.photos.startsWith("media-source://")) {
    saver.photos = value.photos;
  }
  return saver;
}

/** The screens the integration answered, what is not understood left out. */
export function readScreens(raw: unknown): Screens {
  const screens: Screens = {};
  const all = (raw as { screens?: unknown } | null)?.screens;
  if (typeof all !== "object" || all === null) return screens;
  for (const [name, layout] of Object.entries(all as Record<string, unknown>)) {
    if (!SCREEN_NAME.test(name) || typeof layout !== "object" || layout === null) continue;
    const value = layout as Record<string, unknown>;
    const read: ScreenLayout = { saver: readSaver(value.saver) };
    if (isTab(value.start)) read.start = value.start;
    screens[name] = read;
  }
  return screens;
}

/** A screen's name as kept, whatever the case (`undefined`: no such screen). */
export function screenNamed(screens: Screens, name: string | undefined): string | undefined {
  if (!name) return undefined;
  return Object.keys(screens).find((key) => sameScreen(key, name));
}

/** The screen this device is, when it is one. */
export function readDeviceScreen(): string | undefined {
  try {
    const value = window.localStorage.getItem(DEVICE_KEY);
    return value && SCREEN_NAME.test(value) ? value : undefined;
  } catch {
    // Storage disabled (private browsing, policies).
    return undefined;
  }
}

/** Makes this device a screen, or none. */
export function writeDeviceScreen(name: string | undefined): void {
  try {
    if (name) window.localStorage.setItem(DEVICE_KEY, name);
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Kept for this visit only.
  }
}

/** The binary sensors that may wake a screen: motion, occupancy and presence, by name. */
export function wakeSensors(hass: HomeAssistant | undefined): string[] {
  if (!hass) return [];
  const name = (id: string): string => {
    const friendly = hass.states[id]?.attributes.friendly_name;
    return typeof friendly === "string" ? friendly : id;
  };
  return Object.keys(hass.states)
    .filter((id) => {
      if (domainOf(id) !== "binary_sensor") return false;
      const deviceClass = hass.states[id]?.attributes.device_class;
      return typeof deviceClass === "string" && WAKING.has(deviceClass);
    })
    .sort((a, b) => name(a).localeCompare(name(b)));
}

/** Whether someone is there: one of the sensors that wake the screen is on. */
export function someoneThere(hass: HomeAssistant | undefined, wake: readonly string[]): boolean {
  return !!hass && wake.some((id) => hass.states[id]?.state === "on");
}

/** Whether it is night where the home is: the sun down, as Home Assistant's `sun.sun` says. */
export function isNight(hass: HomeAssistant | undefined): boolean {
  return hass?.states["sun.sun"]?.state === "below_horizon";
}

/**
 * Whether the screen saver is due: it comes after `after` minutes with nothing touched and no
 * one moving (`quiet`: since when, in ms), never when `after` is 0.
 */
export function saverDue(saver: SaverLayout | undefined, quietSince: number, now: number): boolean {
  if (!saver || saver.after <= 0) return false;
  return now - quietSince >= saver.after * 60_000;
}
