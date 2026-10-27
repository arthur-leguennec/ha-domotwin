// The demo house's texts by their English (D-050, D-081): every `[English, French]` pair of
// `src/demo/` and every English name of its plans' pieces (`FRENCH` in `src/demo/house.ts`), which
// each language's pack translates in `src/i18n/lang/<code>/demo.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A pair's English is a text (a capital, a space or a placeholder in it), not an id. */
const TEXT = /[A-Z{ ]/;

/** The English texts of the demo house, sorted. */
export function demoTexts(frontend) {
  const folder = join(frontend, "src", "demo");
  const texts = new Set();
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(folder, file), "utf8");
    for (const [, english] of source.matchAll(
      /\[\s*"((?:[^"\\]|\\.)*)",\s*"(?:[^"\\]|\\.)*",?\s*\]/g,
    )) {
      if (TEXT.test(english)) texts.add(JSON.parse(`"${english}"`));
    }
    const french = /const FRENCH[^{]*\{([\s\S]*?)\n\};/.exec(source);
    if (!french) continue;
    for (const [, quoted, bare] of french[1].matchAll(
      /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z]+)):\s*"/gm,
    )) {
      texts.add(quoted === undefined ? bare : JSON.parse(`"${quoted}"`));
    }
  }
  return [...texts].sort();
}
