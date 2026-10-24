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

/** How long ago `seconds` were, in words of `language` ("40 seconds ago", "il y a 3 heures"). */
export function timeAgo(language: string, seconds: number): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (seconds < 90) return format.format(-Math.round(seconds), "second");
  if (seconds < 5_400) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 129_600) return format.format(-Math.round(seconds / 3_600), "hour");
  return format.format(-Math.round(seconds / 86_400), "day");
}
