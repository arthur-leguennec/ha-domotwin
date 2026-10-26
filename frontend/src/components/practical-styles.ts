/** What the Home and Rooms tabs share (D-055): their page, their grids of cards, the star. */
import { mdiStar, mdiStarOutline } from "@mdi/js";
import { css, html, type TemplateResult } from "lit";

import type { Translator } from "../i18n";
import { icon } from "./icon";

export const practicalStyles = css`
  :host {
    display: block;
    overflow-y: auto;
    background: var(--primary-background-color, #fafafa);
    color: var(--primary-text-color, #1f2328);
  }
  .page {
    box-sizing: border-box;
    display: grid;
    gap: 20px;
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
    font-weight: 600;
  }
  .tiles,
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }
  .entity {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
  }
  .entity domotwin-ha-card {
    flex: 1;
  }
  button.star {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--secondary-text-color, #5f6368);
    cursor: pointer;
  }
  button.star[aria-pressed="true"] {
    color: var(--domotwin-accent, var(--primary-color, #03a9f4));
  }
  button.star:focus-visible {
    outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
    outline-offset: -2px;
  }
  button.star svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
  .muted {
    color: var(--secondary-text-color, #5f6368);
  }
  .error {
    margin: 8px 0 0;
    color: var(--error-color, #db4437);
  }
`;

/** The star of an entity: asks for it to be a favourite, or no longer. */
export function starButton(
  host: HTMLElement,
  t: Translator,
  name: string,
  entity: string,
  starred: boolean,
): TemplateResult {
  const label = t.t(starred ? "rooms.unstar" : "rooms.star", { name });
  return html`<button
    class="star"
    data-testid="star"
    aria-pressed=${starred ? "true" : "false"}
    aria-label=${label}
    title=${label}
    @click=${() => {
      host.dispatchEvent(
        new CustomEvent("domotwin-favourite", {
          detail: { entity, favourite: !starred },
          bubbles: true,
          composed: true,
        }),
      );
    }}
  >
    ${icon(starred ? mdiStar : mdiStarOutline)}
  </button>`;
}
