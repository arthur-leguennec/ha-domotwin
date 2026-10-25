/**
 * `<domotwin-private-rooms>`: which rooms are private (D-039), for administrators. A private room
 * is kept for the people chosen (none: for nobody), always or only while an entity is on; whoever
 * may not see it sees it closed. Loaded when first opened.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient, type PrivateRoom, type Settings } from "../ha/client";
import { isEntityId, isHassError, type HomeAssistant } from "../ha/types";
import { entityName } from "../live/bindings";
import { translatorFor, type Translator } from "../i18n";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** The entities offered for "while it is on": those that are on or off. */
const SWITCHES = ["input_boolean", "switch", "binary_sensor", "schedule", "light", "fan"];

/** A room of the home, with its storey's name when there are several. */
export interface RoomChoice {
  id: string;
  name: string;
  storey?: string;
}

/** Who and what can be chosen: the people, and the entities that are on or off. */
interface Choices {
  persons: { id: string; name: string }[];
  switches: { id: string; name: string }[];
}

/** A private room being set: `while` chosen, its entity maybe not yet. */
interface DraftRoom {
  people: string[];
  when: "always" | "while";
  entity: string;
}

export class DomoTwinPrivateRooms extends LitElement {
  static override properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    rooms: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .dialog {
        pointer-events: auto;
        width: min(480px, calc(100% - 32px));
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
      p.hint {
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.error {
        margin: 0;
        color: var(--error-color, #d23a2f);
      }
      .room {
        display: grid;
        gap: 6px;
        padding: 10px 0;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      label.row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      label.row span {
        flex: 1;
      }
      .storey {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .people {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
      }
      input[type="text"],
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
        min-width: 0;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
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
    `,
  ];

  hass?: HomeAssistant;
  settings?: Settings;
  rooms: RoomChoice[] = [];
  protected draft?: Record<string, DraftRoom>;
  protected busy = false;
  protected error?: string;
  /** Read from Home Assistant once, when the dialog opens. */
  private choices?: Choices;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Home Assistant's states change all the time: what the dialog shows of them is read once. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.choices !== undefined);
  }

  override willUpdate(): void {
    const hass = this.hass;
    if (!this.choices && hass) {
      const named = (id: string): { id: string; name: string } => ({
        id,
        name: entityName(hass, id),
      });
      const ids = Object.keys(hass.states).sort();
      this.choices = {
        persons: ids.filter((id) => id.startsWith("person.")).map(named),
        switches: ids.filter((id) => SWITCHES.includes(id.split(".")[0] ?? "")).map(named),
      };
    }
    if (!this.draft && this.settings) {
      const draft: Record<string, DraftRoom> = {};
      for (const [id, room] of Object.entries(this.settings.rooms ?? {})) {
        draft[id] = {
          people: [...room.people],
          when: room.while === undefined ? "always" : "while",
          entity: room.while ?? "",
        };
      }
      this.draft = draft;
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private change(room: string, value: DraftRoom | undefined): void {
    const draft = Object.fromEntries(
      Object.entries(this.draft ?? {}).filter(([id]) => id !== room),
    );
    if (value) draft[room] = value;
    this.draft = draft;
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const draft = this.draft;
    if (!hass || !draft) return;
    const t = this.t;
    const rooms: Record<string, PrivateRoom> = {};
    // Only the rooms of the plans: one removed since is not kept private for a room of its id
    // drawn later.
    const known = new Set(this.rooms.map((room) => room.id));
    for (const [id, room] of Object.entries(draft)) {
      if (!known.has(id)) continue;
      const rule: PrivateRoom = { people: room.people };
      if (room.when === "while") {
        const entity = room.entity.trim();
        if (!isEntityId(entity)) {
          const name = this.rooms.find((r) => r.id === id)?.name ?? id;
          this.error = t.t("privacy.bad_entity", { room: name });
          return;
        }
        rule.while = entity;
      }
      rooms[id] = rule;
    }
    this.busy = true;
    this.error = undefined;
    try {
      const settings: Settings = { ...this.settings, rooms };
      await DomoTwinClient.for(hass).saveSettings(settings);
      fire(this, "domotwin-saved", settings);
      this.close();
    } catch (error) {
      const reason = isHassError(error) ? t.error(error.code) : t.error("unknown");
      this.error = t.t("settings.save_failed", { reason });
    } finally {
      this.busy = false;
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const draft = this.draft;
    const choices = this.choices;
    if (!draft || !choices) return nothing;
    const t = this.t;
    const { persons, switches } = choices;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="privacy-title"
      data-testid="private-rooms-dialog"
    >
      <header>
        <h2 id="privacy-title">${t.t("privacy.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("privacy.hint")}</p>
      <datalist id="privacy-switches">
        ${switches.map(({ id, name }) => html`<option value=${id}>${name}</option>`)}
      </datalist>
      ${this.rooms.map((room) => this.renderRoom(room, draft[room.id], persons))}
      <p class="hint" data-testid="privacy-limit">${t.t("privacy.limit")}</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <div class="footer">
        <button
          class="action quiet"
          @click=${() => {
            this.close();
          }}
        >
          ${t.t("panel.cancel")}
        </button>
        <button
          class="action"
          data-testid="privacy-save"
          ?disabled=${this.busy}
          @click=${() => {
            void this.save();
          }}
        >
          ${t.t("settings.save")}
        </button>
      </div>
    </div>`;
  }

  private renderRoom(
    room: RoomChoice,
    rule: DraftRoom | undefined,
    persons: Choices["persons"],
  ): TemplateResult {
    const t = this.t;
    return html`<div class="room" data-room=${room.id}>
      <label class="row">
        <span
          ><strong>${room.name}</strong>
          ${room.storey ? html`<span class="storey">${room.storey}</span>` : nothing}</span
        >
        <select
          data-testid="room-access"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            this.change(
              room.id,
              value === "private" ? { people: [], when: "always", entity: "" } : undefined,
            );
          }}
        >
          <option value="open" ?selected=${rule === undefined}>${t.t("privacy.open")}</option>
          <option value="private" ?selected=${rule !== undefined}>${t.t("privacy.private")}</option>
        </select>
      </label>
      ${rule ? this.renderRule(room.id, rule, persons) : nothing}
    </div>`;
  }

  private renderRule(id: string, rule: DraftRoom, persons: Choices["persons"]): TemplateResult {
    const t = this.t;
    return html`<p class="hint">${t.t("privacy.who")}</p>
      <div class="people">
        ${persons.length === 0 ? html`<span class="hint">${t.t("privacy.nobody")}</span>` : nothing}
        ${persons.map(
          (person) =>
            html`<label class="row">
              <input
                type="checkbox"
                data-person=${person.id}
                .checked=${rule.people.includes(person.id)}
                @change=${(event: Event) => {
                  const on = (event.target as HTMLInputElement).checked;
                  const people = rule.people.filter((p) => p !== person.id);
                  if (on) people.push(person.id);
                  this.change(id, { ...rule, people });
                }}
              />
              ${person.name}
            </label>`,
        )}
      </div>
      <label class="row">
        <span>${t.t("privacy.when")}</span>
        <select
          data-testid="room-when"
          @change=${(event: Event) => {
            const when = (event.target as HTMLSelectElement).value as DraftRoom["when"];
            this.change(id, { ...rule, when });
          }}
        >
          <option value="always" ?selected=${rule.when === "always"}>
            ${t.t("privacy.always")}
          </option>
          <option value="while" ?selected=${rule.when === "while"}>
            ${t.t("privacy.while_on")}
          </option>
        </select>
      </label>
      ${
        rule.when === "while"
          ? html`<input
              type="text"
              list="privacy-switches"
              data-testid="room-while"
              placeholder="input_boolean.guests"
              aria-label=${t.t("privacy.entity")}
              .value=${rule.entity}
              @change=${(event: Event) => {
                const entity = (event.target as HTMLInputElement).value;
                this.change(id, { ...rule, entity });
              }}
            />`
          : nothing
      }`;
  }
}

define("domotwin-private-rooms", DomoTwinPrivateRooms);
