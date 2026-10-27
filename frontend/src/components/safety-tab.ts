/**
 * `<domotwin-safety>`, the Safety tab (D-068): every alert, the alarm, the doorbells, the cameras
 * side by side (the doorbells' first) and, where Home Assistant has no Security page, the locks;
 * where it has one, a way to it for the rest. Every control is Home Assistant's own card.
 */
import { mdiBellRingOutline, mdiShieldCheckOutline, mdiShieldHomeOutline } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { alarmCard, cameraCard, lockTile, type CardConfig } from "../ha/cards";
import type { StoreyInfo } from "../ha/client";
import { nowOf, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { navigate } from "../live/actions";
import { entityName } from "../live/bindings";
import { NOTHING_UNSEEN, type Unseen } from "../live/privacy";
import { safetyOf, type SafetyHome } from "../live/safety";
import { timeStyle, whenText } from "../live/schedules";
import type { ShownAlert } from "../live/security";
import { alertStyles, askRoom } from "./alert-bar";
import { alertButton } from "./alert-button";
import { define } from "./define";
import "./ha-card";
import { icon } from "./icon";
import { practicalStyles } from "./practical-styles";
import { baseStyles } from "./styles";

export class DomoTwinSafety extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    alerts: { attribute: false },
    storeys: { attribute: false },
    unseen: { attribute: false },
    page: { attribute: false },
  };

  hass?: HomeAssistant;
  t?: Translator;
  /** The rooms' alerts and Home Assistant's, dangers first. */
  alerts: readonly ShownAlert[] = [];
  storeys: readonly StoreyInfo[] = [];
  /** What the viewer may not see (D-039): a camera in a private room is not shown. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** Home Assistant's Security page, where it has one. */
  page?: string;
  private safety?: SafetyHome;
  /** What the home's devices were read from, to read them again only when it changes. */
  private readFrom?: unknown[];

  static override styles = [
    baseStyles,
    practicalStyles,
    alertStyles,
    css`
      .alerts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .calm {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
      }
      .cameras {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
        gap: 12px;
      }
      figure {
        display: grid;
        gap: 4px;
        margin: 0;
        min-width: 0;
      }
      figcaption,
      .doorbell {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.875rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .doorbells {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .doorbell .name {
        font-weight: 600;
        color: var(--primary-text-color, #1f2328);
      }
      .security {
        display: grid;
        justify-items: start;
        gap: 6px;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues): void {
    const hass = this.hass;
    if (!hass || !(changed.has("hass") || changed.has("unseen") || changed.has("t"))) return;
    const from = [hass.states, hass.entities, hass.devices, this.unseen, this.t?.language];
    if (this.readFrom && from.every((value, i) => value === this.readFrom?.[i])) return;
    this.readFrom = from;
    this.safety = safetyOf(hass, this.unseen, this.t?.language);
  }

  /** When a doorbell rang last, in words. */
  private rang(at: number | undefined): string {
    const { hass, t } = this;
    if (!hass || !t) return "";
    if (at === undefined) return t.t("safety.not_rung");
    return t.t("safety.rang", {
      when: whenText(new Date(at), new Date(nowOf(hass)), timeStyle(hass)),
    });
  }

  private cards(ids: readonly string[], card: (id: string) => CardConfig): TemplateResult {
    const { hass, t } = this;
    return html`<div class="cards">
      ${ids.map(
        (id) =>
          html`<domotwin-ha-card
            data-entity=${id}
            .hass=${hass}
            .t=${t}
            .config=${card(id)}
          ></domotwin-ha-card>`,
      )}
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const { hass, t, safety } = this;
    if (!hass || !t || !safety) return nothing;
    const { alarms, doorbells, cameras, locks } = safety;
    const ringing = new Map(doorbells.flatMap((d) => (d.camera ? [[d.camera, d] as const] : [])));
    const empty = alarms.length === 0 && doorbells.length === 0 && cameras.length === 0;
    return html`<div class="page" data-testid="safety-tab">
      <section aria-label=${t.t("safety.alerts")} data-testid="safety-alerts">
        <h2>${t.t("safety.alerts")}</h2>
        ${
          this.alerts.length > 0
            ? html`<div class="alerts" role="list">
                ${this.alerts.map(
                  (alert) =>
                    html`<div role="listitem">
                      ${alertButton(t, alert, this.storeys, this.page, askRoom(this), "alert")}
                    </div>`,
                )}
              </div>`
            : html`<p class="calm">${icon(mdiShieldCheckOutline)}${t.t("safety.no_alert")}</p>`
        }
      </section>
      ${
        alarms.length > 0
          ? html`<section data-testid="safety-alarms">
              <h2>${t.t("safety.alarm")}</h2>
              ${this.cards(alarms, alarmCard)}
            </section>`
          : nothing
      }
      ${
        doorbells.length > 0
          ? html`<section data-testid="safety-doorbells">
              <h2>${t.t("safety.doorbells")}</h2>
              <ul class="doorbells">
                ${doorbells.map(
                  (doorbell) =>
                    html`<li class="doorbell" data-entity=${doorbell.entity}>
                      ${icon(mdiBellRingOutline)}
                      <span class="name">${entityName(hass, doorbell.entity)}</span>
                      <span>${this.rang(doorbell.rang)}</span>
                    </li>`,
                )}
              </ul>
            </section>`
          : nothing
      }
      ${
        cameras.length > 0
          ? html`<section data-testid="safety-cameras">
              <h2>${t.t("safety.cameras")}</h2>
              <div class="cameras">
                ${cameras.map((id) => {
                  const doorbell = ringing.get(id);
                  return html`<figure data-entity=${id}>
                    ${
                      doorbell
                        ? html`<figcaption>
                            ${icon(mdiBellRingOutline)}${entityName(hass, doorbell.entity)} ·
                            ${this.rang(doorbell.rang)}
                          </figcaption>`
                        : nothing
                    }
                    <domotwin-ha-card
                      .hass=${hass}
                      .t=${t}
                      .config=${cameraCard(id)}
                    ></domotwin-ha-card>
                  </figure>`;
                })}
              </div>
            </section>`
          : nothing
      }
      ${
        // Where Home Assistant has a Security page, the locks are there (D-068).
        !this.page && locks.length > 0
          ? html`<section data-testid="safety-locks">
              <h2>${t.t("safety.locks")}</h2>
              ${this.cards(locks, lockTile)}
            </section>`
          : nothing
      }
      ${empty ? html`<p class="muted" data-testid="safety-empty">${t.t("safety.nothing")}</p>` : nothing}
      ${
        this.page
          ? html`<section class="security">
              <button
                class="action"
                data-testid="safety-security-page"
                @click=${() => {
                  if (this.page) navigate(this.page);
                }}
              >
                ${icon(mdiShieldHomeOutline)}${t.t("safety.security_page")}
              </button>
              <span class="muted">${t.t("safety.security_hint")}</span>
            </section>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-safety", DomoTwinSafety);
