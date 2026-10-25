import { expect, test, type Page } from "@playwright/test";

import { openHarness } from "./fixtures";

const FIXTURES = "../crates/domotwin-import/tests/fixtures";

async function importFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: /Import plan|Importer un plan/ })
    .first()
    .click();
  await (await chooser).setFiles(path);
}

type Saved = {
  plan: {
    name?: string;
    rooms?: { name?: string }[];
    doors?: unknown[];
    windows?: unknown[];
    items?: { kind?: string }[];
  };
};

async function lastSave(page: Page): Promise<Saved["plan"] | undefined> {
  const calls = await page.evaluate(() =>
    (window as never as { __calls: ({ type: string } & Saved)[] }).__calls.filter(
      (call) => call.type === "domotwin/plan/save",
    ),
  );
  return calls[calls.length - 1]?.plan;
}

test.describe("plans of other apps (D-040)", () => {
  test("a Sweet Home 3D home: its levels are storeys", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, `${FIXTURES}/cottage.sh3d`);
    const picker = page.getByTestId("import-storeys");
    await expect(picker.locator("button.storey")).toHaveCount(2);
    await picker.locator("button.storey").first().click();
    await expect(
      page.getByText("Imported from Sweet Home 3D: cottage – Ground floor."),
    ).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("4 rooms");
    const plan = await lastSave(page);
    expect(plan?.rooms?.map((r) => r.name)).toEqual(["Living room", "Kitchen", "Bathroom", "Hall"]);
    expect(plan?.doors).toHaveLength(4);
    expect(plan?.windows).toHaveLength(3);
    expect(plan?.items).toHaveLength(12);
  });

  test("a DXF drawing in millimetres", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", lang: "fr" });
    await importFile(page, `${FIXTURES}/studio.dxf`);
    await expect(page.getByText("Importé depuis un dessin DXF : studio.")).toBeVisible();
    const plan = await lastSave(page);
    expect(plan?.rooms?.map((r) => r.name)).toEqual(["Séjour", "Chambre"]);
    expect(plan?.items?.map((i) => i.kind)).toEqual(["bed", "sofa", "dining-table", "fridge"]);
  });

  test("a room scan, as RoomPlan's USDZ or its JSON", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, `${FIXTURES}/scan.usdz`);
    await expect(page.getByText("Imported from a room scan: scan.")).toBeVisible();
    const fromUsdz = await lastSave(page);
    expect(fromUsdz?.rooms?.map((r) => r.name)).toEqual(["Living room"]);
    expect(fromUsdz?.items).toHaveLength(6);
    // The same scan as JSON goes to the same import, not to the DomoTwin plan reader; the rooms
    // it names by their kind are named in the user's language.
    await openHarness(page, { mode: "panel", plan: "none", lang: "fr" });
    await importFile(page, `${FIXTURES}/scan.json`);
    await expect(page.getByText("Importé depuis le scan d’une pièce : scan.")).toBeVisible();
    const fromJson = await lastSave(page);
    expect(fromJson?.rooms?.map((r) => r.name)).toEqual(["Séjour"]);
    expect(fromJson?.items?.map((i) => i.kind)).toEqual(fromUsdz?.items?.map((i) => i.kind));
  });

  test("says why a file cannot be read", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: /Import plan/ })
      .first()
      .click();
    await (
      await chooser
    ).setFiles({
      name: "drawing.dxf",
      mimeType: "application/dxf",
      buffer: Buffer.from("AutoCAD Binary DXF\r\n\u001a\u0000"),
    });
    await expect(
      page.getByText("This file cannot be imported: it is a binary DXF drawing", { exact: false }),
    ).toBeVisible();
  });
});
