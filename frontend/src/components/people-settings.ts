/**
 * `<domotwin-people-settings>`: who DomoTwin places in their rooms (D-034), for administrators.
 * Each person of Home Assistant gets the entities that say which room they are in (suggested: the
 * room sensors of their phone or watch), a colour; and for everyone, who sees the people and how
 * they are drawn. People who hid themselves can be shown again. Loaded when first opened.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isEntityId, isHassError, type HomeAssistant } from "../ha/types";
import { entityName } from "../live/bindings";
import { translatorFor, type Translator } from "../i18n";
import { colorOf, initials, type PeopleSettings, type PersonSettings } from "../live/people";
import { define, fire } from "./define";
import { icon } from "./icon";
import { avatar, avatarStyles } from "./person-avatar";
import { baseStyles } from "./styles";

/** Entities that say where one person is, at most (the integration's limit). */
const MAX_SOURCES = 10;

interface Draft {
  people: Record<string, PersonSettings>;
  shown: PeopleSettings["shown"];
  look: PeopleSettings["look"];
}

export class DomoTwinPeopleSettings extends LitElement {
  static override properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  static override styles = [
    baseStyles,
    avatarStyles,
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
        width: min(460px, calc(100% - 32px));
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
      .person {
        display: grid;
        gap: 6px;
        padding: 10px 0;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .person .top {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .person .top strong {
        flex: 1;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px 4px 2px 10px;
        border-radius: 14px;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent);
        font-size: 0.8rem;
      }
      .chip.suggested {
        background: transparent;
        border: 1px dashed var(--divider-color, rgba(0, 0, 0, 0.3));
        padding-right: 10px;
        cursor: pointer;
        color: inherit;
        font: inherit;
        font-size: 0.8rem;
      }
      .chip button {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
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
      label.row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      label.row span {
        flex: 1;
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
  settings?: PeopleSettings;
  protected draft?: Draft;
  protected busy = false;
  protected error?: string;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override willUpdate(): void {
    const settings = this.settings;
    if (!this.draft && settings) {
      const people: Record<string, PersonSettings> = {};
      for (const [id, person] of Object.entries(settings.people)) {
        // Only a colour chosen is kept: the others follow the integration's.
        people[id] =
          person.color === colorOf(id)
            ? { sources: [...person.sources] }
            : { sources: [...person.sources], color: person.color };
      }
      this.draft = { people, shown: settings.shown, look: settings.look };
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private change(person: string, settings: PersonSettings | undefined): void {
    const draft = this.draft;
    if (!draft) return;
    const people = Object.fromEntries(Object.entries(draft.people).filter(([id]) => id !== person));
    if (settings) people[person] = settings;
    this.draft = { ...draft, people };
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const draft = this.draft;
    if (!hass || !draft) return;
    this.busy = true;
    this.error = undefined;
    try {
      await DomoTwinClient.for(hass).savePeople(
        draft.people,
        draft.shown,
        draft.look,
        this.settings?.revision,
      );
      fire(this, "domotwin-saved", undefined);
      this.close();
    } catch (error) {
      const t = this.t;
      const reason = isHassError(error) ? t.error(error.code) : t.error("unknown");
      this.error = t.t("people.save_error", { reason });
    } finally {
      this.busy = false;
    }
  }

  private async showAgain(person: string): Promise<void> {
    const hass = this.hass;
    const settings = this.settings;
    if (!hass || !settings) return;
    try {
      const revision = await DomoTwinClient.for(hass).hidePerson(person, false);
      this.settings = {
        ...settings,
        revision,
        hidden: settings.hidden.filter((p) => p !== person),
      };
    } catch {
      this.error = this.t.t("people.hide_error");
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const draft = this.draft;
    const settings = this.settings;
    if (!hass || !draft || !settings) return nothing;
    const t = this.t;
    const persons = Object.values(hass.states)
      .flatMap((state) => (state?.entity_id.startsWith("person.") ? [state] : []))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="people-title"
      data-testid="people-settings-dialog"
    >
      <header>
        <h2 id="people-title">${t.t("people.settings")}</h2>
        <button
          class="round"
          aria-label=${t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("people.settings_hint")}</p>
      ${persons.length === 0 ? html`<p class="hint">${t.t("people.none")}</p>` : nothing}
      ${persons.map((state) => this.renderPerson(hass, draft, state.entity_id, state.attributes))}
      <label class="row">
        <span>${t.t("people.shown")}</span>
        <select
          data-testid="people-shown"
          @change=${(event: Event) => {
            const shown = (event.target as HTMLSelectElement).value as Draft["shown"];
            this.draft = { ...draft, shown };
          }}
        >
          ${(["everyone", "admins"] as const).map(
            (value) =>
              html`<option value=${value} ?selected=${draft.shown === value}>
                ${t.t(`people.shown_${value}`)}
              </option>`,
          )}
        </select>
      </label>
      <label class="row">
        <span>${t.t("people.look")}</span>
        <select
          data-testid="people-look"
          @change=${(event: Event) => {
            const look = (event.target as HTMLSelectElement).value as Draft["look"];
            this.draft = { ...draft, look };
          }}
        >
          ${(["figure", "pin"] as const).map(
            (value) =>
              html`<option value=${value} ?selected=${draft.look === value}>
                ${t.t(`people.look_${value}`)}
              </option>`,
          )}
        </select>
      </label>
      ${
        settings.hidden.length > 0
          ? html`<div>
              <p class="hint">${t.t("people.hidden")}</p>
              <div class="chips">
                ${settings.hidden.map(
                  (person) =>
                    html`<button
                      class="chip suggested"
                      data-testid="people-show-again"
                      @click=${() => {
                        void this.showAgain(person);
                      }}
                    >
                      ${t.t("people.show_again")}:
                      ${hass.states[person]?.attributes.friendly_name ?? person}
                    </button>`,
                )}
              </div>
            </div>`
          : nothing
      }
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
          data-testid="people-save"
          ?disabled=${this.busy}
          @click=${() => {
            void this.save();
          }}
        >
          ${t.t("people.save")}
        </button>
      </div>
    </div>`;
  }

  private renderPerson(
    hass: HomeAssistant,
    draft: Draft,
    id: string,
    attributes: Record<string, unknown>,
  ): TemplateResult {
    const t = this.t;
    const name =
      typeof attributes.friendly_name === "string" ? attributes.friendly_name : id.slice(7);
    const settings = draft.people[id];
    const color = settings?.color ?? colorOf(id);
    const shown = {
      id,
      name,
      color,
      initials: initials(name),
      home: true,
      self: false,
    };
    const candidates = (this.settings?.candidates ?? []).filter(
      (c) => !settings?.sources.includes(c.entity),
    );
    const suggested = candidates.filter((c) => c.person === id);
    const listId = `entities-${id.replace(/\W/g, "_")}`;
    const named = (entity: string): string => {
      const name = entityName(hass, entity);
      return name === entity ? entity : `${name} (${entity})`;
    };
    const full = (settings?.sources.length ?? 0) >= MAX_SOURCES;
    // Their devices followed by Bluetooth place them too (D-035): set in the Bluetooth settings.
    const located = (this.settings?.people[id]?.located ?? []).map((sensor) => {
      const device = hass.states[sensor]?.attributes.device_name;
      return typeof device === "string" ? device : entityName(hass, sensor);
    });
    return html`<div class="person" data-person=${id}>
      <div class="top">
        ${avatar(shown)}<strong>${name}</strong>
        <label class="row">
          <input
            type="checkbox"
            data-testid="person-placed"
            .checked=${settings !== undefined}
            @change=${(event: Event) => {
              const on = (event.target as HTMLInputElement).checked;
              this.change(id, on ? { sources: [] } : undefined);
            }}
          />
          ${t.t("people.placed")}
        </label>
      </div>
      ${
        settings && located.length > 0
          ? html`<p class="hint" data-testid="person-bluetooth">
              ${t.t("people.from_bluetooth", { devices: located.join(", ") })}
            </p>`
          : nothing
      }
      ${
        settings
          ? html`<div class="chips">
                ${settings.sources.map(
                  (entity) =>
                    html`<span class="chip" data-source=${entity}
                      >${named(entity)}<button
                        aria-label=${t.t("people.source_remove", { entity })}
                        @click=${() => {
                          this.change(id, {
                            ...settings,
                            sources: settings.sources.filter((s) => s !== entity),
                          });
                        }}
                      >
                        ${icon(mdiClose)}
                      </button></span
                    >`,
                )}
                ${(full ? [] : suggested).map(
                  (c) =>
                    html`<button
                      class="chip suggested"
                      data-suggested=${c.entity}
                      title=${t.t("people.suggested")}
                      @click=${() => {
                        this.change(id, { ...settings, sources: [...settings.sources, c.entity] });
                      }}
                    >
                      + ${named(c.entity)}
                    </button>`,
                )}
              </div>
              <label class="row">
                <input
                  type="text"
                  list=${listId}
                  ?disabled=${full}
                  data-testid="person-source"
                  placeholder=${t.t("people.source_add")}
                  aria-label=${t.t("people.source_add")}
                  @change=${(event: Event) => {
                    const input = event.target as HTMLInputElement;
                    const entity = input.value.trim();
                    if (!entity) return;
                    if (!isEntityId(entity)) {
                      this.error = t.t("people.bad_entity", { entity });
                      return;
                    }
                    this.error = undefined;
                    input.value = "";
                    if (!settings.sources.includes(entity)) {
                      this.change(id, { ...settings, sources: [...settings.sources, entity] });
                    }
                  }}
                />
                <datalist id=${listId}>
                  ${candidates.map((c) => html`<option value=${c.entity}>${named(c.entity)}</option>`)}
                </datalist>
                <input
                  type="color"
                  data-testid="person-color"
                  aria-label=${t.t("people.color")}
                  title=${t.t("people.color")}
                  .value=${color}
                  @change=${(event: Event) => {
                    this.change(id, {
                      ...settings,
                      color: (event.target as HTMLInputElement).value,
                    });
                  }}
                />
              </label>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-people-settings", DomoTwinPeopleSettings);
