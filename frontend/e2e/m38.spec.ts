import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, viewState } from "./fixtures";

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** The messages sent to Home Assistant of a type. */
function sent(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (kind) =>
      (window as never as { __calls: Record<string, unknown>[] }).__calls.filter(
        (call) => call.type === kind,
      ),
    type,
  );
}

/** Opens the history report of an element of the plan, from its long press (D-058). */
async function openReport(page: Page, element: string, button: string): Promise<Locator> {
  await settle(page);
  await longPress(page, await pointOn(page, element));
  await page.getByTestId(button).click();
  const report = page.getByTestId("history");
  await expect(report).toBeVisible();
  return report;
}

/** The text of each cell of the table's rows, newest first. */
function cells(report: Locator): Promise<string[][]> {
  return report
    .getByTestId("history-table")
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent.trim())),
    );
}

test.describe("history as reports (D-058)", () => {
  test("a device's history: each change, a filter, each hour and the logbook", async ({ page }) => {
    await openHarness(page, { live: true, people: true, formatState: true });
    const report = await openReport(page, "nightstand-left", "controls-history");
    await expect(report.getByRole("heading")).toHaveText("History: Nightstand");
    await expect(report.locator(".chip")).toHaveText(["Bedside left"]);
    // Each change, the latest first, until now: Home Assistant's own words for the states.
    await expect(report.getByTestId("history-summary")).toHaveText("4 changes");
    const rows = await cells(report);
    expect(rows[0]?.slice(1)).toEqual(["now", "30 min", "On"]);
    expect(rows[1]?.slice(2)).toEqual(["2 h 20 min", "Off"]);
    const [asked] = await sent(page, "history/history_during_period");
    expect(asked).toMatchObject({
      entity_ids: ["light.bedside_left"],
      include_start_time_state: true,
      minimal_response: true,
      no_attributes: true,
    });
    // On for at least 20 minutes: the last time only.
    await report.getByTestId("history-compare").selectOption("equal");
    await report.getByTestId("history-value").fill("on");
    await report.getByTestId("history-at-least").fill("20");
    await expect(report.getByTestId("history-summary")).toHaveText("1 period, 30 min in all");
    // Each hour: no statistics for a lamp, worked out from its history.
    await report.getByTestId("history-compare").selectOption("any");
    await report.getByTestId("history-at-least").fill("");
    await report.locator('[data-mode="hours"]').click();
    await expect(report.getByTestId("history-summary")).toHaveText(/^\d+ hours$/);
    await expect(report.locator('tbody tr[data-kind="hour"]').first()).toContainText(/Off|On/);
    const [statistics] = await sent(page, "recorder/statistics_during_period");
    expect(statistics).toMatchObject({ statistic_ids: ["light.bedside_left"], period: "hour" });
    // The logbook, with what caused each change, searched by value.
    await report.locator('[data-mode="logbook"]').click();
    await expect(report.getByTestId("history-summary")).toHaveText("3 entries");
    expect(await cells(report)).toEqual([
      [expect.any(String), "On", "light.turn_on"],
      [expect.any(String), "Off", "Goodnight"],
      [expect.any(String), "On", "Alex Martin"],
    ]);
    await report.getByTestId("history-query").fill("goodnight OFF");
    await expect(report.getByTestId("history-summary")).toHaveText("1 entry");
    // Escape closes it, its search empty first.
    await report.getByTestId("history-query").fill("");
    await report.locator('[data-mode="logbook"]').focus();
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
  });

  test("the bedroom above 24 °C for more than an hour, as CSV", async ({ page }) => {
    await openHarness(page, { live: true, formatState: true });
    const report = await openReport(page, "bedroom", "room-history");
    await expect(report.getByRole("heading")).toHaveText("History: Bedroom");
    // The room's air sensors, temperature first.
    await expect(report.locator(".chip")).toHaveText([
      "Bedroom temperature",
      "Bedroom humidity",
      "Bedroom carbon dioxide",
      "Bedroom pm25",
    ]);
    await report.getByTestId("history-compare").selectOption("above");
    await report.getByTestId("history-value").fill("24");
    await expect(report.getByTestId("history-of")).toHaveValue("sensor.bedroom_temperature");
    await report.getByTestId("history-at-least").fill("1");
    await report.getByTestId("history-unit").selectOption("hours");
    await expect(report.getByTestId("history-summary")).toHaveText("1 period, 1 h 30 min in all");
    expect((await cells(report))[0]?.slice(2)).toEqual([
      "1 h 30 min",
      "Bedroom temperature",
      "24.5 °C to 25.1 °C",
    ]);
    // Of all of them: the humidity is above 24 all day too.
    await report.getByTestId("history-of").selectOption("*");
    await expect(report.getByTestId("history-summary")).toHaveText(/^3 periods/);
    await report.getByTestId("history-of").selectOption("sensor.bedroom_temperature");

    // Every row in the CSV, oldest first, with columns of their own.
    const download = page.waitForEvent("download");
    await report.getByTestId("history-csv").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^history-changes-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await readFile(await file.path(), "utf8")).trim().split("\r\n");
    expect(lines[0]).toBe(
      "entity_id,name,start,end,duration_s,state,held_s,mean,min,max,change,unit",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(
      /^sensor\.bedroom_temperature,Bedroom temperature,[\dT:.Z-]+,[\dT:.Z-]+,5400,,,24\.\d+,24\.5,25\.1,,°C$/,
    );
    // Where the clipboard is refused, the text to copy by hand.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("refused")) },
      });
    });
    await report.getByTestId("history-copy").click();
    await expect(report.getByTestId("history-text")).toBeFocused();
    expect(await report.getByTestId("history-text").inputValue()).toContain("5400,,,24.");

    // Each hour: the statistics' mean, lowest and highest.
    await report.getByTestId("history-compare").selectOption("any");
    await report.getByTestId("history-at-least").fill("");
    await report.locator('[data-mode="hours"]').click();
    await expect(
      report.locator('tbody tr[data-entity="sensor.bedroom_temperature"]').first(),
    ).toContainText(/\d\d\.\d °C \(\d\d\.\d °C to \d\d\.\d °C\)/);
    // Home Assistant's History on the same entities and period.
    await report.getByTestId("history-open").click();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/history");
    expect(url.searchParams.get("entity_id")).toBe(
      "sensor.bedroom_temperature,sensor.bedroom_humidity,sensor.bedroom_carbon_dioxide,sensor.bedroom_pm25",
    );
    expect(url.searchParams.get("start_date")).toMatch(/Z$/);
  });

  test("entities added by a search, taken away; a private room's are not found", async ({
    page,
  }) => {
    await openHarness(page, { live: true, private: ["living"] });
    const report = await openReport(page, "nightstand-left", "controls-history");
    await report.getByTestId("history-add").click();
    const find = report.getByTestId("history-find");
    await expect(find).toBeFocused();
    // The living room is private: its lamps are not offered.
    await find.fill("pendant");
    await expect(report.getByText("No entity found.")).toBeVisible();
    await find.fill("kitchen spots");
    await report
      .getByTestId("history-found")
      .locator('[data-entity="light.kitchen_spots"]')
      .click();
    await expect(report.locator(".chip")).toHaveText(["Bedside left", "Kitchen spots"]);
    await report.getByRole("button", { name: "Take Bedside left away" }).click();
    await expect(report.locator(".chip")).toHaveText(["Kitchen spots"]);
    await expect
      .poll(async () => (await sent(page, "history/history_during_period")).at(-1))
      .toMatchObject({ entity_ids: ["light.kitchen_spots"] });
    await report.getByRole("button", { name: "Take Kitchen spots away" }).click();
    await expect(report.getByText("Add an entity to read its history.")).toBeVisible();
    // Its cross gone, the focus stays in the report: Escape closes it.
    await expect(report.getByTestId("history-add")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
  });

  test("a room that turns private takes its entities out of an open report", async ({ page }) => {
    await openHarness(page, {
      live: true,
      private: ["kitchen"],
      privateWhile: "input_boolean.guests",
    });
    const setGuests = (state: string) =>
      page.evaluate((value) => {
        (window as never as { __setState: (id: string, state: string) => void }).__setState(
          "input_boolean.guests",
          value,
        );
      }, state);
    await setGuests("off");
    const report = await openReport(page, "nightstand-left", "controls-history");
    await report.getByTestId("history-add").click();
    await report.getByTestId("history-find").fill("kitchen spots");
    await report
      .getByTestId("history-found")
      .locator('[data-entity="light.kitchen_spots"]')
      .click();
    await expect(report.locator(".chip")).toHaveText(["Bedside left", "Kitchen spots"]);
    // Guests come: the kitchen is private, its lamp leaves the report; the bedroom's stays.
    await setGuests("on");
    await expect(report.locator(".chip")).toHaveText(["Bedside left"]);
    await report.getByTestId("history-find").fill("kitchen spots");
    await expect(report.getByText("No entity found.")).toBeVisible();
  });

  test("periods: two dates, a year each hour, what is kept, and a refusal; in French", async ({
    page,
  }) => {
    await openHarness(page, { live: true, lang: "fr", historyFail: true });
    const report = await openReport(page, "nightstand-left", "controls-history");
    await expect(report.getByTestId("history-error")).toHaveText(
      "Home Assistant n’a pas donné l’historique : The recorder is busy",
    );
    // A year of changes is too much; of hours, it is read.
    await report.getByTestId("history-period").selectOption("year");
    await expect(report.getByTestId("history-problem")).toContainText("31 jours au plus");
    await report.locator('[data-mode="hours"]').click();
    await expect(report.getByTestId("history-problem")).toHaveCount(0);
    // Two dates, the start after the end: none.
    await report.locator('[data-mode="changes"]').click();
    await report.getByTestId("history-period").selectOption("custom");
    await expect(report.getByTestId("history-from")).not.toHaveValue("");
    for (const [field, value] of [
      ["history-from", "2030-01-02T10:00"],
      ["history-to", "2030-01-01T10:00"],
    ] as const) {
      await report.getByTestId(field).fill(value);
      await report.getByTestId(field).dispatchEvent("change");
    }
    await expect(report.getByTestId("history-problem")).toHaveText(
      "Choisissez un début avant la fin, et pas dans le futur.",
    );
  });

  test("older than Home Assistant keeps each change, the report says so", async ({ page }) => {
    await openHarness(page, { live: true, noStats: true });
    const report = await openReport(page, "nightstand-left", "controls-history");
    await report.getByTestId("history-period").selectOption("month");
    await expect(report.getByTestId("history-kept")).toContainText("10 days unless set otherwise");
    // A year of hours, without statistics: worked out from 31 days of changes, and said so.
    await report.getByTestId("history-period").selectOption("year");
    await report.locator('[data-mode="hours"]').click();
    await expect(report.getByTestId("history-kept")).toContainText(
      "Without statistics, the hours of Bedside left",
    );
    const asked = (await sent(page, "history/history_during_period")).at(-1);
    const days =
      (Date.parse(String(asked?.end_time)) - Date.parse(String(asked?.start_time))) / 86_400_000;
    expect(days).toBeCloseTo(31, 3);
    // Last 24 hours: nothing to say.
    await report.getByTestId("history-period").selectOption("day");
    await expect(report.getByTestId("history-table")).toBeVisible();
    await expect(report.getByTestId("history-kept")).toHaveCount(0);
  });

  test("the demo house's history is its day, without Home Assistant's pages", async ({ page }) => {
    await openHarness(page, { demo: true });
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
    const report = await openReport(page, "floor-lamp", "controls-history");
    await expect(report.getByText("The demo house's history is its day")).toBeVisible();
    await expect(report.getByTestId("history-table")).toBeVisible();
    await expect(report.getByTestId("history-open")).toHaveCount(0);
    // Its logbook: the evening's scene switched it on.
    await report.locator('[data-mode="logbook"]').click();
    await expect(report.getByTestId("history-table")).toContainText("Evening lights");
    // Nothing asked of this home's Home Assistant.
    expect(await sent(page, "history/history_during_period")).toEqual([]);
    expect(await sent(page, "logbook/get_events")).toEqual([]);
  });
});
