import { en } from "./en";
import { fr } from "./fr";
import type { configHistoryEn } from "./config-history";
import type { guestsEn } from "./guests";
import type { historyEn } from "./history";
import type { iphoneEn } from "./iphone";
import type { libraryEn } from "./library";
import type { measuredEn } from "./measured";
import type { peakEn } from "./peak";
import type { plainEn } from "./plain";
import type { placementEn } from "./placement";
import type { practicalEn } from "./practical";
import type { reportEn } from "./report";
import type { firstEn } from "./first";
import type { safetyEn } from "./safety";
import type { rightsEn } from "./rights";
import type { sandboxEn } from "./sandbox";
import type { summaryEn } from "./summary";
import type { wallEn } from "./wall";
import type { whyEn } from "./why";
import type { wifiEn } from "./wifi";
import type { radarsEn } from "./radars";
import type { shortcutsEn } from "./shortcuts";
import type { Pack } from "./pack";

/**
 * A plural message: Intl.PluralRules picks the form, `other` when the language has no such form
 * (Arabic has six, Japanese one).
 */
export interface Plural {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Widen<T> = T extends string
  ? string
  : T extends Plural
    ? Plural
    : { [K in keyof T]: Widen<T[K]> };

/** The shape every language must provide: the English keys, any text. */
export type Dictionary = Widen<typeof en>;

type Leaves<T, Leaf, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf
    ? `${Prefix}${K}`
    : T[K] extends string | Plural
      ? never
      : Leaves<T[K], Leaf, `${Prefix}${K}.`>;
}[keyof T & string];

/**
 * Every message: the dictionaries', and those added by a chunk when it loads (D-055, D-058,
 * D-059, D-060, D-061, D-062, D-063, D-066, D-067, D-068, D-070, D-071, D-073, D-074, D-075,
 * D-076, D-081, D-083; the sandbox's, D-057).
 */
type AllMessages = typeof en &
  typeof practicalEn &
  typeof sandboxEn &
  typeof historyEn &
  typeof whyEn &
  typeof wifiEn &
  typeof summaryEn &
  typeof configHistoryEn &
  typeof peakEn &
  typeof plainEn &
  typeof placementEn &
  typeof guestsEn &
  typeof reportEn &
  typeof firstEn &
  typeof safetyEn &
  typeof rightsEn &
  typeof measuredEn &
  typeof libraryEn &
  typeof iphoneEn &
  typeof radarsEn &
  typeof shortcutsEn &
  typeof wallEn;
/** Keys of plain messages, e.g. `view.loading`. */
export type MessageKey = Leaves<AllMessages, string>;
/** Keys of plural messages, e.g. `view.rooms`. */
export type PluralKey = Leaves<AllMessages, Plural>;

/** A kind of item of the plan format (`docs/plan-format.md`), as the catalogue names it. */
export type KindName = keyof (typeof en)["kinds"];

/**
 * The languages DomoTwin speaks (D-082), as Home Assistant names them: English and French with
 * the first picture, the others loaded when Home Assistant speaks them.
 */
export const LANGUAGES = [
  "en",
  "fr",
  "de",
  "es",
  "it",
  "nl",
  "pt",
  "pt-BR",
  "ar",
  "zh-Hans",
  "ja",
  "ko",
] as const;
export type Language = (typeof LANGUAGES)[number];
/** The languages loaded on demand. */
type Loaded = Exclude<Language, "en" | "fr">;

const dictionaries: Record<"en" | "fr", Dictionary> = { en, fr };
/**
 * The messages of chunks loaded since (the Home and Rooms tabs', D-055; the reports', D-058; the
 * Wi-Fi's, D-060; the summaries', D-061), in English and French; the other languages have theirs
 * in their pack.
 */
const added: Record<"en" | "fr", unknown[]> = { en: [], fr: [] };

/** Each language loaded on demand: its own module, and its messages once loaded. */
const LOADERS: Record<Loaded, () => Promise<{ pack: Pack }>> = {
  de: () => import("./lang/de"),
  es: () => import("./lang/es"),
  it: () => import("./lang/it"),
  nl: () => import("./lang/nl"),
  pt: () => import("./lang/pt"),
  "pt-BR": () => import("./lang/pt-BR"),
  ar: () => import("./lang/ar"),
  "zh-Hans": () => import("./lang/zh-Hans"),
  ja: () => import("./lang/ja"),
  ko: () => import("./lang/ko"),
};
const packs: Partial<Record<Loaded, Pack>> = {};
/** Each loaded language's chunks' messages, looked in after its main ones. */
const parts: Partial<Record<Loaded, unknown[]>> = {};
const loading = new Map<Loaded, Promise<void>>();
/** Languages whose module did not load: spoken in English until the page is loaded again. */
const failed = new Set<Loaded>();

/** Adds a chunk's messages, in English and French. */
export function addMessages(messages: Record<"en" | "fr", unknown>): void {
  for (const language of ["en", "fr"] as const) added[language].push(messages[language]);
}

function bundled(language: Language): language is "en" | "fr" {
  return language === "en" || language === "fr";
}

/**
 * Whether a language can be spoken now: English and French always, the others once loaded (or in
 * English once they could not be).
 */
export function languageReady(language: Language): boolean {
  return bundled(language) || packs[language] !== undefined || failed.has(language);
}

/**
 * Loads a language's messages; resolves once they are here (at once for English and French). One
 * that fails to load is spoken in English, not asked for again and again.
 */
export function loadLanguage(language: Language): Promise<void> {
  if (bundled(language) || packs[language] || failed.has(language)) return Promise.resolve();
  let pending = loading.get(language);
  if (!pending) {
    pending = LOADERS[language]()
      .then((module) => {
        packs[language] = module.pack;
        parts[language] = Object.values(module.pack.chunks);
      })
      .catch(() => {
        failed.add(language);
      })
      .finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** The main messages of a language, English while they are not here. */
function mainOf(language: Language): Dictionary {
  if (bundled(language)) return dictionaries[language];
  return packs[language]?.main ?? en;
}

/** A message of the language: its dictionary's, else a chunk's. */
function find(language: Language, key: string): unknown {
  if (bundled(language)) {
    let found = lookup(dictionaries[language], key);
    for (const part of added[language]) found ??= lookup(part, key);
    return found;
  }
  const pack = packs[language];
  if (!pack) return undefined;
  let found = lookup(pack.main, key);
  for (const part of parts[language] ?? []) found ??= lookup(part, key);
  return found;
}

/**
 * The language DomoTwin speaks for Home Assistant's: the same, else the same without its region
 * (Portuguese is Portugal's, Brazil's has its own; every Chinese is simplified), English otherwise.
 */
export function pickLanguage(language: string | undefined): Language {
  const code = (language ?? "en").toLowerCase().replaceAll("_", "-");
  const same = LANGUAGES.find((known) => known.toLowerCase() === code);
  if (same) return same;
  if (code.startsWith("zh")) return "zh-Hans";
  const base = code.split("-")[0] ?? "en";
  return LANGUAGES.find((known) => known === base) ?? "en";
}

/** A text of the demo house (D-050) by its English, in a language loaded on demand. */
export function demoWord(language: Language, english: string): string | undefined {
  return bundled(language) ? undefined : packs[language]?.demo[english];
}

/** Which way a language is written. */
export function directionOf(language: Language): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}

/** Which way DomoTwin writes in a language: as it is written, left to right once in English. */
function writtenAs(language: Language): "ltr" | "rtl" {
  return !bundled(language) && failed.has(language) ? "ltr" : directionOf(language);
}

/** How English counts, for a message not yet in its language. */
const ENGLISH_PLURALS = new Intl.PluralRules("en");

function lookup(dictionary: unknown, key: string): unknown {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function format(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translates the messages of one language. */
export class Translator {
  readonly language: Language;
  private readonly plurals: Intl.PluralRules;

  constructor(language: string | undefined) {
    this.language = pickLanguage(language);
    // Portugal counts zero with the plural (`other`), Brazil (Intl's `pt`) as one.
    this.plurals = new Intl.PluralRules(this.language === "pt" ? "pt-PT" : this.language);
  }

  /** A plain message. */
  t(key: MessageKey, params: Record<string, string | number> = {}): string {
    const text = find(this.language, key) ?? find("en", key);
    return typeof text === "string" ? format(text, params) : key;
  }

  /** A state's word (`locked`, `not_home`…) where DomoTwin has one, in the language or English. */
  state(state: string): string | undefined {
    const text = find(this.language, `states.${state}`) ?? find("en", `states.${state}`);
    return typeof text === "string" ? text : undefined;
  }

  /** Which way it is written: `rtl` for Arabic (unless it could not be loaded). */
  get dir(): "ltr" | "rtl" {
    return writtenAs(this.language);
  }

  /** A plural message; `{count}` is the number. */
  tp(key: PluralKey, count: number, params: Record<string, string | number> = {}): string {
    const own = find(this.language, key) as Plural | undefined;
    // In English while the language is not here, as English counts.
    const [forms, rules] = own
      ? [own, this.plurals]
      : [find("en", key) as Plural | undefined, null];
    const category = (rules ?? ENGLISH_PLURALS).select(count);
    const form = forms?.[category] ?? forms?.other;
    return form ? format(form, { ...params, count }) : key;
  }

  /** The name of a kind of item of the catalogue (`sofa`, `table-lamp`…), else the kind. */
  kind(kind: string): string {
    const text = lookup(mainOf(this.language), `kinds.${kind}`);
    return typeof text === "string" ? text : kind;
  }

  /** An error code from the engine (`errors.plan.*`) or the websocket API (`errors.ws.*`). */
  error(code: string): string {
    for (const group of ["plan", "ws"]) {
      const text = lookup(mainOf(this.language), `errors.${group}.${code}`);
      if (typeof text === "string") return text;
    }
    return this.t("errors.unknown", { code });
  }

  /** An error code, naming the plan element at fault when there is one. */
  errorAt(code: string, element?: string): string {
    const reason = this.error(code);
    return element ? this.t("errors.at_element", { reason, element }) : reason;
  }
}

/** What of a `hass` object says its language. */
export interface Speaking {
  language?: string;
  locale?: { language: string };
}

/** The language DomoTwin speaks for a `hass` object. */
export function languageOf(hass: Speaking | undefined): Language {
  return pickLanguage(hass?.locale?.language ?? hass?.language);
}

/** The translator matching a `hass` object. */
export function translatorFor(hass: Speaking | undefined): Translator {
  return new Translator(languageOf(hass));
}

/** Which way DomoTwin writes for a `hass` object: Arabic right to left once it is here. */
export function directionFor(hass: Speaking | undefined): "ltr" | "rtl" {
  return writtenAs(languageOf(hass));
}

export { en, fr };
