#!/usr/bin/env node
// Renders the documentation figures: docs/figures/src/*.svg → docs/figures/*.png (2× for sharp text).
//   node scripts/render-figures.mjs      (needs `npm ci` in frontend/ for Playwright's Chromium)
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChromium } from "./lib/chromium.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = join(root, "docs", "figures", "src");
const browser = await launchChromium(root);
for (const file of (await readdir(sources))
  .filter((name) => name.endsWith(".svg"))
  .sort()) {
  const svg = await readFile(join(sources, file), "utf8");
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 1600);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 900);
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
  await page.evaluate(() => document.fonts.ready);
  const out = join(root, "docs", "figures", `${basename(file, ".svg")}.png`);
  await page.locator("svg").first().screenshot({ path: out });
  await page.close();
  console.log(`docs/figures/${basename(out)}`);
}
await browser.close();
