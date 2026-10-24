import { defineConfig, devices } from "@playwright/test";

// Software WebGL2 (SwiftShader) so that rendering is the same on every machine.
const chromiumArgs = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    // A picture read back from software WebGL2 takes seconds on a busy runner (every frame
    // queued before it is drawn first): waiting longer only slows down a test that fails.
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1000, height: 700 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1000, height: 700 },
        launchOptions: {
          args: chromiumArgs,
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
            : {}),
        },
      },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: !process.env.CI,
  },
});
