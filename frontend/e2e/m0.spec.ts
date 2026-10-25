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

  test("starts when moved while its engine loads, as dashboards move cards", async ({ page }) => {
    // The engine's WebAssembly waits until the card has moved.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/domotwin_web_bg*.wasm", async (route) => {
      await held;
      await route.continue();
    });
    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    await openHarness(page);
    await expect.poll(async () => (await viewState(page)).engine).toBe("loading");
    await page.evaluate(() => {
      const scope = window as never as {
        __element: HTMLElement;
        __view: () => HTMLElement;
        __firstCanvas?: HTMLCanvasElement | null;
      };
      scope.__firstCanvas = scope.__view().shadowRoot?.querySelector("canvas");
      const parent = scope.__element.parentElement;
      scope.__element.remove();
      parent?.append(scope.__element);
    });
    release();
    await expect(page.getByTestId("summary")).toContainText("Demo apartment");
    expect((await viewState(page)).engine).toBe("ready");
    const canvases = await page.evaluate(() => {
      const scope = window as never as {
        __view: () => HTMLElement;
        __firstCanvas: HTMLCanvasElement;
      };
      return {
        shown: scope.__view().shadowRoot?.querySelectorAll("canvas").length,
        // A canvas with a WebGL context has no 2D one: the first was never given a context.
        firstUntouched: scope.__firstCanvas.getContext("2d") !== null,
      };
    });
    expect(canvases).toEqual({ shown: 1, firstUntouched: true });
    expect(logged.filter((text) => text.includes("panicked"))).toEqual([]);
  });

  test("starts again on a fresh canvas when its context is lost", async ({ page }) => {
    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    const lose = () =>
      page.evaluate(() => {
        const scope = window as never as {
          __view: () => HTMLElement;
          __lostCanvas?: HTMLCanvasElement;
        };
        const canvas = scope.__view().shadowRoot?.querySelector("canvas");
        if (!canvas) throw new Error("no canvas");
        scope.__lostCanvas = canvas;
        canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
      });
    await lose();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scope = window as never as {
            __view: () => HTMLElement;
            __lostCanvas: HTMLCanvasElement;
          };
          const canvas = scope.__view().shadowRoot?.querySelector("canvas");
          return canvas !== null && canvas !== scope.__lostCanvas;
        }),
      )
      .toBe(true);
    await expect.poll(async () => (await viewState(page)).engine).toBe("ready");
    await expect(page.getByTestId("summary")).toContainText("Demo apartment");
    await expect.poll(async () => (await viewState(page)).frames).toBeGreaterThan(0);
    // Lost again within a minute: the GPU keeps failing, and the view says so.
    await lose();
    await expect(page.getByText("DomoTwin could not start.")).toBeVisible();
    expect(logged.filter((text) => text.includes("panicked"))).toEqual([]);
  });

  test("canvas snapshot (software WebGL)", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(await canvasPng(page)).toMatchSnapshot("card-canvas.png", { maxDiffPixelRatio: 0.01 });
  });
});

test.describe("panel", () => {
  test("is as high as the window, less the safe areas, as in Home Assistant", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    const size = () =>
      page.evaluate(() => ({
        panel: Math.round(
          (window as never as { __element: HTMLElement }).__element.getBoundingClientRect().height,
        ),
        page: document.documentElement.scrollHeight,
        window: window.innerHeight,
      }));
    const plain = await size();
    expect(plain.panel).toBe(plain.window);
    expect(plain.page).toBe(plain.window);
    // A phone's notch and home bar, which Home Assistant pads.
    await page.evaluate(() => {
      document.body.style.setProperty("--safe-area-inset-top", "20px");
      document.body.style.setProperty("--safe-area-inset-bottom", "30px");
    });
    const phone = await size();
    expect(phone.panel).toBe(phone.window - 50);
    expect(phone.page).toBe(phone.window);
  });

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
