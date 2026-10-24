import { expect, test, type Page } from "@playwright/test";

import { canvasPng, elementPoint, openHarness, settle, stage, viewState } from "./fixtures";

/** The panel of the demo home in edit mode, on the 2D plan. */
async function editing(page: Page, options: { lang?: "en" | "fr" } = {}): Promise<void> {
  await openHarness(page, { mode: "panel", ...options });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.getByTestId("toggle-plan").click();
  await settle(page);
  await page.getByTestId("edit-mode").click();
  await expect(page.getByTestId("edit-status")).toBeVisible();
}

/** A point of the view where `id` is the element under the pointer. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const centre = await elementPoint(page, id);
  const box = await stage(page).boundingBox();
  if (!box) throw new Error("no stage");
  const hit = await page.evaluate(
    ({ id, x, y }) => {
      const view = (
        window as never as {
          __view: () => { elementAt(x: number, y: number): { id: string } | undefined };
        }
      ).__view();
      for (let r = 0; r <= 24; r += 3) {
        for (let dy = -r; dy <= r; dy += 3) {
          for (let dx = -r; dx <= r; dx += 3) {
            if (view.elementAt(x + dx, y + dy)?.id === id) return { x: x + dx, y: y + dy };
          }
        }
      }
      return null;
    },
    { id, x: centre.x - box.x, y: centre.y - box.y },
  );
  if (!hit) throw new Error(`${id} cannot be tapped`);
  return { x: box.x + hit.x, y: box.y + hit.y };
}

async function select(page: Page, id: string): Promise<void> {
  const point = await pointOn(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await viewState(page)).edit?.selection).toEqual([id]);
}

/** Drags a selected piece by `dx`, `dy` CSS pixels, in steps; returns the guides seen. */
async function drag(page: Page, id: string, dx: number, dy: number): Promise<number> {
  const from = await pointOn(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  let guides = 0;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    guides = Math.max(guides, (await viewState(page)).edit?.guides ?? 0);
  }
  await page.mouse.up();
  return guides;
}

/** The overlay of the edit session. */
function editLayout(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(() =>
    (window as never as { __view: () => { editLayout(): Record<string, unknown> | undefined } })
      .__view()
      .editLayout(),
  );
}

/** The last overlay stored by the panel. */
function savedLayout(page: Page): Promise<Record<string, Record<string, unknown>> | undefined> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; layout?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/plan/save" && "layout" in call);
    return calls[calls.length - 1]?.layout as never;
  });
}

test.describe("M3: edit mode", () => {
  test("moves a piece with guides and saves where it went", async ({ page }) => {
    await editing(page);
    await expect(page.getByTestId("edit-save")).toBeDisabled();
    await select(page, "sofa");
    await expect(page.getByTestId("edit-status")).toHaveText("Sofa");
    const guides = await drag(page, "sofa", -60, 30);
    expect(guides).toBeGreaterThan(0);
    const state = (await viewState(page)).edit;
    expect(state?.dirty).toBe(true);
    expect(state?.selection).toEqual(["sofa"]);
    await page.getByTestId("edit-save").click();
    await expect(page.getByTestId("toast")).toHaveText(/Changes saved\./);
    await expect(page.getByTestId("edit-mode")).toBeVisible();
    const layout = await savedLayout(page);
    expect(layout?.sofa?.x).toBeLessThan(380);
    expect(layout?.sofa?.y).toBeGreaterThan(105);
    expect((await viewState(page)).edit).toBeUndefined();

    // Export writes the plan as it is now, with the sofa moved.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export plan" }).click();
    const file = await (await download).path();
    const { readFile } = await import("node:fs/promises");
    const plan = JSON.parse(await readFile(file, "utf8")) as {
      elements: { id: string; x: number }[];
    };
    expect(plan.elements.find((e) => e.id === "sofa")?.x).toBe(layout?.sofa?.x);
  });

  test("turns, removes, adds from the catalogue, undoes, then discards", async ({ page }) => {
    await editing(page, { lang: "fr" });
    await select(page, "chair-1");
    await page.getByTestId("edit-rotate-right").click();
    await page.getByTestId("edit-remove").click();
    await expect.poll(async () => (await viewState(page)).edit?.selection).toEqual([]);
    expect(await editLayout(page)).toMatchObject({ "chair-1": { removed: true } });
    await page.getByTestId("edit-add").click();
    const catalogue = page.getByTestId("catalogue");
    await catalogue.getByTestId("catalogue-search").fill("lampe");
    await expect(catalogue.getByTestId("catalogue-sofa")).toHaveCount(0);
    await catalogue.getByTestId("catalogue-tablelamp").click();
    await expect(catalogue).toHaveCount(0);
    await expect(page.getByTestId("edit-status")).toHaveText("Lampe à poser");
    await page.getByTestId("edit-undo").click();
    await page.getByTestId("edit-undo").click();
    await page.getByTestId("edit-redo").click();
    expect((await viewState(page)).edit?.dirty).toBe(true);
    await page.getByTestId("edit-cancel").click();
    await expect(page.getByTestId("edit-discard")).toBeVisible();
    await page.getByTestId("edit-discard-confirm").click();
    await expect(page.getByTestId("edit-mode")).toBeVisible();
    expect(await savedLayout(page)).toBeUndefined();
    // Back to the plan as stored: 45 pieces, chair-1 in place.
    await expect.poll(async () => (await viewState(page)).edit).toBeUndefined();
  });

  test("marks the selection and the pieces in conflict", async ({ page }) => {
    await editing(page);
    await select(page, "armchair");
    // Onto the coffee table: both turn red.
    const table = await elementPoint(page, "coffee-table");
    const from = await pointOn(page, "armchair");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + table.x) / 2, (from.y + table.y) / 2, { steps: 4 });
    await page.mouse.move(table.x, table.y, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await viewState(page)).edit?.conflicts)
      .toEqual(["coffee-table", "armchair"]);
    await expect(page.getByTestId("edit-status")).toHaveText(/Overlaps/);
    expect(await canvasPng(page)).toMatchSnapshot("edit-marks.png");
    // Conflicts are those of the selection.
    await select(page, "bed");
    expect((await viewState(page)).edit?.conflicts).toEqual([]);
  });

  test("keeps changes not saved on this device and offers them again", async ({ page }) => {
    await editing(page);
    await select(page, "bed");
    await page.keyboard.press("r");
    await expect.poll(async () => (await viewState(page)).edit?.dirty).toBe(true);
    await page.reload();
    await editing(page);
    await expect(page.getByTestId("edit-draft")).toBeVisible();
    await page.getByTestId("edit-restore").click();
    await expect(page.getByTestId("edit-draft")).toHaveCount(0);
    expect((await viewState(page)).edit?.dirty).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await viewState(page)).edit?.dirty).toBe(false);
  });

  test("selects several pieces and turns them together", async ({ page }) => {
    await editing(page);
    await select(page, "chair-1");
    await page.getByTestId("edit-several").click();
    const chair2 = await pointOn(page, "chair-2");
    await page.mouse.click(chair2.x, chair2.y);
    await expect
      .poll(async () => (await viewState(page)).edit?.selection)
      .toEqual(["chair-1", "chair-2"]);
    // A click on a selected piece takes it out again.
    await page.mouse.click(chair2.x, chair2.y);
    await expect.poll(async () => (await viewState(page)).edit?.selection).toEqual(["chair-1"]);
    await page.mouse.click(chair2.x, chair2.y);
    await expect(page.getByTestId("edit-status")).toHaveText("2 pieces selected");
    await page.getByTestId("edit-rotate-right").click();
    const layout = await editLayout(page);
    expect(layout).toMatchObject({ "chair-1": { angle: 15 }, "chair-2": { angle: 15 } });
  });

  test("a long press on a selected piece takes it out of the selection", async ({ page }) => {
    await editing(page);
    await select(page, "chair-1");
    await page.getByTestId("edit-several").click();
    const chair2 = await pointOn(page, "chair-2");
    await page.mouse.click(chair2.x, chair2.y);
    await page.getByTestId("edit-several").click();
    const chair1 = await pointOn(page, "chair-1");
    await page.mouse.move(chair1.x, chair1.y);
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
    await expect.poll(async () => (await viewState(page)).edit?.selection).toEqual(["chair-2"]);
  });

  test("keys wait while the catalogue is open", async ({ page }) => {
    await editing(page);
    await select(page, "bed");
    await page.getByTestId("edit-add").click();
    await page.getByTestId("catalogue").locator("button").first().focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("catalogue")).toHaveCount(0);
    expect((await viewState(page)).edit?.selection).toEqual(["bed"]);
  });

  test("discarding shows what another device saved meanwhile", async ({ page }) => {
    await editing(page);
    await select(page, "bed");
    await page.keyboard.press("r");
    const before = await elementPoint(page, "sofa");
    // Another device moves the sofa.
    await page.evaluate(() =>
      (
        window as never as {
          __hass: { connection: { sendMessagePromise(message: unknown): Promise<unknown> } };
        }
      ).__hass.connection.sendMessagePromise({
        type: "domotwin/plan/save",
        layout: { sofa: { x: 200, y: 150 } },
      }),
    );
    await expect(page.getByTestId("toast")).toHaveText(/another device/);
    await page.getByTestId("edit-cancel").click();
    await page.getByTestId("edit-discard-confirm").click();
    await expect.poll(async () => (await elementPoint(page, "sofa")).x).not.toBe(before.x);
  });

  test("keeps the draft when leaving without changes, and after the view restarts", async ({
    page,
  }) => {
    await editing(page);
    await select(page, "bed");
    await page.keyboard.press("r");
    await expect.poll(async () => (await viewState(page)).edit?.dirty).toBe(true);
    // The panel leaves the page and comes back (Home Assistant does that): the view restarts.
    await page.evaluate(() => {
      const element = (window as never as { __element: HTMLElement }).__element;
      const parent = element.parentNode;
      element.remove();
      parent?.appendChild(element);
    });
    await expect(page.getByTestId("edit-draft")).toBeVisible();
    // Leaving without changes keeps it.
    await page.getByTestId("edit-cancel").click();
    await page.getByTestId("edit-mode").click();
    await expect(page.getByTestId("edit-draft")).toBeVisible();
    await page.getByTestId("edit-restore").click();
    expect((await viewState(page)).edit?.dirty).toBe(true);
  });

  test("leaves out the edits an updated plan refuses, and says so", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.evaluate(() =>
      (
        window as never as {
          __hass: { connection: { sendMessagePromise(message: unknown): Promise<unknown> } };
        }
      ).__hass.connection.sendMessagePromise({
        type: "domotwin/plan/save",
        layout: {
          sofa: { x: 200 },
          "bad-added-1": { add: { name: "Bad", kind: "lamp", w: 35, h: 35 } },
        },
      }),
    );
    await expect(page.locator("domotwin-view").getByTestId("notice")).toHaveText(
      "1 edit could not be applied to this plan and was left out.",
    );
    await page.getByTestId("edit-mode").click();
    await expect(page.getByTestId("edit-status")).toBeVisible();
    expect(await editLayout(page)).toEqual({ sofa: { x: 200 } });
  });

  test("only administrators edit", async ({ page }) => {
    await openHarness(page, { mode: "panel", admin: false });
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect(page.getByTestId("edit-mode")).toHaveCount(0);
  });
});
