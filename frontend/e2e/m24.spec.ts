import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, viewState } from "./fixtures";

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** The configuration a made-up card of Home Assistant's was made with. */
async function configOf(card: Locator): Promise<Record<string, unknown>> {
  return JSON.parse((await card.getAttribute("data-config")) ?? "{}") as Record<string, unknown>;
}

test.describe("history and energy, with Home Assistant's own cards (D-069)", () => {
  test("a room's graphs: Home Assistant's cards over a day or a week, a table, its History", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "rooms",
      route: true,
      cards: true,
    });
    await page.getByTestId("rooms-list").locator("button[data-area='living_room']").click();
    await page.getByTestId("room-graphs").click();
    await expect(page).toHaveURL(/\/domotwin\/rooms\/living_room\/graphs(\?|$)/);
    const graphs = page.getByTestId("room-graphs-page");
    await expect(graphs.locator("h2")).toHaveText("Living room: graphs");
    // One of Home Assistant's cards for each kind of measure, the doors, windows and presence last.
    const cards = graphs.locator(".ha-card");
    await expect(cards).toHaveCount(7);
    expect(
      await cards.evaluateAll((all) => all.map((card) => card.getAttribute("data-type"))),
    ).toEqual(Array(7).fill("history-graph"));
    expect(await configOf(cards.first())).toEqual({
      type: "history-graph",
      title: "Temperature",
      entities: ["sensor.living_room_temperature"],
      hours_to_show: 24,
    });
    expect(
      await cards.evaluateAll((all) =>
        all.map(
          (card) =>
            (JSON.parse(card.getAttribute("data-config") ?? "{}") as { title: string }).title,
        ),
      ),
    ).toEqual([
      "Temperature",
      "Humidity",
      "CO₂",
      "Fine particles (PM2.5)",
      "Power",
      "Doors and windows",
      "Presence",
    ]);
    expect(await configOf(cards.nth(4))).toMatchObject({
      entities: ["sensor.floor_lamp_power", "sensor.tv_power"],
    });
    // The last week: the same cards, over seven days.
    await page.getByTestId("graphs-week").click();
    await expect(page.getByTestId("graphs-week")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await configOf(cards.first())).hours_to_show).toBe(168);
    // As a table: the history report of the same sensors over the same week (D-058).
    await page.getByTestId("graphs-table").click();
    const report = page.getByTestId("history");
    await expect(report).toBeVisible();
    await expect(report.locator("h2")).toHaveText("History: Living room");
    await expect(report.getByTestId("history-period")).toHaveValue("week");
    await expect(report.locator(".chips li.chip")).toHaveCount(8);
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    // Home Assistant's own History, on the same entities and period.
    await page.getByTestId("graphs-ha-history").click();
    await expect(page).toHaveURL(/\/history\?entity_id=sensor\.living_room_temperature%2C/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("entity_id")?.split(",")).toContain("binary_sensor.living_room_motion");
    const span =
      Date.parse(params.get("end_date") ?? "") - Date.parse(params.get("start_date") ?? "");
    expect(span).toBe(7 * 24 * 3_600_000);
    await page.goBack();
    await expect(graphs).toBeVisible();
    // Back to the room, then to every room.
    await page.getByTestId("graphs-back").click();
    await expect(page).toHaveURL(/\/domotwin\/rooms\/living_room(\?|$)/);
    await expect(page.getByTestId("room-page").locator("h2")).toHaveText("Living room");
    await page.getByTestId("room-back").click();
    await expect(page.getByTestId("rooms-list")).toBeVisible();
  });

  test("opened from a room's panel in 3D, its way back leads there", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "3d",
      route: true,
      cards: true,
    });
    await expect(page.getByTestId("summary")).toBeVisible();
    await settle(page);
    await longPress(page, await pointOn(page, "bedroom"));
    await page.getByTestId("room-graphs").click();
    await expect(page).toHaveURL(/\/domotwin\/rooms\/bedroom\/graphs(\?|$)/);
    const cards = page.getByTestId("room-graphs-page").locator(".ha-card");
    // The thermostat with the room's temperature.
    expect(await configOf(cards.first())).toMatchObject({
      title: "Temperature",
      entities: ["climate.bedroom", "sensor.bedroom_temperature"],
    });
    await expect(page.getByTestId("graphs-back")).toHaveText(/Back to Bedroom/);
    await page.getByTestId("graphs-back").click();
    await expect(page).toHaveURL(/\/domotwin\/rooms\/bedroom(\?|$)/);
    await expect(page.getByTestId("room-back")).toHaveText(/Back to 3D/);
    await page.getByTestId("room-back").click();
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    // The room's panel is still there, as it was left.
    await expect(page.getByTestId("room")).toBeVisible();
  });

  test("a private room has no graphs, nor what is linked to it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "rooms", private: ["bedroom"] });
    await page.getByTestId("rooms-list").locator("button[data-area='bedroom']").click();
    await expect(page.getByTestId("room-private")).toBeVisible();
    await expect(page.getByTestId("room-graphs")).toHaveCount(0);
  });

  test("the Energy tab opens Home Assistant's Energy page, which leads back", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "home",
      route: true,
      energyPage: true,
    });
    const energy = page.getByTestId("tab-energy");
    await expect(energy).toHaveText("Energy");
    await expect(energy).toHaveAttribute(
      "href",
      "/energy?historyBack=1&backPath=%2Fdomotwin%2Fhome",
    );
    await page.getByTestId("tab-rooms").click();
    await expect(energy).toHaveAttribute(
      "href",
      "/energy?historyBack=1&backPath=%2Fdomotwin%2Frooms",
    );
    await energy.click();
    await expect(page).toHaveURL(/\/energy\?historyBack=1&backPath=%2Fdomotwin%2Frooms$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/domotwin\/rooms(\?|$)/);
    await expect(page.getByTestId("rooms-list")).toBeVisible();
  });

  test("no Energy tab where Home Assistant has no Energy page, or nothing set up", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect(page.getByTestId("tab-energy")).toHaveCount(0);
    // Its page would show only its setup wizard.
    await openHarness(page, { mode: "panel", live: true, start: "home", energyPage: "empty" });
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as never as { __calls: { type?: string }[] }).__calls.some(
            (call) => call.type === "energy/get_prefs",
          ),
        ),
      )
      .toBe(true);
    await expect(page.getByTestId("tab-energy")).toHaveCount(0);
  });

  test("in the demo house: the power layer, and a room's graphs in plain rows", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true, energyPage: true });
    await page.getByTestId("demo-try").click();
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
    // Its energy is DomoTwin's own: the 3D view on its power layer, the home's energy above it.
    await page.getByTestId("tab-home").click();
    await page.getByTestId("tab-energy").click();
    await expect(page.getByTestId("tab-3d")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("domotwin-view").getByTestId("energy")).toBeVisible();
    // Home Assistant's cards are not in the demo house: what each sensor says now.
    await page.getByTestId("tab-rooms").click();
    await page.getByTestId("rooms-list").locator("button[data-area='living_room']").click();
    await page.getByTestId("room-graphs").click();
    const first = page.getByTestId("room-graphs-page").locator(".plain.graph").first();
    await expect(first).toContainText("Temperature");
    await expect(first).toContainText("Living room temperature");
    await expect(first).toContainText("what each says now");
    await expect(page.getByTestId("graphs-ha-history")).toHaveCount(0);
    // Its table answers from its own day.
    await page.getByTestId("graphs-table").click();
    await expect(page.getByTestId("history")).toBeVisible();
  });

  test("on a phone, in French: the Energy tab among the others at the bottom, the graphs' words", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "rooms",
      lang: "fr",
      cards: true,
      energyPage: true,
    });
    await expect(page.locator("nav.tabs.bottom a")).toHaveCount(5);
    await expect(page.getByTestId("tab-energy")).toHaveText("Énergie");
    await page.getByTestId("rooms-list").locator("button[data-area='kitchen']").click();
    await page.getByTestId("room-graphs").click();
    await expect(page.getByTestId("room-graphs-page").locator("h2")).toHaveText(
      "Kitchen : graphiques",
    );
    await expect(page.getByTestId("graphs-day")).toHaveText("Dernières 24 heures");
    expect(await configOf(page.locator(".ha-card").first())).toMatchObject({
      title: "Température",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
