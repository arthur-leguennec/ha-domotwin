import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** The hosts the page asked something of, other than the test server. */
function elsewhere(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol.startsWith("http")) {
      hosts.push(url.hostname);
    }
  });
  return hosts;
}

/** What the page asked of `domotwin/wifi/get`: for which screen, with the password or not. */
async function asked(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as never as { __wifiAsked: unknown[] }).__wifiAsked);
}

/** The dark modules drawn in the QR code. */
async function modules(page: Page): Promise<number> {
  const path = await page.getByTestId("wifi-code").locator("path").getAttribute("d");
  return (path ?? "").split("M").length - 1;
}

test.describe("the Wi-Fi for guests (D-060)", () => {
  test("an administrator gives it once, sees its code, changes it and forgets it", async ({
    page,
  }) => {
    const hosts = elsewhere(page);
    await openHarness(page, { mode: "panel", live: true });
    // Nothing given yet: no button over the view, the form straight away.
    await expect(page.getByTestId("wifi")).toHaveCount(0);
    await fromMenu(page, "wifi-menu");
    const dialog = page.getByTestId("wifi-dialog");
    await expect(dialog).toContainText("Kept in DomoTwin's private storage");
    await dialog.getByTestId("wifi-name-input").fill("Fictional Guests");
    await dialog.getByTestId("wifi-password-input").fill("short");
    await dialog.getByTestId("wifi-save").click();
    await expect(dialog.getByRole("alert")).toContainText("A WPA password is 8 to 63 characters");
    await dialog.getByTestId("wifi-password-input").fill("tea-and-cake-42");
    await dialog.getByTestId("wifi-screens").fill("hall, kitchen");
    await dialog.getByTestId("wifi-save").click();
    // Its code, drawn here; the password hidden until asked for.
    await expect(dialog.getByTestId("wifi-code")).toBeVisible();
    expect(await modules(page)).toBeGreaterThan(200);
    await expect(dialog.getByTestId("wifi-name")).toHaveText("Fictional Guests");
    await expect(dialog.getByTestId("wifi-password")).not.toContainText("tea-and-cake-42");
    await dialog.getByTestId("wifi-reveal").click();
    await expect(dialog.getByTestId("wifi-password")).toContainText("tea-and-cake-42");
    expect(
      await page.evaluate(() => (window as never as { __wifi: () => unknown }).__wifi()),
    ).toEqual({
      name: "Fictional Guests",
      password: "tea-and-cake-42",
      security: "WPA",
      hidden: false,
      screens: ["hall", "kitchen"],
    });
    // Changed without retyping its password: kept.
    const before = await modules(page);
    await dialog.getByTestId("wifi-change").click();
    await dialog.getByTestId("wifi-hidden").check();
    await dialog.getByTestId("wifi-save").click();
    await expect(dialog).toContainText("A hidden network");
    expect(await modules(page)).not.toBe(before);
    // Closed, the button over the view opens it again; forgotten, the button goes.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("wifi").click();
    await dialog.getByTestId("wifi-change").click();
    await dialog.getByTestId("wifi-forget").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("wifi")).toHaveCount(0);
    expect(hosts).toEqual([]);
  });

  test("a screen an administrator chose shows it to anyone; others do not", async ({ page }) => {
    const options = {
      live: true,
      admin: false,
      wifi: "typed",
      wifiScreens: ["hall"],
    } as const;
    // Its name in another case, and its tools hidden, as on a wall screen.
    await openHarness(page, { ...options, screen: "Hall", tools: false });
    await expect(page.getByTestId("wifi")).toBeVisible();
    await expect(page.getByTestId("layers")).toHaveCount(0);
    // Its password asked for only when the dialog opens.
    expect(await asked(page)).toEqual([{ screen: "Hall", password: false }]);
    await page.getByTestId("wifi").click();
    const dialog = page.getByTestId("wifi-dialog");
    await expect(dialog.getByTestId("wifi-code")).toBeVisible();
    await expect(dialog.getByTestId("wifi-name")).toHaveText("Fictional Guests");
    expect(await asked(page)).toContainEqual({ screen: "Hall", password: true });
    // Not to be changed there.
    await expect(dialog.getByTestId("wifi-change")).toHaveCount(0);
    for (const screen of ["kitchen", undefined]) {
      await openHarness(page, { ...options, ...(screen ? { screen } : {}) });
      await expect(page.getByTestId("overview")).toBeVisible();
      await expect(page.getByTestId("wifi")).toHaveCount(0);
    }
  });

  test("left alone, a wall screen closes it, its password with it", async ({ page }) => {
    await openHarness(page, {
      live: true,
      admin: false,
      wifi: "typed",
      wifiScreens: ["hall"],
      screen: "hall",
      idle: 2,
    });
    await page.getByTestId("wifi").click();
    const dialog = page.getByTestId("wifi-dialog");
    await dialog.getByTestId("wifi-reveal").click();
    await expect(dialog.getByTestId("wifi-password")).toContainText("tea-and-cake-42");
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });

  test("without 3D, a wall screen still gives it, and closes it when left alone", async ({
    page,
  }) => {
    // A tablet whose browser has no WebGL2.
    await page.addInitScript(() => {
      const canvas = HTMLCanvasElement.prototype as unknown as {
        getContext: (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown;
      };
      const getContext = canvas.getContext;
      canvas.getContext = function (kind, ...rest) {
        return kind === "webgl2" ? null : getContext.call(this, kind, ...rest);
      };
    });
    await openHarness(page, {
      live: true,
      admin: false,
      wifi: "typed",
      wifiScreens: ["hall"],
      screen: "hall",
      idle: 2,
    });
    await expect(page.getByText("WebGL2")).toBeVisible();
    await page.getByTestId("wifi").click();
    const dialog = page.getByTestId("wifi-dialog");
    await expect(dialog.getByTestId("wifi-code")).toBeVisible();
    await dialog.getByTestId("wifi-reveal").click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });

  test("a router's own code is shown as it is, in French", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, wifi: "image", lang: "fr" });
    await page.getByTestId("wifi").click();
    const dialog = page.getByTestId("wifi-dialog");
    await expect(dialog).toContainText("Wi-Fi des invités");
    await expect(dialog.getByTestId("wifi-image")).toHaveAttribute("src", /^data:image\/svg/);
    await expect(dialog.getByTestId("wifi-code")).toHaveCount(0);
    await dialog.getByTestId("wifi-change").click();
    await expect(dialog.getByTestId("wifi-source-image")).toBeChecked();
    await expect(dialog.getByTestId("wifi-image-entity")).toHaveValue("image.router_guest_wifi");
  });
});
