import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { canvasPng, fromMenu, openHarness, viewState } from "./fixtures";

test.describe("card", () => {
  test("loads the engine and the demo plan", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toContainText("Demo apartment · 5 rooms · 39 pieces");
    const state = await viewState(page);
    expect(state.engine).toBe("ready");
    expect(state.frames).toBeGreaterThan(0);
    // SwiftShader is software rendering: the automatic quality is Eco.
    expect(state.quality).toBe("eco");
    const hasWebGl2 = await page.evaluate(() => {
      const view = (window as never as { __view: () => HTMLElement }).__view();
      const canvas = view.shadowRoot?.querySelector("canvas");
      return canvas?.getContext("webgl2") instanceof WebGL2RenderingContext;
    });
    expect(hasWebGl2).toBe(true);
  });

  test("renders on demand: no frames while idle", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    const before = (await viewState(page)).frames;
    await page.waitForTimeout(500);
    expect((await viewState(page)).frames).toBe(before);
  });

  test("explains how to get a plan", async ({ page }) => {
    await openHarness(page, { plan: "none", admin: false });
    await expect(page.getByRole("heading", { name: "No plan yet" })).toBeVisible();
    await expect(page.getByText("An administrator can import the plan")).toBeVisible();
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { lang: "fr" });
    await expect(page.getByTestId("summary")).toContainText(
      "Demo apartment · 5 pièces · 39 meubles",
    );
  });

  test("releases the engine when removed from the page", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    const lost = await page.evaluate(() => {
      const view = (window as never as { __view: () => HTMLElement }).__view();
      const canvas = view.shadowRoot?.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      (window as never as { __element: HTMLElement }).__element.remove();
      return { lost: gl?.isContextLost(), canvasLeft: view.shadowRoot?.querySelector("canvas") };
    });
    expect(lost).toEqual({ lost: true, canvasLeft: null });
  });

  test("canvas snapshot (software WebGL)", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(await canvasPng(page)).toMatchSnapshot("card-canvas.png", { maxDiffPixelRatio: 0.01 });
  });
});

test.describe("panel", () => {
  test("imports a plan file and shows it", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none" });
    await expect(page.getByRole("heading", { name: "No plan yet" })).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    await (await chooser).setFiles("../examples/demo-apartment.domotwin.json");
    await expect(page.getByText("Plan imported: Demo apartment.")).toBeVisible();
    await expect(page.getByTestId("summary")).toContainText("5 rooms");
    const saves = await page.evaluate(() =>
      (window as never as { __calls: { type: string }[] }).__calls.filter(
        (call) => call.type === "domotwin/plan/save",
      ),
    );
    expect(saves).toHaveLength(1);
  });

  test("refuses a file that is not a plan, with a translated reason", async ({ page }) => {
    await openHarness(page, { mode: "panel", plan: "none", lang: "fr" });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Importer un plan" }).first().click();
    await (
      await chooser
    ).setFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"elements":[{}]}'),
    });
    await expect(page.getByRole("alert")).toContainText("ce n’est pas un plan DomoTwin");
  });

  test("exports the stored plan", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    const download = page.waitForEvent("download");
    await fromMenu(page, "export");
    const file = await download;
    expect(file.suggestedFilename()).toBe("demo-apartment.domotwin.json");
    const exported = JSON.parse(await readFile(await file.path(), "utf8")) as {
      format: string;
      name: string;
    };
    expect(exported.format).toBe("domotwin-plan");
    expect(exported.name).toBe("Demo apartment");
  });

  test("hides the import from non-administrators", async ({ page }) => {
    await openHarness(page, { mode: "panel", admin: false });
    await expect(page.getByRole("button", { name: "Export plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import plan" })).toHaveCount(0);
  });
});
