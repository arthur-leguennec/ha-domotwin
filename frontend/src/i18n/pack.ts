/**
 * A language loaded on demand (D-081): its main messages and every chunk's, as the English has
 * them. TypeScript checks that each language gives every key; a text is any text.
 */
import type { configHistoryEn } from "./config-history";
import type { guestsEn } from "./guests";
import type { historyEn } from "./history";
import type { Dictionary, Widen } from "./index";
import type { iphoneEn } from "./iphone";
import type { libraryEn } from "./library";
import type { measuredEn } from "./measured";
import type { peakEn } from "./peak";
import type { placementEn } from "./placement";
import type { plainEn } from "./plain";
import type { practicalEn } from "./practical";
import type { radarsEn } from "./radars";
import type { rightsEn } from "./rights";
import type { safetyEn } from "./safety";
import type { sandboxEn } from "./sandbox";
import type { summaryEn } from "./summary";
import type { wallEn } from "./wall";
import type { whyEn } from "./why";
import type { wifiEn } from "./wifi";

/** Every chunk's messages, by chunk: what `addMessages` adds in English and French. */
export interface Chunks {
  configHistory: Widen<typeof configHistoryEn>;
  guests: Widen<typeof guestsEn>;
  history: Widen<typeof historyEn>;
  iphone: Widen<typeof iphoneEn>;
  library: Widen<typeof libraryEn>;
  measured: Widen<typeof measuredEn>;
  peak: Widen<typeof peakEn>;
  placement: Widen<typeof placementEn>;
  plain: Widen<typeof plainEn>;
  practical: Widen<typeof practicalEn>;
  radars: Widen<typeof radarsEn>;
  rights: Widen<typeof rightsEn>;
  safety: Widen<typeof safetyEn>;
  sandbox: Widen<typeof sandboxEn>;
  summary: Widen<typeof summaryEn>;
  wall: Widen<typeof wallEn>;
  why: Widen<typeof whyEn>;
  wifi: Widen<typeof wifiEn>;
}

/** A language's messages: the main dictionary and the chunks'. */
export interface Pack {
  main: Dictionary;
  chunks: Chunks;
}
