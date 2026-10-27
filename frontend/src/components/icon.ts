import { html, nothing, svg, type TemplateResult } from "lit";

/** An icon from @mdi/js. Decorative unless a label is given. */
export function icon(path: string, label?: string, mirrored = false): TemplateResult {
  return html`<svg
    class="icon ${mirrored ? "mirrored" : ""}"
    viewBox="0 0 24 24"
    role=${label ? "img" : nothing}
    aria-label=${label ?? nothing}
    aria-hidden=${label ? "false" : "true"}
  >
    ${svg`<path d=${path}></path>`}
  </svg>`;
}

/**
 * An arrow that points back or on (a "back" button, a row that opens): drawn the other way round
 * when the language is written right to left (D-081).
 */
export function mirroredIcon(path: string): TemplateResult {
  return icon(path, undefined, true);
}
