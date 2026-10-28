import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** What this device keeps of its voice (D-085). */
function kept(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("domotwin-voice"));
}

test.describe("voice off on a device (D-085)", () => {
  test("turned off in the voice settings, kept on the device, back on in its choices", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", voice: true, start: "3d" });
    const mic = page.getByTestId("voice");
    await expect(mic).toBeVisible();
    await fromMenu(page, "voice-settings");
    const dialog = page.getByTestId("voice-dialog");
    const here = dialog.getByTestId("voice-device");
    await expect(here).toBeChecked();
    await here.uncheck();
    // Gone at once, and kept on this device only.
    await expect(mic).toHaveCount(0);
    expect(await kept(page)).toBe("off");
    await dialog.locator("[data-cancel]").click();
    // Opened again: still off.
    await openHarness(page, { mode: "panel", voice: true, start: "3d" });
    await expect(page.getByTestId("overview")).toBeVisible();
    await expect(page.getByTestId("voice")).toHaveCount(0);
    // Your choices (from the Home tab): on again.
    await page.getByTestId("tab-home").click();
    await page.getByTestId("choices-open").click();
    const choices = page.locator("domotwin-choices");
    await expect(choices.getByTestId("choices-voice")).not.toBeChecked();
    await choices.getByTestId("choices-voice").check();
    await choices.getByTestId("choices-save").click();
    await expect(choices).toHaveCount(0);
    await page.getByTestId("tab-3d").click();
    await expect(page.getByTestId("voice")).toBeVisible();
    expect(await kept(page)).toBeNull();
  });

  test("the card on the same device follows it", async ({ page }) => {
    await openHarness(page, { voice: true });
    await expect(page.getByTestId("voice")).toBeVisible();
    await page.evaluate(() => window.localStorage.setItem("domotwin-voice", "off"));
    await openHarness(page, { voice: true });
    await expect(page.getByTestId("overview")).toBeVisible();
    await expect(page.getByTestId("voice")).toHaveCount(0);
  });

  test("a wall screen set without voice has no microphone", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      voice: true,
      wall: true,
      deviceScreen: "hall",
    });
    // The hall's screen opens on Home: its 3D tab has the microphone.
    await page.getByTestId("tab-3d").click();
    await expect(page.getByTestId("voice")).toBeVisible();
    await fromMenu(page, "screens-menu");
    const dialog = page.getByTestId("screens-dialog");
    await expect(dialog.getByTestId("screens-voice")).toBeChecked();
    await dialog.getByTestId("screens-voice").uncheck();
    await dialog.getByTestId("screens-save").click();
    await expect(dialog.getByTestId("screens-status")).toHaveText("hall is saved.");
    expect(
      await page.evaluate(
        () =>
          (window as never as { __screens: () => Record<string, { voice?: boolean }> }).__screens()
            .hall?.voice,
      ),
    ).toBe(false);
    await dialog.getByRole("button", { name: "Close" }).click();
    // This device is the hall's screen: no microphone, though its own voice is on.
    await expect(page.getByTestId("voice")).toHaveCount(0);
    expect(await kept(page)).toBeNull();
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { mode: "panel", voice: true, lang: "fr" });
    await fromMenu(page, "voice-settings");
    await expect(page.getByTestId("voice-dialog")).toContainText("La voix sur cet appareil");
  });
});
