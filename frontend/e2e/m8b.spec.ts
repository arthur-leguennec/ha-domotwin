import { expect, test, type Page } from "@playwright/test";

import { canvasPng, openHarness, settle, viewState } from "./fixtures";

/** Reads a fresh frame: the colour near its top left (the sky) and its share of inked pixels. */
async function frame(page: Page): Promise<{ sky: [number, number, number]; ink: number }> {
  await settle(page);
  return page.evaluate(async () => {
    const view = (window as never as { __view: () => { captureFrame(): string } }).__view();
    const image = new Image();
    image.src = view.captureFrame();
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma =
        0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      if (luma < 45) inked += 1;
    }
    const corner = 4 * (4 * image.width + 4);
    return {
      sky: [data[corner] ?? 0, data[corner + 1] ?? 0, data[corner + 2] ?? 0] as [
        number,
        number,
        number,
      ],
      ink: inked / (data.length / 4),
    };
  });
}

async function setQuality(page: Page, quality: "eco" | "balanced" | "high"): Promise<void> {
  await page.evaluate((value) => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: value };
  }, quality);
  await expect.poll(async () => (await viewState(page)).quality).toBe(quality);
}

test.describe("the cartoon and the clay (D-036)", () => {
  test("the cartoon: a blue sky, inked outlines where the GPU can afford them", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, { theme: "cartoon", live: true });
    await expect.poll(async () => (await viewState(page)).look).toBe("cartoon #00d4ff");
    expect(await page.locator("domotwin-view").getAttribute("look")).toBe("cartoon");
    const stats = (await viewState(page)).stats as unknown as { theme: string; lines: number };
    expect(stats.theme).toBe("cartoon");
    expect(stats.lines).toBeGreaterThan(100);
    await setQuality(page, "eco");
    const eco = await frame(page);
    const [r, g, b] = eco.sky;
    expect(b).toBeGreaterThan(r + 40);
    expect(b).toBeGreaterThan(g);
    // Balanced and High draw offscreen with the ink: more of the picture inked, the same sky.
    await setQuality(page, "balanced");
    const balanced = await frame(page);
    expect(balanced.ink).toBeGreaterThan(eco.ink * 1.3);
    await setQuality(page, "high");
    const high = await frame(page);
    expect(high.ink).toBeGreaterThan(eco.ink * 1.3);
    const [hr, hg, hb] = high.sky;
    expect(Math.abs(hr - r) + Math.abs(hg - g) + Math.abs(hb - b)).toBeLessThan(12);
    // Its labels are inked too.
    const border = await page
      .locator("domotwin-view")
      .getByTestId("room-names")
      .locator('[data-room="living"]')
      .evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(border).toBe("rgb(27, 29, 41)");
    expect(await canvasPng(page)).toMatchSnapshot("cartoon-high.png", { maxDiffPixelRatio: 0.01 });
  });

  test("the cartoon and the clay follow the time of day", async ({ page }) => {
    const skyOf = async (
      theme: "cartoon" | "clay",
      lighting: "day" | "night",
    ): Promise<[number, number, number]> => {
      await openHarness(page, { theme, lighting });
      await expect.poll(async () => (await viewState(page)).look).toBe(`${theme} #00d4ff`);
      return (await frame(page)).sky;
    };
    const day = await skyOf("cartoon", "day");
    const night = await skyOf("cartoon", "night");
    expect(night[0] + night[1] + night[2]).toBeLessThan((day[0] + day[1] + day[2]) * 0.75);
    const clay = await skyOf("clay", "day");
    // A warm light grey.
    expect(clay[0] + clay[1] + clay[2]).toBeGreaterThan(600);
    expect(clay[0]).toBeGreaterThanOrEqual(clay[2]);
    const dark = await skyOf("clay", "night");
    expect(dark[0] + dark[1] + dark[2]).toBeLessThan((clay[0] + clay[1] + clay[2]) * 0.75);
  });

  test("the clay: one matte colour, no ink", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, { theme: "clay", live: true });
    await expect.poll(async () => (await viewState(page)).look).toBe("clay #00d4ff");
    await setQuality(page, "high");
    expect((await frame(page)).ink).toBeLessThan(0.01);
    expect(await canvasPng(page)).toMatchSnapshot("clay-high.png", { maxDiffPixelRatio: 0.01 });
  });

  test("the panel's settings offer them", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByTestId("settings-dialog");
    const select = dialog.getByTestId("settings-theme");
    await expect(select.locator("option")).toHaveText([
      "Automatic (neon in dark mode)",
      "Day",
      "Neon",
      "Blueprint",
      "Cartoon",
      "Clay model",
    ]);
    await select.selectOption("clay");
    await expect.poll(async () => (await viewState(page)).look).toBe("clay #00d4ff");
    await select.selectOption("cartoon");
    await dialog.getByTestId("settings-save").click();
    await expect(page.getByTestId("toast")).toContainText("Settings saved.");
    await expect.poll(async () => (await viewState(page)).look).toBe("cartoon #00d4ff");
    const stored = await page.evaluate(
      () => (window as never as { __store: { settings: unknown } }).__store.settings,
    );
    expect(stored).toEqual({ north: 0, theme: "cartoon" });
  });
});
