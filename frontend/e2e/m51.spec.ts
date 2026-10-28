import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** The settings the panel saved last. */
function savedSettings(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; settings?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/settings/save");
    return calls[calls.length - 1]?.settings;
  });
}

/** The services called, as Home Assistant was asked. */
function services(page: Page): Promise<{ domain: string; service: string; data: unknown }[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __calls: { type: string; domain: string; service: string; data: unknown }[];
      }
    ).__calls.filter((call) => call.type === "call_service"),
  );
}

test.describe("a workplace's meeting rooms (D-089)", () => {
  test.beforeEach(async ({ page }) => {
    // 10:00 where the browser is, so that the bedroom's next booking is later today.
    await page.clock.setSystemTime(new Date("2026-10-28T10:00:00"));
  });

  test("an administrator marks the meeting rooms and their calendars", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, workplace: true, start: "3d" });
    await page.evaluate(() => {
      (
        window as never as { __setState: (id: string, state: string, attributes: object) => void }
      ).__setState("calendar.office_bookings", "off", { friendly_name: "Office bookings" });
    });
    await fromMenu(page, "settings");
    const rooms = page.getByTestId("settings-meeting-rooms");
    const living = rooms.locator('[data-room="living"]');
    await expect(living.getByTestId("settings-meeting-calendar")).toHaveCount(0);
    await living.getByTestId("settings-meeting").check();
    await living.getByTestId("settings-meeting-calendar").selectOption("calendar.office_bookings");
    await rooms.locator('[data-room="kitchen"]').getByTestId("settings-meeting").check();
    await page.getByTestId("settings-save").click();
    await expect
      .poll(async () => ((await savedSettings(page)) as { workplace?: unknown }).workplace)
      .toEqual({
        meeting_rooms: { living: { calendar: "calendar.office_bookings" }, kitchen: {} },
      });
    // The Home tab counts them: both free.
    await page.getByTestId("tab-home").click();
    await expect(page.getByTestId("home-meetings")).toHaveText("2 of 2 meeting rooms free");
  });

  test("the Home tab says which are free, taken or booked, and books one", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      meetings: true,
      start: "home",
    });
    const chip = page.getByTestId("home-meetings");
    await expect(chip).toHaveText("2 of 3 meeting rooms free");
    // Someone in the bedroom: taken, though its calendar has nothing now.
    await page.evaluate(() => {
      (
        window as never as { __setState: (id: string, state: string, attributes: object) => void }
      ).__setState("binary_sensor.bedroom_occupancy", "on", { device_class: "occupancy" });
    });
    await expect(chip).toHaveText("1 of 3 meeting rooms free");
    await chip.click();
    const detail = page.getByTestId("home-meetings-detail");
    const living = detail.locator('li[data-room="living"]');
    const bedroom = detail.locator('li[data-room="bedroom"]');
    const kitchen = detail.locator('li[data-room="kitchen"]');
    await expect(living).toHaveAttribute("data-state", "booked");
    await expect(living).toContainText("Booked until 10:45");
    await expect(living.getByTestId("home-meeting-book")).toHaveCount(0);
    await expect(bedroom).toHaveAttribute("data-state", "taken");
    await expect(bedroom).toContainText("Someone is in · Next booking at 12:00");
    // The kitchen has no calendar: free, not booked from here.
    await expect(kitchen).toContainText("Free");
    await expect(kitchen.getByTestId("home-meeting-book")).toHaveCount(0);
    // Booked for 30 minutes in its calendar, from the minute under way; nobody's name in it.
    await bedroom.locator('[data-testid="home-meeting-book"][data-minutes="30"]').click();
    await expect(bedroom).toHaveAttribute("data-state", "booked");
    await expect(bedroom).toContainText("Booked until 10:30");
    const [call] = (await services(page)).filter((each) => each.service === "create_event");
    expect(call).toMatchObject({
      domain: "calendar",
      data: { summary: "Booked from DomoTwin" },
      target: { entity_id: "calendar.bedroom_bookings" },
    });
    const data = call?.data as { start_date_time: string; end_date_time: string };
    expect(Date.parse(data.end_date_time) - Date.parse(data.start_date_time)).toBe(30 * 60_000);
  });

  test("a private room the viewer may not see is not counted", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      meetings: true,
      start: "home",
      private: ["living"],
      admin: false,
    });
    await expect(page.getByTestId("home-meetings")).toHaveText("2 of 2 meeting rooms free");
    await page.getByTestId("home-meetings").click();
    await expect(
      page.getByTestId("home-meetings-detail").locator('li[data-room="living"]'),
    ).toHaveCount(0);
  });

  test("a home has none", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, meetings: true, start: "home" });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await expect(page.getByTestId("home-lights")).toBeVisible();
    await expect(page.getByTestId("home-meetings")).toHaveCount(0);
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      workplace: true,
      meetings: true,
      start: "home",
      lang: "fr",
    });
    await expect(page.getByTestId("home-meetings")).toHaveText(
      "Salles de réunion libres : 2 sur 3",
    );
    await page.getByTestId("home-meetings").click();
    await expect(
      page.getByTestId("home-meetings-detail").locator('li[data-room="living"]'),
    ).toContainText("Réservée jusqu’à 10:45");
    await expect(
      page.getByTestId("home-meetings-detail").locator('li[data-room="bedroom"] button').first(),
    ).toHaveText("Réserver 30 min");
  });
});
