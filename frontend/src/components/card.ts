import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { ConfigError, normalizeConfig, type CardConfig } from "../config";
import { DomoTwinClient, type Settings, type StoreyInfo, type StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { readBindings, type BindingsJson } from "../live/bindings";
import { forScreen, resolveShow, type ShowRequest } from "../live/show";
import type { HomeStorey } from "../engine/engine";
import {
  ALL_STOREYS,
  loadHome,
  loadStorey,
  roomsElsewhere,
  type StoreyRooms,
} from "../live/storeys";
import { translatorFor } from "../i18n";
import { baseStyles } from "./styles";
import type { DomoTwinView, ViewOptions } from "./view";

/** `custom:domotwin-card`: the twin on a dashboard. */
export class DomoTwinCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    plan: { state: true },
    layout: { state: true },
    home: { state: true },
    planError: { state: true },
    bindings: { state: true },
    settings: { state: true },
    storeys: { state: true },
    storey: { state: true },
    elsewhere: { state: true },
  };

  protected config?: CardConfig;
  protected plan?: StoredPlan["plan"];
  protected layout?: StoredPlan["layout"];
  /** Every storey's plan, when the home is shown whole (D-028). */
  protected home?: HomeStorey[];
  protected planError?: string;
  protected bindings?: BindingsJson;
  protected settings?: Settings;
  /** The storeys, and the one shown (chosen in the view, else the card's `storey`). */
  protected storeys: StoreyInfo[] = [];
  protected storey?: string;
  /** The storey chosen with the switcher, until the page is left. */
  private chosen?: string;
  /** Counts the plan's loads: the answer to an older one is dropped. */
  private loads = 0;
  /** Counts `domotwin.show` requests: an older one still on its way is dropped. */
  private shows = 0;
  /** The rooms of the storeys not shown, for their alerts. */
  protected elsewhere: StoreyRooms[] = [];
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
      const before = this.config?.storey;
      this.config = normalizeConfig(config);
      if (this.config.storey !== before) {
        // Another storey asked for (the visual editor): it wins over the switcher's choice.
        this.chosen = undefined;
        if (this._hass && this.isConnected) void this.loadPlan(DomoTwinClient.for(this._hass));
      }
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
      if (event.kind === "show") void this.showRequest(client, event.show);
      else if (event.kind === "plan") void this.loadPlan(client);
      else if (event.kind === "bindings") void this.loadBindings(client);
      else void this.loadSettings(client);
    });
    void this.loadPlan(client);
    void this.loadBindings(client);
    void this.loadSettings(client);
  }

  /** Without settings the home shows with north up. */
  private async loadSettings(client: DomoTwinClient): Promise<void> {
    try {
      this.settings = (await client.getSettings()).settings;
    } catch {
      this.settings = undefined;
    }
  }

  private async loadPlan(client: DomoTwinClient): Promise<void> {
    const ticket = ++this.loads;
    try {
      // The storey chosen with the switcher, else the card's; a storey removed since: the ground
      // floor. Every storey at once (D-028): the ground floor's first, for the list of storeys.
      const wanted = this.chosen ?? this.config?.storey;
      let all = wanted === ALL_STOREYS;
      let stored = await loadStorey(client, all ? undefined : wanted);
      if (!all && this.chosen !== undefined && stored.storey !== this.chosen) {
        // The storey chosen was removed: the card's own (every storey, or one).
        this.chosen = undefined;
        all = this.config?.storey === ALL_STOREYS;
        if (this.config?.storey !== undefined && !all) {
          stored = await loadStorey(client, this.config.storey);
        }
      }
      // Every storey at once needs two with a plan; else the one with a plan, alone.
      const storeys =
        all && stored.storeys.length > 1 ? await loadHome(client, stored.storeys) : [];
      const home = storeys.length > 1 ? storeys : undefined;
      const [only] = storeys;
      if (only && !home) {
        const plan = only.plan as StoredPlan["plan"];
        stored = { ...stored, plan, layout: only.layout ?? {}, storey: only.id };
      }
      // A later load (another storey asked for) wins.
      if (ticket !== this.loads) return;
      this.storeys = stored.storeys;
      if (home) {
        this.home = home;
        this.plan = undefined;
        this.layout = undefined;
        this.storey = ALL_STOREYS;
        this.elsewhere = [];
      } else {
        this.home = undefined;
        this.plan = stored.plan;
        this.layout = stored.layout;
        this.storey = stored.storey ?? undefined;
        void this.loadElsewhere(client, stored);
      }
      this.planError = undefined;
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

  /** `domotwin.show` (D-029): on this screen (or every one), the storey asked for, then what to
   * frame and how. */
  private async showRequest(client: DomoTwinClient, request: ShowRequest): Promise<void> {
    const hass = this._hass;
    if (!hass || !forScreen(request, this.config?.screen)) return;
    const ticket = ++this.shows;
    const target = await resolveShow(
      client,
      translatorFor(hass),
      this.storeys,
      { plan: this.plan, storey: this.storey },
      request,
    );
    if (!target || ticket !== this.shows) return;
    if (target.storey !== undefined && target.storey !== this.storey) {
      this.chosen = target.storey;
      await this.loadPlan(client);
      await this.updateComplete;
    }
    const view = this.renderRoot.querySelector<DomoTwinView>("domotwin-view");
    await view?.updateComplete;
    if (ticket === this.shows) view?.show(target);
  }

  /** The kiosk went back to the view it opened on (D-029): its own storey too, framed again
   * once shown. */
  private readonly onIdle = (): void => {
    if (this.chosen === undefined || !this._hass) return;
    this.chosen = undefined;
    void this.loadPlan(DomoTwinClient.for(this._hass)).then(async () => {
      await this.updateComplete;
      const view = this.renderRoot.querySelector<DomoTwinView>("domotwin-view");
      await view?.updateComplete;
      view?.frameHome();
    });
  };

  /** The view's storey switcher. */
  private readonly onStorey = (event: Event): void => {
    const hass = this._hass;
    if (!hass) return;
    this.chosen = (event as CustomEvent<string>).detail;
    void this.loadPlan(DomoTwinClient.for(hass));
  };

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
        layer: config.layer,
        alerts: config.alerts,
        presence: config.presence,
        sun: config.sun,
        badges: config.badges,
        cameras: config.cameras,
        names: config.names,
        spread: config.spread,
        roof: config.roof,
        idle: config.idle,
        orbit: config.orbit,
        nightDim: config.night_dim,
        tools: config.tools,
      };
      if (config.room) options.room = config.room;
      if (config.theme) options.theme = config.theme;
      if (config.accent) options.accent = config.accent;
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
        .layout=${this.layout}
        .home=${this.home}
        .bindings=${this.bindings}
        .planError=${this.planError}
        .options=${this.viewOptions()}
        .north=${this.settings?.north ?? 0}
        .homeTheme=${this.settings?.theme}
        .homeAccent=${this.settings?.accent}
        .storeys=${this.storeys}
        .storey=${this.storey}
        .elsewhere=${this.elsewhere}
        @domotwin-storey=${this.onStorey}
        @domotwin-idle=${this.onIdle}
      ></domotwin-view>
    </ha-card>`;
  }
}
