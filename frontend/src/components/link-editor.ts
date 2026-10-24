/**
 * `<domotwin-link>`: links one element of the plan to Home Assistant (administrators, from the
 * panel's link mode). An element gets entities (suggested from its room's area, or searched) and
 * a tap action; a room gets an area. Saving is the panel's job (`domotwin-link-save`).
 */
import { mdiClose, mdiPlus } from "@mdi/js";
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import {
  entityName,
  roleOf,
  tapAction,
  type Action,
  type BoundEntity,
  type ElementBinding,
} from "../live/bindings";
import {
  searchEntities,
  suggestions,
  type LinkChange,
  type PlanElementInfo,
} from "../live/suggest";
import { define, fire } from "./define";
import { rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";

/** The tap actions the editor offers; `custom` keeps an action written by hand. */
type TapChoice = "auto" | "toggle" | "more-info" | "none" | "custom";

function tapChoice(action: Action | undefined): TapChoice {
  if (!action) return "auto";
  if (action.action === "toggle" && !action.entity_id) return "toggle";
  if (action.action === "more-info" && !action.entity_id) return "more-info";
  if (action.action === "none") return "none";
  return "custom";
}

export class DomoTwinLink extends Sheet {
  static override properties = {
    ...Sheet.properties,
    element: { attribute: false },
    binding: { attribute: false },
    area: { attribute: false },
    roomArea: { attribute: false },
    busy: { attribute: false },
    entities: { state: true },
    tap: { state: true },
    chosenArea: { state: true },
    query: { state: true },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    sheetStyles,
    css`
      .entity {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
      }
      .entity .text {
        flex: 1;
        min-width: 0;
        display: grid;
      }
      .entity small,
      .hint {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hint {
        white-space: normal;
        margin: 6px 0 0;
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        margin-top: 6px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
    `,
  ];

  /** The element being linked. */
  element?: PlanElementInfo;
  /** Its current binding (elements). */
  binding?: ElementBinding;
  /** Its current area (rooms). */
  area?: string;
  /** The area of the room the element is in, for suggestions (or found by the room's name). */
  roomArea?: string;
  /** Saving: the buttons wait. */
  busy = false;

  protected entities: BoundEntity[] = [];
  protected tap: TapChoice = "auto";
  protected chosenArea = "";
  protected query = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("element") || changed.has("binding") || changed.has("area")) {
      this.entities = [...(this.binding?.entities ?? [])];
      this.tap = tapChoice(this.binding?.tap_action);
      this.chosenArea = this.area ?? (this.element?.type === "room" ? (this.roomArea ?? "") : "");
      this.query = "";
    }
  }

  private save(): void {
    const element = this.element;
    if (!element) return;
    let change: LinkChange;
    if (element.type === "room") {
      change = { room: element.id, area: this.chosenArea || null };
    } else {
      const binding: ElementBinding = { entities: this.entities };
      if (this.tap === "custom" && this.binding?.tap_action) {
        binding.tap_action = this.binding.tap_action;
      } else if (this.tap !== "auto" && this.tap !== "custom") {
        binding.tap_action = { action: this.tap };
      }
      if (this.binding?.hold_action) binding.hold_action = this.binding.hold_action;
      change = { element: element.id, binding };
    }
    fire(this, "domotwin-link-save", change);
  }

  private link(entityId: string): void {
    this.entities = [...this.entities, { entity_id: entityId }];
    this.query = "";
  }

  private unlink(entityId: string): void {
    this.entities = this.entities.filter((e) => e.entity_id !== entityId);
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const element = this.element;
    if (!hass || !element) return nothing;
    const t = this.t;
    const footer = html`<div class="footer">
      <button
        class="action quiet"
        @click=${() => {
          this.close();
        }}
      >
        ${t.t("link.cancel")}
      </button>
      <button
        class="action"
        data-testid="link-save"
        ?disabled=${this.busy}
        @click=${() => {
          this.save();
        }}
      >
        ${t.t("link.save")}
      </button>
    </div>`;
    return this.frame(
      element.type === "room" ? this.renderRoom(hass) : this.renderElement(hass, element),
      footer,
    );
  }

  private renderRoom(hass: HomeAssistant): TemplateResult {
    const t = this.t;
    const areas = Object.values(hass.areas ?? {})
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
    const byName = !this.area && this.roomArea ? hass.areas?.[this.roomArea]?.name : undefined;
    return html`<label>
        <h3>${t.t("link.area")}</h3>
        <select
          @change=${(event: Event) => {
            this.chosenArea = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="" ?selected=${this.chosenArea === ""}>${t.t("link.area_none")}</option>
          ${areas.map(
            (a) =>
              html`<option value=${a.area_id} ?selected=${a.area_id === this.chosenArea}>
                ${a.name}
              </option>`,
          )}
        </select>
      </label>
      ${byName ? html`<p class="hint">${t.t("link.area_by_name", { area: byName })}</p>` : nothing}`;
  }

  private renderElement(hass: HomeAssistant, element: PlanElementInfo): TemplateResult {
    const t = this.t;
    const linked = this.entities.map((e) => e.entity_id);
    const suggested = suggestions(hass, element, this.roomArea, linked);
    const found = searchEntities(hass, element, this.query, linked);
    const areaName = this.roomArea ? hass.areas?.[this.roomArea]?.name : undefined;
    const auto = tapAction({ entities: this.entities }, hass).action;
    const autoLabel = t.t(auto === "toggle" ? "link.action_toggle" : "link.action_more_info");
    return html`<h3>${t.t("link.linked")}</h3>
      ${
        this.entities.length === 0
          ? html`<p class="hint">${t.t("link.none")}</p>`
          : this.entities.map((entity) => {
              const name = entityName(hass, entity.entity_id);
              return html`<div class="entity">
                <span class="text"
                  ><span>${name}</span
                  ><small
                    >${entity.entity_id} · ${t.t(`link.role_${roleOf(entity, hass)}`)}</small
                  ></span
                >
                <button
                  class="round"
                  aria-label=${t.t("link.remove", { name })}
                  @click=${() => {
                    this.unlink(entity.entity_id);
                  }}
                >
                  ${icon(mdiClose)}
                </button>
              </div>`;
            })
      }
      <h3>
        ${areaName ? t.t("link.suggestions", { area: areaName }) : t.t("link.suggestions_title")}
      </h3>
      ${
        suggested.length > 0
          ? suggested.map((id) => this.candidate(hass, id))
          : html`<p class="hint">
              ${areaName ? t.t("link.suggestions_empty") : t.t("link.suggestions_no_area")}
            </p>`
      }
      <label>
        <h3>${t.t("link.search")}</h3>
        <input
          type="search"
          autocomplete="off"
          .value=${this.query}
          placeholder=${t.t("link.search_hint")}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      ${found.map((id) => this.candidate(hass, id))}
      <label>
        <h3>${t.t("link.tap")}</h3>
        <select
          @change=${(event: Event) => {
            this.tap = (event.target as HTMLSelectElement).value as TapChoice;
          }}
        >
          <option value="auto" ?selected=${this.tap === "auto"}>
            ${t.t("link.action_auto", { action: autoLabel })}
          </option>
          <option value="toggle" ?selected=${this.tap === "toggle"}>
            ${t.t("link.action_toggle")}
          </option>
          <option value="more-info" ?selected=${this.tap === "more-info"}>
            ${t.t("link.action_more_info")}
          </option>
          <option value="none" ?selected=${this.tap === "none"}>${t.t("link.action_none")}</option>
          ${
            this.binding?.tap_action && tapChoice(this.binding.tap_action) === "custom"
              ? html`<option value="custom" ?selected=${this.tap === "custom"}>
                  ${t.t("link.action_custom")}
                </option>`
              : nothing
          }
        </select>
      </label>`;
  }

  private candidate(hass: HomeAssistant, id: string): TemplateResult {
    const name = entityName(hass, id);
    return html`<div class="entity">
      <span class="text"><span>${name}</span><small>${id}</small></span>
      <button
        class="round"
        aria-label=${this.t.t("link.add", { name })}
        @click=${() => {
          this.link(id);
        }}
      >
        ${icon(mdiPlus)}
      </button>
    </div>`;
  }
}

define("domotwin-link", DomoTwinLink);
