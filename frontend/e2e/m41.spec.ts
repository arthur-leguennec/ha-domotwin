import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** The messages of a type the frontend sent to the mocked Home Assistant. */
function sent(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (type) =>
      (window as never as { __calls: { type: string }[] }).__calls.filter(
        (call) => call.type === type,
      ) as Record<string, unknown>[],
    type,
  );
}

test.describe("locating measured (M41)", () => {
  test("the figures shown beside Bermuda's, paired, copied and started again", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: true });
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(
      dialog.getByRole("heading", { name: "How well the rooms are found" }),
    ).toBeVisible();
    const phone = dialog.locator('[data-measured="alex_phone"]');
    await expect(phone.locator("caption")).toHaveText("Alex's phone");
    const cell = (table: typeof phone, row: string, way: string) =>
      table.locator(`tr[data-row="${row}"] td[data-way="${way}"]`);
    await expect(cell(phone, "changes", "domotwin")).toHaveText("6.8");
    await expect(cell(phone, "right", "domotwin")).toHaveText("97 % (2.4 h)");
    await expect(cell(phone, "short", "bermuda")).toHaveText("157");
    // DomoTwin counted by area too, as Bermuda is.
    await expect(cell(phone, "changes", "by-area")).toHaveText("5.9");
    await expect(phone.locator('td[data-way="agreement"]')).toHaveText("88 %");
    await expect(phone.locator('tr[data-row="changes"] th')).toHaveText("Room changes / h");
    // A thing has no witness, nor Bermuda: a dash, one column.
    const keys = dialog.locator('[data-measured="keys"]');
    await expect(cell(keys, "right", "domotwin")).toHaveText("– (0 h)");
    await expect(keys.locator('td[data-way="bermuda"]')).toHaveCount(0);
    await expect(keys.locator('tr[data-row="agreement"]')).toHaveCount(0);

    // Copied as a table, the devices numbered.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog.getByTestId("measured-copy").click();
    await expect(dialog.getByTestId("measured-copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("| Device 1 | DomoTwin | 5.5 | 6.8 |");
    expect(copied).toContain("| Device 1 | DomoTwin (areas) | 5.5 | 5.9 |");
    expect(copied).toContain("| Device 1 | Bermuda | 5.5 | 38.4 |");
    expect(copied).not.toContain("Alex");

    // Paired with Bermuda's sensor, by its name; saved with the device.
    const row = dialog.locator('[data-device="alex_phone"]');
    await row.getByTestId("device-bermuda").selectOption("sensor.alex_iphone_area");
    await expect(row.getByTestId("device-bermuda").locator("option:checked")).toHaveText(
      "Bermuda: Alex iPhone Area",
    );
    // Asked first: kept, then cleared.
    await dialog.getByTestId("measured-reset").click();
    await expect(dialog.getByText(/^Clear the figures measured since/)).toBeVisible();
    await dialog.getByTestId("measured-reset-keep").click();
    await expect(phone).toBeVisible();
    expect(await sent(page, "domotwin/locating/measure/reset")).toHaveLength(0);
    await dialog.getByTestId("measured-reset").click();
    await dialog.getByTestId("measured-reset-confirm").click();
    await expect(dialog.getByTestId("measured-none")).toBeVisible();
    await expect(dialog.getByTestId("measured-copy")).toBeDisabled();
    expect(await sent(page, "domotwin/locating/measure/reset")).toHaveLength(1);

    await dialog.getByTestId("bluetooth-save").click();
    await expect(dialog).toHaveCount(0);
    const saves = await sent(page, "domotwin/locating/save");
    const devices = saves.at(-1)?.devices as Record<string, { bermuda?: string }>;
    expect(devices.alex_phone?.bermuda).toBe("sensor.alex_iphone_area");
    expect(devices.keys).not.toHaveProperty("bermuda");
  });

  test("in French", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      people: true,
      bluetooth: true,
      lang: "fr",
    });
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(
      dialog.getByRole("heading", { name: "La justesse des pièces trouvées" }),
    ).toBeVisible();
    const phone = dialog.locator('[data-measured="alex_phone"]');
    await expect(phone.locator('tr[data-row="agreement"] th')).toHaveText("Comme Bermuda");
    await expect(phone.locator('tr[data-row="changes"] th')).toHaveText("Changements de pièce / h");
  });
});
