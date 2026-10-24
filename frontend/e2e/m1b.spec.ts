import { expect, test, type Page } from "@playwright/test";

import { openHarness } from "./fixtures";

const FIXTURES = "../crates/domotwin-ifc/tests/fixtures";

async function importFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: /Import plan|Importer un plan/ })
    .first()
    .click();
  await (await chooser).setFiles(path);
}

function saves(page: Page): Promise<{ plan: { elements: { type: string }[] } }[]> {
  return page.evaluate(() =>
    (
      window as never as { __calls: { type: string; plan: { elements: { type: string }[] } }[] }
    ).__calls.filter((call) => call.type === "domotwin/plan/save"),
  );
}

test.describe("IFC import", () => {
  test("imports the storey of an IFC file and says what it left out", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, "../examples/demo-apartment.ifc");
    await expect(
      page.getByText(
        "Imported from IFC: Fictional building – Level 0. Left out: 1 unknown or stray piece, 2 outside or overall spaces.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("6 rooms");
    await expect(page.getByTestId("summary")).toContainText("24 pieces");
    const saved = await saves(page);
    expect(saved).toHaveLength(1);
    const types = saved[0]?.plan.elements.map((e) => e.type) ?? [];
    expect(types.filter((t) => t === "door")).toHaveLength(6);
    expect(types.filter((t) => t === "window")).toHaveLength(4);
  });

  test("asks which storey when there are several", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", lang: "fr" });
    await importFile(page, `${FIXTURES}/house-ifc2x3.ifc`);
    const picker = page.getByTestId("ifc-storeys");
    await expect(picker.locator("button.storey")).toHaveCount(2);
    await expect(picker.locator("button.storey").first()).toContainText("Rez-de-chaussée");
    await expect(picker.locator("button.storey").first()).toContainText("4 pièces · 0 m");
    // One import at a time: no other file while the storey is being chosen.
    await expect(page.getByRole("button", { name: "Importer un plan" }).first()).toBeDisabled();
    await picker.getByRole("button", { name: /Étage/ }).click();
    await expect(
      page.getByText("Importé depuis l’IFC : Maison des Exemples – Étage."),
    ).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("2 pièces");
  });

  test("explains why a storey cannot be imported", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, `${FIXTURES}/no-spaces-ifc4.ifc`);
    await expect(page.getByRole("alert")).toContainText(
      "This file cannot be imported: this storey has no spaces (rooms).",
    );
    expect(await saves(page)).toHaveLength(0);
  });

  test("does not load the IFC module before an IFC file is picked", async ({ page }) => {
    const wasm: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".wasm")) wasm.push(request.url());
    });
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(wasm.some((url) => url.includes("domotwin_ifc"))).toBe(false);
    expect(wasm.some((url) => url.includes("domotwin_web"))).toBe(true);
  });
});
