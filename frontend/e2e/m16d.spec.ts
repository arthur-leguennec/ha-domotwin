import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** Runs the measure from the panel's menu, in the look shown, to its result. */
async function measure(page: Page): Promise<string> {
  await fromMenu(page, "measure");
  const dialog = page.getByTestId("measure-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("measure-every-look")).not.toBeChecked();
  await page.getByTestId("measure-start").click();
  await expect(page.getByTestId("measure-progress")).toBeVisible();
  // Two runs of five seconds, the demo house opened and drawn first.
  await expect(page.getByTestId("measure-result")).toBeVisible({ timeout: 90_000 });
  return page.getByTestId("measure-row").inputValue();
}

test.describe("the measure of a device (D-053)", () => {
  test.setTimeout(150_000);

  test("is an administrator's", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("measure")).toHaveText("Measure performance");
    // A user has no menu of the home's settings at all.
    await openHarness(page, { mode: "panel", live: true, admin: false });
    await expect(page.getByRole("button", { name: "Export plan" })).toBeVisible();
    await expect(page.getByTestId("more")).toHaveCount(0);
    await expect(page.getByTestId("measure")).toHaveCount(0);
  });

  test("measures the demo house, nothing sent, and gives a row to copy", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const row = await measure(page);
    // The demo house, in the look shown, from this panel's first picture of the home.
    await expect(page.getByTestId("demo-bar")).toBeVisible();
    const cells = row.slice(2, -2).split(" | ");
    expect(cells).toHaveLength(14);
    expect(cells[4]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cells[5]).toBe("day");
    expect(cells[7]).toMatch(/^\d+(\.\d)? s$/);
    expect(cells[9]).toMatch(/^\d+(\.\d)? \/ \d+(\.\d)? ms$/);
    expect(Number(cells[13])).toBeGreaterThan(1000);
    const result = page.getByTestId("measure-result");
    await expect(result).toContainText("Performance of this device");
    await expect(result.locator("[data-look='day']")).toContainText("Turning");
    // Nothing went anywhere but the page's own files.
    expect(requests.filter((url) => !url.startsWith("http://127.0.0.1"))).toEqual([]);
    // The panel's tools are back.
    await page.getByTestId("measure-result").getByText("Close").click();
    await expect(result).toHaveCount(0);
    await expect(page.getByTestId("edit-mode")).toBeEnabled();
  });

  test("copies the row, or selects it where the clipboard is refused", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            (window as never as { __copied: string }).__copied = text;
            return (window as never as { __refuse?: boolean }).__refuse
              ? Promise.reject(new DOMException("Refused", "NotAllowedError"))
              : Promise.resolve();
          },
        },
      });
    });
    const row = await measure(page);
    await page.getByTestId("measure-copy").click();
    await expect(page.getByTestId("measure-copied")).toHaveText("Copied.");
    expect(await page.evaluate(() => (window as never as { __copied: string }).__copied)).toBe(row);
    await page.evaluate(() => {
      (window as never as { __refuse: boolean }).__refuse = true;
    });
    await page.getByTestId("measure-copy").click();
    await expect(page.getByTestId("measure-copied")).toContainText("copy it yourself");
    const area = page.getByTestId("measure-row");
    await expect(area).toBeFocused();
    expect(
      await area.evaluate((field: HTMLTextAreaElement) => [
        field.selectionStart,
        field.selectionEnd,
      ]),
    ).toEqual([0, row.length]);
  });

  test("in French", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, lang: "fr" });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("measure")).toHaveText("Mesurer les performances");
    await page.getByTestId("measure").click();
    await expect(page.getByTestId("measure-dialog")).toContainText("Rien n’est envoyé ni gardé");
    await expect(page.getByTestId("measure-start")).toHaveText("Commencer");
    // Cancelled, nothing happens.
    await page.getByTestId("measure-dialog").getByText("Annuler").click();
    await expect(page.getByTestId("measure-dialog")).toHaveCount(0);
    await expect(page.getByTestId("demo-bar")).toHaveCount(0);
  });
});
