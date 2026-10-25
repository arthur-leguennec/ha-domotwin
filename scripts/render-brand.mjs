#!/usr/bin/env node
// Renders DomoTwin's brand images, which Home Assistant and HACS show for the integration:
// docs/brand/icon.svg → custom_components/domotwin/brand/{icon,icon@2x}.png, and the logo (the icon
// and the name, in the bundled font) → {logo,logo@2x,dark_logo,dark_logo@2x}.png. Transparent.
// docs/brand/sources.sha256 records what they were rendered from (`sha256sum -c` from the root,
// and tests/test_brand.py).
//   node scripts/render-brand.mjs      (needs `npm ci` in frontend/ for Playwright's Chromium)
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChromium } from "./lib/chromium.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["docs/brand/icon.svg", "frontend/fonts/inter-variable.woff2"];
const [iconFile, fontFile] = await Promise.all(
  sources.map((path) => readFile(join(root, path))),
);

const out = join(root, "custom_components", "domotwin", "brand");
await mkdir(out, { recursive: true });
const icon = iconFile.toString("utf8");
const font = fontFile.toString("base64");

const browser = await launchChromium(root);

/** Renders `html` at 1× and 2× into `name`.png and `name`@2x.png, its first element's box only. */
async function render(name, html) {
  for (const [scale, suffix] of [
    [1, ""],
    [2, "@2x"],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 800, height: 400 },
      deviceScaleFactor: scale,
    });
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
      html, body { margin: 0; background: transparent; }
    </style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const path = join(out, `${name}${suffix}.png`);
    await page
      .locator("body > *")
      .first()
      .screenshot({ path, omitBackground: true });
    await page.close();
    console.log(`custom_components/domotwin/brand/${name}${suffix}.png`);
  }
}

await render("icon", icon);
// The logo: the icon at the logo's height (an image, sized whatever the drawing's own size),
// then the name.
const iconImage = `data:image/svg+xml;base64,${iconFile.toString("base64")}`;
const logo = (
  color,
) => `<div style="display: inline-flex; align-items: center; gap: 22px; height: 128px">
  <img src="${iconImage}" width="128" height="128" alt="">
  <span style="font: 700 68px/1 Inter, sans-serif; letter-spacing: -1px; color: ${color}">DomoTwin</span>
</div>`;
await render("logo", logo("#0f172a"));
await render("dark_logo", logo("#f8fafc"));
await browser.close();

const digests = [iconFile, fontFile].map((data, i) => {
  return `${createHash("sha256").update(data).digest("hex")}  ${sources[i]}\n`;
});
await writeFile(
  join(root, "docs", "brand", "sources.sha256"),
  digests.join(""),
);
console.log("docs/brand/sources.sha256");
