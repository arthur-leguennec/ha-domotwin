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

// Everything a view needs on first load: the entry, the chunks it imports statically, the engine
// (imported on demand, but every view starts it) with its own imports, and the wasm. Panels and
// editors imported on demand are listed apart.
const sources = new Map();
for (const row of rows) {
  if (row.kind === "js") sources.set(row.file, await readFile(join(out, row.file), "utf8"));
}
function imports(file) {
  const text = sources.get(file) ?? "";
  const found = { static: [], dynamic: [] };
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.dynamic.push(match[1]);
  }
  for (const match of text.matchAll(/(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$*{},\s]*?\bfrom\s*)?["']([^"']+)["']/g)) {
    found.static.push(match[1]);
  }
  const resolveFrom = (spec) => relative(out, resolve(dirname(join(out, file)), spec.split("?")[0]));
  return { static: found.static.map(resolveFrom), dynamic: found.dynamic.map(resolveFrom) };
}
const needed = new Set();
const visit = (file) => {
  if (needed.has(file) || !sources.has(file)) return;
  needed.add(file);
  const { static: statics, dynamic } = imports(file);
  statics.forEach(visit);
  dynamic.filter((spec) => spec.includes("domotwin_web")).forEach(visit);
};
visit("domotwin.js");
const firstLoad = rows.filter((row) => row.kind === "wasm" || needed.has(row.file));
const onDemand = rows.filter((row) => row.kind === "js" && !needed.has(row.file));
const total = firstLoad.reduce((sum, row) => sum + row.gzip, 0);
const later = onDemand.reduce((sum, row) => sum + row.gzip, 0);
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

console.log("| File | Raw | Gzipped |");
console.log("| --- | ---: | ---: |");
for (const row of rows) {
  const when = row.kind === "other" ? "" : needed.has(row.file) || row.kind === "wasm" ? "" : " (on demand)";
  console.log(`| ${row.file}${when} | ${kb(row.bytes)} | ${kb(row.gzip)} |`);
}
console.log(`\nFirst load (wasm + JS): ${kb(total)} gzipped, budget ${kb(BUDGET_GZIP_BYTES)}.`);
console.log(`On demand (panels, editors): ${kb(later)} gzipped.`);

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex > 0 && process.argv[jsonIndex + 1]) {
  await writeFile(
    process.argv[jsonIndex + 1],
    JSON.stringify(
      {
        budget: BUDGET_GZIP_BYTES,
        firstLoadGzip: total,
        onDemandGzip: later,
        firstLoad: firstLoad.map((row) => row.file),
        files: rows,
      },
      null,
      2,
    ),
  );
}

if (total > BUDGET_GZIP_BYTES) {
  console.error(`Over budget by ${kb(total - BUDGET_GZIP_BYTES)}.`);
  process.exit(1);
}
