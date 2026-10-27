import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, viewState } from "./fixtures";

interface Call {
  type: string;
  storeys?: { plan: { rooms: { id: string; name: string }[]; items?: { id: string }[] } }[];
  bindings?: {
    rooms: Record<string, { area?: string }>;
    elements: Record<string, { entities: { entity_id: string }[] }>;
  };
}

function calls(page: Page, type: string): Promise<Call[]> {
  return page.evaluate(
    (wanted) =>
      (window as never as { __calls: Call[] }).__calls.filter((call) => call.type === wanted),
    type,
  );
}

test.describe("a first launch in five minutes (D-083)", () => {
  test("draws the home from Home Assistant's areas, its devices placed and linked", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true, storeys: 2 });
    await page.getByTestId("from-areas").click();
    const dialog = page.getByTestId("first-launch");
    await expect(dialog).toBeVisible();
    // Home Assistant's floors, each with its areas.
    expect((await dialog.locator("legend").allInnerTexts()).map((text) => text.trim())).toEqual([
      "Ground floor",
      "Upper floor",
    ]);
    const areas = await dialog.locator("label[data-area]").count();
    expect(areas).toBeGreaterThan(3);
    await page.getByTestId("first-build").click();
    // The steps of getting started, the plan done.
    const steps = page.getByTestId("getting-started");
    await expect(steps).toBeVisible();
    await expect(steps.locator('li[data-step="plan"]')).toHaveAttribute("data-done", "");
    await expect(steps.locator('li[data-step="areas"]')).toHaveAttribute("data-done", "");
    await expect(steps.locator('li[data-step="devices"]')).toHaveAttribute("data-done", "");
    // Two storeys stored, every area a room linked to it.
    const [replaced] = await calls(page, "domotwin/storeys/replace");
    expect(replaced?.storeys).toHaveLength(2);
    const rooms = replaced?.storeys?.flatMap((s) => s.plan.rooms) ?? [];
    expect(rooms).toHaveLength(areas);
    const saved = (await calls(page, "domotwin/bindings/save")).at(-1);
    for (const room of rooms) expect(saved?.bindings?.rooms[room.id]?.area).toBeTruthy();
    const linked = Object.values(saved?.bindings?.elements ?? {}).flatMap((e) =>
      e.entities.map((entity) => entity.entity_id),
    );
    expect(linked).toContain("binary_sensor.kitchen_smoke");
    // The engine draws it: rooms, doors, windows and pieces.
    await expect.poll(async () => (await viewState(page)).summary?.rooms).toBeGreaterThan(0);
    const summary = (await viewState(page)).summary;
    expect(summary?.doors).toBeGreaterThan(0);
    expect(summary?.windows).toBeGreaterThan(0);
    expect(summary?.furniture).toBeGreaterThan(0);
    await expect(page.getByTestId("toast")).toContainText("Your home is drawn");
  });

  test("draws only the areas picked, without furniture if asked", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true, storeys: 2 });
    await page.getByTestId("from-areas").click();
    const dialog = page.getByTestId("first-launch");
    // The whole upper floor left out, and the furniture.
    await dialog.locator("fieldset").nth(1).locator("legend input").uncheck();
    await page.getByTestId("first-furnish").uncheck();
    await page.getByTestId("first-build").click();
    await expect(page.getByTestId("getting-started")).toBeVisible();
    const [replaced] = await calls(page, "domotwin/storeys/replace");
    expect(replaced?.storeys).toHaveLength(1);
    const saved = (await calls(page, "domotwin/bindings/save")).at(-1);
    const pieces = replaced?.storeys?.[0]?.plan.items ?? [];
    // Every piece is a device, linked.
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) expect(saved?.bindings?.elements[piece.id]).toBeDefined();
  });

  test("draws nothing when no area is picked", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    await page.getByTestId("from-areas").click();
    const dialog = page.getByTestId("first-launch");
    await dialog.locator("legend input").uncheck();
    await expect(page.getByTestId("first-build")).toBeDisabled();
    await expect(dialog.getByRole("status")).toHaveText("Pick at least one area.");
    await dialog.getByRole("button", { name: "Cancel" }).last().click();
    await expect(dialog).toBeHidden();
  });

  test("the steps open where each is done", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await fromMenu(page, "getting-started-menu");
    const steps = page.getByTestId("getting-started");
    await expect(steps.locator("li")).toHaveCount(7);
    await steps.locator('button[data-go="arrange"]').click();
    await expect(steps).toBeHidden();
    await expect(page.getByTestId("edit-status")).toBeVisible();
  });

  test("offers no drawing from areas where Home Assistant has none", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await expect(page.getByTestId("plan-new")).toBeVisible();
    await expect(page.getByTestId("from-areas")).toHaveCount(0);
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true, lang: "fr" });
    await expect(page.getByTestId("from-areas")).toHaveText(
      "Le dessiner depuis les zones de Home Assistant",
    );
    await page.getByTestId("from-areas").click();
    await expect(page.getByTestId("first-build")).toHaveText("Dessiner mon logement");
  });
});
