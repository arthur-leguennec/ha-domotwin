import { expect, test, type Locator, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

interface ApiCall {
  type: string;
  method?: string;
  path?: string;
  parameters?: Record<string, unknown>;
  kind?: string;
}

function calls(page: Page, type: string): Promise<ApiCall[]> {
  return page.evaluate(
    (wanted) =>
      (window as never as { __calls: ApiCall[] }).__calls.filter((call) => call.type === wanted),
    type,
  );
}

/** Opens the configuration history from the panel's menu. */
async function openHistory(page: Page): Promise<Locator> {
  await fromMenu(page, "config-history");
  const dialog = page.getByTestId("config-history-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A version of the item open, by its id. */
function version(page: Page, id: number): Locator {
  return page.locator(`[data-version="${id}"]`);
}

test.describe("the configuration history (D-061)", () => {
  test("lists the items kept, by kind and with a search", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("config-history")).toHaveText("Configuration history");
    await page.getByTestId("config-history").click();
    const dialog = page.getByTestId("config-history-dialog");
    await expect(dialog.getByRole("heading")).toHaveText("Configuration history");
    const items = page.getByTestId("config-history-items").locator("[data-item]");
    // The most recently changed first; the default dashboard named as Home Assistant names it.
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("Evening lights");
    await expect(items.nth(0)).toContainText("Automation · 3 versions");
    await expect(items.nth(1)).toContainText("Good night");
    await expect(items.nth(1)).toContainText("Removed");
    await expect(items.nth(2)).toContainText("Hall light on motion");
    await expect(items.nth(2)).toContainText("Your YAML");
    await expect(items.nth(3)).toContainText("Overview");
    await expect(page.getByTestId("config-history-size")).toContainText("of 4 MB used");

    await dialog.locator('[data-kind="script"]').click();
    await expect(items).toHaveCount(1);
    await expect(dialog.locator('[data-kind="script"]')).toHaveAttribute("aria-pressed", "true");
    await dialog.locator('[data-kind="all"]').click();
    await page.getByTestId("config-history-search").fill("HALL motion");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Hall light on motion");
    await page.getByTestId("config-history-search").fill("garage");
    await expect(dialog).toContainText("Nothing matches.");
    // Escape closes it (in the search field, Escape is the field's).
    await dialog.getByRole("heading").click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("says what each version changed, and what putting one back changes", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true });
    const dialog = await openHistory(page);
    await dialog.locator('[data-item="automation:1700000000001"]').click();
    await expect(dialog.getByRole("heading")).toHaveText("Evening lights");
    await expect(page.getByTestId("config-history-back")).toBeFocused();
    // The newest version open: what it changed, in words.
    await expect(version(page, 3)).toContainText("Current");
    const changes = page.getByTestId("config-history-changes");
    await expect(changes.locator("li")).toHaveCount(1);
    await expect(changes.locator('li[data-op="change"]')).toContainText(
      "Changed Trigger 1 › offset “-00:30:00” → “-00:20:00”",
    );
    await expect(page.getByTestId("config-history-put-back")).toHaveCount(0);
    await expect(page.getByTestId("config-history-open")).toHaveAttribute(
      "href",
      "/config/automation/edit/1700000000001",
    );

    // The one before: an action added; compared with the current one, the offset put back.
    await version(page, 2).locator("button.version").click();
    await expect(changes.locator('li[data-op="add"]')).toContainText(
      "Added Action 2 cover.close_cover · cover.living_curtains",
    );
    await page.getByTestId("config-history-compare-current").check();
    await expect(changes.locator("li")).toHaveText([
      /Changed\s*Trigger 1 › offset\s*“-00:20:00” → “-00:30:00”/,
    ]);
    // Its whole configuration can be read.
    await version(page, 2).getByText("Its whole configuration").click();
    await expect(page.getByTestId("config-history-whole")).toContainText('"offset": "-00:30:00"');

    // The oldest kept, compared with the one before it again: nothing known before it.
    await version(page, 1).locator("button.version").click();
    await expect(page.getByTestId("config-history-compare-current")).toBeChecked();
    await page.getByTestId("config-history-compare-before").check();
    await expect(version(page, 1)).toContainText(
      "The oldest version kept: what changed before it is not known.",
    );
  });

  test("puts a version back through Home Assistant's configuration API", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true });
    const dialog = await openHistory(page);
    await dialog.locator('[data-item="automation:1700000000001"]').click();
    await version(page, 1).locator("button.version").click();
    await page.getByTestId("config-history-put-back").click();
    const ask = dialog.locator("[data-ask]");
    await expect(ask).toContainText("Put back Evening lights?");
    await expect(ask.getByText("Cancel")).toBeFocused();
    // Escape cancels the question, not the dialog.
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.getByTestId("config-history-put-back").click();
    await page.getByTestId("config-history-put-back-confirm").click();
    await expect(page.getByTestId("config-history-status")).toContainText(
      "Evening lights is back as it was on",
    );
    const [saved] = await calls(page, "api");
    expect(saved?.method).toBe("POST");
    expect(saved?.path).toBe("config/automation/config/1700000000001");
    expect(saved?.parameters?.triggers).toEqual([
      { trigger: "sun", event: "sunset", offset: "-00:30:00" },
    ]);
    const refreshed = await calls(page, "domotwin/config_history/refresh");
    expect(refreshed.map((call) => call.kind)).toEqual(["automation"]);
    // Its newest version is the one put back, the same as the first.
    await expect(page.locator("[data-version]").first()).toContainText("Current");
    await expect(page.locator("[data-version]").first()).toContainText(
      "The same as the version of",
    );
    await expect(page.locator("[data-version]")).toHaveCount(4);
  });

  test("shows Home Assistant's refusal as it gives it", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true });
    await page.evaluate(() => {
      (window as never as { __refuseConfig: string }).__refuseConfig =
        "Message malformed: Entity light.gone is unknown";
    });
    const dialog = await openHistory(page);
    await dialog.locator('[data-item="automation:1700000000001"]').click();
    await version(page, 2).locator("button.version").click();
    await page.getByTestId("config-history-put-back").click();
    await page.getByTestId("config-history-put-back-confirm").click();
    await expect(page.getByTestId("config-history-error")).toHaveText(
      "Home Assistant did not put this version back: Message malformed: Entity light.gone is unknown",
    );
    await expect(page.locator("[data-version]")).toHaveCount(3);
    expect(await calls(page, "domotwin/config_history/refresh")).toEqual([]);
  });

  test("puts back what was removed, and shows what is in one's own YAML", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true });
    const dialog = await openHistory(page);
    await dialog.locator('[data-item="script:good_night"]').click();
    await expect(dialog).toContainText("No longer in Home Assistant.");
    await expect(version(page, 5)).toContainText("Removed");
    await expect(page.getByTestId("config-history-open")).toHaveCount(0);
    await version(page, 4).locator("button.version").click();
    await page.getByTestId("config-history-put-back").click();
    await page.getByTestId("config-history-put-back-confirm").click();
    await expect(page.getByTestId("config-history-status")).toContainText("Good night is back");
    expect((await calls(page, "api")).map((call) => call.path)).toEqual([
      "config/script/config/good_night",
    ]);

    // Written in one's own YAML files: shown, not put back, no editor to open.
    await page.getByTestId("config-history-back").click();
    await expect(dialog.locator('[data-item="script:good_night"]')).toBeFocused();
    await dialog.locator('[data-item="automation:hall_motion"]').click();
    await expect(dialog).toContainText("Written in your own YAML files");
    await version(page, 6).locator("button.version").click();
    await expect(page.getByTestId("config-history-changes")).toHaveCount(0);
    await expect(page.getByTestId("config-history-put-back")).toHaveCount(0);
    await expect(page.getByTestId("config-history-open")).toHaveCount(0);
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { mode: "panel", configHistory: true, lang: "fr" });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("config-history")).toHaveText("Historique de la configuration");
    await page.getByTestId("config-history").click();
    const dialog = page.getByTestId("config-history-dialog");
    await expect(dialog.locator('[data-kind="automation"]')).toHaveText("Automatisations (2)");
    await expect(dialog.locator('[data-item="dashboard:"]')).toContainText("Aperçu");
    await dialog.locator('[data-item="automation:1700000000001"]').click();
    await expect(page.getByTestId("config-history-changes")).toContainText(
      "Modification Déclencheur 1 › offset",
    );
    await expect(version(page, 3)).toContainText("Actuelle");
  });

  test("shows the demo house's own history, put back in the page", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await fromMenu(page, "demo-menu");
    await expect(page.getByTestId("demo-bar")).toBeVisible();
    const dialog = await openHistory(page);
    await expect(dialog).toContainText("The demo house's own history");
    const items = page.getByTestId("config-history-items").locator("[data-item]");
    await expect(items.first()).toContainText("Evening lights");
    await items.first().click();
    // Nothing hands over to Home Assistant's pages from the demo.
    await expect(page.getByTestId("config-history-open")).toHaveCount(0);
    await page.locator("[data-version]").last().locator("button.version").click();
    await page.getByTestId("config-history-put-back").click();
    await page.getByTestId("config-history-put-back-confirm").click();
    await expect(page.getByTestId("config-history-status")).toContainText("Evening lights is back");
    await expect(page.locator("[data-version]")).toHaveCount(4);
  });
});
