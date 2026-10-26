import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { FrameStats } from "../src/components/view";
import {
  MARKDOWN_COLUMNS,
  MISSING,
  deviceName,
  framesPerSecond,
  markdownHeader,
  markdownRows,
  readDevice,
  type MeasureReport,
} from "../src/measure/report";

const stats = (interval: number, cpu: number): FrameStats => ({
  frames: 300,
  wasmMemoryBytes: 38_543_360,
  cpuMedianMs: cpu,
  cpuP95Ms: cpu * 2,
  intervalMedianMs: interval,
  intervalP95Ms: interval * 1.25,
});

/** Fictional devices' user agents. */
const AGENTS = {
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  app: "Mozilla/5.0 (Linux; Android 13; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Home Assistant/2026.10.0-1234 (Android 13; Tab)",
};

function report(extra: Partial<MeasureReport> = {}): MeasureReport {
  return {
    device: {
      userAgent: AGENTS.android,
      screen: { width: 412, height: 915, pixelRatio: 2.625 },
      cores: 8,
      memoryGb: 8,
      renderer: "ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)",
      app: false,
      version: "0.3.0",
    },
    firstPictureMs: 1840,
    runs: [
      {
        look: "neon",
        quality: "balanced",
        resolution: 0.85,
        triangles: 19460,
        turning: stats(16.7, 2.14),
        still: stats(16.6, 1.02),
      },
    ],
    ...extra,
  };
}

describe("deviceName", () => {
  it("says the system and the browser briefly", () => {
    expect(deviceName(AGENTS.android)).toBe("Android 14 · Chrome 141");
    expect(deviceName(AGENTS.iphone)).toBe("iOS 17.4 · Safari 17.4");
    expect(deviceName(AGENTS.edge)).toBe("Windows · Edge 141");
    expect(deviceName(AGENTS.firefox)).toBe("Linux · Firefox 131");
  });

  it("tells an iPad, which says it is a Mac, by its touch screen", () => {
    expect(deviceName(AGENTS.ipad, 5)).toBe("iPadOS · Safari 17.4");
    expect(deviceName(AGENTS.ipad, 0)).toBe("macOS · Safari 17.4");
  });
});

describe("readDevice", () => {
  const where = (userAgent: string, extra: Record<string, unknown> = {}) =>
    ({
      navigator: { userAgent, hardwareConcurrency: 4, ...extra } as unknown as Navigator,
      screen: { width: 1280, height: 800 },
      devicePixelRatio: 1.5,
    }) as const;

  it("reads what the browser gives, and leaves out what it does not", () => {
    const device = readDevice("0.3.0", undefined, where(AGENTS.firefox));
    expect(device).toEqual({
      userAgent: AGENTS.firefox,
      screen: { width: 1280, height: 800, pixelRatio: 1.5 },
      cores: 4,
      app: false,
      version: "0.3.0",
    });
  });

  it("knows an iPad by its touch screen", () => {
    const device = readDevice("0.3.0", undefined, where(AGENTS.ipad, { maxTouchPoints: 5 }));
    expect(device.touch).toBe(5);
    expect(markdownRows({ ...report(), device })).toContain("| iPadOS · Safari 17.4 (browser) |");
  });

  it("knows Home Assistant's companion app", () => {
    expect(readDevice("0.3.0", "GPU", where(AGENTS.app, { deviceMemory: 4 }))).toMatchObject({
      app: true,
      memoryGb: 4,
      renderer: "GPU",
    });
    const ios = { ...where(AGENTS.iphone), webkit: { messageHandlers: { externalBus: {} } } };
    expect(readDevice("0.3.0", undefined, ios).app).toBe(true);
  });
});

describe("markdownRows", () => {
  it("gives a row per look, with as many cells as the table has columns", () => {
    const row = markdownRows(report());
    expect(row).toBe(
      "| Android 14 · Chrome 141 (browser) | 412×915 @2.63 | 8 cores, 8 GB | ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2) | 0.3.0 | neon | balanced, 0.85 | 1.8 s | 60 fps, 20.9 ms | 2.1 / 4.3 ms | 60 fps, 20.8 ms | 1 / 2 ms | 38.5 MB | 19460 |",
    );
    const cells = row.split(" | ").length;
    expect(cells).toBe(MARKDOWN_COLUMNS.length);
    expect(markdownHeader().split("\n")[0]?.split(" | ").length).toBe(MARKDOWN_COLUMNS.length);
  });

  it("says what the browser did not give", () => {
    const base = report();
    const [run] = base.runs;
    if (!run) throw new Error("no run");
    const without = { ...run };
    delete without.triangles;
    const rows = markdownRows({
      device: {
        userAgent: AGENTS.app,
        screen: base.device.screen,
        app: true,
        version: "0.3.0",
      },
      runs: [{ ...without, look: "day" }, run],
    }).split("\n");
    expect(rows).toHaveLength(2);
    const cells = rows[0]?.slice(2, -2).split(" | ") ?? [];
    expect(cells[0]).toBe("Android 13 · Chrome 140 (Home Assistant app)");
    // Cores and memory, the GPU, the first picture, the triangles.
    expect([cells[2], cells[3], cells[7], cells[13]]).toEqual([MISSING, MISSING, MISSING, MISSING]);
  });

  it("keeps a GPU's name in its cell", () => {
    const base = report();
    const row = markdownRows({
      ...base,
      device: { ...base.device, renderer: "A\\ | B\nC" },
    });
    expect(row).toContain("| A\\\\ \\| B C |");
  });

  it("has no frames a second without frames", () => {
    expect(framesPerSecond(stats(0, 1))).toBeUndefined();
  });

  it("matches the table of real devices in docs/PERFORMANCE.md", () => {
    const doc = readFileSync(resolve(__dirname, "../../docs/PERFORMANCE.md"), "utf8");
    expect(doc).toContain(markdownHeader());
  });
});
