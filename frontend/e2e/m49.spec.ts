import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle } from "./fixtures";

/** The front door's doorbell rings now. */
async function ring(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as never as { __ring: () => void }).__ring();
  });
}

test.describe("the maintainer's answers (D-087)", () => {
  test("a doorbell rings over a dashboard's page from the card, its camera and its lock", async ({
    page,
  }) => {
    await openHarness(page, { live: true, safety: true, cards: true });
    await settle(page);
    const doorbell = page.getByTestId("doorbell");
    await expect(doorbell).toHaveCount(0);
    await ring(page);
    await expect(doorbell).toBeVisible();
    // Over the page, not in the card's box.
    await expect(page.locator("body > domotwin-doorbell")).toHaveCount(1);
    await expect(doorbell.locator("h2")).toHaveText("Someone is at the door");
    await expect(doorbell).toContainText("Front door doorbell");
    await expect(page.getByTestId("doorbell-camera")).toBeVisible();
    await expect(page.getByTestId("doorbell-lock")).toBeVisible();
    // Escape closes it; it rings again, and its button closes it.
    await page.keyboard.press("Escape");
    await expect(doorbell).toHaveCount(0);
    await ring(page);
    await expect(doorbell).toBeVisible();
    await page.getByTestId("doorbell-close").click();
    await expect(page.locator("domotwin-doorbell")).toHaveCount(0);
  });

  test("not a doorbell in a private room, nor when the card is told not to", async ({ page }) => {
    await openHarness(page, { live: true, safety: true, cards: true, private: ["hall"] });
    await settle(page);
    await ring(page);
    await page.waitForTimeout(400);
    await expect(page.getByTestId("doorbell")).toHaveCount(0);

    await openHarness(page, { live: true, safety: true, cards: true, doorbell: false });
    await settle(page);
    await ring(page);
    await page.waitForTimeout(400);
    await expect(page.getByTestId("doorbell")).toHaveCount(0);
  });

  test("a room's device in Home Assistant opens the panel on the room, upstairs too", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      storeys: 2,
      route: true,
      path: "/3d",
      room: "up-office",
    });
    const summary = page.locator("domotwin-view").getByTestId("summary");
    await expect(summary).toContainText("upper floor");
    // Asked once: the address no longer asks for it.
    await expect(page).not.toHaveURL(/room=/);
    await expect(page).toHaveURL(/\/domotwin\/3d\?/);
  });

  test("a private room asked for in the address is not shown", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      storeys: 2,
      route: true,
      path: "/3d",
      room: "up-office",
      private: ["up-office"],
    });
    const summary = page.locator("domotwin-view").getByTestId("summary");
    await expect(summary).toContainText("Demo apartment");
    await expect(page).not.toHaveURL(/room=/);
    await page.waitForTimeout(600);
    await expect(summary).not.toContainText("upper floor");
  });
});
