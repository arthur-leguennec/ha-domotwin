/**
 * The base of the panels that open over the scene (controls, room panel, link editor): a card at
 * the bottom of the view, a title with a close button, closed by Escape too.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { fieldKeepsEscape } from "./dialog";
import { fire } from "./define";
import { icon } from "./icon";

export const sheetStyles = css`
  :host {
    position: absolute;
    inset-inline-start: 12px;
    inset-inline-end: 12px;
    bottom: 12px;
    max-height: calc(100% - 24px);
    display: block;
    z-index: 2;
  }
  @media (min-width: 640px) {
    :host {
      inset-inline-start: auto;
      width: 360px;
    }
  }
  .sheet {
    max-height: inherit;
    overflow: auto;
    padding: 8px 16px 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }
  h3 {
    margin: 12px 0 0;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--secondary-text-color, #5f6368);
  }
  header button {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  p.empty {
    color: var(--secondary-text-color, #5f6368);
    margin: 8px 0;
  }
  .footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 8px;
  }
`;

export abstract class Sheet extends LitElement {
  static override properties = {
    hass: { attribute: false },
    heading: { attribute: false },
  };

  hass?: HomeAssistant;
  heading = "";

  protected get t(): Translator {
    return translatorFor(this.hass);
  }

  protected close(): void {
    fire(this, "domotwin-close", {});
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !fieldKeepsEscape(event)) this.close();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
  }

  protected frame(
    body: TemplateResult,
    footer: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    return html`<div class="sheet glass" role="dialog" tabindex="-1" aria-label=${this.heading}>
      <header>
        <h2>${this.heading}</h2>
        <button
          data-cancel
          aria-label=${this.t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${body} ${footer}
    </div>`;
  }
}
