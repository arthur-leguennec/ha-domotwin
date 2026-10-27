import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { ConfigError, normalizeConfig, type CardConfig } from "../config";
import { fontFamily } from "../fonts";
import { DomoTwinClient, type Settings, type StoreyInfo, type StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import type { DemoHome } from "../demo/home";
import { NO_BINDINGS, readBindings, type BindingsJson } from "../live/bindings";
import { closedRooms, gatedHass, RightsCache, type Gate } from "../live/rights";
import { planRooms } from "../live/suggest";
import { forScreen, resolveShow, type ShowRequest } from "../live/show";
import type { HomeStorey } from "../engine/engine";
import {
  ALL_STOREYS,
  loadHome,
  loadStorey,
  roomsElsewhere,
  type StoreyRooms,
} from "../live/storeys";
import type { PeopleSettings } from "../live/people";
import type { AccessPoint } from "../live/placement";
import type { Upkeep } from "../live/upkeep";
import type { Wifi } from "../live/wifi";
import { translatorFor } from "../i18n";
import { inLanguage } from "./define";
import { DemoSwitch } from "./demo-switch";
import { baseStyles } from "./styles";
import type { DomoTwinView, ViewOptions } from "./view";

/** How long before settings that could not be read are asked for again (ms). */
const SETTINGS_RETRY_MS = 10_000;
/** No Wi-Fi access point placed (D-066): the same array every time. */
const NO_ACCESS_POINTS: AccessPoint[] = [];

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
    settingsRead: { state: true },
    upkeep: { state: true },
    people: { state: true },
    wifi: { state: true },
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
  /** The settings were read once: the home is not shown before, its private rooms unknown
   * (D-039). */
  protected settingsRead = false;
  private settingsTimer?: ReturnType<typeof setTimeout>;
  private wifiTimer?: ReturnType<typeof setTimeout>;
  /** The upkeep cards (D-033). */
  protected upkeep?: Upkeep;
  /** The people placed in their rooms (D-034). */
  protected people?: PeopleSettings;
  /** The home's Wi-Fi for guests (D-060), as this card's screen may show it. */
  protected wifi?: Wifi;
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
  /** The viewer's rights as last worked out (D-071). */
  private readonly rightsCache = new RightsCache();
  private _hass?: HomeAssistant;
  private unsubscribe?: () => void;
  /** The demo house shown instead of the home (`demo: true`, D-050). */
  private readonly demoSwitch = new DemoSwitch(this);
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
      const screen = this.config?.screen;
      this.config = normalizeConfig(config);
      // The demo house asked for, or no longer.
      if (this.config.demo && this.demoSwitch.realHass) void this.startDemo();
      if (!this.config.demo) this.demoSwitch.stop();
      if (this.config.storey !== before) {
        // Another storey asked for (the visual editor): it wins over the switcher's choice.
        this.chosen = undefined;
        if (this._hass && this.isConnected) void this.loadPlan(DomoTwinClient.for(this._hass));
      }
      // Another screen: what it may show of the Wi-Fi (D-060).
      if (this.config.screen !== screen && this._hass && this.unsubscribe) {
        void this.loadWifi(DomoTwinClient.for(this._hass));
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
    this.demoSwitch.realHass = hass;
    if (this.config?.demo) {
      // The demo house keeps its own Home Assistant.
      void this.startDemo();
      return;
    }
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
    clearTimeout(this.settingsTimer);
    clearTimeout(this.wifiTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** The demo house shown, if one is (a card shows no sandbox). */
  private get demo(): DemoHome | undefined {
    const home = this.demoSwitch.home;
    return home?.kind === "demo" ? home : undefined;
  }

  /** Shows the demo house (D-050) instead of the home, while the card is set to. */
  private startDemo(): Promise<void> {
    return this.demoSwitch.start(() => this.config?.demo === true);
  }

  /** A new `hass` of the demo house's day. */
  demoChanged(hass: HomeAssistant): void {
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
  }

  /**
   * Shows another home's Home Assistant: what was read of the one before forgotten, its answers
   * still on their way dropped.
   */
  showHome(hass: HomeAssistant | undefined): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.settingsTimer);
    clearTimeout(this.wifiTimer);
    this.loads += 1;
    this.chosen = undefined;
    this.plan = undefined;
    this.layout = undefined;
    this.home = undefined;
    this.planError = undefined;
    this.bindings = undefined;
    this.settings = undefined;
    this.settingsRead = false;
    this.upkeep = undefined;
    this.people = undefined;
    this.wifi = undefined;
    this.storeys = [];
    this.storey = undefined;
    this.elsewhere = [];
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
    if (hass && this.isConnected) this.connectData();
  }

  private connectData(): void {
    if (!this._hass || this.unsubscribe) return;
    const client = DomoTwinClient.for(this._hass);
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "show") void this.showRequest(client, event.show);
      else if (event.kind === "plan") void this.loadPlan(client);
      else if (event.kind === "bindings") void this.loadBindings(client);
      else if (event.kind === "upkeep") void this.loadUpkeep(client);
      else if (event.kind === "people") void this.loadPeople(client);
      else if (event.kind === "wifi") void this.loadWifi(client);
      // The wall screens (D-076) are the panel's, the lawns (D-077) the view's.
      else if (event.kind !== "screens" && event.kind !== "garden") void this.loadSettings(client);
    });
    void this.loadPlan(client);
    void this.loadBindings(client);
    void this.loadSettings(client);
    void this.loadUpkeep(client);
    void this.loadPeople(client);
    void this.loadWifi(client);
  }

  /**
   * The Wi-Fi as this card's screen may show it. Not read (Home Assistant starting), it is asked for
   * again in a while; an integration older than D-060 has none.
   */
  private async loadWifi(client: DomoTwinClient): Promise<void> {
    clearTimeout(this.wifiTimer);
    try {
      const wifi = await client.getWifi(this.config?.screen ?? "");
      if (this.current(client)) this.wifi = wifi;
    } catch (error) {
      if (!this.current(client)) return;
      this.wifi = undefined;
      if (isHassError(error) && error.code === "unknown_command") return;
      if (this.unsubscribe) {
        this.wifiTimer = setTimeout(() => void this.loadWifi(client), SETTINGS_RETRY_MS);
      }
    }
  }

  /** Whether `client` is the home's shown (not the one before the demo house, or after it). */
  private current(client: DomoTwinClient): boolean {
    return this._hass !== undefined && DomoTwinClient.for(this._hass) === client;
  }

  /** Without people's settings (an integration older than D-034 too) nobody is drawn. */
  private async loadPeople(client: DomoTwinClient): Promise<void> {
    try {
      const people = await client.getPeople();
      if (this.current(client)) this.people = people;
    } catch {
      if (this.current(client)) this.people = undefined;
    }
  }

  /** Without upkeep cards (an integration older than D-033 too) nothing is due. */
  private async loadUpkeep(client: DomoTwinClient): Promise<void> {
    try {
      const { upkeep } = await client.getUpkeep();
      if (this.current(client)) this.upkeep = upkeep;
    } catch {
      if (this.current(client)) this.upkeep = undefined;
    }
  }

  /**
   * The settings; unreadable, those read before stay (their private rooms, D-039), and never read,
   * they are asked for again in a while, the home not shown meanwhile.
   */
  private async loadSettings(client: DomoTwinClient): Promise<void> {
    clearTimeout(this.settingsTimer);
    try {
      const { settings } = await client.getSettings();
      if (!this.current(client)) return;
      this.settings = settings;
      this.settingsRead = true;
    } catch {
      if (this.current(client) && !this.settingsRead && this.unsubscribe) {
        this.settingsTimer = setTimeout(() => void this.loadSettings(client), SETTINGS_RETRY_MS);
      }
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
      // A later load's, or another home's (the demo house, D-050), is not this one's.
      if (ticket !== this.loads) return;
      this.planError = isHassError(error) ? error.code : "unknown";
    }
  }

  /** The rooms of the other storeys (plans the client has are not fetched again). */
  private async loadElsewhere(client: DomoTwinClient, stored: StoredPlan): Promise<void> {
    const elsewhere =
      stored.storeys.length > 1 ? await roomsElsewhere(client, stored.storeys, stored.storey) : [];
    // Another storey shown meanwhile, or another home: its own load sets them.
    if (this.current(client) && (stored.storey ?? undefined) === this.storey) {
      this.elsewhere = elsewhere;
    }
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
      closedRooms(this.settings?.rooms, this.settings?.rights, hass),
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
      const bindings = readBindings((await client.getBindings()).bindings);
      if (this.current(client)) this.bindings = bindings;
    } catch {
      if (this.current(client)) this.bindings = undefined;
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
        people: config.people,
        sun: config.sun,
        weather: config.weather,
        badges: config.badges,
        cameras: config.cameras,
        names: config.names,
        small_rooms: config.small_rooms,
        spread: config.spread,
        roof: config.roof,
        idle: config.idle,
        orbit: config.orbit,
        nightDim: config.night_dim,
        tools: config.tools,
        voice: config.voice,
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

  /**
   * The viewer's rights (D-071): their gate, and the bindings without the devices they may not
   * see; the same while nothing they read changes. None for an administrator.
   */
  private rightsOf(hass: HomeAssistant): { gate?: Gate; bindings: BindingsJson } {
    const settings = this.settings;
    const home = this.home;
    return this.rightsCache.read(
      hass,
      settings?.rights,
      {
        bindings: this.bindings ?? NO_BINDINGS,
        closed: closedRooms(settings?.rooms, settings?.rights, hass),
      },
      () =>
        home
          ? {
              rooms: home.flatMap((storey) => planRooms(storey.plan)),
              storeys: home.map(({ plan, layout }) => ({ plan, layout })),
            }
          : {
              rooms: [...planRooms(this.plan), ...this.elsewhere.flatMap((s) => s.rooms)],
              storeys: [{ plan: this.plan, layout: this.layout }, ...this.elsewhere],
            },
      [home, this.plan, this.layout, this.elsewhere],
    );
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.config || !inLanguage(this, this._hass)) return nothing;
    // Under the viewer's rights (D-071): what they may do, the devices they may not see unlinked.
    const rights = this._hass ? this.rightsOf(this._hass) : undefined;
    const style = [
      this.config.height ? `height:${this.config.height}` : "",
      this.config.font_family
        ? `--domotwin-font-family:${fontFamily(this.config.font_family)}`
        : "",
    ]
      .filter(Boolean)
      .join(";");
    return html`<ha-card .header=${this.config.title}>
      ${this.demo ? html`<domotwin-demo-bar .home=${this.demo}></domotwin-demo-bar>` : nothing}
      <domotwin-view
        class=${this.config.height ? "fixed" : ""}
        style=${style}
        .hass=${this._hass && gatedHass(this._hass, rights?.gate)}
        .plan=${this.settingsRead ? this.plan : undefined}
        .layout=${this.layout}
        .home=${this.settingsRead ? this.home : undefined}
        .bindings=${rights && this.bindings ? rights.bindings : this.bindings}
        .upkeep=${this.upkeep}
        .people=${this.people}
        .wifi=${this.wifi}
        .screen=${this.config.screen ?? ""}
        .planError=${this.planError}
        .options=${this.viewOptions()}
        .north=${this.settings?.north ?? 0}
        .privateRooms=${this.settings?.rooms}
        .rights=${this.settings?.rights}
        .accessPoints=${this.settings?.access_points ?? NO_ACCESS_POINTS}
        .homeTheme=${this.settings?.theme}
        .homeAccent=${this.settings?.accent}
        .energy=${this.settings?.energy}
        .weather=${this.settings?.weather}
        .roofStyle=${this.settings?.roof}
        .storeys=${this.storeys}
        .storey=${this.storey}
        .elsewhere=${this.elsewhere}
        @domotwin-storey=${this.onStorey}
        @domotwin-idle=${this.onIdle}
      ></domotwin-view>
    </ha-card>`;
  }
}
