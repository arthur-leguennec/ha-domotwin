/**
 * `<domotwin-doorbell>`: a doorbell rang (D-066), full screen over every tab of the panel: who
 * rang and when, its camera live, the lock of its door with its buttons, and a way to close it.
 * Home Assistant's own cards; a chunk loaded the first time a doorbell rings.
 */
import { mdiBellRing, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { cameraCard, lockTile } from "../ha/cards";
import { nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { safetyEn, safetyFr } from "../i18n/safety";
import { entityName } from "../live/bindings";
import type { Ring } from "../live/doorbell";
import { NOTHING_UNSEEN, type Unseen } from "../live/privacy";
import { doorbellOf, type Doorbell } from "../live/safety";
import { timeStyle, whenText } from "../live/schedules";
import { define } from "./define";
import "./ha-card";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: safetyEn, fr: safetyFr });

export class DomoTwinDoorbell extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    ring: { attribute: false },
    unseen: { attribute: false },
  };

  hass?: HomeAssistant;
  t?: Translator;
  ring?: Ring;
  /** What the viewer may not see (D-039): a camera or a lock in a private room is not shown. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The doorbell's camera and lock, found again only when the registries or the ring change. */
  private doorbell?: Doorbell;
  private foundFrom?: unknown[];

  static override styles = [
    baseStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.72);
      }
      .doorbell {
        box-sizing: border-box;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: 12px;
        width: min(1080px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        padding: 16px;
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
      }
      .doorbell:focus {
        outline: none;
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      header > svg.icon {
        width: 32px;
        height: 32px;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      .words {
        flex: 1;
        display: grid;
        min-width: 0;
      }
      h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
      }
      .when {
        color: var(--secondary-text-color, #5f6368);
      }
      button.close {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      button.close:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      button.close svg.icon {
        width: 28px;
        height: 28px;
      }
      .camera {
        min-height: 0;
        overflow: auto;
      }
      .none {
        display: grid;
        place-items: center;
        min-height: 160px;
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 8px;
      }
      .footer domotwin-ha-card {
        flex: 1 1 260px;
      }
      .footer button.action {
        min-height: 48px;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues): void {
    const { hass, ring } = this;
    if (!hass || !ring || !(changed.has("hass") || changed.has("ring") || changed.has("unseen"))) {
      return;
    }
    const from = [ring, hass.entities, hass.devices, this.unseen];
    if (this.foundFrom && from.every((value, i) => value === this.foundFrom?.[i])) return;
    this.foundFrom = from;
    this.doorbell = doorbellOf(hass, ring.entity, this.unseen);
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent("domotwin-close", { bubbles: true, composed: true }));
  };

  protected override render(): TemplateResult | typeof nothing {
    const { hass, t, ring, doorbell } = this;
    if (!hass || !t || !ring || !doorbell) return nothing;
    const when = whenText(new Date(ring.at), new Date(nowOf(hass)), timeStyle(hass));
    return html`<div
      class="doorbell"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="doorbell-title"
      aria-describedby="doorbell-when"
      data-testid="doorbell"
      data-entity=${ring.entity}
    >
      <header>
        ${icon(mdiBellRing)}
        <div class="words">
          <h2 id="doorbell-title">${t.t("doorbell.title")}</h2>
          <span class="when" id="doorbell-when"
            >${t.t("doorbell.rang", { name: entityName(hass, ring.entity), when })}</span
          >
        </div>
        <button
          class="close"
          data-cancel
          data-testid="doorbell-close"
          aria-label=${t.t("doorbell.close")}
          title=${t.t("doorbell.close")}
          @click=${this.close}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <div class="camera">
        ${
          doorbell.camera
            ? html`<domotwin-ha-card
                data-testid="doorbell-camera"
                .hass=${hass}
                .t=${t}
                .config=${cameraCard(doorbell.camera, true)}
              ></domotwin-ha-card>`
            : html`<p class="none">${t.t("doorbell.no_camera")}</p>`
        }
      </div>
      <div class="footer">
        ${
          doorbell.lock
            ? html`<domotwin-ha-card
                data-testid="doorbell-lock"
                .hass=${hass}
                .t=${t}
                .config=${lockTile(doorbell.lock)}
              ></domotwin-ha-card>`
            : nothing
        }
        <button class="action" @click=${this.close}>${t.t("doorbell.close")}</button>
      </div>
    </div>`;
  }
}

define("domotwin-doorbell", DomoTwinDoorbell);
