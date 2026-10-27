import { en } from "./en";
import { fr } from "./fr";
import type { configHistoryEn } from "./config-history";
import type { historyEn } from "./history";
import type { practicalEn } from "./practical";
import type { sandboxEn } from "./sandbox";

/** A plural message: Intl.PluralRules picks the form. */
export interface Plural {
  one: string;
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
 * D-059; the sandbox's, D-057).
 */
type AllMessages = typeof en &
  typeof practicalEn &
  typeof sandboxEn &
  typeof historyEn &
  typeof configHistoryEn;
/** Keys of plain messages, e.g. `view.loading`. */
export type MessageKey = Leaves<AllMessages, string>;
/** Keys of plural messages, e.g. `view.rooms`. */
export type PluralKey = Leaves<AllMessages, Plural>;

/** A kind of item of the plan format (`docs/plan-format.md`), as the catalogue names it. */
export type KindName = keyof (typeof en)["kinds"];

export type Language = "en" | "fr";

const dictionaries: Record<Language, Dictionary> = { en, fr };
/** The messages of chunks loaded since (the Home and Rooms tabs', D-055; the reports', D-058),
 * by language. */
const added: Record<Language, unknown[]> = { en: [], fr: [] };

/** Adds a chunk's messages, in every language. */
export function addMessages(messages: Record<Language, unknown>): void {
  for (const language of ["en", "fr"] as const) added[language].push(messages[language]);
}

/** A message of the language: its dictionary's, else a chunk's. */
function find(language: Language, key: string): unknown {
  let found = lookup(dictionaries[language], key);
  for (const part of added[language]) found ??= lookup(part, key);
  return found;
}

/** The supported language closest to Home Assistant's, English otherwise. */
export function pickLanguage(language: string | undefined): Language {
  const base = (language ?? "en").toLowerCase().split(/[-_]/)[0];
  return base === "fr" ? "fr" : "en";
}

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
    this.plurals = new Intl.PluralRules(this.language);
  }

  /** A plain message. */
  t(key: MessageKey, params: Record<string, string | number> = {}): string {
    const text = find(this.language, key) ?? find("en", key);
    return typeof text === "string" ? format(text, params) : key;
  }

  /** A plural message; `{count}` is the number. */
  tp(key: PluralKey, count: number, params: Record<string, string | number> = {}): string {
    const forms = find(this.language, key) as Plural | undefined;
    const form = forms?.[this.plurals.select(count) === "one" ? "one" : "other"];
    return form ? format(form, { ...params, count }) : key;
  }

  /** The name of a kind of item of the catalogue (`sofa`, `table-lamp`…), else the kind. */
  kind(kind: string): string {
    const text = lookup(dictionaries[this.language], `kinds.${kind}`);
    return typeof text === "string" ? text : kind;
  }

  /** An error code from the engine (`errors.plan.*`) or the websocket API (`errors.ws.*`). */
  error(code: string): string {
    for (const group of ["plan", "ws"]) {
      const text = lookup(dictionaries[this.language], `errors.${group}.${code}`);
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

/** The translator matching a `hass` object. */
export function translatorFor(
  hass: { language?: string; locale?: { language: string } } | undefined,
): Translator {
  return new Translator(hass?.locale?.language ?? hass?.language);
}

export { en, fr };
