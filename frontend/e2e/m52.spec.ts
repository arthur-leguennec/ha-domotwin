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

/** The Home tab's lamps on, opened. */
async function openLamps(page: Page): Promise<void> {
  await page.getByTestId("tab-home").click();
  const chip = page.getByTestId("home-lights");
  if ((await chip.getAttribute("aria-expanded")) !== "true") await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
}

test.describe("several sites in one Home Assistant (D-090)", () => {
  test("an administrator gives each site its storeys", async ({ page }) => {
    await openHarness(page, { mode: "panel", storeys: 2, start: "3d" });
    await expect(page.getByTestId("site-switcher")).toHaveCount(0);
    await fromMenu(page, "settings");
    const sites = page.getByTestId("settings-sites");
    await page.getByTestId("settings-site-add").click();
    // The first site has every storey.
    const first = sites.locator("fieldset.site").nth(0);
    await expect(first.getByTestId("settings-site-storey")).toHaveCount(2);
    await expect(first.locator('[data-storey="storey-2"]')).toBeChecked();
    await first.getByTestId("settings-site-name").fill("Main street");
    await page.getByTestId("settings-site-add").click();
    const second = sites.locator("fieldset.site").nth(1);
    await second.getByTestId("settings-site-name").fill("Harbour office");
    // A storey given to the second is taken from the first; taken from the second, the first's
    // again.
    await second.locator('[data-storey="storey-2"]').check();
    await expect(first.locator('[data-storey="storey-2"]')).not.toBeChecked();
    // Named within its site: the harbour office's only storey is its ground floor.
    await expect(second.locator('label:has([data-storey="storey-2"])')).toHaveText("Ground floor");
    await second.locator('[data-storey="storey-1"]').check();
    await second.locator('[data-storey="storey-1"]').uncheck();
    await expect(first.locator('[data-storey="storey-1"]')).toBeChecked();
    await page.getByTestId("settings-save").click();
    await expect
      .poll(async () =>
        (
          ((await savedSettings(page)) as { sites?: { name: string; storeys: string[] }[] })
            .sites ?? []
        ).map(({ name, storeys }) => ({ name, storeys })),
      )
      .toEqual([
        { name: "Main street", storeys: ["storey-1"] },
        { name: "Harbour office", storeys: ["storey-2"] },
      ]);
    // One site at a time, from the toolbar.
    const switcher = page.getByTestId("site-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher.locator("option")).toHaveText(["Main street", "Harbour office"]);
    await expect(switcher).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(switcher).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("the panel shows one site, its storeys, its lamps, and remembers it", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      storeys: 2,
      sites: true,
      start: "3d",
    });
    const switcher = page.getByTestId("site-switcher");
    await expect(switcher).toHaveValue("site-1");
    // One storey on this site: no storey to switch to.
    await expect(page.getByTestId("storeys")).toHaveCount(0);
    // The office lamp is the other site's.
    const lamp = page.locator(".ha-card[data-type='tile'][data-entity='light.office_lamp']");
    await openLamps(page);
    await expect(page.getByTestId("home-lights")).not.toContainText("1 lamp on");
    await expect(lamp).toHaveCount(0);
    await switcher.selectOption("site-2");
    await openLamps(page);
    await expect(page.getByTestId("home-lights")).toContainText("1 lamp on");
    await expect(lamp).toBeVisible();
    // The Rooms tab: the office, not the apartment's rooms.
    await page.getByTestId("tab-rooms").click();
    const rooms = page.getByTestId("rooms-list");
    await expect(rooms).toContainText("Office");
    await expect(rooms).not.toContainText("Kitchen");
    // This device opens on it again.
    await page.reload();
    await expect(page.getByTestId("site-switcher")).toHaveValue("site-2");
  });

  test("a room of the other site opened from the Rooms tab shows that site", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      storeys: 2,
      sites: true,
      route: true,
      path: "/rooms/office",
    });
    // The office is the harbour office's: that site shown, the office open.
    await expect(page.getByTestId("site-switcher")).toHaveValue("site-2");
    await expect(page.getByTestId("room-page")).toHaveAttribute("data-area", "office");
  });

  test("a site's own opening hours", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      storeys: 2,
      sites: "own-hours",
      workplace: true,
      hours: "off",
      start: "home",
    });
    // The apartment closed at the workplace's hours…
    await expect(page.getByTestId("home-hours")).toContainText("Closed");
    // …the harbour office open at its own.
    await page.getByTestId("site-switcher").selectOption("site-2");
    await expect(page.getByTestId("home-hours")).toContainText("Open until");
  });
});
