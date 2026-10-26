import { expect, type Locator, type Page } from "@playwright/test";

import type { DebugState } from "../src/components/view";

export interface HarnessOptions {
  mode?: "card" | "panel";
  /**
   * Voice (D-041): Assist with a pipeline that hears (`true`), or none that hears (`"deaf"`);
   * apps that can be installed; one blueprint edited; a page served over HTTP; the card's
   * microphone turned off.
   */
  voice?: true | "deaf";
  supervisor?: boolean;
  blueprints?: "changed";
  insecure?: boolean;
  mic?: false;
  /** The tip on what a tap does, not read yet (D-047). */
  tip?: boolean;
  /** The card's `font_family`. */
  font?: string;
  lang?: "en" | "fr";
  plan?: "demo" | "none";
  admin?: boolean;
  dark?: boolean;
  view?: "3d" | "2d";
  cutaway?: "auto" | "always" | "off";
  /** Defaults to `day`, so that pictures do not depend on the time the tests run. */
  lighting?: "auto" | "morning" | "day" | "evening" | "night";
  /** A `sun.sun` entity: elevation in degrees and whether it is rising. */
  sun?: { elevation: number; rising: boolean };
  /** The demo bindings and the demo home's entities, areas and states. */
  live?: boolean;
  /**
   * The demo plan with a bar stool drawn from a 3D file, twice (`big`: 139 392 triangles; `unused`:
   * the model without pieces).
   */
  models?: boolean | "big" | "unused";
  /** Card options of the layers. */
  layer?:
    | "off"
    | "temperature"
    | "humidity"
    | "co2"
    | "pm25"
    | "power"
    | "peak"
    | "network"
    | "automations"
    | "upkeep";
  realSun?: boolean;
  /** `sun.sun`'s position (degrees). */
  sunPosition?: { azimuth: number; elevation: number };
  /** The stored settings' north (degrees). */
  north?: number;
  /** The fictional upper floor above the demo apartment (two storeys). */
  storeys?: 2;
  /** Card option: the storey shown first. */
  storey?: string;
  /** Card options: the look and its accent. */
  theme?: "auto" | "day" | "neon" | "blueprint" | "cartoon" | "clay";
  accent?: string;
  /** The home's look (the stored settings). */
  homeTheme?: "auto" | "day" | "neon" | "blueprint" | "cartoon" | "clay";
  /** Card option: the rooms' names off. */
  names?: false;
  /** Kiosk options (D-029): the card's screen name, `idle` seconds, `orbit`, `night_dim`. */
  screen?: string;
  idle?: number;
  orbit?: boolean;
  nightDim?: boolean;
  /** A mocked ZHA with a fictional Zigbee mesh (the network map, D-031). */
  zha?: boolean;
  /** Fictional automations (D-032): `true` three of the demo apartment, a number made up ones. */
  automations?: true | number;
  /** The sandbox's time zone and place, and its automations and script (D-058). */
  sandbox?: boolean;
  /** Upkeep cards (D-033): the demo's (`true`), or an integration without them (`false`). */
  upkeep?: boolean;
  /** People in their rooms (D-034): fictional ones (`true`), or an integration without them. */
  people?: boolean;
  /** A robot vacuum's dock in the hall, linked to `vacuum.robbie` (D-049). */
  robot?: boolean;
  /** Fictional solar panels, meter and battery, named in the stored settings (D-049). */
  energy?: boolean;
  /** The card's `demo`: the demo house instead of this home (D-050). */
  demo?: boolean;
  /**
   * Hydro-Québec's peaks (D-058): the integration that reads them (hydroqc's sensors, HydroPeak's,
   * or hydroqc's calendar) and where its peak stands now (`peak` unless asked).
   */
  peak?: "hydroqc" | "hydropeak" | "calendar";
  peakPhase?: "upcoming" | "preheat" | "peak" | "none";
  peopleShown?: "everyone" | "admins";
  peopleLook?: "figure" | "pin";
  /** Bluetooth locating (D-035): fictional receivers and devices, or no Bluetooth at all. */
  bluetooth?: true | "none";
  /** Private rooms (D-039): kept for nobody, or for `privateFor`, maybe only while an entity is
   * on. */
  private?: string[];
  privateFor?: string;
  privateWhile?: string;
  /** The settings cannot be read until `window.__settingsUp()`. */
  settingsDown?: boolean;
  /** The tab this device opens on (D-055): the 3D view unless asked; `none`: the user's. */
  start?: "home" | "rooms" | "3d" | "none";
  /** The tab the user chose, and their favourites. */
  userStart?: "home" | "rooms" | "3d";
  favourites?: string[];
  /** Home Assistant's address: the panel's path, and the path after it opened. */
  route?: boolean;
  path?: string;
  /** Home Assistant's card helpers, made up (a card says its type and entity). */
  cards?: boolean;
  /** A calendar and a to-do list. */
  lists?: boolean;
  /** How Home Assistant keeps the page it opens first. */
  firstPage?: "device" | "user";
}

/** Opens the mocked Home Assistant with the built frontend. */
export async function openHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  const params = new URLSearchParams({
    mode: options.mode ?? "card",
    lang: options.lang ?? "en",
    plan: options.plan ?? "demo",
    admin: options.admin === false ? "0" : "1",
    dark: options.dark ? "1" : "0",
  });
  if (options.view) params.set("view", options.view);
  if (options.font) params.set("font", options.font);
  if (options.cutaway) params.set("cutaway", options.cutaway);
  params.set("lighting", options.lighting ?? "day");
  if (options.sun) params.set("sun", `${options.sun.elevation},${options.sun.rising ? 1 : 0}`);
  if (options.live) params.set("live", "1");
  if (options.models) params.set("models", options.models === true ? "1" : options.models);
  if (options.layer) params.set("layer", options.layer);
  if (options.realSun) params.set("realsun", "1");
  if (options.sunPosition) {
    params.set("sunpos", `${options.sunPosition.azimuth},${options.sunPosition.elevation}`);
  }
  if (options.north !== undefined) params.set("north", String(options.north));
  if (options.storeys) params.set("storeys", String(options.storeys));
  if (options.storey) params.set("storey", options.storey);
  if (options.theme) params.set("theme", options.theme);
  if (options.accent) params.set("accent", options.accent);
  if (options.homeTheme) params.set("hometheme", options.homeTheme);
  if (options.names === false) params.set("names", "0");
  if (options.screen) params.set("screen", options.screen);
  if (options.idle !== undefined) params.set("idle", String(options.idle));
  if (options.orbit) params.set("orbit", "1");
  if (options.nightDim) params.set("nightdim", "1");
  if (options.zha) params.set("zha", "1");
  if (options.upkeep !== undefined) params.set("upkeep", options.upkeep ? "1" : "0");
  if (options.people !== undefined) params.set("people", options.people ? "1" : "0");
  if (options.robot) params.set("robot", "1");
  if (options.energy) params.set("energy", "1");
  if (options.demo) params.set("demo", "1");
  if (options.peak) params.set("peak", options.peak);
  if (options.peakPhase) params.set("peakphase", options.peakPhase);
  if (options.peopleShown) params.set("peopleshown", options.peopleShown);
  if (options.peopleLook) params.set("peoplelook", options.peopleLook);
  if (options.bluetooth) params.set("bluetooth", options.bluetooth === true ? "1" : "none");
  if (options.private) params.set("private", options.private.join(","));
  if (options.privateFor) params.set("privatefor", options.privateFor);
  if (options.privateWhile) params.set("privatewhile", options.privateWhile);
  if (options.settingsDown) params.set("settingsdown", "1");
  if (options.start) params.set("start", options.start);
  if (options.userStart) params.set("userstart", options.userStart);
  if (options.favourites) params.set("favourites", options.favourites.join(","));
  if (options.route) params.set("route", "1");
  if (options.path) params.set("path", options.path);
  if (options.cards) params.set("cards", "1");
  if (options.lists) params.set("lists", "1");
  if (options.firstPage) params.set("firstpage", options.firstPage);
  if (options.voice) params.set("voice", options.voice === true ? "1" : options.voice);
  if (options.supervisor) params.set("supervisor", "1");
  if (options.blueprints) params.set("blueprints", options.blueprints);
  if (options.insecure) params.set("insecure", "1");
  if (options.mic === false) params.set("mic", "0");
  if (options.tip) params.set("tip", "1");
  if (options.sandbox) params.set("sandbox", "1");
  if (options.automations) {
    params.set("automations", options.automations === true ? "1" : String(options.automations));
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?${params.toString()}`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __element?: unknown }).__element !== undefined),
    )
    .toBe(true);
  expect(errors).toEqual([]);
}

/** The engine state reported by `<domotwin-view>`. */
export function viewState(page: Page): Promise<DebugState> {
  return page.evaluate(() => {
    const view = (window as never as { __view: () => { debugState(): never } | null }).__view();
    if (!view) throw new Error("no view");
    return view.debugState();
  });
}

/** Runs camera moves and wall animations to their end. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as never as { __view: () => { settle(): void } }).__view().settle();
  });
}

/** The canvas pixels as PNG (no overlays: they use system fonts, which differ between machines). */
export async function canvasPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() =>
    (window as never as { __view: () => { captureFrame(): string } }).__view().captureFrame(),
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** The view's stage, where gestures happen. */
export function stage(page: Page): Locator {
  return page.locator("domotwin-view").locator(".stage");
}

/** Where an element of the plan is drawn, in page coordinates. */
export async function elementPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await stage(page).boundingBox();
  if (!box) throw new Error("no stage");
  const point = await page.evaluate(
    (element) =>
      (
        window as never as {
          __view: () => { elementPoint(id: string): { x: number; y: number } | undefined };
        }
      )
        .__view()
        .elementPoint(element),
    id,
  );
  if (!point) throw new Error(`${id} is not on screen`);
  return { x: box.x + point.x, y: box.y + point.y };
}

/** A point of the view where `id` is the element under the pointer (it may be partly hidden). */
export async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const centre = await elementPoint(page, id);
  const box = await page.locator("domotwin-view").locator(".stage").boundingBox();
  if (!box) throw new Error("no stage");
  const hit = await page.evaluate(
    ({ id, x, y }) => {
      const view = (
        window as never as {
          __view: () => { elementAt(x: number, y: number): { id: string } | undefined };
        }
      ).__view();
      for (let r = 0; r <= 24; r += 3) {
        for (let dy = -r; dy <= r; dy += 3) {
          for (let dx = -r; dx <= r; dx += 3) {
            if (view.elementAt(x + dx, y + dy)?.id === id) return { x: x + dx, y: y + dy };
          }
        }
      }
      return null;
    },
    { id, x: centre.x - box.x, y: centre.y - box.y },
  );
  if (!hit) throw new Error(`${id} cannot be tapped`);
  return { x: box.x + hit.x, y: box.y + hit.y };
}

/** The state of an entity of the mocked Home Assistant. */
export function entityState(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(
    (entity) =>
      (window as never as { __hass: { states: Record<string, { state: string } | undefined> } })
        .__hass.states[entity]?.state,
    id,
  );
}

/** The colour drawn at the centre of an element, from a fresh frame. */
export async function colorAt(page: Page, id: string): Promise<[number, number, number]> {
  return page.evaluate(async (element) => {
    const page = window as never as {
      __view: () => HTMLElement & {
        elementPoint(id: string): { x: number; y: number } | undefined;
      };
      __framePixels: () => Promise<ImageData>;
    };
    const view = page.__view();
    const point = view.elementPoint(element);
    if (!point) throw new Error(`${element} is not on screen`);
    const image = await page.__framePixels();
    const ratio = image.width / Math.max(1, view.clientWidth);
    const at = 4 * (Math.round(point.y * ratio) * image.width + Math.round(point.x * ratio));
    const data = image.data;
    return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0] as [number, number, number];
  }, id);
}

/** Picks an entry of the panel's "More" menu (the export, the home's settings). */
export async function fromMenu(page: Page, testId: string): Promise<void> {
  await page.getByTestId("more").click();
  await page.getByTestId(testId).click();
}
