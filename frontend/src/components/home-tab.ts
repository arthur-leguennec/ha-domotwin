/**
 * `<domotwin-home>`, the Home tab (D-055): the home at a glance (who is in, the lamps on, the
 * doors and windows open, Hydro-Québec's next peak, D-063), the user's shortcuts (D-084), the
 * weather, the favourite scenes as big buttons, the other favourites, and the cards the user
 * chose. Every other control is Home Assistant's own card. The alerts are above every tab (D-068).
 */
import {
  mdiAccountGroupOutline,
  mdiCalendarAccountOutline,
  mdiClose,
  mdiDoorOpen,
  mdiLightbulbGroupOutline,
  mdiLightbulbOn,
  mdiPlus,
  mdiStar,
  mdiStoreClockOutline,
  mdiTransmissionTower,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { card, pressCard, tileCard, type CardConfig } from "../ha/cards";
import { DomoTwinClient, type ClosedEnergyNow } from "../ha/client";
import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { failureText } from "../live/actions";
import {
  BOOKINGS,
  bookingOf,
  meetingRoomsOf,
  serviceTime,
  type Held,
  type MeetingRoom,
} from "../live/meeting-rooms";
import { formatKwh, formatPercent, sinceDay, type ClosedEnergy } from "../live/closed-energy";
import { NO_BINDINGS, areaOf, entityName } from "../live/bindings";
import { isPressed, type Choices, type HomeCard } from "../live/choices";
import { glanceOf, type Glance, type GlanceSources } from "../live/glance";
import { formatPower } from "../live/layers";
import { peakWords } from "../live/peaks";
import { timeStyle, whenText, type Schedule } from "../live/schedules";
import { todayIn } from "../live/upkeep";
import {
  BACK_IN,
  BACK_WHENS,
  asksBack,
  backAt,
  durationText,
  firstChoice,
  heatingAt,
  heatingBack,
  heatingNow,
  type BackChoice,
} from "../live/back";
import { NOTHING_UNSEEN, seen, type Unseen } from "../live/privacy";
import {
  MAX_SHORTCUTS,
  changeShortcuts,
  firstSuggestions,
  makeCalls,
  newId,
  readShortcuts,
  runShortcut,
  shownState,
  suggestions,
  undoCalls,
  type Call,
  type ShownState,
  type Shortcut,
  type ShortcutChange,
  type Suggestion,
} from "../live/shortcuts";
import { define, fire } from "./define";
import "./ha-card";
import { icon } from "./icon";
import { avatar, avatarStyles } from "./person-avatar";
import { practicalStyles, starButton } from "./practical-styles";
import { PENCIL, SHORTCUT_GLYPHS } from "./shortcut-icons";
import { baseStyles } from "./styles";

/** What a chip of the glance opens. */
type Detail = "people" | "lights" | "openings" | "hours" | "meetings" | "peak";

/** Home Assistant's card for a card of the Home tab. */
function cardOf(home: HomeCard): CardConfig {
  switch (home.type) {
    case "calendar":
      return card({ type: "calendar", entities: home.entities, initial_view: "listWeek" });
    case "todo-list":
      return card({ type: "todo-list", entity: home.entity });
    case "summary":
      // DomoTwin's own (D-061), made as Home Assistant makes any custom card.
      return card({ type: "custom:domotwin-summary-card", summary: home.summary });
  }
}

/** What the shortcuts' dialog is open on: suggestions to add, or a shortcut to change. */
type ShortcutDialog = { mode: "add" } | { mode: "edit"; shortcut: Shortcut };

/** How long a shortcut shows it was pressed (ms). */
const RAN_MS = 1200;

/** How long what a shortcut did can be undone from its bar (ms). */
const UNDO_MS = 120_000;

/** What the last shortcut (or the lamps' All off) changed, and how to put it back. */
interface Undo {
  id: string;
  name: string;
  calls: Call[];
  /** Where it was pressed: its bar is shown there. */
  from: "shortcuts" | "lights";
  /** Leaving home (D-091): the actions waiting to bring the heating back, cancelled with it. */
  heating?: string[];
  /** Some of what it did is not undone (a lock, the alarm, a robot, a scene): the bar says so. */
  partly?: boolean;
}

/** What a shortcut's undo leaves as it is (D-084): a door unlocked by mistake is not wanted. */
const NOT_UNDONE: ReadonlySet<string> = new Set(["locks", "alarm", "vacuum", "run"]);

/**
 * A shortcut's glyph: its icon, but the lamps' lit while some are on, for one that switches them
 * off (its button shows them on; a bulb crossed out on a lit button read as a fault).
 */
function glyphOf(shortcut: Shortcut, state: ShownState | undefined): string {
  if (shortcut.icon === "lights_off" && state?.active) return mdiLightbulbOn;
  return SHORTCUT_GLYPHS[shortcut.icon];
}

/** The lights the viewer may switch (their rights, D-071). */
function usableLights(hass: HomeAssistant | undefined, lights: string[]): string[] {
  const canAct = hass?.canAct;
  return canAct ? lights.filter(canAct) : lights;
}

export class DomoTwinHome extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    choices: { attribute: false },
    can3d: { type: Boolean },
    shortcutsReady: { type: Boolean },
    sources: { attribute: false },
    unseen: { attribute: false },
    open: { state: true },
    refused: { state: true },
    editing: { state: true },
    asking: { state: true },
    backChoice: { state: true },
    heatingWaits: { state: true },
    dialog: { state: true },
    dialogReady: { state: true },
    said: { state: true },
    ran: { state: true },
    undo: { state: true },
    closedEnergy: { state: true },
    booking: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  choices?: Choices;
  /** What the glance reads beyond the states (people, energy, rooms, privacy). */
  sources?: GlanceSources;
  /** What the viewer may not see (D-039): their favourites there are not shown either. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The 3D view can be shown: the peak's rooms can be seen there. */
  can3d = false;
  /** The user's choices are read: their shortcuts are shown, and may be changed. */
  shortcutsReady = false;
  /** The chip whose details are open. */
  protected open?: Detail;
  /** What Home Assistant refused last. */
  protected refused?: string;
  /** The shortcuts are being changed: a press opens one rather than running it. */
  protected editing = false;
  /** The shortcut that asks before it acts, asking. */
  protected asking?: string;
  /** Leaving home, as asked: when one is back (D-091). */
  protected backChoice?: BackChoice;
  /** The heating waiting to come back as it was (D-091), the soonest first. */
  protected heatingWaits: Schedule[] = [];
  /** The question closed by another control: the focus stays on it. */
  private keepFocus = false;
  /** The connection the actions waiting are followed on, and how to stop. */
  private schedulesFrom?: unknown;
  private stopSchedules?: () => void;
  /** The shortcuts' dialog, and whether its module is here. */
  protected dialog?: ShortcutDialog;
  protected dialogReady = false;
  /** What a shortcut pressed last said (nothing to act on, refused). */
  protected said?: string;
  /** The shortcut pressed last, shown pressed a moment. */
  protected ran?: string;
  /** What the last shortcut changed, undone from its bar a while. */
  protected undo?: Undo;
  private glance?: Glance;
  private ranTimer: ReturnType<typeof setTimeout> | undefined;
  private undoTimer: ReturnType<typeof setTimeout> | undefined;
  private rawShortcuts?: readonly unknown[];
  private readShortcuts: Shortcut[] = [];
  private suggestedMemo?: { key: unknown[]; value: Suggestion[] };
  private dialogModule?: Promise<unknown>;

  static override styles = [
    baseStyles,
    avatarStyles,
    practicalStyles,
    css`
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button.chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 20px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        font-size: 0.9rem;
        cursor: pointer;
      }
      button.chip[aria-expanded="true"] {
        border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      button.chip.warning {
        background: var(--warning-color, #ffa600);
        border-color: transparent;
        color: #1f2328;
      }
      .detail {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      ul.meetings {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      ul.meetings li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      ul.meetings .what {
        display: grid;
        flex: 1 1 12em;
        min-width: 0;
      }
      .people {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }
      .person {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .peak-rooms {
        display: grid;
        gap: 4px;
        margin: 0;
        padding-inline-start: 20px;
      }
      .presses {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
      }
      .empty {
        display: grid;
        justify-items: start;
        gap: 8px;
        color: var(--secondary-text-color, #5f6368);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .head h2 {
        flex: 1;
        margin: 0;
      }
      button.link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 36px;
        padding: 0 10px;
        border: none;
        border-radius: 18px;
        background: transparent;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        font: inherit;
        font-size: 0.9rem;
        cursor: pointer;
      }
      button.link[aria-pressed="true"] {
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
      button.link:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button.link svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
      .hint {
        margin: 0 0 8px;
      }
      .shortcuts {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      .shortcut {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 64px;
        padding: 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
        transition:
          transform 0.15s ease,
          border-color 0.15s ease;
      }
      button.shortcut:active {
        transform: scale(0.97);
      }
      /* On the border, as the tile's own: not a second frame around it. */
      button.shortcut:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: -1px;
      }
      .shortcut .glyph {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--secondary-text-color, #5f6368) 14%, transparent);
      }
      .shortcut .glyph svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }
      button.shortcut.on .glyph {
        background: var(--domotwin-accent, var(--primary-color, #03a9f4));
        color: #fff;
      }
      button.shortcut.ran {
        border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      .shortcut .words {
        display: grid;
        /* A long word wraps in the tile rather than widening its column. */
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
      }
      /* A word cut only when it cannot fit whole on its line. */
      .shortcut .name {
        font-weight: 600;
        overflow-wrap: break-word;
        hyphens: auto;
      }
      button.shortcut .state {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      button.shortcut .pen {
        position: absolute;
        inset-block-start: 6px;
        inset-inline-end: 6px;
        color: var(--secondary-text-color, #5f6368);
      }
      button.shortcut .pen svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
      button.shortcut.suggested {
        border-style: dashed;
        background: transparent;
      }
      button.shortcut.add {
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      button.shortcut.add .glyph {
        background: transparent;
      }
      /* Asking on its own tile. */
      .shortcut.asking {
        cursor: default;
        border-color: var(--warning-color, #ffa600);
        background: color-mix(
          in srgb,
          var(--warning-color, #ffa600) 14%,
          var(--card-background-color, #fff)
        );
      }
      /* Leaving home: when one is back, across the whole row. */
      .shortcut.asking.back {
        grid-column: 1 / -1;
      }
      .shortcut.asking .back {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
      .shortcut.asking .back .label {
        flex-basis: 100%;
        font-weight: 500;
      }
      .shortcut.asking .back .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .shortcut.asking .back button.chip[aria-pressed="true"] {
        border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 16%,
          var(--card-background-color, #fff)
        );
      }
      .shortcut.asking .back select,
      .shortcut.asking .back input {
        min-height: 40px;
        max-width: 100%;
        font: inherit;
      }
      .shortcut.asking .back .said {
        flex-basis: 100%;
        font-size: 0.85rem;
      }
      .shortcut.asking .answers {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
      }
      .undo {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        padding-block: 6px;
        padding-inline: 12px 6px;
        border-radius: 12px;
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 12%,
          transparent
        );
      }
      .undo span {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .undo button.icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .undo button.icon svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      @media (prefers-reduced-motion: reduce) {
        button.shortcut {
          transition: none;
        }
        button.shortcut:active {
          transform: none;
        }
      }
    `,
  ];

  /** A workplace's meeting rooms now (D-089). */
  private meetings: MeetingRoom[] = [];
  /** The meeting room being booked, while Home Assistant has not answered. */
  protected booking?: string;
  /** The bookings made from here, by room, until their calendars say them (D-089). */
  private held: Record<string, Held> = {};

  /** When the peak's phase changes next (D-063): the glance is worked out again then. */
  private peakTimer: ReturnType<typeof setTimeout> | undefined;
  /** What a workplace used while closed (D-088), read while its hours' details are open. */
  protected closedEnergy?: { hours: string; found: ClosedEnergyNow };

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Undone no more once away: its states would be old by the time it is back.
    this.undo = undefined;
    this.stopSchedules?.();
    this.stopSchedules = undefined;
    this.schedulesFrom = undefined;
    clearTimeout(this.peakTimer);
    clearTimeout(this.ranTimer);
    clearTimeout(this.undoTimer);
  }

  protected override updated(changed: PropertyValues): void {
    // The question takes the focus, and gives it back to its tile once answered.
    if (!changed.has("asking")) return;
    const was = changed.get("asking") as string | undefined;
    if (this.asking) {
      this.renderRoot.querySelector<HTMLElement>("[data-testid='shortcut-yes']")?.focus();
    } else if (this.keepFocus) {
      this.keepFocus = false;
    } else if (was) {
      this.renderRoot
        .querySelector<HTMLElement>(`button[data-shortcut='${CSS.escape(was)}']`)
        ?.focus();
    }
  }

  protected override willUpdate(changed: PropertyValues): void {
    if ((changed.has("hass") || changed.has("sources")) && this.hass && this.sources) {
      this.readGlance(this.hass, this.sources);
      // Asked again as the details stay open (a wall screen's): the client keeps it a while.
      if (this.open === "hours") this.readClosedEnergy();
    }
    if (["hass", "sources", "unseen"].some((key) => changed.has(key))) this.readMeetings();
    if ((changed.has("hass") || changed.has("choices")) && this.hass) this.followHeating(this.hass);
  }

  /**
   * The heating waiting to come back (D-091), followed while a shortcut asks when one is back:
   * shown under the shortcuts, to bring it back now or leave it as it is.
   */
  private followHeating(hass: HomeAssistant): void {
    const wanted = this.shortcuts.some(asksBack);
    const from = wanted ? hass.connection : undefined;
    if (from === this.schedulesFrom) return;
    this.stopSchedules?.();
    this.stopSchedules = undefined;
    this.schedulesFrom = from;
    this.heatingWaits = [];
    if (!wanted) return;
    this.stopSchedules = DomoTwinClient.for(hass).subscribeSchedules((items) => {
      this.heatingWaits = items.filter((item) => item.action === "climate");
    });
  }

  /** A workplace's meeting rooms (D-089), as the viewer may see them. */
  private readMeetings(): void {
    const hass = this.hass;
    const sources = this.sources;
    if (!hass || !sources) return;
    // A booking made from here is said until it ends, or its calendar says it.
    const now = nowOf(hass);
    const held = Object.entries(this.held).filter(([, slot]) => slot.end > now);
    if (held.length !== Object.keys(this.held).length) this.held = Object.fromEntries(held);
    this.meetings = meetingRoomsOf(
      hass,
      sources.rooms,
      sources.bindings ?? NO_BINDINGS,
      sources.workplace?.meeting_rooms,
      this.unseen,
      sources.closed,
      this.held,
    );
    if (this.open === "meetings" && this.meetings.length === 0) this.open = undefined;
  }

  /** The glance now, and again when the peak starts or ends, as nothing else may change then. */
  private readGlance(hass: HomeAssistant, sources: GlanceSources): void {
    clearTimeout(this.peakTimer);
    this.glance = glanceOf(hass, sources);
    // Its chip gone with the peak, its details go too.
    const now = this.glance.peak?.now;
    if (this.open === "peak" && (!now?.peak || now.phase === "none")) this.open = undefined;
    // So with a workplace's hours (D-086), no longer known.
    if (this.open === "hours" && !this.glance.hours) this.open = undefined;
    const next = now?.next;
    if (next === undefined) return;
    // Looked at again in six hours at most, should the clock have been changed meanwhile.
    const wait = Math.min(Math.max(next - nowOf(hass), 0) + 500, 6 * 3_600_000);
    this.peakTimer = setTimeout(() => {
      if (this.hass && this.sources) this.readGlance(this.hass, this.sources);
      this.requestUpdate();
    }, wait);
  }

  private toggleDetail(detail: Detail): void {
    this.open = this.open === detail ? undefined : detail;
    if (this.open === "hours") this.readClosedEnergy();
  }

  /**
   * What the place used while closed (D-088), asked of the integration while the hours' details
   * are open; the client keeps the answer ten minutes, as it is worked out from the recorder.
   * Nothing is said when it cannot be (an integration older than it); what was said stays when
   * Home Assistant could not answer for a while.
   */
  private readClosedEnergy(): void {
    const hass = this.hass;
    const hours = this.sources?.workplace?.hours;
    // A site's own hours (D-090): the integration counts the workplace's.
    if (!hass || !hours || this.sources?.site?.ownHours) return;
    const from = hass.connection;
    const still = (): boolean =>
      this.hass?.connection === from && this.sources?.workplace?.hours === hours;
    DomoTwinClient.for(hass)
      .getClosedEnergy(hours, nowOf(hass))
      .then(
        (found) => {
          if (still() && this.closedEnergy?.found !== found) this.closedEnergy = { hours, found };
        },
        (error: unknown) => {
          if (still() && isHassError(error) && error.code === "unknown_command") {
            this.closedEnergy = undefined;
          }
        },
      );
  }

  private readonly allOff = async (): Promise<void> => {
    const hass = this.hass;
    // Those the viewer may use (their rights, D-071).
    const lights = usableLights(hass, this.glance?.lights ?? []);
    const t = this.t;
    if (!hass || !t || lights.length === 0) return;
    const off: Shortcut = {
      id: "",
      name: t.t("home.all_off"),
      icon: "lights_off",
      steps: [{ kind: "lights", do: "off", entities: lights }],
    };
    const calls = undoCalls(hass, off, this.unseen);
    this.forget();
    try {
      await hass.callService("light", "turn_off", {}, { entity_id: lights });
      this.refused = undefined;
      if (calls.length > 0) this.offerUndo({ id: "", name: off.name, calls, from: "lights" });
    } catch (error) {
      this.refused = failureText(t, error);
    }
  };

  private chip(detail: Detail, glyph: string, label: string, level?: "warning"): TemplateResult {
    return html`<button
      class="chip ${level ?? ""}"
      data-testid="home-${detail}"
      aria-expanded=${this.open === detail ? "true" : "false"}
      @click=${() => {
        this.toggleDetail(detail);
      }}
    >
      ${icon(glyph)}<span>${label}</span>
    </button>`;
  }

  private tiles(ids: string[], starred: boolean): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return html``;
    const favourites = new Set(this.choices?.favourites ?? []);
    return html`<div class="tiles">
      ${ids.map(
        (id) =>
          html`<div class="entity" data-entity=${id}>
            <domotwin-ha-card .hass=${hass} .t=${t} .config=${tileCard(id)}></domotwin-ha-card>
            ${starred ? starButton(this, t, entityName(hass, id), id, favourites.has(id)) : nothing}
          </div>`,
      )}
    </div>`;
  }

  private renderDetail(glance: Glance): TemplateResult | typeof nothing {
    const t = this.t;
    if (!t) return nothing;
    switch (this.open) {
      case "people":
        // A workplace (D-086): counted, named nowhere.
        if (glance.here !== undefined) {
          return html`<div class="detail" data-testid="home-people-detail">
            <span class="muted">${t.t("home.counted")}</span>
          </div>`;
        }
        return html`<div class="detail people" data-testid="home-people-detail">
          ${(glance.people ?? []).map(
            (person) =>
              html`<span class="person"
                >${avatar({ ...person, home: true, self: false })}<span>${person.name}</span></span
              >`,
          )}
          ${
            glance.away > 0
              ? html`<span class="muted">${t.tp("home.away", glance.away)}</span>`
              : nothing
          }
        </div>`;
      case "lights":
        return html`<div class="detail">
          ${
            usableLights(this.hass, glance.lights).length > 0
              ? html`<button class="action" data-testid="home-all-off" @click=${this.allOff}>
                  ${t.t("home.all_off")}
                </button>`
              : nothing
          }
          ${this.undo?.from === "lights" ? this.undoBar(t, this.undo) : nothing}
          ${this.tiles(glance.lights, false)}
        </div>`;
      case "openings":
        return html`<div class="detail">${this.tiles(glance.openings, false)}</div>`;
      case "hours":
        return this.renderHours(glance);
      case "meetings":
        return this.renderMeetings();
      case "peak":
        return this.renderPeak(glance);
      default:
        return nothing;
    }
  }

  /** Hydro-Québec's peak (D-063): when, the rooms that pre-heat, shed or still heat, the 3D. */
  private renderPeak(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const peak = glance.peak;
    if (!hass || !t || !peak) return nothing;
    const names = new Map((this.sources?.rooms ?? []).map((room) => [room.id, room.name]));
    const rooms = [...new Set([...Object.keys(peak.rooms.roles), ...Object.keys(peak.rooms.draws)])]
      .filter((id) => names.has(id))
      .sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    const words = peakWords(t, peak.now, timeStyle(hass), new Date(nowOf(hass)));
    return html`<div class="detail" data-testid="home-peak-detail">
      ${words.map((word) => html`<span>${word}</span>`)}
      ${
        rooms.length > 0
          ? html`<ul class="peak-rooms">
              ${rooms.map((id) => {
                const role = peak.rooms.roles[id];
                const draw = peak.rooms.draws[id];
                const what = [
                  role ? t.t(`home.peak_role_${role}`) : "",
                  draw !== undefined ? formatPower(draw, t.language) : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                return html`<li data-room=${id} data-role=${role ?? nothing}>
                  ${t.t("home.peak_room", { room: names.get(id) ?? id, what })}
                </li>`;
              })}
            </ul>`
          : nothing
      }
      ${
        // An administrator plays the day of a peak to come in the sandbox (D-063).
        hass.user?.is_admin === true && hass.demo !== true && peak.now.phase !== "peak"
          ? html`<button
              class="action"
              data-testid="home-peak-sandbox"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("domotwin-sandbox-peak", { bubbles: true, composed: true }),
                );
              }}
            >
              ${t.t("home.peak_sandbox")}
            </button>`
          : nothing
      }
      ${
        this.can3d
          ? html`<button
              class="action"
              data-testid="home-peak-3d"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("domotwin-go", {
                    detail: { tab: "3d", layer: "peak" },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
            >
              ${t.t("home.peak_see")}
            </button>`
          : nothing
      }
    </div>`;
  }

  /** A workplace's hours (D-086): open until when, or closed and what is left on. */
  private hoursChip(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const hours = glance.hours;
    if (!hass || !t || !hours) return nothing;
    const until = hours.until
      ? whenText(new Date(hours.until), new Date(nowOf(hass)), timeStyle(hass))
      : undefined;
    const left = glance.leftOn?.length ?? 0;
    const label = hours.open
      ? until
        ? t.t("home.open_until", { time: until })
        : t.t("home.open")
      : left > 0
        ? t.tp("home.closed_left_on", left)
        : until
          ? t.t("home.closed_until", { time: until })
          : t.t("home.closed");
    return this.chip("hours", mdiStoreClockOutline, label, left > 0 ? "warning" : undefined);
  }

  /** A workplace's meeting rooms (D-089): how many are free. */
  private meetingsChip(): TemplateResult | typeof nothing {
    const t = this.t;
    const meetings = this.meetings;
    if (!t || meetings.length === 0) return nothing;
    const free = meetings.filter((meeting) => meeting.state === "free").length;
    return this.chip(
      "meetings",
      mdiCalendarAccountOutline,
      t.tp("home.meeting_rooms", meetings.length, { free }),
    );
  }

  /** Each meeting room: free, taken or booked, its next booking, and booked from here. */
  private renderMeetings(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    const style = timeStyle(hass);
    const now = new Date(nowOf(hass));
    const at = (time: number): string => whenText(new Date(time), now, style);
    return html`<div class="detail" data-testid="home-meetings-detail">
      <ul class="meetings">
        ${this.meetings.map((meeting) => {
          const said = [
            meeting.state === "booked" && meeting.allDay
              ? t.t("home.meeting_booked_all_day")
              : meeting.state === "booked" && meeting.until !== undefined
                ? t.t("home.meeting_booked", { time: at(meeting.until) })
                : meeting.state === "taken"
                  ? t.t("home.meeting_taken")
                  : t.t("home.meeting_free"),
            meeting.next === undefined
              ? undefined
              : t.t("home.meeting_next", { time: at(meeting.next) }),
          ].filter((part): part is string => part !== undefined);
          // A booking for each length, the same one once: never over the next booking.
          const slots: { minutes: number; end: number }[] = [];
          for (const minutes of BOOKINGS) {
            const slot = bookingOf(meeting, minutes, nowOf(hass));
            if (slot && !slots.some((each) => each.end === slot.end)) {
              slots.push({ minutes, end: slot.end });
            }
          }
          const whole = (minutes: number, end: number): boolean =>
            end - Math.floor(nowOf(hass) / 60_000) * 60_000 === minutes * 60_000;
          return html`<li data-room=${meeting.room} data-state=${meeting.state}>
            <span class="what">
              <strong id="meeting-${meeting.room}">${meeting.name}</strong>
              <span class="muted">${said.join(" · ")}</span>
            </span>
            ${slots.map(
              ({ minutes, end }) =>
                html`<button
                  class="action"
                  data-testid="home-meeting-book"
                  data-minutes=${minutes}
                  aria-describedby="meeting-${meeting.room}"
                  ?disabled=${this.booking !== undefined}
                  @click=${() => void this.book(meeting, minutes)}
                >
                  ${
                    whole(minutes, end)
                      ? t.t("home.meeting_book", { minutes })
                      : t.t("home.meeting_book_until", { time: at(end) })
                  }
                </button>`,
            )}
          </li>`;
        })}
      </ul>
    </div>`;
  }

  /**
   * Books a meeting room now, for `minutes` (never over its next booking), in its calendar of Home
   * Assistant's, named so that it says nobody's name (D-086).
   */
  private async book(meeting: MeetingRoom, minutes: number): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t || !meeting.calendar || this.booking) return;
    const slot = bookingOf(meeting, minutes, nowOf(hass));
    if (!slot) return;
    // One booking at a time: the calendar says it a moment later.
    this.booking = meeting.room;
    try {
      await hass.callService(
        "calendar",
        "create_event",
        {
          summary: t.t("home.meeting_summary"),
          start_date_time: serviceTime(slot.start),
          end_date_time: serviceTime(slot.end),
        },
        { entity_id: meeting.calendar },
      );
      // Said booked until its calendar says it: one that reads its server now and then.
      this.held = { ...this.held, [meeting.room]: slot };
      this.readMeetings();
      this.refused = undefined;
    } catch (error) {
      this.refused = failureText(t, error);
    } finally {
      this.booking = undefined;
    }
  }

  /** What a closed workplace has left on (D-086), each to turn off; else where its hours are. */
  private renderHours(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const schedule = this.sources?.workplace?.hours;
    if (!hass || !t || !glance.hours) return nothing;
    const left = glance.leftOn ?? [];
    const language = t.language;
    const said =
      this.closedEnergy?.hours === schedule && !this.sources?.site?.ownHours
        ? this.closedEnergy?.found
        : undefined;
    const used = (
      key: "closed_week" | "closed_month",
      value?: ClosedEnergy,
    ): string | undefined => {
      if (!value) return undefined;
      const kwh = formatKwh(value.kwh, language);
      const words = {
        kwh:
          value.share === undefined
            ? kwh
            : t.t("home.closed_share", { kwh, share: formatPercent(value.share, language) }),
      };
      // Counted from later than asked: as far back as Home Assistant's history goes.
      return value.since === undefined
        ? t.t(`home.${key}`, words)
        : t.t("home.closed_since", {
            ...words,
            date: sinceDay(value.since, language, timeStyle(hass).timeZone),
          });
    };
    const energy = [used("closed_week", said?.week), used("closed_month", said?.month)].filter(
      (line): line is string => line !== undefined,
    );
    return html`<div class="detail" data-testid="home-hours-detail">
      ${
        left.length > 0
          ? this.tiles(left, false)
          : html`<span class="muted"
              >${t.t("home.hours_from", { name: schedule ? entityName(hass, schedule) : "" })}</span
            >`
      }
      ${
        energy.length > 0
          ? html`<span class="muted" data-testid="home-hours-energy">${energy.join(" · ")}</span>`
          : nothing
      }
    </div>`;
  }

  /** The peak's chip: under way, pre-heating, or the next one; none while none is announced. */
  private peakChip(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const now = glance.peak?.now;
    const peak = now?.peak;
    if (!hass || !t || !now || !peak || now.phase === "none") return nothing;
    const style = timeStyle(hass);
    const at = new Date(nowOf(hass));
    const label =
      now.phase === "peak"
        ? t.t("peak.now", { end: whenText(new Date(peak.end), at, style) })
        : now.phase === "preheat"
          ? t.t("home.peak_preheat", { start: whenText(new Date(peak.start), at, style) })
          : t.t("home.peak_next", { start: whenText(new Date(peak.start), at, style) });
    return this.chip(
      "peak",
      mdiTransmissionTower,
      label,
      now.phase === "peak" ? "warning" : undefined,
    );
  }

  // The shortcuts (D-084).

  /** The shortcuts the integration keeps for the user, in their order, read once for each list. */
  private get shortcuts(): Shortcut[] {
    const raw = this.choices?.shortcuts ?? [];
    if (raw !== this.rawShortcuts) {
      this.rawShortcuts = raw;
      this.readShortcuts = readShortcuts(raw);
    }
    return this.readShortcuts;
  }

  /** Asks the panel to make a change to the shortcuts (it sends it, the list shown at once). */
  private keep(change: ShortcutChange): void {
    const shortcuts = changeShortcuts(this.shortcuts, change);
    // None left to change: presses act again when the next is added.
    if (shortcuts.length === 0) this.editing = false;
    if (!shortcuts.some((s) => s.id === this.asking)) this.asking = undefined;
    fire(this, "domotwin-shortcuts", { shortcuts, change });
  }

  /** A suggestion added as it is. */
  private addSuggested(suggestion: Suggestion): void {
    const list = this.shortcuts;
    if (list.length >= MAX_SHORTCUTS) return;
    const id = newId(list.map((s) => s.id));
    this.keep({ set: { ...suggestion.shortcut, id } });
  }

  /** A shortcut pressed: asked first if it asks, opened while the shortcuts are changed. */
  private press(shortcut: Shortcut): void {
    if (this.editing) {
      this.openShortcut(shortcut);
      return;
    }
    if (shortcut.steps.length === 0) {
      // One that shows a value: Home Assistant's own details of it.
      if (shortcut.show) fire(this, "hass-more-info", { entityId: shortcut.show });
      return;
    }
    // One that asks first runs only from its question's Yes, and not from a press made twice
    // (a double tap or click, Enter held). Leaving home asks when one is back (D-091), the usual
    // return first.
    if (shortcut.confirm || asksBack(shortcut)) {
      this.backChoice = asksBack(shortcut) ? this.firstBack(shortcut) : undefined;
      this.asking = shortcut.id;
      return;
    }
    void this.runIt(shortcut);
  }

  /** The return first offered: the usual one, a workplace's next opening, or not known. */
  private firstBack(shortcut: Shortcut): BackChoice | undefined {
    const hass = this.hass;
    if (!hass) return undefined;
    const hours = this.glance?.hours;
    const opens = hours && !hours.open && hours.until ? new Date(hours.until) : undefined;
    return firstChoice(shortcut.back, new Date(nowOf(hass)), timeStyle(hass).timeZone, opens);
  }

  /** Yes to the question of a shortcut that asks first. */
  private confirmed(shortcut: Shortcut): void {
    const back = asksBack(shortcut) ? this.backChoice : undefined;
    this.asking = undefined;
    this.backChoice = undefined;
    void this.runIt(shortcut, back);
  }

  /**
   * Brings the heating the shortcut turned down back as it was, a little before one is back
   * (D-091): what waited from an earlier leave is replaced. Says when, or why it could not.
   */
  private async bringHeatingBack(
    hass: HomeAssistant,
    t: Translator,
    shortcut: Shortcut,
    calls: readonly Call[],
    choice: BackChoice,
  ): Promise<Undo["heating"]> {
    const now = new Date(nowOf(hass));
    const back = backAt(choice, now, timeStyle(hass).timeZone);
    if (!back) return undefined;
    const at = heatingAt(shortcut.back, back, now);
    const items = heatingBack(calls, at);
    if (items.length === 0) return undefined;
    const client = DomoTwinClient.for(hass);
    const entities = new Set(items.flatMap((item) => item.entities));
    const ids: string[] = [];
    try {
      for (const old of this.heatingWaits) {
        if (old.entities.some((id) => entities.has(id))) await client.cancelSchedule(old.id);
      }
      for (const item of items) ids.push((await client.addSchedule(item)).schedule.id);
    } catch (error) {
      this.said = t.t("shortcuts.back.failed", { reason: failureText(t, error) });
    }
    return ids.length > 0 ? ids : undefined;
  }

  private async runIt(shortcut: Shortcut, back?: BackChoice): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    this.said = undefined;
    this.ran = shortcut.id;
    this.forget();
    clearTimeout(this.ranTimer);
    this.ranTimer = setTimeout(() => {
      this.ran = undefined;
    }, RAN_MS);
    // What it changes, as it is before: put back from the bar if the press was a mistake.
    const calls = undoCalls(hass, shortcut, this.unseen);
    const ran = await runShortcut(hass, shortcut, this.unseen);
    const [failure] = ran.failures;
    if (failure !== undefined) {
      this.said = t.t("shortcuts.failed", { name: shortcut.name, reason: failureText(t, failure) });
    } else if (ran.done === 0) {
      this.said = t.t("shortcuts.nothing", { name: shortcut.name });
    }
    // The heating back for one's return, even when part of it was refused.
    const heating =
      back && ran.done > 0
        ? await this.bringHeatingBack(hass, t, shortcut, calls, back)
        : undefined;
    if (failure === undefined && ran.done > 0 && calls.length > 0) {
      this.offerUndo({
        id: shortcut.id,
        name: shortcut.name,
        calls,
        from: "shortcuts",
        ...(heating ? { heating } : {}),
        ...(shortcut.steps.some((step) => NOT_UNDONE.has(step.kind)) ? { partly: true } : {}),
      });
    }
  }

  /** What was just changed, offered to be undone a while. */
  private offerUndo(undo: Undo): void {
    this.forget();
    this.undo = undo;
    this.undoTimer = setTimeout(() => {
      this.undo = undefined;
    }, UNDO_MS);
  }

  /** What the last shortcut changed, no longer offered to be undone. */
  private forget(): void {
    clearTimeout(this.undoTimer);
    this.undo = undefined;
  }

  /** What the last shortcut changed, put back as it was. */
  private async undoIt(undo: Undo): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    this.forget();
    if (!hass || !t) return;
    // Back already: the heating no longer waits to come back.
    for (const id of undo.heating ?? []) {
      await DomoTwinClient.for(hass)
        .cancelSchedule(id)
        .catch(() => false);
    }
    const ran = await makeCalls(hass, undo.calls);
    const [failure] = ran.failures;
    if (failure !== undefined) {
      const said = t.t("shortcuts.undo_failed", {
        name: undo.name,
        reason: failureText(t, failure),
      });
      // Said where it was pressed: the lamps' All off by the lamps.
      if (undo.from === "lights") this.refused = said;
      else this.said = said;
    }
  }

  /** The shortcuts' dialog, its module the first time. */
  private openDialog(dialog: ShortcutDialog): void {
    this.dialog = dialog;
    this.dialogModule ??= import("./shortcut-dialog").then(
      () => {
        this.dialogReady = true;
      },
      (error: unknown) => {
        this.dialogModule = undefined;
        this.dialog = undefined;
        if (this.t) this.said = failureText(this.t, error);
      },
    );
  }

  private openShortcut(shortcut: Shortcut): void {
    this.openDialog({ mode: "edit", shortcut });
  }

  private readonly onSave = (event: CustomEvent<{ shortcut: Shortcut }>): void => {
    const { shortcut } = event.detail;
    const list = this.shortcuts;
    if (list.some((s) => s.id === shortcut.id) || list.length < MAX_SHORTCUTS) {
      this.keep({ set: shortcut });
    }
    this.dialog = undefined;
  };

  private readonly onRemove = (event: CustomEvent<{ id: string }>): void => {
    this.keep({ remove: event.detail.id });
    this.dialog = undefined;
  };

  private readonly onMove = (event: CustomEvent<{ id: string; by: -1 | 1 }>): void => {
    this.keep({ move: event.detail.id, by: event.detail.by });
  };

  /** What a shortcut's button says of its state. */
  private stateWords(state: ShownState | undefined): string {
    const t = this.t;
    if (!t || !state) return "";
    if ("count" in state) return t.tp(state.count, state.n);
    if ("key" in state) return t.t(state.key);
    return state.text;
  }

  /**
   * A shortcut that asks first, asking on its own tile: the question, Yes and No where the finger
   * already is.
   */
  private askingTile(shortcut: Shortcut, t: Translator): TemplateResult {
    const back = asksBack(shortcut) ? this.backChoice : undefined;
    const hass = this.hass;
    const now = new Date(hass ? nowOf(hass) : Date.now());
    const style = hass ? timeStyle(hass) : undefined;
    const at = back ? backAt(back, now, style?.timeZone) : undefined;
    // A return said that cannot be: not gone without a word.
    const unsure = back !== undefined && back.when !== "unknown" && at === undefined;
    return html`<div
      class="shortcut asking ${back ? "back" : ""}"
      data-shortcut=${shortcut.id}
      role="alertdialog"
      aria-labelledby="asking-text"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        this.asking = undefined;
      }}
    >
      <span class="words">
        <span class="name" id="asking-text"
          >${t.t("shortcuts.confirm", { name: shortcut.name })}</span
        >
        ${back && style ? this.backFields(shortcut, t, back, at, now, style) : nothing}
        <span class="answers">
          <button
            class="action"
            data-testid="shortcut-yes"
            ?disabled=${unsure}
            @keydown=${(event: KeyboardEvent) => {
              // Enter held on the shortcut is not a Yes.
              if (event.repeat) event.preventDefault();
            }}
            @click=${(event: MouseEvent) => {
              // The second of a double tap or click, landed on Yes, is not one either.
              if (event.detail > 1) return;

              this.confirmed(shortcut);
            }}
          >
            ${t.t("shortcuts.yes")}
          </button>
          <button
            class="link"
            data-testid="shortcut-no"
            @click=${() => {
              this.asking = undefined;
            }}
          >
            ${t.t("shortcuts.no")}
          </button>
        </span>
      </span>
    </div>`;
  }

  /**
   * When one is back, asked on a shortcut leaving home's tile (D-091): not known, in a while, at a
   * time, on a day; and when the heating comes back.
   */
  private backFields(
    shortcut: Shortcut,
    t: Translator,
    choice: BackChoice,
    at: Date | undefined,
    now: Date,
    style: ReturnType<typeof timeStyle>,
  ): TemplateResult {
    const set = (patch: Partial<BackChoice>): void => {
      this.backChoice = { ...choice, ...patch };
    };
    const value = (event: Event): string => (event.target as HTMLInputElement).value;
    const today = todayIn(style.timeZone, now);
    let said: string;
    if (choice.when === "unknown") said = t.t("shortcuts.back.unknown_hint");
    else if (at) {
      const when = whenText(heatingAt(shortcut.back, at, now), now, style);
      said = t.t("schedules.back_at", { when });
    } else said = t.t("shortcuts.back.past");
    return html`<span class="back" role="group" aria-labelledby="back-label">
      <span class="label" id="back-label">${t.t("shortcuts.back.when")}</span>
      <span class="choices">
        ${BACK_WHENS.map(
          (when) =>
            html`<button
              class="chip"
              data-back=${when}
              aria-pressed=${choice.when === when ? "true" : "false"}
              @click=${() => {
                set({ when });
              }}
            >
              ${t.t(`shortcuts.back.${when}`)}
            </button>`,
        )}
      </span>
      ${
        choice.when === "in"
          ? html`<select
              data-testid="back-in"
              aria-label=${t.t("shortcuts.back.in_label")}
              @change=${(event: Event) => {
                set({ minutes: Number(value(event)) });
              }}
            >
              ${BACK_IN.map(
                (minutes) =>
                  html`<option value=${minutes} ?selected=${minutes === choice.minutes}>
                    ${durationText(minutes, style.language)}
                  </option>`,
              )}
            </select>`
          : nothing
      }
      ${
        choice.when === "on"
          ? html`<input
              type="date"
              data-testid="back-date"
              aria-label=${t.t("shortcuts.back.date_label")}
              min=${today}
              .value=${choice.date}
              @change=${(event: Event) => {
                set({ date: value(event) });
              }}
            />`
          : nothing
      }
      ${
        choice.when === "at" || choice.when === "on"
          ? html`<input
              type="time"
              data-testid="back-time"
              aria-label=${t.t("shortcuts.back.time_label")}
              .value=${choice.time}
              @change=${(event: Event) => {
                set({ time: value(event) });
              }}
            />`
          : nothing
      }
      <span class="muted said" data-testid="back-said" role="status">${said}</span>
    </span>`;
  }

  /**
   * The heating waiting to come back as it was (D-091): when, and to bring it back now (back
   * early) or leave it as it is.
   */
  private heatingLine(hass: HomeAssistant, t: Translator): TemplateResult | typeof nothing {
    const canAct = hass.canAct;
    const waits = this.heatingWaits.filter(
      (item) => !canAct || item.entities.every((id) => canAct(id)),
    );
    const first = waits[0];
    if (!first) return nothing;
    const now = new Date(nowOf(hass));
    const when = whenText(new Date(first.at), now, timeStyle(hass));
    const together = waits.filter((item) => item.at === first.at);
    return html`<div class="undo heating" role="status" data-testid="heating-back">
      <span>${t.t("schedules.back_at", { when })}</span>
      <button
        class="action"
        data-testid="heating-now"
        title=${t.t("shortcuts.back.now_title")}
        @click=${() => {
          void this.heatingBackNow(together);
        }}
      >
        ${t.t("shortcuts.back.now")}
      </button>
      <button
        class="link"
        data-testid="heating-keep"
        title=${t.t("shortcuts.back.keep_title")}
        @click=${() => {
          void this.leaveHeating(together);
        }}
      >
        ${t.t("shortcuts.back.keep")}
      </button>
    </div>`;
  }

  /** Back early: the heating as it was now, no longer waiting. */
  private async heatingBackNow(items: readonly Schedule[]): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    const calls = items.map(heatingNow).filter((call): call is Call => call !== undefined);
    await this.leaveHeating(items);
    const ran = await makeCalls(hass, calls);
    const [failure] = ran.failures;
    if (failure !== undefined) {
      this.said = t.t("shortcuts.back.failed", { reason: failureText(t, failure) });
    }
  }

  /** The heating left as it is: what waited to bring it back cancelled. */
  private async leaveHeating(items: readonly Schedule[]): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    if (this.undo?.heating) this.undo = { ...this.undo, heating: undefined };
    try {
      for (const item of items) await DomoTwinClient.for(hass).cancelSchedule(item.id);
    } catch (error) {
      this.said = t.t("shortcuts.back.failed", { reason: failureText(t, error) });
    }
  }

  private shortcutTile(hass: HomeAssistant, shortcut: Shortcut): TemplateResult {
    const t = this.t;
    if (t && this.asking === shortcut.id && !this.editing) return this.askingTile(shortcut, t);
    const state = shownState(hass, shortcut, this.unseen);
    const words = this.stateWords(state);
    const label = this.editing
      ? (t?.t("shortcuts.edit", { name: shortcut.name }) ?? shortcut.name)
      : words
        ? `${shortcut.name}, ${words}`
        : shortcut.name;
    return html`<button
      class="shortcut ${state?.active ? "on" : ""} ${this.ran === shortcut.id ? "ran" : ""}"
      data-shortcut=${shortcut.id}
      aria-label=${label}
      @click=${() => {
        this.press(shortcut);
      }}
      @contextmenu=${(event: Event) => {
        event.preventDefault();
        this.openShortcut(shortcut);
      }}
    >
      <span class="glyph">${icon(glyphOf(shortcut, state))}</span>
      <span class="words">
        <span class="name">${shortcut.name}</span>
        ${words ? html`<span class="state" data-testid="shortcut-state">${words}</span>` : nothing}
      </span>
      ${this.editing ? html`<span class="pen">${icon(PENCIL)}</span>` : nothing}
    </button>`;
  }

  private suggestedTile(suggestion: Suggestion): TemplateResult {
    const t = this.t;
    return html`<button
      class="shortcut suggested"
      data-suggestion=${suggestion.key}
      @click=${() => {
        this.addSuggested(suggestion);
      }}
    >
      <span class="glyph">${icon(mdiPlus)}</span>
      <span class="words">
        <span class="name">${suggestion.shortcut.name}</span>
        <span class="state">${t?.tp("shortcuts.dialog.acts_on", suggestion.count) ?? ""}</span>
      </span>
    </button>`;
  }

  /**
   * The first suggestions, while there are no shortcuts: worked out again only when the registries,
   * the entities, the language or what the viewer may see change, not at every state.
   */
  private firstSuggested(hass: HomeAssistant, t: Translator): Suggestion[] {
    const key = [
      hass.entities,
      hass.areas,
      hass.floors,
      hass.devices,
      hass.canAct,
      this.unseen,
      t.language,
      Object.keys(hass.states).length,
      this.sources?.workplace,
    ];
    const memo = this.suggestedMemo;
    if (memo && memo.key.length === key.length && memo.key.every((k, i) => k === key[i])) {
      return memo.value;
    }
    const value = firstSuggestions(
      suggestions(hass, t, [], this.unseen, this.sources?.workplace !== undefined),
    );
    this.suggestedMemo = { key, value };
    return value;
  }

  /** What was just done, and a button to put it back as it was. */
  private undoBar(t: Translator, undo: Undo): TemplateResult {
    return html`<div class="undo" role="status" data-testid="shortcut-undo">
      <span
        >${t.t("shortcuts.done", { name: undo.name })}${
          undo.partly ? html` <small>${t.t("shortcuts.undo_partly")}</small>` : nothing
        }</span
      >
      <button
        class="action"
        data-testid="shortcut-undo-it"
        @click=${() => {
          void this.undoIt(undo);
        }}
      >
        ${t.t("shortcuts.undo")}
      </button>
      <button
        class="icon"
        aria-label=${t.t("shortcuts.undo_close")}
        title=${t.t("shortcuts.undo_close")}
        @click=${() => {
          this.forget();
        }}
      >
        ${icon(mdiClose)}
      </button>
    </div>`;
  }

  private renderShortcuts(hass: HomeAssistant, t: Translator): TemplateResult {
    const list = this.shortcuts;
    const suggested = list.length === 0 ? this.firstSuggested(hass, t) : [];
    const undo = this.undo;
    const full = list.length >= MAX_SHORTCUTS;
    return html`<section data-testid="home-shortcuts" aria-labelledby="shortcuts-title">
      <div class="head">
        <h2 id="shortcuts-title">${t.t("shortcuts.title")}</h2>
        ${
          list.length > 0
            ? html`<button
                class="link"
                data-testid="shortcuts-change"
                aria-pressed=${this.editing ? "true" : "false"}
                @click=${() => {
                  this.editing = !this.editing;
                  if (this.asking) this.keepFocus = true;
                  this.asking = undefined;
                }}
              >
                ${this.editing ? t.t("shortcuts.finish") : t.t("shortcuts.change")}
              </button>`
            : nothing
        }
      </div>
      ${suggested.length > 0 ? html`<p class="muted hint">${t.t("shortcuts.suggested")}</p>` : nothing}
      <div class="shortcuts">
        ${list.map((shortcut) => this.shortcutTile(hass, shortcut))}
        ${suggested.map((suggestion) => this.suggestedTile(suggestion))}
        ${
          full
            ? nothing
            : html`<button
                class="shortcut suggested add"
                data-testid="shortcuts-add"
                @click=${() => {
                  this.openDialog({ mode: "add" });
                }}
              >
                <span class="glyph">${icon(mdiPlus)}</span>
                <span class="words">
                  <span class="name">
                    ${suggested.length > 0 ? t.t("shortcuts.more") : t.t("shortcuts.add")}
                  </span>
                </span>
              </button>`
        }
      </div>
      ${undo?.from === "shortcuts" ? this.undoBar(t, undo) : nothing} ${this.heatingLine(hass, t)}
      ${this.said ? html`<p class="error" role="alert" data-testid="shortcut-said">${this.said}</p>` : nothing}
    </section>`;
  }

  private renderDialog(): TemplateResult | typeof nothing {
    const dialog = this.dialog;
    if (!dialog || !this.dialogReady) return nothing;
    return html`<domotwin-shortcut-dialog
      .hass=${this.hass}
      .t=${this.t}
      .unseen=${this.unseen}
      .workplace=${this.sources?.workplace !== undefined}
      .shortcuts=${this.shortcuts}
      .mode=${dialog.mode}
      .shortcut=${dialog.mode === "edit" ? dialog.shortcut : undefined}
      @domotwin-shortcut-save=${this.onSave}
      @domotwin-shortcut-remove=${this.onRemove}
      @domotwin-shortcut-move=${this.onMove}
      @domotwin-close=${() => {
        this.dialog = undefined;
      }}
    ></domotwin-shortcut-dialog>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const glance = this.glance;
    if (!hass || !t || !glance) return nothing;
    const favourites = (this.choices?.favourites ?? []).filter(
      (id) => hass.states[id] && seen(this.unseen, id, areaOf(hass, id)),
    );
    const presses = favourites.filter(isPressed);
    const others = favourites.filter((id) => !isPressed(id));
    const cards = this.choices?.cards ?? [];
    const weather = glance.weather;
    const people = glance.people;
    return html`<div class="page" data-testid="home-tab">
      <section aria-label=${t.t("home.glance")}>
        <div class="chips">
          ${
            glance.here !== undefined
              ? this.chip(
                  "people",
                  mdiAccountGroupOutline,
                  glance.here > 0 ? t.tp("home.here", glance.here) : t.t("home.nobody_here"),
                )
              : people
                ? this.chip(
                    "people",
                    mdiAccountGroupOutline,
                    people.length > 0 ? t.tp("home.people", people.length) : t.t("home.nobody"),
                  )
                : nothing
          }
          ${this.hoursChip(glance)} ${this.meetingsChip()}
          ${this.chip(
            "lights",
            mdiLightbulbGroupOutline,
            glance.lights.length > 0
              ? t.tp("home.lights", glance.lights.length)
              : t.t("home.lights_off"),
          )}
          ${this.chip(
            "openings",
            mdiDoorOpen,
            glance.openings.length > 0
              ? t.tp("home.openings", glance.openings.length)
              : t.t("home.all_closed"),
          )}
          ${this.peakChip(glance)}
        </div>
        ${this.renderDetail(glance)}
        ${this.refused ? html`<p class="error" role="alert">${this.refused}</p>` : nothing}
      </section>
      ${this.shortcutsReady ? this.renderShortcuts(hass, t) : nothing}
      ${
        weather
          ? html`<section aria-label=${t.t("home.weather")}>
              <domotwin-ha-card
                data-testid="home-weather"
                .hass=${hass}
                .t=${t}
                .config=${card({
                  type: "weather-forecast",
                  entity: weather.entity,
                  forecast_type: "daily",
                  show_current: true,
                  show_forecast: true,
                })}
              ></domotwin-ha-card>
            </section>`
          : nothing
      }
      ${
        presses.length > 0
          ? html`<section>
              <h2>${t.t("home.scenes")}</h2>
              <div class="presses" data-testid="home-scenes">
                ${presses.map(
                  (id) =>
                    html`<div class="entity" data-entity=${id}>
                      <domotwin-ha-card
                        .hass=${hass}
                        .t=${t}
                        .config=${pressCard(id)}
                      ></domotwin-ha-card>
                    </div>`,
                )}
              </div>
            </section>`
          : nothing
      }
      ${
        others.length > 0
          ? html`<section data-testid="home-favourites">
              <h2>${t.t("home.favourites")}</h2>
              ${this.tiles(others, true)}
            </section>`
          : nothing
      }
      ${
        favourites.length === 0
          ? html`<section class="empty" data-testid="home-empty">
              <span>${icon(mdiStar)} ${t.t("home.empty")}</span>
              <button
                class="action"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent("domotwin-go", {
                      detail: { tab: "rooms" },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                ${t.t("home.open_rooms")}
              </button>
            </section>`
          : nothing
      }
      ${
        cards.length > 0
          ? html`<section data-testid="home-cards">
              <h2>${t.t("home.cards")}</h2>
              <div class="cards">
                ${cards.map(
                  (card) =>
                    html`<domotwin-ha-card
                      .hass=${hass}
                      .t=${t}
                      .config=${cardOf(card)}
                    ></domotwin-ha-card>`,
                )}
              </div>
            </section>`
          : nothing
      }
      ${this.renderDialog()}
    </div>`;
  }
}

define("domotwin-home", DomoTwinHome);
