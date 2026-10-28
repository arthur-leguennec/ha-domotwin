import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle, viewState } from "./fixtures";

/** The panel of the demo home in edit mode, its catalogue open. */
async function catalogue(page: Page, options: { lang?: "en" | "fr" } = {}) {
  await openHarness(page, { mode: "panel", ...options });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.getByTestId("toggle-plan").click();
  await settle(page);
  await page.getByTestId("edit-mode").click();
  await expect(page.getByTestId("edit-status")).toBeVisible();
  await page.getByTestId("edit-add").click();
  return page.getByTestId("catalogue");
}

/** The overlay of the edit session. */
function editLayout(page: Page): Promise<Record<string, { add?: Record<string, unknown> }>> {
  return page.evaluate(() =>
    (
      window as never as {
        __view: () => { editLayout(): Record<string, { add?: Record<string, unknown> }> };
      }
    )
      .__view()
      .editLayout(),
  );
}

test.describe("A library of objects (D-074)", () => {
  test("pictures of the pieces, their styles, and a styled piece added", async ({ page }) => {
    const sheet = await catalogue(page);
    // The library's groups, each piece with a picture drawn by the engine.
    await expect(sheet.getByRole("heading", { name: "Heating and air" })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Pets" })).toBeVisible();
    const sofa = sheet.getByTestId("catalogue-sofa");
    await expect(sofa.locator("img.picture")).toHaveAttribute("src", /^data:image\/png/);
    const drawn = await sofa
      .locator("img.picture")
      .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(drawn).toEqual([272, 204]);
    // A style is a piece of its own, with its size.
    await sheet.getByTestId("catalogue-search").fill("chester");
    await expect(sheet.getByTestId("catalogue-sofa")).toHaveCount(0);
    const chesterfield = sheet.getByTestId("catalogue-sofa.chesterfield");
    await expect(chesterfield).toContainText("Chesterfield · 215 × 92 × 76 cm");
    await expect(chesterfield.locator("img.picture")).toHaveAttribute("src", /^data:image\/png/);
    await chesterfield.click();
    await expect(sheet).toHaveCount(0);
    // Added in the middle of the view, over what stands there.
    await expect
      .poll(async () => (await viewState(page)).edit?.selection)
      .toEqual(["sofa-added-1"]);
    const layout = await editLayout(page);
    expect(layout["sofa-added-1"]?.add).toMatchObject({
      kind: "sofa",
      style: "chesterfield",
      color: "#6e3222",
      size: [215, 92, 76],
    });
  });

  test("searched by other words, in French, accents ignored", async ({ page }) => {
    const sheet = await catalogue(page, { lang: "fr" });
    await expect(sheet.getByRole("heading", { name: "Chauffage et air" })).toBeVisible();
    await sheet.getByTestId("catalogue-search").fill("pompe a chaleur");
    await expect(sheet.getByTestId("catalogue-heat-pump")).toContainText("Thermopompe");
    await expect(sheet.getByTestId("catalogue-sofa")).toHaveCount(0);
    await sheet.getByTestId("catalogue-search").fill("barre de son");
    await expect(sheet.getByTestId("catalogue-speaker.soundbar")).toContainText(
      "Barre de son · 90 × 10 × 7 cm",
    );
    await sheet.getByTestId("catalogue-speaker.soundbar").click();
    await expect(page.getByTestId("edit-status")).toHaveText("Enceinte");
  });
});
