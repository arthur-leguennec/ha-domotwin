import { expect, test, type Page } from "@playwright/test";

import { openHarness, viewState } from "./fixtures";

/** Opens the demo house on its Energy tab (from the 3D view on `layer`, when given). */
async function demoEnergy(page: Page, layer?: string): Promise<void> {
  await openHarness(page, { mode: "panel", plan: "none", live: true, energyPage: true });
  await page.getByTestId("demo-try").click();
  await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
  if (layer) {
    await page.getByTestId("tab-3d").click();
    await page.evaluate((name) => {
      (window as never as { __view: () => { setLayer(layer: string): void } })
        .__view()
        .setLayer(name);
    }, layer);
    await expect.poll(async () => (await viewState(page)).layer).toBe(layer);
  }
  await page.getByTestId("tab-energy").click();
  await expect(page.getByTestId("tab-energy")).toHaveAttribute("aria-current", "page");
}

test.describe("the Energy tab: the plan and its board (D-092)", () => {
  test("shows the plan on its power beside a board of today's energy", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demoEnergy(page, "temperature");
    const view = page.locator("domotwin-view");
    const board = page.getByTestId("energy-board");
    await expect(view).toBeVisible();
    await expect(board).toBeVisible();
    // Side by side on a computer.
    const viewBox = await view.boundingBox();
    const boardBox = await board.boundingBox();
    expect(viewBox && boardBox && boardBox.x >= viewBox.x + viewBox.width - 1).toBe(true);
    await expect.poll(async () => (await viewState(page)).layer).toBe("power");
    // The plan's colours keep their key; the home's energy is the board's.
    await expect(view.getByTestId("legend")).toBeVisible();
    await expect(view.getByTestId("legend").getByTestId("energy")).toHaveCount(0);
    // Now: what the home uses and where it comes from.
    await expect(page.getByTestId("energy-now")).toContainText("used by the home");
    // Today, from Home Assistant's statistics: what was used, the share not bought, the devices.
    const today = page.getByTestId("energy-today");
    await expect(today).toContainText("kWh");
    await expect(page.getByTestId("energy-own")).toContainText(
      /^\s*\d+\s?% of what the home used today was its own/,
    );
    await expect(page.getByTestId("energy-devices").locator("li").first()).toBeVisible();
    // Home Assistant's own Energy page would not show the demo house.
    await expect(page.getByTestId("energy-page")).toHaveCount(0);
    // Back on the 3D tab, the layer shown before comes back.
    await page.getByTestId("tab-3d").click();
    await expect.poll(async () => (await viewState(page)).layer).toBe("temperature");
  });

  test("a piece using power is shown on the plan with a tap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demoEnergy(page);
    const pieces = page.getByTestId("energy-pieces");
    await expect(pieces.getByTestId("energy-piece").first()).toBeVisible();
    await page.evaluate(() => {
      const view = (
        window as never as {
          __view: () => { show(target: { element?: string }): void };
        }
      ).__view();
      const shown: string[] = [];
      (window as never as { __shown: string[] }).__shown = shown;
      const show = view.show.bind(view);
      view.show = (target) => {
        if (target.element) shown.push(target.element);
        show(target);
      };
    });
    const first = pieces.getByTestId("energy-piece").first();
    const element = await first.getAttribute("data-element");
    await first.click();
    await expect
      .poll(() => page.evaluate(() => (window as never as { __shown: string[] }).__shown))
      .toEqual([element]);
  });

  test("on a phone, the plan is above the board", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await demoEnergy(page);
    const view = page.locator("domotwin-view");
    const board = page.getByTestId("energy-board");
    await expect(board).toBeVisible();
    const viewBox = await view.boundingBox();
    const boardBox = await board.boundingBox();
    expect(viewBox && boardBox && boardBox.y >= viewBox.y + viewBox.height - 1).toBe(true);
    // Nothing scrolls sideways, the page nor the board.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await board.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});

test.describe("the automations: a list in plain words first (D-092)", () => {
  test("on a phone, the one picked is shown alone, under the house", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    await page.getByTestId("demo-try").click();
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
    await page.getByTestId("tab-3d").click();
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="automations"]').click();
    const list = page.getByTestId("automation-list");
    const rows = list.locator("[data-automation]");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(3);
    // At the bottom of the view, at most about half of it: the house stays in sight above.
    const view = await page.locator("domotwin-view").boundingBox();
    const box = await list.boundingBox();
    expect(view && box && box.y + box.height >= view.y + view.height - 12).toBe(true);
    expect(view && box && box.height <= view.height * 0.45).toBe(true);
    const lights = list.locator('[data-automation="automation.lights_follow_people"]');
    await lights.click();
    await expect(list.locator("[data-automation]:visible")).toHaveCount(1);
    const words = list.getByTestId("automation-words");
    await expect(words).toContainText("Then");
    // Its lines read, not hidden with the other automations.
    await expect(words.locator("li").first()).toBeVisible();
    await list.getByRole("button", { name: "All the automations" }).click();
    await expect(list.locator("[data-automation]:visible")).toHaveCount(count);
    // The one that was picked keeps the focus.
    await expect(lights).toBeFocused();
  });
});
