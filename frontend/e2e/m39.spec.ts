import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, viewState } from "./fixtures";

/** The values written on the rooms and pieces. */
function labels(page: Page): Promise<string[]> {
  return page.locator("domotwin-view").getByTestId("labels").locator("span").allTextContents();
}

test.describe("Hydro-Québec's peaks (D-058)", () => {
  test("nothing without an integration that reads them", async ({ page }) => {
    await openHarness(page, { live: true, layer: "peak" });
    // A card set to the peak's layer shows none, and the menu does not offer it.
    await expect(page.locator("domotwin-view").getByTestId("legend")).toHaveCount(0);
    await page.getByTestId("layers").click();
    await expect(page.getByTestId("layer-menu").locator('[data-layer="power"]')).toBeVisible();
    await expect(page.getByTestId("layer-menu").locator('[data-layer="peak"]')).toHaveCount(0);
    await openHarness(page, { live: true, mode: "panel", start: "home" });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await expect(page.getByTestId("home-peak")).toHaveCount(0);
  });

  test("during a peak, the rooms shed or still heating, and what they draw", async ({ page }) => {
    await openHarness(page, { live: true, peak: "hydroqc" });
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="peak"]').click();
    const legend = page.locator("domotwin-view").getByTestId("legend");
    await expect(legend).toHaveAttribute("data-phase", "peak");
    await expect(legend).toContainText("Hydro-Québec peaks");
    await expect(legend).toContainText(/Peak until (tomorrow )?\d\d:\d\d/);
    // The living room's thermostat set back, the bedroom still heating.
    await expect(legend.locator('[data-role="shed"]')).toHaveText("1 room shed");
    await expect(legend.locator('[data-role="heating"]')).toHaveText("1 room still heating");
    await expect(legend).toContainText("The rooms draw 1.6 kW");
    expect(JSON.parse((await viewState(page)).layers ?? "{}")).toEqual({
      peak: { living: "shed", bedroom: "heating" },
      draws: { living: 94, kitchen: 48, bedroom: 1450 },
    });
    // What each room draws, at its centre.
    await expect.poll(() => labels(page)).toHaveLength(3);
    expect((await labels(page)).sort()).toEqual(["1.5 kW", "48 W", "94 W"]);
    await expect(legend).toHaveAttribute("aria-label", /1 room shed/);
  });

  test("before it, the pre-heating; HydroPeak's own", async ({ page }) => {
    await openHarness(page, { live: true, peak: "hydropeak", peakPhase: "preheat", layer: "peak" });
    const legend = page.locator("domotwin-view").getByTestId("legend");
    await expect(legend).toHaveAttribute("data-phase", "preheat");
    await expect(legend).toContainText(/Pre-heating, then the peak from (tomorrow )?\d\d:\d\d/);
    await expect(legend.locator('[data-role="preheat"]')).toHaveText("1 room pre-heating");
    expect(JSON.parse((await viewState(page)).layers ?? "{}")).toEqual({
      peak: { bedroom: "preheat" },
      draws: { living: 94, kitchen: 48, bedroom: 1450 },
    });
    // Further ahead: the floor says nothing yet.
    await openHarness(page, {
      live: true,
      peak: "hydropeak",
      peakPhase: "upcoming",
      layer: "peak",
    });
    await expect(legend).toHaveAttribute("data-phase", "upcoming");
    await expect(legend).toContainText(/Pre-heating from (tomorrow )?\d\d:\d\d/);
    expect(JSON.parse((await viewState(page)).layers ?? "{}")).toEqual({});
    // None announced.
    await openHarness(page, { live: true, peak: "hydroqc", peakPhase: "none", layer: "peak" });
    await expect(legend).toHaveText(/No peak announced/);
  });

  test("on the Home tab: the next peak, the rooms, and the way to see it in 3D", async ({
    page,
  }) => {
    await openHarness(page, { live: true, mode: "panel", start: "home", peak: "hydroqc" });
    const chip = page.getByTestId("home-peak");
    await expect(chip).toHaveText(/Peak until (tomorrow )?\d\d:\d\d/);
    await expect(chip).toHaveClass(/warning/);
    await chip.click();
    const detail = page.getByTestId("home-peak-detail");
    await expect(detail.locator('[data-room="bedroom"]')).toHaveText(
      "Bedroom: still heating, 1.5 kW",
    );
    await expect(detail.locator('[data-room="living"]')).toHaveText("Living room: shed, 94 W");
    await expect(detail.locator('[data-room="kitchen"]')).toHaveText("Kitchen: 48 W");
    await page.getByTestId("home-peak-3d").click();
    await expect(page.getByTestId("tab-3d")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("domotwin-view").getByTestId("legend")).toHaveAttribute(
      "data-phase",
      "peak",
    );
  });

  test("hydroqc's calendar, in French", async ({ page }) => {
    await openHarness(page, {
      live: true,
      mode: "panel",
      start: "home",
      lang: "fr",
      peak: "calendar",
      peakPhase: "upcoming",
    });
    const chip = page.getByTestId("home-peak");
    await expect(chip).toHaveText(/Pointe (demain )?\d\d:\d\d/);
    await chip.click();
    await expect(page.getByTestId("home-peak-detail")).toContainText(
      /Prochaine pointe : (demain )?\d\d:\d\d à /,
    );
    await expect(page.getByTestId("home-peak-detail")).toContainText(
      /Préchauffage dès (demain )?\d\d:\d\d/,
    );
    // No peak announced: its calendar has no event, hydroqc's button says it reads the peaks.
    await openHarness(page, { live: true, lang: "fr", peak: "calendar", peakPhase: "none" });
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="peak"]').click();
    await expect(page.locator("domotwin-view").getByTestId("legend")).toContainText(
      "Aucune pointe annoncée",
    );
  });

  test("tomorrow's announced peak, played in the sandbox", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      sandbox: true,
      peak: "hydroqc",
      peakPhase: "upcoming",
    });
    await fromMenu(page, "sandbox-menu");
    await expect(page.getByTestId("sandbox-bar")).toBeVisible();
    await page.getByTestId("sandbox-day").click();
    const said = page.getByTestId("sandbox-peak");
    await expect(said).toBeVisible();
    // The peak's day, unless it is today already.
    const toItsDay = page.getByTestId("sandbox-peak-day");
    if (await toItsDay.isVisible()) await toItsDay.click();
    await expect(said).toContainText("The announced peak plays on this day");
    await page.getByTestId("sandbox-day-apply").click();
    // On the day's line, and in the report: what each room did.
    await expect(page.getByTestId("sandbox-peak-band").first()).toBeVisible();
    await page.getByTestId("sandbox-report").click();
    const rooms = page.getByTestId("sandbox-peak-rooms");
    await expect(rooms.locator('[data-room="living"]')).toContainText(/Living room: .*shed/);
    await expect(rooms.locator('[data-room="bedroom"]')).toContainText(/Bedroom: .*still heating/);
  });

  test("from the Home tab, an administrator plays the peak's day in the sandbox", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      sandbox: true,
      start: "home",
      peak: "hydroqc",
      peakPhase: "upcoming",
    });
    await page.getByTestId("home-peak").click();
    await page.getByTestId("home-peak-sandbox").click();
    await expect(page.getByTestId("sandbox-bar")).toBeVisible();
    // Shown from its pre-heating, on its day.
    await expect(page.getByTestId("sandbox-peak-band").first()).toBeVisible();
    await page.getByTestId("sandbox-day").click();
    await expect(page.getByTestId("sandbox-peak")).toContainText(
      "The announced peak plays on this day",
    );
  });
});
