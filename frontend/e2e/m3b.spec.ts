import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { colorAt, openHarness, settle, viewState } from "./fixtures";

const MODELS = "../examples/models";

/** The panel of the demo home in edit mode, on the 2D plan. */
async function editing(page: Page, models: boolean | "unused" = false): Promise<void> {
  await openHarness(page, { mode: "panel", models });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.getByTestId("toggle-plan").click();
  await settle(page);
  await page.getByTestId("edit-mode").click();
  await expect(page.getByTestId("edit-status")).toBeVisible();
}

/** Opens the catalogue and picks a 3D file to import. */
async function importModel(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.getByTestId("edit-add").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("catalogue-import-model").click();
  await (await chooser).setFiles(file);
}

interface Call {
  type: string;
  method?: string;
  path?: string;
  layout?: Record<string, Record<string, unknown>>;
}

function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (window as never as { __calls: Call[] }).__calls);
}

/** The last overlay stored by the panel. */
async function savedLayout(
  page: Page,
): Promise<Record<string, Record<string, unknown>> | undefined> {
  const saves = (await calls(page)).filter((c) => c.type === "domotwin/plan/save" && c.layout);
  return saves[saves.length - 1]?.layout;
}

/** Whether the colour at a piece is the wood of the stool's seat (not a pale box). */
function brownish([r, , b]: [number, number, number]): boolean {
  return r - b > 40;
}

test.describe("M3b: your own 3D models", () => {
  test("draws pieces from their 3D file, read by a module loaded only then", async ({ page }) => {
    const wasm: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".wasm")) wasm.push(request.url());
    });
    // Not an administrator: reading the files needs only a signed-in user.
    await openHarness(page, { models: true, view: "2d", admin: false });
    await expect(page.getByTestId("summary")).toBeVisible();
    await settle(page);
    await expect.poll(async () => brownish(await colorAt(page, "stool-1"))).toBe(true);
    expect(brownish(await colorAt(page, "stool-2"))).toBe(true);
    expect(wasm.some((url) => url.includes("domotwin_models"))).toBe(true);
    // One fetch for the two pieces.
    const fetches = (await calls(page)).filter((c) => c.type === "fetch");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.path).toMatch(/^\/api\/domotwin\/models\/[0-9a-f]{64}\.glb$/);
  });

  test("does not load the model module for a plan without 3D files", async ({ page }) => {
    const wasm: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".wasm")) wasm.push(request.url());
    });
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(wasm.some((url) => url.includes("domotwin_models"))).toBe(false);
  });

  test("a 3D file Home Assistant does not have leaves a box, and says so", async ({ page }) => {
    await page.addInitScript(() => {
      (window as never as { __failModelFiles: boolean }).__failModelFiles = true;
    });
    await openHarness(page, { models: true, view: "2d" });
    await expect(page.locator("domotwin-view").getByTestId("notice")).toHaveText(
      "1 3D model could not be shown: its pieces are boxes.",
    );
    await settle(page);
    expect(brownish(await colorAt(page, "stool-1"))).toBe(false);
  });

  test("imports a 3D file in edit mode, saves it and lists it in My models", async ({ page }) => {
    await editing(page);
    await importModel(page, `${MODELS}/stool.stl`);
    const sheet = page.getByTestId("model-import-sheet");
    await expect(sheet).toContainText("stool.stl · 224 triangles");
    // STL: millimetres, Z up.
    await expect(sheet.getByTestId("model-unit")).toHaveValue("mm");
    await expect(sheet.getByTestId("model-up")).toHaveValue("z");
    await expect(sheet.getByTestId("model-size-0")).toHaveValue("38");
    await expect(sheet.getByTestId("model-size-1")).toHaveValue("38");
    await expect(sheet.getByTestId("model-size-2")).toHaveValue("71");
    // Read in centimetres it would be 10 m high: refused until fixed.
    await sheet.getByTestId("model-unit").selectOption("cm");
    await expect(sheet.getByRole("alert")).toBeVisible();
    await expect(sheet.getByTestId("model-import")).toBeDisabled();
    await sheet.getByTestId("model-unit").selectOption("mm");
    await sheet.getByTestId("model-name").fill("Kitchen stool");
    await sheet.getByTestId("model-color").fill("#336699");
    await sheet.getByTestId("model-import").click();
    await expect(page.getByTestId("edit-status")).toHaveText("Kitchen stool");
    const upload = (await calls(page)).find((c) => c.type === "fetch" && c.method === "POST");
    expect(upload?.path).toBe("/api/domotwin/models?format=stl");

    await page.getByTestId("edit-save").click();
    await expect(page.getByTestId("toast")).toHaveText(/Changes saved\./);
    const layout = (await savedLayout(page)) ?? {};
    const key = Object.keys(layout).find((k) => k.startsWith("@model:"));
    expect(key).toMatch(/^@model:m-[0-9a-f-]{36}$/);
    const model = layout[key ?? ""]?.model as {
      name: string;
      size: number[];
      color: string;
      file: { format: string; hash: string; bytes: number; up: string };
    };
    expect(model).toMatchObject({
      name: "Kitchen stool",
      size: [38, 38, 71],
      color: "#336699",
      file: { format: "stl", up: "z" },
    });
    expect(model.file.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(layout["custom-added-1"]?.add).toMatchObject({
      kind: "custom",
      model: key?.slice("@model:".length),
    });

    // My models lists it; in use, it cannot be forgotten. A second piece comes from the list.
    await page.getByTestId("edit-mode").click();
    await page.getByTestId("edit-add").click();
    const id = key?.slice("@model:".length) ?? "";
    await expect(page.getByTestId(`catalogue-model-${id}`)).toContainText("Kitchen stool");
    await expect(page.getByTestId(`catalogue-model-${id}`)).toContainText("38 × 38 × 71 cm · STL");
    await expect(page.getByTestId(`catalogue-forget-${id}`)).toHaveCount(0);
    await page.getByTestId(`catalogue-model-${id}`).click();
    await expect
      .poll(async () => (await viewState(page)).edit?.selection)
      .toEqual(["custom-added-2"]);
  });

  test("forgets an imported model that no piece shows", async ({ page }) => {
    await editing(page);
    await importModel(page, `${MODELS}/lamp.gltf`);
    await page.getByTestId("model-import").click();
    await expect
      .poll(async () => (await viewState(page)).edit?.selection)
      .toEqual(["custom-added-1"]);
    await page.getByTestId("edit-remove").click();
    await page.getByTestId("edit-add").click();
    const forget = page.locator("[data-testid^=catalogue-forget-]");
    await expect(forget).toHaveCount(1);
    await forget.click();
    await expect(page.locator("[data-testid^=catalogue-model-]")).toHaveCount(0);
    await page.getByTestId("catalogue").getByRole("button", { name: "Dismiss" }).click();
    expect((await viewState(page)).edit?.dirty).toBe(false);
  });

  test("a model no piece showed is fetched when a piece of it is added", async ({ page }) => {
    await editing(page, "unused");
    // Nothing to draw: nothing fetched.
    expect((await calls(page)).filter((c) => c.type === "fetch")).toHaveLength(0);
    await page.getByTestId("edit-add").click();
    await expect(page.getByTestId("catalogue-model-m-stool")).toContainText("Bar stool");
    await page.getByTestId("catalogue-model-m-stool").click();
    await expect
      .poll(async () => (await viewState(page)).edit?.selection)
      .toEqual(["custom-added-1"]);
    await expect
      .poll(async () => (await calls(page)).filter((c) => c.type === "fetch").length)
      .toBe(1);
    // Not selected (no blue tint): the wood of its seat.
    await page.keyboard.press("Escape");
    await expect.poll(async () => brownish(await colorAt(page, "custom-added-1"))).toBe(true);
  });

  test("keeps a plan's 3D files within 20 MB", async ({ page }) => {
    await openHarness(page, { mode: "panel", models: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    // Another model whose file is almost 20 MB… with the stool's: no room for one more.
    await page.evaluate(async () => {
      const w = window as never as {
        __store: { plan: { models: Record<string, unknown> } };
        __hass: { connection: { sendMessagePromise(message: unknown): Promise<unknown> } };
      };
      const plan = structuredClone(w.__store.plan);
      plan.models["m-big"] = {
        name: "Big",
        size: [100, 100, 100],
        file: { format: "glb", hash: "e".repeat(64), bytes: 19_980_000, up: "y" },
      };
      await w.__hass.connection.sendMessagePromise({ type: "domotwin/plan/save", plan });
    });
    await page.getByTestId("edit-mode").click();
    await importModel(page, `${MODELS}/stool.stl`);
    await page.getByTestId("model-import").click();
    await expect(page.getByRole("alert")).toHaveText(
      "This 3D model cannot be imported: the 3D files of a plan total at most 20 MB.",
    );
    expect((await calls(page)).filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("refuses a file it cannot read, and says why", async ({ page }) => {
    await editing(page);
    await importModel(page, {
      name: "broken.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from("not a model"),
    });
    await expect(page.getByRole("alert")).toHaveText(
      /This 3D model cannot be imported: it is not a 3D file this app can read/,
    );
    expect((await calls(page)).filter((c) => c.method === "POST")).toHaveLength(0);
    await expect(page.getByTestId("model-import-sheet")).toHaveCount(0);
  });

  test("exports the plan with its 3D files and imports it back", async ({ page }) => {
    await openHarness(page, { mode: "panel", models: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export plan" }).click();
    const path = await (await download).path();
    const text = await readFile(path, "utf8");
    const exported = JSON.parse(text) as {
      models: Record<string, { file: { hash: string; data: string } }>;
    };
    const file = exported.models["m-stool"]?.file;
    expect(file?.data).toMatch(/^data:model\/gltf-binary;base64,/);
    const original = await readFile(`${MODELS}/stool.glb`);
    expect(Buffer.from(file?.data.split(",")[1] ?? "", "base64").equals(original)).toBe(true);

    // On another installation: no file yet, the import uploads it and keeps only its reference.
    await page.evaluate(() => {
      (window as never as { __store: { files: Map<string, unknown> } }).__store.files.clear();
    });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    await (
      await chooser
    ).setFiles({
      name: "home.plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(page.getByTestId("toast")).toHaveText(/Plan imported/);
    const stored = await page.evaluate(
      () =>
        (
          window as never as {
            __store: {
              plan: { models: Record<string, { file: Record<string, unknown> }> };
              files: Map<string, unknown>;
            };
          }
        ).__store,
    );
    const kept = stored.plan.models["m-stool"]?.file;
    expect(kept?.data).toBeUndefined();
    expect(kept?.hash).toBe(file?.hash);
    const files = await page.evaluate(() => [
      ...(window as never as { __store: { files: Map<string, unknown> } }).__store.files.keys(),
    ]);
    expect(files).toEqual([`${file?.hash ?? ""}.glb`]);
  });

  test("an exported plan whose 3D file is broken is refused with the model's name", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    const plan = JSON.parse(await readFile("../examples/demo-apartment.plan.json", "utf8")) as {
      models?: unknown;
    };
    plan.models = {
      "m-1": {
        name: "Broken lamp",
        size: [40, 40, 160],
        file: {
          format: "glb",
          hash: "0".repeat(64),
          bytes: 4,
          up: "y",
          data: "data:model/gltf-binary;base64,AAAAAA==",
        },
      },
    };
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    await (
      await chooser
    ).setFiles({
      name: "broken.plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await expect(page.getByRole("alert")).toHaveText(
      /This file cannot be imported: the 3D model “Broken lamp” was refused: it is not a 3D file/,
    );
  });
});
