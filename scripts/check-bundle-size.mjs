#!/usr/bin/env node
// Checks the first-load budget of the built frontend (docs/PERFORMANCE.md) and prints a table.
//   node scripts/check-bundle-size.mjs [--json report.json]
// Budget: wasm + JS loaded to show a view ≤ 1.2 MB gzipped (fonts and user textures excluded).
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_GZIP_BYTES = 1_200_000;
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../custom_components/domotwin/frontend");

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    ),
  );
  return nested.flat();
}

try {
  await stat(join(out, "domotwin.js"));
} catch {
  console.error(`No build in ${out}: run scripts/build.sh first.`);
  process.exit(1);
}

const rows = [];
for (const file of await files(out)) {
  const kind = file.endsWith(".wasm") ? "wasm" : file.endsWith(".js") ? "js" : "other";
  const bytes = await readFile(file);
  rows.push({
    file: relative(out, file),
    kind,
    bytes: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
  });
}
rows.sort((a, b) => b.gzip - a.gzip);

// Everything a view needs on first load: every JS chunk except the card editor, and the wasm.
const firstLoad = rows.filter(
  (row) => (row.kind === "js" || row.kind === "wasm") && !row.file.includes("card-editor"),
);
const total = firstLoad.reduce((sum, row) => sum + row.gzip, 0);
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

console.log("| File | Raw | Gzipped |");
console.log("| --- | ---: | ---: |");
for (const row of rows) console.log(`| ${row.file} | ${kb(row.bytes)} | ${kb(row.gzip)} |`);
console.log(`\nFirst load (wasm + JS): ${kb(total)} gzipped, budget ${kb(BUDGET_GZIP_BYTES)}.`);

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex > 0 && process.argv[jsonIndex + 1]) {
  await writeFile(
    process.argv[jsonIndex + 1],
    JSON.stringify({ budget: BUDGET_GZIP_BYTES, firstLoadGzip: total, files: rows }, null, 2),
  );
}

if (total > BUDGET_GZIP_BYTES) {
  console.error(`Over budget by ${kb(total - BUDGET_GZIP_BYTES)}.`);
  process.exit(1);
}
