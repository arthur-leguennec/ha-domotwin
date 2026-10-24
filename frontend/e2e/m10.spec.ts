import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle, stage, viewState } from "./fixtures";

/** The scene's figures that walking and the kiosk change. */
interface Figures {
  walking: boolean;
  storeys: number;
  planView: boolean;
  camera: { target: [number, number, number]; yaw: number; pitch: number };
}

async function figures(page: Page): Promise<Figures> {
  return (await viewState(page)).stats as unknown as Figures;
}

/** How far the camera's target moved on the floor between two readings (cm). */
function moved(a: Figures, b: Figures): number {
  return Math.hypot(
    a.camera.target[0] - b.camera.target[0],
    a.camera.target[2] - b.camera.target[2],
  );
}

async function show(page: Page, request: Record<string, string>): Promise<void> {
  await page.evaluate((r) => {
    (window as never as { __show: (r: unknown) => void }).__show(r);
  }, request);
}

test.describe("walking and the kiosk", () => {
  test("walks through the home at eye level: the pad, the keys, a tap on the floor, and out", async ({
    page,
  }) => {
    await openHarness(page, { live: true });
    const view = page.locator("domotwin-view");
    await view.getByTestId("walk").click();
    await expect.poll(async () => (await figures(page)).walking).toBe(true);
    await settle(page);
    await expect(view.getByTestId("walk-hint")).toBeVisible();
    // Eye level, looking a little down; no cones at eye level.
    const start = await figures(page);
    expect(start.camera.target[1]).toBeGreaterThan(100);
    await expect(view.getByTestId("cameras")).toHaveCount(0);
    // The pad, held: ahead.
    const ahead = view.getByTestId("walk-ahead");
    const box = await ahead.boundingBox();
    if (!box) throw new Error("no pad");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await settle(page);
    const stepped = await figures(page);
    expect(moved(start, stepped)).toBeGreaterThan(5);
    // The keys: back.
    await stage(page).focus();
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowDown");
    await settle(page);
    expect(moved(stepped, await figures(page))).toBeGreaterThan(5);
    // → turns to the right: the yaw goes down (ahead is (−sin yaw, −cos yaw)).
    const facing = (await figures(page)).camera.yaw;
    await page.keyboard.press("ArrowRight");
    await settle(page);
    const turned = (await figures(page)).camera.yaw;
    expect(((turned - facing + 3 * Math.PI) % (2 * Math.PI)) - Math.PI).toBeLessThan(-0.01);
    // A tap on the floor ahead: the walker goes there.
    const before = await figures(page);
    const area = await stage(page).boundingBox();
    if (!area) throw new Error("no stage");
    await page.mouse.click(area.x + area.width * 0.45, area.y + area.height * 0.85);
    await settle(page);
    expect(moved(before, await figures(page))).toBeGreaterThan(5);
    // Escape: back to the camera before.
    await stage(page).focus();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await figures(page)).walking).toBe(false);
    await expect(view.getByTestId("walk-pad")).toHaveCount(0);
  });

  test("an idle kiosk goes back to its view, turns slowly and dims at night; a touch wakes it", async ({
    page,
  }) => {
    await openHarness(page, {
      live: true,
      idle: 2,
      orbit: true,
      nightDim: true,
      sun: { elevation: -12, rising: false },
    });
    await settle(page);
    const opened = await figures(page);
    // Turned away, then left alone.
    const area = await stage(page).boundingBox();
    if (!area) throw new Error("no stage");
    await page.mouse.move(area.x + 200, area.y + 200);
    await page.mouse.down();
    await page.mouse.move(area.x + 400, area.y + 240, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    expect(Math.abs((await figures(page)).camera.yaw - opened.camera.yaw)).toBeGreaterThan(0.3);
    // Back to the overview, dimmed (night): the dark stops the turn.
    const view = page.locator("domotwin-view");
    await expect(view.getByTestId("dim")).toBeVisible({ timeout: 8000 });
    await settle(page);
    expect(Math.abs((await figures(page)).camera.yaw - opened.camera.yaw)).toBeLessThan(0.05);
    // A touch wakes it up, and does nothing else: what it was on could not be seen; the next
    // one is a touch (checked at once: a software GPU can be slower than the kiosk's wait).
    const woken = await page.evaluate(async () => {
      const v = (
        window as never as {
          __view: () => HTMLElement & { renderRoot: ShadowRoot; updateComplete: Promise<boolean> };
        }
      ).__view();
      const stage = v.renderRoot.querySelector(".stage");
      let reached = 0;
      stage?.addEventListener("pointerdown", () => {
        reached += 1;
      });
      const touch = (): void => {
        stage?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      };
      touch();
      await v.updateComplete;
      const awake = v.renderRoot.querySelector('[data-testid="dim"]') === null;
      const first = reached;
      touch();
      return { awake, first, second: reached };
    });
    expect(woken).toEqual({ awake: true, first: 0, second: 1 });
  });

  test("domotwin.show: the room asked for, upstairs, walking there; another screen's request is not this one's", async ({
    page,
  }) => {
    await openHarness(page, { storeys: 2, live: true, screen: "hallway" });
    await expect.poll(async () => (await figures(page)).storeys).toBe(1);
    const summary = page.locator("domotwin-view").getByTestId("summary");
    await expect(summary).toContainText("Demo apartment");
    // For another screen: nothing.
    await show(page, { room: "Office", screen: "kitchen" });
    await page.waitForTimeout(300);
    await expect(summary).not.toContainText("upper floor");
    // For this one: the office, upstairs, walking there.
    await show(page, { room: "office", view: "walk", screen: "hallway" });
    await expect(summary).toContainText("upper floor");
    await expect.poll(async () => (await figures(page)).walking).toBe(true);
    // Every storey at once.
    await show(page, { storey: "all" });
    await expect.poll(async () => (await figures(page)).storeys).toBe(2);
    // The 2D plan.
    await show(page, { view: "2d" });
    await expect.poll(async () => (await figures(page)).planView).toBe(true);
  });
});
