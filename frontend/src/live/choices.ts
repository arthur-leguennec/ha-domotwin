/**
 * Each user's own choices (D-055): their favourites, the tab DomoTwin opens on, their Home tab's
 * cards and shortcuts (D-084), kept by the integration for each user; a device may open on a tab
 * of its own.
 */

import { domainOf } from "../ha/types";
import { isSummary, type SummaryKind } from "./overview";

/** The panel's tabs: the Safety tab came with M25 (D-068), the Energy tab with M54 (D-092). */
export type Tab = "home" | "rooms" | "safety" | "3d" | "energy";
/** The tabs DomoTwin may open on (the Energy tab is there when the home has some). */
export const TABS: readonly Tab[] = ["home", "rooms", "safety", "3d"];
/** The tabs an address may show. */
const ROUTED: readonly Tab[] = [...TABS, "energy"];

/** A card of the Home tab: Home Assistant's own, as it takes them. */
export type HomeCard =
  | { type: "calendar"; entities: string[] }
  | { type: "todo-list"; entity: string }
  | { type: "summary"; summary: SummaryKind };

/** What the integration keeps for the user. */
export interface Choices {
  favourites: string[];
  cards: HomeCard[];
  /**
   * The Home tab's shortcuts (D-084), in their order, as the integration keeps them: the Home tab
   * reads them (`readShortcuts`), with its chunk rather than with the first load.
   */
  shortcuts: readonly unknown[];
  /** The tab DomoTwin opens on, when the user chose one. */
  start?: Tab;
}

export const NO_CHOICES: Choices = { favourites: [], cards: [], shortcuts: [] };

/** As many cards as the integration keeps on a Home tab, and calendars in an agenda. */
export const MAX_HOME_CARDS = 6;
export const MAX_CALENDARS = 10;

/** Where this device keeps the tab it opens on, when it has one of its own. */
const DEVICE_KEY = "domotwin-start";

export function isTab(value: unknown): value is Tab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

/** The tab this device opens on, when it has one of its own. */
export function readDeviceStart(): Tab | undefined {
  try {
    const value = window.localStorage.getItem(DEVICE_KEY);
    return isTab(value) ? value : undefined;
  } catch {
    // Storage disabled (private browsing, policies).
    return undefined;
  }
}

/** Gives this device a tab of its own, or none (`undefined`: the user's). */
export function writeDeviceStart(tab: Tab | undefined): void {
  try {
    if (tab) window.localStorage.setItem(DEVICE_KEY, tab);
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Kept for this visit only.
  }
}

/**
 * The tab DomoTwin opens on: this device's own, else the user's, else Home. A device that cannot
 * draw in 3D does not open on it.
 */
export function startTab(choices: Choices, device: Tab | undefined, can3d: boolean): Tab {
  const tab = device ?? choices.start ?? "home";
  return tab === "3d" && !can3d ? "home" : tab;
}

/** Whether this browser can draw in 3D (WebGL 2). */
export function canDraw3d(): boolean {
  return typeof WebGL2RenderingContext !== "undefined";
}

/**
 * The tab a path of the panel shows (Home Assistant gives the path after its own), a room, and
 * whether its graphs (D-069).
 */
export function routeOf(path: string | undefined): { tab?: Tab; area?: string; graphs?: boolean } {
  const [, first, second, third] = (path ?? "").split("/");
  if (!(ROUTED as readonly (string | undefined)[]).includes(first)) return {};
  if (!isTab(first)) return { tab: first as Tab };
  if (first === "rooms" && second) {
    try {
      const area = decodeURIComponent(second);
      return third === "graphs" ? { tab: first, area, graphs: true } : { tab: first, area };
    } catch {
      // A broken address: the rooms.
      return { tab: first };
    }
  }
  return { tab: first };
}

/** The path of a tab, of a room in the Rooms tab, and of its graphs (D-069). */
export function pathOf(tab: Tab, area?: string, graphs = false): string {
  if (tab !== "rooms" || !area) return `/${tab}`;
  return `/rooms/${encodeURIComponent(area)}${graphs ? "/graphs" : ""}`;
}

/** Favourites shown as big buttons: scenes and scripts. */
export function isPressed(id: string): boolean {
  const domain = domainOf(id);
  return domain === "scene" || domain === "script";
}

/** The choices the integration answered, what is not understood left out. */
export function readChoices(raw: unknown): Choices {
  if (typeof raw !== "object" || raw === null) return NO_CHOICES;
  const value = raw as Record<string, unknown>;
  const favourites = Array.isArray(value.favourites)
    ? value.favourites.filter((id): id is string => typeof id === "string")
    : [];
  const cards: HomeCard[] = [];
  for (const card of Array.isArray(value.cards) ? (value.cards as unknown[]) : []) {
    if (typeof card !== "object" || card === null) continue;
    const c = card as Record<string, unknown>;
    if (c.type === "calendar" && Array.isArray(c.entities)) {
      const entities = c.entities.filter((id): id is string => typeof id === "string");
      if (entities.length > 0) cards.push({ type: "calendar", entities });
    } else if (c.type === "todo-list" && typeof c.entity === "string") {
      cards.push({ type: "todo-list", entity: c.entity });
    } else if (c.type === "summary" && isSummary(c.summary)) {
      cards.push({ type: "summary", summary: c.summary });
    }
  }
  const shortcuts = Array.isArray(value.shortcuts) ? (value.shortcuts as unknown[]) : [];
  const choices: Choices = { favourites, cards, shortcuts };
  if (isTab(value.start)) choices.start = value.start;
  return choices;
}
