/**
 * `<domotwin-upkeep-list>`: the upkeep layer's list (`DECISIONS.md`, D-033): every task of the
 * home by date, the overdue first, with **Done**, and the warranties ending soon; a tap on a line
 * frames its piece. Administrators set how many days ahead a task is due soon. The engine tints
 * the pieces. Loaded the first time the layer is shown.
 */
import { mdiCheck, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";

import { DomoTwinClient } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { upkeepLines, type Standings, type Upkeep, type UpkeepLine } from "../live/upkeep";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { dueText, everyText, shownDate, upkeepCall } from "./upkeep-text";

/** Most days ahead a task can be due soon. */
const MAX_LEAD = 365;

export class DomoTwinUpkeepList extends LitElement {
  static override properties = {
    hass: { attribute: false },
    upkeep: { attribute: false },
    standings: { attribute: false },
    names: { attribute: false },
    busy: { state: true },
    error: { state: true },
  };
  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
      }
      .sheet {
        /* Beside the view's tools, as the network map's: the layer button stays in reach. */
        position: absolute;
        inset-inline-end: 68px;
        bottom: 12px;
        width: min(360px, calc(100% - 80px));
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 12px 14px;
        box-sizing: border-box;
        pointer-events: auto;
        font-size: 0.875rem;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      header strong {
        flex: 1;
      }
      .legend {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 6px 0;
      }
      .legend span::before {
        content: "";
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-inline-end: 4px;
        border-radius: 3px;
        background: var(--q);
      }
      .fine {
        --q: #2e9e57;
      }
      .due,
      .warranty {
        --q: #c27c00;
      }
      .overdue {
        --q: #d23a2f;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 48px;
        border-inline-start: 4px solid var(--q);
        padding-inline-start: 8px;
        margin: 4px 0;
      }
      li button.line {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        padding: 4px 0;
        cursor: pointer;
      }
      li small {
        color: var(--secondary-text-color, #5f6368);
      }
      p.hint {
        color: var(--secondary-text-color, #5f6368);
        margin: 6px 0;
      }
      p.error {
        color: var(--error-color, #d23a2f);
      }
      label.lead {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        color: var(--secondary-text-color, #5f6368);
      }
      label.lead input {
        width: 4.5rem;
        font: inherit;
        padding: 4px 6px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
      }
      button.round {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
      }
    `,
  ];

  hass?: HomeAssistant;
  upkeep?: Upkeep;
  standings: Standings = {};
  /** The name of each element of the plan shown. */
  names: Record<string, { name: string; type: string } | undefined> = {};
  protected busy = false;
  protected error?: string;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  private name = (piece: string): string => this.names[piece]?.name ?? piece;

  private async run(work: (client: DomoTwinClient) => Promise<unknown>): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    this.error = await upkeepCall(hass, this.t, work);
    this.busy = false;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const upkeep = this.upkeep;
    if (!hass || !upkeep) return nothing;
    const t = this.t;
    const admin = hass.user?.is_admin === true;
    // The pieces of the plan shown (the others are on another storey).
    const lines = upkeepLines(upkeep, this.standings, this.name).filter(
      (line) => this.names[line.piece] !== undefined,
    );
    return html`<div
      class="sheet glass"
      data-testid="upkeep-list"
      role="region"
      aria-label=${t.t("layers.upkeep")}
    >
      <header>
        <strong>${t.t("layers.upkeep")}</strong>
        <button
          class="round"
          aria-label=${t.t("panel.dismiss")}
          title=${t.t("panel.dismiss")}
          @click=${() => {
            fire(this, "domotwin-close", undefined);
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <div class="legend">
        <span class="overdue">${t.t("upkeep.state.overdue")}</span>
        <span class="due">${t.t("upkeep.state.due")}</span>
        <span class="fine">${t.t("upkeep.state.fine")}</span>
      </div>
      ${
        lines.length === 0
          ? html`<p class="hint">
              ${t.t(admin ? "upkeep.list_empty_admin" : "upkeep.list_empty")}
            </p>`
          : html`<ul>
              ${lines.map((line) => this.renderLine(line))}
            </ul>`
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        admin
          ? html`<label class="lead"
              >${t.t("upkeep.lead")}
              <input
                type="number"
                min="0"
                max=${MAX_LEAD}
                data-testid="upkeep-lead"
                .value=${live(String(upkeep.lead_days))}
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  const days = Math.round(Number(input.value));
                  // Emptied, or out of range: the lead stays as it is.
                  if (input.value.trim() === "" || !(days >= 0 && days <= MAX_LEAD)) {
                    input.value = String(upkeep.lead_days);
                    return;
                  }
                  if (days !== upkeep.lead_days) {
                    void this.run((client) => client.saveUpkeep({}, days));
                  }
                }}
              />
              ${t.t("upkeep.lead_days")}</label
            >`
          : nothing
      }
    </div>`;
  }

  private renderLine(line: UpkeepLine): TemplateResult {
    const t = this.t;
    const name = this.name(line.piece);
    const task = line.task;
    const when = task
      ? dueText(t, line.days)
      : line.days === 0
        ? t.t("upkeep.warranty_today")
        : t.tp("upkeep.warranty_in", line.days);
    return html`<li class=${line.state} data-piece=${line.piece} data-task=${task?.id ?? ""}>
      <button
        class="line"
        @click=${() => {
          fire(this, "domotwin-show-element", line.piece);
        }}
      >
        <span>${task ? `${name} · ${task.name}` : name}</span>
        <small
          >${when} ·
          ${shownDate(t.language, line.due)}${task ? ` · ${everyText(t, task)}` : ""}</small
        >
      </button>
      ${
        task
          ? html`<button
              class="action quiet"
              ?disabled=${this.busy}
              aria-label=${t.t("upkeep.done_label", { task: task.name })}
              title=${t.t("upkeep.done_label", { task: task.name })}
              @click=${() => {
                void this.run((client) => client.upkeepDone(line.piece, task.id));
              }}
            >
              ${icon(mdiCheck)}${t.t("upkeep.done")}
            </button>`
          : nothing
      }
    </li>`;
  }
}

define("domotwin-upkeep-list", DomoTwinUpkeepList);
