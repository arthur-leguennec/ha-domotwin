// Bundles the frontend into custom_components/domotwin/frontend/ (run through scripts/build.sh,
// which builds the WebAssembly modules first: the engine, the IFC import and the 3D model reader).
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../custom_components/domotwin/frontend");
const dev = process.argv.includes("--dev");

const { version } = JSON.parse(await readFile(join(here, "package.json"), "utf8"));

/** A built wasm module and the name it is served under (content hash for caching). */
async function wasmModule(dir, name) {
  const path = resolve(here, dir, `${name}_bg.wasm`);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    console.error(`${name} is not built: run scripts/build.sh from the repository root.`);
    process.exit(1);
  }
  return {
    path,
    file: `${name}_bg.${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.wasm`,
  };
}
const engine = await wasmModule("src/engine/pkg", "domotwin_web");
const planImport = await wasmModule("src/import/pkg", "domotwin_import");
const models = await wasmModule("src/models/pkg", "domotwin_models");
const planner = await wasmModule("src/planner/pkg", "domotwin_planner");
const wasmFile = engine.file;

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
    __DOMOTWIN_IMPORT_WASM__: JSON.stringify(planImport.file),
    __DOMOTWIN_MODELS_WASM__: JSON.stringify(models.file),
    __DOMOTWIN_PLANNER_WASM__: JSON.stringify(planner.file),
  },
});

await copyFile(engine.path, join(out, engine.file));
await copyFile(planImport.path, join(out, planImport.file));
await copyFile(models.path, join(out, models.file));
await copyFile(planner.path, join(out, planner.file));
await writeFile(
  join(out, "build.json"),
  JSON.stringify(
    {
      version,
      wasm: wasmFile,
      import: planImport.file,
      models: models.file,
      planner: planner.file,
      outputs: Object.keys(result.metafile.outputs),
    },
    null,
    2,
  ),
);
console.log(`DomoTwin ${version} built into ${out}${dev ? " (dev)" : ""}`);
