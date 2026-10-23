import { html, nothing, svg, type TemplateResult } from "lit";

/** An icon from @mdi/js. Decorative unless a label is given. */
export function icon(path: string, label?: string): TemplateResult {
  return html`<svg
    class="icon"
    viewBox="0 0 24 24"
    role=${label ? "img" : nothing}
    aria-label=${label ?? nothing}
    aria-hidden=${label ? "false" : "true"}
  >
    ${svg`<path d=${path}></path>`}
  </svg>`;
}
