#!/usr/bin/env node
// Screenshots of the fictional demo apartment for the docs: docs/figures/screenshot-*.png.
//   scripts/build.sh && node scripts/screenshots.mjs   (needs `npm ci` in frontend/)
// Software WebGL2 (SwiftShader), High quality, so the pictures are the same on every machine.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");

const server = spawn(process.execPath, [join(root, "frontend", "e2e", "serve.mjs")], {
  stdio: "ignore",
});
try {
  for (let i = 0; i < 50; i += 1) {
    const ok = await fetch("http://127.0.0.1:4173/health").then(
      (response) => response.ok,
      () => false,
    );
    if (ok) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:4173/?mode=panel");
  await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  const shots = [
    ["screenshot-3d.png", "view.overview()"],
    ["screenshot-plan.png", "view.setPlanView(true)"],
  ];
  for (const [name, action] of shots) {
    const png = await page.evaluate((action) => {
      const view = window.__view();
      view.options = { quality: "high", view: "3d", cutaway: "auto" };
      new Function("view", action)(view);
      return view.captureFrame();
    }, action);
    const out = join(root, "docs", "figures", name);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(out, Buffer.from(png.slice(png.indexOf(",") + 1), "base64")),
    );
    console.log(`docs/figures/${name}`);
  }
  await browser.close();
} finally {
  server.kill();
}
