import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle, viewState } from "./fixtures";

/** The colour drawn near the top left of the view (the sky), from a fresh frame. */
async function skyColor(page: Page): Promise<[number, number, number]> {
  await settle(page);
  return page.evaluate(async () => {
    const view = (window as never as { __view: () => { captureFrame(): string } }).__view();
    const image = new Image();
    image.src = view.captureFrame();
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(4, 4, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0] as [number, number, number];
  });
}

/** The look on the element (its overlays' colours follow it). */
function lookAttribute(page: Page): Promise<string | null> {
  return page.locator("domotwin-view").getAttribute("look");
}

test.describe("looks", () => {
  test("a card shows the look and accent of its options, with the home's outlines", async ({
    page,
  }) => {
    await openHarness(page, { theme: "neon", accent: "#FF2D95" });
    await expect.poll(async () => (await viewState(page)).look).toBe("neon #ff2d95");
    expect(await lookAttribute(page)).toBe("neon");
    const stats = (await viewState(page)).stats as unknown as { theme: string; lines: number };
    expect(stats.theme).toBe("neon");
    expect(stats.lines).toBeGreaterThan(100);
    // A night sky.
    const [r, g, b] = await skyColor(page);
    expect(r + g + b).toBeLessThan(120);
    // On a GPU that can afford it, drawn offscreen with its bloom: the same sky.
    await page.evaluate(() => {
      const view = (
        window as never as {
          __view: () => { options: Record<string, unknown> };
        }
      ).__view();
      view.options = { ...view.options, quality: "high" };
    });
    await expect.poll(async () => (await viewState(page)).quality).toBe("high");
    const [hr, hg, hb] = await skyColor(page);
    expect(hr + hg + hb).toBeLessThan(120);
    expect(Math.abs(hr - r) + Math.abs(hg - g) + Math.abs(hb - b)).toBeLessThan(12);
    // Blueprint: blue.
    await openHarness(page, { theme: "blueprint" });
    await expect.poll(async () => (await viewState(page)).look).toBe("blueprint #00d4ff");
    const [br, bg, bb] = await skyColor(page);
    expect(bb).toBeGreaterThan(br + 40);
    expect(bb).toBeGreaterThan(bg);
  });

  test("automatic: neon in Home Assistant's dark mode, day otherwise; else the home's", async ({
    page,
  }) => {
    await openHarness(page, { dark: true });
    await expect.poll(async () => (await viewState(page)).look).toBe("neon #00d4ff");
    await openHarness(page);
    await expect.poll(async () => (await viewState(page)).look).toBe("day #00d4ff");
    const [r, g, b] = await skyColor(page);
    expect(r + g + b).toBeGreaterThan(600);
    // A card without a look of its own shows the home's.
    await openHarness(page, { homeTheme: "blueprint" });
    await expect.poll(async () => (await viewState(page)).look).toBe("blueprint #00d4ff");
    // Its own wins.
    await openHarness(page, { homeTheme: "blueprint", theme: "day" });
    await expect.poll(async () => (await viewState(page)).look).toBe("day #00d4ff");
  });

  test("the panel's settings choose the home's look, shown as it is chosen", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByTestId("settings-dialog");
    await dialog.getByTestId("settings-theme").selectOption("neon");
    await expect.poll(async () => (await viewState(page)).look).toBe("neon #00d4ff");
    await dialog.getByTestId("settings-accent").fill("#ffb000");
    await expect.poll(async () => (await viewState(page)).look).toBe("neon #ffb000");
    // Cancelled: back to the home's.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(async () => (await viewState(page)).look).toBe("day #00d4ff");
    // Saved: kept.
    await page.getByRole("button", { name: "Settings" }).click();
    await dialog.getByTestId("settings-theme").selectOption("blueprint");
    await dialog.getByTestId("settings-save").click();
    await expect(page.getByTestId("toast")).toContainText("Settings saved.");
    await expect.poll(async () => (await viewState(page)).look).toBe("blueprint #00d4ff");
    const stored = await page.evaluate(
      () => (window as never as { __store: { settings: unknown } }).__store.settings,
    );
    // The accent left as it was is not stored.
    expect(stored).toEqual({ north: 0, theme: "blueprint" });
    expect(await lookAttribute(page)).toBe("blueprint");
  });

  test("the rooms' names stand on their floor, unless a layer shows its values", async ({
    page,
  }) => {
    await openHarness(page, { theme: "neon" });
    const names = page.locator("domotwin-view").getByTestId("room-names");
    await expect(names.locator(".room-name")).toHaveCount(5);
    await expect(names.locator('[data-room="living"]')).toHaveText("Living room");
    // Inside the view.
    const view = await page.locator("domotwin-view").boundingBox();
    const living = await names.locator('[data-room="living"]').boundingBox();
    if (!view || !living) throw new Error("not drawn");
    expect(living.x).toBeGreaterThan(view.x);
    expect(living.x + living.width).toBeLessThan(view.x + view.width);
    // A layer's values take their place.
    await openHarness(page, { layer: "temperature", live: true });
    await expect(page.locator("domotwin-view").getByTestId("room-names")).toHaveCount(0);
    // Turned off.
    await openHarness(page, { names: false });
    await expect.poll(async () => (await viewState(page)).engine).toBe("ready");
    await expect(page.locator("domotwin-view").getByTestId("room-names")).toHaveCount(0);
  });
});
