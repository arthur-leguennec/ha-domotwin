/**
 * The two panels the view opens over the scene: the controls of an element (long press) and the
 * panel of a room (its lights, scenes, covers, climate and media from its Home Assistant area).
 * Loaded on demand, the first time one opens, so the module every page loads stays small.
 */
import { mdiClose, mdiInformationOutline, mdiLightbulbOff } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { areaEntities } from "../live/bindings";
import { define, fire } from "./define";
import { entityRow, rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { baseStyles } from "./styles";

const sheetStyles = css`
  :host {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    max-height: calc(100% - 24px);
    display: block;
    z-index: 2;
  }
  @media (min-width: 640px) {
    :host {
      left: auto;
      width: 360px;
    }
  }
  .sheet {
    max-height: inherit;
    overflow: auto;
    padding: 8px 16px 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }
  h3 {
    margin: 12px 0 0;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--secondary-text-color, #5f6368);
  }
  header button {
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
  p.empty {
    color: var(--secondary-text-color, #5f6368);
    margin: 8px 0;
  }
  .footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 8px;
  }
`;

abstract class Sheet extends LitElement {
  static override properties = {
    hass: { attribute: false },
    heading: { attribute: false },
  };

  hass?: HomeAssistant;
  heading = "";

  protected get t(): Translator {
    return translatorFor(this.hass);
  }

  protected close(): void {
    fire(this, "domotwin-close", {});
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.close();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
  }

  protected frame(
    body: TemplateResult,
    footer: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    return html`<div class="sheet glass" role="dialog" aria-label=${this.heading}>
      <header>
        <h2>${this.heading}</h2>
        <button
          aria-label=${this.t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${body} ${footer}
    </div>`;
  }
}

/** `<domotwin-controls>`: the entities of one element, with their controls. */
export class DomoTwinControls extends Sheet {
  static override properties = { ...Sheet.properties, entities: { attribute: false } };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  entities: string[] = [];

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    const first = this.entities[0];
    return this.frame(
      html`${this.entities.map((id) => entityRow(hass, t, id, true))}`,
      first
        ? html`<div class="footer">
            <button
              class="action quiet"
              @click=${() => {
                fire(this, "hass-more-info", { entityId: first });
              }}
            >
              ${icon(mdiInformationOutline)}${t.t("controls.more_info")}
            </button>
          </div>`
        : nothing,
    );
  }
}

const GROUPS: readonly {
  key: "lights" | "scenes" | "covers" | "climate" | "media" | "switches";
  domains: string[];
}[] = [
  { key: "lights", domains: ["light"] },
  { key: "scenes", domains: ["scene", "script"] },
  { key: "covers", domains: ["cover"] },
  { key: "climate", domains: ["climate"] },
  { key: "media", domains: ["media_player"] },
  { key: "switches", domains: ["switch", "fan", "input_boolean", "lock"] },
];

/** `<domotwin-room>`: the room panel, from the room's Home Assistant area. */
export class DomoTwinRoom extends Sheet {
  static override properties = {
    ...Sheet.properties,
    area: { attribute: false },
    admin: { attribute: false },
  };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  area?: string;
  admin = false;

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    const area = this.area;
    if (!area) {
      return this.frame(
        html`<p class="empty">${t.t("room.no_area")}</p>
          ${this.admin ? html`<p class="empty">${t.t("room.no_area_admin")}</p>` : nothing}`,
      );
    }
    const ids = areaEntities(hass, area);
    const groups = GROUPS.map((group) => ({
      key: group.key,
      ids: ids.filter((id) => group.domains.includes(id.split(".")[0] ?? "")),
    })).filter((group) => group.ids.length > 0);
    if (groups.length === 0) {
      return this.frame(html`<p class="empty">${t.t("room.empty")}</p>`);
    }
    const anyOn = ids.some((id) => id.startsWith("light.") && hass.states[id]?.state === "on");
    return this.frame(
      html`${groups.map(
        (group) =>
          html`<h3>${t.t(`room.${group.key}`)}</h3>
            ${group.ids.map((id) => entityRow(hass, t, id, false))}`,
      )}`,
      anyOn
        ? html`<div class="footer">
            <button
              class="action"
              @click=${() => {
                void hass
                  .callService("light", "turn_off", {}, { area_id: area })
                  .catch(() => undefined);
              }}
            >
              ${icon(mdiLightbulbOff)}${t.t("room.all_off")}
            </button>
          </div>`
        : nothing,
    );
  }
}

define("domotwin-controls", DomoTwinControls);
define("domotwin-room", DomoTwinRoom);
