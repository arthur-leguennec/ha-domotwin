/**
 * The panels the view opens over the scene: the controls of an element (long press), a piece's own
 * sheet (a piece linked to nothing, for its upkeep card, D-033) and the panel of a room (its
 * lights, scenes, covers, climate and media from its Home Assistant area). Loaded on demand, the
 * first time one opens, so the module every page loads stays small.
 */
import { mdiDoorOpen, mdiInformationOutline, mdiLightbulbOff } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";

import { areaEntities } from "../live/bindings";
import { define, fire } from "./define";
import { entityRow, rowStyles } from "./entity-rows";
import { icon } from "./icon";
import type { CardStanding, Upkeep } from "../live/upkeep";
import "./automation-section";
import "./upkeep-section";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";

/**
 * A piece's upkeep card (D-033), where there is one or an administrator can write one; nothing
 * without upkeep (an integration older than D-033).
 */
function upkeepCard(sheet: {
  hass?: Sheet["hass"];
  piece?: string;
  upkeep?: Upkeep;
  standing?: CardStanding;
}): TemplateResult | typeof nothing {
  const { hass, piece, upkeep } = sheet;
  if (!hass || !piece || !upkeep) return nothing;
  if (!upkeep.pieces[piece] && hass.user?.is_admin !== true) return nothing;
  return html`<domotwin-upkeep-card
    .hass=${hass}
    .piece=${piece}
    .upkeep=${upkeep}
    .standing=${sheet.standing}
  ></domotwin-upkeep-card>`;
}

/** `<domotwin-controls>`: the entities of one element, with their controls and automations. */
export class DomoTwinControls extends Sheet {
  static override properties = {
    ...Sheet.properties,
    entities: { attribute: false },
    device: { attribute: false },
    area: { attribute: false },
    piece: { attribute: false },
    upkeep: { attribute: false },
    standing: { attribute: false },
  };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  entities: string[] = [];
  /** The Home Assistant device it stands for, and its room's area: their automations too. */
  device?: string;
  area?: string;
  /** The piece (its id), with the home's upkeep cards and where its own stands. */
  piece?: string;
  upkeep?: Upkeep;
  standing?: CardStanding;

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
        ></domotwin-automations>
        ${upkeepCard(this)}`,
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

/** `<domotwin-piece>`: a piece linked to nothing: its upkeep card, its room's panel a tap away. */
export class DomoTwinPiece extends Sheet {
  static override properties = {
    ...Sheet.properties,
    piece: { attribute: false },
    roomName: { attribute: false },
    upkeep: { attribute: false },
    standing: { attribute: false },
  };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  piece = "";
  /** The room it is in (none: no room panel to open). */
  roomName?: string;
  upkeep?: Upkeep;
  standing?: CardStanding;

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing;
    const t = this.t;
    const room = this.roomName;
    return this.frame(
      html`${upkeepCard(this)}`,
      room
        ? html`<div class="footer">
            <button
              class="action quiet"
              data-testid="piece-room"
              @click=${() => {
                fire(this, "domotwin-open-room", undefined);
              }}
            >
              ${icon(mdiDoorOpen)}${t.t("upkeep.room_panel", { room })}
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
define("domotwin-piece", DomoTwinPiece);
define("domotwin-room", DomoTwinRoom);
