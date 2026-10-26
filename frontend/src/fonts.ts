/**
 * DomoTwin's own font: Inter, variable (every weight in one file of about 60 kB), served by the
 * integration like every other file, never from the internet (D-042). Shadow roots ignore
 * `@font-face`, so the face is added to the document once; the browser fetches the file only when
 * a text uses it, so a card set to another font never downloads it.
 */
import { assetUrl } from "./assets";

export const BUNDLED_FONT = "DomoTwin Inter";

export function declareBundledFont(): void {
  if (typeof FontFace !== "function" || typeof document === "undefined") return;
  for (const face of document.fonts) if (face.family.replace(/"/g, "") === BUNDLED_FONT) return;
  const url = assetUrl(__DOMOTWIN_FONT__).href;
  document.fonts.add(
    new FontFace(BUNDLED_FONT, `url("${url}") format("woff2")`, {
      weight: "100 900",
      style: "normal",
      display: "swap",
    }),
  );
}

/** The document's fonts, to know when one loads (not every test DOM has them). */
export function documentFonts(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}

/** The CSS font family of a card's `font_family`: `theme` is the Home Assistant theme's font. */
export function fontFamily(option: string): string {
  return option.toLowerCase() === "theme"
    ? "var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif))"
    : option;
}
