import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, viewState } from "./fixtures";

/** Sets the fictional vacuum's state, as Home Assistant would. */
async function vacuum(page: Page, state: string): Promise<void> {
  await page.evaluate((state) => {
    (window as never as { __setState(id: string, state: string): void }).__setState(
      "vacuum.robbie",
      state,
    );
  }, state);
}

/** Frames drawn over `ms`. */
async function framesOver(page: Page, ms: number): Promise<number> {
  const before = (await viewState(page)).frames;
  await page.waitForTimeout(ms);
  return (await viewState(page)).frames - before;
}

test.describe("robot vacuums (D-049)", () => {
  test("a robot cleans while its vacuum does, slowly drawn, then rests on its dock", async ({
    page,
  }) => {
    await openHarness(page, { live: true, robot: true });
    await expect
      .poll(async () => (await viewState(page)).robots)
      .toBe('[{"id":"robot-dock","state":"docked"}]');
    // On its dock: nothing to draw.
    await expect.poll(() => framesOver(page, 400)).toBe(0);
    await vacuum(page, "cleaning");
    await expect.poll(async () => (await viewState(page)).robots).toContain("cleaning");
    // It moves, drawn at the layers' slower pace rather than the display's.
    expect(await framesOver(page, 1500)).toBeGreaterThan(1);
    expect((await viewState(page)).frameInterval).toBeGreaterThan(30);
    // Home again: it stops there.
    await vacuum(page, "returning");
    await expect.poll(() => framesOver(page, 400), { timeout: 60_000 }).toBe(0);
  });

  test("held still under reduce motion, and at rest while the pieces are arranged", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, { live: true, robot: true, mode: "panel" });
    await expect.poll(async () => (await viewState(page)).robots).toContain("docked");
    await vacuum(page, "cleaning");
    await expect.poll(async () => (await viewState(page)).robots).toContain("cleaning");
    await expect.poll(() => framesOver(page, 400)).toBe(0);
    // Arranging: every robot on its dock.
    await page.getByTestId("edit-mode").click();
    await expect.poll(async () => (await viewState(page)).robots).toBe("[]");
  });
});

test.describe("the home's energy (D-049)", () => {
  test("shown with the power layer: where power comes from and where it goes", async ({ page }) => {
    await openHarness(page, { live: true, energy: true, layer: "power" });
    const energy = page.locator("domotwin-view").getByTestId("energy");
    await expect(energy).toBeVisible();
    // Said in words for screen readers: the sun, the home, the grid, the battery.
    await expect(energy).toHaveAttribute(
      "aria-label",
      "the sun gives 3.2 kW, the home uses 2 kW, 500 W to the grid, 78 %, charging 700 W",
    );
    // Lines where power flows: from the sun to the home, the battery and the grid.
    await expect(energy.locator("path.flow")).toHaveCount(3);
    // Another layer: no energy.
    await openHarness(page, { live: true, energy: true, layer: "temperature" });
    await expect(page.locator("domotwin-view").getByTestId("energy")).toHaveCount(0);
    // No sensors chosen: the power layer alone.
    await openHarness(page, { live: true, layer: "power" });
    await expect(page.locator("domotwin-view").getByTestId("legend")).toBeVisible();
    await expect(page.locator("domotwin-view").getByTestId("energy")).toHaveCount(0);
  });

  test("on a phone, above the room chip, which keeps its width", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openHarness(page, { live: true, energy: true, mode: "panel" });
    const view = page.locator("domotwin-view");
    await view.getByTestId("layers").click();
    await view.getByTestId("layer-menu").getByText("Power").click();
    const legend = await view.getByTestId("legend").boundingBox();
    const chip = await view.locator(".chip").first().boundingBox();
    if (!legend || !chip) throw new Error("the legend or the chip is not drawn");
    // The chip under the legend, on one line, and the legend on the screen.
    expect(chip.y).toBeGreaterThanOrEqual(legend.y + legend.height);
    expect(chip.height).toBeLessThan(48);
    expect(legend.x).toBeGreaterThanOrEqual(0);
    expect(legend.x + legend.width).toBeLessThanOrEqual(360);
  });

  test("its sensors are chosen in the settings, the likeliest first", async ({ page }) => {
    await openHarness(page, { live: true, energy: true, mode: "panel" });
    await fromMenu(page, "settings");
    const dialog = page.getByTestId("settings-dialog");
    const solar = dialog.getByTestId("settings-energy-solar");
    await expect(solar).toHaveValue("sensor.solar_power");
    // The panels first among the power sensors, each with what it says now.
    await expect(solar.locator("option").nth(1)).toHaveText("Solar panels · 3.2 kW");
    // A meter counting the other way: its sign turned.
    await dialog.getByTestId("settings-energy-grid_reversed").check();
    await dialog.getByTestId("settings-energy-battery").selectOption("");
    await expect(dialog.getByTestId("settings-energy-battery_reversed")).toHaveCount(0);
    await dialog.getByTestId("settings-save").click();
    await expect(page.getByTestId("toast")).toContainText("Settings saved.");
    const stored = await page.evaluate(
      () =>
        (window as never as { __store: { settings: { energy?: unknown } } }).__store.settings
          .energy,
    );
    expect(stored).toEqual({
      solar: "sensor.solar_power",
      grid: "sensor.grid_power",
      battery_level: "sensor.home_battery_level",
      grid_reversed: true,
    });
  });
});
