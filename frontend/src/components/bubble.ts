/**
 * The bubble a tap leaves over a piece (`DECISIONS.md`, D-047): the piece's name, its device as it
 * is now with its main control (a lamp's switch and brightness, a TV's power, play and volume, a
 * blind's buttons) and a way to its whole sheet. Over a piece linked to nothing, an administrator
 * gets the devices of its room that fit it, each linked with one tap. Loaded with the sheets.
 */
import { mdiChevronRight, mdiClose, mdiLinkVariant } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { entityName } from "../live/bindings";
import { define, fire } from "./define";
import { entityRow, quickControls, rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** `<domotwin-bubble>`: a piece's quick controls, over it. */
export class DomoTwinBubble extends LitElement {
  static override properties = {
    hass: { attribute: false },
    heading: { attribute: false },
    entity: { attribute: false },
    suggestions: { attribute: false },
    linkable: { attribute: false },
    busy: { attribute: false },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    css`
      :host {
        display: block;
      }
      .bubble {
        position: relative;
        box-sizing: border-box;
        width: min(300px, calc(100vw - 24px));
        padding: 10px 12px 8px;
        border-radius: 16px;
        display: grid;
        gap: 4px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      header button {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      header button svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      p {
        margin: 2px 0 4px;
        color: var(--secondary-text-color, #5f6368);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .chips button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 18px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .chips svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
      .buttons.quick {
        display: flex;
        justify-content: center;
        gap: 8px;
      }
    `,
  ];

  hass?: HomeAssistant;
  /** The piece's name. */
  heading = "";
  /** The device it is linked to (its main one); none: a piece linked to nothing. */
  entity?: string;
  /** A piece linked to nothing: the devices of its room that fit it (administrators only). */
  suggestions: string[] = [];
  /** A link editor is at hand (the panel): "Link…" opens it on this piece. */
  linkable = false;
  /** A link being saved. */
  busy = false;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    const entity = this.entity;
    return html`<div class="bubble glass" role="group" aria-label=${this.heading}>
      <header>
        <h2>${this.heading}</h2>
        ${
          entity
            ? html`<button
                data-testid="bubble-more"
                aria-label=${t.t("bubble.more")}
                title=${t.t("bubble.more")}
                @click=${() => {
                  fire(this, "domotwin-bubble-more", undefined);
                }}
              >
                ${icon(mdiChevronRight)}
              </button>`
            : nothing
        }
        <button
          aria-label=${t.t("panel.dismiss")}
          title=${t.t("panel.dismiss")}
          @click=${() => {
            fire(this, "domotwin-close", undefined);
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${entity ? html`${entityRow(hass, t, entity, false)}${quickControls(hass, t, entity)}` : this.renderLink(hass, t)}
    </div>`;
  }

  private renderLink(hass: HomeAssistant, t: Translator): TemplateResult {
    return html`<p>${t.t("bubble.unlinked")}</p>
      <div class="chips" data-testid="bubble-suggestions">
        ${this.suggestions.map(
          (id) =>
            html`<button
              data-entity=${id}
              ?disabled=${this.busy}
              aria-label=${t.t("bubble.link_to", { name: entityName(hass, id) })}
              @click=${() => {
                fire(this, "domotwin-bubble-link", { entity: id });
              }}
            >
              ${icon(mdiLinkVariant)}${entityName(hass, id)}
            </button>`,
        )}
        ${
          this.linkable
            ? html`<button
                data-testid="bubble-link-more"
                ?disabled=${this.busy}
                @click=${() => {
                  fire(this, "domotwin-bubble-link-more", undefined);
                }}
              >
                ${t.t("bubble.link_more")}
              </button>`
            : nothing
        }
      </div>`;
  }
}

define("domotwin-bubble", DomoTwinBubble);
