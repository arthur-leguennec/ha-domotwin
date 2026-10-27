/**
 * A language loaded on demand (D-081): its main messages and every chunk's, as the English has
 * them. TypeScript checks that each language gives every key; a text is any text.
 */
import type { englishChunks } from "./english";
import type { Dictionary, Widen } from "./index";

/** Every chunk's messages, by chunk: what `addMessages` adds in English and French. */
export type Chunks = { [K in keyof typeof englishChunks]: Widen<(typeof englishChunks)[K]> };

/**
 * A language's messages: the main dictionary, the chunks', and the demo house's names and words
 * by their English (`scripts/demo-texts.mjs` lists them).
 */
export interface Pack {
  main: Dictionary;
  chunks: Chunks;
  demo: Readonly<Record<string, string>>;
}
