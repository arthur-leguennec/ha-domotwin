import { expect, test } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** What the harness's integration is told, and counts (D-088). */
interface Harness {
  __closedSince?: string;
  __refuseClosedEnergy?: string;
  __closedEnergyAsked?: number;
}

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

  test("is asked for once in ten minutes, said since when the history goes back", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      hours: "off",
      start: "home",
    });
    await page.evaluate(() => {
      (window as never as Harness).__closedSince = "2026-10-16T13:00:00Z";
    });
    await page.getByTestId("home-hours").click();
    const energy = page.getByTestId("home-hours-energy");
    await expect(energy).toHaveText(
      "While closed, the last 7 days: 32 kWh (38% of all) · While closed, since October 16: 126 kWh (36% of all)",
    );
    // To the Rooms tab and back, the details opened again: the answer kept is shown.
    await page.getByTestId("tab-rooms").click();
    await page.getByTestId("tab-home").click();
    await page.getByTestId("home-hours").click();
    await expect(energy).toContainText("since October 16");
    expect(await page.evaluate(() => (window as never as Harness).__closedEnergyAsked)).toBe(1);
  });

  test("an integration older than it says nothing", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      hours: "off",
      start: "home",
    });
    await page.evaluate(() => {
      (window as never as Harness).__refuseClosedEnergy = "unknown_command";
    });
    await page.getByTestId("home-hours").click();
    await expect(page.getByTestId("home-hours-detail")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as never as Harness).__closedEnergyAsked))
      .toBe(1);
    await expect(page.getByTestId("home-hours-energy")).toHaveCount(0);
  });

  test("a home says nothing of it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, hours: "off", start: "home" });
    await expect(page.getByTestId("home-hours")).toHaveCount(0);
    // Nor is it asked for.
    expect(
      await page.evaluate(() => (window as never as Harness).__closedEnergyAsked),
    ).toBeUndefined();
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
      "−10%",
    ]);
    await expect(closed.locator('tr[data-room="kitchen"]').locator("th, td")).toHaveText([
      "Kitchen",
      "4.2 kWh",
      "3 kWh",
      "+40%",
    ]);
    // A private room the viewer may not see is left out, as in the week's energy.
    await expect(closed.locator('tr[data-room="living"]')).toHaveCount(0);
    await expect(page.getByTestId("report-closed-since")).toHaveCount(0);
  });

  test("the weekly report says from when, where the history starts later", async ({ page }) => {
    await openHarness(page, { mode: "panel", weekly: true, workplace: true, hours: "off" });
    await page.evaluate(() => {
      (window as never as Harness).__closedSince = "2026-10-21T13:00:00Z";
    });
    await fromMenu(page, "report-menu");
    await expect(page.getByTestId("report-closed-since")).toHaveText(
      "Counted from October 21: Home Assistant's history goes no further back.",
    );
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
