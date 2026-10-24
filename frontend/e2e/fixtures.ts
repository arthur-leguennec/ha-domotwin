import { expect, type Locator, type Page } from "@playwright/test";

import type { DebugState } from "../src/components/view";

export interface HarnessOptions {
  mode?: "card" | "panel";
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
  layer?: "off" | "temperature" | "humidity" | "co2" | "pm25" | "power";
  realSun?: boolean;
  /** `sun.sun`'s position (degrees). */
  sunPosition?: { azimuth: number; elevation: number };
  /** The stored settings' north (degrees). */
  north?: number;
  /** The fictional upper floor above the demo apartment (two storeys). */
  storeys?: 2;
  /** Card option: the storey shown first. */
  storey?: string;
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
    const view = (
      window as never as {
        __view: () => {
          captureFrame(): string;
          elementPoint(id: string): { x: number; y: number } | undefined;
        };
      }
    ).__view();
    const point = view.elementPoint(element);
    if (!point) throw new Error(`${element} is not on screen`);
    const image = new Image();
    image.src = view.captureFrame();
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const shown = (window as never as { __view: () => HTMLElement }).__view();
    const ratio = image.width / Math.max(1, shown.clientWidth);
    const [r, g, b] = context.getImageData(
      Math.round(point.x * ratio),
      Math.round(point.y * ratio),
      1,
      1,
    ).data;
    return [r ?? 0, g ?? 0, b ?? 0] as [number, number, number];
  }, id);
}
