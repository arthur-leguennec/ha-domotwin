/**
 * Every chunk's messages in English, by chunk (D-082): the one list a language's pack follows
 * (`pack.ts`), the tests check it against, and `scripts/new-language.mjs` starts it from. Not
 * imported by the app (each chunk adds its own when it loads), only its type.
 */
import { configHistoryEn } from "./config-history";
import { firstEn } from "./first";
import { guestsEn } from "./guests";
import { guideEn } from "./guide";
import { historyEn } from "./history";
import { iphoneEn } from "./iphone";
import { libraryEn } from "./library";
import { measuredEn } from "./measured";
import { peakEn } from "./peak";
import { placementEn } from "./placement";
import { plainEn } from "./plain";
import { practicalEn } from "./practical";
import { radarsEn } from "./radars";
import { reportEn } from "./report";
import { rightsEn } from "./rights";
import { safetyEn } from "./safety";
import { sandboxEn } from "./sandbox";
import { shortcutsEn } from "./shortcuts";
import { summaryEn } from "./summary";
import { wallEn } from "./wall";
import { whyEn } from "./why";
import { wifiEn } from "./wifi";

export const englishChunks = {
  configHistory: configHistoryEn,
  first: firstEn,
  guests: guestsEn,
  guide: guideEn,
  history: historyEn,
  iphone: iphoneEn,
  library: libraryEn,
  measured: measuredEn,
  peak: peakEn,
  placement: placementEn,
  plain: plainEn,
  practical: practicalEn,
  radars: radarsEn,
  report: reportEn,
  rights: rightsEn,
  safety: safetyEn,
  sandbox: sandboxEn,
  shortcuts: shortcutsEn,
  summary: summaryEn,
  wall: wallEn,
  why: whyEn,
  wifi: wifiEn,
};
