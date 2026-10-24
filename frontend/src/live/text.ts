/** Text without accents, in lower case: `Entrée` → `entree`. */
export function unaccented(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The words of a name, to compare names: without accents, in lower case, without punctuation
 * (`L'Entrée !` → `l entree`). Letters of every script are kept. */
export function nameWords(text: string): string {
  return unaccented(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
