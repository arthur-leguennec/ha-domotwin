import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle, stage, viewState } from "./fixtures";

/** Opens the layer menu and picks a layer. */
async function chooseLayer(page: Page, layer: string): Promise<void> {
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator(`[data-layer="${layer}"]`).click();
}

/** Picks a radio in the coverage's sheet, and waits for its rooms. */
async function chooseRadio(page: Page, radio: string, rooms = 5): Promise<void> {
  await page.locator(`domotwin-placement [data-radio-kind="${radio}"]`).click();
  await expect(page.locator(`[data-radio-kind="${radio}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("placement-rooms").locator("li")).toHaveCount(rooms);
}

/** What the engine was given for the rooms (`setLayers`). */
async function coverage(page: Page): Promise<Record<string, number> | undefined> {
  const layers = (await viewState(page)).layers;
  const read = layers
    ? (JSON.parse(layers) as { heat?: string; values?: Record<string, number> })
    : {};
  return read.heat === "coverage" ? read.values : undefined;
}

test.describe("radio coverage (D-061)", () => {
  test.beforeEach(({ page }) => {
    // The radio chosen last is the device's: each test starts from the first.
    void page.addInitScript(() => {
      try {
        localStorage.removeItem("domotwin-coverage-radio");
      } catch {
        // No storage.
      }
    });
  });

  test("is offered to administrators only", async ({ page }) => {
    await openHarness(page, { live: true, admin: false });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="power"]')).toBeVisible();
    await expect(page.locator('[data-layer="coverage"]')).toHaveCount(0);
    await openHarness(page, { live: true });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="coverage"]')).toHaveText("Radio coverage");
  });

  test("Bluetooth: the rooms measured first, the spots and the receivers", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, bluetooth: true, radios: true });
    await chooseLayer(page, "coverage");
    const sheet = page.getByTestId("placement");
    await expect(sheet).toContainText("what was measured comes first");
    const rooms = page.getByTestId("placement-rooms");
    await expect(rooms.locator("li")).toHaveCount(5);
    // The hall was taught: what the living room's receiver heard there, not the model's.
    const hall = rooms.locator('[data-room="hall"]');
    await expect(hall).toContainText("Measured by living-proxy: -82 dBm");
    await expect(hall).toContainText("Fair");
    await expect(rooms.locator('[data-room="bedroom"] [data-kind="predicted"]')).toContainText(
      "Predicted:",
    );
    // Worst first: the hall, the only room not covered well.
    await expect(rooms.locator("li").first()).toHaveAttribute("data-room", "hall");
    await expect(page.getByTestId("placement-check")).toContainText(
      "Checked against 1 measurement",
    );
    // The spots, each raising the hall.
    const spots = page.getByTestId("placement-spots").locator("button.spot");
    await expect(spots).toHaveCount(3);
    await expect(spots.first()).toContainText("Hall: Fair → Good");
    // The receiver nobody placed, with the Bluetooth settings at hand.
    await expect(page.getByTestId("placement-unplaced")).toContainText("Not placed: hall-proxy");
    await page.getByTestId("placement-bluetooth").click();
    await expect(page.getByTestId("bluetooth-settings-dialog")).toBeVisible();
  });

  test("colours the rooms, marks the radios and the spots, and shows a spot's", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, bluetooth: true, radios: true });
    await chooseLayer(page, "coverage");
    await expect(page.getByTestId("placement-spots")).toBeVisible();
    await expect
      .poll(() => coverage(page))
      .toEqual({
        living: 3,
        kitchen: 3,
        bathroom: 3,
        hall: 2,
        bedroom: 3,
      });
    await settle(page);
    // Two receivers placed, three spots, over the view.
    await expect(page.locator("domotwin-placement .marker.radio")).toHaveCount(2);
    const markers = page.locator("domotwin-placement .marker.spot");
    await expect(markers).toHaveCount(3);
    const box = await stage(page).boundingBox();
    const first = await markers.first().boundingBox();
    if (!box || !first) throw new Error("not on screen");
    expect(first.x).toBeGreaterThan(box.x);
    expect(first.x + first.width).toBeLessThan(box.x + box.width);
    // A spot chosen: the rooms show what it changes, and again as they are.
    await markers.first().click();
    await expect(markers.first()).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("placement-spots").locator('button.spot[data-spot="1"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await coverage(page))?.hall).toBe(3);
    await page.getByTestId("placement-spots").locator('button.spot[data-spot="1"]').click();
    await expect.poll(async () => (await coverage(page))?.hall).toBe(2);
    // Another layer: the rooms are no longer coloured, the markers go.
    await chooseLayer(page, "off");
    await expect(page.getByTestId("placement")).toHaveCount(0);
    await expect.poll(() => coverage(page)).toBeUndefined();
  });

  test("Zigbee: the plug's weak link measured, the routers where the mesh reaches", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, zha: true, radios: true });
    await chooseLayer(page, "coverage");
    await chooseRadio(page, "zigbee");
    const bathroom = page.getByTestId("placement-rooms").locator('[data-room="bathroom"]');
    await expect(bathroom).toContainText("Measured by Washing machine plug");
    await expect(bathroom).toContainText("Weak");
    await expect(page.getByTestId("placement-agreement")).toContainText(
      "Measured and predicted agree in",
    );
    const spots = page.getByTestId("placement-spots").locator("button.spot");
    await expect(spots.first()).toContainText("Bathroom: Weak → Good");
    await expect(page.getByTestId("placement")).toContainText(
      "a router joins through its neighbours",
    );
    // Without ZHA, Zigbee is not offered.
    await openHarness(page, { mode: "panel", live: true, radios: true });
    await chooseLayer(page, "coverage");
    await expect(page.getByTestId("placement")).toBeVisible();
    await expect(page.locator('[data-radio-kind="zigbee"]')).toHaveCount(0);
  });

  test("Wi-Fi: the devices' signals, an access point placed and removed", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, radios: true });
    await chooseLayer(page, "coverage");
    await chooseRadio(page, "wifi");
    // Two devices report their Wi-Fi signal; the Zigbee sensor's signal is another radio's.
    await expect(page.getByTestId("placement-readings")).toHaveText(
      "2 devices placed in the home report their Wi-Fi signal.",
    );
    const rooms = page.getByTestId("placement-rooms");
    await expect(rooms.locator('[data-room="bathroom"]')).toContainText(
      "Measured by Washer plug WiFi signal: -77 dBm",
    );
    await expect(rooms.locator('[data-room="kitchen"]')).toContainText(
      "Measured by Kitchen display signal: -49 dBm",
    );
    await expect(page.getByTestId("placement-check")).toContainText(
      "Checked against 2 measurements: moved by -",
    );
    const points = page.getByTestId("placement-access-points").locator("li");
    await expect(points).toHaveCount(1);
    await expect(points.first()).toContainText("Kitchen access point");
    // Another one, in the bedroom: a tap on its floor.
    await page.getByTestId("placement-place").click();
    await expect(page.getByTestId("placement")).toContainText(
      "Tap the floor where the access point stands.",
    );
    await settle(page);
    const floor = await page.evaluate(() => {
      const view = (
        window as never as {
          __view: () => {
            engine: { screenPoints(points: number[]): Float64Array };
            canvas: HTMLCanvasElement;
          };
        }
      ).__view();
      const [x, y] = view.engine.screenPoints([620, 600]);
      const k = view.canvas.clientWidth / view.canvas.width;
      return { x: (x ?? 0) * k, y: (y ?? 0) * k };
    });
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("no stage");
    await page.mouse.click(box.x + floor.x, box.y + floor.y);
    await expect(points).toHaveCount(2);
    await expect(points.nth(1)).toContainText("Access point 1");
    const saved = await page.evaluate(
      () =>
        (window as never as { __store: { settings: { access_points: unknown[] } } }).__store
          .settings.access_points,
    );
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ storey: "storey-1", name: "Access point 1" });
    const at = (saved[1] as { at: [number, number] }).at;
    expect(Math.abs(at[0] - 620)).toBeLessThan(15);
    expect(Math.abs(at[1] - 600)).toBeLessThan(15);
    // Both access points are marked on the plan.
    await expect(page.locator("domotwin-placement .marker.radio")).toHaveCount(2);
    // Removed again.
    await page.getByRole("button", { name: "Remove Access point 1" }).click();
    await expect(points).toHaveCount(1);
  });

  test("a private room the viewer may not see shows nothing of its coverage", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, radios: true, private: ["bathroom"] });
    await chooseLayer(page, "coverage");
    await chooseRadio(page, "wifi", 4);
    const sheet = page.getByTestId("placement");
    await expect(page.getByTestId("placement-rooms").locator('[data-room="bathroom"]')).toHaveCount(
      0,
    );
    await expect(sheet).not.toContainText("Washer plug");
    await expect(page.getByTestId("placement-spots")).not.toContainText("Bathroom");
    await expect
      .poll(async () => Object.keys((await coverage(page)) ?? {}).sort())
      .toEqual(["bedroom", "hall", "kitchen", "living"]);
  });

  test("the card shows the coverage without placing", async ({ page }) => {
    await openHarness(page, { live: true, radios: true });
    await chooseLayer(page, "coverage");
    await chooseRadio(page, "wifi");
    await expect(page.getByTestId("placement-access-points")).toContainText("Kitchen access point");
    await expect(page.getByTestId("placement-place")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });

  test("in French", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      lang: "fr",
      live: true,
      bluetooth: true,
      radios: true,
    });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="coverage"]')).toHaveText("Couverture radio");
    await page.locator('[data-layer="coverage"]').click();
    const sheet = page.getByTestId("placement");
    await expect(sheet).toContainText("Couverture radio");
    await expect(sheet).toContainText("ce qui a été mesuré passe en premier");
    await expect(page.getByTestId("placement-rooms").locator('[data-room="hall"]')).toContainText(
      "Mesurée par living-proxy",
    );
    await expect(sheet).toContainText("Où le prochain récepteur aide le plus");
  });
});
