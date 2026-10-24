import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { FrameStats } from "../src/components/view";
import { openHarness, viewState } from "./fixtures";

interface BenchmarkView {
  benchmark(frames: number): Promise<FrameStats>;
}

// Frame-time smoke test: logged as a CI artifact, compared across milestones in PERFORMANCE.md.
test("frame time with the demo plan", async ({ page }, testInfo) => {
  await openHarness(page);
  await expect(page.getByTestId("summary")).toBeVisible();
  const stats: FrameStats = await page.evaluate(() =>
    (window as never as { __view: () => BenchmarkView }).__view().benchmark(120),
  );
  const report = { plan: "demo-apartment", renderer: "SwiftShader (software WebGL2)", ...stats };
  const path = testInfo.outputPath("frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(stats.frames).toBe(120);
});

interface DragEngine {
  beginEdit(): unknown;
  editSelect(id: string, add: boolean): unknown;
  screenPoint(id: string): [number, number] | undefined;
  editDragStart(x: number, y: number): boolean;
  editDragMove(x: number, y: number): unknown;
  editDragEnd(): unknown;
  frame(time: number): boolean;
  invalidate(): void;
}

// Edit mode: what one pointer move costs while a piece is dragged (rebuilding the dragged pieces,
// snapping, guides and collisions), then drawing the frame.
test("drag cost in edit mode", async ({ page }, testInfo) => {
  await openHarness(page, { mode: "panel" });
  await expect(page.getByTestId("summary")).toBeVisible();
  const report = await page.evaluate(() => {
    const view = (window as never as { __view: () => { engine: DragEngine } }).__view();
    const engine = view.engine;
    engine.beginEdit();
    engine.editSelect("sofa", false);
    const point = engine.screenPoint("sofa");
    if (!point || !engine.editDragStart(point[0], point[1])) throw new Error("no grab");
    const move: number[] = [];
    const frame: number[] = [];
    for (let i = 1; i <= 60; i += 1) {
      const start = performance.now();
      engine.editDragMove(point[0] - i * 2, point[1] + i);
      const moved = performance.now();
      engine.invalidate();
      engine.frame(moved);
      move.push(moved - start);
      frame.push(performance.now() - moved);
    }
    const start = performance.now();
    engine.editDragEnd();
    const end = performance.now() - start;
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    return {
      moveMedianMs: median(move),
      moveP95Ms: p95(move),
      frameMedianMs: median(frame),
      dropMs: end,
    };
  });
  const path = testInfo.outputPath("drag-cost.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("drag-cost", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(report.moveMedianMs).toBeLessThan(50);
});

interface PlanEditorForTests {
  state: { corners: { x: number; y: number }[] };
  tap(x: number, y: number): void;
  grab(pointer: number, from: { x: number; y: number }): boolean;
  pending?: { x: number; y: number };
  flush(): void;
  endDrag(): void;
}

// The plan editor: what one pointer move costs while a room's corner is dragged (the change
// checked by the plan reader in the plan editor's module, the draft shown again: read by the
// engine, the whole scene built and uploaded, the handles placed), then drawing the frame.
test("drag cost in the plan editor", async ({ page }, testInfo) => {
  await openHarness(page, { mode: "panel", view: "2d" });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.getByTestId("plan-mode").click();
  await expect(page.locator("domotwin-plan-bar")).toBeVisible();
  const report = await page.evaluate(() => {
    const view = (
      window as never as {
        __view: () => {
          planEditor: PlanEditorForTests;
          engine: { frame(time: number): boolean; invalidate(): void };
          canvas: HTMLCanvasElement;
          elementPoint(id: string): { x: number; y: number } | undefined;
        };
      }
    ).__view();
    const editor = view.planEditor;
    const sofa = view.elementPoint("sofa");
    if (!sofa) throw new Error("no sofa");
    editor.tap(sofa.x, sofa.y);
    const scale = view.canvas.width / view.canvas.clientWidth;
    const corner = editor.state.corners[0];
    if (!corner) throw new Error("no room selected");
    const from = { x: corner.x / scale, y: corner.y / scale };
    if (!editor.grab(1, from)) throw new Error("no grab");
    const move: number[] = [];
    const frame: number[] = [];
    for (let i = 1; i <= 60; i += 1) {
      editor.pending = { x: from.x - i, y: from.y - i / 2 };
      const start = performance.now();
      editor.flush();
      const moved = performance.now();
      view.engine.invalidate();
      view.engine.frame(moved);
      move.push(moved - start);
      frame.push(performance.now() - moved);
    }
    editor.endDrag();
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    return { moveMedianMs: median(move), moveP95Ms: p95(move), frameMedianMs: median(frame) };
  });
  const path = testInfo.outputPath("plan-drag-cost.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("plan-drag-cost", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(report.moveMedianMs).toBeLessThan(50);
});

// Two pieces drawn from a 3D file of 139 392 triangles (7 MB STL): fetching and reading it, giving
// it to the engine (the whole scene rebuilt), then the frame time.
test("a large 3D model", async ({ page }, testInfo) => {
  await openHarness(page, { models: "big" });
  await expect(page.getByTestId("summary")).toBeVisible();
  await expect
    .poll(async () => (await viewState(page)).models?.drawMs.length, { timeout: 30_000 })
    .toBe(1);
  const state = await viewState(page);
  const stats: FrameStats = await page.evaluate(() =>
    (window as never as { __view: () => BenchmarkView }).__view().benchmark(60),
  );
  const report = {
    triangles: state.stats?.triangles,
    loadMs: state.models?.loadMs[0],
    drawMs: state.models?.drawMs[0],
    cpuMedianMs: stats.cpuMedianMs,
    cpuP95Ms: stats.cpuP95Ms,
    wasmMemoryBytes: stats.wasmMemoryBytes,
  };
  const path = testInfo.outputPath("large-model.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("large-model", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(report.triangles).toBeGreaterThan(2 * 139_392);
});
