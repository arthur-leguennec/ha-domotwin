/**
 * `<domotwin-ha-card>`: one of Home Assistant's own cards (D-055), made by its card helpers and
 * given each new `hass`. Where there are none (the demo house, whose entities Home Assistant's
 * dialogs do not know, D-050; a Home Assistant that loads its dashboards another way), DomoTwin's
 * own cards are made as they are, and DomoTwin's own plain row stands in for the others.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { cardHelpers, type CardConfig } from "../ha/cards";
import type { HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { conditionWords } from "../live/weather";
import { entityName } from "../live/bindings";
import { lookOnly } from "../live/rights";
import { define } from "./define";
import { entityRow, rowStyles } from "./entity-rows";

type HassCard = HTMLElement & { hass?: unknown };

/** A `custom:` card whose element is defined, made and given its configuration; else none. */
function customCard(config: CardConfig): HassCard | undefined {
  const type = typeof config.type === "string" ? config.type : "";
  if (!type.startsWith("custom:")) return undefined;
  const tag = type.slice("custom:".length);
  if (!customElements.get(tag)) return undefined;
  const card = document.createElement(tag) as HassCard & { setConfig?: (config: unknown) => void };
  try {
    card.setConfig?.(config);
  } catch {
    return undefined;
  }
  return card;
}

export class DomoTwinHaCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { attribute: false },
    t: { attribute: false },
    plain: { state: true },
  };

  hass?: HomeAssistant;
  config?: CardConfig;
  t?: Translator;
  /** DomoTwin's own row in its place. */
  protected plain = false;
  private card?: HassCard;
  /** The configuration the card was made for, and whether for the demo house. */
  private madeFor?: string;
  private demo?: boolean;
  /** Whether the viewer may only look at its entity (their rights, D-071). */
  private looks?: boolean;

  static override styles = [
    rowStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .press {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
        min-height: 88px;
        padding: 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: var(--ha-card-border-radius, 12px);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .press:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: 2px;
      }
      .plain {
        padding: 8px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: var(--ha-card-border-radius, 12px);
        background: var(--card-background-color, #fff);
      }
      .note {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.875rem;
      }
      .graph {
        display: grid;
        gap: 4px;
      }
      .graph .title {
        font-weight: 600;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues): void {
    // Made again for another configuration, or on the way into the demo house or out of it.
    const demo = this.hass?.demo === true;
    const looks = this.looksOnly();
    if (changed.has("config") || demo !== this.demo || looks !== this.looks) {
      this.demo = demo;
      this.looks = looks;
      void this.make();
    }
    if (this.card && changed.has("hass")) this.card.hass = this.hass;
  }

  /** Whether the viewer may only look at the card's entity (their rights, D-071). */
  private looksOnly(): boolean {
    const entity = this.config?.entity;
    return typeof entity === "string" && this.hass?.canAct?.(entity) === false;
  }

  /**
   * Makes Home Assistant's card, once for each configuration; one the viewer may only look at
   * does nothing on a tap (D-071).
   */
  private async make(): Promise<void> {
    const config = this.config && this.looksOnly() ? lookOnly(this.config) : this.config;
    const hass = this.hass;
    if (!config || !hass) return;
    // The demo house's cards are DomoTwin's own rows (D-050): made again on the way in or out.
    const key = `${hass.demo ? "demo" : "home"}:${JSON.stringify(config)}`;
    if (key === this.madeFor) return;
    this.madeFor = key;
    this.card = undefined;
    const helpers = hass.demo ? undefined : await cardHelpers();
    if (key !== this.madeFor) return;
    if (!helpers) {
      // DomoTwin's own cards (D-061), and any other defined here, need no helper to be made.
      const card = customCard(config);
      if (card) {
        card.hass = this.hass;
        this.card = card;
      }
      this.plain = !card;
      this.requestUpdate();
      return;
    }
    try {
      const card = (await helpers.createCardElement(config)) as HassCard;
      if (key !== this.madeFor) return;
      card.hass = this.hass;
      this.card = card;
      this.plain = false;
    } catch {
      this.plain = true;
    }
    this.requestUpdate();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.plain) return this.card ? html`${this.card}` : nothing;
    return this.renderPlain();
  }

  /** DomoTwin's own row in place of the card. */
  private renderPlain(): TemplateResult | typeof nothing {
    const { hass, config, t } = this;
    if (!hass || !config || !t) return nothing;
    const entity = typeof config.entity === "string" ? config.entity : undefined;
    switch (config.type) {
      // A camera, an alarm (D-068): their name and state, as a tile's.
      case "tile":
      case "picture-entity":
      case "alarm-panel":
        return entity
          ? html`<div class="plain" data-entity=${entity}>
              ${entityRow(hass, t, entity, false)}
            </div>`
          : nothing;
      case "button":
        return entity
          ? html`<button
              class="press"
              data-entity=${entity}
              ?disabled=${hass.canAct?.(entity) === false}
              @click=${() => {
                const domain = entity.slice(0, entity.indexOf("."));
                void hass
                  .callService(domain, "turn_on", {}, { entity_id: entity })
                  .catch(() => undefined);
              }}
            >
              ${entityName(hass, entity)}
            </button>`
          : nothing;
      case "weather-forecast": {
        const state = entity ? hass.states[entity] : undefined;
        const temperature = state?.attributes.temperature;
        const unit = state?.attributes.temperature_unit;
        return state && entity
          ? html`<div class="plain" data-entity=${entity}>
              <span class="name">${entityName(hass, entity)}</span>
              <span class="state"
                >${conditionWords(t, state.state)}${
                  typeof temperature === "number"
                    ? ` · ${temperature} ${typeof unit === "string" ? unit : ""}`
                    : ""
                }</span
              >
            </div>`
          : nothing;
      }
      case "history-graph":
      case "statistics-graph": {
        // A room's graphs (D-069): what each says now, no graph drawn by DomoTwin (D-054).
        const entities = Array.isArray(config.entities)
          ? config.entities.filter((id): id is string => typeof id === "string")
          : [];
        return html`<div class="plain graph" data-type=${config.type}>
          ${typeof config.title === "string" ? html`<span class="title">${config.title}</span>` : nothing}
          ${entities.map((id) => entityRow(hass, t, id, false))}
          <span class="note">${t.t("graphs.plain")}</span>
        </div>`;
      }
      default:
        // An agenda, a list: Home Assistant's own, not redrawn.
        return html`<div class="plain note">${t.t("home.card_unavailable")}</div>`;
    }
  }
}

define("domotwin-ha-card", DomoTwinHaCard);
