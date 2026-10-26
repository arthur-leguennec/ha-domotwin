import { expect, test, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, stage, viewState } from "./fixtures";

/** What the mocked Home Assistant was asked: services, `hass-default-panel`, more-info. */
function calls(page: Page): Promise<{ type: string; [key: string]: unknown }[]> {
  return page.evaluate(() => (window as never as { __calls: never[] }).__calls);
}

const xy = (point: { x: number; y: number }): [number, number] => [point.x, point.y];

test.describe("the practical home (D-055)", () => {
  test("opens on Home, without the 3D engine, and shows the home at a glance", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await openHarness(page, { mode: "panel", live: true, start: "none", cards: true });
    const home = page.getByTestId("home-tab");
    await expect(home).toBeVisible();
    // The tabs on the side of a computer.
    await expect(page.locator("nav.tabs.side")).toBeVisible();
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("home-lights")).toContainText("lamps on");
    await expect(page.getByTestId("home-openings")).toBeVisible();
    // The weather is Home Assistant's own card.
    await expect(page.locator(".ha-card[data-type='weather-forecast']")).toHaveAttribute(
      "data-entity",
      "weather.home",
    );
    // Nothing starred yet: the way to the Rooms tab.
    await expect(page.getByTestId("home-empty")).toBeVisible();
    // The lamps on, Home Assistant's tile cards, and all of them switched off at once.
    await page.getByTestId("home-lights").click();
    await expect(page.locator(".ha-card[data-type='tile']").first()).toBeVisible();
    await page.getByTestId("home-all-off").click();
    await expect
      .poll(async () => (await calls(page)).some((c) => c.service === "turn_off"))
      .toBe(true);
    // No 3D drawn yet: its engine is not even loaded.
    expect(requests.filter((url) => url.endsWith(".wasm"))).toEqual([]);
    await page.getByTestId("tab-3d").click();
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(requests.some((url) => url.endsWith(".wasm"))).toBe(true);
  });

  test("lists the rooms by floor, opens one, searches, and stars a favourite", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "rooms", storeys: 2, cards: true });
    const list = page.getByTestId("rooms-list");
    await expect(list.locator("[data-floor='ground'] h2")).toHaveText("Ground floor");
    await expect(list.locator("[data-floor='upper'] h2")).toHaveText("Upper floor");
    await list.locator("button[data-area='living_room']").click();
    const room = page.getByTestId("room-page");
    await expect(room.locator("h2")).toHaveText("Living room");
    const pendant = room.locator(".entity[data-entity='light.living_room_pendant']");
    await expect(pendant.locator(".ha-card")).toHaveAttribute("data-type", "tile");
    // A star: kept by the integration, for this user.
    await pendant.getByTestId("star").click();
    await expect(pendant.getByTestId("star")).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => (window as never as { __choices: { favourites: string[] } }).__choices.favourites,
      ),
    ).toEqual(["light.living_room_pendant"]);
    // Back to every room, and a search through the home.
    await page.getByTestId("room-back").click();
    await page.getByTestId("rooms-search").fill("pendant");
    const results = page.getByTestId("rooms-results");
    await expect(results.locator(".entity")).toHaveCount(1);
    await expect(results.locator("h2")).toHaveText("1 found");
    await page.getByTestId("rooms-search").fill("nothing like it");
    await expect(results).toContainText("Nothing found.");
    // The favourite on the Home tab.
    await page.getByTestId("tab-home").click();
    await expect(
      page
        .getByTestId("home-favourites")
        .locator(".ha-card[data-entity='light.living_room_pendant']"),
    ).toBeVisible();
  });

  test("a scene starred is a big button; an entity's controls are Home Assistant's", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "home",
      cards: true,
      favourites: ["scene.living_room_evening", "light.kitchen_ceiling"],
    });
    const scene = page.getByTestId("home-scenes").locator(".ha-card[data-type='button']");
    await expect(scene).toHaveAttribute("data-entity", "scene.living_room_evening");
    await scene.click();
    await expect
      .poll(async () =>
        (await calls(page)).some((c) => c.domain === "scene" && c.service === "turn_on"),
      )
      .toBe(true);
    // A tile opens Home Assistant's own more-info dialog.
    await page.getByTestId("home-favourites").locator(".ha-card").click();
    await expect
      .poll(async () => (await calls(page)).some((c) => c.type === "hass-more-info"))
      .toBe(true);
  });

  test("without Home Assistant's card helpers, plain rows stand in", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "rooms" });
    await page.getByTestId("rooms-list").locator("button[data-area='kitchen']").click();
    const row = page.locator(".entity[data-entity='light.kitchen_ceiling'] .plain");
    await expect(row).toContainText("Kitchen ceiling");
    await row.getByRole("switch").click();
    await expect
      .poll(async () => (await calls(page)).some((c) => c.service === "turn_on"))
      .toBe(true);
  });

  test("follows Home Assistant's address, a room tapped in 3D, and back", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "3d",
      route: true,
    });
    // The panel's own address opens on the user's tab, and says it.
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    await expect(page.getByTestId("summary")).toBeVisible();
    await settle(page);
    await page.mouse.click(...xy(await pointOn(page, "bedroom")));
    await expect(page).toHaveURL(/\/domotwin\/rooms\/bedroom(\?|$)/);
    const room = page.getByTestId("room-page");
    await expect(room.locator("h2")).toHaveText("Bedroom");
    await expect(page.getByTestId("room-back")).toHaveText(/Back to 3D/);
    await page.getByTestId("room-back").click();
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    await expect(stage(page)).toBeVisible();
    // The browser's back: the room again, its way back still to the 3D view.
    await page.goBack();
    await expect(page).toHaveURL(/\/domotwin\/rooms\/bedroom(\?|$)/);
    await expect(room).toBeVisible();
    await expect(page.getByTestId("room-back")).toHaveText(/Back to 3D/);
    await page.getByTestId("tab-home").click();
    await expect(page).toHaveURL(/\/domotwin\/home(\?|$)/);
  });

  test("a private room keeps what it holds", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "rooms",
      private: ["bedroom"],
    });
    const bedroom = page.getByTestId("rooms-list").locator("button[data-area='bedroom']");
    await expect(bedroom).toContainText("Private room");
    await bedroom.click();
    await expect(page.getByTestId("room-private")).toBeVisible();
    await expect(page.getByTestId("room-page").locator(".entity")).toHaveCount(0);
    // Nor does a search find it.
    await page.getByTestId("room-back").click();
    await page.getByTestId("rooms-search").fill("bedside");
    await expect(page.getByTestId("rooms-results")).toContainText("Nothing found.");
  });

  test("your choices: the tab DomoTwin opens on, this device's, a list, opened first", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      cards: true,
      lists: true,
      firstPage: "device",
      admin: false,
    });
    // A user has their choices, not the home's settings.
    await expect(page.getByTestId("more")).toHaveCount(0);
    await page.getByTestId("choices-open").click();
    const dialog = page.getByTestId("choices-dialog");
    await dialog.getByTestId("choices-start").selectOption("rooms");
    await dialog.getByTestId("choices-device").selectOption("home");
    await dialog.getByTestId("choices-add-list").click();
    await dialog.getByText("Shopping").click();
    await dialog.getByTestId("choices-pick-add").click();
    await expect(dialog.getByTestId("choices-cards")).toContainText("List: Shopping");
    await dialog.getByTestId("choices-first").check();
    await dialog.getByTestId("choices-save").click();
    await expect(dialog).toHaveCount(0);
    const saved = await page.evaluate(
      () => (window as never as { __choices: { start?: string; cards: unknown[] } }).__choices,
    );
    expect(saved.start).toBe("rooms");
    expect(saved.cards).toEqual([{ type: "todo-list", entity: "todo.shopping" }]);
    expect(await page.evaluate(() => localStorage.getItem("domotwin-start"))).toBe("home");
    expect((await calls(page)).filter((c) => c.type === "hass-default-panel")).toEqual([
      { type: "hass-default-panel", detail: { defaultPanel: "domotwin" } },
    ]);
    // The list on the Home tab, Home Assistant's own card.
    await expect(
      page.getByTestId("home-cards").locator(".ha-card[data-type='todo-list']"),
    ).toHaveAttribute("data-entity", "todo.shopping");
  });

  test("on a phone, the tabs are at the bottom; in French", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openHarness(page, { mode: "panel", live: true, start: "home", lang: "fr" });
    const tabs = page.locator("nav.tabs.bottom");
    await expect(tabs).toBeVisible();
    await expect(page.getByTestId("tab-home")).toHaveText("Accueil");
    await expect(page.getByTestId("tab-rooms")).toHaveText("Pièces");
    await expect(page.getByTestId("home-lights")).toContainText("lampes allumées");
    await page.getByTestId("tab-rooms").click();
    await expect(page.getByTestId("rooms-search")).toHaveAttribute(
      "placeholder",
      "Un appareil, une pièce…",
    );
    // No sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("a request to show something shows the 3D view", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    // The engine not loaded yet: the request waits for the plan drawn.
    await page.evaluate(() => {
      (window as never as { __show: (request: unknown) => void }).__show({ view: "2d" });
    });
    await expect(page.getByTestId("tab-3d")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect.poll(async () => (await viewState(page)).planView).toBe(true);
  });
});
