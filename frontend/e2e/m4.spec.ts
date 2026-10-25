import { expect, test, type Page } from "@playwright/test";

import { colorAt, fromMenu, openHarness, settle, viewState } from "./fixtures";

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("summary")).toBeVisible();
  await settle(page);
}

/** Holds the layers still, so that a frame shows the same colours every time. */
async function still(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as never as { __view: () => { engine: { setMotion(on: boolean): void } } })
      .__view()
      .engine.setMotion(false);
  });
}

function setState(
  page: Page,
  id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  return page.evaluate(
    ([entity, value, extra]) => {
      (
        window as never as {
          __setState: (id: string, state: string, attributes: Record<string, unknown>) => void;
        }
      ).__setState(entity, value, extra);
    },
    [id, state, attributes] as const,
  );
}

function labels(page: Page): Promise<string[]> {
  return page.getByTestId("labels").locator("span").allTextContents();
}

test.describe("layers", () => {
  test("the heatmap colours the rooms from their sensors, with a legend and values", async ({
    page,
  }) => {
    await openHarness(page, { live: true });
    await ready(page);
    const wood = await colorAt(page, "hall");
    await page.getByTestId("layers").click();
    await expect(page.getByTestId("layer-menu")).toBeVisible();
    await page.getByTestId("layer-menu").locator('[data-layer="temperature"]').click();
    await expect(page.getByTestId("layer-menu")).toBeHidden();
    await expect(page.getByTestId("legend")).toContainText("Temperature");
    await expect(page.getByTestId("legend")).toContainText("14.0 °C");
    await expect.poll(() => labels(page)).toHaveLength(5);
    expect(await labels(page)).toContain("19.6 °C");
    const state = await viewState(page);
    expect(state.layer).toBe("temperature");
    expect(JSON.parse(state.layers ?? "{}")).toMatchObject({
      heat: "temperature",
      values: { living: 21.4, kitchen: 23.8, hall: 19.6 },
    });
    // The hall, at 19.6 °C, turns teal.
    await still(page);
    const [r, g, b] = await colorAt(page, "hall");
    expect(b).toBeGreaterThan(r + 30);
    expect(g).toBeGreaterThan(r + 30);
    expect([r, g, b]).not.toEqual(wood);
    // A sensor changes: the value follows.
    await setState(page, "sensor.hallway_temperature", "26.2");
    await expect.poll(() => labels(page)).toContain("26.2 °C");
    // Humidity: the rooms without a sensor show nothing.
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="humidity"]').click();
    await expect.poll(() => labels(page)).toHaveLength(4);
    // Off: no legend, no values.
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="off"]').click();
    await expect(page.getByTestId("legend")).toBeHidden();
    await expect(page.getByTestId("labels")).toBeHidden();
    expect((await viewState(page)).layers).toBe("{}");
  });

  test("a heatmap without sensors says so; the 2D plan shows it too", async ({ page }) => {
    await openHarness(page, { live: true, layer: "pm25", view: "2d", lang: "fr" });
    await ready(page);
    await expect.poll(() => labels(page)).toHaveLength(3);
    await expect(page.getByTestId("legend")).toContainText("Particules fines");
    await setState(page, "sensor.living_room_pm25", "unavailable");
    await setState(page, "sensor.kitchen_pm25", "unavailable");
    await setState(page, "sensor.bedroom_pm25", "unavailable");
    await expect(page.getByTestId("legend")).toContainText("aucun capteur");
  });

  test("the power layer tints the running appliances and labels them", async ({ page }) => {
    await openHarness(page, { live: true, layer: "power" });
    await ready(page);
    await expect.poll(async () => (await labels(page)).sort()).toEqual(["10 W", "48 W", "84 W"]);
    await expect(page.getByTestId("legend")).toContainText("3 kW");
    // The washing machine starts: 2.1 kW.
    await setState(page, "sensor.washing_machine_power", "2.1", { unit_of_measurement: "kW" });
    await expect.poll(() => labels(page)).toContain("2.1 kW");
  });

  test("alerts pulse in their room, show in a banner and frame the room", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await expect(page.getByTestId("alerts")).toBeHidden();
    await still(page);
    const calm = await colorAt(page, "hall");
    await setState(page, "binary_sensor.hallway_smoke", "on");
    const banner = page.getByTestId("alerts");
    await expect(banner).toContainText("Smoke in Hall");
    expect((await viewState(page)).alerts).toEqual(["hall"]);
    const [r, g] = await colorAt(page, "hall");
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(calm[0] - 10);
    // A warning comes after the danger.
    await setState(page, "weather.home", "rainy");
    await setState(page, "binary_sensor.living_room_window_contact", "on");
    await expect(banner.locator("button")).toHaveCount(2);
    await expect(banner.locator("button").nth(1)).toContainText("in the rain in Living room");
    await banner.locator("button").first().click();
    await expect(page.getByTestId("room-chip")).toContainText("Hall");
    await setState(page, "binary_sensor.hallway_smoke", "off");
    await setState(page, "weather.home", "sunny");
    await expect(banner).toBeHidden();
  });

  test("the layers' animation runs at 24 frames per second, and not at all for reduced motion", async ({
    page,
  }) => {
    await openHarness(page, { live: true, layer: "temperature" });
    await ready(page);
    const frames = async (): Promise<number> => (await viewState(page)).frames;
    const start = await frames();
    await page.waitForTimeout(800);
    expect(await frames()).toBeGreaterThan(start);
    expect((await viewState(page)).frameInterval).toBeCloseTo(1000 / 24, 1);
    // Without a moving layer, frames come at the display's rate again.
    await page.evaluate(() => {
      (window as never as { __view: () => { setLayer(layer: string): void } })
        .__view()
        .setLayer("off");
    });
    await expect.poll(async () => (await viewState(page)).frameInterval).toBe(0);
    await page.evaluate(() => {
      (window as never as { __view: () => { setLayer(layer: string): void } })
        .__view()
        .setLayer("temperature");
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(400);
    const held = await frames();
    await page.waitForTimeout(600);
    expect(await frames()).toBe(held);
  });

  test("sunlight comes from where the sun is, with the home's north", async ({ page }) => {
    await openHarness(page, {
      live: true,
      mode: "panel",
      sunPosition: { azimuth: 200, elevation: 30 },
      north: 20,
    });
    await ready(page);
    expect((await viewState(page)).sun).toBe("default");
    await page.getByTestId("layers").click();
    await page.getByTestId("real-sun").click();
    await expect.poll(async () => (await viewState(page)).sun).toBe("200:30:20");
    // The sun moves.
    await setState(page, "sun.sun", "above_horizon", { azimuth: 230.2, elevation: 22.1 });
    await expect.poll(async () => (await viewState(page)).sun).toBe("230:22:20");

    // An administrator sets north in the settings: the view follows while it is set.
    await fromMenu(page, "settings");
    const dialog = page.getByTestId("settings-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("settings-north").fill("90");
    await expect.poll(async () => (await viewState(page)).sun).toBe("230:22:90");
    await dialog.getByTestId("settings-save").click();
    await expect(dialog).toBeHidden();
    const stored = await page.evaluate(
      () => (window as never as { __store: { settings: unknown } }).__store.settings,
    );
    expect(stored).toEqual({ north: 90 });
    await expect(page.getByTestId("toast")).toContainText("Settings saved");
  });
});
