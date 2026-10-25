/**
 * A piece's upkeep card (`DECISIONS.md`, D-033), in its sheet: make, model, serial number,
 * install date, warranty, service life, a manual, notes, and recurring tasks, each with when it
 * is next due and a **Done** button for everyone. Administrators write and change the card.
 * Loaded with the sheets.
 */
import {
  mdiCheck,
  mdiDeleteOutline,
  mdiFileDocumentOutline,
  mdiPencilOutline,
  mdiPlus,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import {
  newTaskId,
  type CardStanding,
  type TaskStanding,
  type Upkeep,
  type UpkeepCard,
  type UpkeepTask,
  type UpkeepUnit,
} from "../live/upkeep";
import { define } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { dueText, everyText, shownDate, upkeepCall } from "./upkeep-text";

/** Longest texts and intervals, as the integration allows. */
const MAX_TEXT = 100;
const MAX_LINK = 500;
const MAX_NOTES = 2000;
const MAX_TASKS = 20;
const LONGEST: Record<UpkeepUnit, number> = { days: 3650, months: 120 };
/** A manual: a path of Home Assistant, or a web address. */
const MANUAL_LINK = /^(\/|https?:\/\/)\S*$/i;

/** A card as it is stored: empty texts left out, tasks named. */
function cleaned(card: UpkeepCard): UpkeepCard {
  const out: UpkeepCard = {};
  for (const key of ["make", "model", "serial", "manual", "notes"] as const) {
    const value = card[key]?.trim();
    if (value) out[key] = key === "notes" ? (card.notes ?? "") : value;
  }
  if (card.installed) out.installed = card.installed;
  if (card.warranty_end) out.warranty_end = card.warranty_end;
  if (card.service_life) out.service_life = card.service_life;
  out.tasks = (card.tasks ?? []).map((task) => {
    const kept: UpkeepTask = {
      id: task.id,
      name: task.name.trim(),
      every: task.every,
      unit: task.unit,
    };
    if (task.last_done) kept.last_done = task.last_done;
    return kept;
  });
  return out;
}

/** `<domotwin-upkeep-card>`: the upkeep card of one piece. */
export class DomoTwinUpkeepCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    piece: { attribute: false },
    upkeep: { attribute: false },
    standing: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h3 {
        margin: 12px 0 4px;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #5f6368);
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 12px;
        margin: 4px 0;
      }
      dt {
        color: var(--secondary-text-color, #5f6368);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .notes {
        white-space: pre-wrap;
      }
      .soon {
        color: var(--warning-color, #b26a00);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li.task {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 48px;
      }
      .task .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .task small {
        color: var(--secondary-text-color, #5f6368);
      }
      .chip {
        display: inline-block;
        margin-right: 4px;
        padding: 0 6px;
        border-radius: 8px;
        font-size: 0.72rem;
        color: #fff;
      }
      .chip.fine {
        background: #2e9e57;
      }
      .chip.due {
        background: #c27c00;
      }
      .chip.overdue {
        background: #d23a2f;
      }
      p.empty,
      p.hint {
        color: var(--secondary-text-color, #5f6368);
        margin: 6px 0;
      }
      p.error {
        color: var(--error-color, #d23a2f);
        margin: 6px 0;
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 4px;
      }
      form label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 6px 0;
        font-size: 0.85rem;
      }
      form input,
      form textarea,
      form select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
        min-width: 0;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      fieldset {
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        margin: 6px 0;
        padding: 4px 8px 8px;
      }
      fieldset .row {
        display: grid;
        grid-template-columns: 1fr 5rem 6.5rem auto;
        gap: 6px;
        align-items: end;
      }
      button.round {
        width: 40px;
        height: 40px;
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
  /** The piece (its id), the home's cards, and where its card stands today. */
  piece = "";
  upkeep?: Upkeep;
  standing?: CardStanding;
  /** The card being written (administrators), or none, and the card as it was when it began. */
  protected draft?: UpkeepCard;
  private base?: UpkeepCard;
  protected busy = false;
  protected error?: string;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  private get card(): UpkeepCard | undefined {
    return this.upkeep?.pieces[this.piece];
  }

  private get admin(): boolean {
    return this.hass?.user?.is_admin === true;
  }

  private async run(work: (client: DomoTwinClient) => Promise<unknown>): Promise<boolean> {
    const hass = this.hass;
    if (!hass) return false;
    this.busy = true;
    this.error = await upkeepCall(hass, this.t, work);
    this.busy = false;
    return this.error === undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Another piece in the same sheet: what was being written was this one's.
    if (changed.has("piece") && changed.get("piece") !== undefined) {
      this.draft = undefined;
      this.base = undefined;
      this.error = undefined;
    }
  }

  /** Starts writing the card (a copy of it, or a new one). */
  private edit(card: UpkeepCard): void {
    this.base = structuredClone(card);
    this.draft = structuredClone(card);
    this.error = undefined;
  }

  private async save(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    const card = cleaned(draft);
    // A task marked done meanwhile (by anyone) stays done, unless its date was changed here.
    const now = this.card?.tasks ?? [];
    const before = this.base?.tasks ?? [];
    for (const task of card.tasks ?? []) {
      const was = before.find((t) => t.id === task.id);
      const is = now.find((t) => t.id === task.id);
      if (was && is && task.last_done === was.last_done && is.last_done !== was.last_done) {
        if (is.last_done) task.last_done = is.last_done;
        else delete task.last_done;
      }
    }
    if (card.manual && !MANUAL_LINK.test(card.manual)) {
      this.error = this.t.t("upkeep.invalid_link");
      return;
    }
    if (await this.run((client) => client.saveUpkeep({ [this.piece]: card }))) {
      this.draft = undefined;
      this.base = undefined;
    }
  }

  private async removeCard(): Promise<void> {
    if (await this.run((client) => client.saveUpkeep({ [this.piece]: null }))) {
      this.draft = undefined;
    }
  }

  private done(task: UpkeepTask): void {
    void this.run((client) => client.upkeepDone(this.piece, task.id));
  }

  /** Changes the draft (a copy each time, for Lit to see it). */
  private change(change: Partial<UpkeepCard>): void {
    this.draft = { ...this.draft, ...change };
  }

  private changeTask(index: number, change: Partial<UpkeepTask>): void {
    const tasks = [...(this.draft?.tasks ?? [])];
    const task = tasks[index];
    if (!task) return;
    tasks[index] = { ...task, ...change };
    this.change({ tasks });
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const t = this.t;
    return html`<section data-testid="upkeep">
      <h3>${t.t("upkeep.title")}</h3>
      ${this.draft ? this.renderForm(this.draft) : this.renderCard()}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
    </section>`;
  }

  private renderCard(): TemplateResult {
    const t = this.t;
    const card = this.card;
    const language = t.language;
    if (!card) {
      return html`<p class="empty">${t.t("upkeep.none")}</p>
        ${
          this.admin
            ? html`<div class="footer">
                <button
                  class="action quiet"
                  data-testid="upkeep-add"
                  @click=${() => {
                    this.edit({ tasks: [] });
                  }}
                >
                  ${icon(mdiPlus)}${t.t("upkeep.add")}
                </button>
              </div>`
            : nothing
        }`;
    }
    const standing = this.standing;
    const facts: [string, TemplateResult | string][] = [];
    if (card.make) facts.push([t.t("upkeep.make"), card.make]);
    if (card.model) facts.push([t.t("upkeep.model"), card.model]);
    if (card.serial) facts.push([t.t("upkeep.serial"), card.serial]);
    if (card.installed) facts.push([t.t("upkeep.installed"), shownDate(language, card.installed)]);
    if (card.warranty_end) {
      const left = standing?.warranty;
      facts.push([
        t.t("upkeep.warranty_end"),
        html`${shownDate(language, card.warranty_end)}${
          left !== null && left !== undefined
            ? html` <span class="soon"
                >(${left === 0 ? t.t("upkeep.warranty_today") : t.tp("upkeep.warranty_in", left)})</span
              >`
            : nothing
        }`,
      ]);
    }
    if (card.service_life) {
      facts.push([t.t("upkeep.service_life"), t.tp("upkeep.years", card.service_life)]);
    }
    // Only a path or a web address is a link (the integration refuses anything else).
    if (card.manual && MANUAL_LINK.test(card.manual)) {
      facts.push([
        t.t("upkeep.manual"),
        html`<a href=${card.manual} target="_blank" rel="noopener noreferrer"
          >${icon(mdiFileDocumentOutline)} ${t.t("upkeep.open_manual")}</a
        >`,
      ]);
    }
    const tasks = card.tasks ?? [];
    return html`${
      facts.length > 0
        ? html`<dl>
            ${facts.map(
              ([term, value]) =>
                html`<dt>${term}</dt>
                  <dd>${value}</dd>`,
            )}
          </dl>`
        : nothing
    }
    ${card.notes ? html`<p class="notes">${card.notes}</p>` : nothing}
    ${
      tasks.length > 0
        ? html`<ul>
            ${tasks.map((task) =>
              this.renderTask(
                task,
                standing?.tasks.find((s) => s.id === task.id),
              ),
            )}
          </ul>`
        : nothing
    }
    ${
      this.admin
        ? html`<div class="footer">
            <button
              class="action quiet"
              data-testid="upkeep-edit"
              @click=${() => {
                this.edit(card);
              }}
            >
              ${icon(mdiPencilOutline)}${t.t("upkeep.edit")}
            </button>
          </div>`
        : nothing
    }`;
  }

  private renderTask(task: UpkeepTask, standing: TaskStanding | undefined): TemplateResult {
    const t = this.t;
    const last = task.last_done
      ? `${t.t("upkeep.last_done")} ${shownDate(t.language, task.last_done)}`
      : t.t("upkeep.never_done");
    return html`<li class="task" data-task=${task.id}>
      <span class="text">
        <span>${task.name}</span>
        <small
          >${
            standing
              ? html`<span class="chip ${standing.state}"
                    >${t.t(`upkeep.state.${standing.state}`)}</span
                  >${dueText(t, standing.days)} · `
              : nothing
          }${everyText(t, task)}
          · ${last}</small
        >
      </span>
      <button
        class="action quiet"
        ?disabled=${this.busy}
        aria-label=${t.t("upkeep.done_label", { task: task.name })}
        title=${t.t("upkeep.done_label", { task: task.name })}
        @click=${() => {
          this.done(task);
        }}
      >
        ${icon(mdiCheck)}${t.t("upkeep.done")}
      </button>
    </li>`;
  }

  private renderForm(draft: UpkeepCard): TemplateResult {
    const t = this.t;
    const tasks = draft.tasks ?? [];
    const text = (key: "make" | "model" | "serial", longest = MAX_TEXT) =>
      html`<label
        >${t.t(`upkeep.${key}`)}<input
          name=${key}
          maxlength=${longest}
          .value=${draft[key] ?? ""}
          @input=${(event: Event) => {
            this.change({ [key]: (event.target as HTMLInputElement).value });
          }}
      /></label>`;
    const date = (key: "installed" | "warranty_end") =>
      html`<label
        >${t.t(`upkeep.${key}`)}<input
          type="date"
          name=${key}
          .value=${draft[key] ?? ""}
          @input=${(event: Event) => {
            this.change({ [key]: (event.target as HTMLInputElement).value || undefined });
          }}
      /></label>`;
    return html`<form
      data-testid="upkeep-form"
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.save();
      }}
    >
      ${text("make")} ${text("model")} ${text("serial")}
      <div class="pair">${date("installed")} ${date("warranty_end")}</div>
      <label
        >${t.t("upkeep.manual")}<input
          name="manual"
          maxlength=${MAX_LINK}
          placeholder="/local/…"
          .value=${draft.manual ?? ""}
          @input=${(event: Event) => {
            this.change({ manual: (event.target as HTMLInputElement).value });
          }}
      /></label>
      <p class="hint">${t.t("upkeep.manual_hint")}</p>
      <label
        >${t.t("upkeep.notes")}<textarea
          name="notes"
          rows="3"
          maxlength=${MAX_NOTES}
          .value=${draft.notes ?? ""}
          @input=${(event: Event) => {
            this.change({ notes: (event.target as HTMLTextAreaElement).value });
          }}
        ></textarea>
      </label>
      <h3>${t.t("upkeep.tasks")}</h3>
      ${tasks.map((task, index) => this.renderTaskFields(task, index))}
      ${
        tasks.length < MAX_TASKS
          ? html`<button
              type="button"
              class="action quiet"
              data-testid="upkeep-add-task"
              @click=${() => {
                const task: UpkeepTask = {
                  id: newTaskId(tasks),
                  name: "",
                  every: 3,
                  unit: "months",
                };
                this.change({ tasks: [...tasks, task] });
              }}
            >
              ${icon(mdiPlus)}${t.t("upkeep.add_task")}
            </button>`
          : nothing
      }
      <div class="footer">
        ${
          this.card
            ? html`<button
                type="button"
                class="action quiet"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.removeCard();
                }}
              >
                ${icon(mdiDeleteOutline)}${t.t("upkeep.remove")}
              </button>`
            : nothing
        }
        <button
          type="button"
          class="action quiet"
          @click=${() => {
            this.draft = undefined;
            this.error = undefined;
          }}
        >
          ${t.t("upkeep.cancel")}
        </button>
        <button type="submit" class="action" data-testid="upkeep-save" ?disabled=${this.busy}>
          ${t.t("upkeep.save")}
        </button>
      </div>
    </form>`;
  }

  private renderTaskFields(task: UpkeepTask, index: number): TemplateResult {
    const t = this.t;
    return html`<fieldset data-task=${task.id}>
      <div class="row">
        <label
          >${t.t("upkeep.task_name")}<input
            name="task-name"
            required
            maxlength=${MAX_TEXT}
            placeholder=${t.t("upkeep.task_placeholder")}
            .value=${task.name}
            @input=${(event: Event) => {
              this.changeTask(index, { name: (event.target as HTMLInputElement).value });
            }}
        /></label>
        <label
          >${t.t("upkeep.every")}<input
            name="task-every"
            type="number"
            min="1"
            max=${LONGEST[task.unit]}
            required
            .value=${String(task.every)}
            @input=${(event: Event) => {
              const input = event.target as HTMLInputElement;
              const every = Math.round(Number(input.value));
              // Emptied while typing another number: nothing to take yet.
              if (input.value.trim() !== "" && every >= 1) this.changeTask(index, { every });
            }}
        /></label>
        <label
          >&nbsp;<select
            name="task-unit"
            .value=${task.unit}
            @change=${(event: Event) => {
              const unit = (event.target as HTMLSelectElement).value as UpkeepUnit;
              this.changeTask(index, { unit, every: Math.min(task.every, LONGEST[unit]) });
            }}
          >
            <option value="days" ?selected=${task.unit === "days"}>
              ${t.t("upkeep.unit.days")}
            </option>
            <option value="months" ?selected=${task.unit === "months"}>
              ${t.t("upkeep.unit.months")}
            </option>
          </select></label
        >
        <button
          type="button"
          class="round"
          aria-label=${t.t("upkeep.remove_task", { name: task.name })}
          title=${t.t("upkeep.remove_task", { name: task.name })}
          @click=${() => {
            this.change({ tasks: (this.draft?.tasks ?? []).filter((_, i) => i !== index) });
          }}
        >
          ${icon(mdiDeleteOutline)}
        </button>
      </div>
      <label
        >${t.t("upkeep.last_done")}<input
          name="task-last-done"
          type="date"
          .value=${task.last_done ?? ""}
          @input=${(event: Event) => {
            this.changeTask(index, {
              last_done: (event.target as HTMLInputElement).value || undefined,
            });
          }}
      /></label>
    </fieldset>`;
  }
}

define("domotwin-upkeep-card", DomoTwinUpkeepCard);
