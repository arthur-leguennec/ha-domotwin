/**
 * `<domotwin-room-graphs>`, a room's graphs (D-067): what its area's entities measured over the
 * last day or week, as Home Assistant's own history-graph and statistics-graph cards, one for each
 * kind of measure; the same as a table (the history report, D-058) and in Home Assistant's
 * History, a tap away. Where Home Assistant's cards are not (the demo house, D-050), DomoTwin's
 * own rows say what each entity says now.
 */
import { mdiOpenInNew, mdiTableLarge } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { CardConfig } from "../ha/cards";
import { nowOf, type HomeAssistant } from "../ha/types";
import type { MessageKey, Translator } from "../i18n";
import { navigate } from "../live/actions";
import {
  GRAPH_PERIODS,
  graphCard,
  graphEntities,
  graphSpan,
  roomGraphs,
  type GraphPeriod,
  type RoomGraph,
} from "../live/graphs";
import { areaEntities } from "../live/bindings";
import { haPagePath } from "../live/history";
import { define, fire } from "./define";
import "./ha-card";
import { icon } from "./icon";
import { practicalStyles } from "./practical-styles";
import { baseStyles } from "./styles";

/** The words of a graph's kind: DomoTwin's own for those it knows, else its unit. */
export function graphTitle(t: Translator, graph: RoomGraph): string {
  const key = `graphs.kinds.${graph.kind}`;
  const known = t.t(key as MessageKey);
  const words =
    known !== key
      ? known
      : graph.unit
        ? t.t("graphs.unit", { unit: graph.unit })
        : graph.kind.startsWith("unit:")
          ? t.t("graphs.other")
          : graph.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return graph.meter ? t.t("graphs.meter", { kind: words }) : words;
}

export class DomoTwinRoomGraphs extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    area: { attribute: false },
    name: { attribute: false },
    unseen: { attribute: false },
    period: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  /** The room's area in Home Assistant. */
  area = "";
  /** The room's name. */
  name = "";
  /** The entities the viewer may not see (linked to a private room, D-039). */
  unseen: ReadonlySet<string> = new Set();
  protected period: GraphPeriod = "day";
  private graphs: RoomGraph[] = [];
  /** Home Assistant's cards of the graphs, over the period shown. */
  private cards: { graph: RoomGraph; config: CardConfig }[] = [];
  /** The area's entities, found again only when Home Assistant's registries or the area change. */
  private inArea?: { entities: unknown; devices: unknown; area: string; ids: string[] };
  /** What the graphs and their cards were made from, made again only when it changes. */
  private madeFrom?: { signature: string; unseen: unknown };

  static override styles = [
    baseStyles,
    practicalStyles,
    css`
      :host {
        overflow: visible;
        background: none;
      }
      .graphs {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
        gap: 8px;
      }
      .periods {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 3px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 6%, transparent);
        justify-self: start;
      }
      .periods button {
        min-height: 36px;
        padding: 0 14px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .periods button[aria-pressed="true"] {
        background: var(--domotwin-accent, var(--primary-color, #03a9f4));
        color: var(--text-primary-color, #fff);
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .wrap {
        display: grid;
        gap: 12px;
      }
    `,
  ];

  protected override willUpdate(): void {
    const { hass, t } = this;
    if (!hass || !t) return;
    let inArea = this.inArea;
    if (
      !inArea ||
      inArea.entities !== hass.entities ||
      inArea.devices !== hass.devices ||
      inArea.area !== this.area
    ) {
      const ids = areaEntities(hass, this.area, false);
      inArea = this.inArea = {
        entities: hass.entities,
        devices: hass.devices,
        area: this.area,
        ids,
      };
    }
    // What sorts an entity into its card is its kind, its unit and its name, not its state.
    const signature = [
      t.language,
      this.period,
      ...inArea.ids.map((id) => {
        const said = hass.states[id]?.attributes;
        if (!said) return id;
        const { device_class, unit_of_measurement, state_class, friendly_name } = said;
        return JSON.stringify([id, device_class, unit_of_measurement, state_class, friendly_name]);
      }),
    ].join("\n");
    const made = this.madeFrom;
    if (made?.signature === signature && made.unseen === this.unseen) return;
    this.madeFrom = { signature, unseen: this.unseen };
    this.graphs = roomGraphs(hass, this.area, new Intl.Collator(t.language), this.unseen);
    this.cards = this.graphs.map((graph) => ({
      graph,
      config: graphCard(graph, this.period, graphTitle(t, graph)),
    }));
  }

  /** The report of the same entities over the same period (D-058), which the panel opens. */
  private readonly openTable = (): void => {
    // The report keeps the first eight (D-058): the measures first.
    fire(this, "domotwin-open-history", {
      entities: graphEntities(this.graphs),
      heading: this.name,
      period: this.period,
    });
  };

  /** Home Assistant's History, on the same entities over the same period. */
  private readonly openHistory = (): void => {
    const hass = this.hass;
    if (!hass) return;
    navigate(
      haPagePath("history", graphEntities(this.graphs), graphSpan(this.period, nowOf(hass))),
    );
  };

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    const graphs = this.graphs;
    if (graphs.length === 0) {
      return html`<p class="muted" data-testid="graphs-none">${t.t("graphs.none")}</p>`;
    }
    return html`<div class="wrap">
      <div class="periods" role="group" aria-label=${t.t("graphs.period")}>
        ${GRAPH_PERIODS.map(
          (period) =>
            html`<button
              data-testid="graphs-${period}"
              aria-pressed=${this.period === period ? "true" : "false"}
              @click=${() => {
                this.period = period;
              }}
            >
              ${t.t(`graphs.${period}`)}
            </button>`,
        )}
      </div>
      <div class="graphs" data-testid="graphs">
        ${this.cards.map(
          ({ graph, config }) =>
            html`<domotwin-ha-card
              data-kind=${graph.kind}
              .hass=${hass}
              .t=${t}
              .config=${config}
            ></domotwin-ha-card>`,
        )}
      </div>
      ${
        // The sandbox's day has a report of its own (D-057).
        hass.sandbox
          ? nothing
          : html`<div class="footer">
              <button class="action quiet" data-testid="graphs-table" @click=${this.openTable}>
                ${icon(mdiTableLarge)}${t.t("graphs.table")}
              </button>
              ${
                // Home Assistant's pages show the home's entities, not the demo house's (D-050).
                hass.demo
                  ? nothing
                  : html`<button
                      class="action quiet"
                      data-testid="graphs-ha-history"
                      @click=${this.openHistory}
                    >
                      ${icon(mdiOpenInNew)}${t.t("graphs.ha_history")}
                    </button>`
              }
            </div>`
      }
    </div>`;
  }
}

define("domotwin-room-graphs", DomoTwinRoomGraphs);
