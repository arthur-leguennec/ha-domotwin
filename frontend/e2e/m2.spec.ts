import { expect, test, type Page } from "@playwright/test";

import {
  canvasPng,
  colorAt,
  elementPoint,
  entityState,
  openHarness,
  settle,
  viewState,
} from "./fixtures";

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("summary")).toBeVisible();
  await settle(page);
}

async function stats(page: Page): Promise<{ lights: number; lit: number; bound: number }> {
  const state = await viewState(page);
  if (!state.stats) throw new Error("no scene");
  return state.stats;
}

/** A point of the view where `id` is the element under the pointer (it may be partly hidden). */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
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

async function focus(page: Page, id: string): Promise<void> {
  await page.evaluate((element) => {
    (window as never as { __view: () => { showElement(id: string): boolean } })
      .__view()
      .showElement(element);
  }, id);
  await settle(page);
}

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

function serviceCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    (window as never as { __calls: { type: string }[] }).__calls.filter(
      (call) => call.type === "call_service",
    ),
  );
}

test.describe("live control", () => {
  test("lamps follow their lights, unavailable entities are greyed out", async ({ page }) => {
    await openHarness(page, { live: true, lighting: "night" });
    await ready(page);
    const before = await stats(page);
    expect(before.bound).toBeGreaterThan(10);
    // Pendant, floor lamp, TV, two kitchen spots, left bedside lamp.
    expect(before.lit).toBe(6);
    expect(before.lights).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as never as { __setState(id: string, state: string): void }).__setState(
        "light.kitchen_spots",
        "off",
      );
    });
    await settle(page);
    expect((await stats(page)).lit).toBe(4);
    expect(await canvasPng(page)).toMatchSnapshot("live-night.png");
    // Up close, the playing TV glows blue (at every quality).
    await focus(page, "tv");
    const [r, , b] = await colorAt(page, "tv");
    expect(b).toBeGreaterThan(r + 40);
  });

  test("a tap toggles a lamp, and the scene follows", async ({ page }) => {
    await openHarness(page, { live: true, lighting: "evening" });
    await ready(page);
    await focus(page, "living");
    const lit = (await stats(page)).lit;
    await page.mouse.click(...xy(await pointOn(page, "table-lamp")));
    await expect.poll(() => entityState(page, "light.sideboard_lamp")).toBe("on");
    expect(await serviceCalls(page)).toContainEqual({
      type: "call_service",
      domain: "homeassistant",
      service: "toggle",
      data: {},
      target: { entity_id: "light.sideboard_lamp" },
    });
    await settle(page);
    expect((await stats(page)).lit).toBe(lit + 1);
  });

  test("a tap opens more-info when the binding says so", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "living");
    await page.evaluate(() => {
      document.addEventListener("hass-more-info", (event) => {
        (window as never as { __moreInfo: unknown }).__moreInfo = (
          event as CustomEvent<{ entityId: string }>
        ).detail.entityId;
      });
    });
    await page.mouse.click(...xy(await pointOn(page, "tv")));
    await expect
      .poll(() => page.evaluate(() => (window as never as { __moreInfo?: string }).__moreInfo))
      .toBe("media_player.living_room_tv");
  });

  test("a long press opens the controls of a lamp", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "living");
    await longPress(page, await pointOn(page, "floor-lamp"));
    const controls = page.locator("domotwin-controls");
    await expect(controls.getByRole("dialog", { name: "Floor lamp" })).toBeVisible();
    // The lamp and its power sensor.
    await expect(controls.getByText("9.5 W")).toBeVisible();
    await controls.getByRole("switch").first().click();
    await expect.poll(() => entityState(page, "light.living_room_floor_lamp")).toBe("off");
    await expect(controls.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
  });

  test("the room panel turns a room's lights off", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "living");
    await longPress(page, await pointOn(page, "living"));
    const room = page.locator("domotwin-room");
    await expect(room.getByRole("dialog", { name: "Living room" })).toBeVisible();
    await expect(room.getByText("Lights", { exact: true })).toBeVisible();
    await room.getByRole("button", { name: "All lights off" }).click();
    await expect.poll(() => entityState(page, "light.living_room_pendant")).toBe("off");
    await expect.poll(() => entityState(page, "light.living_room_floor_lamp")).toBe("off");
    expect(await serviceCalls(page)).toContainEqual({
      type: "call_service",
      domain: "light",
      service: "turn_off",
      data: {},
      target: { area_id: "living_room" },
    });
    await expect(room.getByRole("button", { name: "All lights off" })).toHaveCount(0);
  });

  test("a tap on a room frames it, and its chip opens the room panel", async ({ page }) => {
    await openHarness(page, { live: true, lang: "fr" });
    await ready(page);
    await page.mouse.click(...xy(await pointOn(page, "bedroom")));
    const chip = page.getByTestId("room-chip");
    await expect(chip).toHaveText("Bedroom");
    await chip.click();
    const room = page.locator("domotwin-room");
    await expect(room.getByText("Climat", { exact: true })).toBeVisible();
    await expect(room.getByText("Volets et rideaux", { exact: true })).toBeVisible();
  });

  test("tells when an action fails", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "living");
    await page.evaluate(() => {
      (window as never as { __failServices: boolean }).__failServices = true;
    });
    await page.mouse.click(...xy(await pointOn(page, "table-lamp")));
    await expect(page.getByTestId("notice")).toHaveText(
      "That did not work: The device did not answer",
    );
  });

  test("follows bindings saved from another device", async ({ page }) => {
    await openHarness(page, { live: true, lighting: "night" });
    await ready(page);
    expect((await stats(page)).bound).toBeGreaterThan(10);
    await page.evaluate(async () => {
      const hass = (
        window as never as {
          __hass: { connection: { sendMessagePromise(message: unknown): Promise<unknown> } };
        }
      ).__hass;
      await hass.connection.sendMessagePromise({
        type: "domotwin/bindings/save",
        bindings: { version: 1, rooms: {}, elements: {} },
      });
    });
    await expect.poll(async () => (await stats(page)).bound).toBe(0);
  });
});

test.describe("linking", () => {
  async function saved(page: Page): Promise<{
    rooms: Record<string, unknown>;
    elements: Record<string, { entities: { entity_id: string }[]; tap_action?: unknown }>;
  }> {
    return page.evaluate(() => {
      const calls = (
        window as never as { __calls: { type: string; bindings?: unknown }[] }
      ).__calls.filter((call) => call.type === "domotwin/bindings/save");
      return calls[calls.length - 1]?.bindings as never;
    });
  }

  test("links a lamp to other entities, with suggestions from its room", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await ready(page);
    await page.getByTestId("link-mode").click();
    await expect(page.getByTestId("link-hint")).toBeVisible();
    await focus(page, "living");
    await page.mouse.click(...xy(await pointOn(page, "table-lamp")));
    const editor = page.locator("domotwin-link");
    await expect(editor.getByRole("dialog", { name: "Table lamp" })).toBeVisible();
    // Linking is not acting: the lamp did not change.
    expect(await entityState(page, "light.sideboard_lamp")).toBe("off");
    await expect(editor.getByText("Suggestions from Living room")).toBeVisible();
    await editor.getByRole("button", { name: "Unlink Sideboard lamp" }).click();
    await editor.getByRole("button", { name: "Link Living room floor lamp" }).click();
    await editor.getByRole("searchbox").fill("bedside left");
    await editor.getByRole("button", { name: "Link Bedside left" }).click();
    await editor.getByRole("combobox").selectOption("none");
    await editor.getByTestId("link-save").click();
    await expect(page.getByRole("status").filter({ hasText: "Links saved." })).toBeVisible();
    await expect(editor).toHaveCount(0);
    const bindings = await saved(page);
    expect(bindings.elements["table-lamp"]).toEqual({
      entities: [
        { entity_id: "light.living_room_floor_lamp" },
        { entity_id: "light.bedside_left" },
      ],
      tap_action: { action: "none" },
    });
    // Everything else is kept.
    expect(bindings.elements["pendant-living"]).toBeDefined();
    expect(Object.keys(bindings.rooms)).toHaveLength(5);
  });

  test("links a room to an area, or unlinks it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, lang: "fr" });
    await ready(page);
    await page.getByTestId("link-mode").click();
    await page.mouse.click(...xy(await pointOn(page, "bedroom")));
    const editor = page.locator("domotwin-link");
    const select = editor.getByRole("combobox", { name: "Pièce Home Assistant" });
    await expect(select).toHaveValue("bedroom");
    await select.selectOption("");
    await editor.getByTestId("link-save").click();
    await expect(editor).toHaveCount(0);
    const bindings = await saved(page);
    expect(bindings.rooms.bedroom).toBeUndefined();
    expect(bindings.rooms.living).toEqual({ area: "living_room" });
    // Done: taps act again.
    await page.getByTestId("link-mode").click();
    await expect(page.getByTestId("link-hint")).toHaveCount(0);
  });

  test("is for administrators only", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, admin: false });
    await ready(page);
    await expect(page.getByTestId("link-mode")).toHaveCount(0);
  });
});

function xy(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}
