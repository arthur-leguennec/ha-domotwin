import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, pointOn, settle } from "./fixtures";

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** The settings the panel saved last. */
function savedSettings(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; settings?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/settings/save");
    return calls[calls.length - 1]?.settings;
  });
}

test.describe("a workplace (D-086)", () => {
  test("an administrator makes the home a workplace, open at a schedule's hours", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, hours: "on", start: "3d" });
    await fromMenu(page, "settings");
    const workplace = page.getByTestId("settings-workplace");
    await expect(workplace).not.toBeChecked();
    await expect(page.getByTestId("settings-hours")).toHaveCount(0);
    await workplace.check();
    await page.getByTestId("settings-hours").selectOption("schedule.opening_hours");
    await page.getByTestId("settings-save").click();
    await expect
      .poll(async () => ((await savedSettings(page)) as { workplace?: unknown }).workplace)
      .toEqual({ hours: "schedule.opening_hours" });
    // The Home tab says it is open, and until when.
    await page.getByTestId("tab-home").click();
    await expect(page.getByTestId("home-hours")).toContainText("Open until");
    // A home again: no hours.
    await fromMenu(page, "settings");
    await page.getByTestId("settings-workplace").uncheck();
    await page.getByTestId("settings-save").click();
    await expect
      .poll(async () => ((await savedSettings(page)) as { workplace?: unknown }).workplace)
      .toBeUndefined();
    await expect(page.getByTestId("home-hours")).toHaveCount(0);
  });

  test("its people stand in their rooms, counted, named nowhere", async ({ page }) => {
    await openHarness(page, { live: true, people: true, workplace: true });
    await settle(page);
    // No name over anyone.
    await expect(page.getByTestId("people").locator(".person-tag")).toHaveCount(0);
    await longPress(page, await pointOn(page, "kitchen"));
    const room = page.getByTestId("room");
    await expect(room.getByTestId("room-counted")).toHaveText("1 person");
    await expect(room.getByTestId("room-people")).toHaveCount(0);
    await expect(room).not.toContainText("Alex");
  });

  test("closed, the Home tab says what was left on and suggests closing up", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      people: true,
      workplace: true,
      hours: "off",
      start: "home",
    });
    // Alex and Sam are in, Kim away: counted, not named.
    const people = page.getByTestId("home-people");
    await expect(people).toHaveText("2 here");
    await people.click();
    const detail = page.getByTestId("home-people-detail");
    await expect(detail).toContainText("never named");
    await expect(detail).not.toContainText("Alex");
    const hours = page.getByTestId("home-hours");
    await expect(hours).toHaveText(/Closed: \d+ left on/);
    await expect(hours).toHaveClass(/warning/);
    await hours.click();
    await expect(page.getByTestId("home-hours-detail").locator(".entity").first()).toBeVisible();
    // Closing up is suggested, not a good night.
    await expect(page.locator('[data-suggestion="close_up"]')).toContainText("Close up");
    await expect(page.locator('[data-suggestion="good_night"]')).toHaveCount(0);
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      people: true,
      workplace: true,
      hours: "on",
      start: "home",
      lang: "fr",
    });
    await expect(page.getByTestId("home-people")).toHaveText("2 présents");
    await expect(page.getByTestId("home-hours")).toContainText("Ouvert jusqu’à");
  });
});
