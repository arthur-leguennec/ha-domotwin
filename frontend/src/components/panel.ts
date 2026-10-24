import { mdiCheck, mdiClose, mdiLinkVariant, mdiTrayArrowDown, mdiTrayArrowUp } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { EngineError, summarizePlan, type PickedElement } from "../engine/engine";
import { DomoTwinClient, type PlanJson, type StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { readBindings, roomArea, type BindingsJson, type ElementBinding } from "../live/bindings";
import { applyLink, planElement, type LinkChange, type PlanElementInfo } from "../live/suggest";
import type { IfcFile, IfcReport, IfcStorey } from "../ifc/ifc";
import { translatorFor, type Translator } from "../i18n";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import type { ViewOptions } from "./view";

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
    planError: { state: true },
    bindings: { state: true },
    toast: { state: true },
    busy: { state: true },
    linking: { state: true },
    linkTarget: { state: true },
    ifcChoice: { state: true },
  };

  narrow = false;
  panel?: unknown;
  protected plan?: StoredPlan["plan"];
  protected planError?: string;
  protected bindings?: BindingsJson;
  protected toast?: Toast;
  protected busy = false;
  protected linking = false;
  protected linkTarget?: LinkTarget;
  protected ifcChoice?: IfcChoice;
  private _hass?: HomeAssistant;
  private unsubscribe?: () => void;
  private toastTimer?: number;

  static override styles = [
    baseStyles,
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
      .storeys .footer {
        display: flex;
        justify-content: flex-end;
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
    this.cancelIfc();
  }

  private connectData(): void {
    const client = this.client;
    if (!client || this.unsubscribe) return;
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "plan") void this.loadPlan();
      else void this.loadBindings();
    });
    void this.loadPlan();
    void this.loadBindings();
  }

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
    try {
      this.plan = (await client.getPlan()).plan;
      this.planError = undefined;
    } catch (error) {
      this.planError = isHassError(error) ? error.code : "unknown";
    }
  }

  private show(text: string, error = false): void {
    this.toast = { text, error };
    window.clearTimeout(this.toastTimer);
    if (!error) this.toastTimer = window.setTimeout(() => (this.toast = undefined), TOAST_MS);
  }

  private describe(error: unknown): string {
    if (error instanceof EngineError) return this.t.errorAt(error.code, error.element);
    if (isHassError(error)) return this.t.error(error.code);
    return this.t.error(error instanceof Error ? error.name : "unknown");
  }

  private readonly toggleLinking = (): void => {
    this.linking = !this.linking;
    this.linkTarget = undefined;
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
    this.renderRoot.querySelector<HTMLInputElement>("input[type=file]")?.click();
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
      const plan = JSON.parse(text.replace(/^\uFEFF/, "")) as PlanJson;
      await client.savePlan(plan);
      await this.loadPlan();
      this.show(t.t("panel.imported", { title: summary.title || t.t("view.untitled") }));
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

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
    await client.savePlan(plan);
    await this.loadPlan();
    const imported = t.t("panel.ifc_imported", { title: summary.title || t.t("view.untitled") });
    const left = this.leftOut(report);
    this.show(left ? `${imported} ${t.t("panel.ifc_left_out", { list: left })}` : imported);
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

  private readonly cancelIfc = (): void => {
    this.ifcChoice?.file.dispose();
    this.ifcChoice = undefined;
  };

  private readonly exportPlan = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    try {
      const { plan } = await client.getPlan();
      if (!plan) {
        this.show(t.t("panel.nothing_to_export"));
        return;
      }
      const title = typeof plan.title === "string" ? plan.title : "";
      const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(title);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (error) {
      this.show(t.t("panel.export_failed", { reason: this.describe(error) }), true);
    }
  };

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
      <div class="footer">
        <button class="action quiet" @click=${this.cancelIfc}>${t.t("panel.cancel")}</button>
      </div>
    </div>`;
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const admin = this._hass?.user?.is_admin === true;
    return html`<div class="toolbar">
        <ha-menu-button .hass=${this._hass} .narrow=${this.narrow}></ha-menu-button>
        <h1>${t.t("panel.title")}</h1>
        ${
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
      </div>
      <div class="body">
        <domotwin-view
          .hass=${this._hass}
          .plan=${this.plan}
          .bindings=${this.bindings}
          .planError=${this.planError}
          .options=${PANEL_OPTIONS}
          .linking=${this.linking}
          @domotwin-pick=${this.onPick}
        >
          ${
            admin
              ? html`<button slot="empty-action" class="action" @click=${this.chooseFile}>
                  ${icon(mdiTrayArrowUp)}${t.t("panel.import")}
                </button>`
              : nothing
          }
        </domotwin-view>
        ${
          this.linkTarget
            ? html`<domotwin-link
                .hass=${this._hass}
                .heading=${this.linkTarget.element.name || this.linkTarget.element.id}
                .element=${this.linkTarget.element}
                .binding=${this.linkTarget.binding}
                .area=${this.linkTarget.area}
                .roomArea=${this.linkTarget.roomArea}
                .busy=${this.busy}
                @domotwin-link-save=${this.onLinkSave}
                @domotwin-close=${() => (this.linkTarget = undefined)}
              ></domotwin-link>`
            : nothing
        }
        ${this.ifcChoice ? this.renderStoreys(this.ifcChoice) : nothing}
        ${
          this.toast
            ? html`<div
                class="toast glass ${this.toast.error ? "error" : ""}"
                role=${this.toast.error ? "alert" : "status"}
              >
                <span>${this.toast.text}</span>
                <button @click=${() => (this.toast = undefined)} aria-label=${t.t("panel.dismiss")}>
                  ${icon(mdiClose)}
                </button>
              </div>`
            : nothing
        }
      </div>
      <input type="file" accept=".json,application/json,.ifc" @change=${this.importFile} />`;
  }
}
