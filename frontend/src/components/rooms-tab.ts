/**
 * `<domotwin-rooms>`, the Rooms tab (D-055): Home Assistant's floors and areas, a room opened
 * with its entities as Home Assistant's tile cards and its graphs (D-069), and a search through
 * the whole home. Each entity has a star that makes it a favourite of the Home tab.
 */
import { mdiArrowLeft, mdiChartLine, mdiChevronRight, mdiLockOutline, mdiMagnify } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { tileCard } from "../ha/cards";
import type { HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { entityName } from "../live/bindings";
import { failureText } from "../live/actions";
import { graphable } from "../live/graphs";
import { NOTHING_UNSEEN, type Unseen } from "../live/privacy";
import { runRoom, type RoomAction } from "../live/room-actions";
import { homeFloors, searchEntities, type RoomsArea, type RoomsFloor } from "../live/rooms";
import { define } from "./define";
import "./ha-card";
import { icon, mirroredIcon } from "./icon";
import "./room-graphs";
import { practicalStyles, starButton } from "./practical-styles";
import { roomBarStyles, roomButtons } from "./room-bar";
import { baseStyles } from "./styles";

export class DomoTwinRooms extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    favourites: { attribute: false },
    unseen: { attribute: false },
    actions: { attribute: false },
    refused: { state: true },
    area: { attribute: false },
    graphs: { type: Boolean },
    from3d: { type: Boolean },
    query: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  favourites: readonly string[] = [];
  /** What the viewer may not see (D-039). */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The actions an administrator gave the rooms of the plan (D-047), by their area. */
  actions: ReadonlyMap<string, readonly RoomAction[]> = new Map();
  /** What Home Assistant refused last. */
  protected refused?: string;
  /** The room open, an area of Home Assistant. */
  area?: string;
  /** Its graphs are shown (D-069). */
  graphs = false;
  /** The room was opened from the 3D view: its way back leads there. */
  from3d = false;
  protected query = "";
  private floors: RoomsFloor[] = [];
  private searched?: { query: string; from: unknown; found: string[] };
  private collator = new Intl.Collator("en");
  /** What the floors were read from, to read them again only when it changes. */
  private readFrom?: {
    entities: unknown;
    devices: unknown;
    areas: unknown;
    floors: unknown;
    states: unknown;
    unseen: unknown;
    language: unknown;
  };

  static override styles = [
    baseStyles,
    practicalStyles,
    roomBarStyles,
    css`
      .search {
        position: relative;
        display: flex;
        align-items: center;
      }
      .search svg {
        position: absolute;
        inset-inline-start: 12px;
        width: 20px;
        height: 20px;
        fill: var(--secondary-text-color, #5f6368);
        pointer-events: none;
      }
      .search input {
        box-sizing: border-box;
        width: 100%;
        min-height: 44px;
        padding-block: 0;
        padding-inline: 40px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 22px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      .areas {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 8px;
      }
      button.area {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 56px;
        padding: 8px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.area .names {
        flex: 1;
        display: grid;
        min-width: 0;
      }
      button.area .name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button.area svg {
        flex: none;
        width: 20px;
        height: 20px;
        fill: var(--secondary-text-color, #5f6368);
      }
      .room-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .room-head h2 {
        margin: 0;
        font-size: 1.25rem;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues): void {
    const hass = this.hass;
    if (!hass) return;
    const language = this.t?.language;
    if (language && language !== this.readFrom?.language)
      this.collator = new Intl.Collator(language);
    const from = {
      entities: hass.entities,
      devices: hass.devices,
      areas: hass.areas,
      floors: hass.floors,
      // An entity coming or going (renamed or moved, the registries are new).
      states: Object.keys(hass.states).length,
      unseen: this.unseen,
      language,
    };
    const read = this.readFrom;
    if (
      !read ||
      Object.entries(from).some(([key, value]) => read[key as keyof typeof read] !== value)
    ) {
      this.readFrom = from;
      this.floors = homeFloors(hass, this.unseen, this.collator);
    }
    // A room opened from elsewhere: the search gives way.
    if (changed.has("area") && this.area) this.query = "";
  }

  private go(area: string | undefined, graphs = false): void {
    this.dispatchEvent(
      new CustomEvent("domotwin-go", {
        detail: { tab: "rooms", area, graphs },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private readonly back = (): void => {
    if (this.from3d) {
      this.dispatchEvent(
        new CustomEvent("domotwin-go", { detail: { tab: "3d" }, bubbles: true, composed: true }),
      );
    } else this.go(undefined);
  };

  private entities(ids: readonly string[]): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return html``;
    const favourites = new Set(this.favourites);
    return html`<div class="tiles">
      ${ids.map(
        (id) =>
          html`<div class="entity" data-entity=${id}>
            <domotwin-ha-card .hass=${hass} .t=${t} .config=${tileCard(id)}></domotwin-ha-card>
            ${starButton(this, t, entityName(hass, id), id, favourites.has(id))}
          </div>`,
      )}
    </div>`;
  }

  private findArea(id: string): RoomsArea | undefined {
    for (const floor of this.floors) {
      const found = floor.areas.find((area) => area.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private renderRoom(id: string): TemplateResult {
    const t = this.t;
    if (!t) return html``;
    const area = this.findArea(id);
    if (area && !area.closed && this.graphs) return this.renderGraphs(area);
    return html`<div class="page" data-testid="room-page" data-area=${id}>
      <div class="room-head">
        <button class="action" data-testid="room-back" @click=${this.back}>
          ${mirroredIcon(mdiArrowLeft)}${this.from3d ? t.t("rooms.back_3d") : t.t("rooms.back")}
        </button>
        ${
          area?.entities.some((entity) => graphable(this.hass?.states[entity]))
            ? html`<button
                class="action quiet"
                data-testid="room-graphs"
                @click=${() => {
                  this.go(id, true);
                }}
              >
                ${icon(mdiChartLine)}${t.t("graphs.open")}
              </button>`
            : nothing
        }
      </div>
      ${
        area
          ? html`<h2>${area.name}</h2>
              ${area.closed ? nothing : this.renderActions(id)}
              ${
                area.closed
                  ? html`<p class="muted" data-testid="room-private">
                      ${icon(mdiLockOutline)} ${t.t("rooms.private")}
                    </p>`
                  : area.entities.length > 0
                    ? this.entities(area.entities)
                    : html`<p class="muted">${t.t("rooms.empty_room")}</p>`
              }`
          : html`<p class="muted">${t.t("rooms.unknown_room")}</p>`
      }
    </div>`;
  }

  /** The room's graphs (D-069), with the way back to its page. */
  private renderGraphs(area: RoomsArea): TemplateResult {
    const t = this.t;
    if (!t) return html``;
    return html`<div class="page" data-testid="room-graphs-page" data-area=${area.id}>
      <div class="room-head">
        <button
          class="action"
          data-testid="graphs-back"
          @click=${() => {
            this.go(area.id);
          }}
        >
          ${mirroredIcon(mdiArrowLeft)}${t.t("graphs.back", { room: area.name })}
        </button>
      </div>
      <h2>${t.t("graphs.heading", { room: area.name })}</h2>
      <domotwin-room-graphs
        .hass=${this.hass}
        .t=${t}
        .area=${area.id}
        .name=${area.name}
        .unseen=${this.unseen.entities}
      ></domotwin-room-graphs>
    </div>`;
  }

  /** The room's own actions (D-047), as its panel in 3D shows them. */
  private renderActions(area: string): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const actions = this.actions.get(area) ?? [];
    if (!hass || !t || actions.length === 0) return nothing;
    return html`<div class="room-commands" data-testid="room-actions">
      ${roomButtons(
        t,
        [],
        actions,
        (what) => {
          void runRoom(this, hass, what).then(
            (done) => {
              this.refused = done
                ? undefined
                : t.t(hass.sandbox ? "sandbox.no_dialog" : "demo.no_dialog");
            },
            (error: unknown) => {
              this.refused = failureText(t, error);
            },
          );
        },
        true,
      )}
      ${this.refused ? html`<p class="error" role="alert">${this.refused}</p>` : nothing}
    </div>`;
  }

  /** What the search finds, found again when it or the home changes, not on every state. */
  private search(hass: HomeAssistant): string[] | undefined {
    const query = this.query.trim();
    if (!query) return undefined;
    if (this.searched?.query !== query || this.searched.from !== this.readFrom) {
      this.searched = {
        query,
        from: this.readFrom,
        found: searchEntities(hass, query, this.unseen, this.collator),
      };
    }
    return this.searched.found;
  }

  private renderList(): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return html``;
    const found = this.search(hass);
    const several = this.floors.filter((floor) => floor.id !== undefined).length > 0;
    return html`<div class="page" data-testid="rooms-list">
      <label class="search">
        ${icon(mdiMagnify)}
        <input
          type="search"
          data-testid="rooms-search"
          aria-label=${t.t("rooms.search")}
          placeholder=${t.t("rooms.search_placeholder")}
          .value=${this.query}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      ${
        found
          ? html`<section data-testid="rooms-results">
              <h2 role="status">
                ${found.length > 0 ? t.tp("rooms.results", found.length) : t.t("rooms.no_result")}
              </h2>
              ${this.entities(found)}
            </section>`
          : this.floors.length === 0
            ? html`<p class="muted">${t.t("rooms.no_rooms")}</p>`
            : this.floors.map(
                (floor) =>
                  html`<section data-floor=${floor.id ?? ""}>
                    ${
                      floor.name
                        ? html`<h2>${floor.name}</h2>`
                        : several
                          ? html`<h2>${t.t("rooms.other_areas")}</h2>`
                          : nothing
                    }
                    <div class="areas">
                      ${floor.areas.map(
                        (area) =>
                          html`<button
                            class="area"
                            data-area=${area.id}
                            @click=${() => {
                              this.go(area.id);
                            }}
                          >
                            <span class="names">
                              <span class="name">${area.name}</span>
                              <span class="muted">
                                ${
                                  area.closed
                                    ? t.t("rooms.private")
                                    : t.tp("rooms.devices", area.entities.length)
                                }
                              </span>
                            </span>
                            ${area.closed ? icon(mdiLockOutline) : mirroredIcon(mdiChevronRight)}
                          </button>`,
                      )}
                    </div>
                  </section>`,
              )
      }
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this.t) return nothing;
    return this.area ? this.renderRoom(this.area) : this.renderList();
  }
}

define("domotwin-rooms", DomoTwinRooms);
