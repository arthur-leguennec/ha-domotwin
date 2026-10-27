/**
 * Edit mode's tools (administrators, from the panel), loaded the first time edit mode opens:
 *
 * - `<domotwin-edit-bar>`: the bar at the bottom of the view (undo, redo, turn, remove, select
 *   several, add) and what is selected. It fires `domotwin-edit-command` (detail: the command),
 *   `domotwin-edit-multi` (detail: on or off) and `domotwin-edit-catalogue`;
 * - `<domotwin-catalogue>`: the pieces that can be added in each of their styles, by room, with a
 *   search and a picture of each drawn by an engine of its own (D-073), and the plan's own 3D
 *   models (« My models »). It fires `domotwin-add` (detail: `{ kind, style, name }`),
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

import { themeBackground } from "../color";
import { PieceArtist, type CatalogueKind, type EditState, type UserModel } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import {
  addMessages,
  translatorFor,
  type KindName,
  type MessageKey,
  type Translator,
} from "../i18n";
import { libraryEn, libraryFr } from "../i18n/library";
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

addMessages({ en: libraryEn, fr: libraryFr });

/** The catalogue's groups, in order; kinds in none go to "Other". */
export const GROUPS: [string, KindName[]][] = [
  [
    "living",
    [
      "sofa",
      "corner-sofa",
      "armchair",
      "rocking-chair",
      "ottoman",
      "coffee-table",
      "side-table",
      "round-table",
      "console",
      "tv",
      "tv-stand",
      "piano",
      "fireplace",
      "chest",
      "bench",
    ],
  ],
  ["dining", ["dining-table", "chair", "bar-stool", "sideboard"]],
  [
    "kitchen",
    [
      "counter",
      "kitchen-island",
      "sink",
      "stove",
      "oven",
      "fridge",
      "freezer",
      "wine-cooler",
      "dishwasher",
      "microwave",
      "coffee-machine",
      "kettle",
      "toaster",
      "hood",
      "wall-cabinet",
      "bulkhead",
      "backsplash",
      "trolley",
      "bin",
    ],
  ],
  ["bedroom", ["bed", "bunk-bed", "crib", "nightstand", "dresser", "tall-cabinet", "clothes-rack"]],
  [
    "bathroom",
    ["bathtub", "shower", "vanity", "toilet", "towel-radiator", "mirror", "laundry-basket"],
  ],
  [
    "utility",
    [
      "washer",
      "dryer",
      "robot-vacuum",
      "water-heater",
      "boiler",
      "furnace",
      "electrical-panel",
      "ev-charger",
      "car",
    ],
  ],
  ["climate", ["heat-pump", "radiator", "fan", "air-purifier", "dehumidifier", "humidifier"]],
  [
    "devices",
    [
      "speaker",
      "wall-tablet",
      "thermostat",
      "sensor",
      "smoke-detector",
      "camera",
      "router",
      "access-point",
    ],
  ],
  [
    "office",
    ["desk", "office-chair", "monitor", "computer", "filing-cabinet", "printer", "3d-printer"],
  ],
  [
    "storage",
    [
      "bookcase",
      "glazed-bookcase",
      "open-shelving",
      "shelf",
      "wall-shelf",
      "shoe-cabinet",
      "coat-rack",
    ],
  ],
  [
    "lights",
    [
      "floor-lamp",
      "table-lamp",
      "desk-lamp",
      "wall-light",
      "light-strip",
      "lantern",
      "pendant",
      "chandelier",
      "ceiling-light",
      "track-light",
      "spotlight",
      "ceiling-fan",
    ],
  ],
  [
    "decor",
    ["plant", "vase", "books", "clock", "rug", "aquarium", "curtain", "picture", "picture-wall"],
  ],
  ["fitness", ["treadmill", "exercise-bike"]],
  ["pets", ["pet-bed", "cat-tree", "litter-box", "pet-feeder"]],
];

/** A piece of the catalogue: a kind in one of its styles (none: its own), its usual size (cm). */
export interface CataloguePiece {
  kind: string;
  style?: string;
  w: number;
  d: number;
  h: number;
}

/** A piece's key: its kind, and its style after a dot. */
export function pieceKey(piece: CataloguePiece): string {
  return piece.style ? `${piece.kind}.${piece.style}` : piece.kind;
}

/** The name of a kind's style (D-073), else the style. */
export function styleName(t: Translator, kind: string, style: string): string {
  const key = `library.styles.${kind}.${style}` as MessageKey;
  const text = t.t(key);
  return text === key ? style : text;
}

/** The other words a kind is searched by, in the language; empty without any. */
function searchWords(t: Translator, kind: string): string {
  const key = `library.search.${kind}` as MessageKey;
  const text = t.t(key);
  return text === key ? "" : text;
}

/** Every piece of a kind: its own, then its styles. */
function piecesOf(kind: CatalogueKind): CataloguePiece[] {
  return [
    { kind: kind.kind, w: kind.w, d: kind.d, h: kind.h },
    ...kind.styles.map(({ style, w, d, h }) => ({ kind: kind.kind, style, w, d, h })),
  ];
}

/** Text folded for a search: lower case, without accents. */
function folded(text: string, t: Translator): string {
  return text.toLocaleLowerCase(t.language).normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** The plan's models whose name matches `query`. */
export function matchingModels(models: UserModel[], t: Translator, query = ""): UserModel[] {
  const wanted = folded(query.trim(), t);
  return models.filter((model) => !wanted || folded(model.name, t).includes(wanted));
}

/**
 * The catalogue's pieces in groups, translated and filtered by `query`: every word of it found in
 * the kind's name, its style's, the kind or the style themselves, or the other words the kind is
 * searched by (D-073).
 */
export function catalogueGroups(
  kinds: CatalogueKind[],
  t: Translator,
  query = "",
): { group: string; pieces: CataloguePiece[] }[] {
  const words = folded(query.trim(), t).split(/\s+/).filter(Boolean);
  const matches = (piece: CataloguePiece): boolean => {
    if (words.length === 0) return true;
    const text = folded(
      [
        t.kind(piece.kind),
        piece.kind,
        searchWords(t, piece.kind),
        piece.style ? `${styleName(t, piece.kind, piece.style)} ${piece.style}` : "",
      ].join(" "),
      t,
    );
    return words.every((word) => text.includes(word));
  };
  const placed = new Set<string>(GROUPS.flatMap(([, list]) => list));
  const groups = GROUPS.map(([group, list]) => ({
    group,
    pieces: list
      .map((name) => kinds.find((kind) => kind.kind === name))
      .filter((kind): kind is CatalogueKind => kind !== undefined)
      .flatMap(piecesOf)
      .filter(matches),
  }));
  groups.push({
    group: "other",
    pieces: kinds
      .filter((kind) => !placed.has(kind.kind))
      .flatMap(piecesOf)
      .filter(matches),
  });
  return groups.filter((group) => group.pieces.length > 0);
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

/** The size of a piece's picture in the catalogue (CSS pixels), drawn at twice that. */
const PICTURE = { width: 136, height: 102 };
/** Time given to the pictures in a frame (ms), so that the view and the sheet stay smooth. */
const PICTURE_BUDGET_MS = 10;
/** The pictures drawn this session, by look, accent, background and piece: drawn once. */
const drawnPictures = new Map<string, string>();

export class DomoTwinCatalogue extends Sheet {
  static override properties = {
    ...Sheet.properties,
    kinds: { attribute: false },
    models: { attribute: false },
    look: { attribute: false },
    accent: { attribute: false },
    query: { state: true },
    pictures: { state: true },
  };
  static override styles = [
    baseStyles,
    sheetStyles,
    css`
      @media (min-width: 640px) {
        :host {
          width: 520px;
        }
      }
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
      .kinds .piece {
        align-content: start;
        padding: 6px 6px 8px;
      }
      .kinds .picture {
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        margin-bottom: 4px;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 5%, transparent);
        object-fit: contain;
      }
      .kinds .piece span,
      .kinds .piece small {
        padding: 0 4px;
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
  /** The look and accent the view draws in: the pictures take them. */
  look = "day";
  accent = "";
  protected query = "";
  /** The pictures drawn so far, by piece (D-073). */
  protected pictures = new Map<string, string>();
  private artist?: PieceArtist;
  /** Waiting for its engine, or its engine refused (no picture then). */
  private artistDue?: Promise<void>;
  /** The look and accent the artist draws in. */
  private artistLook = "";
  private queue: CataloguePiece[] = [];
  private frameRequest?: number;
  private background = "#ffffff";

  override connectedCallback(): void {
    super.connectedCallback();
    const { r, g, b } = themeBackground(this, { r: 255, g: 255, b: 255 });
    this.background = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.frameRequest !== undefined) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = undefined;
    this.queue = [];
    this.artist?.dispose();
    this.artist = undefined;
    this.artistDue = undefined;
  }

  protected override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (["kinds", "query", "look", "accent"].some((key) => changed.has(key))) this.drawPictures();
  }

  /** The key of a piece's picture among those drawn this session. */
  private pictureKey(piece: CataloguePiece): string {
    return `${this.look} ${this.accent} ${this.background} ${pieceKey(piece)}`;
  }

  /** Draws the pictures not drawn yet, the pieces shown first, a few each frame. */
  private drawPictures(): void {
    // Another look is drawn by another artist.
    const look = `${this.look} ${this.accent}`;
    if (look !== this.artistLook) {
      this.artist?.dispose();
      this.artist = undefined;
      this.artistDue = undefined;
      this.artistLook = look;
      this.pictures = new Map();
    }
    const shown = catalogueGroups(this.kinds, this.t, this.query).flatMap((g) => g.pieces);
    const all = this.kinds.flatMap(piecesOf);
    const missing = (piece: CataloguePiece): boolean =>
      !this.pictures.has(pieceKey(piece)) && !drawnPictures.has(this.pictureKey(piece));
    // Those drawn before, at once.
    const pictures = new Map(this.pictures);
    for (const piece of all) {
      const url = drawnPictures.get(this.pictureKey(piece));
      if (url) pictures.set(pieceKey(piece), url);
    }
    if (pictures.size !== this.pictures.size) this.pictures = pictures;
    this.queue = [...shown.filter(missing), ...all.filter((p) => missing(p) && !shown.includes(p))];
    if (this.queue.length === 0) return;
    this.artistDue ??= PieceArtist.create(this.look, this.accent).then(
      (artist) => {
        if (this.isConnected && this.artistLook === look) this.artist = artist;
        else artist.dispose();
      },
      () => {
        // No second WebGL context: the pieces go without pictures.
        this.queue = [];
      },
    );
    void this.artistDue.then(() => {
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.frameRequest !== undefined || !this.artist || this.queue.length === 0) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = undefined;
      this.drawSome();
    });
  }

  /** Draws pictures for a few milliseconds, then leaves the frame to the rest. */
  private drawSome(): void {
    const artist = this.artist;
    if (!artist) return;
    const started = performance.now();
    const canvas = document.createElement("canvas");
    canvas.width = PICTURE.width * 2;
    canvas.height = PICTURE.height * 2;
    const context = canvas.getContext("2d");
    const pictures = new Map(this.pictures);
    while (this.queue.length > 0 && performance.now() - started < PICTURE_BUDGET_MS && context) {
      const piece = this.queue.shift() as CataloguePiece;
      const picture = artist.draw(
        piece.kind,
        piece.style ?? "",
        canvas.width,
        canvas.height,
        this.background,
      );
      if (!picture) continue;
      context.putImageData(picture, 0, 0);
      const url = canvas.toDataURL("image/png");
      drawnPictures.set(this.pictureKey(piece), url);
      pictures.set(pieceKey(piece), url);
    }
    this.pictures = pictures;
    this.schedule();
  }

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

  protected override render(): TemplateResult {
    const t = this.t;
    const groups = catalogueGroups(this.kinds, t, this.query);
    return this.frame(
      html`<input
          type="search"
          data-autofocus
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
          ({ group, pieces }) =>
            html`<h3>${t.t(`edit.group_${group}` as MessageKey)}</h3>
              <div class="kinds">
                ${pieces.map((piece) => {
                  const name = t.kind(piece.kind);
                  const size = t.t("edit.size", { w: piece.w, d: piece.d, h: piece.h });
                  const style = piece.style ? styleName(t, piece.kind, piece.style) : undefined;
                  const picture = this.pictures.get(pieceKey(piece));
                  return html`<button
                    class="piece"
                    data-testid=${`catalogue-${pieceKey(piece)}`}
                    title=${style ? `${name} · ${style}` : name}
                    @click=${() => {
                      fire(this, "domotwin-add", { kind: piece.kind, style: piece.style, name });
                    }}
                  >
                    ${
                      picture
                        ? html`<img class="picture" src=${picture} alt="" />`
                        : html`<span class="picture" aria-hidden="true"></span>`
                    }
                    <span>${name}</span>
                    <small>${style ? t.t("library.style_size", { style, size }) : size}</small>
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
