import { expect, test, type Page } from "@playwright/test";

import { entityState, openHarness, pointOn, settle } from "./fixtures";

async function focus(page: Page, id: string): Promise<void> {
  await page.evaluate((element) => {
    (window as never as { __view: () => { showElement(id: string): boolean } })
      .__view()
      .showElement(element);
  }, id);
  await settle(page);
}

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

test.describe("actions done later (M14)", () => {
  test("a lamp's sheet sets an action, its clock shows over the lamp, and it is cancelled", async ({
    page,
  }) => {
    await openHarness(page, { live: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    await focus(page, "living");
    await longPress(page, await pointOn(page, "floor-lamp"));
    const controls = page.locator("domotwin-controls");
    await expect(controls.getByRole("dialog", { name: "Floor lamp" })).toBeVisible();
    const section = controls.locator("domotwin-schedules");
    await expect(section.getByText("Later", { exact: true })).toBeVisible();
    await section.getByTestId("schedule-add").click();
    await section.getByTestId("schedule-at").fill("06:30");
    await section.getByTestId("schedule-for").selectOption("15");
    await section.getByTestId("schedule-brightness").fill("40");
    await section.getByTestId("schedule-save").click();
    // What was asked of the integration: a time of day, a duration, a brightness.
    const added = await page.evaluate(() =>
      (window as never as { __calls: { type: string }[] }).__calls.find(
        (call) => call.type === "domotwin/schedules/add",
      ),
    );
    expect(added).toMatchObject({
      entities: ["light.living_room_floor_lamp"],
      action: "on",
      at: "06:30",
      duration: 900,
      brightness: 40,
    });
    await expect(section.getByRole("status")).toHaveText("Living room floor lamp will switch on.");
    const item = section.getByTestId("schedule");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("06:30 AM (40 %)");
    await expect(item).toContainText("06:45 AM");
    // A clock over the lamp, with the time.
    const clock = page.locator('.badge-group[data-element="floor-lamp"] .badge.scheduled');
    await expect(clock).toBeVisible();
    await expect(clock).toContainText("06:30");
    // A tap on the clock opens the sheet, and leaves the lamp as it is.
    const before = await entityState(page, "light.living_room_floor_lamp");
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
    await page.locator('.badge-group[data-element="floor-lamp"]').click();
    await expect(controls.getByRole("dialog", { name: "Floor lamp" })).toBeVisible();
    expect(await entityState(page, "light.living_room_floor_lamp")).toBe(before);
    await section.getByTestId("schedule-cancel").click();
    await expect(item).toHaveCount(0);
    await expect(clock).toHaveCount(0);
  });

  test("a refusal is said in the viewer's language", async ({ page }) => {
    await openHarness(page, { live: true, lang: "fr" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.evaluate(() => {
      (window as never as { __failSchedules: boolean }).__failSchedules = true;
    });
    await focus(page, "living");
    await longPress(page, await pointOn(page, "floor-lamp"));
    const section = page.locator("domotwin-controls domotwin-schedules");
    await expect(section.getByText("Plus tard", { exact: true })).toBeVisible();
    await section.getByTestId("schedule-add").click();
    await section.getByTestId("schedule-off").click();
    await expect(section.getByTestId("schedule-for")).toHaveCount(0);
    await section.getByTestId("schedule-save").click();
    await expect(section.getByRole("alert")).toHaveText(
      "Action non programmée : cette heure est passée.",
    );
  });
});
