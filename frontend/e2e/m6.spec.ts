import { expect, test, type Page } from "@playwright/test";

import { elementPoint, openHarness, settle, stage, viewState } from "./fixtures";

/** The plan editor's state, as the view reports it. */
async function planEdit(
  page: Page,
): Promise<NonNullable<Awaited<ReturnType<typeof viewState>>["planEdit"]>> {
  const state = (await viewState(page)).planEdit;
  if (!state) throw new Error("the plan editor is off");
  return state;
}

/** The last plan stored by the panel, and the overlay sent with it. */
function lastSave(page: Page): Promise<
  | {
      plan?: {
        rooms?: { id: string; name?: string }[];
        doors?: { id: string; name?: string; from: number[]; to: number[]; style?: string }[];
        partitions?: { id: string; from: number[]; to: number[] }[];
      };
      layout?: unknown;
    }
  | undefined
> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; plan?: unknown; layout?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/plan/save" && "plan" in call);
    return calls[calls.length - 1] as never;
  });
}

/** A point of the view in page coordinates, from a point in the stage's CSS pixels. */
async function onStage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await stage(page).boundingBox();
  if (!box) throw new Error("no stage");
  return { x: box.x + x, y: box.y + y };
}

/** Presses at `from` and moves by `dx`, `dy` in steps, then lets go. */
async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await page.mouse.up();
}

test.describe("plan editor", () => {
  test("a room is renamed and reshaped, a room drawn, a door placed and saved in the plan", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("plan-mode").click();
    const bar = page.locator("domotwin-plan-bar");
    await expect(bar.getByTestId("plan-status")).toBeVisible();
    await expect(bar.getByTestId("plan-tool-select")).toHaveAttribute("aria-pressed", "true");
    // The plan editor draws in 2D.
    await expect.poll(async () => (await viewState(page)).planView).toBe(true);
    await settle(page);
    expect((await viewState(page)).stats?.planView).toBe(true);
    await settle(page);
    // A tap on the sofa selects its room.
    const sofa = await elementPoint(page, "sofa");
    await page.mouse.click(sofa.x, sofa.y);
    await expect(bar.getByTestId("plan-name")).toHaveValue("Living room");
    expect((await planEdit(page)).corners).toBe(4);
    await bar.getByTestId("plan-name").fill("Lounge");
    await bar.getByTestId("plan-name").press("Enter");
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(true);
    // A corner added on a side, dragged out, then taken away again.
    const handles = page.locator("domotwin-view").getByTestId("plan-handles");
    await handles.locator('.insert[data-side="0"]').click();
    await expect.poll(async () => (await planEdit(page)).corners).toBe(5);
    const corner = await handles.locator("circle.corner.active").boundingBox();
    if (!corner) throw new Error("no corner grabbed");
    await dragBy(page, { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, 0, -30);
    await expect(bar.getByTestId("plan-remove-corner")).toBeVisible();
    await bar.getByTestId("plan-remove-corner").click();
    await expect.poll(async () => (await planEdit(page)).corners).toBe(4);
    // A room drawn beside the home, a door placed on its side.
    await bar.getByTestId("plan-tool-room").click();
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("no stage");
    const start = await onStage(page, box.width - 220, 90);
    await dragBy(page, start, 160, 120);
    await expect(bar.getByTestId("plan-name")).toHaveValue("Room");
    await bar.getByTestId("plan-name").fill("Studio");
    await bar.getByTestId("plan-name").press("Enter");
    await bar.getByTestId("plan-tool-door").click();
    await page.mouse.click(start.x + 80, start.y + 120);
    await expect(bar.getByTestId("plan-fields")).toContainText("Door");
    // A width out of range is refused; one within is kept.
    await bar.getByTestId("plan-width").fill("5");
    await bar.getByTestId("plan-width").press("Enter");
    await expect(bar.getByTestId("plan-width")).toHaveAttribute("aria-invalid", "true");
    await bar.getByTestId("plan-width").fill("90");
    await bar.getByTestId("plan-width").press("Enter");
    await expect(bar.getByTestId("plan-width")).toHaveAttribute("aria-invalid", "false");
    await bar.getByTestId("plan-style").selectOption("sliding");
    // Saved: the plan with the overlay in it, and an empty overlay.
    await page.getByTestId("plan-save").click();
    await expect(page.getByTestId("toast")).toContainText("Plan saved.");
    const saved = await lastSave(page);
    expect(saved?.layout).toEqual({});
    const rooms = saved?.plan?.rooms ?? [];
    expect(rooms.find((e) => e.id === "living")?.name).toBe("Lounge");
    expect(rooms.some((e) => e.name === "Studio")).toBe(true);
    const door = saved?.plan?.doors?.find((e) => e.name === "Door");
    expect(door?.style).toBe("sliding");
    const [fromX = 0, fromY = 0] = door?.from ?? [];
    const [toX = 0, toY = 0] = door?.to ?? [];
    expect(Math.hypot(toX - fromX, toY - fromY)).toBeCloseTo(90, 1);
    // The panel is back, and the view shows the plan saved.
    await expect(page.getByTestId("plan-mode")).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("6 rooms");
  });

  test("a partition is dragged as far as the pointer goes", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("plan-mode").click();
    await expect.poll(async () => (await viewState(page)).planView).toBe(true);
    await settle(page);
    // The living room's windows have their middles at x = 150 and 360 cm on its top wall: they
    // give the scale and the directions of the plan on screen.
    const a = await elementPoint(page, "win-living-1");
    const b = await elementPoint(page, "win-living-2");
    const right = { x: (b.x - a.x) / 210, y: (b.y - a.y) / 210 };
    const down = { x: -right.y, y: right.x };
    // A partition drawn across the living room, from 100 to 300 cm below its top wall.
    await page.locator("domotwin-plan-bar").getByTestId("plan-tool-wall").click();
    const start = { x: a.x + down.x * 100, y: a.y + down.y * 100 };
    await dragBy(page, start, down.x * 200, down.y * 200);
    const id = (await planEdit(page)).selection ?? "";
    expect(id).not.toBe("");
    // Held by its middle and moved 40 cm to the right, in eight moves.
    await page.locator("domotwin-plan-bar").getByTestId("plan-tool-select").click();
    await dragBy(page, await elementPoint(page, id), right.x * 40, right.y * 40);
    await page.getByTestId("plan-save").click();
    await expect(page.getByTestId("toast")).toContainText("Plan saved.");
    const saved = (await lastSave(page))?.plan?.partitions?.find((w) => w.id === id);
    const [fromX = 0] = saved?.from ?? [];
    const [toX = 0] = saved?.to ?? [];
    expect(fromX).toBeGreaterThan(180);
    expect(fromX).toBeLessThan(200);
    expect(toX).toBeCloseTo(fromX, 0);
  });

  test("a plan is drawn from nothing", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await page.getByTestId("plan-new").click();
    const bar = page.locator("domotwin-plan-bar");
    // A new plan starts with one room, the room tool ready, and is a change to save.
    await expect(bar.getByTestId("plan-tool-room")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("plan-save")).toBeEnabled();
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("no stage");
    // A tap drops a room of 3 × 3 m.
    await page.mouse.click(box.x + 60, box.y + 60);
    await expect(bar.getByTestId("plan-fields")).toContainText("Room");
    // A room too small is refused, and said each time.
    for (let i = 0; i < 2; i += 1) {
      await page.mouse.move(box.x + 40, box.y + box.height - 160);
      await page.mouse.down();
      await page.mouse.move(box.x + 52, box.y + box.height - 152, { steps: 4 });
      await page.mouse.up();
      await expect(page.getByTestId("toast")).toContainText("This change is not possible");
      await page.getByTestId("toast").getByRole("button").click();
      await expect(page.getByTestId("toast")).toHaveCount(0);
    }
    await page.getByTestId("plan-save").click();
    await expect(page.getByTestId("toast")).toContainText("Plan saved.");
    const saved = await lastSave(page);
    expect(saved?.plan?.rooms).toHaveLength(2);
    await expect(page.getByTestId("summary")).toContainText("2 rooms");
  });

  test("the keys undo and remove; a plan not saved is kept, and dropping it asks first", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", lang: "fr" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("plan-mode").click();
    // The editor opens (its module loads), then goes to 2D.
    await expect(page.locator("domotwin-plan-bar")).toBeVisible();
    await expect.poll(async () => (await viewState(page)).stats?.planView).toBe(true);
    await settle(page);
    const bar = page.locator("domotwin-plan-bar");
    const sofa = await elementPoint(page, "sofa");
    await page.mouse.click(sofa.x, sofa.y);
    await expect(bar.getByTestId("plan-name")).toHaveValue("Living room");
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await planEdit(page)).selection).toBeNull();
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(false);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(true);
    // The panel leaves the page and comes back: the plan being drawn is still there.
    await page.evaluate(() => {
      const element = (window as never as { __element: HTMLElement }).__element;
      const parent = element.parentNode;
      if (!parent) throw new Error("no parent");
      parent.removeChild(element);
      parent.appendChild(element);
    });
    await expect.poll(async () => (await viewState(page)).planEdit?.dirty).toBe(true);
    // With its history.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(false);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(true);
    // Kept by this browser once the drawing pauses, offered again after a reload.
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("plan-mode").click();
    await expect(page.getByTestId("plan-draft")).toContainText("gardé sur cet appareil");
    await page.getByTestId("plan-restore").click();
    await expect.poll(async () => (await planEdit(page)).dirty).toBe(true);
    // Cancel asks before dropping the changes.
    await page.getByTestId("plan-cancel").click();
    await expect(page.getByTestId("plan-discard")).toBeVisible();
    await page.getByTestId("plan-discard-confirm").click();
    await expect(page.getByTestId("plan-mode")).toBeVisible();
    expect((await viewState(page)).planEdit).toBeUndefined();
    await expect(page.getByTestId("summary")).toContainText("5 pièces");
  });
});
