import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { ConfigError, normalizeConfig, type CardConfig } from "../config";
import { DomoTwinClient, type StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { readBindings, type BindingsJson } from "../live/bindings";
import { translatorFor } from "../i18n";
import { baseStyles } from "./styles";
import type { ViewOptions } from "./view";

/** `custom:domotwin-card`: the twin on a dashboard. */
export class DomoTwinCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    plan: { state: true },
    planError: { state: true },
    bindings: { state: true },
  };

  protected config?: CardConfig;
  protected plan?: StoredPlan["plan"];
  protected planError?: string;
  protected bindings?: BindingsJson;
  private _hass?: HomeAssistant;
  private unsubscribe?: () => void;
  private options?: { source: CardConfig; value: ViewOptions };

  static override styles = [
    baseStyles,
    css`
      ha-card {
        overflow: hidden;
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      domotwin-view {
        flex: 1;
        aspect-ratio: 4 / 3;
      }
      domotwin-view.fixed {
        aspect-ratio: auto;
      }
    `,
  ];

  /** Home Assistant calls this with the YAML or UI configuration; invalid ones throw. */
  setConfig(config: unknown): void {
    try {
      this.config = normalizeConfig(config);
    } catch (error) {
      if (error instanceof ConfigError) {
        const t = translatorFor(this._hass);
        throw new Error(t.t("config.invalid", { reason: t.t(error.key) }), { cause: error });
      }
      throw error;
    }
  }

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

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._hass) this.connectData();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private connectData(): void {
    if (!this._hass || this.unsubscribe) return;
    const client = DomoTwinClient.for(this._hass);
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "plan") void this.loadPlan(client);
      else void this.loadBindings(client);
    });
    void this.loadPlan(client);
    void this.loadBindings(client);
  }

  private async loadPlan(client: DomoTwinClient): Promise<void> {
    try {
      this.plan = (await client.getPlan()).plan;
      this.planError = undefined;
    } catch (error) {
      this.planError = isHassError(error) ? error.code : "unknown";
    }
  }

  /** Without bindings the home still shows, without live states. */
  private async loadBindings(client: DomoTwinClient): Promise<void> {
    try {
      this.bindings = readBindings((await client.getBindings()).bindings);
    } catch {
      this.bindings = undefined;
    }
  }

  private viewOptions(): ViewOptions {
    const config = this.config;
    if (!config) return { quality: "auto" };
    // The same object while the configuration is unchanged, so the view does not reset.
    if (this.options?.source !== config) {
      const options: ViewOptions = {
        quality: config.quality,
        view: config.view,
        cutaway: config.cutaway,
        lighting: config.lighting,
      };
      if (config.room) options.room = config.room;
      this.options = { source: config, value: options };
    }
    return this.options.value;
  }

  /** Masonry dashboards: about 6 rows of 50 px. */
  getCardSize(): number {
    return 6;
  }

  /** Sections dashboards. */
  getGridOptions(): Record<string, number> {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await import("./card-editor");
    return document.createElement("domotwin-card-editor");
  }

  static getStubConfig(): Record<string, unknown> {
    return { view: "3d" };
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.config) return nothing;
    const style = [
      this.config.height ? `height:${this.config.height}` : "",
      this.config.font_family ? `--domotwin-font-family:${this.config.font_family}` : "",
    ]
      .filter(Boolean)
      .join(";");
    return html`<ha-card .header=${this.config.title}>
      <domotwin-view
        class=${this.config.height ? "fixed" : ""}
        style=${style}
        .hass=${this._hass}
        .plan=${this.plan}
        .bindings=${this.bindings}
        .planError=${this.planError}
        .options=${this.viewOptions()}
      ></domotwin-view>
    </ha-card>`;
  }
}
