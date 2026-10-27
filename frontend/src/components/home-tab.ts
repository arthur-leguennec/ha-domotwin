/**
 * `<domotwin-home>`, the Home tab (D-055): the home at a glance (who is in, the lamps on, the
 * doors and windows open, the alerts, Hydro-Québec's next peak, D-062), the weather, the
 * favourite scenes as big buttons, the other favourites, and the cards the user chose. Every
 * control is Home Assistant's own card.
 */
import {
  mdiAccountGroupOutline,
  mdiAlertOutline,
  mdiDoorOpen,
  mdiLightbulbGroupOutline,
  mdiStar,
  mdiTransmissionTower,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { card, pressCard, tileCard, type CardConfig } from "../ha/cards";
import { nowOf, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { failureText } from "../live/actions";
import { areaOf, entityName } from "../live/bindings";
import { isPressed, type Choices, type HomeCard } from "../live/choices";
import { glanceOf, type Glance, type GlanceSources } from "../live/glance";
import { formatPower } from "../live/layers";
import { peakWords } from "../live/peaks";
import { timeStyle, whenText } from "../live/schedules";
import { NOTHING_UNSEEN, seen, type Unseen } from "../live/privacy";
import { define } from "./define";
import "./ha-card";
import { icon } from "./icon";
import { avatar, avatarStyles } from "./person-avatar";
import { practicalStyles, starButton } from "./practical-styles";
import { baseStyles } from "./styles";

/** What a chip of the glance opens. */
type Detail = "people" | "lights" | "openings" | "alerts" | "peak";

/** Home Assistant's card for a card of the Home tab. */
function cardOf(home: HomeCard): CardConfig {
  switch (home.type) {
    case "calendar":
      return card({ type: "calendar", entities: home.entities, initial_view: "listWeek" });
    case "todo-list":
      return card({ type: "todo-list", entity: home.entity });
    case "summary":
      // DomoTwin's own (D-061), made as Home Assistant makes any custom card.
      return card({ type: "custom:domotwin-summary-card", summary: home.summary });
  }
}

export class DomoTwinHome extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    choices: { attribute: false },
    can3d: { type: Boolean },
    sources: { attribute: false },
    unseen: { attribute: false },
    open: { state: true },
    refused: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  choices?: Choices;
  /** What the glance reads beyond the states (people, energy, rooms, privacy). */
  sources?: GlanceSources;
  /** What the viewer may not see (D-039): their favourites there are not shown either. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The 3D view can be shown: the peak's rooms can be seen there. */
  can3d = false;
  /** The chip whose details are open. */
  protected open?: Detail;
  /** What Home Assistant refused last. */
  protected refused?: string;
  private glance?: Glance;

  static override styles = [
    baseStyles,
    avatarStyles,
    practicalStyles,
    css`
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button.chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 20px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        font-size: 0.9rem;
        cursor: pointer;
      }
      button.chip[aria-expanded="true"] {
        border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      button.chip.danger {
        background: var(--error-color, #db4437);
        border-color: transparent;
        color: #fff;
      }
      button.chip.warning {
        background: var(--warning-color, #ffa600);
        border-color: transparent;
        color: #1f2328;
      }
      .detail {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      .people {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }
      .person {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .alert {
        padding: 8px 12px;
        border-radius: 12px;
        background: var(--card-background-color, #fff);
        border-left: 4px solid var(--warning-color, #ffa600);
      }
      .alert.danger {
        border-left-color: var(--error-color, #db4437);
      }
      .peak-rooms {
        display: grid;
        gap: 4px;
        margin: 0;
        padding-inline-start: 20px;
      }
      .presses {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
      }
      .empty {
        display: grid;
        justify-items: start;
        gap: 8px;
        color: var(--secondary-text-color, #5f6368);
      }
    `,
  ];

  /** When the peak's phase changes next (D-062): the glance is worked out again then. */
  private peakTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.peakTimer);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if ((changed.has("hass") || changed.has("sources")) && this.hass && this.sources) {
      this.readGlance(this.hass, this.sources);
    }
  }

  /** The glance now, and again when the peak starts or ends, as nothing else may change then. */
  private readGlance(hass: HomeAssistant, sources: GlanceSources): void {
    clearTimeout(this.peakTimer);
    this.glance = glanceOf(hass, sources);
    // Its chip gone with the peak, its details go too.
    const now = this.glance.peak?.now;
    if (this.open === "peak" && (!now?.peak || now.phase === "none")) this.open = undefined;
    const next = now?.next;
    if (next === undefined) return;
    // Looked at again in six hours at most, should the clock have been changed meanwhile.
    const wait = Math.min(Math.max(next - nowOf(hass), 0) + 500, 6 * 3_600_000);
    this.peakTimer = setTimeout(() => {
      if (this.hass && this.sources) this.readGlance(this.hass, this.sources);
      this.requestUpdate();
    }, wait);
  }

  private toggleDetail(detail: Detail): void {
    this.open = this.open === detail ? undefined : detail;
  }

  private readonly allOff = async (): Promise<void> => {
    const hass = this.hass;
    const lights = this.glance?.lights ?? [];
    if (!hass || !this.t || lights.length === 0) return;
    try {
      await hass.callService("light", "turn_off", {}, { entity_id: lights });
      this.refused = undefined;
    } catch (error) {
      this.refused = failureText(this.t, error);
    }
  };

  private chip(
    detail: Detail,
    glyph: string,
    label: string,
    level?: "danger" | "warning",
  ): TemplateResult {
    return html`<button
      class="chip ${level ?? ""}"
      data-testid="home-${detail}"
      aria-expanded=${this.open === detail ? "true" : "false"}
      @click=${() => {
        this.toggleDetail(detail);
      }}
    >
      ${icon(glyph)}<span>${label}</span>
    </button>`;
  }

  private tiles(ids: string[], starred: boolean): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return html``;
    const favourites = new Set(this.choices?.favourites ?? []);
    return html`<div class="tiles">
      ${ids.map(
        (id) =>
          html`<div class="entity" data-entity=${id}>
            <domotwin-ha-card .hass=${hass} .t=${t} .config=${tileCard(id)}></domotwin-ha-card>
            ${starred ? starButton(this, t, entityName(hass, id), id, favourites.has(id)) : nothing}
          </div>`,
      )}
    </div>`;
  }

  private renderDetail(glance: Glance): TemplateResult | typeof nothing {
    const t = this.t;
    if (!t) return nothing;
    switch (this.open) {
      case "people":
        return html`<div class="detail people" data-testid="home-people-detail">
          ${(glance.people ?? []).map(
            (person) =>
              html`<span class="person"
                >${avatar({ ...person, home: true, self: false })}<span>${person.name}</span></span
              >`,
          )}
          ${
            glance.away > 0
              ? html`<span class="muted">${t.tp("home.away", glance.away)}</span>`
              : nothing
          }
        </div>`;
      case "lights":
        return html`<div class="detail">
          ${
            glance.lights.length > 0
              ? html`<button class="action" data-testid="home-all-off" @click=${this.allOff}>
                  ${t.t("home.all_off")}
                </button>`
              : nothing
          }
          ${this.tiles(glance.lights, false)}
        </div>`;
      case "openings":
        return html`<div class="detail">${this.tiles(glance.openings, false)}</div>`;
      case "peak":
        return this.renderPeak(glance);
      case "alerts":
        return html`<div class="detail" role="list">
          ${glance.alerts.map(
            (alert) =>
              html`<div class="alert ${alert.level}" role="listitem">
                ${t.t(`layers.alert_${alert.reason}`, { room: alert.name })}
              </div>`,
          )}
        </div>`;
      default:
        return nothing;
    }
  }

  /** Hydro-Québec's peak (D-062): when, the rooms that pre-heat, shed or still heat, the 3D. */
  private renderPeak(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const peak = glance.peak;
    if (!hass || !t || !peak) return nothing;
    const names = new Map((this.sources?.rooms ?? []).map((room) => [room.id, room.name]));
    const rooms = [...new Set([...Object.keys(peak.rooms.roles), ...Object.keys(peak.rooms.draws)])]
      .filter((id) => names.has(id))
      .sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    const words = peakWords(t, peak.now, timeStyle(hass), new Date(nowOf(hass)));
    return html`<div class="detail" data-testid="home-peak-detail">
      ${words.map((word) => html`<span>${word}</span>`)}
      ${
        rooms.length > 0
          ? html`<ul class="peak-rooms">
              ${rooms.map((id) => {
                const role = peak.rooms.roles[id];
                const draw = peak.rooms.draws[id];
                const what = [
                  role ? t.t(`home.peak_role_${role}`) : "",
                  draw !== undefined ? formatPower(draw, t.language) : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                return html`<li data-room=${id} data-role=${role ?? nothing}>
                  ${t.t("home.peak_room", { room: names.get(id) ?? id, what })}
                </li>`;
              })}
            </ul>`
          : nothing
      }
      ${
        // An administrator plays the day of a peak to come in the sandbox (D-062).
        hass.user?.is_admin === true && hass.demo !== true && peak.now.phase !== "peak"
          ? html`<button
              class="action"
              data-testid="home-peak-sandbox"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("domotwin-sandbox-peak", { bubbles: true, composed: true }),
                );
              }}
            >
              ${t.t("home.peak_sandbox")}
            </button>`
          : nothing
      }
      ${
        this.can3d
          ? html`<button
              class="action"
              data-testid="home-peak-3d"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("domotwin-go", {
                    detail: { tab: "3d", layer: "peak" },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
            >
              ${t.t("home.peak_see")}
            </button>`
          : nothing
      }
    </div>`;
  }

  /** The peak's chip: under way, pre-heating, or the next one; none while none is announced. */
  private peakChip(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const now = glance.peak?.now;
    const peak = now?.peak;
    if (!hass || !t || !now || !peak || now.phase === "none") return nothing;
    const style = timeStyle(hass);
    const at = new Date(nowOf(hass));
    const label =
      now.phase === "peak"
        ? t.t("peak.now", { end: whenText(new Date(peak.end), at, style) })
        : now.phase === "preheat"
          ? t.t("home.peak_preheat", { start: whenText(new Date(peak.start), at, style) })
          : t.t("home.peak_next", { start: whenText(new Date(peak.start), at, style) });
    return this.chip(
      "peak",
      mdiTransmissionTower,
      label,
      now.phase === "peak" ? "warning" : undefined,
    );
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const glance = this.glance;
    if (!hass || !t || !glance) return nothing;
    const favourites = (this.choices?.favourites ?? []).filter(
      (id) => hass.states[id] && seen(this.unseen, id, areaOf(hass, id)),
    );
    const presses = favourites.filter(isPressed);
    const others = favourites.filter((id) => !isPressed(id));
    const cards = this.choices?.cards ?? [];
    const weather = glance.weather;
    const danger = glance.alerts.some((alert) => alert.level === "danger");
    const people = glance.people;
    return html`<div class="page" data-testid="home-tab">
      <section aria-label=${t.t("home.glance")}>
        <div class="chips">
          ${
            people
              ? this.chip(
                  "people",
                  mdiAccountGroupOutline,
                  people.length > 0 ? t.tp("home.people", people.length) : t.t("home.nobody"),
                )
              : nothing
          }
          ${this.chip(
            "lights",
            mdiLightbulbGroupOutline,
            glance.lights.length > 0
              ? t.tp("home.lights", glance.lights.length)
              : t.t("home.lights_off"),
          )}
          ${this.chip(
            "openings",
            mdiDoorOpen,
            glance.openings.length > 0
              ? t.tp("home.openings", glance.openings.length)
              : t.t("home.all_closed"),
          )}
          ${
            glance.alerts.length > 0
              ? this.chip(
                  "alerts",
                  mdiAlertOutline,
                  t.tp("home.alerts", glance.alerts.length),
                  danger ? "danger" : "warning",
                )
              : nothing
          }
          ${this.peakChip(glance)}
        </div>
        ${this.renderDetail(glance)}
        ${this.refused ? html`<p class="error" role="alert">${this.refused}</p>` : nothing}
      </section>
      ${
        weather
          ? html`<section aria-label=${t.t("home.weather")}>
              <domotwin-ha-card
                data-testid="home-weather"
                .hass=${hass}
                .t=${t}
                .config=${card({
                  type: "weather-forecast",
                  entity: weather.entity,
                  forecast_type: "daily",
                  show_current: true,
                  show_forecast: true,
                })}
              ></domotwin-ha-card>
            </section>`
          : nothing
      }
      ${
        presses.length > 0
          ? html`<section>
              <h2>${t.t("home.scenes")}</h2>
              <div class="presses" data-testid="home-scenes">
                ${presses.map(
                  (id) =>
                    html`<div class="entity" data-entity=${id}>
                      <domotwin-ha-card
                        .hass=${hass}
                        .t=${t}
                        .config=${pressCard(id)}
                      ></domotwin-ha-card>
                    </div>`,
                )}
              </div>
            </section>`
          : nothing
      }
      ${
        others.length > 0
          ? html`<section data-testid="home-favourites">
              <h2>${t.t("home.favourites")}</h2>
              ${this.tiles(others, true)}
            </section>`
          : nothing
      }
      ${
        favourites.length === 0
          ? html`<section class="empty" data-testid="home-empty">
              <span>${icon(mdiStar)} ${t.t("home.empty")}</span>
              <button
                class="action"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent("domotwin-go", {
                      detail: { tab: "rooms" },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                ${t.t("home.open_rooms")}
              </button>
            </section>`
          : nothing
      }
      ${
        cards.length > 0
          ? html`<section data-testid="home-cards">
              <h2>${t.t("home.cards")}</h2>
              <div class="cards">
                ${cards.map(
                  (card) =>
                    html`<domotwin-ha-card
                      .hass=${hass}
                      .t=${t}
                      .config=${cardOf(card)}
                    ></domotwin-ha-card>`,
                )}
              </div>
            </section>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-home", DomoTwinHome);
