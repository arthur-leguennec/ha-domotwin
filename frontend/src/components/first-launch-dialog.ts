/**
 * The first launch (D-083), loaded when first opened: `<domotwin-first-launch>` draws the home from
 * Home Assistant's floors and areas, the areas to draw picked; `<domotwin-getting-started>` lists
 * the steps that make DomoTwin one's home's, each opening where it is done.
 */
import {
  mdiCheckCircle,
  mdiCheckboxBlankCircleOutline,
  mdiClose,
  mdiCursorDefaultClickOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { summarizePlan } from "../engine/engine";
import type { DomoTwinClient, PlanJson } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { firstEn, firstFr } from "../i18n/first";
import { readBindings, type BindingsJson } from "../live/bindings";
import {
  buildHome,
  devicePieces,
  homeStoreys,
  placeDevices,
  startSteps,
  type HomeStorey,
  type StartStep,
} from "../live/first-launch";
import type { PeopleSettings } from "../live/people";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: firstEn, fr: firstFr });

/** What `<domotwin-first-launch>` asks the panel to draw. */
export interface FirstLaunchChoice {
  storeys: HomeStorey[];
  devices: boolean;
  furnish: boolean;
}

/**
 * Adds links to the home's: read, changed and saved; read again and saved once more when another
 * save came in between (a revision conflict), so links are not lost to a link made meanwhile.
 */
async function addLinks(
  client: DomoTwinClient,
  change: (current: BindingsJson) => BindingsJson,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const stored = await client.getBindings();
    try {
      await client.saveBindings(change(readBindings(stored.bindings)), stored.revision);
      return;
    } catch (error) {
      if (attempt > 0 || !isHassError(error) || error.code !== "revision_conflict") throw error;
    }
  }
}

/**
 * Draws the home from the areas chosen and stores it (D-083): its storeys, checked by the engine
 * first, replace the home's, refused if the home changed since `revision` (it had no plan); then
 * its links are added to the home's, none of its ids one a link already has. What is said once it
 * is done.
 */
export async function storeHome(
  hass: HomeAssistant,
  client: DomoTwinClient,
  choice: FirstLaunchChoice,
  revision: number | undefined,
): Promise<string> {
  const devices = choice.devices
    ? new Map(
        choice.storeys
          .flatMap((storey) => storey.areas)
          .map((area) => [area.id, devicePieces(hass, area.id)]),
      )
    : undefined;
  // A link left from an earlier plan keeps its id: the new pieces take others.
  const before = readBindings((await client.getBindings()).bindings);
  const taken = [...Object.keys(before.elements), ...Object.keys(before.rooms)];
  const built = buildHome({ storeys: choice.storeys, devices, furnish: choice.furnish, taken });
  for (const storey of built.storeys) await summarizePlan(JSON.stringify(storey.plan));
  await client.replaceStoreys(
    built.storeys.map((storey) => ({
      plan: storey.plan,
      name: storey.name.slice(0, 60),
      elevation: storey.elevation,
    })),
    revision,
  );
  await addLinks(client, (current) => ({
    ...current,
    rooms: { ...current.rooms, ...built.bindings.rooms },
    elements: { ...current.elements, ...built.bindings.elements },
  }));
  const t = translatorFor(hass);
  const text = t.t("first.built", {
    rooms: t.tp("first.built_rooms", built.rooms),
    devices: t.tp("first.built_devices", built.devices),
  });
  return built.left > 0 ? `${text} ${t.tp("first.built_left", built.left)}` : text;
}

/**
 * Places the devices of the areas a storey's rooms are linked to (D-083), those not placed yet,
 * each in its room where there is space, around the pieces as the overlay has them: the plan
 * stored (its overlay kept), then their links. What is said once it is done.
 */
export async function storeDevices(
  hass: HomeAssistant,
  client: DomoTwinClient,
  where: {
    plan: PlanJson;
    layout: Record<string, unknown> | undefined;
    revision?: number;
    storey?: string;
    taken: string[];
  },
): Promise<string> {
  const t = translatorFor(hass);
  const bindings = readBindings((await client.getBindings()).bindings);
  const placed = placeDevices(hass, where.plan, bindings, where.taken, where.layout);
  if (placed.devices === 0) {
    return placed.left > 0 ? t.tp("first.built_left", placed.left) : t.t("first.steps.placed_none");
  }
  await summarizePlan(JSON.stringify(placed.plan));
  await client.savePlan(placed.plan, where.revision, undefined, where.storey);
  await addLinks(client, (current) => ({
    ...current,
    elements: { ...current.elements, ...placed.elements },
  }));
  const text = t.tp("first.steps.placed", placed.devices);
  return placed.left > 0 ? `${text} ${t.tp("first.built_left", placed.left)}` : text;
}

/** The steps of getting started on a storey's plan, from what the panel knows of the home. */
export function stepsOf(
  hass: HomeAssistant,
  plan: unknown,
  bindings: BindingsJson,
  people: PeopleSettings | undefined,
  energy: Record<string, unknown> | undefined,
): StartStep[] {
  // Placed by something: a source chosen, or a device followed by Bluetooth.
  const placed = Object.values(people?.people ?? {}).some(
    (person) => person.sources.length > 0 || (person.located?.length ?? 0) > 0,
  );
  const chosen = Object.values(energy ?? {}).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
  return startSteps(hass, plan, bindings, { people: placed, energy: chosen });
}

const styles = css`
  :host {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .dialog {
    pointer-events: auto;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow: auto;
    box-sizing: border-box;
    padding: 16px;
    display: grid;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--secondary-text-color, #5f6368);
    font-size: 0.85rem;
  }
  .error {
    color: var(--error-color, #d23a2f);
  }
  fieldset {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 10px;
    display: grid;
    gap: 4px;
  }
  legend {
    padding: 0 4px;
    font-weight: 600;
  }
  label.choice {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 2px 8px;
    align-items: center;
    cursor: pointer;
    min-height: 32px;
  }
  label.choice small {
    color: var(--secondary-text-color, #5f6368);
  }
  label.option {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    align-items: start;
    cursor: pointer;
  }
  label.option small {
    grid-column: 2;
    color: var(--secondary-text-color, #5f6368);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  button.round {
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
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 2px 10px;
    align-items: center;
    padding: 8px 4px;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  li:last-child {
    border-bottom: none;
  }
  li .mark {
    color: var(--secondary-text-color, #5f6368);
  }
  li[data-done] .mark {
    color: var(--success-color, #43a047);
  }
  li strong {
    font-weight: 600;
  }
  li small {
    display: block;
    color: var(--secondary-text-color, #5f6368);
  }
`;

/** `<domotwin-first-launch>`: the areas of Home Assistant to draw, and how. */
export class DomoTwinFirstLaunch extends LitElement {
  static override properties = {
    hass: { attribute: false },
    busy: { type: Boolean },
    error: {},
    left: { state: true },
    devices: { state: true },
    furnish: { state: true },
  };

  static override styles = [baseStyles, styles];

  hass?: HomeAssistant;
  /** Drawing: the choices are kept as they are. */
  busy = false;
  /** Why the home could not be drawn. */
  error?: string;
  /** The areas left out. */
  protected left = new Set<string>();
  protected devices = true;
  protected furnish = true;
  /** The floors and areas, read once: Home Assistant's states change all the time. */
  private storeys?: HomeStorey[];
  private counts = new Map<string, number>();

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.storeys !== undefined);
  }

  override willUpdate(): void {
    const hass = this.hass;
    if (this.storeys || !hass) return;
    this.storeys = homeStoreys(hass, this.t.t("first.home"));
    for (const area of this.storeys.flatMap((storey) => storey.areas)) {
      this.counts.set(area.id, devicePieces(hass, area.id).length);
    }
  }

  private toggle(ids: string[], on: boolean): void {
    const left = new Set(this.left);
    for (const id of ids) {
      if (on) left.delete(id);
      else left.add(id);
    }
    this.left = left;
  }

  private chosen(): HomeStorey[] {
    return (this.storeys ?? [])
      .map((storey) => ({ ...storey, areas: storey.areas.filter((a) => !this.left.has(a.id)) }))
      .filter((storey) => storey.areas.length > 0);
  }

  private build(): void {
    const storeys = this.chosen();
    if (storeys.length === 0) return;
    const choice: FirstLaunchChoice = { storeys, devices: this.devices, furnish: this.furnish };
    fire(this, "domotwin-build", choice);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const storeys = this.storeys ?? [];
    const chosen = this.chosen();
    const devices = chosen
      .flatMap((storey) => storey.areas)
      .reduce((sum, area) => sum + (this.counts.get(area.id) ?? 0), 0);
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-title"
      data-testid="first-launch"
    >
      <header>
        <h2 id="first-title">${t.t("first.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("first.cancel")}
          ?disabled=${this.busy}
          @click=${() => fire(this, "domotwin-close", undefined)}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("first.intro")}</p>
      ${storeys.length === 0 ? html`<p data-testid="first-none">${t.t("first.none")}</p>` : nothing}
      ${storeys.map((storey) => {
        const ids = storey.areas.map((a) => a.id);
        const all = ids.every((id) => !this.left.has(id));
        return html`<fieldset ?disabled=${this.busy}>
          <legend>
            <label class="choice">
              <input
                type="checkbox"
                .checked=${all}
                .indeterminate=${!all && ids.some((id) => !this.left.has(id))}
                aria-label=${t.t("first.floor_all", { floor: storey.name })}
                @change=${(event: Event) => {
                  this.toggle(ids, (event.target as HTMLInputElement).checked);
                }}
              />
              <span>${storey.name}</span>
            </label>
          </legend>
          ${storey.areas.map((area) => {
            const count = this.counts.get(area.id) ?? 0;
            return html`<label class="choice" data-area=${area.id}>
              <input
                type="checkbox"
                .checked=${!this.left.has(area.id)}
                @change=${(event: Event) => {
                  this.toggle([area.id], (event.target as HTMLInputElement).checked);
                }}
              />
              <span>${area.name}</span>
              <small>${count > 0 ? t.tp("first.devices_in", count) : nothing}</small>
            </label>`;
          })}
        </fieldset>`;
      })}
      ${
        storeys.length > 0
          ? html`<label class="option">
                <input
                  type="checkbox"
                  data-testid="first-devices"
                  .checked=${this.devices}
                  ?disabled=${this.busy}
                  @change=${(event: Event) => {
                    this.devices = (event.target as HTMLInputElement).checked;
                  }}
                />
                <span>${t.t("first.devices")} (${devices})</span>
                <small>${t.t("first.devices_hint")}</small>
              </label>
              <label class="option">
                <input
                  type="checkbox"
                  data-testid="first-furnish"
                  .checked=${this.furnish}
                  ?disabled=${this.busy}
                  @change=${(event: Event) => {
                    this.furnish = (event.target as HTMLInputElement).checked;
                  }}
                />
                <span>${t.t("first.furnish")}</span>
                <small>${t.t("first.furnish_hint")}</small>
              </label>`
          : nothing
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        storeys.length > 0 && chosen.length === 0
          ? html`<p class="hint" role="status">${t.t("first.pick")}</p>`
          : nothing
      }
      <div class="footer">
        <button
          class="action quiet"
          ?disabled=${this.busy}
          @click=${() => fire(this, "domotwin-close", undefined)}
        >
          ${t.t("first.cancel")}
        </button>
        <button
          class="action"
          data-testid="first-build"
          data-autofocus
          ?disabled=${this.busy || chosen.length === 0}
          @click=${() => {
            this.build();
          }}
        >
          ${this.busy ? t.t("first.building") : t.t("first.build")}
        </button>
      </div>
    </div>`;
  }
}

/** Where a step is done: what the panel opens for it. */
const GO: Partial<Record<StartStep["id"], string>> = {
  shape: "first.steps.shape_go",
  areas: "first.steps.areas_go",
  devices: "first.steps.devices_go",
  arrange: "first.steps.arrange_go",
  people: "first.steps.people_go",
  energy: "first.steps.energy_go",
};

/** `<domotwin-getting-started>`: the steps of getting started, each opening where it is done. */
export class DomoTwinGettingStarted extends LitElement {
  static override properties = {
    hass: { attribute: false },
    steps: { attribute: false },
    busy: { type: Boolean },
  };

  static override styles = [baseStyles, styles];

  hass?: HomeAssistant;
  steps: StartStep[] = [];
  busy = false;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override shouldUpdate(changed: PropertyValues<this>): boolean {
    // Home Assistant's states alone change nothing here: the panel gives the steps again.
    return !(changed.size === 1 && changed.has("hass"));
  }

  private hint(step: StartStep): string {
    const t = this.t;
    switch (step.id) {
      case "areas":
        return step.done || !step.left
          ? t.t("first.steps.areas_done")
          : t.tp("first.steps.areas_left", step.left);
      case "devices":
        return step.done || !step.left
          ? t.t("first.steps.devices_done")
          : t.tp("first.steps.devices_left", step.left);
      default:
        return t.t(`first.steps.${step.id}_hint`);
    }
  }

  protected override render(): TemplateResult {
    const t = this.t;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="steps-title"
      data-testid="getting-started"
    >
      <header>
        <h2 id="steps-title">${t.t("first.steps.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("first.steps.close")}
          @click=${() => fire(this, "domotwin-close", undefined)}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("first.steps.intro")}</p>
      <ol>
        ${this.steps.map((step) => {
          const go = GO[step.id];
          const done = step.done === true;
          return html`<li data-step=${step.id} ?data-done=${done}>
            ${
              done
                ? html`<span class="mark" role="img" aria-label=${t.t("first.steps.done")}>
                    ${icon(mdiCheckCircle)}
                  </span>`
                : html`<span class="mark" aria-hidden="true">
                    ${icon(
                      step.done === false
                        ? mdiCheckboxBlankCircleOutline
                        : mdiCursorDefaultClickOutline,
                    )}
                  </span>`
            }
            <span>
              <strong>${t.t(`first.steps.${step.id}`)}</strong>
              <small>${this.hint(step)}</small>
            </span>
            ${
              go && !(done && (step.id === "areas" || step.id === "devices"))
                ? html`<button
                    class=${done ? "action quiet" : "action"}
                    data-go=${step.id}
                    ?disabled=${this.busy}
                    @click=${() => fire(this, "domotwin-step", step.id)}
                  >
                    ${t.t(go as Parameters<Translator["t"]>[0])}
                  </button>`
                : html`<span></span>`
            }
          </li>`;
        })}
      </ol>
    </div>`;
  }
}

define("domotwin-first-launch", DomoTwinFirstLaunch);
define("domotwin-getting-started", DomoTwinGettingStarted);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-first-launch": DomoTwinFirstLaunch;
    "domotwin-getting-started": DomoTwinGettingStarted;
  }
}
