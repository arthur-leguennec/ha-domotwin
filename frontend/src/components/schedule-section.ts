/**
 * A piece's actions done later (`DECISIONS.md`, D-046), in its sheet: those waiting on its
 * entities, each with its time and a Cancel, and a short form to add one: switch on at a time
 * (a light at a brightness), off again after a while, or switch off. In a room's panel, the form
 * first asks which of its devices: its lights or its blinds (D-047). Loaded with the sheets.
 */
import { mdiClockOutline, mdiClose, mdiPlus } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import { entityName } from "../live/bindings";
import {
  MAX_SCHEDULE_ENTITIES,
  nextStep,
  schedulable,
  schedulesOf,
  soonIn,
  timeStyle,
  whenText,
  type Schedule,
  type TimeStyle,
} from "../live/schedules";
import { define } from "./define";
import { rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** How long a device switched on stays on (minutes; 0: until switched off otherwise). */
const DURATIONS = [0, 5, 15, 30, 60, 120, 240, 480];

/** Devices set together, in a room's panel: its lights, its blinds. */
export interface ScheduleGroup {
  key: string;
  label: string;
  entities: string[];
}

/** `<domotwin-schedules>`: the actions done later on a piece's entities, or a room's. */
export class DomoTwinSchedules extends LitElement {
  static override properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    groups: { attribute: false },
    group: { state: true },
    items: { state: true },
    adding: { state: true },
    action: { state: true },
    at: { state: true },
    duration: { state: true },
    brightness: { state: true },
    busy: { state: true },
    said: { state: true },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    css`
      :host {
        display: block;
      }
      h3 {
        margin: 12px 0 0;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #5f6368);
      }
      .item {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 48px;
      }
      .item > svg {
        flex: none;
        width: 20px;
        height: 20px;
        fill: currentColor;
        opacity: 0.7;
      }
      .item span {
        flex: 1;
        min-width: 0;
      }
      button.cancel {
        flex: none;
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
      button.cancel:hover:not([disabled]) {
        background: color-mix(in srgb, currentColor 8%, transparent);
      }
      button.cancel svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      input[type="time"],
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
        min-width: 0;
      }
      .form {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      .form label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .choice {
        display: flex;
        gap: 6px;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 4px;
      }
      p.said {
        margin: 6px 0 0;
        color: var(--secondary-text-color, #5f6368);
      }
    `,
  ];

  hass?: HomeAssistant;
  /** The piece's entities. */
  entities: string[] = [];
  /** A room's devices set together (instead of `entities`), and the one chosen in the form. */
  groups: ScheduleGroup[] = [];
  protected group = 0;
  /** Every action waiting (none yet: the integration has not said, or cannot). */
  protected items?: Schedule[];
  protected adding = false;
  protected action: "on" | "off" = "on";
  /** The time of day of the new action ("HH:MM"), then how long it lasts (minutes). */
  protected at = "";
  protected duration = 0;
  protected brightness = 100;
  protected busy = false;
  /** What the integration said of the last action set, or why it was refused. */
  protected said?: { text: string; error: boolean };
  private stop?: () => void;
  private following?: HomeAssistant["connection"];

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** The entities an action can switch: the piece's, or every one of the room's groups. */
  private get schedulable(): string[] {
    const all = this.groups.length > 0 ? this.groups.flatMap((g) => g.entities) : this.entities;
    return [...new Set(all)].filter(schedulable);
  }

  /** Whether the viewer may use an entity (their rights, D-071). */
  private usable(entity: string): boolean {
    return this.hass?.canAct?.(entity) !== false;
  }

  /** The groups an action can switch, with only what it can switch and the viewer may use. */
  private get shownGroups(): ScheduleGroup[] {
    return this.groups
      .map((group) => ({
        ...group,
        entities: group.entities.filter((id) => schedulable(id) && this.usable(id)),
      }))
      .filter((group) => group.entities.length > 0);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    this.stop = undefined;
    this.following = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Another piece's sheet, or another room's: its own form and words.
    const before = changed.get("entities");
    const groups = changed.get("groups");
    const keys = (list: ScheduleGroup[]): string =>
      list.map((g) => `${g.key}:${g.entities.join()}`).join(";");
    if (
      (before && before.join() !== this.entities.join()) ||
      (groups && keys(groups) !== keys(this.groups))
    ) {
      this.adding = false;
      this.said = undefined;
      this.group = 0;
    }
    const hass = this.hass;
    if (!hass || !this.isConnected || this.following === hass.connection) return;
    this.stop?.();
    this.following = hass.connection;
    this.stop = DomoTwinClient.for(hass).subscribeSchedules((items) => {
      this.items = items;
    });
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const entities = this.schedulable;
    if (!hass || !this.items || entities.length === 0) return nothing;
    const t = this.t;
    const style = timeStyle(hass);
    const now = new Date(nowOf(hass));
    const mine = schedulesOf(this.items, entities);
    // What the viewer may only look at (D-071): its actions listed, none set nor cancelled.
    const form = this.formEntities;
    if (mine.length === 0 && form.length === 0) return nothing;
    return html`<h3>${t.t("schedules.title")}</h3>
      ${mine.map((item) => this.renderItem(hass, t, item, style, now))}
      ${
        form.length === 0
          ? nothing
          : this.adding
            ? this.renderForm(hass, t, form)
            : this.renderAdd(hass, t)
      }
      ${
        this.said
          ? html`<p class="said" role=${this.said.error ? "alert" : "status"}>${this.said.text}</p>`
          : nothing
      }`;
  }

  private renderItem(
    hass: HomeAssistant,
    t: Translator,
    item: Schedule,
    style: TimeStyle,
    now: Date,
  ): TemplateResult {
    const step = nextStep(item);
    const when = whenText(step.at, now, style);
    const names = item.entities.map((id) => entityName(hass, id)).join(", ");
    const cover = item.entities.every((id) => id.startsWith("cover."));
    let text: string;
    if (step.action === "off") {
      text = t.t(cover ? "schedules.close_at" : "schedules.off_at", { when });
    } else {
      const until = item.until ? whenText(new Date(item.until), now, style) : undefined;
      const key = cover
        ? until
          ? "schedules.open_until"
          : "schedules.open_at"
        : until
          ? "schedules.on_until"
          : "schedules.on_at";
      text = t.t(key, {
        when,
        until: until ?? "",
        brightness: item.brightness ? ` (${item.brightness} %)` : "",
      });
    }
    return html`<div class="item" data-testid="schedule" data-schedule=${item.id}>
      ${icon(mdiClockOutline)}
      <span
        >${text}${item.entities.length > 1 ? html`<br /><small>${names}</small>` : nothing}</span
      >
      ${
        item.entities.every((id) => this.usable(id))
          ? html`<button
              class="cancel"
              data-testid="schedule-cancel"
              aria-label=${t.t("schedules.cancel")}
              title=${t.t("schedules.cancel")}
              ?disabled=${this.busy}
              @click=${() => void this.cancel(item.id)}
            >
              ${icon(mdiClose)}
            </button>`
          : nothing
      }
    </div>`;
  }

  private renderAdd(hass: HomeAssistant, t: Translator): TemplateResult {
    return html`<div class="footer">
      <button
        class="action quiet"
        data-testid="schedule-add"
        @click=${() => {
          this.adding = true;
          this.action = "on";
          this.at = soonIn(new Date(nowOf(hass)), timeStyle(hass).timeZone);
          this.duration = 0;
          this.brightness = 100;
          this.said = undefined;
        }}
      >
        ${icon(mdiPlus)}${t.t("schedules.add")}
      </button>
    </div>`;
  }

  /** What the form's action switches: the piece's entities, or the room's group chosen. */
  private get formEntities(): string[] {
    const groups = this.shownGroups;
    if (this.groups.length === 0) return this.schedulable.filter((id) => this.usable(id));
    return (groups[this.group] ?? groups[0])?.entities ?? [];
  }

  /** In a room's panel, which of its devices: its lights, its blinds. */
  private renderGroups(t: Translator): TemplateResult | typeof nothing {
    const groups = this.shownGroups;
    if (groups.length < 2) return nothing;
    return html`<div class="choice" role="group" aria-label=${t.t("schedules.which")}>
      ${groups.map(
        (group, index) =>
          html`<button
            class="action ${this.group === index ? "" : "quiet"}"
            aria-pressed=${this.group === index ? "true" : "false"}
            data-testid=${`schedule-group-${group.key}`}
            @click=${() => {
              this.group = index;
            }}
          >
            ${group.label}
          </button>`,
      )}
    </div>`;
  }

  private renderForm(hass: HomeAssistant, t: Translator, entities: string[]): TemplateResult {
    const cover = entities.every((id) => id.startsWith("cover."));
    const light = entities.some((id) => id.startsWith("light."));
    const on = this.action === "on";
    const choice = (action: "on" | "off", key: MessageKey): TemplateResult =>
      html`<button
        class="action ${this.action === action ? "" : "quiet"}"
        aria-pressed=${this.action === action ? "true" : "false"}
        data-testid=${`schedule-${action}`}
        @click=${() => {
          this.action = action;
        }}
      >
        ${t.t(key)}
      </button>`;
    return html`<div class="form" data-testid="schedule-form">
      ${this.renderGroups(t)}
      <div class="choice" role="group" aria-label=${t.t("schedules.what")}>
        ${choice("on", cover ? "schedules.open" : "schedules.on")}
        ${choice("off", cover ? "schedules.close" : "schedules.off")}
      </div>
      <label>
        ${t.t("schedules.at")}
        <input
          type="time"
          data-testid="schedule-at"
          required
          .value=${this.at}
          @input=${(event: Event) => {
            this.at = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      ${
        on && !cover
          ? html`<label>
              ${t.t("schedules.for")}
              <select
                data-testid="schedule-for"
                @change=${(event: Event) => {
                  this.duration = Number((event.target as HTMLSelectElement).value);
                }}
              >
                ${DURATIONS.map(
                  (minutes) =>
                    html`<option value=${minutes} ?selected=${minutes === this.duration}>
                      ${
                        minutes === 0
                          ? t.t("schedules.for_ever")
                          : minutes < 60
                            ? t.t("schedules.minutes", { count: minutes })
                            : t.t("schedules.hours", { count: minutes / 60 })
                      }
                    </option>`,
                )}
              </select>
            </label>`
          : nothing
      }
      ${
        on && light
          ? html`<label>
              ${t.t("schedules.brightness", { value: this.brightness })}
              <input
                type="range"
                min="1"
                max="100"
                data-testid="schedule-brightness"
                .value=${String(this.brightness)}
                @input=${(event: Event) => {
                  this.brightness = Number((event.target as HTMLInputElement).value);
                }}
              />
            </label>`
          : nothing
      }
      <div class="footer">
        <button
          class="action quiet"
          @click=${() => {
            this.adding = false;
          }}
        >
          ${t.t("schedules.back")}
        </button>
        <button
          class="action"
          data-testid="schedule-save"
          ?disabled=${this.busy || this.at === ""}
          @click=${() => void this.save(hass, entities, light)}
        >
          ${t.t("schedules.save")}
        </button>
      </div>
    </div>`;
  }

  private async save(hass: HomeAssistant, entities: string[], light: boolean): Promise<void> {
    this.busy = true;
    const on = this.action === "on";
    // A room's many lights: as many actions as the integration takes devices at once.
    const said: string[] = [];
    try {
      for (let i = 0; i < entities.length; i += MAX_SCHEDULE_ENTITIES) {
        const { text } = await DomoTwinClient.for(hass).addSchedule({
          entities: entities.slice(i, i + MAX_SCHEDULE_ENTITIES),
          action: this.action,
          at: this.at,
          ...(on && this.duration > 0 ? { duration: this.duration * 60 } : {}),
          ...(on && light ? { brightness: this.brightness } : {}),
        });
        said.push(text);
      }
      this.said = { text: said.join(" "), error: false };
      this.adding = false;
    } catch (err) {
      // Some were set: the form closes on what was, and why the rest was not.
      this.said = { text: [...said, this.refusal(err)].join(" "), error: true };
      if (said.length > 0) this.adding = false;
    } finally {
      this.busy = false;
    }
  }

  private async cancel(id: string): Promise<void> {
    if (!this.hass) return;
    this.busy = true;
    try {
      await DomoTwinClient.for(this.hass).cancelSchedule(id);
      this.said = undefined;
    } catch (err) {
      this.said = { text: this.refusal(err), error: true };
    } finally {
      this.busy = false;
    }
  }

  /** Why the integration refused, in the viewer's words. */
  private refusal(err: unknown): string {
    return this.t.t("schedules.refused", {
      reason: this.t.error(isHassError(err) ? err.code : ""),
    });
  }
}

define("domotwin-schedules", DomoTwinSchedules);
