import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** Changes an entity as a device would. */
async function setState(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ([entity, state]) => {
      (window as never as { __setState: (id: string, state: string) => void }).__setState(
        entity as string,
        state as string,
      );
    },
    [id, value],
  );
}

/** The front door's doorbell rings now. */
async function ring(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as never as { __ring: () => void }).__ring();
  });
}

/** The configuration of the Home Assistant card made for an entity (`cards`: made-up helpers). */
async function cardConfig(page: Page, scope: string, entity: string): Promise<unknown> {
  const text = await page
    .getByTestId(scope)
    .locator(`.ha-card[data-entity='${entity}']`)
    .first()
    .getAttribute("data-config");
  return JSON.parse(text ?? "null");
}

test.describe("safety (D-066)", () => {
  test("the Safety tab: the alarm, the doorbell, the cameras side by side, Home Assistant's page", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      safety: true,
      security: true,
      cards: true,
      start: "none",
      userStart: "safety",
      route: true,
    });
    await expect(page).toHaveURL(/\/domotwin\/safety(\?|$)/);
    await expect(page.getByTestId("tab-safety")).toHaveAttribute("aria-current", "page");
    const tab = page.getByTestId("safety-tab");
    // Calm: no alert.
    await expect(tab.getByTestId("safety-alerts")).toContainText("No alert: all is calm.");
    // The alarm, Home Assistant's own alarm-panel card.
    expect(await cardConfig(page, "safety-alarms", "alarm_control_panel.home")).toEqual({
      type: "alarm-panel",
      entity: "alarm_control_panel.home",
    });
    // The doorbell, when it rang last.
    await expect(tab.getByTestId("safety-doorbells")).toContainText("Front door doorbell");
    await expect(tab.getByTestId("safety-doorbells")).toContainText("Last rang");
    // The cameras side by side, the doorbell's first, said to be the doorbell's: stills, live on
    // a tap in Home Assistant's dialog.
    const cameras = tab.getByTestId("safety-cameras").locator("figure");
    await expect(cameras).toHaveCount(2);
    await expect(cameras.first()).toHaveAttribute("data-entity", "camera.front_door");
    await expect(cameras.first().locator("figcaption")).toContainText("Front door doorbell");
    await expect(cameras.nth(1)).toHaveAttribute("data-entity", "camera.living_room");
    expect(await cardConfig(page, "safety-cameras", "camera.front_door")).toEqual({
      type: "picture-entity",
      entity: "camera.front_door",
      camera_view: "auto",
      show_state: false,
    });
    // The locks are on Home Assistant's Security page, which it opens.
    await expect(tab.getByTestId("safety-locks")).toHaveCount(0);
    await tab.getByTestId("safety-security-page").click();
    await expect(page).toHaveURL(/\/security\?historyBack=1$/);
  });

  test("before Home Assistant's Security page, the locks are on the Safety tab", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      safety: true,
      cards: true,
      start: "safety",
    });
    await expect(page.getByTestId("safety-security-page")).toHaveCount(0);
    expect(await cardConfig(page, "safety-locks", "lock.entrance_door")).toEqual({
      type: "tile",
      entity: "lock.entrance_door",
      features: [{ type: "lock-commands" }],
    });
    // Without Home Assistant's card helpers (or in the demo house), plain rows stand in.
    await openHarness(page, { mode: "panel", live: true, safety: true, start: "safety" });
    const camera = page.getByTestId("safety-cameras").locator("[data-entity='camera.front_door']");
    await expect(camera.locator(".plain")).toBeVisible();
    await expect(page.getByTestId("safety-alarms").locator(".plain")).toContainText("Home alarm");
  });

  test("a home without a camera, an alarm or a doorbell says so", async ({ page }) => {
    await openHarness(page, { mode: "panel", start: "safety" });
    await expect(page.getByTestId("safety-empty")).toHaveText(
      "No alarm, camera or doorbell in Home Assistant yet.",
    );
  });

  test("the alerts of the 3D view on every tab: a room's frames it in 3D, the rest on Safety", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home", route: true });
    const bar = page.getByTestId("alert-bar");
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await expect(bar).toHaveCount(0);
    await setState(page, "binary_sensor.kitchen_smoke", "on");
    await expect(bar).toContainText("Smoke in Kitchen");
    await expect(bar.locator("button.alert")).toHaveClass(/danger/);
    // On the Rooms tab too.
    await page.getByTestId("tab-rooms").click();
    await expect(bar).toContainText("Smoke in Kitchen");
    // Past two, the Safety tab lists them all.
    await setState(page, "binary_sensor.bathroom_leak", "on");
    await setState(page, "binary_sensor.hallway_smoke", "on");
    await expect(bar.locator("button.alert")).toHaveCount(2);
    await bar.getByTestId("alert-more").click();
    await expect(page).toHaveURL(/\/domotwin\/safety(\?|$)/);
    const list = page.getByTestId("safety-alerts");
    await expect(list.locator("button.alert")).toHaveCount(3);
    await expect(page.getByTestId("alert-bar")).toHaveCount(0);
    // A room's alert: the 3D view, its room framed.
    await list.locator("button[data-room='kitchen']").click();
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    await expect(page.getByTestId("room-chip")).toContainText("Kitchen");
    await expect(page.getByTestId("alerts")).toContainText("Smoke in Kitchen");
  });

  test("Home Assistant's alerts, chosen on its Security page, on every tab and opening it", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      security: true,
      securityAlerts: ["lock.entrance_door", "binary_sensor.entrance_door_contact:alert"],
      start: "home",
      route: true,
      private: ["hall"],
    });
    const bar = page.getByTestId("alert-bar");
    // The hall is private here (D-039): its door open, chosen as a danger, shows; its lock
    // unlocked, a warning, does not.
    await expect(bar.locator("button.alert")).toHaveCount(1);
    await expect(bar.locator("button.alert")).toHaveText("Entrance door contact: on");
    await openHarness(page, {
      mode: "panel",
      live: true,
      security: true,
      securityAlerts: ["lock.entrance_door", "binary_sensor.kitchen_smoke"],
      start: "home",
      route: true,
    });
    const unlocked = bar.locator("button[data-entity='lock.entrance_door']");
    await expect(unlocked).toHaveText("Entrance door: unlocked");
    await expect(unlocked).not.toHaveClass(/danger/);
    // The kitchen's smoke: the room's alert, said once, first.
    await setState(page, "binary_sensor.kitchen_smoke", "on");
    await expect(bar.locator("button.alert")).toHaveCount(2);
    await expect(bar.locator("button.alert").first()).toHaveText("Smoke in Kitchen");
    // In the 3D view's banner too.
    await page.getByTestId("tab-3d").click();
    const banner = page.getByTestId("alerts");
    await expect(banner.locator("button[data-entity='lock.entrance_door']")).toBeVisible();
    // Chosen otherwise on Home Assistant's page: followed at once.
    await page.evaluate(() => {
      (window as never as { __securityAlerts: (list: unknown[]) => void }).__securityAlerts([
        { entity: "lock.entrance_door", severity: "alert" },
      ]);
    });
    await expect(banner.locator("button[data-entity='lock.entrance_door']")).toHaveClass(/danger/);
    await banner.locator("button[data-entity='lock.entrance_door']").click();
    await expect(page).toHaveURL(/\/security\?historyBack=1$/);
  });

  test("a doorbell rings: full screen on every tab, its camera live and its door's lock", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      safety: true,
      cards: true,
      start: "home",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    const doorbell = page.getByTestId("doorbell");
    await expect(doorbell).toHaveCount(0);
    // Rung long ago, or as DomoTwin opened: nothing.
    await setState(page, "event.front_door_doorbell", "2026-10-24T08:00:00.000+00:00");
    await page.waitForTimeout(300);
    await expect(doorbell).toHaveCount(0);
    await ring(page);
    await expect(doorbell).toBeVisible();
    await expect(doorbell).toHaveAttribute("role", "alertdialog");
    await expect(doorbell.locator("h2")).toHaveText("Someone is at the door");
    await expect(doorbell).toContainText("Front door doorbell");
    expect(await cardConfig(page, "doorbell-camera", "camera.front_door")).toEqual({
      type: "picture-entity",
      entity: "camera.front_door",
      camera_view: "live",
      show_name: false,
      show_state: false,
      tap_action: { action: "none" },
    });
    expect(await cardConfig(page, "doorbell-lock", "lock.entrance_door")).toEqual({
      type: "tile",
      entity: "lock.entrance_door",
      features: [{ type: "lock-commands" }],
    });
    // Escape closes it; it rings again on the 3D tab.
    await page.keyboard.press("Escape");
    await expect(doorbell).toHaveCount(0);
    await page.getByTestId("tab-3d").click();
    await expect(page.getByTestId("summary")).toBeVisible();
    await ring(page);
    await expect(doorbell).toBeVisible();
    await page.getByTestId("doorbell-close").click();
    await expect(doorbell).toHaveCount(0);
    // The demo house is a home of its own: the home's doorbell does not ring over it.
    await fromMenu(page, "demo-menu");
    await expect(page.locator("domotwin-demo-bar")).toBeVisible();
    await ring(page);
    await page.waitForTimeout(300);
    await expect(doorbell).toHaveCount(0);
  });

  test("the full screen goes after two minutes", async ({ page }) => {
    await page.clock.install();
    await openHarness(page, {
      mode: "panel",
      live: true,
      safety: true,
      cards: true,
      start: "home",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await ring(page);
    const doorbell = page.getByTestId("doorbell");
    await expect(doorbell).toBeVisible();
    await page.clock.fastForward("01:50");
    await expect(doorbell).toBeVisible();
    await page.clock.fastForward("00:15");
    await expect(doorbell).toHaveCount(0);
  });

  test("on a phone, four tabs at the bottom; in French", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openHarness(page, {
      mode: "panel",
      live: true,
      safety: true,
      cards: true,
      start: "safety",
      lang: "fr",
    });
    await expect(page.locator("nav.tabs.bottom a")).toHaveCount(4);
    await expect(page.getByTestId("tab-safety")).toHaveText("Sécurité");
    await expect(page.getByTestId("safety-alerts")).toContainText("Aucune alerte");
    await expect(page.getByTestId("safety-cameras").locator("h2")).toHaveText("Caméras");
    await ring(page);
    await expect(page.getByTestId("doorbell").locator("h2")).toHaveText(
      "Quelqu’un sonne à la porte",
    );
    // No sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
