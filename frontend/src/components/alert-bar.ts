/**
 * `<domotwin-alert-bar>`: the alerts of the 3D view on the other tabs (D-068), the rooms' of every
 * storey and Home Assistant's own, dangers first. A room's opens the 3D view on it, Home
 * Assistant's its Security page; past two, a button opens the Safety tab, which lists them all.
 */
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { StoreyInfo } from "../ha/client";
import type { Translator } from "../i18n";
import type { ShownAlert } from "../live/security";
import { alertButton, type AlertRoom } from "./alert-button";
import { define } from "./define";

/** Alerts listed in the bar; the others are on the Safety tab. */
const SHOWN = 2;

/** A room's alert asks the panel for its room in 3D (`domotwin-alert-room`, detail: the room). */
export function askRoom(host: HTMLElement): (room: AlertRoom) => void {
  return (detail) => {
    host.dispatchEvent(
      new CustomEvent("domotwin-alert-room", { detail, bubbles: true, composed: true }),
    );
  };
}

/** What the alerts' buttons look like, on the bar and the Safety tab. */
export const alertStyles = css`
  button.alert {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    max-width: 100%;
    padding: 6px 14px 6px 10px;
    border: none;
    border-radius: 20px;
    background: var(--warning-color, #ffa600);
    color: #1f2328;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  button.alert.danger {
    background: var(--error-color, #db4437);
    color: #fff;
  }
  button.alert:focus-visible {
    outline: 2px solid var(--primary-text-color, #1f2328);
    outline-offset: 2px;
  }
  button.alert svg.icon {
    flex: none;
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
`;

export class DomoTwinAlertBar extends LitElement {
  static override properties = {
    t: { attribute: false },
    alerts: { attribute: false },
    storeys: { attribute: false },
    page: { attribute: false },
  };

  t?: Translator;
  alerts: readonly ShownAlert[] = [];
  storeys: readonly StoreyInfo[] = [];
  /** Home Assistant's Security page, where it has one. */
  page?: string;

  static override styles = [
    alertStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: var(--card-background-color, #fff);
      }
      button.more {
        min-height: 40px;
        padding: 0 12px;
        border: none;
        border-radius: 20px;
        background: transparent;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ];

  protected override render(): TemplateResult | typeof nothing {
    const t = this.t;
    const alerts = this.alerts;
    if (!t || alerts.length === 0) return nothing;
    const more = alerts.length - SHOWN;
    return html`<div class="bar" role="alert" data-testid="alert-bar">
      ${alerts
        .slice(0, SHOWN)
        .map((alert) => alertButton(t, alert, this.storeys, this.page, askRoom(this), "alert"))}
      ${
        more > 0
          ? html`<button
              class="more"
              data-testid="alert-more"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("domotwin-go", {
                    detail: { tab: "safety" },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
            >
              ${t.tp("layers.more_alerts", more)}
            </button>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-alert-bar", DomoTwinAlertBar);
