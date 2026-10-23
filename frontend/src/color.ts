/** An sRGB colour, 0–255 per channel. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i;

function clamp(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `rgba()`; other syntaxes return undefined. */
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim();
  const hex = HEX.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = RGB.exec(text);
  if (rgb) return { r: clamp(Number(rgb[1])), g: clamp(Number(rgb[2])), b: clamp(Number(rgb[3])) };
  return undefined;
}

/**
 * The resolved background colour behind an element: the theme's card background, read through the
 * browser so that any CSS colour syntax works.
 */
export function themeBackground(element: HTMLElement, fallback: Rgb): Rgb {
  const style = getComputedStyle(element);
  for (const name of [
    "--card-background-color",
    "--ha-card-background",
    "--primary-background-color",
  ]) {
    const value = style.getPropertyValue(name).trim();
    if (!value) continue;
    const parsed = parseColor(value) ?? resolveWithCanvas(value);
    if (parsed) return parsed;
  }
  return fallback;
}

function resolveWithCanvas(value: string): Rgb | undefined {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#000001";
  context.fillStyle = value;
  return context.fillStyle === "#000001" ? undefined : parseColor(context.fillStyle);
}
