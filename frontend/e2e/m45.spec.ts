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

// A fictional identity key, as a Mac's Keychain writes it.
const MAC_KEY = "RERERDMzMzMiIiIiEREREQ==";

test.describe("an iPhone's key without a Mac (D-074)", () => {
  test("a key, however written, is handed to Private BLE Device and the iPhone followed", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: true });
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(
      dialog.getByRole("heading", { name: "An iPhone or an Apple Watch" }),
    ).toBeVisible();
    // The ways to get it, in the guide; the field hides what is typed.
    await expect(dialog.getByTestId("iphone-guide")).toHaveAttribute(
      "href",
      /docs\/bluetooth\.md#an-iphones-identity-key$/,
    );
    const field = dialog.getByTestId("iphone-key");
    // Hidden as typed, yet no password field a password manager offers to keep.
    await expect(field).toHaveAttribute("type", "text");
    expect(
      await field.evaluate((input) =>
        getComputedStyle(input).getPropertyValue("-webkit-text-security"),
      ),
    ).toBe("disc");

    // Not a key; a key Home Assistant does not hear.
    await field.fill("hello");
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-error")).toContainText("not an identity key");
    await field.fill("irk:55555555666666667777777788888888");
    await field.press("Enter");
    await expect(dialog.getByTestId("iphone-error")).toContainText("does not hear");

    // A Mac's base64: added, followed as a phone, the field emptied.
    await field.fill(MAC_KEY);
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-added")).toHaveText(
      "Sam's iPhone added: choose its kind and its owner, then save.",
    );
    await expect(dialog.getByTestId("iphone-error")).toHaveCount(0);
    await expect(field).toHaveValue("");
    const row = dialog.locator('[data-device="sam_s_iphone"]');
    await expect(row).toBeVisible();
    await expect(row.getByTestId("device-kind")).toHaveValue("phone");
    // Added again: already followed.
    await field.fill("11111111 22222222 33333333 44444444");
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-added")).toHaveText(
      "Sam's iPhone is already followed.",
    );

    // A phone that sends no name: called an iPhone, not Home Assistant's default title.
    await field.fill("aaaaaaaa-bbbbbbbb-cccccccc-dddddddd");
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-added")).toHaveText(
      "iPhone added: choose its kind and its owner, then save.",
    );
    await expect(dialog.locator('[data-device="iphone"]').getByTestId("device-name")).toHaveValue(
      "iPhone",
    );
    // A key Private BLE Device already has: followed by its entry.
    await field.fill("22222222333333334444444455555555");
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-added")).toHaveText(
      "Sam's watch was already in Private BLE Device: it is followed now, save to keep it.",
    );
    await expect(dialog.locator('[data-device="sam_s_watch"]')).toBeVisible();

    await dialog.getByTestId("bluetooth-save").click();
    await expect(dialog).toHaveCount(0);
    const saves = await sent(page, "domotwin/locating/save");
    const devices = saves.at(-1)?.devices as Record<string, { match: unknown }>;
    expect(devices.sam_s_iphone?.match).toEqual({ key: "entry-sam-iphone" });
    expect(devices.sam_s_watch?.match).toEqual({ key: "entry-sam-watch" });
    // The key went to Home Assistant only, never into DomoTwin's settings.
    expect(JSON.stringify(saves)).not.toContain(MAC_KEY);
    expect(JSON.stringify(saves)).not.toContain("1111");
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
      dialog.getByRole("heading", { name: "Un iPhone ou une Apple Watch" }),
    ).toBeVisible();
    await dialog.getByTestId("iphone-key").fill(MAC_KEY);
    await dialog.getByTestId("iphone-add").click();
    await expect(dialog.getByTestId("iphone-added")).toContainText("Sam's iPhone ajouté");
  });
});
