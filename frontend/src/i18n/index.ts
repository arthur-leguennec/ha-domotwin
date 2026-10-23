import { en } from "./en";
import { fr } from "./fr";

/** A plural message: Intl.PluralRules picks the form. */
export interface Plural {
  one: string;
  other: string;
}

type Widen<T> = T extends string
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

/** Keys of plain messages, e.g. `view.loading`. */
export type MessageKey = Leaves<typeof en, string>;
/** Keys of plural messages, e.g. `view.rooms`. */
export type PluralKey = Leaves<typeof en, Plural>;

export type Language = "en" | "fr";

const dictionaries: Record<Language, Dictionary> = { en, fr };

/** The supported language closest to Home Assistant's, English otherwise. */
export function pickLanguage(language: string | undefined): Language {
  const base = (language ?? "en").toLowerCase().split(/[-_]/)[0];
  return base === "fr" ? "fr" : "en";
}

function lookup(dictionary: Dictionary, key: string): unknown {
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
    const text = lookup(dictionaries[this.language], key) ?? lookup(en, key);
    return typeof text === "string" ? format(text, params) : key;
  }

  /** A plural message; `{count}` is the number. */
  tp(key: PluralKey, count: number, params: Record<string, string | number> = {}): string {
    const forms = lookup(dictionaries[this.language], key) as Plural | undefined;
    const form = forms?.[this.plurals.select(count) === "one" ? "one" : "other"];
    return form ? format(form, { ...params, count }) : key;
  }

  /** An error code from the engine (`errors.plan.*`) or the websocket API (`errors.ws.*`). */
  error(code: string): string {
    for (const group of ["plan", "ws"]) {
      const text = lookup(dictionaries[this.language], `errors.${group}.${code}`);
      if (typeof text === "string") return text;
    }
    return this.t("errors.unknown", { code });
  }
}

/** The translator matching a `hass` object. */
export function translatorFor(
  hass: { language?: string; locale?: { language: string } } | undefined,
): Translator {
  return new Translator(hass?.locale?.language ?? hass?.language);
}

export { en, fr };
