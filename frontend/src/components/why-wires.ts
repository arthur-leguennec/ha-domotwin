/**
 * "Why?" drawn in the home (`DECISIONS.md`, D-059): the chain of a device's last change as wires
 * of the automations' wire set (D-032), from what started it to the device, each wire going
 * through the automations and scripts that ran between its two ends, in the first one's colour;
 * a pulse runs along them one after the other, from the start to the device. What has no piece
 * floats as a label, as the automations' ends do. Loaded the first time a chain is drawn.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { DomoTwinEngine } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { colorOf, placer, type AutomationEnd, type EndRole } from "../live/automations";
import { entityName, type BindingsJson } from "../live/bindings";
import type { PlanRoom } from "../live/layers";
import { hopsOf, type WhyHop, type WhyStep } from "../live/why";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { renderSpots, spotPoints, spotStyles, swatchColor, type Spot } from "./wire-spots";
import type { ShowWhy } from "./why-section";
import { stepWords } from "./why-text";

/** The colour of a wire that goes through no automation (someone, an action): linear RGB. */
const WHY_COLOR: readonly [number, number, number] = [0.2, 0.8, 0.95];
/** The pulses set off one wire after the other, this far apart (ms). */
const HOP_MS = 1_000;

/** `<domotwin-why>`: a device's chain over the view (the view feeds it taps). */
export class DomoTwinWhy extends LitElement {
  static override properties = {
    hass: { attribute: false },
    engine: { attribute: false },
    bindings: { attribute: false },
    rooms: { attribute: false },
    names: { attribute: false },
    ask: { attribute: false },
    spots: { state: true },
    points: { state: true },
    picked: { state: true },
  };
  static override styles = [baseStyles, spotStyles];

  hass?: HomeAssistant;
  engine?: DomoTwinEngine;
  bindings?: BindingsJson;
  rooms: PlanRoom[] = [];
  names: Record<string, { name: string; type: string }> = {};
  /** The chain to draw, and whose. */
  ask?: ShowWhy;
  protected spots: Spot[] = [];
  protected points: ([number, number] | null)[] = [];
  /** The wire picked out by a tap (`why:<index>`). */
  protected picked?: string;
  private hops: WhyHop[] = [];
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
    const asked = changed.has("ask");
    if (asked) this.picked = undefined;
    if (
      asked ||
      changed.has("engine") ||
      changed.has("bindings") ||
      changed.has("names") ||
      changed.has("rooms")
    ) {
      this.show(asked);
    }
  }

  /** What a step's label says where it has no piece. */
  private label(step: WhyStep): string {
    const hass = this.hass;
    if (!hass) return "";
    const ask = this.ask;
    return stepWords(this.t, hass, step, ask?.users ?? new Map<string, string>(), ask?.unseen).main;
  }

  /** A step as an end of a wire: its entity's piece, else a label; none for what a private room
   * the viewer may not see holds (D-039), nor for a step with no words. */
  private end(step: WhyStep, role: EndRole): AutomationEnd[] {
    if (step.kind === "change" && step.entity) {
      return this.ask?.unseen?.(step.entity) ? [] : [{ role, entity: step.entity }];
    }
    const place = this.label(step);
    if (place === "") return [];
    // Nothing recorded: a dashed label.
    return [step.kind === "lost" ? { role, place, dynamic: "" } : { role, place }];
  }

  /** Places the chain's ends and hands its wires to the engine; `pulse`: sets them off. */
  private show(pulse: boolean): void {
    const hass = this.hass;
    const engine = this.engine;
    const ask = this.ask;
    if (!hass || !engine || !ask) return;
    const place = placer(hass, {
      bindings: this.bindings ?? { version: 1, rooms: {}, elements: {} },
      rooms: this.rooms,
      known: (id: string) => id in this.names,
      label: (end) => end.place ?? "",
    });
    this.hops = hopsOf(ask.chain);
    const automations = this.hops.map((hop, k) => {
      const through = hop.through[0]?.entity;
      return {
        id: `why:${String(k)}`,
        color: through ? colorOf(through) : WHY_COLOR,
        ends: place([...this.end(hop.from, "trigger"), ...this.end(hop.to, "action")]),
      };
    });
    // No wire (nobody's doing, or nothing recorded): the device alone, marked.
    if (automations.length === 0) {
      automations.push({
        id: "why:device",
        color: WHY_COLOR,
        ends: place([{ role: "action", entity: ask.entity }]),
      });
    }
    this.spots = JSON.parse(engine.setAutomations(JSON.stringify({ automations }))) as Spot[];
    if (this.picked) engine.pickAutomation(this.picked);
    if (pulse) {
      const now = performance.now();
      this.hops.forEach((_, k) => {
        engine.pulseAutomation(`why:${String(k)}`, now + k * HOP_MS);
      });
    }
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
    if (text === this.pointsText && scale === this.pointsScale) return;
    this.pointsText = text;
    this.pointsScale = scale;
    this.points = spotPoints(
      text,
      scale,
      this.spots.map((spot) => spot.above),
    );
  }

  /** A tap at a device pixel: picks out the wire there. Whether it did. */
  tap(x: number, y: number): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const hit = engine.automationAt(x, y);
    if (!hit) return false;
    const ids = JSON.parse(hit) as string[];
    // Wires one over the other: each tap picks the next.
    const at = this.picked ? ids.indexOf(this.picked) : -1;
    this.picked = ids[(at + 1) % ids.length];
    engine.pickAutomation(this.picked ?? "");
    fire(this, "domotwin-redraw", undefined);
    return true;
  }

  /** The wire picked out, in words: the runs it goes through, else where it goes from and to. */
  private hopText(hop: WhyHop): string {
    const hass = this.hass;
    if (!hass) return "";
    const runs = hop.through.flatMap((s) => (s.entity ? [entityName(hass, s.entity)] : []));
    if (runs.length > 0) return runs.join(" · ");
    return this.t.t("why.hop", { from: this.label(hop.from), to: this.label(hop.to) });
  }

  protected override render(): TemplateResult {
    const hass = this.hass;
    const t = this.t;
    const ask = this.ask;
    const index = this.picked?.startsWith("why:") ? Number(this.picked.slice(4)) : NaN;
    const hop = Number.isInteger(index) ? this.hops[index] : undefined;
    const through = hop?.through[0]?.entity;
    const color = hop ? (through ? colorOf(through) : WHY_COLOR) : undefined;
    const name = hass && ask ? entityName(hass, ask.entity) : "";
    return html`${renderSpots(t, this.spots, this.points, (spot) => spot.above)}
      <div class="chip glass" data-testid="why-wires" role="status">
        ${
          color
            ? html`<span class="swatch" style="background: ${swatchColor(color)}"></span>`
            : nothing
        }
        <span>${hop ? this.hopText(hop) : t.t("why.chip", { name })}</span>
        <button
          aria-label=${t.t("why.hide")}
          title=${t.t("why.hide")}
          @click=${() => {
            fire(this, "domotwin-why-close", undefined);
          }}
        >
          ${icon(mdiClose)}
        </button>
      </div>`;
  }
}

define("domotwin-why", DomoTwinWhy);
