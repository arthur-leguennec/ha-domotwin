/**
 * `<domotwin-history>`: the configuration history (D-057). The automations, scripts, scenes and
 * dashboards the integration kept, by kind and with a search; an item's versions, newest first,
 * with what each changed in words; one version put back through Home Assistant's own commands.
 * For administrators. Loaded, with its texts, when first opened.
 */
import { mdiArrowLeft, mdiClose, mdiOpenInNew } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { historyEn, historyFr } from "../i18n/history";
import { navigate } from "../live/actions";
import {
  HISTORY_KINDS,
  canPutBack,
  changesBetween,
  editorPath,
  filterItems,
  historyItem,
  historyList,
  historyVersion,
  itemName,
  putBack,
  refreshHistory,
  refusal,
  sayChange,
  type ChangeWords,
  type HistoryDetail,
  type HistoryItem,
  type HistoryKind,
  type HistoryList,
  type HistoryVersion,
} from "../live/history";
import { timeStyle } from "../live/schedules";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: historyEn, fr: historyFr });

/** What a version is compared with: the one before it, or the current one. */
type Compare = "before" | "current";

/** What was worked out for a version, kept until another is asked for. */
interface Worked {
  key: string;
  changes?: ChangeWords[];
  more: number;
  note?: string;
}

export class DomoTwinHistory extends LitElement {
  static override properties = {
    hass: { attribute: false },
    list: { state: true },
    kind: { state: true },
    search: { state: true },
    detail: { state: true },
    selected: { state: true },
    compare: { state: true },
    configs: { state: true },
    asking: { state: true },
    busy: { state: true },
    error: { state: true },
    status: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .dialog {
        pointer-events: auto;
        width: min(640px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        overflow: auto;
        box-sizing: border-box;
        padding: 16px;
        display: grid;
        gap: 12px;
        align-content: start;
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
        overflow-wrap: anywhere;
      }
      p {
        margin: 0;
      }
      .hint,
      .meta {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .error {
        color: var(--error-color, #d23a2f);
      }
      button.round {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        flex: none;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .kinds {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .kinds button {
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 0.875rem;
        cursor: pointer;
      }
      .kinds button[aria-pressed="true"] {
        background: var(--primary-color, #03a9f4);
        border-color: transparent;
        color: var(--text-primary-color, #fff);
      }
      input[type="search"] {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        padding: 0 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 4px;
      }
      .items button,
      .versions button.version {
        width: 100%;
        display: grid;
        gap: 2px;
        padding: 8px 10px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .items button:hover,
      .versions button.version:hover,
      .versions button.version[aria-expanded="true"] {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
      }
      .name {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      .badge {
        padding: 1px 8px;
        border-radius: 999px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.75rem;
        font-weight: 500;
      }
      .badge.removed {
        color: var(--error-color, #d23a2f);
      }
      .body {
        display: grid;
        gap: 10px;
        padding: 4px 10px 12px;
      }
      .compare {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 16px;
        font-size: 0.875rem;
      }
      .compare label {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .changes li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 8px;
        font-size: 0.875rem;
        overflow-wrap: anywhere;
      }
      .op {
        flex: none;
        min-width: 6.5em;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }
      [data-op="add"] .op {
        color: var(--success-color, #2e7d32);
      }
      [data-op="remove"] .op {
        color: var(--error-color, #d23a2f);
      }
      [data-op="change"] .op {
        color: var(--warning-color, #b26a00);
      }
      .place {
        font-weight: 500;
      }
      details pre {
        max-height: 40vh;
        overflow: auto;
        margin: 6px 0 0;
        padding: 8px;
        border-radius: 8px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
        font-size: 0.75rem;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      summary {
        cursor: pointer;
        font-size: 0.875rem;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ask {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
      }
      .ask h3 {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      a.open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--primary-color, #03a9f4);
        font-size: 0.875rem;
      }
      a.open svg.icon {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  hass?: HomeAssistant;
  protected list?: HistoryList;
  protected kind?: HistoryKind;
  protected search = "";
  /** The item open, and its version shown. */
  protected detail?: HistoryDetail;
  protected selected?: number;
  protected compare: Compare = "before";
  /** The configurations read, by version id (null: none kept), for the item open. */
  protected configs = new Map<number, unknown>();
  /** Putting the version shown back is being asked. */
  protected asking = false;
  protected busy = false;
  protected error?: string;
  protected status?: string;
  private started = false;
  private worked?: Worked;
  /** Where the focus goes once drawn: the back button, or the item left. */
  private focusNext?: string;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Home Assistant's states change all the time: the dialog reads what it needs itself. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.started);
  }

  override willUpdate(): void {
    if (!this.started && this.hass) {
      this.started = true;
      void this.readList();
    }
  }

  override updated(): void {
    if (!this.focusNext) return;
    const target = this.renderRoot.querySelector<HTMLElement>(this.focusNext);
    this.focusNext = undefined;
    target?.focus({ preventScroll: false });
  }

  private reason(error: unknown): string {
    if (isHassError(error)) return this.t.error(error.code);
    return this.t.error("unknown");
  }

  private async readList(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      const list = await historyList(hass);
      if (!this.isConnected) return;
      this.list = list;
      this.error = undefined;
    } catch (error) {
      if (!this.isConnected) return;
      this.error = this.t.t("history.read_failed", { reason: this.reason(error) });
    }
  }

  /** Opens an item on its newest version; the focus goes to the way back unless told where. */
  private async openItem(id: string, focus = "[data-back]"): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    try {
      const detail = await historyItem(hass, id);
      if (!this.isConnected) return;
      if (this.detail?.item.id !== id) this.configs = new Map();
      this.detail = detail;
      this.asking = false;
      this.error = undefined;
      this.focusNext = focus;
      await this.select(detail.versions[0]?.id);
    } catch (error) {
      if (!this.isConnected) return;
      this.error = this.t.t("history.read_failed", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private closeItem(): void {
    const left = this.detail?.item.id;
    this.detail = undefined;
    this.selected = undefined;
    this.asking = false;
    this.status = undefined;
    this.worked = undefined;
    if (left) this.focusNext = `[data-item="${CSS.escape(left)}"]`;
  }

  /** Shows a version (`toggle`: hides it when shown), and reads what it is compared with. */
  private async select(id: number | undefined, toggle = false): Promise<void> {
    this.selected = toggle && this.selected === id ? undefined : id;
    this.asking = false;
    this.worked = undefined;
    const detail = this.detail;
    if (!detail || this.selected === undefined) return;
    const index = detail.versions.findIndex((version) => version.id === this.selected);
    const wanted = [detail.versions[index], detail.versions[index + 1], detail.versions[0]];
    await this.read(wanted.filter((version): version is HistoryVersion => version?.kept === true));
  }

  private async read(versions: HistoryVersion[]): Promise<void> {
    const hass = this.hass;
    const item = this.detail?.item.id;
    if (!hass || !item) return;
    const missing = versions.filter((version) => !this.configs.has(version.id));
    if (missing.length === 0) return;
    try {
      const read = await Promise.all(
        missing.map(async (version) => [version.id, await historyVersion(hass, item, version.id)]),
      );
      if (!this.isConnected || this.detail?.item.id !== item) return;
      this.configs = new Map([...this.configs, ...(read as [number, unknown][])]);
    } catch (error) {
      if (!this.isConnected) return;
      this.error = this.t.t("history.read_failed", { reason: this.reason(error) });
    }
  }

  private async putBackShown(): Promise<void> {
    const hass = this.hass;
    const detail = this.detail;
    const version = detail?.versions.find((each) => each.id === this.selected);
    if (!hass || !detail || !version) return;
    this.busy = true;
    this.error = undefined;
    const t = this.t;
    const when = this.when(version.at);
    const name = itemName(t, detail.item);
    try {
      await this.read([version]);
      const config = this.configs.get(version.id);
      // Not read (its error is shown): nothing to hand Home Assistant.
      if (config === undefined || config === null) return;
      await putBack(hass, detail.item, config);
    } catch (error) {
      if (!this.isConnected) return;
      // Home Assistant's refusal as it gives it.
      const reason = refusal(error) ?? this.reason(error);
      this.error = t.t("history.put_back_failed", { reason });
      return;
    } finally {
      this.asking = false;
      this.busy = false;
    }
    if (!this.isConnected) return;
    this.status = t.t("history.put_back_done", { name, when });
    // The integration reads it again: its newest version is the one put back.
    let failed: string | undefined;
    try {
      await refreshHistory(hass, detail.item.kind);
    } catch (error) {
      failed = t.t("history.read_failed", { reason: this.reason(error) });
    }
    void this.readList();
    await this.openItem(detail.item.id, "[data-status]");
    if (failed) this.error = failed;
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** A moment as the user's Home Assistant writes it: its language, time zone, 12 or 24 h. */
  private when(at: string): string {
    const style: { language: string; timeZone?: string; hour12?: boolean } = this.hass
      ? timeStyle(this.hass)
      : { language: this.t.language };
    try {
      return new Intl.DateTimeFormat(style.language, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: style.timeZone,
        hour12: style.hour12,
      }).format(new Date(at));
    } catch {
      return at;
    }
  }

  private bytes(value: number): string {
    const megabytes = value >= 100_000;
    return new Intl.NumberFormat(this.t.language, {
      style: "unit",
      unit: megabytes ? "megabyte" : "kilobyte",
      maximumFractionDigits: 1,
    }).format(megabytes ? value / 1_000_000 : value / 1_000);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const detail = this.detail;
    const title = detail ? itemName(t, detail.item) : t.t("history.title");
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="history-title"
      aria-busy=${this.busy ? "true" : "false"}
      data-testid="history-dialog"
    >
      <header>
        ${
          detail
            ? html`<button
                class="round"
                data-back
                data-testid="history-back"
                aria-label=${t.t("history.back")}
                title=${t.t("history.back")}
                @click=${() => {
                  this.closeItem();
                }}
              >
                ${icon(mdiArrowLeft)}
              </button>`
            : nothing
        }
        <h2 id="history-title">${title}</h2>
        <button
          class="round"
          ?data-cancel=${!this.asking}
          aria-label=${t.t("history.close")}
          title=${t.t("history.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${detail ? this.renderItem(detail) : this.renderList()}
      <div role="status" data-status tabindex="-1">
        ${this.status ? html`<p data-testid="history-status">${this.status}</p>` : nothing}
      </div>
      ${
        this.error
          ? html`<p class="error" role="alert" data-testid="history-error">${this.error}</p>`
          : nothing
      }
    </div>`;
  }

  private renderList(): TemplateResult {
    const t = this.t;
    const list = this.list;
    const intro = html`<p class="hint">${t.t("history.intro")}</p>
      ${this.hass?.demo ? html`<p class="hint">${t.t("history.demo")}</p>` : nothing}`;
    if (!list) {
      return html`${intro}${this.error ? nothing : html`<p class="hint">${t.t("history.reading")}</p>`}`;
    }
    if (list.items.length === 0) {
      return html`${intro}
        <p data-testid="history-empty">${t.t("history.empty")}</p>`;
    }
    const shown = filterItems(list.items, this.kind, this.search);
    const counts = new Map<HistoryKind, number>();
    for (const item of list.items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    const kinds = HISTORY_KINDS.filter((kind) => counts.has(kind));
    return html`${intro}
      <div class="kinds" role="group" aria-label=${t.t("history.title")}>
        ${[undefined, ...kinds].map(
          (kind) =>
            html`<button
              data-kind=${kind ?? "all"}
              aria-pressed=${this.kind === kind ? "true" : "false"}
              @click=${() => {
                this.kind = kind;
              }}
            >
              ${kind ? t.t(`history.kinds.${kind}`) : t.t("history.kinds.all")}
              (${kind ? counts.get(kind) : list.items.length})
            </button>`,
        )}
      </div>
      <input
        type="search"
        data-testid="history-search"
        aria-label=${t.t("history.search")}
        placeholder=${t.t("history.search")}
        .value=${this.search}
        @input=${(event: Event) => {
          this.search = (event.target as HTMLInputElement).value;
        }}
      />
      ${
        shown.length === 0
          ? html`<p class="hint">${t.t("history.none_found")}</p>`
          : html`<ul class="items" data-testid="history-items">
              ${shown.map((item) => this.renderRow(item))}
            </ul>`
      }
      <p class="hint" data-testid="history-size">
        ${t.t("history.size", { used: this.bytes(list.bytes), max: this.bytes(list.max_bytes) })}
      </p>`;
  }

  private renderRow(item: HistoryItem): TemplateResult {
    const t = this.t;
    return html`<li>
      <button
        data-item=${item.id}
        ?disabled=${this.busy}
        @click=${() => {
          this.status = undefined;
          void this.openItem(item.id);
        }}
      >
        <span class="name">
          ${itemName(t, item)}
          ${
            item.removed
              ? html`<span class="badge removed">${t.t("history.removed_badge")}</span>`
              : nothing
          }
          ${
            item.source === "yaml"
              ? html`<span class="badge">${t.t("history.yaml_badge")}</span>`
              : nothing
          }
        </span>
        <span class="meta">
          ${t.t(`history.kind.${item.kind}`)} · ${t.tp("history.versions", item.versions)} ·
          ${t.t("history.changed", { when: this.when(item.changed) })}
        </span>
      </button>
    </li>`;
  }

  private renderItem(detail: HistoryDetail): TemplateResult {
    const t = this.t;
    const { item, versions } = detail;
    const path = this.hass?.demo ? undefined : editorPath(item);
    const notes = [
      item.source === "yaml" ? t.t("history.yaml_note") : undefined,
      item.removed ? t.t("history.removed_note") : undefined,
      item.removed && item.kind === "dashboard" && item.source === "editor"
        ? t.t("history.dashboard_gone")
        : undefined,
    ].filter((note): note is string => note !== undefined);
    return html`<p class="meta">
        ${t.t(`history.kind.${item.kind}`)} · ${t.tp("history.versions", item.versions)}
      </p>
      ${notes.map((note) => html`<p class="hint">${note}</p>`)}
      ${
        path
          ? html`<a
              class="open"
              href=${path}
              data-testid="history-open"
              @click=${(event: MouseEvent) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                this.close();
                navigate(path);
              }}
              >${icon(mdiOpenInNew)}${t.t("history.open")}</a
            >`
          : nothing
      }
      <ul class="versions" data-testid="history-versions">
        ${versions.map((version, index) => this.renderVersion(detail, version, index))}
      </ul>`;
  }

  private renderVersion(
    detail: HistoryDetail,
    version: HistoryVersion,
    index: number,
  ): TemplateResult {
    const t = this.t;
    const open = this.selected === version.id;
    const label = version.removed
      ? t.t("history.version_removed")
      : index === 0
        ? t.t("history.current")
        : undefined;
    return html`<li data-version=${version.id}>
      <button
        class="version"
        aria-expanded=${open ? "true" : "false"}
        @click=${() => {
          void this.select(version.id, true);
        }}
      >
        <span class="name">
          ${this.when(version.at)}
          ${label ? html`<span class="badge ${version.removed ? "removed" : ""}">${label}</span>` : nothing}
        </span>
      </button>
      ${open ? this.renderBody(detail, version, index) : nothing}
    </li>`;
  }

  /** A version shown: what it changed (or what putting it back changes), its content, put back. */
  private renderBody(
    detail: HistoryDetail,
    version: HistoryVersion,
    index: number,
  ): TemplateResult {
    const t = this.t;
    const { item, versions } = detail;
    const newest = versions[0];
    const same = version.same_as ? versions.find((each) => each.id === version.same_as) : undefined;
    const comparable = index > 0 && version.kept && newest?.kept === true;
    const compare: Compare = comparable ? this.compare : "before";
    const worked = this.work(detail, version, index, compare);
    const config = this.configs.get(version.id);
    return html`<div class="body" data-testid="history-version">
      ${version.removed ? html`<p>${t.t("history.removed_note")}</p>` : nothing}
      ${!version.removed && !version.kept ? html`<p class="hint">${t.t("history.too_large")}</p>` : nothing}
      ${same ? html`<p class="hint">${t.t("history.same_as", { when: this.when(same.at) })}</p>` : nothing}
      ${
        comparable
          ? html`<div
              class="compare"
              role="radiogroup"
              aria-label=${t.t("history.version", { when: this.when(version.at) })}
            >
              ${(["before", "current"] as const).map(
                (choice) =>
                  html`<label>
                    <input
                      type="radio"
                      name="history-compare"
                      value=${choice}
                      data-testid=${`history-compare-${choice}`}
                      .checked=${compare === choice}
                      @change=${() => {
                        this.compare = choice;
                        this.worked = undefined;
                      }}
                    />
                    ${t.t(choice === "before" ? "history.compare_before" : "history.compare_current")}
                  </label>`,
              )}
            </div>`
          : nothing
      }
      ${worked?.note ? html`<p class="hint">${worked.note}</p>` : nothing}
      ${
        worked?.changes
          ? worked.changes.length === 0
            ? html`<p class="hint">${t.t("history.no_change")}</p>`
            : html`<ul class="changes" data-testid="history-changes">
                ${worked.changes.map(
                  (change) =>
                    html`<li data-op=${change.op}>
                      <span class="op">${t.t(`history.op.${change.op}`)}</span>
                      <span class="place">${change.place}</span>
                      <span class="text">${change.text}</span>
                    </li>`,
                )}
              </ul>`
          : nothing
      }
      ${worked && worked.more > 0 ? html`<p class="hint">${t.tp("history.more_changes", worked.more)}</p>` : nothing}
      ${
        config !== undefined && config !== null
          ? html`<details>
              <summary>${t.t("history.whole")}</summary>
              <pre data-testid="history-whole">${JSON.stringify(config, null, 2)}</pre>
            </details>`
          : nothing
      }
      ${canPutBack(item, version, newest) ? this.renderPutBack(item, version) : nothing}
    </div>`;
  }

  private renderPutBack(item: HistoryItem, version: HistoryVersion): TemplateResult {
    const t = this.t;
    if (!this.asking) {
      return html`<div class="footer">
        <button
          class="action"
          data-testid="history-put-back"
          ?disabled=${this.busy}
          @click=${() => {
            this.asking = true;
            this.focusNext = "[data-ask] [data-cancel]";
          }}
        >
          ${t.t("history.put_back")}
        </button>
      </div>`;
    }
    return html`<div class="ask" role="alertdialog" data-ask aria-labelledby="history-ask">
      <h3 id="history-ask">${t.t("history.put_back_title", { name: itemName(t, item) })}</h3>
      <p class="hint">${t.t("history.put_back_text", { when: this.when(version.at) })}</p>
      <div class="footer">
        <button
          class="action quiet"
          data-cancel
          @click=${() => {
            this.asking = false;
            this.focusNext = '[data-testid="history-put-back"]';
          }}
        >
          ${t.t("history.cancel")}
        </button>
        <button
          class="action"
          data-testid="history-put-back-confirm"
          ?disabled=${this.busy}
          @click=${() => {
            void this.putBackShown();
          }}
        >
          ${t.t("history.put_back_confirm")}
        </button>
      </div>
    </div>`;
  }

  /** What a version changed, or what putting it back would change, worked out once. */
  private work(
    detail: HistoryDetail,
    version: HistoryVersion,
    index: number,
    compare: Compare,
  ): Worked | undefined {
    const t = this.t;
    const key = `${detail.item.id}|${version.id}|${compare}|${this.configs.size}`;
    if (this.worked?.key === key) return this.worked;
    const done = (worked: Omit<Worked, "key">): Worked => {
      this.worked = { key, ...worked };
      return this.worked;
    };
    if (version.removed || !version.kept) return done({ more: 0 });
    const other = compare === "current" ? detail.versions[0] : detail.versions[index + 1];
    if (!other) return done({ more: 0, note: t.t("history.oldest") });
    if (other.removed) return done({ more: 0, note: t.t("history.after_removed") });
    if (!other.kept) return done({ more: 0, note: t.t("history.before_unknown") });
    if (!this.configs.has(version.id) || !this.configs.has(other.id)) return undefined;
    // From the one before to it; or, putting it back, from the current one to it.
    const from = this.configs.get(other.id);
    const to = this.configs.get(version.id);
    const { changes, more } = changesBetween(from, to);
    return done({
      changes: changes.map((change) => sayChange(t, detail.item.kind, change, from, to, this.hass)),
      more,
    });
  }
}

define("domotwin-history", DomoTwinHistory);
