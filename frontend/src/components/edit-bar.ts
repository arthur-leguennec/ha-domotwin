/**
 * Edit mode's tools (administrators, from the panel), loaded the first time edit mode opens:
 *
 * - `<domotwin-edit-bar>`: the bar at the bottom of the view (undo, redo, turn, remove, select
 *   several, add) and what is selected. It fires `domotwin-edit-command` (detail: the command),
 *   `domotwin-edit-multi` (detail: on or off) and `domotwin-edit-catalogue`;
 * - `<domotwin-catalogue>`: the pieces that can be added, by room, with a search. It fires
 *   `domotwin-add` (detail: `{ kind, name }`).
 */
import {
  mdiAlertOutline,
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

import type { CatalogueKind, EditState } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
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

/** The catalogue in groups, translated and filtered by `query` (name or kind). */
export function catalogueGroups(
  kinds: CatalogueKind[],
  t: Translator,
  query = "",
): { group: string; kinds: CatalogueKind[] }[] {
  const wanted = query.trim().toLocaleLowerCase(t.language).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const matches = (kind: CatalogueKind): boolean => {
    if (!wanted) return true;
    const name = t
      .kind(kind.kind)
      .toLocaleLowerCase(t.language)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "");
    return name.includes(wanted) || kind.kind.includes(wanted);
  };
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
    `,
  ];

  kinds: CatalogueKind[] = [];
  protected query = "";

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

define("domotwin-edit-bar", DomoTwinEditBar);
define("domotwin-catalogue", DomoTwinCatalogue);
