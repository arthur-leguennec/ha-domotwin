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

interface Saved {
  name?: string;
  rooms?: { id?: string; name?: string }[];
  doors?: { style?: string }[];
  windows?: unknown[];
  items?: { id?: string; kind?: string }[];
}

async function calls<T>(page: Page, type: string): Promise<T[]> {
  return page.evaluate(
    (type) =>
      (window as never as { __calls: ({ type: string } & Record<string, unknown>)[] }).__calls
        .filter((call) => call.type === type)
        .map((call) => call as never),
    type,
  );
}

async function lastSave(page: Page): Promise<Saved | undefined> {
  const saves = await calls<{ plan: Saved }>(page, "domotwin/plan/save");
  return saves[saves.length - 1]?.plan;
}

test.describe("more imports (D-063)", () => {
  test("a robot vacuum's map, as Valetudo gives it", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, `${FIXTURES}/robot.json`);
    await expect(page.getByText("Imported from a robot vacuum’s map: robot.")).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("4 rooms");
    const plan = await lastSave(page);
    expect(plan?.rooms?.map((r) => [r.id, r.name])).toEqual([
      ["segment-16", "Living room"],
      ["segment-17", "Kitchen"],
      ["segment-18", "Hall"],
      ["segment-19", "Bedroom"],
    ]);
    expect(plan?.doors?.map((d) => d.style ?? "hinged")).toEqual(["opening", "hinged", "hinged"]);
    expect(plan?.items?.map((i) => i.kind)).toEqual(["robot-vacuum"]);
  });

  test("a robot's map straight from Home Assistant, its dock linked to its vacuum", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", valetudo: 1 });
    await page.getByTestId("robot-map").click();
    await expect(
      page.getByText(
        "Imported from a robot vacuum’s map: Rockrobo. Its dock is linked to Rockrobo.",
      ),
    ).toBeVisible();
    // Read through Home Assistant, with the user's session: the camera's picture.
    const fetches = await calls<{ path: string }>(page, "fetch");
    expect(fetches.map((f) => f.path)).toContain("/api/camera_proxy/camera.rockrobo_map_data");
    const plan = await lastSave(page);
    expect(plan?.rooms).toHaveLength(4);
    const saves = await calls<{ bindings: { elements: Record<string, unknown> } }>(
      page,
      "domotwin/bindings/save",
    );
    expect(saves[saves.length - 1]?.bindings.elements.dock).toEqual({
      entities: [{ entity_id: "vacuum.rockrobo" }],
    });
    // In the menu too, once there is a plan.
    await page.getByTestId("more").click();
    await expect(page.getByTestId("more-robot-map")).toBeVisible();
  });

  test("a dock that could not be linked: the plan is kept, the message says why", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", valetudo: 1 });
    await page.evaluate(() => {
      (window as never as { __failBindings: boolean }).__failBindings = true;
    });
    await page.getByTestId("robot-map").click();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Its dock could not be linked to Rockrobo");
    await expect(toast).toHaveClass(/error/);
    expect((await lastSave(page))?.rooms).toHaveLength(4);
  });

  test("two robots: the one picked, in French", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", valetudo: 2, lang: "fr" });
    await page.getByTestId("robot-map").click();
    const picker = page.getByTestId("import-robots");
    await expect(picker.getByRole("heading")).toHaveText("La carte de quel robot ?");
    await expect(picker.locator("button.storey")).toHaveCount(2);
    await picker.getByRole("button", { name: /Rockrobo/ }).click();
    await expect(
      page.getByText(
        "Importé depuis la carte d’un robot aspirateur : Rockrobo. Sa base est liée à Rockrobo.",
      ),
    ).toBeVisible();
  });

  test("no robot's map for those who cannot import", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", valetudo: 1, admin: false });
    await expect(page.getByTestId("demo-try")).toBeVisible();
    await expect(page.getByTestId("robot-map")).toHaveCount(0);
  });

  test("a Floorplanner project: its floors are storeys", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", lang: "fr" });
    await importFile(page, `${FIXTURES}/apartment.fml`);
    const picker = page.getByTestId("import-storeys");
    await expect(picker.locator("button.storey")).toHaveCount(2);
    await expect(picker.locator("button.storey").first()).toContainText("Ground floor");
    await picker.locator("button.storey").first().click();
    await expect(
      page.getByText("Importé depuis Floorplanner : Fictional apartment – Ground floor."),
    ).toBeVisible();
    const plan = await lastSave(page);
    expect(plan?.rooms?.map((r) => r.name)).toEqual(["Living room", "Kitchen", "Bathroom", "Hall"]);
    expect(plan?.items?.map((i) => i.kind)).toEqual(["sofa", "box", "fridge", "bathtub"]);
  });

  test("a house scanned as a mesh, every storey at once", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await importFile(page, `${FIXTURES}/house.glb`);
    const picker = page.getByTestId("import-storeys");
    await expect(picker.locator("button.storey")).toHaveCount(2);
    await page.getByTestId("import-all").click();
    await expect(page.getByTestId("toast")).toContainText("2 storeys imported");
    const replaced = await calls<{ storeys: { plan: Saved; elevation: number }[] }>(
      page,
      "domotwin/storeys/replace",
    );
    const storeys = replaced[replaced.length - 1]?.storeys ?? [];
    expect(storeys.map((s) => [s.elevation, s.plan.rooms?.length, s.plan.windows?.length])).toEqual(
      [
        [0, 3, 2],
        [280, 3, 1],
      ],
    );
  });

  test("says what to do with a file it cannot read", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: /Import plan/ })
      .first()
      .click();
    await (
      await chooser
    ).setFiles({
      name: "scan.ply",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n",
      ),
    });
    await expect(
      page.getByText("This file cannot be imported: it holds points without faces", {
        exact: false,
      }),
    ).toBeVisible();
  });
});
