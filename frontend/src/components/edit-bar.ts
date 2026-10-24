/**
 * Edit mode's tools (administrators, from the panel), loaded the first time edit mode opens:
 *
 * - `<domotwin-edit-bar>`: the bar at the bottom of the view (undo, redo, turn, remove, select
 *   several, add) and what is selected. It fires `domotwin-edit-command` (detail: the command),
 *   `domotwin-edit-multi` (detail: on or off) and `domotwin-edit-catalogue`;
 * - `<domotwin-catalogue>`: the pieces that can be added, by room, with a search, and the plan's
 *   own 3D models (« My models »). It fires `domotwin-add` (detail: `{ kind, name }`),
 *   `domotwin-add-model` and `domotwin-forget-model` (detail: `{ id }`) and
 *   `domotwin-import-model`;
 * - `<domotwin-model-import>`: the name, size, unit and up axis of a 3D file being imported. It
 *   fires `domotwin-model-confirm` (detail: `ModelChoice`).
 */
import {
  mdiAlertOutline,
  mdiCubeOutline,
  mdiDeleteOutline,
  mdiLock,
  mdiPlus,
  mdiRedo,
  mdiRotateLeft,
  mdiRotateRight,
  mdiSelectMultiple,
  mdiUndo,
} from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { CatalogueKind, EditState, UserModel } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import {
  UNITS,
  guessUnit,
  modelSize,
  validSize,
  type ModelFormat,
  type ModelInfo,
  type ModelUnit,
} from "../models/models";
import { define, fire } from "./define";
import { icon } from "./icon";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";
import type { EditCommand } from "./view";

/** The catalogue's groups, in order; kinds in none go to "Other". */
export const GROUPS: [string, string[]][] = [
  ["living", ["sofa", "armchair", "table", "roundtable", "tv", "stand", "console", "trunk"]],
  ["bedroom", ["bed", "nightstand", "dresser", "linen"]],
  [
    "kitchen",
    [
      "counter",
      "sink",
      "stove",
      "fridge",
      "dishwasher",
      "hood",
      "soffit",
      "backsplash",
      "dining",
      "chair",
      "cart",
      "bin",
    ],
  ],
  ["bathroom", ["bathtub", "vanity", "toilet", "washer", "dryer", "mirror"]],
  ["office", ["desk", "officechair", "printer", "printer3d"]],
  ["storage", ["bookcase", "barrister", "openshelf", "shelf", "cabinet", "shoecab"]],
  [
    "lights",
    [
      "lamp",
      "tablelamp",
      "desklamp",
      "lantern",
      "pendant",
      "chandelier",
      "ceilinglight",
      "spot",
      "fan",
    ],
  ],
  ["decor", ["plant", "curtain", "frame", "gallery", "heater", "conduit"]],
];

/** Text folded for a search: lower case, without accents. */
function folded(text: string, t: Translator): string {
  return text.toLocaleLowerCase(t.language).normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** The plan's models whose name matches `query`. */
export function matchingModels(models: UserModel[], t: Translator, query = ""): UserModel[] {
  const wanted = folded(query.trim(), t);
  return models.filter((model) => !wanted || folded(model.name, t).includes(wanted));
}

/** The catalogue in groups, translated and filtered by `query` (name or kind). */
export function catalogueGroups(
  kinds: CatalogueKind[],
  t: Translator,
  query = "",
): { group: string; kinds: CatalogueKind[] }[] {
  const wanted = folded(query.trim(), t);
  const matches = (kind: CatalogueKind): boolean =>
    !wanted || folded(t.kind(kind.kind), t).includes(wanted) || kind.kind.includes(wanted);
  const placed = new Set(GROUPS.flatMap(([, list]) => list));
  const groups = GROUPS.map(([group, list]) => ({
    group,
    kinds: list
      .map((name) => kinds.find((kind) => kind.kind === name))
      .filter((kind): kind is CatalogueKind => kind !== undefined && matches(kind)),
  }));
  groups.push({
    group: "other",
    kinds: kinds.filter((kind) => !placed.has(kind.kind) && matches(kind)),
  });
  return groups.filter((group) => group.kinds.length > 0);
}

export class DomoTwinEditBar extends LitElement {
  static override properties = {
    hass: { attribute: false },
    state: { attribute: false },
    multi: { attribute: false },
  };
  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translateX(-50%);
        display: grid;
        justify-items: center;
        gap: 8px;
        width: max-content;
        max-width: calc(100% - 24px);
        z-index: 1;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        font-size: 0.875rem;
        text-align: center;
      }
      .status.conflict {
        border-color: var(--error-color, #db4437);
        color: var(--error-color, #db4437);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
      }
      .bar button {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color, #1f2328);
        cursor: pointer;
      }
      .bar button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .bar button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .bar button[aria-pressed="true"] {
        color: var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent);
      }
      .bar .add {
        width: auto;
        padding: 0 14px 0 10px;
        display: flex;
        gap: 6px;
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
        font: inherit;
        font-weight: 500;
      }
      .bar .add:hover:not(:disabled) {
        background: var(--primary-color, #03a9f4);
        filter: brightness(1.08);
      }
      .separator {
        width: 1px;
        height: 24px;
        margin: 0 4px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      @media (max-width: 420px) {
        .bar .add .label {
          display: none;
        }
        .bar .add {
          width: 44px;
          padding: 0;
          justify-content: center;
        }
      }
    `,
  ];

  hass?: HomeAssistant;
  state?: EditState;
  multi = false;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  private button(
    command: EditCommand,
    path: string,
    label: MessageKey,
    enabled: boolean,
  ): TemplateResult {
    const text = this.t.t(label);
    return html`<button
      data-testid=${`edit-${command}`}
      title=${text}
      aria-label=${text}
      ?disabled=${!enabled}
      @click=${() => {
        fire(this, "domotwin-edit-command", command);
      }}
    >
      ${icon(path)}
    </button>`;
  }

  private status(): TemplateResult {
    const t = this.t;
    const state = this.state;
    const selection = state?.selection ?? [];
    if (state && state.conflicts.length > 0) {
      return html`<div class="status glass conflict" role="status" data-testid="edit-status">
        ${icon(mdiAlertOutline)}<span>${t.t("edit.conflict")}</span>
      </div>`;
    }
    const first = selection[0];
    let text: string;
    let locked = false;
    if (!first) text = t.t("edit.hint");
    else if (selection.length > 1) text = t.tp("edit.selected", selection.length);
    else if (first.locked) {
      text = t.t("edit.locked", { name: first.name || t.kind(first.kind) });
      locked = true;
    } else text = first.name || t.kind(first.kind);
    return html`<div class="status glass" role="status" data-testid="edit-status">
      ${locked ? icon(mdiLock) : nothing}<span>${text}</span>
    </div>`;
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const state = this.state;
    const movable = (state?.selection ?? []).some((piece) => !piece.locked);
    return html`${this.status()}
      <div class="bar glass" role="toolbar" aria-label=${t.t("edit.toolbar")}>
        ${this.button("undo", mdiUndo, "edit.undo", state?.canUndo ?? false)}
        ${this.button("redo", mdiRedo, "edit.redo", state?.canRedo ?? false)}
        <span class="separator" aria-hidden="true"></span>
        ${this.button("rotate-left", mdiRotateLeft, "edit.rotate_left", movable)}
        ${this.button("rotate-right", mdiRotateRight, "edit.rotate_right", movable)}
        ${this.button("remove", mdiDeleteOutline, "edit.remove", movable)}
        <button
          data-testid="edit-several"
          title=${t.t("edit.several")}
          aria-label=${t.t("edit.several")}
          aria-pressed=${this.multi ? "true" : "false"}
          @click=${() => {
            fire(this, "domotwin-edit-multi", !this.multi);
          }}
        >
          ${icon(mdiSelectMultiple)}
        </button>
        <span class="separator" aria-hidden="true"></span>
        <button
          class="add"
          data-testid="edit-add"
          aria-label=${t.t("edit.add")}
          @click=${() => {
            fire(this, "domotwin-edit-catalogue", {});
          }}
        >
          ${icon(mdiPlus)}<span class="label">${t.t("edit.add")}</span>
        </button>
      </div>`;
  }
}

export class DomoTwinCatalogue extends Sheet {
  static override properties = {
    ...Sheet.properties,
    kinds: { attribute: false },
    models: { attribute: false },
    query: { state: true },
  };
  static override styles = [
    baseStyles,
    sheetStyles,
    css`
      input {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      .kinds {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 6px;
        margin-top: 6px;
      }
      .kinds button {
        display: grid;
        gap: 2px;
        min-height: 52px;
        padding: 8px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .kinds button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 6%, transparent);
      }
      .kinds small {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.75rem;
      }
      .kinds .model {
        position: relative;
        display: grid;
      }
      .kinds .model .forget {
        position: absolute;
        top: 4px;
        right: 4px;
        min-height: 0;
        width: 32px;
        height: 32px;
        padding: 0;
        place-items: center;
        border: none;
        border-radius: 50%;
      }
      .kinds .model .add-model {
        padding-right: 36px;
      }
      .kinds .import {
        display: flex;
        align-items: center;
        gap: 8px;
        grid-column: 1 / -1;
        border-style: dashed;
      }
    `,
  ];

  kinds: CatalogueKind[] = [];
  models: UserModel[] = [];
  protected query = "";

  /** « My models »: the plan's own models, and the import of a 3D file. */
  private renderModels(): TemplateResult {
    const t = this.t;
    const models = matchingModels(this.models, t, this.query);
    return html`<h3>${t.t("edit.my_models")}</h3>
      <div class="kinds">
        ${models.map(
          (model) =>
            html`<div class="model">
              <button
                class="add-model"
                data-testid=${`catalogue-model-${model.id}`}
                @click=${() => {
                  fire(this, "domotwin-add-model", { id: model.id });
                }}
              >
                <span>${model.name || t.t("model.default_name")}</span>
                <small
                  >${t.t("edit.size", { w: model.w, d: model.d, h: model.h })}${
                    model.format ? ` · ${model.format.toUpperCase()}` : ""
                  }</small
                >
              </button>
              ${
                model.removable
                  ? html`<button
                      class="forget"
                      data-testid=${`catalogue-forget-${model.id}`}
                      title=${t.t("edit.forget_model", { name: model.name })}
                      aria-label=${t.t("edit.forget_model", { name: model.name })}
                      @click=${() => {
                        fire(this, "domotwin-forget-model", { id: model.id });
                      }}
                    >
                      ${icon(mdiDeleteOutline)}
                    </button>`
                  : nothing
              }
            </div>`,
        )}
        <button
          class="import"
          data-testid="catalogue-import-model"
          @click=${() => {
            fire(this, "domotwin-import-model", {});
          }}
        >
          ${icon(mdiCubeOutline)}
          <span
            >${t.t("edit.import_model")}<br /><small>${t.t("edit.import_model_hint")}</small></span
          >
        </button>
      </div>`;
  }

  override firstUpdated(): void {
    this.renderRoot.querySelector("input")?.focus();
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const groups = catalogueGroups(this.kinds, t, this.query);
    return this.frame(
      html`<input
          type="search"
          data-testid="catalogue-search"
          placeholder=${t.t("edit.search")}
          aria-label=${t.t("edit.search")}
          .value=${this.query}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
        ${this.renderModels()}
        ${groups.length === 0 ? html`<p class="empty">${t.t("edit.no_match")}</p>` : nothing}
        ${groups.map(
          ({ group, kinds }) =>
            html`<h3>${t.t(`edit.group_${group}` as MessageKey)}</h3>
              <div class="kinds">
                ${kinds.map((kind) => {
                  const name = t.kind(kind.kind);
                  return html`<button
                    data-testid=${`catalogue-${kind.kind}`}
                    @click=${() => {
                      fire(this, "domotwin-add", { kind: kind.kind, name });
                    }}
                  >
                    <span>${name}</span>
                    <small>${t.t("edit.size", { w: kind.w, d: kind.d, h: kind.h })}</small>
                  </button>`;
                })}
              </div>`,
        )}`,
    );
  }
}

/** What the import of a 3D file settled. */
export interface ModelChoice {
  name: string;
  /** Width, depth, height (cm). */
  size: [number, number, number];
  up: "y" | "z";
  /** The colour of a model without colours of its own. */
  color?: string;
}

/** The colour of new pieces of a model without one (`plan-format.md`). */
const MODEL_COLOR = "#b8ad9a";

export class DomoTwinModelImport extends Sheet {
  static override properties = {
    ...Sheet.properties,
    info: { attribute: false },
    format: { attribute: false },
    fileName: { attribute: false },
    busy: { attribute: false },
    name: { state: true },
    unit: { state: true },
    up: { state: true },
    size: { state: true },
    color: { state: true },
  };
  static override styles = [
    baseStyles,
    sheetStyles,
    css`
      form {
        display: grid;
        gap: 10px;
      }
      label {
        display: grid;
        gap: 4px;
        font-size: 0.875rem;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      input[type="color"] {
        padding: 4px;
      }
      .detail,
      .invalid {
        margin: 0;
        font-size: 0.8rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .invalid {
        color: var(--error-color, #db4437);
      }
      .footer button {
        min-height: 40px;
        padding: 0 16px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-color, #03a9f4);
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
      .footer button.primary {
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
      }
      .footer button:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ];

  info?: ModelInfo;
  format: ModelFormat = "glb";
  fileName = "";
  busy = false;
  protected name = "";
  protected unit: ModelUnit = "cm";
  protected up: "y" | "z" = "y";
  protected size: [number, number, number] = [1, 1, 1];
  protected color = MODEL_COLOR;

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("info") && this.info) {
      this.name = this.fileName.replace(/\.[^.]+$/, "").slice(0, 100);
      this.unit = guessUnit(this.info, this.format);
      this.up = this.info.up;
      this.resize();
    }
  }

  private resize(): void {
    if (this.info) this.size = modelSize(this.info, this.unit, this.up);
  }

  private confirm(): void {
    if (!validSize(this.size) || this.busy) return;
    const choice: ModelChoice = {
      name: this.name.trim() || this.t.t("model.default_name"),
      size: this.size,
      up: this.up,
    };
    if (!this.info?.colors) choice.color = this.color;
    fire(this, "domotwin-model-confirm", choice);
  }

  private dimension(index: 0 | 1 | 2, label: MessageKey): TemplateResult {
    return html`<label
      >${this.t.t(label)}
      <input
        type="number"
        inputmode="decimal"
        min="1"
        max=${index === 2 ? 300 : 10_000}
        step="0.1"
        data-testid=${`model-size-${index}`}
        .value=${String(this.size[index])}
        @input=${(event: Event) => {
          const size = [...this.size] as [number, number, number];
          size[index] = Number((event.target as HTMLInputElement).value);
          this.size = size;
        }}
    /></label>`;
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const info = this.info;
    const valid = validSize(this.size);
    const units = Object.keys(UNITS) as ModelUnit[];
    return this.frame(
      html`<form
        @submit=${(event: Event) => {
          event.preventDefault();
          this.confirm();
        }}
      >
        <p class="detail">
          ${this.fileName}${info ? html` · ${t.tp("model.triangles", info.triangles)}` : nothing}
        </p>
        <label
          >${t.t("model.name")}
          <input
            data-testid="model-name"
            maxlength="100"
            .value=${this.name}
            @input=${(event: Event) => {
              this.name = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <label
          >${t.t("model.unit")}
          <select
            data-testid="model-unit"
            @change=${(event: Event) => {
              this.unit = (event.target as HTMLSelectElement).value as ModelUnit;
              this.resize();
            }}
          >
            ${units.map(
              (unit) =>
                html`<option value=${unit} ?selected=${unit === this.unit}>
                  ${t.t(`model.unit_${unit}` as MessageKey)}
                </option>`,
            )}
          </select></label
        >
        <label
          >${t.t("model.up")}
          <select
            data-testid="model-up"
            @change=${(event: Event) => {
              this.up = (event.target as HTMLSelectElement).value as "y" | "z";
              this.resize();
            }}
          >
            <option value="y" ?selected=${this.up === "y"}>${t.t("model.up_y")}</option>
            <option value="z" ?selected=${this.up === "z"}>${t.t("model.up_z")}</option>
          </select></label
        >
        <div class="row">
          ${this.dimension(0, "model.width")} ${this.dimension(1, "model.depth")}
          ${this.dimension(2, "model.height")}
        </div>
        ${valid ? nothing : html`<p class="invalid" role="alert">${t.t("model.size_invalid")}</p>`}
        ${
          info && !info.colors
            ? html`<label
                >${t.t("model.color")}
                <input
                  type="color"
                  data-testid="model-color"
                  .value=${this.color}
                  @input=${(event: Event) => {
                    this.color = (event.target as HTMLInputElement).value;
                  }}
              /></label>`
            : nothing
        }
      </form>`,
      html`<div class="footer">
        <button
          @click=${() => {
            this.close();
          }}
        >
          ${t.t("panel.cancel")}
        </button>
        <button
          class="primary"
          data-testid="model-import"
          ?disabled=${!valid || this.busy}
          @click=${() => {
            this.confirm();
          }}
        >
          ${this.busy ? t.t("model.importing") : t.t("model.import")}
        </button>
      </div>`,
    );
  }
}

define("domotwin-edit-bar", DomoTwinEditBar);
define("domotwin-catalogue", DomoTwinCatalogue);
define("domotwin-model-import", DomoTwinModelImport);
