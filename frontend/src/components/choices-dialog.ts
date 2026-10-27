/**
 * `<domotwin-choices>`, the user's own choices (D-055): the tab DomoTwin opens on (for the user,
 * and this device's own), the cards of their Home tab (an agenda, a list), and whether Home
 * Assistant opens DomoTwin first, through Home Assistant's own setting: this device's in 2025.1,
 * the user's in the versions that keep it for them.
 */
import { mdiClose, mdiDeleteOutline } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, type FrontendCoreData, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import "../i18n/summary";
import { entityName } from "../live/bindings";
import {
  MAX_CALENDARS,
  MAX_HOME_CARDS,
  TABS,
  isTab,
  writeDeviceStart,
  type Choices,
  type HomeCard,
  type Tab,
} from "../live/choices";
import { SUMMARIES, isSummary } from "../live/overview";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

// The summaries' names (D-061), for the Home tab's summary cards.
/** How Home Assistant keeps the page it opens first: for the user, or on this device. */
export type FirstPage = "user" | "device";

/**
 * What this Home Assistant lets DomoTwin choose as the page it opens first; none in the demo.
 * Its user's data (`userData`) is there in 2025.1 already; the page kept for the user, or for
 * everyone, came with everyone's (`systemData`).
 */
export function firstPageOf(hass: HomeAssistant): FirstPage | undefined {
  if (hass.demo) return undefined;
  if (hass.systemData !== undefined) return "user";
  return typeof hass.defaultPanel === "string" ? "device" : undefined;
}

/** Whether Home Assistant opens `path` first. */
export function opensFirst(hass: HomeAssistant, path: string): boolean {
  const how = firstPageOf(hass);
  if (how === "user") return hass.userData?.default_panel === path;
  return how === "device" && hass.defaultPanel === path;
}

/** The names of a tab's words. */
const TAB_KEYS = {
  home: "tabs.home",
  rooms: "tabs.rooms",
  safety: "tabs.safety",
  "3d": "tabs.three_d",
} as const;

export class DomoTwinChoices extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    choices: { attribute: false },
    deviceStart: { attribute: false },
    panelPath: { attribute: false },
    start: { state: true },
    device: { state: true },
    cards: { state: true },
    first: { state: true },
    adding: { state: true },
    picked: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  choices?: Choices;
  /** This device's own tab, when it has one. */
  deviceStart?: Tab;
  /** The panel's path in Home Assistant (`domotwin`). */
  panelPath = "domotwin";
  protected start: Tab | "" = "";
  protected device: Tab | "" = "";
  protected cards: HomeCard[] = [];
  protected first = false;
  /** A card being added, and the entities picked for it. */
  protected adding?: "calendar" | "todo-list" | "summary";
  protected picked: string[] = [];
  protected busy = false;
  protected error?: string;
  private drafted = false;
  /** The calendars and lists of Home Assistant, read once when the dialog opens. */
  private calendars: string[] = [];
  private lists: string[] = [];

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .dialog {
        pointer-events: auto;
        width: min(480px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        box-sizing: border-box;
        padding: 16px;
        display: grid;
        gap: 12px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
      }
      h3 {
        margin: 4px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      p.hint {
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.error {
        margin: 0;
        color: var(--error-color, #d23a2f);
      }
      label.row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      label.row span {
        flex: 1;
      }
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
        min-width: 0;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 4px;
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      li span {
        flex: 1;
        min-width: 0;
      }
      .adds,
      .footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .pick {
        display: grid;
        gap: 6px;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      button.round {
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
    `,
  ];

  /** Home Assistant's states change all the time: the dialog reads them once. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.drafted);
  }

  protected override willUpdate(): void {
    const hass = this.hass;
    if (this.drafted || !hass || !this.choices) return;
    this.drafted = true;
    this.start = this.choices.start ?? "";
    this.device = this.deviceStart ?? "";
    this.cards = [...this.choices.cards];
    this.first = opensFirst(hass, this.panelPath);
    const ids = Object.keys(hass.states).sort();
    this.calendars = ids.filter((id) => id.startsWith("calendar."));
    this.lists = ids.filter((id) => id.startsWith("todo."));
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private cardName(card: HomeCard): string {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return "";
    switch (card.type) {
      case "calendar":
        return t.t("choices.agenda", {
          names: card.entities.map((id) => entityName(hass, id)).join(", "),
        });
      case "todo-list":
        return t.t("choices.list", { name: entityName(hass, card.entity) });
      case "summary":
        return t.t("choices.summary", { name: t.t(`summary.titles.${card.summary}`) });
    }
  }

  private addPicked(): void {
    if (this.adding === "calendar" && this.picked.length > 0) {
      this.cards = [...this.cards, { type: "calendar", entities: this.picked }];
    } else if (this.adding === "todo-list" && this.picked[0]) {
      this.cards = [...this.cards, { type: "todo-list", entity: this.picked[0] }];
    } else if (this.adding === "summary" && isSummary(this.picked[0])) {
      this.cards = [...this.cards, { type: "summary", summary: this.picked[0] }];
    }
    this.adding = undefined;
    this.picked = [];
  }

  /** Makes DomoTwin the page Home Assistant opens first, or not, as Home Assistant does. */
  private async setFirst(hass: HomeAssistant, on: boolean): Promise<void> {
    const how = firstPageOf(hass);
    if (!how || on === opensFirst(hass, this.panelPath)) return;
    if (how === "device") {
      // Home Assistant's own event: kept on this device, as its profile's choice is.
      fire(this, "hass-default-panel", { defaultPanel: on ? this.panelPath : "lovelace" });
      return;
    }
    const value: FrontendCoreData = { ...hass.userData };
    if (on) value.default_panel = this.panelPath;
    else delete value.default_panel;
    await hass.connection.sendMessagePromise({
      type: "frontend/set_user_data",
      key: "core",
      value,
    });
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    this.busy = true;
    this.error = undefined;
    const reason = (error: unknown): string =>
      isHassError(error) ? t.error(error.code) : t.error("unknown");
    try {
      const saved = await DomoTwinClient.for(hass).saveChoices({
        start: this.start,
        cards: this.cards,
      });
      writeDeviceStart(this.device || undefined);
      fire(this, "domotwin-saved", { choices: saved, device: this.device || undefined });
    } catch (error) {
      this.error = t.t("choices.failed", { reason: reason(error) });
      this.busy = false;
      return;
    }
    try {
      await this.setFirst(hass, this.first);
      this.close();
    } catch (error) {
      // The rest is saved: only Home Assistant's own setting is to be tried again.
      this.error = t.t("choices.first_failed", { reason: reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private tabOptions(selected: Tab | "", none?: string): TemplateResult {
    const t = this.t;
    if (!t) return html``;
    return html`${none !== undefined ? html`<option value="" ?selected=${selected === ""}>${none}</option>` : nothing}
    ${TABS.map(
      (tab) =>
        html`<option value=${tab} ?selected=${selected === tab}>${t.t(TAB_KEYS[tab])}</option>`,
    )}`;
  }

  private renderPick(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t || !this.adding) return nothing;
    const calendar = this.adding === "calendar";
    const summary = this.adding === "summary";
    const ids = summary ? [...SUMMARIES] : calendar ? this.calendars : this.lists;
    // Back to the choice of a card, the rest of the dialog as it is.
    const back = html`<button
      class="action quiet"
      data-testid="choices-pick-cancel"
      @click=${() => {
        this.adding = undefined;
        this.picked = [];
      }}
    >
      ${t.t("choices.cancel")}
    </button>`;
    if (ids.length === 0) {
      return html`<div class="pick">
        <p class="hint">${t.t(calendar ? "choices.no_calendar" : "choices.no_list")}</p>
        <div class="adds">${back}</div>
      </div>`;
    }
    return html`<div class="pick" data-testid="choices-pick">
      <h3>
        ${t.t(
          summary
            ? "choices.pick_summary"
            : calendar
              ? "choices.pick_calendars"
              : "choices.pick_list",
        )}
      </h3>
      ${ids.map(
        (id) =>
          html`<label class="row">
            <input
              type=${calendar ? "checkbox" : "radio"}
              name="pick"
              value=${id}
              .checked=${this.picked.includes(id)}
              ?disabled=${
                calendar && !this.picked.includes(id) && this.picked.length >= MAX_CALENDARS
              }
              @change=${(event: Event) => {
                const on = (event.target as HTMLInputElement).checked;
                this.picked = calendar
                  ? on
                    ? [...this.picked, id]
                    : this.picked.filter((p) => p !== id)
                  : [id];
              }}
            />
            <span>
              ${summary && isSummary(id) ? t.t(`summary.titles.${id}`) : entityName(hass, id)}
            </span>
          </label>`,
      )}
      <div class="adds">
        ${back}
        <button
          class="action"
          data-testid="choices-pick-add"
          ?disabled=${this.picked.length === 0}
          @click=${() => {
            this.addPicked();
          }}
        >
          ${t.t("choices.add")}
        </button>
      </div>
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t || !this.drafted) return nothing;
    const how = firstPageOf(hass);
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="choices-title"
      data-testid="choices-dialog"
    >
      <header>
        <h2 id="choices-title">${t.t("choices.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${
        hass.demo
          ? html`<p class="hint">${t.t(hass.sandbox ? "choices.sandbox" : "choices.demo")}</p>`
          : nothing
      }
      <label class="row">
        <span>${t.t("choices.start")}<br /><small>${t.t("choices.start_hint")}</small></span>
        <select
          data-testid="choices-start"
          data-autofocus
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            this.start = isTab(value) ? value : "";
          }}
        >
          ${this.tabOptions(this.start === "" ? "home" : this.start)}
        </select>
      </label>
      <label class="row">
        <span>${t.t("choices.device_start")}</span>
        <select
          data-testid="choices-device"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            this.device = isTab(value) ? value : "";
          }}
        >
          ${this.tabOptions(this.device, t.t("choices.device_same"))}
        </select>
      </label>
      ${
        how
          ? html`<label class="row">
              <input
                type="checkbox"
                data-testid="choices-first"
                .checked=${this.first}
                @change=${(event: Event) => {
                  this.first = (event.target as HTMLInputElement).checked;
                }}
              />
              <span
                >${t.t("choices.first")}<br /><small
                  >${t.t(how === "user" ? "choices.first_user" : "choices.first_device")}</small
                ></span
              >
            </label>`
          : nothing
      }
      <h3>${t.t("choices.cards")}</h3>
      ${
        this.cards.length === 0
          ? html`<p class="hint">${t.t("choices.no_cards")}</p>`
          : html`<ul data-testid="choices-cards">
              ${this.cards.map((card, i) => {
                const name = this.cardName(card);
                return html`<li>
                  <span>${name}</span>
                  <button
                    class="round"
                    aria-label=${t.t("choices.remove", { name })}
                    title=${t.t("choices.remove", { name })}
                    @click=${() => {
                      this.cards = this.cards.filter((_, j) => j !== i);
                    }}
                  >
                    ${icon(mdiDeleteOutline)}
                  </button>
                </li>`;
              })}
            </ul>`
      }
      ${
        this.adding
          ? this.renderPick()
          : html`<div class="adds">
              <button
                class="action quiet"
                data-testid="choices-add-calendar"
                ?disabled=${this.cards.length >= MAX_HOME_CARDS}
                @click=${() => {
                  this.adding = "calendar";
                  this.picked = [];
                }}
              >
                ${t.t("choices.add_calendar")}
              </button>
              <button
                class="action quiet"
                data-testid="choices-add-list"
                ?disabled=${this.cards.length >= MAX_HOME_CARDS}
                @click=${() => {
                  this.adding = "todo-list";
                  this.picked = [];
                }}
              >
                ${t.t("choices.add_list")}
              </button>
              <button
                class="action quiet"
                data-testid="choices-add-summary"
                ?disabled=${this.cards.length >= MAX_HOME_CARDS}
                @click=${() => {
                  this.adding = "summary";
                  this.picked = [];
                }}
              >
                ${t.t("choices.add_summary")}
              </button>
            </div>`
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <div class="footer">
        <button
          class="action quiet"
          @click=${() => {
            this.close();
          }}
        >
          ${t.t("choices.cancel")}
        </button>
        <button
          class="action"
          data-testid="choices-save"
          ?disabled=${this.busy}
          @click=${() => {
            void this.save();
          }}
        >
          ${t.t("choices.save")}
        </button>
      </div>
    </div>`;
  }
}

define("domotwin-choices", DomoTwinChoices);
