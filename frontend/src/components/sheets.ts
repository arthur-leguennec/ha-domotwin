/**
 * The two panels the view opens over the scene: the controls of an element (long press) and the
 * panel of a room (its lights, scenes, covers, climate and media from its Home Assistant area).
 * Loaded on demand, the first time one opens, so the module every page loads stays small.
 */
import { mdiInformationOutline, mdiLightbulbOff } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";

import { areaEntities } from "../live/bindings";
import { define, fire } from "./define";
import { entityRow, rowStyles } from "./entity-rows";
import { icon } from "./icon";
import "./automation-section";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";

/** `<domotwin-controls>`: the entities of one element, with their controls and automations. */
export class DomoTwinControls extends Sheet {
  static override properties = {
    ...Sheet.properties,
    entities: { attribute: false },
    device: { attribute: false },
    area: { attribute: false },
  };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  entities: string[] = [];
  /** The Home Assistant device it stands for, and its room's area: their automations too. */
  device?: string;
  area?: string;

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    const first = this.entities[0];
    return this.frame(
      html`${this.entities.map((id) => entityRow(hass, t, id, true))}
        <domotwin-automations
          .hass=${hass}
          .entities=${this.entities}
          .device=${this.device}
          .area=${this.area}
        ></domotwin-automations>`,
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
    const automations = html`<domotwin-automations
      .hass=${hass}
      .area=${area}
    ></domotwin-automations>`;
    if (groups.length === 0) {
      return this.frame(
        html`<p class="empty">${t.t("room.empty")}</p>
          ${automations}`,
      );
    }
    const anyOn = ids.some((id) => id.startsWith("light.") && hass.states[id]?.state === "on");
    return this.frame(
      html`${groups.map(
        (group) =>
          html`<h3>${t.t(`room.${group.key}`)}</h3>
            ${group.ids.map((id) => entityRow(hass, t, id, false))}`,
      )}${automations}`,
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
