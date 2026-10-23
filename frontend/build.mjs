// Bundles the frontend into custom_components/domotwin/frontend/ (run through scripts/build.sh,
// which builds the WebAssembly engine first).
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../custom_components/domotwin/frontend");
const pkg = resolve(here, "src/engine/pkg");
const dev = process.argv.includes("--dev");

const { version } = JSON.parse(await readFile(join(here, "package.json"), "utf8"));
let wasm;
try {
  wasm = await readFile(join(pkg, "domotwin_web_bg.wasm"));
} catch {
  console.error("The engine is not built: run scripts/build.sh from the repository root.");
  process.exit(1);
}
const wasmFile = `domotwin_web_bg.${createHash("sha256").update(wasm).digest("hex").slice(0, 12)}.wasm`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: { domotwin: join(here, "src/entry.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  splitting: true,
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  target: ["es2022", "chrome100", "safari15.4", "firefox105"],
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "eof",
  metafile: true,
  logLevel: "warning",
  define: {
    __DOMOTWIN_VERSION__: JSON.stringify(version),
    __DOMOTWIN_WASM__: JSON.stringify(wasmFile),
  },
});

await copyFile(join(pkg, "domotwin_web_bg.wasm"), join(out, wasmFile));
await writeFile(
  join(out, "build.json"),
  JSON.stringify(
    { version, wasm: wasmFile, outputs: Object.keys(result.metafile.outputs) },
    null,
    2,
  ),
);
console.log(`DomoTwin ${version} built into ${out}${dev ? " (dev)" : ""}`);
