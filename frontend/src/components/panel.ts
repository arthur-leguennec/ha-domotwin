import {
  mdiCheck,
  mdiClose,
  mdiCogOutline,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiTrayArrowDown,
  mdiTrayArrowUp,
  mdiStairs,
  mdiVectorSquareEdit,
} from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import {
  EngineError,
  applyLayout,
  catalogue,
  summarizePlan,
  type CatalogueKind,
  type EditState,
  type HomeStorey,
  type PickedElement,
  type UserModel,
} from "../engine/engine";
import { DEFAULT_ACCENT, THEME_MODES, readAccent, resolveLook, type ThemeMode } from "../config";
import {
  DomoTwinClient,
  type PlanJson,
  type Settings,
  type StoreyInfo,
  type StoredPlan,
} from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { readBindings, roomArea, type BindingsJson, type ElementBinding } from "../live/bindings";
import {
  clearDraft,
  clearPlanDraft,
  readDraft,
  readPlanDraft,
  writeDraft,
  writePlanDraft,
  type Draft,
  type PlanDraft,
} from "../live/draft";
import {
  ALL_STOREYS,
  idsElsewhere,
  loadHome,
  loadStorey,
  roomsElsewhere,
  storeyIds,
  storeyLevels,
  storeyName,
  type StoreyRooms,
} from "../live/storeys";
import { applyLink, planElement, type LinkChange, type PlanElementInfo } from "../live/suggest";
import type { IfcFile, IfcReport, IfcStorey } from "../ifc/ifc";
import type { ModelFormat, ModelInfo } from "../models/models";
import { translatorFor, type Translator } from "../i18n";
import { icon } from "./icon";
import { baseStyles, lookStyles } from "./styles";
import type { ModelChoice } from "./edit-bar";
import type { PlanEditState, PlanTool } from "./plan-editor";
import type { DomoTwinView, EditCommand, PlanCommand, ViewOptions } from "./view";

/** The plan format allows files up to 32 MB. */
const MAX_FILE_BYTES = 32_000_000;
/** IFC files are read in the browser's memory: larger ones are refused. */
const MAX_IFC_BYTES = 200_000_000;
const PANEL_OPTIONS: ViewOptions = {
  quality: "auto",
  view: "3d",
  cutaway: "auto",
  lighting: "auto",
};
const TOAST_MS = 6000;
/** The highest a storey's floor may be (cm), as the integration checks. */
const MAX_ELEVATION = 100_000;
/** The plan drawn is kept by the browser once the drawing pauses this long (ms). */
const PLAN_DRAFT_MS = 800;

interface Toast {
  text: string;
  error: boolean;
}

/** An IFC file waiting for the user to pick a storey. */
interface IfcChoice {
  file: IfcFile;
  name: string;
  storeys: IfcStorey[];
}

/** A message already translated (a refused model of an imported plan). */
class TranslatedError extends Error {
  override name = "TranslatedError";
}

/** The 3D files of a plan total at most this (`plan-format.md`). */
const MAX_MODELS_BYTES = 20_000_000;

/** A 3D file read, waiting for its name and size. */
interface ModelImport {
  fileName: string;
  format: ModelFormat;
  bytes: Uint8Array;
  info: ModelInfo;
  mesh: Uint8Array;
}

/** A user model of a plan, as far as the import and export read it. */
interface PlanModel {
  name?: unknown;
  file?: { format?: unknown; hash?: unknown; bytes?: unknown; up?: unknown; data?: unknown };
}

/** The element open in the link editor. */
interface LinkTarget {
  element: PlanElementInfo;
  binding?: ElementBinding;
  area?: string;
  roomArea?: string;
}

function fileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(Boolean)
    .join("-");
  return `${slug || "plan"}.plan.json`;
}

/** `<domotwin-panel>`: the full-screen DomoTwin in the sidebar, with import and export. */
export class DomoTwinPanel extends LitElement {
  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    plan: { state: true },
    layout: { state: true },
    planError: { state: true },
    bindings: { state: true },
    toast: { state: true },
    busy: { state: true },
    linking: { state: true },
    linkTarget: { state: true },
    ifcChoice: { state: true },
    editing: { state: true },
    edit: { state: true },
    multi: { state: true },
    catalogue: { state: true },
    models: { state: true },
    modelImport: { state: true },
    discardAsk: { state: true },
    draft: { state: true },
    settings: { state: true },
    northDraft: { state: true },
    lookDraft: { state: true },
    look: { reflect: true },
    planning: { state: true },
    planState: { state: true },
    planTool: { state: true },
    planOffer: { state: true },
    planDiscardAsk: { state: true },
    storeys: { state: true },
    storey: { state: true },
    showAll: { state: true },
    home: { state: true },
    elsewhere: { state: true },
    storeysOpen: { state: true },
    storeyRemoveAsk: { state: true },
    planNew: { state: true },
    planReserved: { state: true },
  };

  narrow = false;
  panel?: unknown;
  protected plan?: StoredPlan["plan"];
  protected layout?: StoredPlan["layout"];
  protected planError?: string;
  protected bindings?: BindingsJson;
  protected toast?: Toast;
  protected busy = false;
  protected linking = false;
  protected linkTarget?: LinkTarget;
  protected ifcChoice?: IfcChoice;
  /** Edit mode: on, its state, taps adding to the selection, the catalogue open. */
  protected editing = false;
  protected edit?: EditState;
  protected multi = false;
  protected catalogue?: CatalogueKind[];
  /** The plan's own models, in the catalogue. */
  protected models: UserModel[] = [];
  /** A 3D file being imported. */
  protected modelImport?: ModelImport;
  /** Asking whether to discard the changes. */
  protected discardAsk = false;
  /** Changes not saved, kept by this browser, offered when edit mode starts. */
  protected draft?: Draft;
  /** The home's settings, and north being set (the settings dialog is open). */
  protected settings?: Settings;
  protected northDraft?: number;
  /** The look being chosen in the settings (shown as it is chosen), while they are open. */
  protected lookDraft?: { theme: ThemeMode; accent: string };
  /** The look shown (D-027), on the element for the colours of the header and the dialogs. */
  look = "day";
  /** The storeys, the one shown, the storeys dialog and a storey being removed. */
  protected storeys: StoreyInfo[] = [];
  protected storey?: string;
  /**
   * Every storey at once (D-028): the view shows `home` while no tool runs; the tools work on
   * `storey`, shown alone meanwhile.
   */
  protected showAll = false;
  protected home?: HomeStorey[];
  /** The rooms of the storeys not shown, for their alerts. */
  protected elsewhere: StoreyRooms[] = [];
  protected storeysOpen = false;
  /** The changes of the storeys' names and heights, saved in turn. */
  private storeyChanges: Promise<void> = Promise.resolve();
  /** Counts the plan's loads: the answer to an older one is dropped. */
  private loads = 0;
  protected storeyRemoveAsk?: StoreyInfo;
  /** The plan editor draws a new storey; the ids of the other storeys' elements. */
  protected planNew = false;
  protected planReserved: string[] = [];
  /** Where the next file imported goes: the storey shown, or a new storey. */
  private importTarget: "storey" | "new" = "storey";
  /**
   * The plan editor: on, its state and tool, a plan drawn and kept by this browser (offered when
   * it starts), and the discard question.
   */
  protected planning = false;
  protected planState?: PlanEditState;
  protected planTool: PlanTool = "select";
  protected planOffer?: PlanDraft;
  protected planDiscardAsk = false;
  /** The stored revision the plan editor started from (saving is refused if another save came). */
  private planRevision?: number;
  private planDraftTimer?: number;
  private revision?: number;
  /**
   * The overlay's change count last seen: a draft is written only when the overlay changed (a drag
   * reports its guides every frame), and a count going back means the view started a new session.
   */
  private editChanges = 0;
  /** Saving: the save's own update event is not a save from another device. */
  private saving = false;
  /** The stored revision edit mode started from (saving is refused if another save came). */
  private editRevision?: number;
  private _hass?: HomeAssistant;
  private unsubscribe?: () => void;
  private toastTimer?: number;

  static override styles = [
    baseStyles,
    lookStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--primary-background-color, #fafafa);
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--header-height, 56px);
        padding: 0 12px;
        box-sizing: border-box;
        background: var(--app-header-background-color, var(--primary-color, #03a9f4));
        color: var(--app-header-text-color, var(--text-primary-color, #fff));
        border-bottom: var(--app-header-border-bottom, none);
      }
      .toolbar h1 {
        margin: 0 0 0 4px;
        font-size: 1.25rem;
        font-weight: 400;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .toolbar button.action {
        background: rgba(255, 255, 255, 0.16);
        color: inherit;
      }
      :host([narrow]) .toolbar .label {
        display: none;
      }
      domotwin-view {
        flex: 1;
      }
      .toast {
        position: absolute;
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: min(560px, calc(100% - 32px));
        padding: 10px 10px 10px 16px;
      }
      .toast.error {
        border-color: var(--error-color, #db4437);
      }
      .toast button {
        border: none;
        background: none;
        color: inherit;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: grid;
      }
      .body {
        position: relative;
        flex: 1;
        display: flex;
      }
      input[type="file"] {
        display: none;
      }
      .storeys {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(420px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        padding: 16px;
        display: grid;
        gap: 6px;
        z-index: 3;
      }
      .storeys h2 {
        margin: 0 0 6px;
        font-size: 1.05rem;
        font-weight: 600;
      }
      .storeys button.storey {
        display: grid;
        gap: 2px;
        text-align: start;
        padding: 10px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .storeys button.storey:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 6%, transparent);
      }
      .storeys .detail {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .storeys .footer,
      .ask .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .toast.top {
        bottom: auto;
        top: 20px;
      }
      .ask {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(380px, calc(100% - 32px));
        padding: 16px;
        display: grid;
        gap: 12px;
        z-index: 3;
      }
      .ask h2,
      .ask p {
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
      }
      .draft {
        position: absolute;
        top: 12px;
        left: 12px;
        right: 68px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 8px 8px 14px;
        z-index: 2;
      }
      .draft span {
        flex: 1;
        min-width: 160px;
      }
      .ask label.north {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      .ask label.north input {
        grid-column: 1 / -1;
        width: 100%;
        accent-color: var(--primary-color, #03a9f4);
      }
      .ask label.look {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 10px;
      }
      .ask label.look select {
        min-height: 36px;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      .ask label.look input[type="color"] {
        width: 48px;
        height: 32px;
        padding: 0;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 8px;
        background: none;
      }
      .compass {
        display: flex;
        align-items: center;
        gap: 6px;
        font-variant-numeric: tabular-nums;
      }
      .compass svg {
        width: 28px;
        height: 28px;
        fill: var(--error-color, #db4437);
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 50%;
      }
      .empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .storeys.manage {
        width: min(520px, calc(100% - 32px));
        gap: 10px;
      }
      .storeys .hint {
        margin: 4px 0 0;
        font-size: 0.85rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .storey-row {
        display: grid;
        grid-template-columns: 1fr 120px auto;
        align-items: end;
        gap: 8px;
      }
      .storey-row label {
        display: grid;
        gap: 2px;
        font-size: 0.75rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .storey-row input {
        box-sizing: border-box;
        min-height: 36px;
        width: 100%;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font: inherit;
        font-size: 0.875rem;
      }
      .storey-row input[aria-invalid="true"] {
        border-color: var(--error-color, #db4437);
      }
      .storey-row .icon-button {
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
      .storey-row .icon-button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .storeys .footer {
        flex-wrap: wrap;
      }
      .ask p.hint {
        font-size: 0.85rem;
        font-weight: 400;
        color: var(--secondary-text-color, #5f6368);
      }
    `,
  ];

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  set hass(hass: HomeAssistant | undefined) {
    const first = !this._hass && hass;
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
    if (first && this.isConnected) this.connectData();
  }

  private get t(): Translator {
    return translatorFor(this._hass);
  }

  private get client(): DomoTwinClient | undefined {
    return this._hass ? DomoTwinClient.for(this._hass) : undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._hass) this.connectData();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.planDraftTimer);
    this.cancelIfc();
  }

  private connectData(): void {
    const client = this.client;
    if (!client || this.unsubscribe) return;
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "plan") void this.loadPlan();
      else if (event.kind === "bindings") void this.loadBindings();
      else void this.loadSettings();
    });
    void this.loadPlan();
    void this.loadBindings();
    void this.loadSettings();
  }

  /** Without settings the home shows with north up. */
  private async loadSettings(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      this.settings = (await client.getSettings()).settings;
    } catch {
      this.settings = undefined;
    }
  }

  private readonly openSettings = (): void => {
    this.northDraft = this.settings?.north ?? 0;
    this.lookDraft = {
      theme: this.settings?.theme ?? "auto",
      accent: this.settings?.accent ?? DEFAULT_ACCENT,
    };
  };

  private readonly saveSettings = async (): Promise<void> => {
    const client = this.client;
    const north = this.northDraft;
    if (!client || north === undefined) return;
    this.busy = true;
    try {
      const settings: Settings = { ...this.settings, north };
      // The look is stored once one is chosen (automatic and the default accent until then).
      const look = this.lookDraft;
      if (look && (look.theme !== "auto" || settings.theme !== undefined)) {
        settings.theme = look.theme;
      }
      if (look && (look.accent !== DEFAULT_ACCENT || settings.accent !== undefined)) {
        settings.accent = look.accent;
      }
      await client.saveSettings(settings);
      this.settings = settings;
      this.northDraft = undefined;
      this.show(this.t.t("settings.saved"));
    } catch (error) {
      const t = this.t;
      const reason = isHassError(error) ? t.error(error.code) : t.error("unknown");
      this.show(t.t("settings.save_failed", { reason }), true);
    } finally {
      this.busy = false;
    }
  };

  /** Without bindings the home still shows, without live states. */
  private async loadBindings(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      this.bindings = readBindings((await client.getBindings()).bindings);
    } catch {
      this.bindings = undefined;
    }
  }

  private async loadPlan(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const ticket = ++this.loads;
    try {
      // The storey shown, or the ground floor when it was removed (here or elsewhere); every
      // storey's too to show them all, before anything changes (D-028: two with a plan at least).
      const stored = await loadStorey(client, this.storey);
      const storeys =
        this.showAll && stored.storeys.length > 1 ? await loadHome(client, stored.storeys) : [];
      const home = storeys.length > 1 ? storeys : undefined;
      // A later load (another storey asked for) wins.
      if (ticket !== this.loads) return;
      const started = this.editing ? this.editRevision : this.planRevision;
      if ((this.editing || this.planning) && !this.saving && stored.revision !== started) {
        // Saved elsewhere: the view keeps the plan being edited; saving will be refused.
        this.show(this.t.t("edit.changed_elsewhere"), true);
      }
      this.plan = stored.plan;
      this.layout = stored.layout;
      this.storeys = stored.storeys;
      this.storey = stored.storey ?? undefined;
      void this.loadElsewhere(client, stored);
      this.revision = stored.revision;
      this.planError = undefined;
      this.showAll &&= home !== undefined;
      this.home = home;
    } catch (error) {
      this.planError = isHassError(error) ? error.code : "unknown";
    }
  }

  /** The rooms of the other storeys (plans the client has are not fetched again). */
  private async loadElsewhere(client: DomoTwinClient, stored: StoredPlan): Promise<void> {
    const elsewhere =
      stored.storeys.length > 1 ? await roomsElsewhere(client, stored.storeys, stored.storey) : [];
    // Another storey shown meanwhile: its own load sets them.
    if ((stored.storey ?? undefined) === this.storey) this.elsewhere = elsewhere;
  }

  private show(text: string, error = false): void {
    this.toast = { text, error };
    window.clearTimeout(this.toastTimer);
    if (!error) this.toastTimer = window.setTimeout(() => (this.toast = undefined), TOAST_MS);
  }

  private describe(error: unknown): string {
    if (error instanceof EngineError) return this.t.errorAt(error.code, error.element);
    if (isHassError(error)) return this.t.error(error.code);
    if (error instanceof TranslatedError) return error.message;
    return this.t.error(error instanceof Error ? error.name : "unknown");
  }

  private get view(): DomoTwinView | null {
    return this.renderRoot.querySelector("domotwin-view");
  }

  private readonly startEdit = async (): Promise<void> => {
    if (!this.plan || this.busy || this.editing || this.planning) return;
    await import("./edit-bar");
    this.linking = false;
    this.linkTarget = undefined;
    // A north being set and not saved is dropped.
    this.northDraft = undefined;
    this.multi = false;
    this.busy = true;
    try {
      // Pieces added take no id another storey uses (D-026).
      this.planReserved = await this.otherIds(this.storey);
    } catch {
      // Saving would be refused (`duplicate_id`) if one clashed.
      this.planReserved = [];
    } finally {
      this.busy = false;
    }
    this.editRevision = this.revision;
    this.editChanges = 0;
    const draft =
      this.revision === undefined ? undefined : readDraft(this.revision, this.storey ?? "");
    if (draft && JSON.stringify(draft.layout) !== JSON.stringify(this.layout ?? {})) {
      this.draft = draft;
    }
    this.editing = true;
  };

  private stopEditing(): void {
    this.editing = false;
    this.edit = undefined;
    this.multi = false;
    this.catalogue = undefined;
    this.modelImport = undefined;
    this.discardAsk = false;
    this.draft = undefined;
  }

  /** Every change of the edit session: kept as a draft while it is not saved. */
  private readonly onEdit = (event: Event): void => {
    const state = (event as CustomEvent<EditState>).detail;
    this.edit = state.editing ? state : undefined;
    if (!state.editing || state.changes === this.editChanges) return;
    const restarted = state.changes < this.editChanges;
    this.editChanges = state.changes;
    if (restarted) {
      // The view started a new session (its engine restarted): offer what was kept.
      const draft =
        this.editRevision === undefined
          ? undefined
          : readDraft(this.editRevision, this.storey ?? "");
      if (draft) this.draft = draft;
      return;
    }
    const layout = state.dirty ? this.view?.editLayout() : undefined;
    if (layout && this.editRevision !== undefined) {
      writeDraft({ revision: this.editRevision, storey: this.storey ?? "", layout });
    } else if (!this.draft) {
      // Undone back to what is stored: nothing left to keep.
      clearDraft(this.storey ?? "");
    }
  };

  private readonly onEditCommand = (event: Event): void => {
    this.view?.editCommand((event as CustomEvent<EditCommand>).detail);
  };

  private readonly openCatalogue = async (): Promise<void> => {
    this.models = this.view?.editModels() ?? [];
    this.catalogue = await catalogue();
  };

  private readonly onAdd = (event: Event): void => {
    const { kind, name } = (event as CustomEvent<{ kind: string; name: string }>).detail;
    this.catalogue = undefined;
    this.view?.editAdd(kind, name);
  };

  private readonly onAddModel = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.catalogue = undefined;
    this.view?.editAddModel(id);
  };

  private readonly onForgetModel = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.view?.editRemoveModel(id);
    this.models = this.view?.editModels() ?? [];
  };

  private readonly chooseModel = (): void => {
    if (this.busy) return;
    this.renderRoot.querySelector<HTMLInputElement>("input.model-file")?.click();
  };

  /** Reads a 3D file with the model module (loaded now), then asks for its name and size. */
  private readonly readModelFile = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.show(t.t("edit.model_reading", { name: file.name }));
    try {
      const { MAX_MODEL_BYTES, formatOf, readModel } = await import("../models/models");
      const format = formatOf(file.name);
      if (!format) throw new EngineError("not_model");
      if (file.size > MAX_MODEL_BYTES) throw new EngineError("too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = await readModel(bytes, format);
      this.toast = undefined;
      this.catalogue = undefined;
      this.modelImport = { fileName: file.name, format, bytes, ...read };
    } catch (error) {
      this.show(t.t("edit.model_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  /** Uploads the file being imported and adds a piece of its new model. */
  private readonly confirmModel = async (event: Event): Promise<void> => {
    const choice = (event as CustomEvent<ModelChoice>).detail;
    const pending = this.modelImport;
    const hass = this._hass;
    if (!pending || !hass || this.busy) return;
    const t = this.t;
    this.busy = true;
    try {
      const stored = (this.view?.editModels() ?? []).reduce((sum, m) => sum + (m.bytes ?? 0), 0);
      if (stored + pending.bytes.length > MAX_MODELS_BYTES)
        throw new EngineError("models_too_large");
      const { keepMesh, newModelId, uploadModel } = await import("../models/models");
      const uploaded = await uploadModel(hass, pending.bytes, pending.format);
      keepMesh(uploaded.hash, pending.mesh);
      const definition: Record<string, unknown> = {
        name: choice.name,
        size: choice.size,
        file: {
          format: pending.format,
          hash: uploaded.hash,
          bytes: uploaded.bytes,
          up: choice.up,
        },
      };
      if (choice.color) definition.color = choice.color;
      this.modelImport = undefined;
      this.view?.editAddModel(newModelId(), definition, {
        hash: uploaded.hash,
        mesh: pending.mesh,
      });
    } catch (error) {
      this.show(t.t("edit.model_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  private readonly restoreDraft = (): void => {
    const draft = this.draft;
    this.draft = undefined;
    if (draft) this.view?.editRestore(draft.layout);
  };

  private readonly forgetDraft = (): void => {
    this.draft = undefined;
    clearDraft(this.storey ?? "");
  };

  /**
   * Saves the overlay. Changes made while it is on its way stay in edit mode, to be saved too;
   * otherwise edit mode ends.
   */
  private readonly saveEdit = async (): Promise<void> => {
    const view = this.view;
    const client = this.client;
    const sent = view?.editLayout();
    if (!view || !client || !sent || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.saving = true;
    try {
      const revision = await client.saveLayout(sent, this.editRevision, this.storey);
      this.editRevision = revision;
      // The home shown whole comes back with what was saved, not before.
      this.home = undefined;
      view.editSaved(sent);
      const now = view.editLayout();
      if (now && JSON.stringify(now) !== JSON.stringify(sent)) {
        writeDraft({ revision, storey: this.storey ?? "", layout: now });
      } else {
        clearDraft(this.storey ?? "");
        this.stopEditing();
      }
      await this.loadPlan();
      this.show(t.t("edit.saved"));
    } catch (error) {
      this.show(t.t("edit.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
      this.saving = false;
    }
  };

  private readonly cancelEdit = (): void => {
    if (this.edit?.dirty) {
      this.discardAsk = true;
      return;
    }
    this.discardEdit();
  };

  private readonly discardEdit = (): void => {
    // A draft still offered stays, unless changes were discarded on purpose.
    if (this.edit?.dirty || !this.draft) clearDraft(this.storey ?? "");
    this.view?.endEdit(false);
    this.stopEditing();
  };

  /**
   * Starts the plan editor: on the plan shown, or on a new plan when none is stored or for a new
   * storey (`newStorey`).
   */
  private async startPlanFor(newStorey: boolean): Promise<void> {
    if (this.busy || this.editing || this.planning || this.plan === undefined) return;
    this.busy = true;
    try {
      await import("./plan-bar");
      // Ids are the home's: those of the other storeys are not given to new elements.
      this.planReserved = await this.otherIds(newStorey ? undefined : this.storey);
    } catch (error) {
      this.show(this.t.t("plan.open_failed", { reason: this.describe(error) }), true);
      return;
    } finally {
      this.busy = false;
    }
    this.linking = false;
    this.linkTarget = undefined;
    this.northDraft = undefined;
    this.storeysOpen = false;
    this.planNew = newStorey;
    this.planRevision = this.revision;
    this.planTool = this.plan && !newStorey ? "select" : "room";
    this.planOffer =
      this.revision === undefined ? undefined : readPlanDraft(this.revision, this.draftStorey());
    this.planning = true;
  }

  private readonly startPlan = (): void => {
    void this.startPlanFor(false);
  };

  /** What the plan editor's draft is kept for: the storey shown, or "" for a new storey. */
  private draftStorey(): string {
    return this.planNew ? "" : (this.storey ?? "");
  }

  /** The ids every storey but `except` uses. */
  private async otherIds(except?: string): Promise<string[]> {
    const client = this.client;
    return client ? idsElsewhere(client, this.storeys, except) : [];
  }

  /** A plan joining the home (an import): its ids that other storeys use are changed. */
  private async ownIds(plan: PlanJson, except?: string): Promise<PlanJson> {
    const taken = await this.otherIds(except);
    if (taken.length === 0) return plan;
    const { freeIds } = await import("../planner/planner");
    return await freeIds(plan, taken);
  }

  /**
   * Where a new storey goes: 2.8 m above the highest one, on the ground (0) when that is within
   * 1 m of it (a home with only a cellar), within the 1 000 m a height may be.
   */
  private nextElevation(): number {
    if (this.storeys.length === 0) return 0;
    const next = Math.max(...this.storeys.map((storey) => storey.elevation)) + 280;
    return Math.abs(next) < 100 ? 0 : Math.min(next, MAX_ELEVATION);
  }

  private stopPlanning(): void {
    window.clearTimeout(this.planDraftTimer);
    this.planning = false;
    this.planNew = false;
    this.planState = undefined;
    this.planOffer = undefined;
    this.planDiscardAsk = false;
  }

  /** Every change of the plan editor: a refused change said, the plan drawn kept by the browser. */
  private readonly onPlanEdit = (event: Event): void => {
    const state = (event as CustomEvent<PlanEditState>).detail;
    const before = this.planState;
    this.planState = state;
    const t = this.t;
    if (state.error && state.refusals !== before?.refusals) {
      this.show(
        state.error === "no_side"
          ? t.t("plan.no_side")
          : t.t("plan.refused", { reason: t.error(state.error) }),
        true,
      );
    }
    window.clearTimeout(this.planDraftTimer);
    this.planDraftTimer = window.setTimeout(() => {
      this.keepPlanDraft();
    }, PLAN_DRAFT_MS);
  };

  private keepPlanDraft(): void {
    const revision = this.planRevision;
    if (!this.planning || revision === undefined) return;
    const plan = this.planState?.dirty ? this.view?.planDraft() : undefined;
    if (plan) writePlanDraft({ revision, storey: this.draftStorey(), plan });
    else if (!this.planOffer) clearPlanDraft(this.draftStorey());
  }

  private readonly onPlanCommand = (event: Event): void => {
    this.view?.planCommand((event as CustomEvent<PlanCommand>).detail);
  };

  private readonly onPlanUpdate = (event: Event): void => {
    this.view?.planUpdate((event as CustomEvent<Record<string, unknown>>).detail);
  };

  private readonly restorePlanDraft = (): void => {
    const offer = this.planOffer;
    this.planOffer = undefined;
    if (offer) this.view?.planRestore(offer.plan);
  };

  private readonly forgetPlanDraft = (): void => {
    this.planOffer = undefined;
    clearPlanDraft(this.draftStorey());
  };

  /**
   * Saves the plan drawn, its edit overlay in it (the stored overlay is emptied), and leaves the
   * plan editor. Refused when another device saved since it started.
   */
  private readonly savePlanEdit = async (): Promise<void> => {
    const view = this.view;
    const client = this.client;
    const plan = view?.planDraft();
    if (!view || !client || !plan || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.saving = true;
    try {
      if (this.planNew) {
        const added = await client.saveStorey(
          { plan, layout: {}, elevation: this.nextElevation() },
          this.planRevision,
        );
        this.storey = added.storey;
      } else {
        await client.savePlan(plan, this.planRevision, {}, this.storey);
      }
      this.home = undefined;
      view.planSaved();
      clearPlanDraft(this.draftStorey());
      view.endPlanEdit(true);
      this.stopPlanning();
      await this.loadPlan();
      this.show(t.t("plan.saved"));
    } catch (error) {
      this.show(t.t("plan.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
      this.saving = false;
    }
  };

  private readonly cancelPlan = (): void => {
    if (this.planState?.dirty) {
      this.planDiscardAsk = true;
      return;
    }
    this.discardPlan();
  };

  private readonly discardPlan = (): void => {
    // A draft still offered stays, unless changes were discarded on purpose.
    if (this.planState?.dirty || !this.planOffer) clearPlanDraft(this.draftStorey());
    this.view?.endPlanEdit(false);
    this.stopPlanning();
  };

  private readonly toggleLinking = (): void => {
    this.linking = !this.linking;
    this.linkTarget = undefined;
    this.northDraft = undefined;
  };

  /** Link mode: an element was picked in the view, open its editor. */
  private readonly onPick = async (event: Event): Promise<void> => {
    const picked = (event as CustomEvent<PickedElement>).detail;
    const hass = this._hass;
    const element = planElement(this.plan, picked.id);
    if (!hass || !element) return;
    await import("./link-editor");
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    const roomId = element.type === "room" ? element.id : picked.room || element.parent;
    const target: LinkTarget = { element };
    const binding = bindings.elements[element.id];
    if (binding) target.binding = binding;
    const area = element.type === "room" ? bindings.rooms[element.id]?.area : undefined;
    if (area) target.area = area;
    if (roomId) {
      const room = roomArea(hass, bindings, roomId, planElement(this.plan, roomId)?.name ?? "");
      if (room) target.roomArea = room;
    }
    this.linkTarget = target;
  };

  /** Saves one edit on top of the latest stored bindings, refused if another save came first. */
  private readonly onLinkSave = async (event: Event): Promise<void> => {
    const change = (event as CustomEvent<LinkChange>).detail;
    const client = this.client;
    if (!client) return;
    const t = this.t;
    this.busy = true;
    try {
      const stored = await client.getBindings();
      await client.saveBindings(applyLink(readBindings(stored.bindings), change), stored.revision);
      this.linkTarget = undefined;
      await this.loadBindings();
      this.show(t.t("link.saved"));
    } catch (error) {
      this.show(t.t("link.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  private readonly chooseFile = (): void => {
    // One import at a time: not while a file is read or its storey is being chosen.
    if (this.busy || this.ifcChoice) return;
    this.importTarget = "storey";
    this.renderRoot.querySelector<HTMLInputElement>("input.plan-file")?.click();
  };

  /** Whether the view shows every storey at once: chosen, and no tool works on a storey. */
  private wholeHome(): boolean {
    return (
      this.showAll && this.home !== undefined && !this.editing && !this.planning && !this.linking
    );
  }

  /** The view's storey switcher: another storey is shown, or all of them (not while editing). */
  private readonly onStorey = (event: Event): void => {
    if (this.editing || this.planning) return;
    const storey = (event as CustomEvent<string>).detail;
    this.showAll = storey === ALL_STOREYS;
    if (!this.showAll) this.storey = storey;
    this.linkTarget = undefined;
    void this.loadPlan();
  };

  private readonly openStoreys = (): void => {
    this.northDraft = undefined;
    this.linkTarget = undefined;
    this.storeyRemoveAsk = undefined;
    this.storeysOpen = true;
  };

  /** Changes a storey's name or height, at once. */
  private changeStorey(
    storey: StoreyInfo,
    change: { name?: string; elevation?: number },
  ): Promise<void> {
    const client = this.client;
    if (!client) return Promise.resolve();
    // One after the other: a height typed while a name is being saved is saved next.
    this.storeyChanges = this.storeyChanges.then(async () => {
      try {
        await client.saveStorey({ storey: storey.id, ...change });
        await this.loadPlan();
      } catch (error) {
        this.show(this.t.t("storey.save_failed", { reason: this.describe(error) }), true);
      }
    });
    return this.storeyChanges;
  }

  private async removeStorey(storey: StoreyInfo, name: string): Promise<void> {
    const client = this.client;
    if (!client || this.busy) return;
    this.busy = true;
    try {
      await client.removeStorey(storey.id);
      this.storeyRemoveAsk = undefined;
      if (this.storey === storey.id) this.storey = undefined;
      await this.loadPlan();
      this.show(this.t.t("storey.removed", { name }));
    } catch (error) {
      this.show(this.t.t("storey.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  }

  private readonly drawStorey = (): void => {
    this.storeysOpen = false;
    void this.startPlanFor(true);
  };

  private readonly importStoreyFile = (): void => {
    if (this.busy || this.ifcChoice) return;
    this.storeysOpen = false;
    this.importTarget = "new";
    this.renderRoot.querySelector<HTMLInputElement>("input.plan-file")?.click();
  };

  private readonly importFile = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    const client = this.client;
    if (!file || !client || this.busy || this.ifcChoice) return;
    if (/\.ifc$/i.test(file.name)) {
      await this.readIfc(file);
      return;
    }
    const t = this.t;
    this.busy = true;
    try {
      if (file.size > MAX_FILE_BYTES) throw new EngineError("too_large");
      const text = await file.text();
      const summary = await summarizePlan(text);
      const read = JSON.parse(text.replace(/^\uFEFF/, "")) as PlanJson;
      await this.storeEmbeddedModels(read);
      await this.storePlan(read);
      this.show(t.t("panel.imported", { title: summary.title || t.t("view.untitled") }));
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  /**
   * The 3D files an exported plan embeds (`data:` URLs) are read, checked and uploaded, and the
   * plan keeps only their references. A file that is refused fails the import with its model's
   * name.
   */
  private async storeEmbeddedModels(plan: PlanJson): Promise<void> {
    const hass = this._hass;
    const models = plan.models;
    if (!hass || typeof models !== "object" || models === null) return;
    const embedded = Object.values(models as Record<string, PlanModel>).filter(
      (model) => typeof model.file?.data === "string",
    );
    if (embedded.length === 0) return;
    const t = this.t;
    this.show(t.t("panel.models_reading"));
    const { MODEL_FORMATS, fromDataUrl, keepMesh, readModel, uploadModel } =
      await import("../models/models");
    for (const model of embedded) {
      const file = model.file ?? {};
      const name = typeof model.name === "string" ? model.name : "";
      try {
        const format = MODEL_FORMATS.find((f) => f === file.format);
        const bytes = fromDataUrl(String(file.data));
        if (!format || !bytes) throw new EngineError("not_model");
        const read = await readModel(bytes, format);
        const uploaded = await uploadModel(hass, bytes, format);
        keepMesh(uploaded.hash, read.mesh);
        file.hash = uploaded.hash;
        file.bytes = uploaded.bytes;
        delete file.data;
      } catch (error) {
        throw new TranslatedError(
          t.t("panel.model_refused", { name, reason: this.describe(error) }),
          { cause: error },
        );
      }
    }
  }

  /** Reads an IFC file with the IFC module (loaded now), then imports its storey or asks which. */
  private async readIfc(file: File): Promise<void> {
    const t = this.t;
    this.busy = true;
    this.show(t.t("panel.ifc_reading", { name: file.name }));
    let ifc: IfcFile | undefined;
    try {
      if (file.size > MAX_IFC_BYTES) throw new EngineError("too_large");
      const { IfcFile } = await import("../ifc/ifc");
      ifc = await IfcFile.read(new Uint8Array(await file.arrayBuffer()));
      const storeys = ifc.storeys().filter((s) => s.spaces > 0);
      const only = storeys[0];
      if (!only) throw new EngineError("no_spaces");
      if (storeys.length > 1) {
        this.ifcChoice = { file: ifc, name: file.name, storeys };
        ifc = undefined;
        this.toast = undefined;
        return;
      }
      await this.importStorey(ifc, only, file.name);
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      ifc?.dispose();
      this.busy = false;
    }
  }

  /** Converts a storey, has the engine check the plan, stores it and says what was left out. */
  private async importStorey(ifc: IfcFile, storey: IfcStorey, name: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    const { plan, report } = ifc.convert(storey.id, name);
    const summary = await summarizePlan(JSON.stringify(plan));
    await this.storePlan(plan);
    const imported = t.t("panel.ifc_imported", { title: summary.title || t.t("view.untitled") });
    const left = this.leftOut(report);
    this.show(left ? `${imported} ${t.t("panel.ifc_left_out", { list: left })}` : imported);
  }

  /**
   * Stores an imported plan: in the storey shown (its overlay kept, for an updated plan), or as a
   * new storey above the others; its ids that other storeys use are changed first.
   */
  private async storePlan(read: PlanJson): Promise<void> {
    const client = this.client;
    if (!client) return;
    const target = this.importTarget;
    this.importTarget = "storey";
    if (target === "new") {
      const plan = await this.ownIds(read);
      const added = await client.saveStorey({ plan, elevation: this.nextElevation() });
      this.storey = added.storey;
    } else {
      await client.savePlan(
        await this.ownIds(read, this.storey),
        undefined,
        undefined,
        this.storey,
      );
    }
    await this.loadPlan();
  }

  /**
   * Every storey of an IFC file with rooms: each plan read by the engine first, then they replace
   * the home's storeys in one save (all of them, or none if one is refused).
   */
  private async importAllStoreys(choice: IfcChoice): Promise<void> {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    const storeys: { plan: PlanJson; name: string; elevation: number }[] = [];
    const taken: string[] = [];
    const { freeIds } = await import("../planner/planner");
    for (const storey of choice.storeys) {
      const converted = choice.file.convert(storey.id, choice.name).plan;
      const plan = (await freeIds(converted, taken)) as PlanJson;
      await summarizePlan(JSON.stringify(plan));
      taken.push(...storeyIds(plan));
      storeys.push({ plan, name: storey.name.slice(0, 60), elevation: storey.elevation });
    }
    await client.replaceStoreys(storeys);
    // The server's ground floor.
    this.storey = undefined;
    await this.loadPlan();
    this.show(t.tp("storey.ifc_all_imported", storeys.length));
  }

  private leftOut(report: IfcReport): string {
    const t = this.t;
    const parts: string[] = [];
    if (report.unplacedOpenings > 0)
      parts.push(t.tp("panel.ifc_unplaced", report.unplacedOpenings));
    if (report.skippedFurniture > 0)
      parts.push(t.tp("panel.ifc_skipped_furniture", report.skippedFurniture));
    if (report.skippedSpaces > 0)
      parts.push(t.tp("panel.ifc_skipped_spaces", report.skippedSpaces));
    if (report.overLimit > 0) parts.push(t.tp("panel.ifc_over_limit", report.overLimit));
    return parts.join(", ");
  }

  private async pickStorey(storey: IfcStorey): Promise<void> {
    const choice = this.ifcChoice;
    if (!choice) return;
    this.ifcChoice = undefined;
    this.busy = true;
    try {
      await this.importStorey(choice.file, storey, choice.name);
    } catch (error) {
      this.show(this.t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      choice.file.dispose();
      this.busy = false;
    }
  }

  private async pickAllStoreys(): Promise<void> {
    const choice = this.ifcChoice;
    if (!choice) return;
    this.ifcChoice = undefined;
    this.busy = true;
    try {
      await this.importAllStoreys(choice);
    } catch (error) {
      this.show(this.t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      choice.file.dispose();
      this.busy = false;
    }
  }

  private readonly cancelIfc = (): void => {
    this.ifcChoice?.file.dispose();
    this.ifcChoice = undefined;
  };

  private readonly exportPlan = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    try {
      const { plan: stored, layout } = await client.getPlan(this.storey);
      if (!stored) {
        this.show(t.t("panel.nothing_to_export"));
        return;
      }
      // The plan as it is now: the edits of edit mode applied.
      const plan = JSON.parse(
        await applyLayout(JSON.stringify(stored), JSON.stringify(layout)),
      ) as PlanJson;
      const missing = await this.embedModels(plan);
      const title = typeof plan.title === "string" ? plan.title : "";
      const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // With several storeys, the file says which.
      const level = storeyLevels(this.storeys).find(({ storey }) => storey.id === this.storey);
      link.download = fileName(
        level && this.storeys.length > 1
          ? `${title} ${storeyName(t, level.storey, level.level)}`
          : title,
      );
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      if (missing > 0) this.show(t.tp("panel.models_not_embedded", missing), true);
    } catch (error) {
      this.show(t.t("panel.export_failed", { reason: this.describe(error) }), true);
    }
  };

  /**
   * Embeds the plan's 3D files as `data:` URLs, so that it opens with its models elsewhere. A
   * model whose file cannot be fetched is left out with its pieces. Returns how many.
   */
  private async embedModels(plan: PlanJson): Promise<number> {
    const hass = this._hass;
    const models = plan.models as Record<string, PlanModel> | null | undefined;
    if (!hass || !models || typeof models !== "object") return 0;
    const files = Object.entries(models).filter(([, m]) => typeof m.file?.hash === "string");
    if (files.length === 0) return 0;
    const { MODEL_FORMATS, fetchModel, toDataUrl } = await import("../models/models");
    const left: string[] = [];
    for (const [id, model] of files) {
      const file = model.file ?? {};
      const format = MODEL_FORMATS.find((f) => f === file.format);
      try {
        if (!format) throw new EngineError("not_model");
        file.data = toDataUrl(await fetchModel(hass, String(file.hash), format), format);
      } catch {
        left.push(id);
      }
    }
    if (left.length > 0 && Array.isArray(plan.elements)) {
      for (const id of left) Reflect.deleteProperty(models, id);
      plan.elements = (plan.elements as { model?: unknown }[]).filter(
        (element) => typeof element.model !== "string" || !left.includes(element.model),
      );
    }
    return left.length;
  }

  private renderStoreys(choice: IfcChoice): TemplateResult {
    const t = this.t;
    const metres = new Intl.NumberFormat(t.language, { maximumFractionDigits: 2 });
    return html`<div
      class="storeys glass"
      role="dialog"
      aria-label=${t.t("panel.ifc_pick", { name: choice.name })}
      data-testid="ifc-storeys"
    >
      <h2>${t.t("panel.ifc_pick", { name: choice.name })}</h2>
      ${choice.storeys.map(
        (storey) =>
          html`<button
            class="storey"
            @click=${() => {
              void this.pickStorey(storey);
            }}
          >
            <span class="name">${storey.name || t.t("view.untitled")}</span>
            <span class="detail"
              >${t.tp("view.rooms", storey.spaces)} · ${metres.format(storey.elevation / 100)}
              m</span
            >
          </button>`,
      )}
      <p class="hint">${t.t("storey.ifc_all_hint")}</p>
      <div class="footer">
        <button class="action quiet" @click=${this.cancelIfc}>${t.t("panel.cancel")}</button>
        <button
          class="action"
          data-testid="ifc-all"
          @click=${() => {
            void this.pickAllStoreys();
          }}
        >
          ${t.t("storey.ifc_all")}
        </button>
      </div>
    </div>`;
  }

  /** The home's look (as being chosen, while the settings are open). */
  private homeLook(): { theme?: ThemeMode; accent?: string } {
    const draft = this.northDraft !== undefined ? this.lookDraft : undefined;
    return {
      theme: draft?.theme ?? this.settings?.theme,
      accent: draft?.accent ?? this.settings?.accent,
    };
  }

  protected override willUpdate(): void {
    const { theme, accent } = this.homeLook();
    this.look = resolveLook(theme, this._hass);
    this.style.setProperty("--domotwin-accent", accent ?? DEFAULT_ACCENT);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const admin = this._hass?.user?.is_admin === true;
    // One template in both modes: the view stays the same element (engine, camera, 2D or 3D).
    return html`<div class="toolbar">
        <ha-menu-button .hass=${this._hass} .narrow=${this.narrow}></ha-menu-button>
        <h1>
          ${
            this.editing
              ? t.t("edit.title")
              : this.planning
                ? t.t("plan.title")
                : t.t("panel.title")
          }
        </h1>
        ${
          this.editing
            ? this.renderEditActions()
            : this.planning
              ? this.renderPlanActions()
              : this.renderActions(admin)
        }
      </div>
      <div class="body">
        <domotwin-view
          .hass=${this._hass}
          .plan=${this.plan}
          .layout=${this.layout}
          .bindings=${this.bindings}
          .planError=${this.planError}
          .options=${PANEL_OPTIONS}
          .north=${this.northDraft ?? this.settings?.north ?? 0}
          .linking=${this.linking}
          .editing=${this.editing}
          .planEditing=${this.planning}
          .planTool=${this.planTool}
          .planBlank=${this.planNew}
          .planReserved=${this.planReserved}
          .homeTheme=${this.homeLook().theme}
          .homeAccent=${this.homeLook().accent}
          .storeys=${this.storeys}
          .storey=${this.wholeHome() ? ALL_STOREYS : this.storey}
          .home=${this.wholeHome() ? this.home : undefined}
          .elsewhere=${this.wholeHome() ? [] : this.elsewhere}
          @domotwin-storey=${this.onStorey}
          .multiSelect=${this.multi}
          .editKeys=${!this.catalogue && !this.discardAsk && !this.modelImport && !this.planDiscardAsk}
          @domotwin-pick=${this.onPick}
          @domotwin-edit=${this.onEdit}
          @domotwin-plan-edit=${this.onPlanEdit}
        >
          ${
            admin
              ? html`<span slot="empty-action" class="empty-actions">
                  <button class="action" @click=${this.chooseFile}>
                    ${icon(mdiTrayArrowUp)}${t.t("panel.import")}
                  </button>
                  <button class="action" data-testid="plan-new" @click=${this.startPlan}>
                    ${icon(mdiVectorSquareEdit)}${t.t("plan.new")}
                  </button>
                </span>`
              : nothing
          }
        </domotwin-view>
        ${
          this.editing
            ? this.renderEditTools()
            : this.planning
              ? this.renderPlanTools()
              : this.renderSheets()
        }
        ${this.renderToast()}
      </div>
      <input
        class="plan-file"
        type="file"
        accept=".json,application/json,.ifc"
        @change=${this.importFile}
      />
      <input
        class="model-file"
        type="file"
        accept=".glb,.gltf,.obj,.stl,.3mf"
        @change=${this.readModelFile}
      />`;
  }

  private renderActions(admin: boolean): TemplateResult {
    const t = this.t;
    return html`${
        admin
          ? html`<button
              class="action"
              ?disabled=${this.busy || this.ifcChoice !== undefined}
              @click=${this.chooseFile}
              aria-label=${t.t("panel.import")}
            >
              ${icon(mdiTrayArrowUp)}<span class="label">${t.t("panel.import")}</span>
            </button>`
          : nothing
      }
      ${
        admin && this.plan && !this.linking
          ? html`<button
              class="action"
              data-testid="storeys-manage"
              ?disabled=${this.busy || this.ifcChoice !== undefined}
              @click=${this.openStoreys}
              aria-label=${t.t("storey.manage")}
              title=${t.t("storey.manage")}
            >
              ${icon(mdiStairs)}<span class="label">${t.t("storey.manage")}</span>
            </button>`
          : nothing
      }
      ${
        admin && this.plan && !this.linking
          ? html`<button
              class="action"
              data-testid="plan-mode"
              ?disabled=${this.busy || this.ifcChoice !== undefined}
              @click=${this.startPlan}
              aria-label=${t.t("plan.mode")}
              title=${t.t("plan.mode")}
            >
              ${icon(mdiVectorSquareEdit)}<span class="label">${t.t("plan.mode")}</span>
            </button>`
          : nothing
      }
      ${
        admin && this.plan && !this.linking
          ? html`<button
              class="action"
              data-testid="edit-mode"
              ?disabled=${this.busy || this.ifcChoice !== undefined}
              @click=${this.startEdit}
              aria-label=${t.t("edit.mode")}
            >
              ${icon(mdiPencilOutline)}<span class="label">${t.t("edit.mode")}</span>
            </button>`
          : nothing
      }
      ${
        admin && this.plan
          ? html`<button
              class="action"
              data-testid="link-mode"
              aria-pressed=${this.linking ? "true" : "false"}
              @click=${this.toggleLinking}
              aria-label=${this.linking ? t.t("link.done") : t.t("link.mode")}
            >
              ${icon(this.linking ? mdiCheck : mdiLinkVariant)}<span class="label"
                >${this.linking ? t.t("link.done") : t.t("link.mode")}</span
              >
            </button>`
          : nothing
      }
      <button class="action" @click=${this.exportPlan} aria-label=${t.t("panel.export")}>
        ${icon(mdiTrayArrowDown)}<span class="label">${t.t("panel.export")}</span>
      </button>
      ${
        admin && this.plan && !this.linking
          ? html`<button
              class="action"
              data-testid="settings"
              ?disabled=${this.busy}
              @click=${this.openSettings}
              aria-label=${t.t("settings.title")}
              title=${t.t("settings.title")}
            >
              ${icon(mdiCogOutline)}
            </button>`
          : nothing
      }`;
  }

  /** The home's settings: where north points on the plan, shown live while it is set. */
  private renderSettings(north: number): TemplateResult {
    const t = this.t;
    return html`<div
      class="ask glass"
      role="dialog"
      aria-labelledby="settings-title"
      data-testid="settings-dialog"
    >
      <h2 id="settings-title">${t.t("settings.title")}</h2>
      <label class="north">
        <span>${t.t("settings.north")}</span>
        <span class="compass" aria-hidden="true">
          <svg viewBox="-12 -12 24 24" style="transform:rotate(${north}deg)">
            <path d="M0 -10 L4 4 L0 1.5 L-4 4 Z"></path>
          </svg>
          <output>${t.t("settings.degrees", { value: north })}</output>
        </span>
        <input
          type="range"
          min="0"
          max="359"
          step="1"
          data-testid="settings-north"
          .value=${String(north)}
          @input=${(event: Event) => {
            this.northDraft = Number((event.target as HTMLInputElement).value);
          }}
        />
      </label>
      <p class="hint">${t.t("settings.north_hint")}</p>
      ${this.renderLookSettings()}
      <div class="footer">
        <button class="action quiet" @click=${() => (this.northDraft = undefined)}>
          ${t.t("panel.cancel")}
        </button>
        <button
          class="action"
          data-testid="settings-save"
          ?disabled=${this.busy}
          @click=${this.saveSettings}
        >
          ${t.t("settings.save")}
        </button>
      </div>
    </div>`;
  }

  /** The look of the home in the settings: shown as it is chosen, kept on Save. */
  private renderLookSettings(): TemplateResult | typeof nothing {
    const t = this.t;
    const draft = this.lookDraft;
    if (!draft) return nothing;
    return html`<label class="look">
        <span>${t.t("settings.theme")}</span>
        <select
          data-testid="settings-theme"
          @change=${(event: Event) => {
            const theme = (event.target as HTMLSelectElement).value as ThemeMode;
            this.lookDraft = { ...draft, theme };
          }}
        >
          ${THEME_MODES.map(
            (mode) =>
              html`<option value=${mode} ?selected=${mode === draft.theme}>
                ${t.t(`settings.theme_${mode}`)}
              </option>`,
          )}
        </select>
      </label>
      <label class="look">
        <span>${t.t("settings.accent")}</span>
        <input
          type="color"
          data-testid="settings-accent"
          .value=${draft.accent}
          @input=${(event: Event) => {
            const accent = readAccent((event.target as HTMLInputElement).value);
            if (accent) this.lookDraft = { ...draft, accent };
          }}
        />
      </label>
      <p class="hint">${t.t("settings.theme_hint")}</p>`;
  }

  /** Edit mode's header: Cancel and Save. */
  private renderEditActions(): TemplateResult {
    const t = this.t;
    return html`<button
        class="action"
        data-testid="edit-cancel"
        ?disabled=${this.busy}
        @click=${this.cancelEdit}
        aria-label=${t.t("edit.cancel")}
      >
        ${icon(mdiClose)}<span class="label">${t.t("edit.cancel")}</span>
      </button>
      <button
        class="action"
        data-testid="edit-save"
        ?disabled=${this.busy || !this.edit?.dirty}
        @click=${this.saveEdit}
        aria-label=${t.t("edit.save")}
      >
        ${icon(mdiCheck)}<span class="label">${t.t("edit.save")}</span>
      </button>`;
  }

  /** The plan editor's header: Cancel and Save. */
  private renderPlanActions(): TemplateResult {
    const t = this.t;
    return html`<button
        class="action"
        data-testid="plan-cancel"
        ?disabled=${this.busy}
        @click=${this.cancelPlan}
        aria-label=${t.t("edit.cancel")}
      >
        ${icon(mdiClose)}<span class="label">${t.t("edit.cancel")}</span>
      </button>
      <button
        class="action"
        data-testid="plan-save"
        ?disabled=${this.busy || !this.planState?.dirty}
        @click=${this.savePlanEdit}
        aria-label=${t.t("edit.save")}
      >
        ${icon(mdiCheck)}<span class="label">${t.t("edit.save")}</span>
      </button>`;
  }

  /** The plan editor over the view: its bar, the draft offer, the discard question. */
  private renderPlanTools(): TemplateResult {
    const t = this.t;
    return html`${
      this.planState
        ? html`<domotwin-plan-bar
            .hass=${this._hass}
            .state=${this.planState}
            .tool=${this.planTool}
            @domotwin-plan-tool=${(event: Event) => {
              this.planTool = (event as CustomEvent<PlanTool>).detail;
            }}
            @domotwin-plan-command=${this.onPlanCommand}
            @domotwin-plan-update=${this.onPlanUpdate}
          ></domotwin-plan-bar>`
        : nothing
    }
    ${
      this.planOffer
        ? html`<div class="draft glass" role="status" data-testid="plan-draft">
            <span>${t.t("plan.draft")}</span>
            <button class="action quiet" @click=${this.forgetPlanDraft}>
              ${t.t("edit.forget")}
            </button>
            <button class="action" data-testid="plan-restore" @click=${this.restorePlanDraft}>
              ${t.t("edit.restore")}
            </button>
          </div>`
        : nothing
    }
    ${
      this.planDiscardAsk
        ? html`<div class="ask glass" role="alertdialog" data-testid="plan-discard">
            <h2>${t.t("plan.discard_title")}</h2>
            <div class="footer">
              <button class="action quiet" @click=${() => (this.planDiscardAsk = false)}>
                ${t.t("edit.keep")}
              </button>
              <button class="action" data-testid="plan-discard-confirm" @click=${this.discardPlan}>
                ${t.t("edit.discard")}
              </button>
            </div>
          </div>`
        : nothing
    }`;
  }

  /** Over the view outside edit mode: the link editor, the storey picker. */
  private renderSheets(): TemplateResult {
    const target = this.linkTarget;
    return html`${
      target
        ? html`<domotwin-link
            .hass=${this._hass}
            .heading=${target.element.name || target.element.id}
            .element=${target.element}
            .binding=${target.binding}
            .area=${target.area}
            .roomArea=${target.roomArea}
            .busy=${this.busy}
            @domotwin-link-save=${this.onLinkSave}
            @domotwin-close=${() => (this.linkTarget = undefined)}
          ></domotwin-link>`
        : nothing
    }
    ${this.ifcChoice ? this.renderStoreys(this.ifcChoice) : nothing}
    ${this.northDraft !== undefined ? this.renderSettings(this.northDraft) : nothing}
    ${this.storeysOpen ? this.renderStoreysDialog() : nothing}`;
  }

  /** The storeys of the home: name, height, removal; a new storey drawn or imported. */
  private renderStoreysDialog(): TemplateResult {
    const t = this.t;
    const metres = new Intl.NumberFormat("en", { maximumFractionDigits: 2, useGrouping: false });
    const ask = this.storeyRemoveAsk;
    const levels = storeyLevels(this.storeys).reverse();
    if (ask) {
      const level = levels.find(({ storey }) => storey.id === ask.id)?.level ?? 0;
      const name = storeyName(t, ask, level);
      return html`<div class="ask glass" role="alertdialog" data-testid="storey-remove">
        <h2>${t.t("storey.remove_title", { name })}</h2>
        <div class="footer">
          <button class="action quiet" @click=${() => (this.storeyRemoveAsk = undefined)}>
            ${t.t("panel.cancel")}
          </button>
          <button
            class="action"
            data-testid="storey-remove-confirm"
            ?disabled=${this.busy}
            @click=${() => {
              void this.removeStorey(ask, name);
            }}
          >
            ${t.t("storey.remove", { name })}
          </button>
        </div>
      </div>`;
    }
    return html`<div
      class="storeys glass manage"
      role="dialog"
      aria-labelledby="storeys-title"
      data-testid="storeys-dialog"
    >
      <h2 id="storeys-title">${t.t("storey.title")}</h2>
      ${levels.map(({ storey, level }) => {
        const name = storeyName(t, storey, level);
        return html`<div class="storey-row" data-storey=${storey.id}>
          <label
            >${t.t("storey.name")}
            <input
              data-testid="storey-name"
              ?disabled=${this.busy}
              maxlength="60"
              placeholder=${storeyName(t, { ...storey, name: "" }, level)}
              .value=${storey.name}
              @change=${(event: Event) => {
                const value = (event.target as HTMLInputElement).value.trim();
                if (value !== storey.name) void this.changeStorey(storey, { name: value });
              }}
          /></label>
          <label
            >${t.t("storey.elevation")}
            <input
              class="metres"
              data-testid="storey-elevation"
              ?disabled=${this.busy}
              inputmode="decimal"
              .value=${metres.format(storey.elevation / 100)}
              @change=${(event: Event) => {
                const input = event.target as HTMLInputElement;
                const value = Number(input.value.trim().replace(",", ".").replace("−", "-"));
                if (
                  !input.value.trim() ||
                  !Number.isFinite(value) ||
                  value < -100 ||
                  value > 1000
                ) {
                  input.setAttribute("aria-invalid", "true");
                  input.title = t.t("storey.bad_elevation");
                  return;
                }
                input.removeAttribute("aria-invalid");
                const elevation = Math.round(value * 100);
                if (elevation !== storey.elevation) void this.changeStorey(storey, { elevation });
              }}
          /></label>
          <button
            class="icon-button"
            data-testid="storey-remove-ask"
            title=${t.t("storey.remove", { name })}
            aria-label=${t.t("storey.remove", { name })}
            ?disabled=${this.busy || this.storeys.length < 2}
            @click=${() => (this.storeyRemoveAsk = storey)}
          >
            ${icon(mdiClose)}
          </button>
        </div>`;
      })}
      <div class="footer">
        <button class="action quiet" data-testid="storey-import" @click=${this.importStoreyFile}>
          ${icon(mdiTrayArrowUp)}${t.t("storey.import")}
        </button>
        <button class="action quiet" data-testid="storey-draw" @click=${this.drawStorey}>
          ${icon(mdiVectorSquareEdit)}${t.t("storey.draw")}
        </button>
        <button class="action" @click=${() => (this.storeysOpen = false)}>
          ${t.t("storey.close")}
        </button>
      </div>
    </div>`;
  }

  private renderToast(): TemplateResult | typeof nothing {
    const toast = this.toast;
    if (!toast) return nothing;
    return html`<div
      class="toast glass ${toast.error ? "error" : ""} ${this.editing || this.planning ? "top" : ""}"
      role=${toast.error ? "alert" : "status"}
      data-testid="toast"
    >
      <span>${toast.text}</span>
      <button @click=${() => (this.toast = undefined)} aria-label=${this.t.t("panel.dismiss")}>
        ${icon(mdiClose)}
      </button>
    </div>`;
  }

  /** Edit mode over the view: the edit bar, the catalogue, the draft offer, the discard question. */
  private renderEditTools(): TemplateResult {
    const t = this.t;
    // The catalogue covers the bottom of the view: the bar comes back when it closes.
    return html`${
      this.edit && !this.catalogue && !this.modelImport
        ? html`<domotwin-edit-bar
            .hass=${this._hass}
            .state=${this.edit}
            .multi=${this.multi}
            @domotwin-edit-command=${this.onEditCommand}
            @domotwin-edit-multi=${(event: Event) => {
              this.multi = (event as CustomEvent<boolean>).detail;
            }}
            @domotwin-edit-catalogue=${this.openCatalogue}
          ></domotwin-edit-bar>`
        : nothing
    }
    ${
      this.catalogue
        ? html`<domotwin-catalogue
            data-testid="catalogue"
            .hass=${this._hass}
            .heading=${t.t("edit.add")}
            .kinds=${this.catalogue}
            .models=${this.models}
            @domotwin-add=${this.onAdd}
            @domotwin-add-model=${this.onAddModel}
            @domotwin-forget-model=${this.onForgetModel}
            @domotwin-import-model=${this.chooseModel}
            @domotwin-close=${() => (this.catalogue = undefined)}
          ></domotwin-catalogue>`
        : nothing
    }
    ${
      this.modelImport
        ? html`<domotwin-model-import
            data-testid="model-import-sheet"
            .hass=${this._hass}
            .heading=${t.t("model.title")}
            .fileName=${this.modelImport.fileName}
            .format=${this.modelImport.format}
            .info=${this.modelImport.info}
            .busy=${this.busy}
            @domotwin-model-confirm=${this.confirmModel}
            @domotwin-close=${() => (this.modelImport = undefined)}
          ></domotwin-model-import>`
        : nothing
    }
    ${
      this.draft
        ? html`<div class="draft glass" role="status" data-testid="edit-draft">
            <span>${t.t("edit.draft")}</span>
            <button class="action quiet" @click=${this.forgetDraft}>${t.t("edit.forget")}</button>
            <button class="action" data-testid="edit-restore" @click=${this.restoreDraft}>
              ${t.t("edit.restore")}
            </button>
          </div>`
        : nothing
    }
    ${
      this.discardAsk
        ? html`<div class="ask glass" role="alertdialog" data-testid="edit-discard">
            <h2>${t.t("edit.discard_title")}</h2>
            <div class="footer">
              <button class="action quiet" @click=${() => (this.discardAsk = false)}>
                ${t.t("edit.keep")}
              </button>
              <button class="action" data-testid="edit-discard-confirm" @click=${this.discardEdit}>
                ${t.t("edit.discard")}
              </button>
            </div>
          </div>`
        : nothing
    }`;
  }
}
