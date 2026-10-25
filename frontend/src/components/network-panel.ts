/**
 * `<domotwin-network>`: the network map over the view (`DECISIONS.md`, D-031). Its devices as
 * markers at their pieces, the health of the mesh and what a tap found, the devices placed nowhere
 * and the rescan. The engine draws the links. Loaded the first time the layer is shown.
 */
import { mdiAccessPoint, mdiClose, mdiMapMarkerPlus, mdiRadar, mdiRouterWireless } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { analyseNetwork } from "../analysis/analysis";
import type { DomoTwinEngine } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import type { BindingsJson } from "../live/bindings";
import {
  neighboursOf,
  placeDevices,
  snapshot,
  zhaSource,
  type NetworkAnalysis,
  type NetworkDevice,
  type NetworkSource,
  type Quality,
} from "../live/network";
import { timeAgo } from "../live/text";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** What a tap shows: a device, or a link between two. */
type Selected = { device: string } | { a: string; b: string };

/** After a rescan, the devices are read again this often (ms) for this long: ZHA never says. */
const RESCAN_POLL_MS = 30_000;
/** Between the markers of devices at the same piece (CSS pixels). */
const MARKER_GAP = 36;
const RESCAN_FOR_MS = 180_000;
/** The health of a mesh with no device. */
const NO_TROUBLE: NetworkAnalysis["health"] = { weakLinks: 0, stale: [], weakRooms: [] };

/** The details a place request carries (`domotwin-network-place`). */
export interface PlaceRequest {
  name: string;
  deviceId?: string;
  entities: string[];
}

export class DomoTwinNetwork extends LitElement {
  static override properties = {
    hass: { attribute: false },
    engine: { attribute: false },
    bindings: { attribute: false },
    names: { attribute: false },
    placeable: { attribute: false },
    devices: { state: true },
    analysis: { state: true },
    points: { state: true },
    selected: { state: true },
    loadError: { state: true },
    analysisError: { state: true },
    scanning: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
      }
      .node {
        position: absolute;
        transform: translate(-50%, -50%);
        display: grid;
        place-items: center;
        border: 2px solid var(--q);
        border-radius: 50%;
        background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent);
        color: var(--q);
        padding: 0;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.25);
      }
      .node.coordinator {
        /* The root of the mesh: no quality of its own (ZHA reports none for it). */
        --q: var(--primary-color, #03a9f4);
        width: 34px;
        height: 34px;
        border-width: 3px;
      }
      .node.router {
        width: 26px;
        height: 26px;
      }
      .node.end,
      .node.other {
        width: 14px;
        height: 14px;
        background: var(--q);
      }
      .node.stale {
        opacity: 0.55;
        border-style: dashed;
      }
      .node[aria-pressed="true"] {
        outline: 3px solid var(--primary-color, #03a9f4);
        outline-offset: 2px;
      }
      .node svg {
        width: 60%;
        height: 60%;
      }
      .good {
        --q: #29c761;
      }
      .fair {
        --q: #f9a61f;
      }
      .weak {
        --q: #ef3833;
      }
      .unknown {
        --q: #9a9ea8;
      }
      .sheet {
        /* Beside the view's tools (a column 48px wide at the top right), never over them: the
           layer button that closes the map stays in reach. */
        position: absolute;
        right: 68px;
        bottom: 12px;
        width: min(340px, calc(100% - 80px));
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 12px 14px;
        box-sizing: border-box;
        pointer-events: auto;
        font-size: 0.875rem;
      }
      h3 {
        margin: 12px 0 6px;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--secondary-text-color, #5f6368);
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      header strong {
        flex: 1;
      }
      .legend {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 6px 0;
      }
      .swatch {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .swatch::before {
        content: "";
        width: 14px;
        height: 4px;
        border-radius: 2px;
        background: var(--q);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
      }
      li .grow {
        flex: 1;
        min-width: 0;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--q);
        flex: none;
      }
      .hint {
        margin: 4px 0;
        color: var(--secondary-text-color, #5f6368);
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 10px;
        margin: 4px 0;
      }
      dt {
        color: var(--secondary-text-color, #5f6368);
      }
      dd {
        margin: 0;
      }
      button.round {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
      }
      button.round svg,
      button.action svg {
        width: 20px;
        height: 20px;
      }
      button.small {
        min-height: 30px;
        padding: 0 10px;
        font-size: 0.8rem;
      }
    `,
  ];

  hass?: HomeAssistant;
  engine?: DomoTwinEngine;
  bindings?: BindingsJson;
  /** The elements of the plan shown, by id. */
  names: Record<string, { name: string; type: string }> = {};
  /** Devices placed nowhere can be placed (the panel, which has the link editor). */
  placeable = false;

  protected devices: NetworkDevice[] = [];
  protected analysis?: NetworkAnalysis;
  /** Where each placed device's marker goes (CSS pixels). */
  protected points: Record<string, [number, number]> = {};
  protected selected?: Selected;
  /** The devices could not be read from the source. */
  protected loadError?: string;
  /** They were, but the analysis module could not read them. */
  protected analysisError?: string;
  protected scanning = false;

  private source?: NetworkSource;
  /** Device id → the piece it is placed at. */
  private placed = new Map<string, string>();
  /** The devices and the quality of each by id, for the markers drawn on every move. */
  private byId = new Map<string, NetworkDevice>();
  private qualities = new Map<string, Quality>();
  private pointsText = "";
  private pointsScale = 0;
  private scale = 1;
  private polls: number[] = [];
  /** The latest showing of the mesh: an older one's analysis is dropped. */
  private showing = 0;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A showing still under way is not this one's any more.
    this.showing += 1;
    for (const timer of this.polls) window.clearTimeout(timer);
    this.polls = [];
    try {
      this.engine?.setNetwork("");
    } catch {
      // The view went first and its engine with it: nothing is drawn any more.
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Linked again, or another plan: the devices are placed again (not read again).
    if ((changed.has("bindings") || changed.has("names")) && this.devices.length > 0) {
      void this.show();
    }
  }

  /** Reads the devices from the source and shows them. */
  private async load(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.source ??= zhaSource(hass);
    try {
      const devices = await this.source.devices();
      // Closed meanwhile: the engine was already told to draw nothing, and must stay so.
      if (!this.isConnected) return;
      this.devices = devices;
      this.loadError = undefined;
      await this.show();
    } catch (error) {
      const t = this.t;
      const code = (error as { code?: unknown } | null)?.code;
      this.loadError = t.t("network.failed", {
        reason: typeof code === "string" ? t.error(code) : t.error("unknown"),
      });
    }
  }

  /**
   * Places the devices, has the analysis module read the mesh (D-043) and hands the engine what it
   * draws. Never rejects: what fails is said in the panel.
   */
  private async show(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const devices = this.devices;
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    this.byId = new Map(devices.map((d) => [d.id, d]));
    this.placed = placeDevices(devices, bindings, (id) => id in this.names);
    const run = (this.showing += 1);
    // Shown again, closed or on another engine meanwhile: the newer run, or the close, has it.
    const current = (): boolean =>
      run === this.showing && this.isConnected && this.engine === engine;
    try {
      let analysis: NetworkAnalysis;
      if (devices.length === 0) {
        // Nothing to draw nor to analyse: the module is not fetched for it.
        engine.setNetwork("");
        analysis = { devices: [], links: [], coordinator: null, health: NO_TROUBLE };
      } else {
        const text = await analyseNetwork(snapshot(devices, this.placed), current, (drawing) =>
          engine.setNetwork(drawing),
        );
        if (text === undefined) return;
        analysis = JSON.parse(text) as NetworkAnalysis;
      }
      this.analysisError = undefined;
      this.analysis = analysis;
      this.qualities = new Map(analysis.devices.map((d) => [d.id, d.quality]));
      this.pointsText = "";
      this.reproject(this.scale);
    } catch {
      if (!current()) return;
      // Nothing drawn rather than a mesh that is not this one.
      this.analysis = undefined;
      this.qualities = new Map();
      try {
        engine.setNetwork("");
      } catch {
        // The view went first and its engine with it: nothing is drawn any more.
      }
      this.analysisError = this.t.t("network.unanalysed");
    }
    fire(this, "domotwin-redraw", undefined);
  }

  /** Reads where the markers go now (`scale`: CSS pixels per device pixel); the view calls it. */
  reproject(scale: number): void {
    this.scale = scale;
    const engine = this.engine;
    if (!engine) return;
    const elements = [...new Set(this.placed.values())];
    const text = elements.length > 0 ? engine.elementPoints(JSON.stringify(elements)) : "{}";
    // The same points at another scale (the view's size or the screen's density changed) move too.
    if (text === this.pointsText && scale === this.pointsScale) return;
    this.pointsText = text;
    this.pointsScale = scale;
    const byElement = JSON.parse(text) as Record<string, [number, number]>;
    // Devices at the same piece side by side, centred on it, each one in reach of a tap.
    const together = new Map<string, string[]>();
    for (const [device, element] of this.placed) {
      together.set(element, [...(together.get(element) ?? []), device]);
    }
    const points: Record<string, [number, number]> = {};
    for (const [element, devices] of together) {
      const p = byElement[element];
      if (!p) continue;
      devices.forEach((device, k) => {
        const aside = (k - (devices.length - 1) / 2) * MARKER_GAP;
        points[device] = [p[0] * scale + aside, p[1] * scale];
      });
    }
    this.points = points;
  }

  /** A tap on a link of the map (the view asks the engine). */
  selectLink(a: string, b: string): void {
    this.selected = { a, b };
  }

  private rescan(): void {
    this.source?.rescan();
    this.scanning = true;
    for (const timer of this.polls) window.clearTimeout(timer);
    this.polls = [];
    for (let at = RESCAN_POLL_MS; at <= RESCAN_FOR_MS; at += RESCAN_POLL_MS) {
      this.polls.push(
        window.setTimeout(() => {
          void this.load();
          if (at === RESCAN_FOR_MS) this.scanning = false;
        }, at),
      );
    }
  }

  private place(device: NetworkDevice): void {
    const request: PlaceRequest = { name: device.name, entities: device.entities };
    if (device.deviceId) request.deviceId = device.deviceId;
    fire(this, "domotwin-network-place", request);
  }

  private device(id: string): NetworkDevice | undefined {
    return this.byId.get(id);
  }

  private quality(id: string): Quality {
    return this.qualities.get(id) ?? "unknown";
  }

  private roomName(id: string): string {
    return this.names[id]?.name || id;
  }

  private ago(seconds: number | undefined): string {
    const t = this.t;
    if (seconds === undefined) return t.t("network.never");
    return timeAgo(t.language, seconds);
  }

  protected override render(): TemplateResult {
    return html`${this.renderMarkers()}
      <section class="sheet glass" data-testid="network" aria-label=${this.t.t("network.title")}>
        ${this.renderSheet()}
      </section>`;
  }

  private renderMarkers(): TemplateResult {
    const t = this.t;
    const stale = new Set(this.analysis?.health.stale ?? []);
    return html`${Object.entries(this.points).map(([id, [x, y]]) => {
      const device = this.device(id);
      if (!device) return nothing;
      const selected = this.selected && "device" in this.selected && this.selected.device === id;
      const glyph =
        device.role === "coordinator"
          ? icon(mdiAccessPoint)
          : device.role === "router"
            ? icon(mdiRouterWireless)
            : nothing;
      const label = t.t("network.node", { name: device.name, role: t.t(`network.${device.role}`) });
      return html`<button
        class="node ${device.role === "unknown" ? "other" : device.role} ${this.quality(id)} ${stale.has(id) ? "stale" : ""}"
        data-device=${id}
        style="left:${x}px;top:${y}px"
        title=${label}
        aria-label=${label}
        aria-pressed=${selected ? "true" : "false"}
        @click=${() => {
          this.selected = { device: id };
        }}
      >
        ${glyph}
      </button>`;
    })}`;
  }

  private renderSheet(): TemplateResult {
    const t = this.t;
    return html`<header>
        <strong>${t.t("network.title")}</strong>
        <button
          class="action quiet small"
          data-testid="network-rescan"
          ?disabled=${this.scanning}
          @click=${() => {
            this.rescan();
          }}
        >
          ${icon(mdiRadar)}${t.t("network.rescan")}
        </button>
      </header>
      ${this.scanning ? html`<p class="hint" role="status">${t.t("network.scanning")}</p>` : nothing}
      ${[this.loadError, this.analysisError].map((error) =>
        error ? html`<p class="hint" role="alert">${error}</p>` : nothing,
      )}
      <div class="legend">
        ${(["good", "fair", "weak"] as const).map(
          (q) => html`<span class="swatch ${q}">${t.t(`network.${q}`)}</span>`,
        )}
      </div>
      ${this.selected ? this.renderSelected(this.selected) : nothing}
      ${this.analysis ? this.renderHealth(this.analysis) : nothing} ${this.renderNotPlaced()}`;
  }

  private renderHealth(analysis: NetworkAnalysis): TemplateResult {
    const t = this.t;
    const { health } = analysis;
    const all = this.devices.length;
    return html`<h3>${t.t("network.health")}</h3>
      <ul data-testid="network-health">
        <li>${t.tp("network.devices", all)}</li>
        <li class=${health.weakLinks > 0 ? "weak" : "good"}>
          <span class="dot"></span>${t.tp("network.weak_links", health.weakLinks)}
        </li>
        <li class=${health.stale.length > 0 ? "fair" : "good"}>
          <span class="dot"></span>${t.tp("network.stale", health.stale.length)}
        </li>
        ${health.weakRooms.map(
          (room) =>
            html`<li class="weak" data-room=${room.room}>
              <span class="dot"></span
              ><span class="grow"
                >${t.tp("network.weak_room", room.links, { room: this.roomName(room.room) })}</span
              >
            </li>`,
        )}
      </ul>`;
  }

  private renderSelected(selected: Selected): TemplateResult | typeof nothing {
    const t = this.t;
    const analysis = this.analysis;
    const close = html`<button
      class="round"
      aria-label=${t.t("network.close")}
      @click=${() => {
        this.selected = undefined;
      }}
    >
      ${icon(mdiClose)}
    </button>`;
    if ("a" in selected) {
      const link = analysis?.links.find(
        (l) =>
          (l.a === selected.a && l.b === selected.b) || (l.a === selected.b && l.b === selected.a),
      );
      const name = (id: string): string => this.device(id)?.name ?? id;
      // What each end's neighbour table says of the other (the link keeps the worse).
      const reported = (from: string, to: string): number | string =>
        this.device(from)?.neighbours.find((n) => n.id === to)?.lqi ?? "–";
      return html`<header data-testid="network-link">
          <h3>${t.t("network.link")}</h3>
          ${close}
        </header>
        <p>${name(selected.a)} ↔ ${name(selected.b)}</p>
        <dl>
          <dt>LQI</dt>
          <dd class=${link?.quality ?? "unknown"}>
            ${link?.lqi ?? "–"} · ${t.t(`network.${link?.quality ?? "unknown"}`)}
          </dd>
        </dl>
        <h3>${t.t("network.reported")}</h3>
        <dl data-testid="network-reported">
          <dt>${name(selected.a)}</dt>
          <dd>${reported(selected.a, selected.b)}</dd>
          <dt>${name(selected.b)}</dt>
          <dd>${reported(selected.b, selected.a)}</dd>
        </dl>`;
    }
    const device = this.device(selected.device);
    if (!device) return nothing;
    const info = analysis?.devices.find((d) => d.id === device.id);
    const via = info?.via ? (this.device(info.via)?.name ?? info.via) : undefined;
    const neighbours = analysis ? neighboursOf(analysis, device.id) : [];
    return html`<header data-testid="network-device">
        <h3>${device.name}</h3>
        ${close}
      </header>
      <dl>
        <dt>${t.t("network.type")}</dt>
        <dd>${t.t(`network.${device.role}`)}</dd>
        <dt>LQI</dt>
        <dd>${device.lqi ?? "–"}</dd>
        <dt>RSSI</dt>
        <dd>${device.rssi === undefined ? "–" : `${device.rssi} dBm`}</dd>
        <dt>${t.t("network.last_seen")}</dt>
        <dd>${this.ago(device.seen)}</dd>
        ${
          info?.hops !== undefined && info.hops > 0
            ? html`<dt>${t.t("network.route")}</dt>
                <dd>${t.tp("network.hops", info.hops, { via: via ?? "" })}</dd>`
            : nothing
        }
      </dl>
      <h3>${t.t("network.neighbours")}</h3>
      ${
        neighbours.length === 0
          ? html`<p class="hint">${t.t("network.no_neighbours")}</p>`
          : html`<ul>
              ${neighbours.map(
                (n) =>
                  html`<li class=${n.quality}>
                    <span class="dot"></span
                    ><span class="grow">${this.device(n.id)?.name ?? n.id}</span
                    ><span>${n.lqi ?? "–"}</span>
                  </li>`,
              )}
            </ul>`
      }`;
  }

  private renderNotPlaced(): TemplateResult | typeof nothing {
    const t = this.t;
    const loose = this.devices.filter((d) => !this.placed.has(d.id));
    if (loose.length === 0) return nothing;
    return html`<h3>${t.t("network.not_placed")}</h3>
      <ul data-testid="network-not-placed">
        ${loose.map(
          (device) =>
            html`<li data-device=${device.id}>
              <span class="grow"
                ><span>${device.name}</span>
                <small class="hint">${t.t(`network.${device.role}`)}</small></span
              >
              ${
                this.placeable
                  ? html`<button
                      class="action quiet small"
                      aria-label=${t.t("network.place", { name: device.name })}
                      @click=${() => {
                        this.place(device);
                      }}
                    >
                      ${icon(mdiMapMarkerPlus)}${t.t("network.place_short")}
                    </button>`
                  : nothing
              }
            </li>`,
        )}
      </ul>`;
  }
}

define("domotwin-network", DomoTwinNetwork);
