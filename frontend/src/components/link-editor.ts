/**
 * `<domotwin-link>`: links one element of the plan to Home Assistant (administrators, from the
 * panel's link mode). An element gets entities (suggested from its room's area, or searched), the
 * role of each, a tap action and a long-press action; a room gets an area. Saving is the panel's
 * job (`domotwin-link-save`).
 */
import { mdiClose, mdiPlus } from "@mdi/js";
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import {
  actionDraft,
  draftAction,
  validPath,
  validService,
  type ActionChoice,
  type ActionDraft,
} from "../live/action-choice";
import {
  deriveRole,
  roleOf,
  entityName,
  tapAction,
  type BoundEntity,
  type ElementBinding,
  type Role,
} from "../live/bindings";
import {
  searchEntities,
  suggestions,
  type LinkChange,
  type PlanElementInfo,
} from "../live/suggest";
import type { MessageKey } from "../i18n";
import { define, fire } from "./define";
import { rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";

const ROLES: readonly Role[] = [
  "light",
  "switch",
  "fan",
  "cover",
  "media",
  "contact",
  "lock",
  "camera",
  "power",
  "climate",
  "sensor",
];

/** What a camera sees: its angle of view (degrees) and reach (cm), with their limits. */
const VIEW_FIELDS = [
  ["fov", 10, 180, 90],
  ["range", 50, 3000, 600],
] as const;

/** A view field typed by the user: empty (the default) or a number within its limits. */
function viewValue(text: string, low: number, high: number): number | undefined | null {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= low && value <= high ? value : null;
}

const CHOICES: readonly [ActionChoice, MessageKey][] = [
  ["toggle", "link.action_toggle"],
  ["more-info", "link.action_more_info"],
  ["controls", "link.action_controls"],
  ["perform-action", "link.action_perform"],
  ["navigate", "link.action_navigate"],
  ["none", "link.action_none"],
];

export class DomoTwinLink extends Sheet {
  static override properties = {
    ...Sheet.properties,
    element: { attribute: false },
    binding: { attribute: false },
    area: { attribute: false },
    roomArea: { attribute: false },
    busy: { attribute: false },
    entities: { state: true },
    device: { state: true },
    tap: { state: true },
    hold: { state: true },
    chosenArea: { state: true },
    query: { state: true },
    fov: { state: true },
    range: { state: true },
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
      select.role {
        width: auto;
        max-width: 100%;
        min-height: 30px;
        margin-top: 2px;
        padding: 0 6px;
        font-size: 0.8rem;
      }
      .field {
        display: block;
        margin-top: 8px;
        font-size: 0.85rem;
      }
      .hint.error {
        color: var(--error-color, #db4437);
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
  /** The Home Assistant device the element stands for (the network map, D-031). */
  protected device = "";
  protected tap: ActionDraft = actionDraft(undefined);
  protected hold: ActionDraft = actionDraft(undefined);
  protected chosenArea = "";
  protected query = "";
  /** A linked camera's angle of view and reach, as typed (empty: the default). */
  protected fov = "";
  protected range = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("element") || changed.has("binding") || changed.has("area")) {
      this.entities = [...(this.binding?.entities ?? [])];
      this.device = this.binding?.device ?? "";
      this.tap = actionDraft(this.binding?.tap_action);
      this.hold = actionDraft(this.binding?.hold_action);
      this.chosenArea = this.area ?? (this.element?.type === "room" ? (this.roomArea ?? "") : "");
      this.query = "";
      this.fov = this.binding?.fov?.toString() ?? "";
      this.range = this.binding?.range?.toString() ?? "";
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
      if (this.device) binding.device = this.device;
      const tap = draftAction(this.tap, this.binding?.tap_action);
      const hold = draftAction(this.hold, this.binding?.hold_action);
      if (tap === null || hold === null) return;
      if (tap) binding.tap_action = tap;
      if (hold) binding.hold_action = hold;
      if (this.hasCamera) {
        for (const [key, low, high] of VIEW_FIELDS) {
          const value = viewValue(this[key], low, high);
          if (value === null) return;
          if (value !== undefined) binding[key] = value;
        }
      }
      change = { element: element.id, binding };
    }
    fire(this, "domotwin-link-save", change);
  }

  /** A field of an action or of the camera's view is not valid: nothing to save yet. */
  private get invalid(): boolean {
    if (this.element?.type === "room") return false;
    return (
      draftAction(this.tap, this.binding?.tap_action) === null ||
      draftAction(this.hold, this.binding?.hold_action) === null ||
      (this.hasCamera &&
        VIEW_FIELDS.some(([key, low, high]) => viewValue(this[key], low, high) === null))
    );
  }

  /** A camera is linked to a piece: what it sees can be set (cones start from pieces). */
  private get hasCamera(): boolean {
    return (
      this.element?.type === "furniture" &&
      this.entities.some((entity) => roleOf(entity, this.hass) === "camera")
    );
  }

  private setRole(entityId: string, role: string): void {
    this.entities = this.entities.map((entity) => {
      if (entity.entity_id !== entityId) return entity;
      const next: BoundEntity = { entity_id: entity.entity_id };
      if (role) next.role = role as Role;
      return next;
    });
  }

  private link(entityId: string): void {
    this.entities = [...this.entities, { entity_id: entityId }];
    this.query = "";
  }

  private unlink(entityId: string): void {
    this.entities = this.entities.filter((e) => e.entity_id !== entityId);
    // An action aimed at it now aims at no entity in particular.
    if (this.tap.target === entityId) this.tap = { ...this.tap, target: "" };
    if (this.hold.target === entityId) this.hold = { ...this.hold, target: "" };
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
        ?disabled=${this.busy || this.invalid}
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
    const entry = this.device ? hass.devices?.[this.device] : undefined;
    const device = this.device ? entry?.name_by_user || entry?.name || this.device : undefined;
    return html`<h3>${t.t("link.linked")}</h3>
      ${
        device
          ? html`<div class="entity" data-testid="linked-device">
              <span class="text"><span>${t.t("link.device", { name: device })}</span></span>
              <button
                class="round"
                aria-label=${t.t("link.device_remove", { name: device })}
                @click=${() => {
                  this.device = "";
                }}
              >
                ${icon(mdiClose)}
              </button>
            </div>`
          : nothing
      }
      ${
        this.entities.length === 0 && !device
          ? html`<p class="hint">${t.t("link.none")}</p>`
          : this.entities.map((entity) => {
              const name = entityName(hass, entity.entity_id);
              const derived = t.t(`link.role_${deriveRole(entity.entity_id, hass)}`);
              return html`<div class="entity">
                <span class="text"
                  ><span>${name}</span><small>${entity.entity_id}</small>
                  <select
                    class="role"
                    data-testid=${`role-${entity.entity_id}`}
                    aria-label=${t.t("link.role_of", { name })}
                    @change=${(event: Event) => {
                      this.setRole(entity.entity_id, (event.target as HTMLSelectElement).value);
                    }}
                  >
                    <option value="" ?selected=${!entity.role}>
                      ${t.t("link.role_auto", { role: derived })}
                    </option>
                    ${ROLES.map(
                      (role) =>
                        html`<option value=${role} ?selected=${entity.role === role}>
                          ${t.t(`link.role_${role}`)}
                        </option>`,
                    )}
                  </select></span
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
      ${this.hasCamera ? this.viewEditor() : nothing}
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
      ${found.map((id) => this.candidate(hass, id))} ${this.actionEditor(hass, "tap")}
      ${this.actionEditor(hass, "hold")}`;
  }

  /** What a linked camera sees on the plan: its angle of view and reach. */
  private viewEditor(): TemplateResult {
    const t = this.t;
    const invalid = VIEW_FIELDS.some(
      ([key, low, high]) => viewValue(this[key], low, high) === null,
    );
    return html`<h3>${t.t("link.camera_view")}</h3>
      ${VIEW_FIELDS.map(
        ([key, , , fallback]) =>
          html`<label>
            <span class="field">${t.t(`link.${key}`)}</span>
            <input
              type="text"
              inputmode="decimal"
              autocomplete="off"
              data-testid=${`link-${key}`}
              placeholder=${String(fallback)}
              .value=${this[key]}
              @input=${(event: Event) => {
                this[key] = (event.target as HTMLInputElement).value;
              }}
            />
          </label>`,
      )}
      ${invalid ? html`<p class="hint error">${t.t("link.view_invalid")}</p>` : nothing}`;
  }

  /** The choice of an action and its fields. */
  private actionEditor(hass: HomeAssistant, which: "tap" | "hold"): TemplateResult {
    const t = this.t;
    const draft = which === "tap" ? this.tap : this.hold;
    const original = which === "tap" ? this.binding?.tap_action : this.binding?.hold_action;
    const set = (patch: Partial<ActionDraft>): void => {
      const next = { ...draft, ...patch };
      if (which === "tap") this.tap = next;
      else this.hold = next;
    };
    let auto: string;
    if (which === "hold") auto = t.t("link.action_controls");
    else {
      const action = tapAction({ entities: this.entities }, hass).action;
      auto = t.t(action === "toggle" ? "link.action_toggle" : "link.action_more_info");
    }
    const custom = original !== undefined && actionDraft(original).choice === "custom";
    return html`<label>
        <h3>${t.t(which === "tap" ? "link.tap" : "link.hold")}</h3>
        <select
          data-testid=${`link-${which}`}
          @change=${(event: Event) => {
            set({ choice: (event.target as HTMLSelectElement).value as ActionChoice });
          }}
        >
          <option value="auto" ?selected=${draft.choice === "auto"}>
            ${t.t("link.action_auto", { action: auto })}
          </option>
          ${CHOICES.map(
            ([choice, label]) =>
              html`<option value=${choice} ?selected=${draft.choice === choice}>
                ${t.t(label)}
              </option>`,
          )}
          ${
            custom
              ? html`<option value="custom" ?selected=${draft.choice === "custom"}>
                  ${t.t("link.action_custom")}
                </option>`
              : nothing
          }
        </select>
      </label>
      ${
        draft.choice === "perform-action"
          ? html`<label>
                <span class="field">${t.t("link.service")}</span>
                <input
                  data-testid=${`link-${which}-service`}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="scene.turn_on"
                  .value=${draft.service}
                  @input=${(event: Event) => {
                    set({ service: (event.target as HTMLInputElement).value });
                  }}
                />
              </label>
              ${
                draft.service && !validService(draft.service)
                  ? html`<p class="hint error">${t.t("link.service_invalid")}</p>`
                  : nothing
              }
              <label>
                <span class="field">${t.t("link.target")}</span>
                <select
                  data-testid=${`link-${which}-target`}
                  @change=${(event: Event) => {
                    set({ target: (event.target as HTMLSelectElement).value });
                  }}
                >
                  <option value="" ?selected=${draft.target === ""}>
                    ${t.t("link.target_none")}
                  </option>
                  ${
                    // A target written in the file that is not linked: shown, so it can be changed.
                    draft.target && !this.entities.some((e) => e.entity_id === draft.target)
                      ? html`<option value=${draft.target} selected>
                          ${entityName(hass, draft.target)}
                        </option>`
                      : nothing
                  }
                  ${this.entities.map(
                    (entity) =>
                      html`<option
                        value=${entity.entity_id}
                        ?selected=${draft.target === entity.entity_id}
                      >
                        ${entityName(hass, entity.entity_id)}
                      </option>`,
                  )}
                </select>
              </label>`
          : nothing
      }
      ${
        draft.choice === "navigate"
          ? html`<label>
                <span class="field">${t.t("link.path")}</span>
                <input
                  data-testid=${`link-${which}-path`}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="/lovelace/0"
                  .value=${draft.path}
                  @input=${(event: Event) => {
                    set({ path: (event.target as HTMLInputElement).value });
                  }}
                />
              </label>
              ${
                draft.path && !validPath(draft.path)
                  ? html`<p class="hint error">${t.t("link.path_invalid")}</p>`
                  : nothing
              }`
          : nothing
      }`;
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
