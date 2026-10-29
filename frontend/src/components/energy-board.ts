/**
 * `<domotwin-energy-board>`: the Energy tab's board, beside the plan (under it on a phone, D-092).
 * What the home uses now and where it comes from; what it used today, as Home Assistant's energy
 * settings and statistics count it; the pieces and the rooms using the most now, a tap showing them
 * on the plan. Loaded the first time the tab shows.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import {
  mdiArrowRight,
  mdiBatteryHigh,
  mdiCogOutline,
  mdiHomeLightningBoltOutline,
  mdiTransmissionTower,
  mdiWeatherSunny,
} from "@mdi/js";

import { nowOf, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { NO_BINDINGS, type BindingsJson } from "../live/bindings";
import { energyFlows, energyNow, type EnergySettings } from "../live/energy";
import {
  allStats,
  changesOf,
  energyStats,
  energyToday,
  formatEnergy,
  powerNow,
  startOfToday,
  statName,
  type EnergyToday,
} from "../live/energy-board";
import { formatPower } from "../live/layers";
import { timeStyle } from "../live/schedules";
import { define, fire } from "./define";
import { energyFlow, energyStyles } from "./energy-flow";
import { icon, mirroredIcon } from "./icon";
import { baseStyles } from "./styles";

/** How often today's energy is asked again while the board shows (ms), and again after a failure. */
const TODAY_MS = 5 * 60_000;
const RETRY_MS = 30_000;
/** The pieces and the rooms listed at most. */
const MAX_PIECES = 8;
const MAX_ROOMS = 8;
/** The colours of where power comes from, as the flow draws them. */
const SOLAR = "#f2a93b";
const GRID = "#5b8def";
const BATTERY = "#3fb37f";

export class DomoTwinEnergyBoard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    energy: { attribute: false },
    bindings: { attribute: false },
    plans: { attribute: false },
    unseenPiece: { attribute: false },
    unseenEntity: { attribute: false },
    page: { attribute: false },
    admin: { type: Boolean },
    today: { state: true },
    todayState: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  /** DomoTwin's energy sensors (its settings, D-049). */
  energy?: EnergySettings;
  bindings: BindingsJson = NO_BINDINGS;
  /** The plans of the storeys shown, for the pieces' and rooms' names. */
  plans: readonly unknown[] = [];
  /** Pieces and entities the viewer may not see (D-039, D-071). */
  unseenPiece: (element: string) => boolean = () => false;
  unseenEntity: (entity: string) => boolean = () => false;
  /** Home Assistant's own energy page, when it has one. */
  page?: string;
  admin = false;
  /** What the home used today, once read. */
  protected today?: EnergyToday;
  /** Whether today's energy is known, being read, or not counted by Home Assistant. */
  protected todayState: "reading" | "known" | "none" = "reading";
  private todayFrom?: unknown;
  private todayTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Failures in a row: after a few, Home Assistant's answer is taken as it is. */
  private failures = 0;

  static override styles = [
    baseStyles,
    energyStyles,
    css`
      :host {
        display: block;
        overflow: auto;
        padding: 12px 16px 24px;
        box-sizing: border-box;
      }
      .cards {
        display: grid;
        gap: 12px;
        max-width: 640px;
        margin: 0 auto;
      }
      article {
        padding: 14px 16px;
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      h2 {
        margin: 0 0 10px;
        font-size: 1rem;
        font-weight: 600;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }
      .tile {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        column-gap: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--tone, #888) 12%, transparent);
      }
      .tile svg {
        grid-row: span 2;
        width: 22px;
        height: 22px;
        fill: var(--tone, currentColor);
      }
      .tile .value {
        font-size: 1.15rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .tile .what {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.8rem;
      }
      .flow {
        display: flex;
        justify-content: center;
      }
      .flow svg {
        width: min(100%, 360px);
        height: auto;
      }
      /* Where today's energy came from: one bar, its parts. */
      .mix {
        display: flex;
        height: 14px;
        border-radius: 7px;
        overflow: hidden;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
        margin: 6px 0;
      }
      .mix span {
        height: 100%;
      }
      .keys {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 0.8rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .keys i {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-inline-end: 4px;
        border-radius: 3px;
        vertical-align: -1px;
      }
      .said {
        margin: 8px 0 0;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      h3 {
        margin: 12px 0 6px;
        font-size: 0.9rem;
        font-weight: 600;
      }
      button.row,
      li.row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas: "name value" "bar bar";
        gap: 4px 8px;
        width: 100%;
        padding: 6px 8px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
      }
      button.row {
        cursor: pointer;
      }
      button.row:hover,
      button.row:focus-visible {
        background: color-mix(in srgb, var(--primary-text-color, #000) 6%, transparent);
      }
      .row .name {
        grid-area: name;
        overflow-wrap: anywhere;
      }
      .row .name small {
        color: var(--secondary-text-color, #5f6368);
      }
      .row .value {
        grid-area: value;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .row .bar {
        grid-area: bar;
        height: 6px;
        border-radius: 3px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
        overflow: hidden;
      }
      .row .bar span {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      .muted {
        color: var(--secondary-text-color, #5f6368);
      }
      a.page,
      button.settings {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        cursor: pointer;
        text-decoration: none;
      }
      a.page svg,
      button.settings svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.todayFrom = undefined;
    clearInterval(this.todayTimer);
    this.todayTimer = setInterval(() => {
      this.todayFrom = undefined;
      this.readToday();
    }, TODAY_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.todayTimer);
    clearTimeout(this.retryTimer);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("hass")) this.readToday();
  }

  /** What the home used today, asked of Home Assistant once per connection and a while. */
  private readToday(): void {
    const hass = this.hass;
    if (!hass || this.todayFrom === hass.connection) return;
    this.todayFrom = hass.connection;
    const from = hass.connection;
    void (async () => {
      try {
        const prefs = await hass.connection.sendMessagePromise<unknown>({
          type: "energy/get_prefs",
        });
        const stats = energyStats(prefs);
        if (!stats) {
          if (this.hass?.connection === from) this.todayState = "none";
          return;
        }
        const answer = await hass.connection.sendMessagePromise<unknown>({
          type: "recorder/statistics_during_period",
          start_time: startOfToday(new Date(nowOf(hass)), timeStyle(hass).timeZone),
          statistic_ids: allStats(stats),
          period: "day",
          types: ["change"],
          units: { energy: "kWh" },
        });
        if (this.hass?.connection !== from) return;
        this.today = energyToday(stats, changesOf(answer));
        this.todayState = "known";
        this.failures = 0;
      } catch (error) {
        if (this.hass?.connection !== from) return;
        // Energy never set up in Home Assistant: nothing to say. Anything else (the connection
        // went a moment): what was known stays, and it is asked again soon.
        this.failures += 1;
        if ((error as { code?: unknown } | null)?.code === "not_found" || this.failures > 3) {
          if (this.todayState !== "known") this.todayState = "none";
          return;
        }
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.todayFrom = undefined;
          this.readToday();
        }, RETRY_MS);
      }
    })();
  }

  private tile(tone: string, glyph: string, value: string, what: string): TemplateResult {
    return html`<div class="tile" style="--tone:${tone}">
      ${icon(glyph)}
      <span class="value">${value}</span>
      <span class="what">${what}</span>
    </div>`;
  }

  /** What the home uses now and where it comes from, with the flow between them. */
  private renderNow(hass: HomeAssistant, t: Translator): TemplateResult {
    const language = t.language;
    const settings = this.energy;
    const now = settings ? energyNow(hass, settings) : undefined;
    const said = now && Object.keys(now).length > 0 ? now : undefined;
    const flows = said ? energyFlows(said) : undefined;
    const tiles: TemplateResult[] = [];
    if (flows && said) {
      tiles.push(
        this.tile(
          "#9b7bd8",
          mdiHomeLightningBoltOutline,
          formatPower(flows.home, language),
          t.t("energy.now_home"),
        ),
      );
      if (said.solar !== undefined) {
        tiles.push(
          this.tile(
            SOLAR,
            mdiWeatherSunny,
            formatPower(said.solar, language),
            t.t("energy.now_solar"),
          ),
        );
      }
      if (said.grid !== undefined) {
        tiles.push(
          this.tile(
            GRID,
            mdiTransmissionTower,
            formatPower(Math.abs(said.grid), language),
            t.t(said.grid >= 0 ? "energy.now_bought" : "energy.now_sold"),
          ),
        );
      }
      if (said.level !== undefined) {
        tiles.push(
          this.tile(
            BATTERY,
            mdiBatteryHigh,
            new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(
              Math.min(Math.max(said.level, 0), 100) / 100,
            ),
            t.t("energy.now_battery"),
          ),
        );
      }
    }
    return html`<article data-testid="energy-now">
      <h2>${t.t("energy.now")}</h2>
      ${
        flows && said
          ? html`<div class="tiles">${tiles}</div>
              <div class="flow">${energyFlow(t, said, flows)}</div>`
          : html`<p class="muted">${t.t("energy.now_none")}</p>
              ${
                this.admin
                  ? html`<button
                      class="settings"
                      data-testid="energy-settings"
                      @click=${() => {
                        fire(this, "domotwin-energy-settings", {});
                      }}
                    >
                      ${icon(mdiCogOutline)}<span>${t.t("energy.settings")}</span>
                    </button>`
                  : nothing
              }`
      }
    </article>`;
  }

  /** What the home used today, where it came from, and the devices that used the most. */
  private renderToday(hass: HomeAssistant, t: Translator): TemplateResult | typeof nothing {
    const today = this.today;
    if (this.todayState === "none") {
      return this.page
        ? html`<article data-testid="energy-today">
            <h2>${t.t("energy.today")}</h2>
            <p class="muted">${t.t("energy.today_unknown")}</p>
            ${this.pageLink(t)}
          </article>`
        : nothing;
    }
    if (this.todayState === "reading" || !today) {
      return html`<article data-testid="energy-today">
        <h2>${t.t("energy.today")}</h2>
        <p class="muted">${t.t("energy.reading")}</p>
      </article>`;
    }
    const language = t.language;
    const kwh = (value: number): string => formatEnergy(value, language);
    const tiles: TemplateResult[] = [];
    if (today.home !== undefined) {
      tiles.push(
        this.tile(
          "#9b7bd8",
          mdiHomeLightningBoltOutline,
          kwh(today.home),
          t.t("energy.today_used"),
        ),
      );
    }
    if (today.solar !== undefined) {
      tiles.push(this.tile(SOLAR, mdiWeatherSunny, kwh(today.solar), t.t("energy.today_solar")));
    }
    if (today.gridIn !== undefined) {
      tiles.push(
        this.tile(GRID, mdiTransmissionTower, kwh(today.gridIn), t.t("energy.today_bought")),
      );
    }
    if (today.gridOut !== undefined && today.gridOut > 0) {
      tiles.push(
        this.tile(GRID, mdiTransmissionTower, kwh(today.gridOut), t.t("energy.today_sold")),
      );
    }
    // Where what the home used came from: the sun used at home, the battery, the grid.
    const home = today.home ?? 0;
    const fromSun = today.fromSun ?? 0;
    const fromBattery = today.fromBattery ?? 0;
    const fromGrid = today.fromGrid ?? 0;
    const parts = (
      [
        { key: "solar", color: SOLAR, value: fromSun },
        { key: "battery", color: BATTERY, value: fromBattery },
        { key: "grid", color: GRID, value: fromGrid },
      ] as const
    ).filter((part) => home > 0 && part.value / home >= 0.005);
    const percent = (value: number): string =>
      new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(value);
    // What rounds to nothing is not listed, nor what the viewer may not see.
    const devices = today.devices
      .filter((device) => device.kwh >= 0.05 && !this.unseenEntity(device.id))
      .slice(0, 5);
    const most = devices[0]?.kwh ?? 0;
    if (tiles.length === 0 && devices.length === 0) {
      // Set up, but nothing counted yet: Home Assistant's statistics come once an hour.
      return html`<article data-testid="energy-today">
        <h2>${t.t("energy.today")}</h2>
        <p class="muted">${t.t("energy.today_empty")}</p>
        ${this.pageLink(t)}
      </article>`;
    }
    return html`<article data-testid="energy-today">
      <h2>${t.t("energy.today")}</h2>
      ${tiles.length > 0 ? html`<div class="tiles">${tiles}</div>` : nothing}
      ${
        home > 0 && parts.length > 0
          ? html`<div
                class="mix"
                role="img"
                aria-label=${parts
                  .map((part) => `${t.t(`energy.part_${part.key}`)} ${percent(part.value / home)}`)
                  .join(", ")}
              >
                ${parts.map(
                  (part) =>
                    html`<span
                      style="width:${(part.value / home) * 100}%;background:${part.color}"
                    ></span>`,
                )}
              </div>
              <div class="keys" aria-hidden="true">
                ${parts.map(
                  (part) =>
                    html`<span
                      ><i style="background:${part.color}"></i>${t.t(`energy.part_${part.key}`)}
                      ${percent(part.value / home)}</span
                    >`,
                )}
              </div>`
          : nothing
      }
      ${
        today.ownShare !== undefined
          ? html`<p class="said" data-testid="energy-own">
              ${t.t("energy.today_own", { share: percent(today.ownShare) })}
            </p>`
          : nothing
      }
      ${
        devices.length > 0
          ? html`<h3>${t.t("energy.today_devices")}</h3>
              <ul data-testid="energy-devices">
                ${devices.map(
                  (device) =>
                    html`<li class="row">
                      <span class="name"
                        >${statName(
                          hass,
                          this.bindings,
                          this.plans,
                          device.id,
                          this.unseenPiece,
                        )}</span
                      >
                      <span class="value">${kwh(device.kwh)}</span>
                      <span class="bar"
                        ><span style="width:${most > 0 ? (device.kwh / most) * 100 : 0}%"></span
                      ></span>
                    </li>`,
                )}
              </ul>`
          : nothing
      }
      ${this.pageLink(t)}
    </article>`;
  }

  private pageLink(t: Translator): TemplateResult | typeof nothing {
    return this.page
      ? html`<a class="page" href=${this.page} data-testid="energy-page"
          ><span>${t.t("energy.open_page")}</span>${mirroredIcon(mdiArrowRight)}</a
        >`
      : nothing;
  }

  /** The pieces using the most now, and the rooms; a tap shows one on the plan. */
  private renderPower(hass: HomeAssistant, t: Translator): TemplateResult {
    const language = t.language;
    // The home's own meters are the whole home's, not a piece's.
    const meters = new Set(
      [this.energy?.solar, this.energy?.grid, this.energy?.battery].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const { pieces, rooms } = powerNow(hass, this.bindings, this.plans, {
      element: this.unseenPiece,
      entity: (entity) => meters.has(entity) || this.unseenEntity(entity),
    });
    const shown = pieces.slice(0, MAX_PIECES);
    const top = shown[0]?.watts ?? 0;
    const roomNames = new Map(rooms.map((room) => [room.room, room.name]));
    const row = (
      id: string,
      name: TemplateResult | string,
      label: string,
      power: number,
      most: number,
      testid: string,
    ): TemplateResult =>
      html`<li>
        <button
          class="row"
          data-testid=${testid}
          data-element=${id}
          title=${t.t("energy.show", { name: label })}
          @click=${() => {
            fire(this, "domotwin-energy-show", { element: id });
          }}
        >
          <span class="name">${name}</span>
          <span class="value">${formatPower(power, language)}</span>
          <span class="bar"
            ><span style="width:${most > 0 ? (power / most) * 100 : 0}%"></span
          ></span>
        </button>
      </li>`;
    return html`<article data-testid="energy-pieces">
        <h2>${t.t("energy.pieces")}</h2>
        ${
          shown.length > 0
            ? html`<ul>
                ${shown.map((piece) => {
                  const room = piece.room ? roomNames.get(piece.room) : undefined;
                  return row(
                    piece.element,
                    room ? html`${piece.name} <small>· ${room}</small>` : piece.name,
                    piece.name,
                    piece.watts,
                    top,
                    "energy-piece",
                  );
                })}
              </ul>`
            : html`<p class="muted">${t.t("energy.pieces_none")}</p>`
        }
      </article>
      ${
        rooms.length > 1
          ? html`<article data-testid="energy-rooms">
              <h2>${t.t("energy.rooms")}</h2>
              <ul>
                ${rooms
                  .slice(0, MAX_ROOMS)
                  .map((room) =>
                    row(
                      room.room,
                      room.name,
                      room.name,
                      room.watts,
                      rooms[0]?.watts ?? 0,
                      "energy-room",
                    ),
                  )}
              </ul>
            </article>`
          : nothing
      }`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    return html`<div class="cards" data-testid="energy-board">
      ${this.renderNow(hass, t)} ${this.renderToday(hass, t)} ${this.renderPower(hass, t)}
    </div>`;
  }
}

define("domotwin-energy-board", DomoTwinEnergyBoard);
