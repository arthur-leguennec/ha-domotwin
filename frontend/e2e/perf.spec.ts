import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { FrameStats } from "../src/components/view";
import { openHarness, settle, viewState } from "./fixtures";

interface BenchmarkView {
  benchmark(frames: number): Promise<FrameStats>;
}

interface ReadBackView extends HTMLElement {
  engine?: { invalidate(): void; frame(time: number): boolean };
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

// The looks (D-027, D-036) at High quality: each drawn offscreen with MSAA and its bloom, the
// cartoon with its ink too.
test("frame time of each look", async ({ page }, testInfo) => {
  // A software GPU draws a High frame in a fraction of a second.
  test.setTimeout(240_000);
  const report: Record<string, FrameStats> = {};
  for (const theme of ["day", "neon", "blueprint", "cartoon", "clay"] as const) {
    await openHarness(page, { theme, lighting: "evening", live: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.evaluate(() => {
      const view = (
        window as never as { __view: () => { options: Record<string, unknown> } }
      ).__view();
      view.options = { ...view.options, quality: "high" };
    });
    await expect.poll(async () => (await viewState(page)).quality).toBe("high");
    report[theme] = await page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
    expect(report[theme].frames).toBe(20);
  }
  const path = testInfo.outputPath("looks-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("looks-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
});

// The quality presets (M12b): Eco, Balanced and High against each other, in the look that costs
// the most (neon, its bloom), in the evening with the lamps on.
test("frame time of each quality preset", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const report: Record<string, FrameStats & { gpuMedianMs: number }> = {};
  await openHarness(page, { theme: "neon", lighting: "evening", live: true });
  await expect(page.getByTestId("summary")).toBeVisible();
  for (const quality of ["eco", "balanced", "high"] as const) {
    await page.evaluate((quality) => {
      const view = (
        window as never as { __view: () => { options: Record<string, unknown> } }
      ).__view();
      view.options = { ...view.options, quality };
    }, quality);
    await expect.poll(async () => (await viewState(page)).quality).toBe(quality);
    await settle(page);
    const stats = await page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
    expect(stats.frames).toBe(20);
    // The GPU's share too: each frame read back, so that it is waited for (nine frames).
    const gpuMedianMs = await page.evaluate(() => {
      const view = (window as never as { __view: () => ReadBackView }).__view();
      const canvas = view.shadowRoot?.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      if (!view.engine || !gl) throw new Error("no engine");
      const pixel = new Uint8Array(4);
      const times: number[] = [];
      for (let i = 0; i < 9; i += 1) {
        const start = performance.now();
        view.engine.invalidate();
        view.engine.frame(start);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[4] ?? Number.NaN;
    });
    report[quality] = { ...stats, gpuMedianMs };
  }
  const path = testInfo.outputPath("presets-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("presets-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
});

// Every storey at once (D-028): the demo home's two storeys spread apart under their roof, in the
// evening with its lamps on, neon at High quality (offscreen, with MSAA and its bloom), as above.
test("frame time of the whole home", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openHarness(page, {
    storeys: 2,
    storey: "all",
    theme: "neon",
    lighting: "evening",
    live: true,
  });
  await expect.poll(async () => (await viewState(page)).stats?.storeys).toBe(2);
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  const one: FrameStats = await page.evaluate(() =>
    (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
  );
  const report = { storeys: 2, triangles: (await viewState(page)).stats?.triangles, ...one };
  const path = testInfo.outputPath("home-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("home-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(one.frames).toBe(20);
});

// Walking (D-029): at eye level in the living room, the day look at High, in the evening with the
// lamps on: whole walls and the ceilings drawn.
test("frame time walking", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openHarness(page, { theme: "day", lighting: "evening", live: true });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  await page.locator("domotwin-view").getByTestId("walk").click();
  await expect.poll(async () => (await viewState(page)).stats?.walking).toBe(true);
  await settle(page);
  const one: FrameStats = await page.evaluate(() =>
    (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
  );
  const path = testInfo.outputPath("walk-frame-time.json");
  await writeFile(path, JSON.stringify(one, null, 2));
  await testInfo.attach("walk-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify({ walking: one }));
  expect(one.frames).toBe(20);
});

// The network map (D-031): the day look at High with the mesh drawn (its pulses held still, as
// with reduce motion), against the same view without it; then what reading a large fictional mesh
// costs (300 devices, 8 neighbours each, placed on the plan's pieces in turn): read and analysed by
// the analysis module, its wires built by the engine.
test("frame time with the network map", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // The pulses held still, so that both measures draw the same frames.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHarness(page, { theme: "day", lighting: "evening", live: true, zha: true });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  await settle(page);
  const benchmark = () =>
    page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
  const without = await benchmark();
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator('[data-layer="network"]').click();
  await expect(page.locator("domotwin-network .node")).toHaveCount(5);
  const withMap = await benchmark();
  // The large mesh goes through the network panel: the analysis module reads it (D-043), the
  // engine draws it, the analysis reports with the rooms.
  const large = await page.evaluate(async () => {
    const view = (
      window as never as {
        __view: () => HTMLElement & {
          engine: { elementList(): { id: string }[]; setNetwork(text: string): string };
        };
      }
    ).__view();
    const panel = view.shadowRoot?.querySelector("domotwin-network") as
      | (HTMLElement & {
          devices: unknown[];
          bindings: unknown;
          names: Record<string, unknown>;
          analysis?: { links: unknown[] };
          updateComplete: Promise<unknown>;
          show(): Promise<void>;
        })
      | null;
    if (!panel) throw new Error("no network panel");
    const elements = view.engine
      .elementList()
      .map((e) => e.id)
      .filter((e) => e in panel.names);
    const count = 300;
    const id = (i: number) =>
      `00:00:00:00:00:00:${Math.floor(i / 256)
        .toString(16)
        .padStart(2, "0")}:${(i % 256).toString(16).padStart(2, "0")}`;
    const devices = Array.from({ length: count }, (_, i) => ({
      id: id(i),
      name: `Device ${i}`,
      role: i === 0 ? "coordinator" : i % 3 === 0 ? "end" : "router",
      lqi: 40 + ((i * 37) % 215),
      seen: (i * 97) % 90_000,
      available: true,
      entities: [`sensor.device_${i}`],
      neighbours: Array.from({ length: 8 }, (_, k) => ({
        id: id((i + 1 + k * 13) % count),
        lqi: 30 + ((i * 11 + k * 29) % 225),
        relation: k === 0 ? "parent" : "sibling",
      })),
    }));
    // Each device placed on the plan's pieces in turn, through one of its entities.
    const bindings: { version: 1; rooms: object; elements: Record<string, unknown> } = {
      version: 1,
      rooms: {},
      elements: {},
    };
    elements.forEach((element, e) => {
      bindings.elements[element] = {
        entities: devices
          .filter((_, i) => i % elements.length === e)
          .map((d) => ({ entity_id: d.entities[0], role: "sensor" })),
      };
    });
    panel.devices = devices;
    panel.bindings = bindings;
    await panel.updateComplete;
    await panel.show();
    // The engine's share: what its `setNetwork` takes.
    const engine = view.engine;
    const setNetwork = engine.setNetwork.bind(engine);
    let engineMs = 0;
    engine.setNetwork = (text) => {
      const start = performance.now();
      const answer = setNetwork(text);
      engineMs += performance.now() - start;
      return answer;
    };
    const times: number[] = [];
    const engineTimes: number[] = [];
    for (let run = 0; run < 15; run += 1) {
      engineMs = 0;
      const start = performance.now();
      await panel.show();
      // The panel's list of devices, drawn again.
      await panel.updateComplete;
      times.push(performance.now() - start);
      engineTimes.push(engineMs);
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[7];
    return {
      devices: count,
      links: panel.analysis?.links.length ?? 0,
      medianMs: median(times),
      engineMedianMs: median(engineTimes),
    };
  });
  const report = { without, withMap, large };
  const path = testInfo.outputPath("network-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("network-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(withMap.frames).toBe(20);
  expect(large.links).toBeGreaterThan(300);
});

// Automation wires (D-032): 50 made-up automations, every one shown (bundled by room, as the layer
// does above 30), against the same view without them; then what drawing all 50 unbundled costs
// (their ends placed, the wires worked out and built), and reading one configuration.
test("frame time with 50 automations", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHarness(page, { theme: "day", lighting: "evening", live: true, automations: 50 });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  await settle(page);
  const benchmark = () =>
    page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
  const without = await benchmark();
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator('[data-layer="automations"]').click();
  await page.getByTestId("wires-every").click();
  await expect(page.getByTestId("wires")).toContainText("50 automations");
  const bundled = await benchmark();
  const unbundled = await page.evaluate(() => {
    const view = (
      window as never as {
        __view: () => {
          engine: {
            setAutomations(json: string): string;
            elementList(): { id: string; type: string }[];
          };
        };
      }
    ).__view();
    const pieces = view.engine
      .elementList()
      .filter((e) => e.type === "furniture")
      .map((e) => e.id);
    const automations = Array.from({ length: 50 }, (_, i) => ({
      id: `automation.made_up_${i}`,
      color: [0.9, 0.4, 0.1],
      ends: [
        i % 3 === 0
          ? { role: "trigger", above: "Time" }
          : { role: "trigger", piece: pieces[i % pieces.length] },
        { role: "action", piece: pieces[(i * 7 + 3) % pieces.length] },
        { role: "action", piece: pieces[(i * 11 + 5) % pieces.length] },
      ],
    }));
    const json = JSON.stringify({ automations });
    const times: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      const start = performance.now();
      view.engine.setAutomations(json);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { automations: automations.length, medianMs: times[3] };
  });
  const report = { without, bundled, unbundled };
  const path = testInfo.outputPath("automations-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("automations-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(bundled.frames).toBe(20);
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
  // 60 frames of a scene of 300 000 triangles on a software GPU: about 40 s on an idle machine.
  test.setTimeout(120_000);
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

test("frame time with the upkeep layer, and 1 000 cards", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHarness(page, { theme: "day", lighting: "evening", live: true, upkeep: true });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  await settle(page);
  const benchmark = () =>
    page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
  const without = await benchmark();
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator('[data-layer="upkeep"]').click();
  await expect(page.getByTestId("upkeep-list")).toBeVisible();
  const layer = await benchmark();
  // 1 000 cards of five tasks each, every piece of the plan among them: where they all stand
  // today, their badges and the tints, worked out and drawn.
  const cards = await page.evaluate(async () => {
    const view = (
      window as never as {
        __view: () => {
          upkeep: unknown;
          updateComplete: Promise<boolean>;
          engine: { elementList(): { id: string; type: string }[] };
        };
      }
    ).__view();
    const pieces = view.engine
      .elementList()
      .filter((e) => e.type === "furniture")
      .map((e) => e.id);
    const times: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      const all: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i += 1) {
        all[pieces[i] ?? `made-up-${i}`] = {
          installed: "2024-01-31",
          warranty_end: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}`,
          tasks: Array.from({ length: 5 }, (_, k) => ({
            id: `t${k}`,
            name: `Task ${k}`,
            every: 1 + ((i + k + run) % 12),
            unit: k % 2 ? "months" : "days",
            last_done: `2026-${String(1 + ((i + k) % 9)).padStart(2, "0")}-15`,
          })),
        };
      }
      const start = performance.now();
      view.upkeep = { version: 1, lead_days: 14, pieces: all };
      await view.updateComplete;
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { cards: 1000, tasks: 5000, medianMs: times[3] };
  });
  const report = { without, layer, cards };
  const path = testInfo.outputPath("upkeep-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("upkeep-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(layer.frames).toBe(20);
});

test("frame time with ten people walking", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openHarness(page, { theme: "day", lighting: "evening", live: true });
  await expect(page.getByTestId("summary")).toBeVisible();
  await page.evaluate(() => {
    const view = (
      window as never as { __view: () => { options: Record<string, unknown> } }
    ).__view();
    view.options = { ...view.options, quality: "high" };
  });
  await expect.poll(async () => (await viewState(page)).quality).toBe("high");
  await settle(page);
  const benchmark = () =>
    page.evaluate(() =>
      (window as never as { __view: () => BenchmarkView }).__view().benchmark(20),
    );
  /** Ten made-up people, spread over the demo apartment's rooms, `shift` rooms along. */
  const people = (shift: number) =>
    page.evaluate((shift) => {
      const rooms = ["living", "kitchen", "bathroom", "hall", "bedroom"];
      const view = (
        window as never as { __view: () => { engine: { setPeople(json: string): void } } }
      ).__view();
      view.engine.setPeople(
        JSON.stringify(
          Array.from({ length: 10 }, (_, i) => ({
            id: `person.p${i}`,
            room: rooms[(i + shift) % rooms.length],
            color: "#2f9fd8",
          })),
        ),
      );
    }, shift);
  const without = await benchmark();
  await people(0);
  await settle(page);
  const standing = await benchmark();
  // Each one walks to another room: frames while they walk.
  await people(2);
  const walking = await benchmark();
  const report = { without, standing, walking };
  const path = testInfo.outputPath("people-frame-time.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("people-frame-time", { path, contentType: "application/json" });
  console.log(JSON.stringify(report));
  expect(walking.frames).toBe(20);
});
