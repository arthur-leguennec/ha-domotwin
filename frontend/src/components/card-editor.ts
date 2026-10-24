import { LitElement, html, nothing, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import { LAYER_NAMES } from "../live/layers";
import { planRooms } from "../live/suggest";
import { define, fire } from "./define";

interface FormField {
  name: string;
  selector: Record<string, unknown>;
}

function options(
  t: Translator,
  prefix: string,
  values: readonly string[],
): Record<string, unknown> {
  return {
    select: {
      mode: "dropdown",
      options: values.map((value) => ({ value, label: t.t(`${prefix}_${value}` as MessageKey) })),
    },
  };
}

/** A room of the plan, for the picker. */
interface RoomOption {
  id: string;
  name: string;
}

function roomField(t: Translator, rooms: RoomOption[], current: unknown): FormField {
  const list = [...rooms];
  // A room the stored plan no longer has stays visible, so the card's setting is not lost.
  if (typeof current === "string" && current && !list.some((room) => room.id === current)) {
    list.push({ id: current, name: current });
  }
  return {
    name: "room",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "", label: t.t("editor.room_none") },
          ...list.map((room) => ({ value: room.id, label: room.name })),
        ],
      },
    },
  };
}

function schema(t: Translator, rooms: RoomOption[], config: Record<string, unknown>): FormField[] {
  return [
    { name: "title", selector: { text: {} } },
    { name: "view", selector: options(t, "editor.view", ["3d", "2d"]) },
    { name: "height", selector: { text: {} } },
    {
      name: "quality",
      selector: options(t, "editor.quality", ["auto", "eco", "balanced", "high"]),
    },
    { name: "cutaway", selector: options(t, "editor.cutaway", ["auto", "always", "off"]) },
    {
      name: "lighting",
      selector: options(t, "editor.lighting", ["auto", "morning", "day", "evening", "night"]),
    },
    roomField(t, rooms, config.room),
    {
      name: "layer",
      selector: {
        select: {
          mode: "dropdown",
          options: LAYER_NAMES.map((value) => ({
            value,
            label: t.t(`layers.${value}` as MessageKey),
          })),
        },
      },
    },
    { name: "alerts", selector: { boolean: {} } },
    { name: "presence", selector: { boolean: {} } },
    { name: "sun", selector: options(t, "editor.sun", ["fixed", "real"]) },
    { name: "font_family", selector: { text: {} } },
  ];
}

/** Switches that are on unless turned off show as on. */
const ON_BY_DEFAULT = { alerts: true, presence: true };

/** Visual editor of `custom:domotwin-card` (YAML is never needed). */
export class DomoTwinCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    rooms: { state: true },
  };

  hass?: HomeAssistant;
  protected config: Record<string, unknown> = {};
  /** The rooms of the stored plan, once fetched. */
  protected rooms: RoomOption[] = [];
  private roomsFetched = false;

  setConfig(config: Record<string, unknown>): void {
    this.config = { ...config };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.ensureForm();
  }

  /** `ha-form` is loaded lazily by Home Assistant; make sure it is defined. */
  private async ensureForm(): Promise<void> {
    if (customElements.get("ha-form") || !window.loadCardHelpers) return;
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    await (
      card.constructor as unknown as { getConfigElement?: () => Promise<unknown> }
    ).getConfigElement?.();
    this.requestUpdate();
  }

  private readonly changed = (event: CustomEvent<{ value: Record<string, unknown> }>): void => {
    event.stopPropagation();
    const config = Object.fromEntries(
      Object.entries({ ...this.config, ...event.detail.value }).filter(
        ([, value]) => value !== "" && value !== undefined && value !== null,
      ),
    );
    this.config = config;
    fire(this, "config-changed", { config });
  };

  /** The room picker lists the rooms of the stored plan. */
  private async fetchRooms(hass: HomeAssistant): Promise<void> {
    this.roomsFetched = true;
    try {
      this.rooms = planRooms((await DomoTwinClient.for(hass).getPlan()).plan);
    } catch {
      // No plan or no access: only the current setting is offered.
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    if (!this.roomsFetched) void this.fetchRooms(this.hass);
    const t = translatorFor(this.hass);
    return html`<ha-form
      .hass=${this.hass}
      .data=${{ ...ON_BY_DEFAULT, ...this.config }}
      .schema=${schema(t, this.rooms, this.config)}
      .computeLabel=${(field: FormField) => t.t(`editor.${field.name}` as MessageKey)}
      @value-changed=${this.changed}
    ></ha-form>`;
  }
}

define("domotwin-card-editor", DomoTwinCardEditor);
