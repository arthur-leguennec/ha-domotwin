import { expect, test, type Page } from "@playwright/test";

import { canvasPng, openHarness, settle, stage, viewState } from "./fixtures";

async function camera(page: Page): Promise<{
  target: number[];
  distance: number;
  yaw: number;
  pitch: number;
  ortho: number;
}> {
  const state = await viewState(page);
  if (!state.stats) throw new Error("no scene");
  return state.stats.camera;
}

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("summary")).toBeVisible();
  await settle(page);
}

test.describe("3D view", () => {
  test("draws the whole demo home", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const state = await viewState(page);
    expect(state.stats?.triangles).toBeGreaterThan(5_000);
    expect(state.stats?.groups).toBeGreaterThan(3);
    expect(state.planView).toBe(false);
  });

  test("switches to the 2D plan and back", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const before = await camera(page);
    await page.getByRole("button", { name: "2D plan" }).click();
    await settle(page);
    const plan = await camera(page);
    expect(plan.ortho).toBe(1);
    expect(plan.pitch).toBeCloseTo(Math.PI / 2, 2);
    expect((await viewState(page)).planView).toBe(true);
    expect(await canvasPng(page)).toMatchSnapshot("plan-canvas.png", { maxDiffPixelRatio: 0.01 });
    await page.getByRole("button", { name: "3D view" }).click();
    await settle(page);
    const back = await camera(page);
    expect(back.ortho).toBe(0);
    expect(back.yaw).toBeCloseTo(before.yaw, 2);
  });

  test("starts on the plan when the card asks for it", async ({ page }) => {
    await openHarness(page, { view: "2d" });
    await ready(page);
    expect((await camera(page)).ortho).toBe(1);
    await expect(page.getByRole("button", { name: "3D view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("turns with a drag and zooms with the wheel", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("no stage");
    const start = await camera(page);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 80, centre.y, { steps: 5 });
    await page.mouse.up();
    const turned = await camera(page);
    expect(turned.yaw).not.toBeCloseTo(start.yaw, 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await camera(page)).distance).toBeLessThan(turned.distance);
  });

  test("tapping a room frames it, a double click shows the whole home", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const overview = await camera(page);
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("no stage");
    // Find a room under the pointer, around the middle of the view.
    const hit = await page.evaluate(
      ({ width, height }) => {
        const view = (
          window as never as {
            __view: () => { elementAt(x: number, y: number): { type: string } | undefined };
          }
        ).__view();
        for (let y = height * 0.3; y < height * 0.7; y += 12) {
          for (let x = width * 0.3; x < width * 0.7; x += 12) {
            if (view.elementAt(x, y)?.type === "room") return { x, y };
          }
        }
        return null;
      },
      { width: box.width, height: box.height },
    );
    expect(hit).not.toBeNull();
    if (!hit) return;
    await page.mouse.click(box.x + hit.x, box.y + hit.y);
    await settle(page);
    const focused = await camera(page);
    expect(focused.distance).toBeLessThan(overview.distance);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page);
    expect((await camera(page)).distance).toBeCloseTo(overview.distance, 0);
  });

  test("moves with the keyboard", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const start = await camera(page);
    await stage(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect((await camera(page)).yaw).not.toBeCloseTo(start.yaw, 2);
    await page.keyboard.press("+");
    expect((await camera(page)).distance).toBeLessThan(start.distance);
    await page.keyboard.press("Home");
    await settle(page);
    expect((await camera(page)).distance).toBeCloseTo(start.distance, 0);
  });

  test("goes to a saved viewpoint", async ({ page }) => {
    await openHarness(page);
    await ready(page);
    const start = await camera(page);
    await page.getByRole("button", { name: "Saved views" }).click();
    const items = page.getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    await items.first().click();
    await settle(page);
    const moved = await camera(page);
    expect(moved.target).not.toEqual(start.target);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("names the element at fault when a plan is refused", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    const plan = {
      version: 1,
      unit: "cm",
      layoutRevision: 10,
      elements: [
        { id: "hall", type: "room", name: "Hall", x: 0, y: 0, w: 200, h: 200 },
        { id: "hall", type: "room", name: "Hall", x: 200, y: 0, w: 200, h: 200 },
      ],
    };
    await (
      await chooser
    ).setFiles({
      name: "twice.plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await expect(page.getByRole("alert")).toContainText("two elements have the same id");
    await expect(page.getByRole("alert")).toContainText("“hall”");
  });

  test("follows the time of day, or a fixed mood", async ({ page }) => {
    const brightness = async (): Promise<number> => {
      const png = await canvasPng(page);
      return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const g = canvas.getContext("2d");
        if (!g) return 0;
        g.drawImage(image, 0, 0);
        const { data } = g.getImageData(0, 0, image.width, image.height);
        let sum = 0;
        let count = 0;
        // Only the home: skip the background (the brightest pixels at the edges).
        for (let i = 0; i < data.length; i += 4 * 7) {
          const l =
            0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
          if (l < 250) {
            sum += l;
            count += 1;
          }
        }
        return count ? sum / count : 0;
      }, png.toString("base64"));
    };
    await openHarness(page, { lighting: "auto", sun: { elevation: 40, rising: false } });
    await ready(page);
    expect((await viewState(page)).light).toBe("sun:40:false");
    const day = await brightness();
    await openHarness(page, { lighting: "auto", sun: { elevation: -20, rising: false } });
    await ready(page);
    const night = await brightness();
    expect(night).toBeLessThan(day - 20);
    await openHarness(page, { lighting: "evening" });
    await ready(page);
    expect((await viewState(page)).light).toBe("mood:evening");
  });
});
