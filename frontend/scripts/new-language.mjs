// Starts a language of DomoTwin's (D-082): `node scripts/new-language.mjs <code>` writes
// `src/i18n/lang/<code>.ts` and `src/i18n/lang/<code>/` from the English messages, every key in
// place, for a translator to translate the texts (never the keys, the `{placeholders}` or the
// plural forms' names).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = process.argv[2];
if (!code || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code)) {
  console.error(
    "usage: node scripts/new-language.mjs <code> (as Home Assistant names it: de, pt-BR, zh-Hans)",
  );
  process.exit(1);
}
const folder = join(root, "src", "i18n", "lang", code);
if (existsSync(folder)) {
  console.error(`${folder} is there already`);
  process.exit(1);
}

const entry = [
  `import { en } from "./src/i18n/en";`,
  `import { englishChunks } from "./src/i18n/english";`,
  `export const messages = { en, chunks: englishChunks };`,
].join("\n");
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const { messages } = module;

mkdirSync(folder, { recursive: true });
const json = (value) => JSON.stringify(value, null, 2);
writeFileSync(
  join(folder, "main.ts"),
  `import type { Dictionary } from "../../index";\n\n/** The main messages, in ${code}. */\nexport const main: Dictionary = ${json(messages.en)};\n`,
);
writeFileSync(
  join(folder, "chunks.ts"),
  `import type { Chunks } from "../../pack";\n\n/** The chunks' messages, in ${code}. */\nexport const chunks: Chunks = ${json(messages.chunks)};\n`,
);
// Its own module, named after it (`<code>-<hash>.js` once built).
writeFileSync(
  join(folder, "..", `${code}.ts`),
  `/** DomoTwin in ${code} (D-082), loaded when Home Assistant speaks it. */\nimport type { Pack } from "../pack";\nimport { chunks } from "./${code}/chunks";\nimport { main } from "./${code}/main";\n\nexport const pack: Pack = { main, chunks };\n`,
);
console.log(
  `Written ${folder}: translate main.ts and chunks.ts, then add "${code}" to LANGUAGES and LOADERS in src/i18n/index.ts and to LANGUAGES in custom_components/domotwin/language.py (CONTRIBUTING.md).`,
);
