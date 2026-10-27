import { expect, test, type Locator, type Page } from "@playwright/test";

import { fromMenu, openHarness, settle, viewState } from "./fixtures";

// The reports' weeks are Montréal's: their days are read there.
test.use({ timezoneId: "America/Toronto" });

interface Call {
  type: string;
  detail?: { entityId?: string };
  settings?: Record<string, unknown>;
}

function calls(page: Page, type: string): Promise<Call[]> {
  return page.evaluate(
    (wanted) =>
      (window as never as { __calls: Call[] }).__calls.filter((call) => call.type === wanted),
    type,
  );
}

/** Opens the weekly report from the panel's menu. */
async function openReport(page: Page): Promise<Locator> {
  await fromMenu(page, "report-menu");
  const dialog = page.getByTestId("report-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A room of the plans, as the report draws it. */
function room(dialog: Locator, id: string): Locator {
  return dialog.locator(`g.room[data-room="${id}"]`);
}

test.describe("the weekly report (D-066)", () => {
  test("says what needs a look this week, room by room and section by section", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", weekly: true });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("report-menu")).toHaveText("Weekly report");
    await page.getByTestId("report-menu").click();
    const dialog = page.getByTestId("report-dialog");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Weekly report");
    await expect(page.getByTestId("report-week")).toHaveText(
      "The week of October 19 to October 25",
    );
    await expect(page.getByTestId("report-counts").locator("a")).toHaveText([
      "2 batteries low",
      "1 device unavailable",
      "1 update waiting",
      "2 repairs waiting",
      "1 upkeep task due",
      "1 automation to look at",
      "1 Zigbee device on a weak link",
    ]);
    // The plan: each room tinted by what needs a look in it, its week's energy written.
    await expect(room(dialog, "bedroom")).toHaveAttribute("data-count", "2");
    await expect(room(dialog, "bedroom")).toHaveClass(/tint-2/);
    await expect(room(dialog, "hall")).toHaveClass(/tint-1/);
    await expect(room(dialog, "living")).toHaveClass(/tint-0/);
    await expect(room(dialog, "living")).toHaveAttribute(
      "aria-label",
      "Living room: nothing to look at, 13 kWh",
    );
    await expect(dialog.getByText("4 items are in no room of the plans.")).toBeVisible();
    // Each item: what it is, where, whether it is new.
    const batteries = dialog.locator('[data-section="batteries"]');
    await expect(batteries.locator("h3")).toHaveText("Batteries low (2)");
    const motion = batteries.locator('li[data-key="battery:dev-hall-motion"]');
    await expect(motion).toContainText("Hall motion sensor");
    await expect(motion).toContainText("8 % · CR2032 · Hall");
    await expect(motion.locator("[data-new]")).toHaveText("New");
    await expect(
      batteries.locator('li[data-key="battery:binary_sensor.bedroom_window_battery"] [data-new]'),
    ).toHaveCount(0);
    await expect(dialog.locator('[data-section="unavailable"] li')).toContainText(
      "unavailable for 3 days · Kitchen",
    );
    await expect(dialog.locator('[data-section="updates"] li')).toContainText("1.2 → 1.3");
    await expect(dialog.locator('[data-section="repairs"] li').nth(1)).toContainText(
      "named in your configuration, not in Home Assistant",
    );
    await expect(dialog.locator('[data-section="upkeep"] li')).toContainText(
      "Clean the filter · overdue since October 20 · Bathroom",
    );
    await expect(dialog.locator('[data-section="automations"] li')).toContainText(
      "failed 2 times this week · Light not found",
    );
    await expect(dialog.locator('[data-section="radios"] li')).toContainText(
      "its way's weakest link: LQI 60, 2 hops · Bedroom",
    );
    // The week's energy against the week before, the home's and each room's.
    const energy = page.getByTestId("report-energy");
    await expect(energy.locator("tbody tr").first().locator("th, td")).toHaveText([
      "The home",
      "84 kWh",
      "100 kWh",
      "−16 %",
    ]);
    await expect(energy.locator('tr[data-room="kitchen"]').locator("th, td")).toHaveText([
      "Kitchen",
      "7 kWh",
      "5 kWh",
      "+40 %",
    ]);
    // The week's Hydro-Québec peaks; what was done since the last report.
    await expect(page.getByTestId("report-peaks").locator("li")).toContainText(
      "1.5 kWh from the grid · the rooms: Kitchen 0.4 kWh",
    );
    await expect(page.getByTestId("report-done")).toContainText("TV firmware (Updates waiting)");

    // A room picked: only what is in it; picked again, every room.
    await room(dialog, "bedroom").click();
    await expect(page.getByTestId("report-room")).toHaveText("Only what is in Bedroom");
    await expect(room(dialog, "bedroom")).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("section[data-section] li[data-key]")).toHaveCount(2);
    await expect(energy).toHaveCount(1);
    await room(dialog, "bedroom").press("Enter");
    await expect(page.getByTestId("report-room")).toHaveCount(0);
    await expect(dialog.locator("section[data-section] li[data-key]")).toHaveCount(9);
  });

  test("opens each item where Home Assistant shows it, or in 3D", async ({ page }) => {
    await openHarness(page, { mode: "panel", weekly: true });
    const dialog = await openReport(page);
    await expect(page.getByTestId("report-maintenance")).toHaveAttribute("href", "/maintenance");
    await expect(
      dialog.locator('[data-section="automations"] [data-testid="report-open"]'),
    ).toHaveAttribute("href", "/config/automation/trace/1700000000001?run_id=r-1");
    await expect(
      dialog.locator('[data-section="unavailable"] [data-testid="report-open"]'),
    ).toHaveAttribute("href", "/config/devices/device/dev-kitchen-plug");
    await expect(
      dialog.locator('[data-section="repairs"] li').first().getByTestId("report-open"),
    ).toHaveAttribute("href", "/config/repairs");
    // What Watchman finds missing has no page in Home Assistant.
    await expect(
      dialog.locator('[data-section="repairs"] li').nth(1).getByTestId("report-open"),
    ).toHaveCount(0);
    await dialog.locator('[data-section="updates"] [data-testid="report-open"]').click();
    expect((await calls(page, "hass-more-info")).map((call) => call.detail?.entityId)).toEqual([
      "update.router",
    ]);

    // Shown in 3D: the report closes, the room is framed.
    await settle(page);
    const before = (await viewState(page)).stats?.camera;
    await dialog
      .locator('[data-section="batteries"] li')
      .first()
      .getByTestId("report-show")
      .click();
    await expect(dialog).toHaveCount(0);
    await settle(page);
    await expect
      .poll(async () => (await viewState(page)).stats?.camera.distance ?? Infinity)
      .toBeLessThan(before?.distance ?? 0);
  });

  test("writes one now, and keeps its settings", async ({ page }) => {
    await openHarness(page, { mode: "panel", weekly: true });
    const dialog = await openReport(page);
    await page.getByTestId("report-write").click();
    await expect(page.getByTestId("report-status")).toHaveText("A report was written.");
    const pick = page.getByTestId("report-pick");
    await expect(pick.locator("option")).toHaveText([
      "The week of October 19 to October 25 (written by hand)",
      "The week of October 19 to October 25",
      "The week of October 12 to October 18",
    ]);
    // Written by hand: nothing new since the report it follows.
    await expect(dialog.locator("[data-new]")).toHaveCount(0);
    // An earlier week.
    await pick.selectOption("1");
    await expect(page.getByTestId("report-counts").locator("a")).toHaveText([
      "1 battery low",
      "1 update waiting",
    ]);
    await expect(page.getByTestId("report-peaks")).toContainText("No peak this week.");

    // The settings: the day, the hour, the notification, the battery's level.
    await page.getByTestId("report-settings").click();
    const form = page.getByTestId("report-settings-form");
    await expect(page.getByTestId("report-weekday").locator("option:checked")).toHaveText("Monday");
    await page.getByTestId("report-weekday").selectOption("6");
    await page.getByTestId("report-hour").selectOption("18");
    await page.getByTestId("report-notify").uncheck();
    await page.getByTestId("report-battery").fill("15");
    await page.getByTestId("report-battery").dispatchEvent("change");
    // No AI task in this home: plain lists.
    await expect(page.getByTestId("report-summary-by").locator("option")).toHaveText([
      "Nobody: plain lists",
    ]);
    await page.getByTestId("report-save").click();
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId("report-status")).toHaveText("Saved.");
    expect((await calls(page, "domotwin/report/settings")).at(-1)?.settings).toEqual({
      weekly: true,
      weekday: 6,
      hour: 18,
      notify: false,
      summary: null,
      battery: 15,
    });

    // The integration refuses to write one: said.
    await page.evaluate(() => {
      (window as never as { __refuseReport: string }).__refuseReport = "not_loaded";
    });
    await page.getByTestId("report-write").click();
    await expect(page.getByTestId("report-error")).toContainText(
      "The report could not be written:",
    );
  });

  test("the notification's link opens the report it names, for administrators", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", weekly: true, report: 1 });
    await expect(page.getByTestId("report-dialog")).toBeVisible();
    await expect(page.getByTestId("report-week")).toHaveText(
      "The week of October 12 to October 18",
    );
    // Left out of the address once read.
    expect(await page.evaluate(() => new URLSearchParams(location.search).has("report"))).toBe(
      false,
    );
    // A report no longer kept: the newest.
    await openHarness(page, { mode: "panel", weekly: true, report: 99 });
    await expect(page.getByTestId("report-week")).toHaveText(
      "The week of October 19 to October 25",
    );
    // Not an administrator: nothing opens.
    await openHarness(page, { mode: "panel", weekly: true, report: 1, admin: false });
    await page.waitForTimeout(300);
    await expect(page.getByTestId("report-dialog")).toHaveCount(0);
  });

  test("no report yet; one summed up by an AI task", async ({ page }) => {
    await openHarness(page, { mode: "panel", weekly: "none" });
    await openReport(page);
    await expect(page.getByTestId("report-none")).toHaveText(
      "No report yet: the first one is written on Monday at 8:00 AM.",
    );
    await page.getByTestId("report-write").click();
    await expect(page.getByTestId("report-nothing")).toHaveText("Nothing needs a look this week.");

    await openHarness(page, { mode: "panel", weekly: "summary" });
    await openReport(page);
    await expect(page.getByTestId("report-summary")).toContainText(
      "The hall motion sensor needs a CR2032, and the evening lights failed twice.",
    );
    await expect(page.getByTestId("report-summary")).toContainText("Summed up by Helper");
    await page.getByTestId("report-settings").click();
    await expect(page.getByTestId("report-summary-by").locator("option:checked")).toHaveText(
      "Helper",
    );
    await expect(page.getByTestId("report-settings-form")).toContainText(
      "The report's facts are sent to that AI task, which may be an online service.",
    );
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { mode: "panel", weekly: true, lang: "fr" });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("report-menu")).toHaveText("Bilan de la semaine");
    await page.getByTestId("report-menu").click();
    await expect(page.getByTestId("report-week")).toHaveText(
      "La semaine du 19 octobre au 25 octobre",
    );
    await expect(page.getByTestId("report-counts").locator("a").first()).toHaveText(
      "2 piles faibles",
    );
    const dialog = page.getByTestId("report-dialog");
    await expect(dialog.locator('[data-section="upkeep"] li')).toContainText(
      "Clean the filter · en retard depuis le 20 octobre",
    );
    await expect(
      page.getByTestId("report-energy").locator("tbody tr").first().locator("th, td"),
    ).toHaveText(["La maison", "84 kWh", "100 kWh", "−16 %"]);
  });

  test("the demo house has a report of its own, written in the page", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await fromMenu(page, "demo-menu");
    await expect(page.getByTestId("demo-bar")).toBeVisible();
    const dialog = await openReport(page);
    await expect(dialog).toContainText("The demo house's report, written in the page.");
    await expect(dialog.locator('[data-section="batteries"] li').first()).toContainText(
      "Laundry leak sensor",
    );
    await expect(room(dialog, "laundry")).toHaveAttribute("data-count", "2");
    // Two storeys: both drawn, each named.
    await expect(dialog.locator("figure figcaption")).toHaveCount(2);
    // Nothing hands over to Home Assistant's pages from the demo house.
    await expect(dialog.getByTestId("report-open")).toHaveCount(0);
    await page.getByTestId("report-write").click();
    await expect(page.getByTestId("report-status")).toHaveText("A report was written.");
    await expect(page.getByTestId("report-pick").locator("option")).toHaveCount(3);
  });
});
