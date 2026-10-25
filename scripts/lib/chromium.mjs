// Playwright's Chromium, from frontend/'s dev dependencies, for the scripts that render images.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE picks another Chromium.
import { createRequire } from "node:module";
import { join } from "node:path";

export function launchChromium(root) {
  const require = createRequire(join(root, "frontend", "package.json"));
  const { chromium } = require("@playwright/test");
  return chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  );
}
