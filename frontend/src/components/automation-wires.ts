/**
 * Automation wires over the home (`DECISIONS.md`, D-032): the automations asked for (those of a
 * piece, or every one of the home) drawn from what sets them off and what they check to what they
 * act on, their ends marked by role, labels floating where an end has no piece; a pulse along an
 * automation's wires when it runs, the pieces it acted on flashing. Loaded the first time wires
 * are shown.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { DomoTwinEngine } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import {
  actedOn,
  allAutomations,
  colorOf,
  lastRuns,
  placer,
  ranSince,
  readAutomations,
  type AutomationEnd,
  type ReadAutomation,
} from "../live/automations";
import { entityName, type BindingsJson } from "../live/bindings";
import type { PlanRoom } from "../live/layers";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { renderSpots, spotPoints, spotStyles, swatchColor, type Spot } from "./wire-spots";

export { lift } from "./wire-spots";

/** Above this many automations, the wires of every automation are bundled by room. */
export const BUNDLE_ABOVE = 30;
/** How long after a run the pieces it acted on may change and flash (ms). */
const ACTED_WITHIN_MS = 3_000;

/** `<domotwin-wires>`: the wires of automations over the view (the view feeds it taps). */
export class DomoTwinWires extends LitElement {
  static override properties = {
    hass: { attribute: false },
    engine: { attribute: false },
    bindings: { attribute: false },
    rooms: { attribute: false },
    names: { attribute: false },
    ids: { attribute: false },
    known: { attribute: false },
    spots: { state: true },
    points: { state: true },
    picked: { state: true },
    loading: { state: true },
    unread: { state: true },
  };
  static override styles = [baseStyles, spotStyles];

  hass?: HomeAssistant;
  engine?: DomoTwinEngine;
  bindings?: BindingsJson;
  rooms: PlanRoom[] = [];
  names: Record<string, { name: string; type: string }> = {};
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
  /** The automations drawn, what each one involves, when each last ran. */
  private shown: string[] = [];
  private reads = new Map<string, ReadAutomation>();
  private runs = new Map<string, string>();
  private asked = "";
  /** What the automations that ran act on, until it changes or a while has passed. */
  private pending: { entity: string; changed: string; until: number }[] = [];
  private scale = 1;
  private pointsText = "";
  private pointsScale = 0;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
    } else if (changed.has("bindings") || changed.has("names") || changed.has("rooms")) {
      this.show();
    }
    if (changed.has("hass")) this.watchRuns(hass, changed.get("hass"));
  }

  /** Reads the automations' configurations, then shows them. */
  private async load(hass: HomeAssistant, key: string): Promise<void> {
    this.loading = true;
    // Other automations: none of them is picked out any more.
    this.picked = undefined;
    const ids = this.ids ?? allAutomations(hass);
    const known = this.known;
    const reads =
      known && ids.every((id) => known.has(id)) ? new Map(known) : await readAutomations(hass, ids);
    if (key !== this.asked || !this.isConnected) return;
    this.unread = reads === undefined;
    this.reads = reads ?? new Map<string, ReadAutomation>();
    this.shown = ids.filter((id) => this.reads.has(id));
    this.runs = lastRuns(hass, this.shown);
    this.loading = false;
    this.show();
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
    const automations = this.shown.map((id) => ({
      id,
      color: colorOf(id),
      ends: place(this.reads.get(id)?.ends ?? []),
    }));
    const every = this.ids === undefined;
    const text = engine.setAutomations(
      JSON.stringify({
        automations,
        grouped: every && automations.length > BUNDLE_ABOVE,
        faded: every,
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
    return true;
  }

  /** An automation shown ran: a pulse along its wires, and the pieces it acted on flash. */
  private watchRuns(hass: HomeAssistant, before: HomeAssistant | undefined): void {
    const engine = this.engine;
    if (!engine) return;
    // This device's clock: what the automation acts on changes soon after it is seen to run.
    const now = Date.now();
    let redraw = false;
    for (const id of this.runs.size > 0 ? ranSince(this.runs, hass) : []) {
      engine.pulseAutomation(id, performance.now());
      redraw = true;
      const at = hass.states[id]?.attributes.last_triggered;
      this.runs.set(id, typeof at === "string" ? at : "");
      // What it acts on is watched a while: what changes then flashes, in this update (an
      // action at once) or a later one (after a delay, or the device's answer).
      for (const entity of actedOn(this.reads.get(id)?.ends ?? [])) {
        const changed = before?.states[entity]?.last_changed ?? "";
        this.pending.push({ entity, changed, until: now + ACTED_WITHIN_MS });
      }
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

  protected override render(): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    const every = this.ids === undefined;
    const picked = this.picked;
    const color = picked ? colorOf(picked) : undefined;
    const title = picked
      ? hass
        ? entityName(hass, picked)
        : picked
      : every && this.shown.length > BUNDLE_ABOVE
        ? t.t("automations.bundled", { count: this.shown.length })
        : t.tp("automations.wires", this.shown.length);
    return html`${renderSpots(t, this.spots, this.points, (spot) => this.labelText(spot))}
      <div class="chip glass" data-testid="wires" role="status">
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

  /** The text of a spot's label (none: the spot is a piece or a room, marked by its roles). */
  private labelText(spot: Spot): string | undefined {
    if (spot.above === undefined) return undefined;
    // A bundle's end above the home has no label of its own.
    return spot.above === "" ? this.t.t("automations.home") : spot.above;
  }
}

define("domotwin-wires", DomoTwinWires);
