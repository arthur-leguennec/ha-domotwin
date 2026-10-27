/** A QR code drawn in the page (D-060, D-067): dark squares on white, a quiet border around. */
import { html, svg, type TemplateResult } from "lit";

import type { QrCode } from "../analysis/analysis";

/** The modules of quiet border a reader needs around a QR code. */
const QUIET = 4;

/** The code as an SVG, read out as `label`, found by the tests as `testId`. */
export function qrSvg(code: QrCode, label: string, testId: string): TemplateResult {
  const side = code.size + 2 * QUIET;
  let path = "";
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.dark(x, y)) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }
  }
  return html`${svg`<svg
    viewBox="0 0 ${side} ${side}"
    shape-rendering="crispEdges"
    role="img"
    aria-label=${label}
    data-testid=${testId}
  ><rect width=${side} height=${side} fill="#fff"></rect><path d=${path} fill="#000"></path></svg>`}`;
}
