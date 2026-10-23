import { LitElement, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
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

function schema(t: Translator): FormField[] {
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
  ];
}

/** Visual editor of `custom:domotwin-card` (YAML is never needed). */
export class DomoTwinCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    config: { state: true },
  };

  hass?: HomeAssistant;
  protected config: Record<string, unknown> = {};

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

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const t = translatorFor(this.hass);
    return html`<ha-form
      .hass=${this.hass}
      .data=${this.config}
      .schema=${schema(t)}
      .computeLabel=${(field: FormField) => t.t(`editor.${field.name}` as MessageKey)}
      @value-changed=${this.changed}
    ></ha-form>`;
  }
}

define("domotwin-card-editor", DomoTwinCardEditor);
