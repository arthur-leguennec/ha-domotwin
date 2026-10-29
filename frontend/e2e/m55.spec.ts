import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, settle, viewState } from "./fixtures";

/** Opens the demo house on its 3D tab. */
async function demo3d(page: Page): Promise<void> {
  await openHarness(page, { mode: "panel", plan: "none", live: true });
  await page.getByTestId("demo-try").click();
  await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
  await page.getByTestId("tab-3d").click();
}

/** Moves the hour of the day's slider to `minute`, as a finger would. */
async function slideTo(slider: Locator, minute: number): Promise<void> {
  await slider.evaluate((input, value) => {
    (input as HTMLInputElement).value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, minute);
}

/** Each room's value of the layer shown, as the engine was sent them. */
async function layerValues(page: Page): Promise<Record<string, number>> {
  const layers = (await viewState(page)).layers;
  return (JSON.parse(layers ?? "{}") as { values?: Record<string, number> }).values ?? {};
}

test.describe("the sun by the hour and the rooms' hours of sun (D-093)", () => {
  test("the sun's card is big enough to read, and moves the sun through the day", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demo3d(page);
    await page.getByTestId("layers").click();
    await page.getByTestId("real-sun").click();
    const card = page.getByTestId("sun-legend");
    await expect(card).toBeVisible();
    // Bigger than the other legends: its text at 14 px at least, and wide enough to slide.
    expect(await card.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(
      13.9,
    );
    expect((await card.boundingBox())?.width ?? 0).toBeGreaterThan(260);
    await expect(card.getByTestId("sun-time")).toContainText("Now");
    await expect(card.getByTestId("sun-times")).toContainText(/Sunrise .+, sunset .+/);
    await expect(card.getByTestId("sun-now")).toHaveCount(0);
    const live = (await viewState(page)).sun;

    // Noon on the demo house's day: its sun high in the south-south-east.
    const slider = card.getByTestId("sun-hour");
    await slideTo(slider, 12 * 60);
    await expect.poll(async () => (await viewState(page)).sun).toMatch(/^161\.5:45\.5:/);
    await expect(card.getByTestId("sun-time")).not.toContainText("Now");
    await expect(slider).toHaveAttribute("aria-valuetext", /12/);
    await expect(card.getByTestId("sun-text")).toContainText(/The sun comes into|no window/);

    // The middle of the night: the sun is down then, and the light is the night's.
    await slideTo(slider, 2 * 60);
    await expect(card.getByTestId("sun-text")).toHaveText("The sun is down at this hour.");
    await expect.poll(async () => (await viewState(page)).light).toMatch(/^sun:-/);

    // Back to now.
    await card.getByTestId("sun-now").click();
    await expect(card.getByTestId("sun-time")).toContainText("Now");
    await expect.poll(async () => (await viewState(page)).sun).toBe(live);
    // Off: the hour chosen is forgotten.
    await slideTo(slider, 12 * 60);
    await page.getByTestId("layers").click();
    await page.getByTestId("real-sun").click();
    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await viewState(page)).sun).toBe("default");
  });

  test("the rooms show their hours of sun, written on them", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demo3d(page);
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="sunshine"]').click();
    await expect.poll(async () => (await viewState(page)).layer).toBe("sunshine");
    const legend = page.getByTestId("legend");
    await expect(legend).toContainText("Hours of sun");
    await expect(legend).toContainText("Hours of direct sun through the windows");
    // The demo house's sun has a single day: no other day to choose.
    await expect(legend.locator("[data-day]")).toHaveCount(0);
    await expect.poll(async () => Object.keys(await layerValues(page)).length).toBeGreaterThan(3);
    const values = Object.values(await layerValues(page));
    // Some rooms have the sun for hours, none for more than the day's.
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeLessThan(14);
    await expect(page.getByTestId("labels").locator("span").first()).toContainText("hr");
  });

  test("where the home's place is known, another day of the year can be chosen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHarness(page, { mode: "panel", live: true, place: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    await settle(page);
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="sunshine"]').click();
    const legend = page.getByTestId("legend");
    const days = legend.locator("[data-day]");
    await expect(days).toHaveCount(3);
    await expect(legend.locator('[data-day="today"]')).toHaveAttribute("aria-pressed", "true");
    await legend.locator('[data-day="longest"]').click();
    await expect(legend.locator('[data-day="longest"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Object.keys(await layerValues(page)).length).toBeGreaterThan(0);
    const summer = await layerValues(page);
    await legend.locator('[data-day="shortest"]').click();
    await expect
      .poll(async () => JSON.stringify(await layerValues(page)))
      .not.toBe(JSON.stringify(summer));
    const winter = await layerValues(page);
    const total = (values: Record<string, number>): number =>
      Object.values(values).reduce((a, b) => a + b, 0);
    expect(total(winter)).toBeLessThan(total(summer));

    // The sun's card tells when the sun rises and sets where the home is.
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="off"]').click();
    await page.getByTestId("layers").click();
    await page.getByTestId("real-sun").click();
    await expect(page.getByTestId("sun-times")).toContainText(/Sunrise .+, sunset .+/);
  });

  test("on a phone, the sun's card takes the width, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await demo3d(page);
    await page.getByTestId("layers").click();
    await page.getByTestId("real-sun").click();
    const card = page.getByTestId("sun-legend");
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    // Beside the tools' column, not under it: its button back to now can be pressed.
    const tools = await page.locator("domotwin-view .tools").first().boundingBox();
    expect(box && tools && box.x + box.width <= tools.x + 1).toBe(true);
    await card.getByTestId("sun-hour").evaluate((input) => {
      (input as HTMLInputElement).value = "600";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await card.getByTestId("sun-now").click();
    await expect(card.getByTestId("sun-time")).toContainText("Now");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/** Opens the layer menu and picks a layer. */
async function chooseLayer(page: Page, layer: string): Promise<void> {
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator(`[data-layer="${layer}"]`).click();
}

/** What the engine was given for the rooms' coverage (`setLayers`). */
async function coverage(page: Page): Promise<Record<string, number>> {
  const layers = (await viewState(page)).layers;
  const read = JSON.parse(layers ?? "{}") as { heat?: string; values?: Record<string, number> };
  return read.heat === "coverage" ? (read.values ?? {}) : {};
}

test.describe("the demo house's radios, placed (D-093)", () => {
  test("the Wi-Fi's, the Zigbee mesh's and the Bluetooth's coverage each show", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demo3d(page);
    await chooseLayer(page, "coverage");
    await expect(page.getByTestId("placement")).toBeVisible();
    for (const radio of ["wifi", "zigbee", "bluetooth"]) {
      const kind = page.locator(`domotwin-placement [data-radio-kind="${radio}"]`);
      await kind.click();
      await expect(kind).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("placement-rooms").locator("li").first()).toBeVisible();
      // Every radio placed: none left aside.
      await expect(page.getByTestId("placement-unplaced")).toHaveCount(0);
      await expect.poll(async () => Object.keys(await coverage(page)).length).toBeGreaterThan(3);
    }
  });

  test("the Zigbee network map draws the mesh, a weak link in it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demo3d(page);
    await chooseLayer(page, "network");
    const health = page.getByTestId("network-health");
    await expect(health).toContainText("9 devices");
    await expect(health).toContainText("1 weak link");
    // The ground floor shown: the upper floor's devices are there, none is left to place.
    await expect(page.getByTestId("network-not-placed")).toHaveCount(0);
    await expect(page.getByTestId("network-elsewhere")).toHaveText(
      "3 devices are placed on another floor.",
    );
    await expect(page.locator("domotwin-network .node").first()).toBeVisible();
  });
});

test.describe("how to make an automation, a guide in the panel (D-093)", () => {
  test("walks through When, Only if and Then, with an example from the home", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demo3d(page);
    // From the automations' list.
    await chooseLayer(page, "automations");
    await page.getByTestId("automation-guide-open").click();
    const guide = page.getByTestId("automation-guide");
    await expect(guide).toBeVisible();
    const step = guide.getByTestId("guide-step");
    await expect(step).toHaveAttribute("data-step", "intro");
    await expect(step).toContainText("When");
    await expect(step).toContainText("Only if");
    await expect(step).toContainText("Then");
    // The demo house's own lamps and sensors make the example.
    await expect(guide.getByTestId("guide-example")).toContainText(/When .+, only if the sun/);
    await expect(guide).toContainText("Step 1 of 5");
    for (const next of ["when", "if", "then", "make"]) {
      await guide.getByTestId("guide-next").click();
      await expect(step).toHaveAttribute("data-step", next);
    }
    await expect(guide).toContainText("Step 5 of 5");
    // In the demo house, no editor of its own: it says so.
    await expect(guide.getByTestId("guide-editor")).toHaveCount(0);
    await expect(guide.getByTestId("guide-no-editor")).toContainText("demo house");
    await guide.getByTestId("guide-back").click();
    await expect(step).toHaveAttribute("data-step", "then");
    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
  });

  test("opens Home Assistant's editor for an administrator, from the More menu", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("more").click();
    await page.getByTestId("guide-menu").click();
    const guide = page.getByTestId("automation-guide");
    await expect(guide).toBeVisible();
    for (let k = 0; k < 4; k += 1) await guide.getByTestId("guide-next").click();
    await guide.getByTestId("guide-editor").click();
    await expect(guide).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => location.pathname))
      .toBe("/config/automation/edit/new");
  });
});
