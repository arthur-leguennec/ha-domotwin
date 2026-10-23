import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { FrameStats } from "../src/components/view";
import { openHarness } from "./fixtures";

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
