/**
 * Automation wires over the home (`DECISIONS.md`, D-032): the automations asked for (those of a
 * piece, or every one of the home) drawn from what sets them off and what they check to what they
 * act on, their ends marked by role, labels floating where an end has no piece; a pulse along an
 * automation's wires when it runs, the pieces it acted on flashing. Every one of the home is a
 * list first, by room and in plain words, the wires of the one picked drawn (D-092). Loaded the
 * first time wires are shown.
 */
import {
  mdiClose,
  mdiHelpCircleOutline,
  mdiHelpRhombusOutline,
  mdiLightningBolt,
  mdiPencilOutline,
  mdiTarget,
  mdiVectorPolyline,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { DomoTwinEngine } from "../engine/engine";
import { nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type MessageKey, type Translator } from "../i18n";
import { plainEn, plainFr } from "../i18n/plain";
import { navigate } from "../live/actions";
import {
  actedOn,
  allAutomations,
  colorOf,
  endName,
  groupByArea,
  lastRuns,
  placer,
  ranSince,
  readAutomations,
  summaryOf,
  type AutomationEnd,
  type AutomationGroup,
  type AutomationSummary,
  type ReadAutomation,
} from "../live/automations";
import { entityName, type BindingsJson } from "../live/bindings";
import type { PlanRoom } from "../live/layers";
import { automationWords, type WordsLine } from "../live/plain-words";
import { nameWords, timeAgo } from "../live/text";
import { isRecord } from "../sandbox/config";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { renderSpots, spotPoints, spotStyles, swatchColor, type Spot } from "./wire-spots";

addMessages({ en: plainEn, fr: plainFr });

export { lift } from "./wire-spots";

/** Above this many automations, the wires of every automation are bundled by room. */
export const BUNDLE_ABOVE = 30;
/** How long after a run the pieces it acted on may change and flash (ms). */
const ACTED_WITHIN_MS = 3_000;
/** How long a row of the list says its automation just ran (ms). */
const RAN_MS = 4_000;
/** Above this many automations, the list can be searched. */
const SEARCH_ABOVE = 8;
/** The names said in an automation's line, at most (the others counted). */
const NAMES_SAID = 3;

/** Text kept apart from what is around it, whichever way it is written (an arrow between two
 *  names stays between them in Arabic with Latin names, and the other way round). */
function isolated(text: string): string {
  return `\u2068${text}\u2069`;
}

/** A way of saying a list in `language` ("A, B or C"), made once; none where it cannot be. */
function listFormat(
  language: string,
  type: "conjunction" | "disjunction",
): ((items: string[]) => string) | undefined {
  try {
    const format = new Intl.ListFormat(language, { style: "long", type });
    return (items) => format.format(items);
  } catch {
    return undefined;
  }
}

/** The list of every automation (D-092). */
const listStyles = css`
  :host {
    container-type: size;
  }
  .list {
    /* Beside the view's tools, as the upkeep list and the network map: the layer button in reach. */
    position: absolute;
    inset-inline-end: 68px;
    bottom: 12px;
    width: min(380px, calc(100% - 80px));
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: 16px;
    pointer-events: auto;
    font-size: 0.875rem;
  }
  .list header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-block: 6px 0;
    padding-inline: 14px 6px;
  }
  .list h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .list .count {
    flex: 1;
    color: var(--secondary-text-color, #5f6368);
  }
  .list button.icon {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .list button.icon[aria-pressed="true"] {
    background: color-mix(
      in srgb,
      var(--domotwin-accent, var(--primary-color, #03a9f4)) 18%,
      transparent
    );
    color: var(--domotwin-accent, var(--primary-color, #03a9f4));
  }
  .list button.icon svg {
    width: 20px;
    height: 20px;
  }
  .list .status {
    margin: 0;
    padding: 2px 14px 8px;
    color: var(--secondary-text-color, #5f6368);
  }
  .list .search {
    margin: 0 10px 8px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.18));
    background: var(--card-background-color, #fff);
    color: inherit;
    font: inherit;
  }
  .list .body {
    overflow: auto;
    padding: 0 6px 8px;
  }
  .list h3 {
    margin: 10px 8px 2px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--secondary-text-color, #5f6368);
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button.auto {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 8px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  button.auto:hover,
  button.auto:focus-visible {
    background: color-mix(in srgb, var(--primary-text-color, #000) 6%, transparent);
  }
  button.auto.picked {
    background: color-mix(
      in srgb,
      var(--domotwin-accent, var(--primary-color, #03a9f4)) 14%,
      transparent
    );
  }
  button.auto.ran {
    animation: ran 1.4s ease-out 2;
  }
  @keyframes ran {
    from {
      background: color-mix(
        in srgb,
        var(--domotwin-accent, var(--primary-color, #03a9f4)) 32%,
        transparent
      );
    }
  }
  @media (prefers-reduced-motion: reduce) {
    button.auto.ran {
      animation: none;
      outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
    }
  }
  button.auto .swatch {
    width: 12px;
    height: 12px;
    margin-top: 4px;
    border-radius: 50%;
  }
  button.auto .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  button.auto .name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  button.auto small {
    color: var(--secondary-text-color, #5f6368);
    overflow-wrap: anywhere;
  }
  button.auto.off .name {
    color: var(--secondary-text-color, #5f6368);
  }
  .words {
    margin: 0 8px 8px;
    padding-inline-start: 22px;
  }
  .words h4 {
    margin: 8px 0 2px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--secondary-text-color, #5f6368);
  }
  .words ul {
    margin: 0;
    padding-inline-start: 16px;
    list-style: disc;
  }
  .words li.off {
    text-decoration: line-through;
  }
  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 10px 0 0;
    font-size: 0.78rem;
    color: var(--secondary-text-color, #5f6368);
  }
  .marks svg,
  .edit svg {
    width: 14px;
    height: 14px;
    vertical-align: -2px;
    fill: currentColor;
  }
  .edit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    color: var(--domotwin-accent, var(--primary-color, #03a9f4));
    text-decoration: none;
  }
  .list .back {
    display: none;
  }
  /* On a phone, under the house: it stays in sight above; the one picked shown alone. */
  @container (max-width: 560px) {
    .list {
      inset-inline: 8px 60px;
      width: auto;
      bottom: 8px;
      max-height: 42%;
    }
    .list.focused .body > ul > li:not(.chosen),
    .list.focused .body > h3:not(.chosen),
    .list.focused .search {
      display: none;
    }
    .list.focused .back {
      display: block;
      margin: 0 14px 6px;
      padding: 0;
      border: none;
      background: none;
      color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      font: inherit;
      cursor: pointer;
    }
  }
`;

/** `<domotwin-wires>`: the wires of automations over the view (the view feeds it taps). */
export class DomoTwinWires extends LitElement {
  static override properties = {
    hass: { attribute: false },
    engine: { attribute: false },
    bindings: { attribute: false },
    rooms: { attribute: false },
    names: { attribute: false },
    unseen: { attribute: false },
    unseenAreas: { attribute: false },
    guide: { attribute: false },
    ids: { attribute: false },
    known: { attribute: false },
    spots: { state: true },
    points: { state: true },
    picked: { state: true },
    loading: { state: true },
    unread: { state: true },
    every: { state: true },
    query: { state: true },
  };
  static override styles = [baseStyles, spotStyles, listStyles];

  hass?: HomeAssistant;
  engine?: DomoTwinEngine;
  bindings?: BindingsJson;
  rooms: PlanRoom[] = [];
  names: Record<string, { name: string; type: string }> = {};
  /** What the viewer may not see (D-039, D-071): an automation of the list with an end there is
   *  left out, as are the private rooms' areas. */
  unseen?: (entity: string) => boolean;
  unseenAreas?: ReadonlySet<string>;
  /** The guide to making an automation can be opened (D-093): the panel, which has it. */
  guide = false;
  /** The automations asked for; none: every one of the home. */
  ids?: string[];
  /** What is already read of them (the panel that asked read it): not asked again. */
  known?: ReadonlyMap<string, ReadAutomation>;
  protected spots: Spot[] = [];
  protected points: ([number, number] | null)[] = [];
  /** The automation picked out by a tap on its wire. */
  protected picked?: string;
  protected loading = true;
  /** The configurations came, but the module that reads them could not be loaded. */
  protected unread = false;
  /** The list of every automation draws all their wires at once, not only the one picked. */
  protected every = false;
  /** What the list is searched for. */
  protected query = "";
  /** The automations shown (the list's: those the viewer may see), what each one involves, when
   *  each last ran; those drawn now. */
  private shown: string[] = [];
  private drawn = new Set<string>();
  private reads = new Map<string, ReadAutomation>();
  private runs = new Map<string, string>();
  private asked = "";
  /** What the automations that ran act on, until it changes or a while has passed. */
  private pending: { entity: string; changed: string; until: number }[] = [];
  private scale = 1;
  private pointsText = "";
  private pointsScale = 0;
  /** The automations of the list that ran a moment ago, until when they say so. */
  private recent = new Map<string, number>();
  private recentTimer: ReturnType<typeof setTimeout> | undefined;
  /** Each automation in plain words and its line, worked out once for what they came from. */
  private summaries = new Map<string, AutomationSummary>();
  private lines = new Map<string, string>();
  private summariesFrom: unknown[] = [];
  /** The list's groups, worked out once for the automations, their words and the search. */
  private groups: AutomationGroup[] = [];
  private groupsFrom: unknown[] = [];
  private translator?: { language: unknown; t: Translator };

  private get t(): Translator {
    const language = this.hass?.locale?.language ?? this.hass?.language;
    let made = this.translator;
    if (made?.language !== language || !made) {
      made = { language, t: translatorFor(this.hass) };
      this.translator = made;
    }
    return made.t;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.recentTimer);
    try {
      this.engine?.setAutomations("{}");
    } catch {
      // The view went first and its engine with it: nothing is drawn any more.
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const hass = this.hass;
    if (!hass) return;
    const key = JSON.stringify(this.ids ?? null);
    if (key !== this.asked) {
      this.asked = key;
      void this.load(hass, key);
    } else if (
      changed.has("bindings") ||
      changed.has("names") ||
      changed.has("rooms") ||
      changed.has("unseen") ||
      changed.has("unseenAreas")
    ) {
      this.show();
    }
    if (changed.has("hass")) this.watchRuns(hass, changed.get("hass"));
  }

  /** Reads the automations' configurations, then shows them. */
  private async load(hass: HomeAssistant, key: string): Promise<void> {
    this.loading = true;
    // Other automations: none of them is picked out any more, nor listed while they are read.
    this.picked = undefined;
    this.shown = [];
    const ids = this.ids ?? allAutomations(hass);
    const known = this.known;
    const reads =
      known && ids.every((id) => known.has(id)) ? new Map(known) : await readAutomations(hass, ids);
    if (key !== this.asked || !this.isConnected) return;
    this.unread = reads === undefined;
    this.reads = reads ?? new Map<string, ReadAutomation>();
    this.listed = ids.filter((id) => this.reads.has(id));
    this.runs = lastRuns(hass, this.listed);
    this.loading = false;
    this.show();
  }

  /** Every automation read, before what the viewer may not see is left out. */
  private listed: string[] = [];

  /** Whether an end is somewhere the viewer may not see: an entity, a device or a private room's
   *  area (D-039, D-071). */
  private hiddenEnd(hass: HomeAssistant): (end: AutomationEnd) => boolean {
    const unseen = this.unseen;
    const areas = this.unseenAreas ?? new Set<string>();
    if (!unseen && areas.size === 0) return () => false;
    const devices = new Set<string>();
    for (const entry of Object.values(hass.entities ?? {})) {
      if (entry?.device_id && unseen?.(entry.entity_id)) devices.add(entry.device_id);
    }
    return (end) =>
      (end.entity !== undefined && unseen?.(end.entity) === true) ||
      (end.device !== undefined &&
        (devices.has(end.device) || areas.has(hass.devices?.[end.device]?.area_id ?? ""))) ||
      (end.area !== undefined && areas.has(end.area));
  }

  /** The label of an end with no piece. */
  private label = (end: AutomationEnd): string => {
    const t = this.t;
    if (end.dynamic !== undefined) return t.t("automations.dynamic");
    const place = end.place ?? "";
    const key = `automations.place.${place}` as MessageKey;
    // An action called (`notify.phone`) is named as it is, and so is a kind not translated.
    const text = place.includes(".") ? place : t.t(key);
    return text === key ? place : text;
  };

  /** Places the ends and hands the wires to the engine. */
  private show(): void {
    const hass = this.hass;
    const engine = this.engine;
    if (!hass || !engine) return;
    const placing = {
      bindings: this.bindings ?? { version: 1, rooms: {}, elements: {} },
      rooms: this.rooms,
      known: (id: string) => id in this.names,
      label: this.label,
    };
    const place = placer(hass, placing);
    const listed = this.ids === undefined;
    // The list leaves out what touches a room the viewer may not see; a panel's are its piece's.
    const hidden = listed ? this.hiddenEnd(hass) : () => false;
    this.shown = this.listed.filter((id) => !(this.reads.get(id)?.ends ?? []).some(hidden));
    if (this.picked && !this.shown.includes(this.picked)) this.picked = undefined;
    // The list of every automation draws the one picked, or all of them when asked.
    const drawn =
      listed && !this.every ? this.shown.filter((id) => id === this.picked) : this.shown;
    this.drawn = new Set(drawn);
    const automations = drawn.map((id) => ({
      id,
      color: colorOf(id),
      ends: place(this.reads.get(id)?.ends ?? []),
    }));
    const all = listed && this.every;
    const text = engine.setAutomations(
      JSON.stringify({
        automations,
        grouped: all && automations.length > BUNDLE_ABOVE,
        faded: all,
      }),
    );
    this.spots = JSON.parse(text) as Spot[];
    if (this.picked && this.shown.includes(this.picked)) engine.pickAutomation(this.picked);
    this.pointsText = "";
    this.reproject(this.scale);
    fire(this, "domotwin-redraw", undefined);
  }

  /** Reads where the ends go now (`scale`: CSS pixels per device pixel); the view calls it. */
  reproject(scale: number): void {
    this.scale = scale;
    const engine = this.engine;
    if (!engine) return;
    const text = engine.automationPoints();
    // The same points at another scale (the view's size or the screen's density changed) move too.
    if (text === this.pointsText && scale === this.pointsScale) return;
    this.pointsText = text;
    this.pointsScale = scale;
    this.points = spotPoints(
      text,
      scale,
      this.spots.map((spot) => this.labelText(spot)),
    );
  }

  /** A tap at a device pixel: picks out the automation of the wire there. Whether it did. */
  tap(x: number, y: number): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const hit = engine.automationAt(x, y);
    if (!hit) return false;
    const ids = JSON.parse(hit) as string[];
    // A bundle of several: each tap picks the next.
    const at = this.picked ? ids.indexOf(this.picked) : -1;
    this.picked = ids[(at + 1) % ids.length];
    engine.pickAutomation(this.picked ?? "");
    fire(this, "domotwin-redraw", undefined);
    if (this.ids === undefined) {
      // Picked on the plan: its row shows, whatever was searched.
      this.query = "";
      void this.revealPicked();
    }
    return true;
  }

  /** Picks an automation of the list out, or puts it back (`undefined`): its wires drawn alone.
   *  Put back, its row keeps the focus. */
  private pick(id: string | undefined): void {
    const was = this.picked;
    this.picked = id;
    this.show();
    if (!id) {
      this.engine?.pickAutomation("");
      if (was) void this.focusRow(was);
    }
  }

  private async focusRow(id: string): Promise<void> {
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLElement>(`button.auto[data-automation="${CSS.escape(id)}"]`)
      ?.focus();
  }

  /** The row of the automation picked, brought into the list's view. */
  private async revealPicked(): Promise<void> {
    await this.updateComplete;
    const row = this.renderRoot.querySelector<HTMLElement>("button.auto.picked");
    row?.scrollIntoView({ block: "nearest" });
  }

  /** An automation shown ran: a pulse along its wires, and the pieces it acted on flash. */
  private watchRuns(hass: HomeAssistant, before: HomeAssistant | undefined): void {
    const engine = this.engine;
    if (!engine) return;
    // This device's clock: what the automation acts on changes soon after it is seen to run.
    const now = Date.now();
    let redraw = false;
    for (const id of this.runs.size > 0 ? ranSince(this.runs, hass) : []) {
      if (this.ids === undefined && this.shown.includes(id)) this.ranNow(id);
      // Only what is drawn pulses, and what it acted on flashes.
      if (!this.drawn.has(id)) continue;
      engine.pulseAutomation(id, performance.now());
      redraw = true;
      // What it acts on is watched a while: what changes then flashes, in this update (an
      // action at once) or a later one (after a delay, or the device's answer).
      for (const entity of actedOn(this.reads.get(id)?.ends ?? [])) {
        const changed = before?.states[entity]?.last_changed ?? "";
        this.pending.push({ entity, changed, until: now + ACTED_WITHIN_MS });
      }
    }
    // When each last ran, now: a run seen, or a time gone back (the sandbox's day, D-057). An
    // automation gone a moment (reloaded) keeps the time it had, not to pulse as it comes back.
    for (const [id, was] of this.runs) {
      const at = hass.states[id]?.attributes.last_triggered;
      if (typeof at === "string" && at !== was) this.runs.set(id, at);
      else if (at === null) this.runs.set(id, "");
    }
    const still: typeof this.pending = [];
    for (const wait of this.pending) {
      const state = hass.states[wait.entity];
      if (state && state.last_changed !== wait.changed) {
        for (const [element, binding] of Object.entries(this.bindings?.elements ?? {})) {
          if (binding.entities.some((e) => e.entity_id === wait.entity)) {
            engine.highlight(element);
            redraw = true;
          }
        }
      } else if (now < wait.until) {
        still.push(wait);
      }
    }
    this.pending = still;
    if (redraw) fire(this, "domotwin-redraw", undefined);
  }

  /** A row of the list says its automation ran, a moment. */
  private ranNow(id: string): void {
    this.recent.set(id, Date.now() + RAN_MS);
    clearTimeout(this.recentTimer);
    this.recentTimer = setTimeout(() => {
      const now = Date.now();
      for (const [each, until] of this.recent) if (until <= now) this.recent.delete(each);
      this.requestUpdate();
    }, RAN_MS);
    this.requestUpdate();
  }

  protected override render(): TemplateResult {
    const t = this.t;
    return html`${renderSpots(t, this.spots, this.points, (spot) => this.labelText(spot))}
    ${this.ids === undefined ? this.renderList() : this.renderChip()}`;
  }

  /** The chip that names the wires a panel asked for, and hides them. */
  private renderChip(): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    const picked = this.picked;
    const color = picked ? colorOf(picked) : undefined;
    const title = picked
      ? hass
        ? entityName(hass, picked)
        : picked
      : t.tp("automations.wires", this.shown.length);
    return html`<div class="chip glass" data-testid="wires" role="status">
      ${
        color
          ? html`<span class="swatch" style="background: ${swatchColor(color)}"></span>`
          : nothing
      }
      <span
        >${
          this.loading
            ? t.t("automations.loading")
            : this.unread
              ? t.t("automations.unread")
              : title
        }</span
      >
      <button
        aria-label=${t.t("automations.hide")}
        title=${t.t("automations.hide")}
        @click=${() => {
          fire(this, "domotwin-wires-close", undefined);
        }}
      >
        ${icon(mdiClose)}
      </button>
    </div>`;
  }

  /** What each piece linked to an entity, or standing for a device, is called, for the
   *  automations' words. */
  private pieceNames(hass: HomeAssistant): {
    entities: Map<string, string>;
    devices: Map<string, string>;
  } {
    const entities = new Map<string, string>();
    const devices = new Map<string, string>();
    for (const [element, binding] of Object.entries(this.bindings?.elements ?? {})) {
      const name = this.names[element]?.name;
      if (!name) continue;
      if (binding.device && !devices.has(binding.device)) devices.set(binding.device, name);
      for (const entity of binding.entities) {
        if (!entities.has(entity.entity_id)) entities.set(entity.entity_id, name);
      }
    }
    // A device is its piece's, the one standing for any of its entities.
    for (const entry of Object.values(hass.entities ?? {})) {
      const name = entry ? entities.get(entry.entity_id) : undefined;
      if (entry?.device_id && name && !devices.has(entry.device_id)) {
        devices.set(entry.device_id, name);
      }
    }
    return { entities, devices };
  }

  /** Each automation shown in plain words (what sets it off, what it acts on, its area) and its
   *  line, worked out again only when the registries, the links or the language change. */
  private summariesOf(hass: HomeAssistant, t: Translator): Map<string, AutomationSummary> {
    const from = [
      this.reads,
      this.bindings,
      this.names,
      t.language,
      hass.areas,
      hass.devices,
      hass.entities,
      hass.floors,
    ];
    if (from.every((each, i) => each === this.summariesFrom[i])) return this.summaries;
    const pieces = this.pieceNames(hass);
    const name = (end: AutomationEnd): string =>
      endName(
        hass,
        end,
        this.label,
        (entity) => pieces.entities.get(entity),
        (device) => pieces.devices.get(device),
      );
    this.summaries = new Map(
      [...this.reads].map(([id, read]) => [id, summaryOf(hass, read.ends, name)]),
    );
    const lists = {
      or: listFormat(t.language, "disjunction"),
      and: listFormat(t.language, "conjunction"),
    };
    this.lines = new Map(
      [...this.summaries].map(([id, summary]) => [id, this.lineOf(t, summary, lists)]),
    );
    this.summariesFrom = from;
    return this.summaries;
  }

  /** Names as a list in words: "A, B or 2 more". */
  private namesText(
    t: Translator,
    names: readonly string[],
    list: ((items: string[]) => string) | undefined,
  ): string {
    const said = names.length > NAMES_SAID ? names.slice(0, NAMES_SAID - 1) : [...names];
    if (names.length > NAMES_SAID) said.push(t.tp("automations.more", names.length - said.length));
    if (said.length <= 1) return said[0] ?? "";
    return list ? list(said) : said.join(", ");
  }

  /** An automation's line: what sets it off, then what it acts on, each kept apart from the
   *  arrow whichever way their names are written. */
  private lineOf(
    t: Translator,
    summary: AutomationSummary,
    lists: Record<"or" | "and", ((items: string[]) => string) | undefined>,
  ): string {
    const from = this.namesText(t, summary.when, lists.or);
    const to = this.namesText(t, summary.then, lists.and);
    if (from && to) {
      return t.t("automations.from_to", { from: isolated(from), to: isolated(to) });
    }
    return from || to;
  }

  /** The list's groups: the automations matching the search, by area. */
  private groupsOf(hass: HomeAssistant, t: Translator, query: string): AutomationGroup[] {
    const from = [this.shown, this.summaries, query, t.language, this.picked];
    if (from.every((each, i) => each === this.groupsFrom[i])) return this.groups;
    const picked = this.picked;
    const matching = query
      ? this.shown.filter(
          (id) =>
            id === picked ||
            nameWords(`${entityName(hass, id)} ${this.lines.get(id) ?? ""}`).includes(query),
        )
      : this.shown;
    this.groups = groupByArea(
      hass,
      matching,
      (id) => this.summaries.get(id)?.area,
      t.t("automations.home"),
    );
    this.groupsFrom = from;
    return this.groups;
  }

  /** When an automation last ran, in words. */
  private ago(hass: HomeAssistant, t: Translator, id: string): string {
    const at = hass.states[id]?.attributes.last_triggered;
    const time = typeof at === "string" ? Date.parse(at) : NaN;
    if (!Number.isFinite(time)) return t.t("automations.never");
    return t.t("automations.ran", {
      when: timeAgo(t.language, Math.max(0, (nowOf(hass) - time) / 1000)),
    });
  }

  /** Every automation of the home, by room and in plain words; a tap draws one's wires. */
  private renderList(): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    const picked = this.picked;
    const count = this.shown.length;
    const status = this.loading
      ? t.t("automations.loading")
      : this.unread
        ? t.t("automations.unread")
        : count === 0
          ? t.t("automations.none_home")
          : picked
            ? t.t("automations.picked", { name: hass ? entityName(hass, picked) : picked })
            : this.every
              ? count > BUNDLE_ABOVE
                ? t.t("automations.bundled", { count })
                : t.tp("automations.wires", count)
              : t.t("automations.pick");
    if (hass) this.summariesOf(hass, t);
    const query = nameWords(this.query);
    // Nothing listed while the automations are read: what was there is not theirs.
    const groups = hass && !this.loading ? this.groupsOf(hass, t, query) : [];
    const matching = groups.reduce((total, group) => total + group.ids.length, 0);
    const now = Date.now();
    return html`<section
      class="list glass ${picked ? "focused" : ""}"
      data-testid="automation-list"
      aria-labelledby="automations-title"
    >
      <header>
        <h2 id="automations-title">${t.t("automations.title")}</h2>
        ${count > 0 ? html`<span class="count">${count}</span>` : nothing}
        ${
          count > 1
            ? html`<button
                class="icon"
                data-testid="wires-every"
                aria-pressed=${this.every ? "true" : "false"}
                aria-label=${t.t("automations.every")}
                title=${t.t("automations.every")}
                @click=${() => {
                  this.every = !this.every;
                  this.show();
                }}
              >
                ${icon(mdiVectorPolyline)}
              </button>`
            : nothing
        }
        ${
          this.guide
            ? html`<button
                class="icon"
                data-testid="automation-guide-open"
                aria-label=${t.t("automations.guide")}
                title=${t.t("automations.guide")}
                @click=${() => {
                  fire(this, "domotwin-automation-guide", undefined);
                }}
              >
                ${icon(mdiHelpCircleOutline)}
              </button>`
            : nothing
        }
        <button
          class="icon"
          aria-label=${t.t("automations.close")}
          title=${t.t("automations.close")}
          @click=${() => {
            fire(this, "domotwin-wires-close", undefined);
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="status" data-testid="wires" role="status">${status}</p>
      ${
        picked
          ? html`<button
              class="back"
              @click=${() => {
                this.pick(undefined);
              }}
            >
              ${t.t("automations.all")}
            </button>`
          : nothing
      }
      ${
        count > SEARCH_ABOVE
          ? html`<input
              class="search"
              type="search"
              data-testid="automation-search"
              .value=${this.query}
              placeholder=${t.t("automations.search")}
              aria-label=${t.t("automations.search")}
              @input=${(event: Event) => {
                this.query = (event.target as HTMLInputElement).value;
              }}
            />`
          : nothing
      }
      <div class="body">
        ${
          query && matching === 0
            ? html`<p class="status">${t.t("automations.no_match")}</p>`
            : nothing
        }
        ${groups.map(
          (group) =>
            html`<h3 class=${group.ids.includes(picked ?? "") ? "chosen" : ""}>${group.name}</h3>
              <ul>
                ${group.ids.map((id) => {
                  const name = hass ? entityName(hass, id) : id;
                  const on = hass?.states[id]?.state !== "off";
                  const chosen = id === picked;
                  const ran = (this.recent.get(id) ?? 0) > now;
                  return html`<li class=${chosen ? "chosen" : ""}>
                    <button
                      class="auto ${chosen ? "picked" : ""} ${on ? "" : "off"} ${ran ? "ran" : ""}"
                      data-automation=${id}
                      aria-expanded=${chosen ? "true" : "false"}
                      aria-controls=${chosen ? "automation-words" : nothing}
                      @click=${() => {
                        this.pick(chosen ? undefined : id);
                      }}
                    >
                      <span class="swatch" style="background:${swatchColor(colorOf(id))}"></span>
                      <span class="text">
                        <span class="name">${name}</span>
                        <small class="line">${this.lines.get(id) ?? ""}</small>
                        <small
                          >${on ? nothing : html`${t.t("automations.off")} · `}${
                            ran ? t.t("automations.just_ran") : hass ? this.ago(hass, t, id) : ""
                          }</small
                        >
                      </span>
                    </button>
                    ${chosen && hass ? this.renderWords(hass, id, name) : nothing}
                  </li>`;
                })}
              </ul>`,
        )}
      </div>
    </section>`;
  }

  /** The automation picked, in plain words (D-070), with what its marks on the plan mean. */
  private renderWords(hass: HomeAssistant, id: string, name: string): TemplateResult {
    const t = this.t;
    const config = this.reads.get(id)?.config;
    const words = isRecord(config) ? automationWords(t, hass, config) : undefined;
    const lines = (list: readonly WordsLine[]): TemplateResult =>
      html`<ul>
        ${list.map(
          (line) =>
            html`<li class=${line.off ? "off" : ""}>
              ${line.text}${line.lines ? lines(line.lines) : nothing}
            </li>`,
        )}
      </ul>`;
    const editId = hass.states[id]?.attributes.id;
    const admin = hass.user?.is_admin === true;
    return html`<div class="words" id="automation-words" data-testid="automation-words">
      ${
        words
          ? html`${
              // Each trigger says when on its own ("When…", "At sunset").
              words.when.length > 0 ? lines(words.when) : nothing
            }
            ${
              words.onlyIf.length > 0
                ? html`<h4>${t.t("plain.only_if")}</h4>
                    ${lines(words.onlyIf)}`
                : nothing
            }
            ${
              words.then.length > 0
                ? html`<h4>${t.t("plain.then")}</h4>
                    ${lines(words.then)}`
                : nothing
            }`
          : nothing
      }
      <p class="marks">
        <span>${icon(mdiLightningBolt)} ${t.t("automations.role.trigger")}</span>
        <span>${icon(mdiHelpRhombusOutline)} ${t.t("automations.role.condition")}</span>
        <span>${icon(mdiTarget)} ${t.t("automations.role.action")}</span>
      </p>
      ${
        admin && !hass.demo && typeof editId === "string"
          ? html`<a
              class="edit"
              href=${`/config/automation/edit/${encodeURIComponent(editId)}`}
              @click=${(event: Event) => {
                event.preventDefault();
                navigate(`/config/automation/edit/${encodeURIComponent(editId)}`);
              }}
              >${icon(mdiPencilOutline)}<span>${t.t("automations.edit", { name })}</span></a
            >`
          : nothing
      }
    </div>`;
  }

  /** The text of a spot's label (none: the spot is a piece or a room, marked by its roles). */
  private labelText(spot: Spot): string | undefined {
    if (spot.above === undefined) return undefined;
    // A bundle's end above the home has no label of its own.
    return spot.above === "" ? this.t.t("automations.home") : spot.above;
  }
}

define("domotwin-wires", DomoTwinWires);
