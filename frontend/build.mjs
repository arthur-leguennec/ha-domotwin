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
const analysis = await wasmModule("src/analysis/pkg", "domotwin_analysis");
const wasmFile = engine.file;

// The bundled font (OFL, `fonts/OFL.txt` next to it), served under its content hash too.
const fontPath = resolve(here, "fonts/inter-variable.woff2");
const fontFile = `fonts/inter-variable.${createHash("sha256")
  .update(await readFile(fontPath))
  .digest("hex")
  .slice(0, 12)}.woff2`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const options = {
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
  // Every language's letters as they are, not escaped: a module is always read as UTF-8, and
  // Arabic, Chinese, Japanese and Korean are a third smaller so (D-082).
  charset: "utf8",
  metafile: true,
  logLevel: "warning",
  define: {
    __DOMOTWIN_VERSION__: JSON.stringify(version),
    __DOMOTWIN_WASM__: JSON.stringify(wasmFile),
    __DOMOTWIN_IMPORT_WASM__: JSON.stringify(planImport.file),
    __DOMOTWIN_MODELS_WASM__: JSON.stringify(models.file),
    __DOMOTWIN_PLANNER_WASM__: JSON.stringify(planner.file),
    __DOMOTWIN_ANALYSIS_WASM__: JSON.stringify(analysis.file),
    __DOMOTWIN_FONT__: JSON.stringify(fontFile),
  },
};
const result = await build({ ...options, entryPoints: { domotwin: join(here, "src/entry.ts") } });
// The guests' page (D-064) is built apart, so that nothing of it changes how Home Assistant's
// pages load DomoTwin; the chunks both load on demand are the same files.
const guest = await build({
  ...options,
  entryPoints: { guest: join(here, "src/guest/entry.ts") },
  chunkNames: "chunks/guest/[name]-[hash]",
});

await copyFile(engine.path, join(out, engine.file));
await copyFile(planImport.path, join(out, planImport.file));
await copyFile(models.path, join(out, models.file));
await copyFile(planner.path, join(out, planner.file));
await copyFile(analysis.path, join(out, analysis.file));
await mkdir(join(out, "fonts"));
await copyFile(fontPath, join(out, fontFile));
await copyFile(resolve(here, "fonts/OFL.txt"), join(out, "fonts/OFL.txt"));
// The guests' page (D-064), served by the integration for every pass's link, outside Home
// Assistant's sign-in: it loads its module and nothing else (its policy is the integration's).
await writeFile(
  join(out, "guest.html"),
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="light dark" />
    <title>DomoTwin</title>
    <style>
      html, body { margin: 0; min-height: 100%; }
      body { background: #f4f5f7; }
      @media (prefers-color-scheme: dark) { body { background: #111; } }
    </style>
  </head>
  <body>
    <domotwin-guest></domotwin-guest>
    <script type="module" src="/domotwin_static/guest.js?v=${version}"></script>
  </body>
</html>
`,
);
await writeFile(
  join(out, "build.json"),
  JSON.stringify(
    {
      version,
      wasm: wasmFile,
      import: planImport.file,
      models: models.file,
      planner: planner.file,
      analysis: analysis.file,
      font: fontFile,
      outputs: Object.keys(result.metafile.outputs),
      guest: Object.keys(guest.metafile.outputs),
    },
    null,
    2,
  ),
);
console.log(`DomoTwin ${version} built into ${out}${dev ? " (dev)" : ""}`);
