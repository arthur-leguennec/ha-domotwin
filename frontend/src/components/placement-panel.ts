/**
 * `<domotwin-placement>`: the radio coverage over the view (`DECISIONS.md`, D-057). For the radio
 * chosen, the rooms coloured by how well it covers them (the engine draws them, with its coverage
 * scale), the radios placed and the spots where the next one helps most as markers, and a sheet:
 * the spots and what each changes, the rooms worst covered first with what was measured or is
 * predicted, the radios. Loaded the first time the layer is shown.
 */
import {
  mdiAccessPoint,
  mdiBluetooth,
  mdiClose,
  mdiMapMarkerPlus,
  mdiRouterWireless,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { advisePlacement, analyseNetwork } from "../analysis/analysis";
import { heatLegend, type DomoTwinEngine, type HomeStorey } from "../engine/engine";
import { DomoTwinClient } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { placementEn, placementFr } from "../i18n/placement";
import type { BindingsJson } from "../live/bindings";
import { placeDevices, snapshot, zhaSource, type NetworkAnalysis } from "../live/network";
import {
  LEVEL_RANK,
  MAX_ACCESS_POINTS,
  bluetoothReadings,
  coverageValues,
  homeNames,
  pieceIds,
  placementInput,
  wifiReadings,
  worstFirst,
  zigbeeReadings,
  type AccessPoint,
  type AdvisedSpot,
  type CoverageLevel,
  type PlacementAdvice,
  type RadioKind,
  type RadioReadings,
  type RoomCoverage,
} from "../live/placement";
import { storeyLevels, storeyName } from "../live/storeys";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: placementEn, fr: placementFr });

/** The radio chosen last, kept by this device's browser. */
const RADIO_KEY = "domotwin-coverage-radio";
/**
 * How often, at most, the Wi-Fi signals are read again as Home Assistant's states change (ms):
 * devices report theirs every minute or so, and working the advice out takes up to tens of
 * milliseconds.
 */
const WIFI_EVERY_MS = 30_000;
const LEVELS: readonly CoverageLevel[] = ["good", "fair", "weak", "out"];
const RADIO_ICONS: Record<RadioKind, string> = {
  bluetooth: mdiBluetooth,
  zigbee: mdiRouterWireless,
  wifi: mdiAccessPoint,
};
/** Colours of the levels where the engine's scale is not known yet (its stops otherwise). */
const FALLBACK_COLOURS: Record<CoverageLevel, string> = {
  out: "#d7191c",
  weak: "#f28a2e",
  fair: "#f2d03a",
  good: "#2ab05a",
};

function storedRadio(): RadioKind | undefined {
  try {
    const stored = localStorage.getItem(RADIO_KEY);
    return stored === "bluetooth" || stored === "zigbee" || stored === "wifi" ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** A marker over the view: a radio placed or a spot advised, where it is drawn (CSS pixels). */
interface Marker {
  kind: "radio" | "spot";
  /** The radio's id, or the spot's rank (1 first). */
  id: string;
  x: number;
  y: number;
}

export class DomoTwinPlacement extends LitElement {
  static override properties = {
    hass: { attribute: false },
    engine: { attribute: false },
    bindings: { attribute: false },
    storeys: { attribute: false },
    storey: { attribute: false },
    placeable: { attribute: false },
    accessPoints: { attribute: false },
    closed: { attribute: false },
    radio: { state: true },
    advice: { state: true },
    readings: { state: true },
    markers: { state: true },
    selected: { state: true },
    error: { state: true },
    working: { state: true },
    asking: { state: true },
    noBluetooth: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        --good: #2ab05a;
        --fair: #f2d03a;
        --weak: #f28a2e;
        --out: #d7191c;
      }
      .marker {
        position: absolute;
        transform: translate(-50%, -50%);
        display: grid;
        place-items: center;
        padding: 0;
        border-radius: 50%;
        pointer-events: auto;
        cursor: pointer;
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
      }
      .marker.radio {
        width: 26px;
        height: 26px;
        border: 2px solid var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--card-background-color, #fff) 92%, transparent);
        color: var(--primary-color, #03a9f4);
        cursor: default;
      }
      .marker.radio svg {
        width: 16px;
        height: 16px;
      }
      .marker.spot {
        width: 30px;
        height: 30px;
        border: 3px dashed var(--primary-color, #03a9f4);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font-weight: 700;
        font-size: 0.9rem;
      }
      .marker.spot[aria-pressed="true"] {
        border-style: solid;
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
      }
      .sheet {
        /* Beside the view's tools (a column 48px wide at the top right), never over them. */
        position: absolute;
        right: 68px;
        bottom: 12px;
        width: min(360px, calc(100% - 80px));
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 12px 14px;
        box-sizing: border-box;
        pointer-events: auto;
        font-size: 0.875rem;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      header strong {
        flex: 1;
      }
      h3 {
        margin: 12px 0 6px;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--secondary-text-color, #5f6368);
      }
      .radios {
        display: flex;
        gap: 4px;
        margin: 8px 0 4px;
        flex-wrap: wrap;
      }
      .radios button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .radios button[aria-pressed="true"] {
        background: var(--primary-color, #03a9f4);
        border-color: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
      }
      .radios svg {
        width: 16px;
        height: 16px;
      }
      .hint {
        margin: 4px 0;
        color: var(--secondary-text-color, #5f6368);
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
      .swatch::before,
      .dot {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 3px;
        background: var(--q);
        flex: none;
      }
      ul,
      ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 4px 0;
      }
      li .grow {
        flex: 1;
        min-width: 0;
      }
      li small {
        display: block;
        color: var(--secondary-text-color, #5f6368);
      }
      .dot {
        margin-top: 4px;
      }
      .level {
        white-space: nowrap;
      }
      button.spot {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.spot[aria-pressed="true"] {
        border-color: var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 10%, transparent);
      }
      .rank {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid var(--primary-color, #03a9f4);
        font-weight: 700;
        font-size: 0.8rem;
        flex: none;
      }
      .changes li {
        padding: 0;
        gap: 6px;
        align-items: center;
      }
      .good {
        --q: var(--good);
      }
      .fair {
        --q: var(--fair);
      }
      .weak {
        --q: var(--weak);
      }
      .out {
        --q: var(--out);
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
      .asking {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
    `,
  ];

  hass?: HomeAssistant;
  engine?: DomoTwinEngine;
  bindings?: BindingsJson;
  /** Every storey's plan and overlay, lowest first. */
  storeys: HomeStorey[] = [];
  /** The storey shown alone (its id), or none when every storey is shown. */
  storey?: string;
  /** Access points can be placed (the panel). */
  placeable = false;
  /** The Wi-Fi access points placed (the home's settings). */
  accessPoints: AccessPoint[] = [];
  /**
   * The private rooms this viewer may not see (D-039): their coverage, what measured it and the
   * spots in them are not shown, as their floors are not coloured.
   */
  closed: ReadonlySet<string> = new Set();

  protected radio: RadioKind = "bluetooth";
  protected advice?: PlacementAdvice;
  protected readings?: RadioReadings;
  protected markers: Marker[] = [];
  /** The spot chosen (its rank, 1 first): the rooms show what it changes. */
  protected selected?: number;
  protected error?: string;
  protected working = false;
  /** An access point is being placed: the next tap on the floor says where. */
  protected asking = false;
  protected noBluetooth = false;

  /** The access points saved here, until the settings say them. */
  private saved?: AccessPoint[];
  private wifiKey = "";
  /** Wi-Fi signals are read again this long after Home Assistant's states change, at most. */
  private wifiTimer?: number;
  private pointsKey = "";
  private scale = 1;
  /** The latest working out: an older one's advice is dropped. */
  private run = 0;
  /** What the radios were last read and placed from: the storeys, the links, the access points. */
  private inputs?: unknown[];

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** The radios this home can be advised on: Zigbee with ZHA set up. */
  private get kinds(): RadioKind[] {
    const zha = (this.hass?.config?.components ?? []).includes("zha");
    return zha ? ["bluetooth", "zigbee", "wifi"] : ["bluetooth", "wifi"];
  }

  /** Whether an access point is being placed (the view hands it the next tap on the floor). */
  get placing(): boolean {
    return this.asking;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const kinds = this.kinds;
    const stored = storedRadio();
    const components = this.hass?.config?.components ?? [];
    this.radio =
      stored && kinds.includes(stored)
        ? stored
        : components.includes("bluetooth")
          ? "bluetooth"
          : kinds.includes("zigbee")
            ? "zigbee"
            : "wifi";
    // Read at the first update, once its properties are set.
    this.inputs = undefined;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.run += 1;
    window.clearTimeout(this.wifiTimer);
    this.wifiTimer = undefined;
    fire(this, "domotwin-coverage", undefined);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("accessPoints")) this.saved = undefined;
    if (changed.has("closed") && this.advice) {
      // A private room closed or opened (D-039): its spots go or come back.
      if (this.selected !== undefined && this.selected > this.spots().length) {
        this.selected = undefined;
      }
      this.pointsKey = "";
      this.recolour();
      this.reproject(this.scale);
    }
    if (!this.isConnected || !this.hass) return;
    const inputs = [this.storeys, this.bindings, this.accessPoints];
    if (!this.inputs || inputs.some((input, k) => input !== this.inputs?.[k])) {
      // The first time, or another plan, other links or access points: the radios are read and
      // placed again.
      void this.load();
    } else if (changed.has("hass") && this.radio === "wifi" && this.wifiTimer === undefined) {
      // The Wi-Fi signals measured change as they are read again: looked at once in a while.
      this.wifiTimer = window.setTimeout(() => {
        this.wifiTimer = undefined;
        if (!this.isConnected || this.radio !== "wifi" || !this.hass) return;
        const readings = this.wifi();
        if (JSON.stringify(readings.measured) !== this.wifiKey) void this.advise(readings);
      }, WIFI_EVERY_MS);
    }
  }

  private wifi(): RadioReadings {
    return wifiReadings(
      this.hass as HomeAssistant,
      this.bindings ?? { version: 1, rooms: {}, elements: {} },
      this.storeys,
      this.saved ?? this.accessPoints,
    );
  }

  /** Reads the radio chosen from its source, places it and works its advice out. */
  private async load(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const radio = this.radio;
    const run = (this.run += 1);
    this.inputs = [this.storeys, this.bindings, this.accessPoints];
    this.working = true;
    this.error = undefined;
    try {
      let readings: RadioReadings;
      if (radio === "wifi") {
        readings = this.wifi();
      } else if (radio === "bluetooth") {
        const locating = await DomoTwinClient.for(hass).getLocating();
        if (run !== this.run) return;
        this.noBluetooth = locating.status === "no_bluetooth";
        readings = bluetoothReadings(locating);
      } else {
        readings = await this.zigbee(hass, run);
      }
      if (run !== this.run) return;
      await this.advise(readings, run);
    } catch (error) {
      if (run !== this.run) return;
      const t = this.t;
      const code = (error as { code?: unknown } | null)?.code;
      this.error = t.t("placement.failed", {
        reason: typeof code === "string" ? t.error(code) : t.error("unknown"),
      });
      this.advice = undefined;
      this.working = false;
      fire(this, "domotwin-coverage", undefined);
    }
  }

  /** The Zigbee mesh read from ZHA, its devices placed, its links' qualities (D-031). */
  private async zigbee(hass: HomeAssistant, run: number): Promise<RadioReadings> {
    const devices = await zhaSource(hass).devices();
    const pieces = pieceIds(this.storeys);
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    const placed = placeDevices(devices, bindings, (id) => pieces.has(id));
    let analysis: NetworkAnalysis = {
      devices: [],
      links: [],
      coordinator: null,
      health: { weakLinks: 0, stale: [], weakRooms: [] },
    };
    if (devices.length > 0) {
      // The mesh analysed, not drawn: the rooms of its devices are not needed.
      const text = await analyseNetwork(
        snapshot(devices, placed),
        () => run === this.run,
        () => "[]",
      );
      if (text === undefined) return { radios: [], measured: [], unplaced: [] };
      analysis = JSON.parse(text) as NetworkAnalysis;
    }
    return zigbeeReadings(devices, placed, analysis);
  }

  /** Has the analysis module work the advice out (D-057), and the engine colour the rooms. */
  private async advise(readings: RadioReadings, run = (this.run += 1)): Promise<void> {
    const radio = this.radio;
    if (radio === "wifi") this.wifiKey = JSON.stringify(readings.measured);
    try {
      const text = await advisePlacement(
        placementInput(radio, this.storeys, readings),
        () => run === this.run && this.isConnected,
      );
      if (text === undefined) return;
      this.readings = readings;
      this.advice = JSON.parse(text) as PlacementAdvice;
      this.error = undefined;
      if (this.selected !== undefined && this.selected > this.spots().length) {
        this.selected = undefined;
      }
    } catch {
      if (run !== this.run) return;
      this.advice = undefined;
      this.error = this.t.t("placement.unanalysed");
    }
    this.working = false;
    this.pointsKey = "";
    this.recolour();
    this.reproject(this.scale);
  }

  private shown?: { advice: PlacementAdvice; closed: ReadonlySet<string>; spots: AdvisedSpot[] };

  /**
   * The spots shown, ranked: not those in a private room the viewer may not see (D-039), nor what
   * they change in one; a spot left with nothing to change is not shown.
   */
  private spots(): AdvisedSpot[] {
    const advice = this.advice;
    if (!advice) return [];
    const kept = this.shown;
    if (kept?.advice === advice && kept.closed === this.closed) return kept.spots;
    const closed = this.closed;
    const spots = advice.spots
      .filter((spot) => !closed.has(spot.room))
      .map((spot) => ({ ...spot, changes: spot.changes.filter((c) => !closed.has(c.room)) }))
      .filter((spot) => spot.changes.length > 0);
    this.shown = { advice, closed, spots };
    return spots;
  }

  /** The rooms' colours: as covered now, or with the spot chosen. */
  private recolour(): void {
    const advice = this.advice;
    if (!advice) {
      fire(this, "domotwin-coverage", undefined);
      return;
    }
    const values = coverageValues(advice);
    const spot = this.selected !== undefined ? this.spots()[this.selected - 1] : undefined;
    for (const change of spot?.changes ?? []) values[change.room] = LEVEL_RANK[change.to];
    fire(this, "domotwin-coverage", values);
  }

  /** Reads where the markers go now (`scale`: CSS pixels per device pixel); the view calls it. */
  reproject(scale: number): void {
    this.scale = scale;
    const engine = this.engine;
    const advice = this.advice;
    if (!engine || !advice || this.storey === undefined) {
      if (this.markers.length > 0) this.markers = [];
      return;
    }
    const here: { kind: Marker["kind"]; id: string; at: [number, number] }[] = [
      ...advice.radios
        .filter((r) => r.storey === this.storey)
        .map((r) => ({ kind: "radio" as const, id: r.id, at: r.at })),
      ...this.spots().flatMap((s, k) =>
        s.storey === this.storey ? [{ kind: "spot" as const, id: String(k + 1), at: s.at }] : [],
      ),
    ];
    const points = here.length > 0 ? engine.screenPoints(here.flatMap((m) => m.at)) : [];
    const key = `${Array.from(points).join(",")}|${scale}|${here.map((m) => m.id).join(",")}`;
    if (key === this.pointsKey) return;
    this.pointsKey = key;
    this.markers = here.flatMap((m, k) => {
      const x = points[2 * k];
      const y = points[2 * k + 1];
      return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)
        ? [{ kind: m.kind, id: m.id, x: x * scale, y: y * scale }]
        : [];
    });
  }

  /** The floor was tapped where an access point stands (the view asks only while placing). */
  placeAt(at: [number, number]): void {
    const storey = this.storey;
    if (!this.asking || storey === undefined) return;
    this.asking = false;
    const now = this.saved ?? this.accessPoints;
    if (now.length >= MAX_ACCESS_POINTS) {
      this.error = this.t.t("placement.place_full");
      return;
    }
    // The first name not taken: after a removal, no two of the same name.
    const names = new Set(now.map((point) => point.name));
    let n = 1;
    while (names.has(this.t.t("placement.access_point", { n }))) n += 1;
    const point: AccessPoint = {
      storey,
      at: [Math.round(at[0]), Math.round(at[1])],
      name: this.t.t("placement.access_point", { n }),
    };
    void this.saveAccessPoints([...now, point]);
  }

  /**
   * Keeps the access points: shown at once, so that a second change starts from this one; saved
   * with the settings; shown as they were again when the save is refused.
   */
  private async saveAccessPoints(points: AccessPoint[]): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const before = this.saved;
    this.saved = points;
    if (this.radio === "wifi") void this.load();
    const client = DomoTwinClient.for(hass);
    try {
      const { settings } = await client.getSettings();
      await client.saveSettings({ ...settings, access_points: points });
    } catch (error) {
      if (this.saved === points) {
        this.saved = before;
        if (this.radio === "wifi") void this.load();
      }
      const t = this.t;
      const code = (error as { code?: unknown } | null)?.code;
      this.error = t.t("placement.save_failed", {
        reason: typeof code === "string" ? t.error(code) : t.error("unknown"),
      });
    }
  }

  private choose(radio: RadioKind): void {
    if (radio === this.radio) return;
    this.radio = radio;
    this.selected = undefined;
    this.asking = false;
    this.advice = undefined;
    this.readings = undefined;
    try {
      localStorage.setItem(RADIO_KEY, radio);
    } catch {
      // No storage: the radio is chosen again next time.
    }
    void this.load();
  }

  private select(rank: number): void {
    this.selected = this.selected === rank ? undefined : rank;
    this.recolour();
  }

  /** The level's colour on the floors: the engine's coverage scale. */
  private colours(): Record<CoverageLevel, string> {
    const legend = heatLegend("coverage");
    if (!legend) return FALLBACK_COLOURS;
    const at = (rank: number): string | undefined => legend.stops.find(([v]) => v === rank)?.[1];
    return {
      out: at(0) ?? FALLBACK_COLOURS.out,
      weak: at(1) ?? FALLBACK_COLOURS.weak,
      fair: at(2) ?? FALLBACK_COLOURS.fair,
      good: at(3) ?? FALLBACK_COLOURS.good,
    };
  }

  private names?: { storeys: HomeStorey[]; names: Map<string, string> };

  private name(id: string): string {
    if (this.names?.storeys !== this.storeys) {
      this.names = { storeys: this.storeys, names: homeNames(this.storeys) };
    }
    return this.names.names.get(id) ?? id;
  }

  /** A room's name, with its storey's when it is not the one shown. */
  private roomName(id: string, storey: string): string {
    const name = this.name(id);
    if (this.storeys.length < 2 || storey === this.storey) return name;
    const level = storeyLevels(this.storeys).find((s) => s.storey.id === storey);
    if (!level) return name;
    return this.t.t("placement.on_storey", {
      room: name,
      storey: storeyName(this.t, level.storey, level.level),
    });
  }

  private dbm(value: number): string {
    const t = this.t;
    const shown = new Intl.NumberFormat(t.language, { maximumFractionDigits: 0 }).format(value);
    return t.t("placement.dbm", { value: shown });
  }

  private spotPlace(spot: AdvisedSpot): string {
    const room = this.roomName(spot.room, spot.storey);
    return spot.near
      ? this.t.t("placement.spot_near", { room, piece: this.name(spot.near) })
      : this.t.t("placement.spot", { room });
  }

  protected override render(): TemplateResult {
    const colours = this.colours();
    const style = LEVELS.map((level) => `--${level}:${colours[level]}`).join(";");
    return html`<div style=${style}>
      ${this.renderMarkers()}
      <section
        class="sheet glass"
        data-testid="placement"
        aria-label=${this.t.t("placement.title")}
      >
        ${this.renderSheet()}
      </section>
    </div>`;
  }

  private renderMarkers(): TemplateResult {
    const t = this.t;
    return html`${this.markers.map((marker) => {
      const style = `left:${marker.x}px;top:${marker.y}px`;
      if (marker.kind === "radio") {
        const name = this.radioName(marker.id);
        return html`<span
          class="marker radio"
          role="img"
          data-radio=${marker.id}
          style=${style}
          title=${t.t("placement.radio_marker", { name })}
          aria-label=${t.t("placement.radio_marker", { name })}
          >${icon(RADIO_ICONS[this.radio])}</span
        >`;
      }
      const rank = Number(marker.id);
      const spot = this.spots()[rank - 1];
      const label = spot
        ? t.t("placement.spot_marker", { n: rank, place: this.spotPlace(spot) })
        : marker.id;
      return html`<button
        class="marker spot"
        data-spot=${marker.id}
        style=${style}
        title=${label}
        aria-label=${label}
        aria-pressed=${this.selected === rank ? "true" : "false"}
        @click=${() => {
          this.select(rank);
        }}
      >
        ${marker.id}
      </button>`;
    })}`;
  }

  private radioName(id: string): string {
    const name = this.readings?.radios.find((radio) => radio.id === id)?.name;
    if (name) return name;
    const n = /^ap-(\d+)$/.exec(id)?.[1];
    return n ? this.t.t("placement.access_point", { n }) : id;
  }

  private renderSheet(): TemplateResult {
    const t = this.t;
    const advice = this.advice;
    return html`<header>
        <strong>${t.t("placement.title")}</strong>
      </header>
      <div class="radios" role="group" aria-label=${t.t("placement.radio")}>
        ${this.kinds.map(
          (radio) =>
            html`<button
              data-radio-kind=${radio}
              aria-pressed=${this.radio === radio ? "true" : "false"}
              @click=${() => {
                this.choose(radio);
              }}
            >
              ${icon(RADIO_ICONS[radio])}${t.t(`placement.${radio}`)}
            </button>`,
        )}
      </div>
      <p class="hint">${t.t("placement.model")}</p>
      <div class="legend">
        ${LEVELS.map((level) => html`<span class="swatch ${level}">${t.t(`placement.${level}`)}</span>`)}
      </div>
      ${this.working && !advice ? html`<p class="hint" role="status">${t.t("placement.working")}</p>` : nothing}
      ${this.error ? html`<p class="hint" role="alert">${this.error}</p>` : nothing}
      ${this.renderRadios()} ${advice ? this.renderAdvice(advice) : nothing}`;
  }

  private renderAdvice(advice: PlacementAdvice): TemplateResult {
    const t = this.t;
    const radio = this.radio;
    const check = advice.check;
    const agreement = advice.agreement;
    const placedSomewhere = advice.radios.length > 0;
    return html`${
        check
          ? html`<p class="hint" data-testid="placement-check">
              ${t.tp("placement.check", check.measurements, {
                offset: new Intl.NumberFormat(t.language, { signDisplay: "exceptZero" }).format(
                  check.offset,
                ),
                error: new Intl.NumberFormat(t.language, { maximumFractionDigits: 1 }).format(
                  check.error,
                ),
              })}
            </p>`
          : nothing
      }
      ${
        agreement && agreement.rooms > 0
          ? html`<p class="hint" data-testid="placement-agreement">
              ${t.tp("placement.agreement", agreement.rooms, { same: agreement.same })}
            </p>`
          : nothing
      }
      <h3>${t.t(`placement.next_${radio}`)}</h3>
      ${
        this.spots().length === 0
          ? html`<p class="hint" data-testid="placement-covered">${t.t("placement.covered")}</p>`
          : html`<ol data-testid="placement-spots">
                ${this.spots().map((spot, k) => this.renderSpot(spot, k + 1))}
              </ol>
              <p class="hint">${t.t("placement.alone")}</p>
              ${
                placedSomewhere && radio !== "bluetooth"
                  ? html`<p class="hint">${t.t(`placement.reach_${radio}`)}</p>`
                  : nothing
              }
              ${
                this.storey === undefined
                  ? html`<p class="hint">${t.t("placement.one_storey")}</p>`
                  : nothing
              }`
      }
      <h3>${t.t("placement.rooms")}</h3>
      <ul data-testid="placement-rooms">
        ${worstFirst(advice.rooms.filter((room) => !this.closed.has(room.id))).map((room) =>
          this.renderRoom(room),
        )}
      </ul>`;
  }

  private renderSpot(spot: AdvisedSpot, rank: number): TemplateResult {
    const t = this.t;
    return html`<li>
      <button
        class="spot"
        data-spot=${rank}
        aria-pressed=${this.selected === rank ? "true" : "false"}
        @click=${() => {
          this.select(rank);
        }}
      >
        <span class="rank">${rank}</span>
        <span class="grow"
          ><span>${this.spotPlace(spot)}</span>
          <ul class="changes">
            ${spot.changes.map(
              (change) =>
                html`<li class=${change.to}>
                  <span class="dot"></span
                  ><small
                    >${t.t("placement.change", {
                      room: this.roomName(change.room, this.roomStorey(change.room)),
                      from: t.t(`placement.${change.from}`),
                      to: t.t(`placement.${change.to}`),
                    })}</small
                  >
                </li>`,
            )}
          </ul></span
        >
      </button>
    </li>`;
  }

  private roomStorey(id: string): string {
    return this.advice?.rooms.find((room) => room.id === id)?.storey ?? "";
  }

  private renderRoom(room: RoomCoverage): TemplateResult {
    const t = this.t;
    const measured = room.measured;
    const detail = measured
      ? measured.signal !== undefined
        ? t.t("placement.measured_signal", {
            name: measured.name ?? "",
            signal: this.dbm(measured.signal),
          })
        : t.t("placement.measured", { name: measured.name ?? "" })
      : room.predicted !== undefined
        ? t.t("placement.predicted", { signal: this.dbm(room.predicted) })
        : t.t("placement.nothing");
    return html`<li class=${room.level} data-room=${room.id}>
      <span class="dot"></span>
      <span class="grow"
        ><span>${this.roomName(room.id, room.storey)}</span>
        <small data-kind=${measured ? "measured" : "predicted"}>${detail}</small></span
      >
      <span class="level">${t.t(`placement.${room.level}`)}</span>
    </li>`;
  }

  /** The radios of the kind chosen: what is missing, those placed nowhere, the access points. */
  private renderRadios(): TemplateResult | typeof nothing {
    const t = this.t;
    const radio = this.radio;
    const readings = this.readings;
    if (!readings) return nothing;
    const lines: TemplateResult[] = [];
    if (radio === "bluetooth" && this.noBluetooth) {
      lines.push(
        html`<p class="hint" data-testid="placement-missing">${t.t("placement.no_bluetooth")}</p>`,
      );
    } else if (readings.radios.length === 0) {
      const key =
        radio === "bluetooth"
          ? "no_receiver"
          : radio === "zigbee"
            ? "no_router"
            : "no_access_point";
      lines.push(
        html`<p class="hint" data-testid="placement-missing">${t.t(`placement.${key}`)}</p>`,
      );
    }
    if (readings.unplaced.length > 0) {
      lines.push(
        html`<p class="hint" data-testid="placement-unplaced">
          ${t.t("placement.unplaced", { names: readings.unplaced.join(", ") })}
        </p>`,
      );
    }
    if (radio === "bluetooth" && this.placeable && !this.noBluetooth) {
      if (readings.radios.length === 0 || readings.unplaced.length > 0) {
        lines.push(
          html`<button
            class="action quiet small"
            data-testid="placement-bluetooth"
            @click=${() => {
              fire(this, "domotwin-open-bluetooth", undefined);
            }}
          >
            ${icon(mdiBluetooth)}${t.t("placement.bluetooth_settings")}
          </button>`,
        );
      }
    }
    if (radio === "wifi") lines.push(this.renderAccessPoints(readings));
    return html`<h3>${t.t(`placement.radios_${radio}`)}</h3>
      ${lines}`;
  }

  private renderAccessPoints(readings: RadioReadings): TemplateResult {
    const t = this.t;
    const points = this.saved ?? this.accessPoints;
    const shown = this.storey;
    return html`${
        points.length > 0
          ? html`<ul data-testid="placement-access-points">
              ${points.map(
                (point, k) =>
                  html`<li>
                    <span class="grow"
                      >${point.name ?? t.t("placement.access_point", { n: k + 1 })}</span
                    >
                    ${
                      this.placeable
                        ? html`<button
                            class="round"
                            aria-label=${t.t("placement.remove", {
                              name: point.name ?? t.t("placement.access_point", { n: k + 1 }),
                            })}
                            @click=${() => {
                              void this.saveAccessPoints(points.filter((_, j) => j !== k));
                            }}
                          >
                            ${icon(mdiClose)}
                          </button>`
                        : nothing
                    }
                  </li>`,
              )}
            </ul>`
          : nothing
      }
      ${
        this.placeable && shown !== undefined
          ? this.asking
            ? html`<div class="asking" role="status">
                <span>${t.t("placement.place_hint")}</span>
                <button
                  class="action quiet small"
                  @click=${() => {
                    this.asking = false;
                  }}
                >
                  ${t.t("placement.place_cancel")}
                </button>
              </div>`
            : html`<button
                class="action quiet small"
                data-testid="placement-place"
                ?disabled=${points.length >= MAX_ACCESS_POINTS}
                @click=${() => {
                  this.asking = true;
                }}
              >
                ${icon(mdiMapMarkerPlus)}${t.t("placement.place")}
              </button>`
          : nothing
      }
      <p class="hint" data-testid="placement-readings">
        ${
          readings.measured.length > 0
            ? t.tp("placement.readings", readings.measured.length)
            : t.t("placement.no_readings")
        }
      </p>`;
  }
}

define("domotwin-placement", DomoTwinPlacement);
