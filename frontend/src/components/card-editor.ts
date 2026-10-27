import { LitElement, html, nothing, type TemplateResult } from "lit";

import { MAX_IDLE, THEME_MODES } from "../config";
import { DomoTwinClient, type StoreyInfo } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import {
  LAYER_NAMES,
  automationsAvailable,
  coverageAvailable,
  networkAvailable,
} from "../live/layers";
import { ALL_STOREYS, loadHome, storeyLevels, storeyName } from "../live/storeys";
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

/**
 * The storey picker, highest first, when the home has several storeys (or the card names one the
 * home no longer has, kept so that the setting is not lost).
 */
export function storeyField(
  t: Translator,
  storeys: readonly StoreyInfo[],
  current: unknown,
): FormField | undefined {
  const known =
    typeof current === "string" &&
    (storeys.some((storey) => storey.id === current) ||
      (current === ALL_STOREYS && storeys.length > 1));
  if (storeys.length < 2 && (typeof current !== "string" || !current || known)) return undefined;
  const list = storeyLevels(storeys)
    .reverse()
    .map(({ storey, level }) => ({ value: storey.id, label: storeyName(t, storey, level) }));
  if (typeof current === "string" && current && !known)
    list.push({ value: current, label: current });
  return {
    name: "storey",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "", label: t.t("editor.storey_ground") },
          ...(storeys.length > 1 ? [{ value: ALL_STOREYS, label: t.t("editor.storey_all") }] : []),
          ...list,
        ],
      },
    },
  };
}

function schema(
  t: Translator,
  home: {
    rooms: RoomOption[];
    storeys: StoreyInfo[];
    network: boolean;
    coverage: boolean;
    automations: boolean;
  },
  config: Record<string, unknown>,
): FormField[] {
  const storey = storeyField(t, home.storeys, config.storey);
  return [
    { name: "title", selector: { text: {} } },
    {
      name: "theme",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "", label: t.t("editor.theme_home") },
            ...THEME_MODES.map((value) => ({
              value,
              label: t.t(`settings.theme_${value}` as MessageKey),
            })),
          ],
        },
      },
    },
    { name: "accent", selector: { text: {} } },
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
    ...(storey ? [storey] : []),
    // Every storey at once: spread apart, the roof (D-028).
    ...(home.storeys.length > 1
      ? [
          { name: "spread", selector: { boolean: {} } },
          { name: "roof", selector: { boolean: {} } },
        ]
      : []),
    roomField(t, home.rooms, config.room),
    {
      name: "layer",
      selector: {
        select: {
          mode: "dropdown",
          // The network map and the radio coverage only where they can be shown (D-031, D-060),
          // or kept where they are set.
          options: LAYER_NAMES.filter(
            (value) =>
              config.layer === value ||
              ((value !== "network" || home.network) &&
                (value !== "coverage" || home.coverage) &&
                (value !== "automations" || home.automations)),
          ).map((value) => ({
            value,
            label: t.t(`layers.${value}` as MessageKey),
          })),
        },
      },
    },
    { name: "alerts", selector: { boolean: {} } },
    { name: "presence", selector: { boolean: {} } },
    { name: "people", selector: { boolean: {} } },
    { name: "sun", selector: options(t, "editor.sun", ["fixed", "real"]) },
    { name: "badges", selector: { boolean: {} } },
    { name: "cameras", selector: { boolean: {} } },
    { name: "names", selector: { boolean: {} } },
    { name: "small_rooms", selector: { boolean: {} } },
    // The kiosk (D-029): back after a while untouched, turning slowly, dimmed at night.
    { name: "idle", selector: { number: { min: 0, max: MAX_IDLE, step: 10, mode: "box" } } },
    { name: "orbit", selector: { boolean: {} } },
    { name: "night_dim", selector: { boolean: {} } },
    { name: "tools", selector: { boolean: {} } },
    { name: "voice", selector: { boolean: {} } },
    { name: "screen", selector: { text: {} } },
    { name: "font_family", selector: { text: {} } },
    { name: "demo", selector: { boolean: {} } },
  ];
}

/** Switches that are on unless turned off show as on. */
const ON_BY_DEFAULT = {
  alerts: true,
  presence: true,
  people: true,
  badges: true,
  cameras: true,
  names: true,
  spread: true,
  roof: true,
  tools: true,
  voice: true,
};

/** Visual editor of `custom:domotwin-card` (YAML is never needed). */
export class DomoTwinCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
    rooms: { state: true },
    storeys: { state: true },
  };

  hass?: HomeAssistant;
  protected config: Record<string, unknown> = {};
  /** The rooms of the storey chosen, and the home's storeys, once fetched. */
  protected rooms: RoomOption[] = [];
  protected storeys: StoreyInfo[] = [];
  /** The storey whose rooms were fetched ("" for the ground floor); undefined before. */
  private fetchedFor?: string;

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
        ([key, value]) =>
          value !== "" &&
          value !== undefined &&
          value !== null &&
          // A switch shown on by default is not written until it is turned off.
          !(key in ON_BY_DEFAULT && value === true && this.config[key] === undefined),
      ),
    );
    this.config = config;
    fire(this, "config-changed", { config });
  };

  /** The room picker lists the rooms of the storey chosen (the ground floor's by default). */
  private async fetchHome(hass: HomeAssistant, storey: string): Promise<void> {
    this.fetchedFor = storey;
    const client = DomoTwinClient.for(hass);
    try {
      // Every storey at once: the rooms of every storey. A storey since removed: the card shows
      // the ground floor, so do its rooms.
      const all = storey === ALL_STOREYS;
      const stored = await client
        .getPlan(storey && !all ? storey : undefined)
        .catch(() => client.getPlan());
      const home = all ? await loadHome(client, stored.storeys) : undefined;
      if (this.fetchedFor !== storey) return;
      this.rooms = home ? home.flatMap((s) => planRooms(s.plan)) : planRooms(stored.plan);
      this.storeys = stored.storeys;
    } catch {
      // No plan or no access: only the current settings are offered.
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const storey = typeof this.config.storey === "string" ? this.config.storey : "";
    if (this.fetchedFor !== storey) void this.fetchHome(this.hass, storey);
    const t = translatorFor(this.hass);
    return html`<ha-form
      .hass=${this.hass}
      .data=${{ ...ON_BY_DEFAULT, ...this.config }}
      .schema=${schema(
        t,
        {
          rooms: this.rooms,
          storeys: this.storeys,
          network: networkAvailable(this.hass),
          coverage: coverageAvailable(this.hass),
          automations: automationsAvailable(this.hass),
        },
        this.config,
      )}
      .computeLabel=${(field: FormField) => t.t(`editor.${field.name}` as MessageKey)}
      @value-changed=${this.changed}
    ></ha-form>`;
  }
}

define("domotwin-card-editor", DomoTwinCardEditor);
