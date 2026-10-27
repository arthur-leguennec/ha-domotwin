/**
 * The shortcuts' dialog (D-084), loaded when first opened: `<domotwin-shortcut-dialog>` suggests
 * shortcuts from the home's devices (added as they are, or adjusted first), and changes one. What
 * it does and where come first; more options (what is left out, more steps, what the button
 * shows, a question first, its place) are a press away.
 */
import { mdiClose, mdiPlus } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { areaOf, entityName } from "../live/bindings";
import { NOTHING_UNSEEN, seen, type Unseen } from "../live/privacy";
import {
  MAX_NAME,
  MAX_STEPS,
  SHORTCUT_ICONS,
  STEP_DOES,
  STEP_KINDS,
  SUGGESTION_GROUPS,
  candidates,
  inPlace,
  newId,
  suggestions,
  takesValue,
  targets,
  type Shortcut,
  type Step,
  type StepKind,
  type Suggestion,
} from "../live/shortcuts";
import { deepActive, focusDialog, fromField } from "./dialog";
import { define, fire } from "./define";
import { icon } from "./icon";
import { SHORTCUT_GLYPHS } from "./shortcut-icons";
import { baseStyles } from "./styles";

/** What the button shows: the state of what it acts on, a device's value, or nothing. */
type Shows = "state" | "value" | "nothing";

function showsOf(shortcut: Shortcut): Shows {
  if (shortcut.show) return "value";
  return shortcut.quiet ? "nothing" : "state";
}

/** Whether a shortcut uses more than what the dialog first shows. */
function advanced(shortcut: Shortcut): boolean {
  return (
    shortcut.steps.length !== 1 ||
    shortcut.confirm === true ||
    shortcut.show !== undefined ||
    shortcut.quiet === true ||
    shortcut.steps.some((step) => (step.except?.length ?? 0) > 0)
  );
}

/** Where a step acts, as its field says it: the home, a floor, a room, or devices chosen. */
function placeOf(step: Step): string {
  if (step.entities) return "chosen";
  if (step.area) return `area:${step.area}`;
  if (step.floor) return `floor:${step.floor}`;
  return "";
}

/** A copy of `value` without `keys`. */
function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const left = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !left.has(key))) as Omit<T, K>;
}

const styles = css`
  :host {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.35);
  }
  .dialog {
    width: min(560px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    box-sizing: border-box;
    padding: 16px;
    display: grid;
    gap: 12px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #1f2328);
    border-radius: 16px;
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
  h3 {
    margin: 4px 0 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--secondary-text-color, #5f6368);
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
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 2px 8px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  li small {
    display: block;
    color: var(--secondary-text-color, #5f6368);
  }
  .glyph svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
  label.field {
    display: grid;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  }
  input[type="text"],
  input[type="number"],
  select {
    min-height: 36px;
    box-sizing: border-box;
    width: 100%;
  }
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .icons button {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .icons button[aria-checked="true"] {
    border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
    background: color-mix(
      in srgb,
      var(--domotwin-accent, var(--primary-color, #03a9f4)) 16%,
      transparent
    );
  }
  .icons svg,
  button.text svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  fieldset {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 10px;
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  legend {
    padding: 0 4px;
    font-weight: 600;
  }
  .pick {
    max-height: 200px;
    overflow: auto;
    display: grid;
    gap: 2px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    cursor: pointer;
  }
  label.check small {
    color: var(--secondary-text-color, #5f6368);
  }
  button.text {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 0 8px;
    border: none;
    border-radius: 18px;
    background: transparent;
    color: var(--domotwin-accent, var(--primary-color, #03a9f4));
    font: inherit;
    cursor: pointer;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .footer .spacer {
    flex: 1;
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
  button.round svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
`;

/** `<domotwin-shortcut-dialog>`: shortcuts suggested from the home, or one being changed. */
export class DomoTwinShortcutDialog extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    unseen: { attribute: false },
    shortcuts: { attribute: false },
    mode: {},
    shortcut: { attribute: false },
    draft: { state: true },
    fresh: { state: true },
    more: { state: true },
    problem: { state: true },
  };

  static override styles = [baseStyles, styles];

  hass?: HomeAssistant;
  t?: Translator;
  unseen: Unseen = NOTHING_UNSEEN;
  /** The user's shortcuts as they are. */
  shortcuts: Shortcut[] = [];
  /** Opened to add one, or to change `shortcut`. */
  mode: "add" | "edit" = "add";
  shortcut?: Shortcut;
  /** The shortcut being made or changed; none while suggestions are shown. */
  protected draft?: Shortcut;
  /** It is not one of the user's yet. */
  protected fresh = false;
  protected more = false;
  protected problem?: string;
  /** The suggestions, worked out once: Home Assistant's states change all the time. */
  private suggested?: Suggestion[];
  private opener: HTMLElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.opener = deepActive();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("mode") || changed.has("shortcut")) {
      if (this.mode === "edit" && this.shortcut) this.begin(structuredClone(this.shortcut), false);
      else this.draft = undefined;
    }
    if (!this.draft && !this.suggested && this.hass && this.t) {
      this.suggested = suggestions(this.hass, this.t, this.shortcuts, this.unseen);
    }
  }

  protected override updated(changed: PropertyValues): void {
    // The focus into the dialog when it opens, and when it goes from suggestions to a shortcut.
    if (!changed.has("draft")) return;
    if (changed.get("draft") === undefined && this.draft !== undefined) void focusDialog(this);
  }

  protected override firstUpdated(): void {
    void focusDialog(this);
  }

  private begin(draft: Shortcut, fresh: boolean): void {
    this.draft = draft;
    this.fresh = fresh;
    this.more = advanced(draft);
    this.problem = undefined;
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || fromField(event)) return;
    event.stopPropagation();
    this.close();
  };

  private ids(): string[] {
    return this.shortcuts.map((s) => s.id);
  }

  private change(patch: Partial<Shortcut>): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, ...patch };
    this.problem = undefined;
  }

  private changeStep(index: number, step: Step): void {
    const steps = [...(this.draft?.steps ?? [])];
    steps[index] = step;
    this.change({ steps });
  }

  /** The entities of a kind the viewer may see and use. */
  private pool(kind: StepKind): string[] {
    const hass = this.hass;
    if (!hass) return [];
    return candidates(hass, kind).filter(
      (id) => seen(this.unseen, id, areaOf(hass, id)) && (!hass.canAct || hass.canAct(id)),
    );
  }

  /** A step of another kind: what it does first, the same place unless it is a chosen list. */
  private kindChanged(step: Step, kind: StepKind): Step {
    const next: Step = { kind, do: STEP_DOES[kind][0] ?? "" };
    if (kind === "run") next.entities = [];
    else if (step.area) next.area = step.area;
    else if (step.floor) next.floor = step.floor;
    return this.withValue(next);
  }

  /** A number for what takes one: a usual temperature, half open; a lamp's brightness may be none. */
  private withValue(step: Step): Step {
    if (!takesValue(step)) {
      return without(step, "value");
    }
    if (step.value !== undefined) return step;
    if (step.kind === "covers") return { ...step, value: 50 };
    if (step.kind === "climate") {
      return { ...step, value: this.hass?.config?.unit_system?.temperature === "°F" ? 66 : 19 };
    }
    return step;
  }

  private placeChanged(step: Step, place: string): Step {
    const rest = without(step, "floor", "area", "entities", "except");
    if (place === "chosen") {
      // Those it acts on now, to start from.
      const hass = this.hass;
      return { ...rest, entities: hass ? targets(hass, step, this.unseen).slice(0, 50) : [] };
    }
    if (place.startsWith("floor:")) return { ...rest, floor: place.slice(6) };
    if (place.startsWith("area:")) return { ...rest, area: place.slice(5) };
    return rest;
  }

  private toggleIn(list: string[] | undefined, id: string, on: boolean): string[] {
    const set = new Set(list ?? []);
    if (on) set.add(id);
    else set.delete(id);
    return [...set];
  }

  private save(): void {
    const t = this.t;
    const draft = this.draft;
    if (!t || !draft) return;
    const name = draft.name.trim();
    if (name === "") {
      this.problem = t.t("shortcuts.dialog.name_needed");
      return;
    }
    const steps = draft.steps.filter(
      (step) => !(step.entities && step.entities.length === 0) && step.do !== "",
    );
    if (steps.length === 0 && !draft.show) {
      this.problem = t.t("shortcuts.dialog.empty");
      return;
    }
    const shortcut: Shortcut = { ...draft, name: name.slice(0, MAX_NAME), steps };
    for (const step of shortcut.steps) {
      if (step.except?.length === 0) delete step.except;
    }
    fire(this, "domotwin-shortcut-save", { shortcut });
  }

  // The suggestions.

  private renderSuggestions(t: Translator): TemplateResult {
    const all = this.suggested ?? [];
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-title"
      data-testid="shortcut-dialog"
      @keydown=${this.onKey}
    >
      <header>
        <h2 id="shortcut-title">${t.t("shortcuts.dialog.add_title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("shortcuts.dialog.cancel")}
          @click=${() => this.close()}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">
        ${all.length > 0 ? t.t("shortcuts.dialog.intro") : t.t("shortcuts.dialog.none")}
      </p>
      ${SUGGESTION_GROUPS.map((group) => {
        const mine = all.filter((s) => s.group === group);
        if (mine.length === 0) return nothing;
        return html`<h3>${t.t(`shortcuts.groups.${group}`)}</h3>
          <ul>
            ${mine.map(
              (suggestion) =>
                html`<li data-suggestion=${suggestion.key}>
                  <span class="glyph">${icon(SHORTCUT_GLYPHS[suggestion.shortcut.icon])}</span>
                  <span>
                    ${suggestion.shortcut.name}
                    <small>${t.tp("shortcuts.dialog.acts_on", suggestion.count)}</small>
                  </span>
                  <button
                    class="text"
                    @click=${() => {
                      this.begin(
                        { ...structuredClone(suggestion.shortcut), id: newId(this.ids()) },
                        true,
                      );
                    }}
                  >
                    ${t.t("shortcuts.dialog.adjust")}
                  </button>
                  <button
                    class="action"
                    data-add
                    @click=${() => {
                      fire(this, "domotwin-shortcut-save", {
                        shortcut: {
                          ...structuredClone(suggestion.shortcut),
                          id: newId(this.ids()),
                        },
                      });
                    }}
                  >
                    ${t.t("shortcuts.dialog.add_it")}
                  </button>
                </li>`,
            )}
          </ul>`;
      })}
      <div class="footer">
        <button
          class="text"
          data-testid="shortcut-own"
          @click=${() => {
            this.begin(
              {
                id: newId(this.ids()),
                name: "",
                icon: "lights_off",
                steps: [{ kind: "lights", do: "off" }],
              },
              true,
            );
          }}
        >
          ${icon(mdiPlus)}<span>${t.t("shortcuts.dialog.own")}</span>
        </button>
        <span class="spacer"></span>
        <button class="action quiet" @click=${() => this.close()}>
          ${t.t("shortcuts.dialog.cancel")}
        </button>
      </div>
    </div>`;
  }

  // A shortcut.

  private renderPlaces(hass: HomeAssistant, t: Translator, step: Step): TemplateResult {
    const pool = this.pool(step.kind);
    const areas = new Set(pool.map((id) => areaOf(hass, id)).filter((a) => a !== undefined));
    const floors = new Set(
      [...areas].map((a) => hass.areas?.[a]?.floor_id).filter((f): f is string => Boolean(f)),
    );
    const name = (value: { name: string } | undefined, id: string): string => value?.name ?? id;
    const byName = (a: [string, string], b: [string, string]): number => a[1].localeCompare(b[1]);
    const floorList = [...floors]
      .map((id): [string, string] => [id, name(hass.floors?.[id], id)])
      .sort(byName);
    const areaList = [...areas]
      .map((id): [string, string] => [id, name(hass.areas?.[id], id)])
      .sort(byName);
    const place = placeOf(step);
    return html`<option value="" ?selected=${place === ""}>
        ${t.t("shortcuts.dialog.whole_home")}
      </option>
      ${
        floorList.length > 1
          ? html`<optgroup label=${t.t("shortcuts.dialog.floors")}>
              ${floorList.map(
                ([id, label]) =>
                  html`<option value=${`floor:${id}`} ?selected=${place === `floor:${id}`}>
                    ${label}
                  </option>`,
              )}
            </optgroup>`
          : nothing
      }
      ${
        areaList.length > 0
          ? html`<optgroup label=${t.t("shortcuts.dialog.rooms")}>
              ${areaList.map(
                ([id, label]) =>
                  html`<option value=${`area:${id}`} ?selected=${place === `area:${id}`}>
                    ${label}
                  </option>`,
              )}
            </optgroup>`
          : nothing
      }
      <option value="chosen" ?selected=${place === "chosen"}>
        ${t.t("shortcuts.dialog.chosen")}
      </option>`;
  }

  /** A list of entities to tick: their name, and their room's. */
  private checklist(
    hass: HomeAssistant,
    ids: string[],
    checked: (id: string) => boolean,
    set: (id: string, on: boolean) => void,
  ): TemplateResult {
    return html`${ids.map((id) => {
      const area = areaOf(hass, id);
      const room = area ? hass.areas?.[area]?.name : undefined;
      return html`<label class="check" data-entity=${id}>
        <input
          type="checkbox"
          .checked=${checked(id)}
          @change=${(event: Event) => {
            set(id, (event.target as HTMLInputElement).checked);
          }}
        />
        <span>${entityName(hass, id)}</span>
        ${room ? html`<small>${room}</small>` : nothing}
      </label>`;
    })}`;
  }

  private renderStep(
    hass: HomeAssistant,
    t: Translator,
    step: Step,
    index: number,
  ): TemplateResult {
    const steps = this.draft?.steps ?? [];
    const chosen = step.entities !== undefined;
    const now = targets(hass, step, this.unseen).length;
    const unit = hass.config?.unit_system?.temperature ?? "°C";
    const valueLabel =
      step.kind === "lights"
        ? t.t("shortcuts.dialog.brightness")
        : step.kind === "covers"
          ? t.t("shortcuts.dialog.position")
          : t.t("shortcuts.dialog.temperature", { unit });
    const percent = step.kind !== "climate";
    // What a step in a place acts on before any is left out: what may be left out.
    const placed = this.pool(step.kind).filter((id) => inPlace(hass, step, id));
    return html`<fieldset class="step" data-step=${index}>
      <legend>${t.t("shortcuts.dialog.step", { n: index + 1 })}</legend>
      <div class="row">
        <label class="field"
          >${t.t("shortcuts.dialog.kind")}
          <select
            data-field="kind"
            @change=${(event: Event) => {
              const kind = (event.target as HTMLSelectElement).value as StepKind;
              this.changeStep(index, this.kindChanged(step, kind));
            }}
          >
            ${STEP_KINDS.map(
              (kind) =>
                html`<option value=${kind} ?selected=${kind === step.kind}>
                  ${t.t(`shortcuts.dialog.kinds.${kind}`)}
                </option>`,
            )}
          </select>
        </label>
        <label class="field"
          >${t.t("shortcuts.dialog.does")}
          <select
            data-field="do"
            @change=${(event: Event) => {
              const does = (event.target as HTMLSelectElement).value;
              this.changeStep(index, this.withValue({ ...step, do: does }));
            }}
          >
            ${STEP_DOES[step.kind].map(
              (does) =>
                html`<option value=${does} ?selected=${does === step.do}>
                  ${t.t(`shortcuts.dialog.do.${step.kind}.${does}` as `shortcuts.dialog.do.lights.off`)}
                </option>`,
            )}
          </select>
        </label>
      </div>
      ${
        takesValue(step)
          ? html`<label class="field"
              >${valueLabel}
              <input
                type="number"
                data-field="value"
                min=${percent ? 0 : -50}
                max=${percent ? 100 : 100}
                step=${percent ? 1 : 0.5}
                .value=${step.value === undefined ? "" : String(step.value)}
                @input=${(event: Event) => {
                  const text = (event.target as HTMLInputElement).value;
                  const value = Number(text);
                  const rest = without(step, "value");
                  this.changeStep(
                    index,
                    text === "" || !Number.isFinite(value) ? rest : { ...rest, value },
                  );
                }}
              />
            </label>`
          : nothing
      }
      ${
        step.kind !== "run"
          ? html`<label class="field"
              >${t.t("shortcuts.dialog.where")}
              <select
                data-field="where"
                @change=${(event: Event) => {
                  this.changeStep(
                    index,
                    this.placeChanged(step, (event.target as HTMLSelectElement).value),
                  );
                }}
              >
                ${this.renderPlaces(hass, t, step)}
              </select>
            </label>`
          : nothing
      }
      ${
        chosen
          ? html`<fieldset class="pick" data-testid="step-which">
              <legend>${t.t("shortcuts.dialog.which")}</legend>
              ${this.checklist(
                hass,
                this.pool(step.kind),
                (id) => step.entities?.includes(id) ?? false,
                (id, on) => {
                  this.changeStep(index, {
                    ...step,
                    entities: this.toggleIn(step.entities, id, on).slice(0, 50),
                  });
                },
              )}
            </fieldset>`
          : nothing
      }
      ${
        this.more && !chosen && placed.length > 1
          ? html`<fieldset class="pick" data-testid="step-except">
              <legend>${t.t("shortcuts.dialog.except")}</legend>
              ${this.checklist(
                hass,
                placed,
                (id) => step.except?.includes(id) ?? false,
                (id, on) => {
                  const except = this.toggleIn(step.except, id, on).slice(0, 50);
                  const rest = without(step, "except");
                  this.changeStep(index, except.length > 0 ? { ...rest, except } : rest);
                },
              )}
            </fieldset>`
          : nothing
      }
      <p class="hint" data-testid="step-now" role="status">
        ${now > 0 ? t.tp("shortcuts.dialog.now", now) : t.t("shortcuts.dialog.now_none")}
      </p>
      ${
        // The last step goes only from a shortcut that shows a value.
        this.more && (steps.length > 1 || this.draft?.show !== undefined)
          ? html`<button
              class="text"
              data-testid="step-remove"
              @click=${() => {
                this.change({ steps: steps.filter((_, i) => i !== index) });
              }}
            >
              ${t.t("shortcuts.dialog.remove_step")}
            </button>`
          : nothing
      }
    </fieldset>`;
  }

  /** What a value may be read from: sensors and binary sensors the viewer may see, by name. */
  private values(hass: HomeAssistant): string[] {
    return Object.keys(hass.states)
      .filter((id) => id.startsWith("sensor.") || id.startsWith("binary_sensor."))
      .filter(
        (id) => hass.entities?.[id]?.hidden !== true && seen(this.unseen, id, areaOf(hass, id)),
      )
      .sort((a, b) => entityName(hass, a).localeCompare(entityName(hass, b)));
  }

  private renderMore(hass: HomeAssistant, t: Translator, draft: Shortcut): TemplateResult {
    const shows = showsOf(draft);
    const at = this.shortcuts.findIndex((s) => s.id === draft.id);
    return html`<div class="more" data-testid="shortcut-more">
      ${
        draft.steps.length > 0 && draft.steps.length < MAX_STEPS
          ? html`<button
              class="text"
              data-testid="step-add"
              @click=${() => {
                this.change({ steps: [...draft.steps, { kind: "lights", do: "off" }] });
              }}
            >
              ${icon(mdiPlus)}<span>${t.t("shortcuts.dialog.add_step")}</span>
            </button>`
          : nothing
      }
      <label class="field"
        >${t.t("shortcuts.dialog.shows")}
        <select
          data-field="shows"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value as Shows;
            const rest = without(draft, "show", "quiet");
            const first = this.values(hass)[0];
            if (value === "value") this.draft = first ? { ...rest, show: first } : rest;
            else this.draft = value === "nothing" ? { ...rest, quiet: true } : rest;
          }}
        >
          <option value="state" ?selected=${shows === "state"}>
            ${t.t("shortcuts.dialog.shows_state")}
          </option>
          <option value="value" ?selected=${shows === "value"}>
            ${t.t("shortcuts.dialog.shows_value")}
          </option>
          <option value="nothing" ?selected=${shows === "nothing"}>
            ${t.t("shortcuts.dialog.shows_nothing")}
          </option>
        </select>
      </label>
      ${
        shows === "value"
          ? html`<label class="field"
              >${t.t("shortcuts.dialog.value")}
              <select
                data-field="show"
                @change=${(event: Event) => {
                  this.change({ show: (event.target as HTMLSelectElement).value });
                }}
              >
                ${this.values(hass).map(
                  (id) =>
                    html`<option value=${id} ?selected=${id === draft.show}>
                      ${entityName(hass, id)}
                    </option>`,
                )}
              </select>
            </label>`
          : nothing
      }
      <label class="check">
        <input
          type="checkbox"
          data-field="confirm"
          .checked=${draft.confirm === true}
          @change=${(event: Event) => {
            const on = (event.target as HTMLInputElement).checked;
            const rest = without(draft, "confirm");
            this.draft = on ? { ...rest, confirm: true } : rest;
          }}
        />
        <span>${t.t("shortcuts.dialog.confirm")}</span>
      </label>
      ${
        !this.fresh && this.shortcuts.length > 1
          ? html`<div class="row">
              <button
                class="action quiet"
                ?disabled=${at <= 0}
                @click=${() => {
                  fire(this, "domotwin-shortcut-move", { id: draft.id, by: -1 });
                }}
              >
                ${t.t("shortcuts.dialog.earlier")}
              </button>
              <button
                class="action quiet"
                ?disabled=${at < 0 || at >= this.shortcuts.length - 1}
                @click=${() => {
                  fire(this, "domotwin-shortcut-move", { id: draft.id, by: 1 });
                }}
              >
                ${t.t("shortcuts.dialog.later")}
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }

  private renderShortcut(hass: HomeAssistant, t: Translator, draft: Shortcut): TemplateResult {
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-title"
      data-testid="shortcut-dialog"
      @keydown=${this.onKey}
    >
      <header>
        <h2 id="shortcut-title">
          ${this.fresh ? t.t("shortcuts.dialog.add_title") : t.t("shortcuts.dialog.edit_title")}
        </h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("shortcuts.dialog.cancel")}
          @click=${() => this.close()}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <label class="field"
        >${t.t("shortcuts.dialog.name")}
        <input
          type="text"
          data-field="name"
          data-autofocus
          maxlength=${MAX_NAME}
          .value=${draft.name}
          @input=${(event: Event) => {
            this.change({ name: (event.target as HTMLInputElement).value });
          }}
        />
      </label>
      <div class="field">
        <span id="shortcut-icon">${t.t("shortcuts.dialog.icon")}</span>
        <div class="icons" role="radiogroup" aria-labelledby="shortcut-icon">
          ${SHORTCUT_ICONS.map(
            (name) =>
              html`<button
                role="radio"
                aria-checked=${draft.icon === name ? "true" : "false"}
                aria-label=${t.t(`shortcuts.dialog.icons.${name}`)}
                title=${t.t(`shortcuts.dialog.icons.${name}`)}
                @click=${() => {
                  this.change({ icon: name });
                }}
              >
                ${icon(SHORTCUT_GLYPHS[name])}
              </button>`,
          )}
        </div>
      </div>
      ${draft.steps.map((step, index) => this.renderStep(hass, t, step, index))}
      ${
        draft.steps.length === 0
          ? html`<button
              class="text"
              data-testid="step-add"
              @click=${() => {
                this.change({ steps: [{ kind: "lights", do: "off" }] });
              }}
            >
              ${icon(mdiPlus)}<span>${t.t("shortcuts.dialog.add_step")}</span>
            </button>`
          : nothing
      }
      <button
        class="text"
        data-testid="shortcut-more-toggle"
        aria-expanded=${this.more ? "true" : "false"}
        @click=${() => {
          this.more = !this.more;
        }}
      >
        ${this.more ? t.t("shortcuts.dialog.fewer") : t.t("shortcuts.dialog.more")}
      </button>
      ${this.more ? this.renderMore(hass, t, draft) : nothing}
      ${this.problem ? html`<p class="error" role="alert">${this.problem}</p>` : nothing}
      <div class="footer">
        ${
          !this.fresh
            ? html`<button
                class="action quiet"
                data-testid="shortcut-remove"
                @click=${() => {
                  fire(this, "domotwin-shortcut-remove", { id: draft.id });
                }}
              >
                ${t.t("shortcuts.dialog.remove")}
              </button>`
            : nothing
        }
        <span class="spacer"></span>
        <button class="action quiet" @click=${() => this.close()}>
          ${t.t("shortcuts.dialog.cancel")}
        </button>
        <button class="action" data-testid="shortcut-save" @click=${() => this.save()}>
          ${t.t("shortcuts.dialog.save")}
        </button>
      </div>
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    return this.draft ? this.renderShortcut(hass, t, this.draft) : this.renderSuggestions(t);
  }
}

define("domotwin-shortcut-dialog", DomoTwinShortcutDialog);
