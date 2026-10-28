/**
 * `<domotwin-home>`, the Home tab (D-055): the home at a glance (who is in, the lamps on, the
 * doors and windows open, Hydro-Québec's next peak, D-063), the user's shortcuts (D-084), the
 * weather, the favourite scenes as big buttons, the other favourites, and the cards the user
 * chose. Every other control is Home Assistant's own card. The alerts are above every tab (D-068).
 */
import {
  mdiAccountGroupOutline,
  mdiDoorOpen,
  mdiLightbulbGroupOutline,
  mdiPlus,
  mdiStar,
  mdiStoreClockOutline,
  mdiTransmissionTower,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { card, pressCard, tileCard, type CardConfig } from "../ha/cards";
import { nowOf, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { failureText } from "../live/actions";
import { areaOf, entityName } from "../live/bindings";
import { isPressed, type Choices, type HomeCard } from "../live/choices";
import { glanceOf, type Glance, type GlanceSources } from "../live/glance";
import { formatPower } from "../live/layers";
import { peakWords } from "../live/peaks";
import { timeStyle, whenText } from "../live/schedules";
import { NOTHING_UNSEEN, seen, type Unseen } from "../live/privacy";
import {
  MAX_SHORTCUTS,
  changeShortcuts,
  firstSuggestions,
  newId,
  readShortcuts,
  runShortcut,
  shownState,
  suggestions,
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
type Detail = "people" | "lights" | "openings" | "hours" | "peak";

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
    dialog: { state: true },
    dialogReady: { state: true },
    said: { state: true },
    ran: { state: true },
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
  /** The shortcuts' dialog, and whether its module is here. */
  protected dialog?: ShortcutDialog;
  protected dialogReady = false;
  /** What a shortcut pressed last said (nothing to act on, refused). */
  protected said?: string;
  /** The shortcut pressed last, shown pressed a moment. */
  protected ran?: string;
  private glance?: Glance;
  private ranTimer: ReturnType<typeof setTimeout> | undefined;
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
      button.shortcut {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 64px;
        padding: 10px 12px;
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
      button.shortcut:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: 2px;
      }
      button.shortcut .glyph {
        flex: none;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--secondary-text-color, #5f6368) 14%, transparent);
      }
      button.shortcut .glyph svg {
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
      button.shortcut .words {
        display: grid;
        min-width: 0;
      }
      button.shortcut .name {
        font-weight: 600;
        overflow-wrap: anywhere;
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
      .asking {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 8px;
        padding: 8px 12px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent);
      }
      .asking span {
        flex: 1;
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

  /** When the peak's phase changes next (D-063): the glance is worked out again then. */
  private peakTimer: ReturnType<typeof setTimeout> | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.peakTimer);
    clearTimeout(this.ranTimer);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if ((changed.has("hass") || changed.has("sources")) && this.hass && this.sources) {
      this.readGlance(this.hass, this.sources);
    }
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
  }

  private readonly allOff = async (): Promise<void> => {
    const hass = this.hass;
    // Those the viewer may use (their rights, D-071).
    const lights = usableLights(hass, this.glance?.lights ?? []);
    if (!hass || !this.t || lights.length === 0) return;
    try {
      await hass.callService("light", "turn_off", {}, { entity_id: lights });
      this.refused = undefined;
    } catch (error) {
      this.refused = failureText(this.t, error);
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
          ${this.tiles(glance.lights, false)}
        </div>`;
      case "openings":
        return html`<div class="detail">${this.tiles(glance.openings, false)}</div>`;
      case "hours":
        return this.renderHours(glance);
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

  /** What a closed workplace has left on (D-086), each to turn off; else where its hours are. */
  private renderHours(glance: Glance): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const schedule = this.sources?.workplace?.hours;
    if (!hass || !t || !glance.hours) return nothing;
    const left = glance.leftOn ?? [];
    return html`<div class="detail" data-testid="home-hours-detail">
      ${
        left.length > 0
          ? this.tiles(left, false)
          : html`<span class="muted"
              >${t.t("home.hours_from", { name: schedule ? entityName(hass, schedule) : "" })}</span
            >`
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
    // One that asks first runs only from its question's Yes: a second press does not answer it.
    if (shortcut.confirm) {
      this.asking = shortcut.id;
      return;
    }
    void this.runIt(shortcut);
  }

  /** Yes to the question of a shortcut that asks first. */
  private confirmed(shortcut: Shortcut): void {
    this.asking = undefined;
    void this.runIt(shortcut);
  }

  private async runIt(shortcut: Shortcut): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    this.said = undefined;
    this.ran = shortcut.id;
    clearTimeout(this.ranTimer);
    this.ranTimer = setTimeout(() => {
      this.ran = undefined;
    }, RAN_MS);
    const ran = await runShortcut(hass, shortcut, this.unseen);
    const [failure] = ran.failures;
    if (failure !== undefined) {
      this.said = t.t("shortcuts.failed", { name: shortcut.name, reason: failureText(t, failure) });
    } else if (ran.done === 0) {
      this.said = t.t("shortcuts.nothing", { name: shortcut.name });
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

  private shortcutTile(hass: HomeAssistant, shortcut: Shortcut): TemplateResult {
    const t = this.t;
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
      <span class="glyph">${icon(SHORTCUT_GLYPHS[shortcut.icon])}</span>
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

  private renderShortcuts(hass: HomeAssistant, t: Translator): TemplateResult {
    const list = this.shortcuts;
    const suggested = list.length === 0 ? this.firstSuggested(hass, t) : [];
    const asking = list.find((s) => s.id === this.asking);
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
      ${
        asking
          ? html`<div class="asking" role="alertdialog" aria-labelledby="asking-text">
              <span id="asking-text">${t.t("shortcuts.confirm", { name: asking.name })}</span>
              <button
                class="action"
                data-testid="shortcut-yes"
                @click=${() => {
                  this.confirmed(asking);
                }}
              >
                ${t.t("shortcuts.yes")}
              </button>
              <button
                class="link"
                @click=${() => {
                  this.asking = undefined;
                }}
              >
                ${t.t("shortcuts.no")}
              </button>
            </div>`
          : nothing
      }
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
          ${this.hoursChip(glance)}
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
