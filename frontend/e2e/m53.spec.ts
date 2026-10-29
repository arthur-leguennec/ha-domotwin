import { expect, test } from "@playwright/test";

import { openHarness } from "./fixtures";

test.describe("leaving home, and when one is back (D-091)", () => {
  test("asks when one is back, and brings the heating back before", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    await page.getByTestId("demo-try").click();
    await expect(page.getByTestId("demo-bar")).toBeVisible();
    await page.getByTestId("tab-home").click();
    const tile = page.locator('[data-shortcut="leaving"]');
    await tile.click();
    // The question across the row: not known, in a while, at a time, on a day.
    const asking = page.locator(".shortcut.asking.back");
    await expect(asking).toContainText("Leaving home: go ahead?");
    await expect(asking.locator("[data-back]")).toHaveText(["I don’t know", "In…", "At…", "On…"]);
    await asking.locator('[data-back="unknown"]').click();
    await expect(page.getByTestId("back-said")).toHaveText(
      "The heating stays turned down until you put it back.",
    );
    await asking.locator('[data-back="in"]').click();
    await expect(asking.locator('[data-back="in"]')).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("back-in").selectOption("120");
    await expect(page.getByTestId("back-said")).toContainText("Heating back as it was:");
    // A day to come only.
    await asking.locator('[data-back="on"]').click();
    await page.getByTestId("back-date").fill("2020-01-01");
    await expect(page.getByTestId("back-said")).toHaveText("Choose a time still to come.");
    await expect(page.getByTestId("shortcut-yes")).toBeDisabled();
    await asking.locator('[data-back="in"]').click();
    await page.getByTestId("shortcut-yes").click();
    // Done; the heating waits to come back, and can be brought back now or left as it is.
    await expect(page.getByTestId("shortcut-undo")).toContainText("Leaving home: done.");
    await expect(page.getByTestId("shortcut-undo")).toContainText(
      "Undo leaves the locks, the alarm, the robots and the scenes as they are.",
    );
    const heating = page.getByTestId("heating-back");
    await expect(heating).toContainText("Heating back as it was:");
    await page.getByTestId("heating-keep").click();
    await expect(heating).toHaveCount(0);
  });

  test("is set in the shortcut's dialog, its usual return in more options", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    await page.getByTestId("demo-try").click();
    await page.getByTestId("tab-home").click();
    await page.locator('[data-shortcut="leaving"]').click({ button: "right" });
    const dialog = page.getByTestId("shortcut-dialog");
    await expect(dialog.locator('[data-field="back"]')).toBeChecked();
    const more = dialog.getByTestId("back-more");
    await expect(more).toContainText("Usually back");
    await expect(more.locator("[data-day]")).toHaveCount(7);
    await expect(more.locator('[data-day="0"]')).toHaveValue("18:30");
    await expect(more.locator('[data-day="6"]')).toHaveValue("");
    await expect(more.locator('[data-field="ahead"]')).toHaveValue("30");
    // Without asking, the usual return goes with it.
    await dialog.locator('[data-field="back"]').uncheck();
    await expect(dialog.getByTestId("back-more")).toHaveCount(0);
  });
});
