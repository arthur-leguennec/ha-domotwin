/**
 * The editor of DomoTwin's summary card (D-061): which summary it shows. Loaded when the card is
 * edited.
 */
import { LitElement, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey } from "../i18n";
import "../i18n/summary";
import { SUMMARIES } from "../live/overview";
import { define, fire, inLanguage } from "./define";

export class DomoTwinSummaryCardEditor extends LitElement {
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
    this.config = { ...this.config, ...event.detail.value };
    fire(this, "config-changed", { config: this.config });
  };

  /** Drawn once Home Assistant's language is here (D-082). */
  protected override scheduleUpdate(): Promise<unknown> | undefined {
    return inLanguage(
      this,
      () => this.hass,
      () => super.scheduleUpdate(),
    );
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const t = translatorFor(this.hass);
    const schema = [
      {
        name: "summary",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: SUMMARIES.map((value) => ({
              value,
              label: t.t(`summary.titles.${value}` as MessageKey),
            })),
          },
        },
      },
    ];
    return html`<ha-form
      .hass=${this.hass}
      .data=${this.config}
      .schema=${schema}
      .computeLabel=${() => t.t("summary.kind")}
      @value-changed=${this.changed}
    ></ha-form>`;
  }
}

define("domotwin-summary-card-editor", DomoTwinSummaryCardEditor);
