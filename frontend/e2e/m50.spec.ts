import { expect, test } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

test.describe("a workplace's energy while closed (D-088)", () => {
  test("the Home tab's hours say what the place used while closed", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      hours: "off",
      start: "home",
    });
    const hours = page.getByTestId("home-hours");
    await expect(hours).toBeVisible();
    await hours.click();
    await expect(page.getByTestId("home-hours-energy")).toHaveText(
      "While closed, the last 7 days: 32 kWh (38% of all) · While closed, this month: 126 kWh (36% of all)",
    );
  });

  test("a home says nothing of it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, hours: "off", start: "home" });
    await expect(page.getByTestId("home-hours")).toHaveCount(0);
  });

  test("the weekly report has it, the place's and its rooms', both weeks", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      weekly: true,
      workplace: true,
      hours: "off",
      private: ["living"],
    });
    await fromMenu(page, "report-menu");
    const closed = page.getByTestId("report-closed");
    await expect(closed.locator("h3")).toHaveText("While closed");
    await expect(closed.locator(".hint")).toHaveText(
      "38% of what the place used this week was used while it was closed.",
    );
    await expect(closed.locator("tbody tr").first().locator("th, td")).toHaveText([
      "The place",
      "32 kWh",
      "35 kWh",
      "−10 %",
    ]);
    await expect(closed.locator('tr[data-room="kitchen"]').locator("th, td")).toHaveText([
      "Kitchen",
      "4.2 kWh",
      "3 kWh",
      "+40 %",
    ]);
    // A private room the viewer may not see is left out, as in the week's energy.
    await expect(closed.locator('tr[data-room="living"]')).toHaveCount(0);
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      hours: "off",
      start: "home",
      lang: "fr",
    });
    await page.getByTestId("home-hours").click();
    await expect(page.getByTestId("home-hours-energy")).toHaveText(
      "Pendant la fermeture, les 7 derniers jours : 32 kWh (38 % du total) · Pendant la fermeture, ce mois-ci : 126 kWh (36 % du total)",
    );
  });
});
