/**
 * `custom:domotwin-summary-card` (`docs/DECISIONS.md`, D-061): one of DomoTwin's summaries, in the
 * manner of Home Assistant's Overview, for one's own dashboards and the Home tab: the people at
 * home, the radio mesh, the automations, the upkeep or the robots. Defined with the first picture;
 * what it shows is loaded with the first one on the page.
 */
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor } from "../i18n";
import { isSummary, type SummaryKind } from "../live/overview";
import { define, inLanguage } from "./define";

export interface SummaryConfig {
  type: string;
  summary: SummaryKind;
}

export class DomoTwinSummaryCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    loaded: { state: true },
  };

  hass?: HomeAssistant;
  protected config?: SummaryConfig;
  protected loaded = false;
  private static body?: Promise<unknown>;

  static override styles = css`
    :host {
      display: block;
    }
    /* Right to left (D-082): what points back or on turns round. */
    :host([dir="rtl"]) {
      --domotwin-mirror: -1;
    }
    ha-card {
      height: 100%;
      min-height: 56px;
      box-sizing: border-box;
    }
  `;

  setConfig(config: unknown): void {
    const value = (config ?? {}) as Record<string, unknown>;
    if (!isSummary(value.summary)) {
      throw new Error(translatorFor(this.hass).t("config.bad_summary"));
    }
    this.config = { type: String(value.type), summary: value.summary };
  }

  getCardSize(): number {
    return 1;
  }

  getGridOptions(): Record<string, number> {
    return { columns: 6, rows: 1, min_columns: 3, min_rows: 1 };
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await import("./summary-editor");
    return document.createElement("domotwin-summary-card-editor");
  }

  static getStubConfig(): Record<string, unknown> {
    return { summary: "people" };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    DomoTwinSummaryCard.body ??= import("./summary-body");
    try {
      await DomoTwinSummaryCard.body;
      this.loaded = true;
    } catch {
      // Not fetched (the network went): asked for again when the card is shown next.
      DomoTwinSummaryCard.body = undefined;
    }
  }

  /** Drawn once Home Assistant's language is here (D-082). */
  protected override scheduleUpdate(): Promise<unknown> | undefined {
    return inLanguage(
      this,
      () => this.hass,
      () => super.scheduleUpdate(),
    );
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.config) return nothing;
    return this.loaded
      ? html`<domotwin-summary-body
          .hass=${this.hass}
          .kind=${this.config.summary}
        ></domotwin-summary-body>`
      : html`<ha-card></ha-card>`;
  }
}

define("domotwin-summary-card", DomoTwinSummaryCard);
