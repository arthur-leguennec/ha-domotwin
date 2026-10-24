/**
 * The plan editor's bar (administrators, from the panel; `docs/DECISIONS.md`, D-025), loaded the
 * first time the plan editor opens: the tools (select, room, partition, door, window), undo, redo
 * and remove, and the fields of what is selected (name, floor, width, opening side, kind,
 * thickness). It fires `domotwin-plan-tool` (detail: the tool), `domotwin-plan-command` (detail:
 * the command) and `domotwin-plan-update` (detail: the fields changed).
 */
import {
  mdiCursorDefaultOutline,
  mdiDeleteOutline,
  mdiDoor,
  mdiRedo,
  mdiSwapHorizontal,
  mdiUndo,
  mdiVectorPolylineMinus,
  mdiVectorSquare,
  mdiWall,
  mdiWindowClosedVariant,
} from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import { define, fire } from "./define";
import { icon } from "./icon";
import { PLAN_TOOLS, type PlanEditState, type PlanSelection, type PlanTool } from "./plan-editor";
import type { PlanCommand } from "./view";
import { baseStyles } from "./styles";

/** The floor materials (`plan-format.md`). */
export const FLOORS = [
  "plain",
  "grey-wood",
  "oak",
  "painted-wood",
  "beige-tiles",
  "white-tiles",
] as const;
/** The kinds of doors (`plan-format.md`). */
export const DOOR_STYLES = [
  "hinged",
  "glazed",
  "double",
  "folding",
  "double-folding",
  "sliding",
  "barn",
  "opening",
  "sealed",
] as const;

/** The limits of a length field (cm), by element type and field. */
export const LIMITS: Record<string, [number, number]> = {
  "door.width": [20, 300],
  "window.width": [20, 1000],
  "wall.thickness": [1, 100],
};

/** A length typed in a field (cm, a dot or a comma), within `[min, max]`; undefined otherwise. */
export function parseLength(text: string, min: number, max: number): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const value = Math.round(Number(trimmed) * 10) / 10;
  return value >= min && value <= max ? value : undefined;
}

const TOOL_ICONS: Record<PlanTool, string> = {
  select: mdiCursorDefaultOutline,
  room: mdiVectorSquare,
  wall: mdiWall,
  door: mdiDoor,
  window: mdiWindowClosedVariant,
};

function key(value: string): string {
  return value.replace(/-/g, "_");
}

export class DomoTwinPlanBar extends LitElement {
  static override properties = {
    hass: { attribute: false },
    state: { attribute: false },
    tool: { attribute: false },
    invalid: { state: true },
  };
  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translateX(-50%);
        display: grid;
        justify-items: center;
        gap: 8px;
        width: max-content;
        max-width: calc(100% - 24px);
        z-index: 1;
      }
      .status {
        padding: 6px 12px;
        font-size: 0.875rem;
        text-align: center;
      }
      .fields {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 14px;
      }
      .fields .type {
        align-self: center;
        font-weight: 600;
        font-size: 0.875rem;
      }
      label {
        display: grid;
        gap: 2px;
        font-size: 0.75rem;
        color: var(--secondary-text-color, #5f6368);
      }
      input,
      select {
        box-sizing: border-box;
        min-height: 36px;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font: inherit;
        font-size: 0.875rem;
      }
      input.name {
        width: 150px;
      }
      input.length {
        width: 72px;
      }
      input[aria-invalid="true"] {
        border-color: var(--error-color, #db4437);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
      }
      button.icon {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color, #1f2328);
        cursor: pointer;
      }
      button.icon:hover:not(:disabled) {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      button.icon:disabled {
        opacity: 0.35;
        cursor: default;
      }
      button.icon[aria-pressed="true"] {
        color: var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent);
      }
      .fields button.icon {
        width: 36px;
        height: 36px;
      }
      .separator {
        width: 1px;
        height: 24px;
        margin: 0 4px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
    `,
  ];

  hass?: HomeAssistant;
  state?: PlanEditState;
  tool: PlanTool = "select";
  /** Fields whose text was refused (`<type>.<field>`), until they change. */
  protected invalid = new Set<string>();

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  protected override willUpdate(): void {
    // Another element selected: its fields start clean.
    const id = this.state?.selection?.id;
    if (id !== this.selected) {
      this.selected = id;
      this.invalid = new Set();
    }
  }

  private selected?: string;

  private command(command: PlanCommand, path: string, label: MessageKey, enabled: boolean) {
    const text = this.t.t(label);
    return html`<button
      class="icon"
      data-testid=${`plan-${command}`}
      title=${text}
      aria-label=${text}
      ?disabled=${!enabled}
      @click=${() => {
        fire(this, "domotwin-plan-command", command);
      }}
    >
      ${icon(path)}
    </button>`;
  }

  private send(fields: Record<string, unknown>): void {
    fire(this, "domotwin-plan-update", fields);
  }

  /** A length field: sent when it is within its limits, else marked. */
  private length(selection: PlanSelection, field: string, label: MessageKey): TemplateResult {
    const id = `${selection.type}.${field}`;
    const [min, max] = LIMITS[id] ?? [1, 10_000];
    const value = selection[field];
    return html`<label
      >${this.t.t(label)}
      <input
        class="length"
        inputmode="decimal"
        data-testid=${`plan-${field}`}
        aria-invalid=${this.invalid.has(id) ? "true" : "false"}
        .value=${typeof value === "number" ? String(value) : ""}
        @change=${(event: Event) => {
          const parsed = parseLength((event.target as HTMLInputElement).value, min, max);
          const invalid = new Set(this.invalid);
          if (parsed === undefined) invalid.add(id);
          else invalid.delete(id);
          this.invalid = invalid;
          if (parsed !== undefined) this.send({ [field]: parsed });
        }}
    /></label>`;
  }

  private fields(selection: PlanSelection): TemplateResult {
    const t = this.t;
    const name = typeof selection.name === "string" ? selection.name : "";
    const state = this.state;
    let extra: TemplateResult | typeof nothing;
    if (selection.type === "room") {
      const material = (selection.floor as { material?: unknown } | undefined)?.material;
      const floor = typeof material === "string" ? material : "plain";
      const corners = state?.cornerCount ?? 0;
      extra = html`<label
          >${t.t("plan.floor")}
          <select
            data-testid="plan-floor"
            @change=${(event: Event) => {
              this.send({ floor: { material: (event.target as HTMLSelectElement).value } });
            }}
          >
            ${FLOORS.map(
              (f) =>
                html`<option value=${f} ?selected=${f === floor}>
                  ${t.t(`plan.floor_${key(f)}` as MessageKey)}
                </option>`,
            )}
          </select></label
        >
        ${
          state?.corner !== null && corners > 3
            ? this.command("remove-corner", mdiVectorPolylineMinus, "plan.remove_corner", true)
            : nothing
        }`;
    } else if (selection.type === "door") {
      const style = typeof selection.style === "string" ? selection.style : "hinged";
      const opensTo = selection.opensTo === "left" ? "left" : "right";
      extra = html`${this.length(selection, "width", "plan.width")}
        <label
          >${t.t("plan.style")}
          <select
            data-testid="plan-style"
            @change=${(event: Event) => {
              this.send({ style: (event.target as HTMLSelectElement).value });
            }}
          >
            ${DOOR_STYLES.map(
              (s) =>
                html`<option value=${s} ?selected=${s === style}>
                  ${t.t(`plan.style_${key(s)}` as MessageKey)}
                </option>`,
            )}
          </select></label
        >
        <button
          class="icon"
          data-testid="plan-swing"
          title=${t.t("plan.swing")}
          aria-label=${t.t("plan.swing")}
          @click=${() => {
            this.send({ opensTo: opensTo === "left" ? "right" : "left" });
          }}
        >
          ${icon(mdiSwapHorizontal)}
        </button>`;
    } else if (selection.type === "window") {
      extra = this.length(selection, "width", "plan.width");
    } else {
      extra = this.length(selection, "thickness", "plan.thickness");
    }
    return html`<div class="fields glass" data-testid="plan-fields">
      <span class="type">${t.t(`plan.type_${selection.type}`)}</span>
      <label
        >${t.t("plan.name")}
        <input
          class="name"
          data-testid="plan-name"
          maxlength="80"
          .value=${name}
          @change=${(event: Event) => {
            this.send({ name: (event.target as HTMLInputElement).value.trim() });
          }}
      /></label>
      ${extra}
    </div>`;
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const state = this.state;
    const selection = state?.selection ?? null;
    return html`${
        selection
          ? keyed(selection.id, this.fields(selection))
          : html`<div class="status glass" role="status" data-testid="plan-status">
              ${t.t(`plan.hint_${this.tool}`)}
            </div>`
      }
      <div class="bar glass" role="toolbar" aria-label=${t.t("plan.toolbar")}>
        ${PLAN_TOOLS.map((tool) => {
          const text = t.t(`plan.tool_${tool}`);
          return html`<button
            class="icon"
            data-testid=${`plan-tool-${tool}`}
            title=${text}
            aria-label=${text}
            aria-pressed=${this.tool === tool ? "true" : "false"}
            @click=${() => {
              fire(this, "domotwin-plan-tool", tool);
            }}
          >
            ${icon(TOOL_ICONS[tool])}
          </button>`;
        })}
        <span class="separator" aria-hidden="true"></span>
        ${this.command("undo", mdiUndo, "edit.undo", state?.canUndo ?? false)}
        ${this.command("redo", mdiRedo, "edit.redo", state?.canRedo ?? false)}
        ${this.command("remove", mdiDeleteOutline, "plan.remove", selection !== null)}
      </div>`;
  }
}

define("domotwin-plan-bar", DomoTwinPlanBar);
