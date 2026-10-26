/**
 * Automation wires over the home (`DECISIONS.md`, D-032): the automations asked for (those of a
 * piece, or every one of the home) drawn from what sets them off and what they check to what they
 * act on, their ends marked by role, labels floating where an end has no piece; a pulse along an
 * automation's wires when it runs, the pieces it acted on flashing. Loaded the first time wires
 * are shown.
 */
import { mdiClose, mdiHelpRhombusOutline, mdiLightningBolt, mdiTarget } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

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

/** Above this many automations, the wires of every automation are bundled by room. */
export const BUNDLE_ABOVE = 30;
/** How long after a run the pieces it acted on may change and flash (ms). */
const ACTED_WITHIN_MS = 3_000;

/** A spot the engine draws an end at (`setAutomations`). */
interface Spot {
  piece?: string;
  room?: string | null;
  above?: string;
  roles: ("trigger" | "condition" | "action")[];
  automations: number[];
  dynamic: boolean;
}

const ROLE_ICONS = {
  trigger: mdiLightningBolt,
  condition: mdiHelpRhombusOutline,
  action: mdiTarget,
};

/** About how wide a label is drawn (CSS pixels), and how tall; half an end marker's size. */
const labelWidth = (text: string): number => text.length * 7 + 18;
const LABEL_HEIGHT = 22;
const MARKER_HALF = 12;

/**
 * The labels' places, each lifted above what it would cover (labels side by side in the home can
 * line up on screen, or fall on an end's marker): markers (`texts` undefined) stay where they
 * are; from the lowest on screen up, a label overlapping a marker or a label already placed goes
 * just above it.
 */
export function lift(
  points: ([number, number] | null)[],
  texts: readonly (string | undefined)[],
): ([number, number] | null)[] {
  const out = points.map((p) => (p ? ([p[0], p[1]] as [number, number]) : null));
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  out.forEach((p, i) => {
    if (p && texts[i] === undefined) {
      const [x, y] = p;
      const h = MARKER_HALF;
      placed.push({ left: x - h, right: x + h, top: y - h, bottom: y + h });
    }
  });
  const order = out
    .map((p, i) => ({ p, i, text: texts[i] }))
    .filter((e): e is { p: [number, number]; i: number; text: string } => !!e.p && !!e.text)
    .sort((a, b) => b.p[1] - a.p[1]);
  for (const { p, text } of order) {
    const half = labelWidth(text) / 2;
    let moved = true;
    while (moved) {
      moved = false;
      for (const box of placed) {
        const overlaps =
          p[0] - half < box.right &&
          p[0] + half > box.left &&
          p[1] - LABEL_HEIGHT < box.bottom &&
          p[1] > box.top;
        if (overlaps) {
          p[1] = box.top - 2;
          moved = true;
        }
      }
    }
    placed.push({ left: p[0] - half, right: p[0] + half, top: p[1] - LABEL_HEIGHT, bottom: p[1] });
  }
  return out;
}

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
  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
      }
      .end {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
        color: var(--primary-text-color, #1f2328);
      }
      .end svg {
        width: 14px;
        height: 14px;
      }
      .end.dynamic,
      .label.dynamic {
        outline: 2px dashed var(--secondary-text-color, #5f6368);
        outline-offset: 1px;
      }
      .label {
        position: absolute;
        transform: translate(-50%, -100%);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.75rem;
        white-space: nowrap;
        background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
        color: var(--primary-text-color, #1f2328);
      }
      .chip {
        position: absolute;
        left: 12px;
        top: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: calc(100% - 92px);
        padding: 4px 4px 4px 12px;
        border-radius: 18px;
        pointer-events: auto;
        font-size: 0.85rem;
      }
      .chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip .swatch {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .chip button {
        flex: none;
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
    `,
  ];

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
    const points = JSON.parse(text) as ([number, number] | null)[];
    this.points = lift(
      points.map((p) => (p ? [p[0] * scale, p[1] * scale] : null)),
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
    return html`${this.renderEnds()}
      <div class="chip glass" data-testid="wires" role="status">
        ${
          color
            ? html`<span
                class="swatch"
                style="background: rgb(${color.map((c) => Math.round(c * 255)).join(",")})"
              ></span>`
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

  private renderEnds(): TemplateResult {
    const t = this.t;
    return html`${this.spots.map((spot, i) => {
      const p = this.points[i];
      if (!p) return nothing;
      const style = `left:${p[0]}px;top:${p[1]}px`;
      const dynamic = spot.dynamic ? "dynamic" : "";
      const text = this.labelText(spot);
      if (text !== undefined) {
        return html`<span class="label ${dynamic}" style=${style}>${text}</span>`;
      }
      return html`<span
        class="end ${dynamic}"
        style=${style}
        title=${spot.roles.map((r) => t.t(`automations.role.${r}`)).join(" · ")}
        >${spot.roles.map((r) => icon(ROLE_ICONS[r]))}</span
      >`;
    })}`;
  }
}

define("domotwin-wires", DomoTwinWires);
