/**
 * The panels the view opens over the scene: the controls of an element (long press), a piece's own
 * sheet (a piece linked to nothing, for its upkeep card, D-033), the panel of a room (its lights,
 * scenes, covers, climate and media from its Home Assistant area, and who is there, D-034) and a
 * person's sheet. Loaded on demand, the first time one opens, so the module every page loads stays
 * small.
 */
import {
  mdiCellphone,
  mdiDoorOpen,
  mdiEyeOffOutline,
  mdiHistory,
  mdiInformationOutline,
  mdiLock,
  mdiTagOutline,
  mdiWatch,
} from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, nowOf } from "../ha/types";
import { failureText } from "../live/actions";
import { areaEntities, entityName, type RoomAction } from "../live/bindings";
import { roomSensors } from "../live/history";
import {
  roomCommands,
  runRoom,
  schedulableGroups,
  type RoomCommand,
  type RoomDevices,
} from "../live/room-actions";
import type { Translator } from "../i18n";
import type { LocatedKind, LocatedShown } from "../live/locating";
import { explainable } from "../live/why";
import type { PersonShown } from "../live/people";
import { define, fire } from "./define";
import { entityRow, rowStyles } from "./entity-rows";
import { roomBarStyles, roomButtons } from "./room-bar";
import { icon } from "./icon";
import type { CardStanding, Upkeep } from "../live/upkeep";
import "./automation-section";
import "./schedule-section";
import "./bubble";
import "./upkeep-section";
import "./why-section";
import { avatar, avatarStyles } from "./person-avatar";
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

/** **History**: a report of these entities' history (D-058), which the view opens. */
function historyButton(
  sheet: HTMLElement,
  t: Translator,
  entities: string[],
  testId: string,
  label: string,
): TemplateResult {
  return html`<button
    class="action quiet"
    data-testid=${testId}
    @click=${() => {
      fire(sheet, "domotwin-open-history", { entities });
    }}
  >
    ${icon(mdiHistory)}${label}
  </button>`;
}

/** `<domotwin-controls>`: the entities of one element, with their controls, why the element is
 * as it is (D-059) and its automations. */
export class DomoTwinControls extends Sheet {
  static override properties = {
    ...Sheet.properties,
    entities: { attribute: false },
    primary: { attribute: false },
    unseen: { attribute: false },
    device: { attribute: false },
    area: { attribute: false },
    piece: { attribute: false },
    upkeep: { attribute: false },
    standing: { attribute: false },
  };
  static override styles = [baseStyles, rowStyles, sheetStyles];

  entities: string[] = [];
  /** The entity shown in the scene, which "Why?" explains (else the first). */
  primary?: string;
  /** Whether the viewer may not see an entity (D-039): "Why?" does not name it. */
  unseen?: (entity: string) => boolean;
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
    const why = this.primary ?? first;
    return this.frame(
      html`${this.entities.map((id) => entityRow(hass, t, id, true))}
        ${
          why && explainable(hass, why)
            ? html`<domotwin-why-section
                .hass=${hass}
                .entity=${why}
                .unseen=${this.unseen}
              ></domotwin-why-section>`
            : nothing
        }
        <domotwin-schedules .hass=${hass} .entities=${this.entities}></domotwin-schedules>
        <domotwin-automations
          .hass=${hass}
          .entities=${this.entities}
          .device=${this.device}
          .area=${this.area}
        ></domotwin-automations>
        ${upkeepCard(this)}`,
      // The sandbox's day has a report of its own (D-057), and Home Assistant's dialogs do not
      // know its entities (D-050).
      first && !hass.sandbox
        ? html`<div class="footer">
            ${historyButton(this, t, this.entities, "controls-history", t.t("controls.history"))}
            ${
              hass.demo
                ? nothing
                : html`<button
                    class="action quiet"
                    @click=${() => {
                      fire(this, "hass-more-info", { entityId: first });
                    }}
                  >
                    ${icon(mdiInformationOutline)}${t.t("controls.more_info")}
                  </button>`
            }
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

const peopleStyles = css`
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0 8px;
  }
  .people button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 2px 10px 2px 4px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.15));
    border-radius: 18px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0 8px;
  }
  .thing {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 2px 12px 2px 8px;
    border-radius: 18px;
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 10%, transparent);
  }
  ul.devices {
    margin: 4px 0 8px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  ul.devices li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* Darkened (lightened in the dark) towards the text, for contrast. */
  ul.devices li.left {
    color: color-mix(
      in srgb,
      var(--warning-color, #ffa600) 50%,
      var(--primary-text-color, #1f2328)
    );
  }
  .person p {
    margin: 2px 0;
  }
  .person small {
    color: var(--secondary-text-color, #5f6368);
  }
  p.error {
    color: var(--error-color, #d23a2f);
  }
`;

const KIND_ICONS: Record<LocatedKind, string> = {
  phone: mdiCellphone,
  watch: mdiWatch,
  thing: mdiTagOutline,
};

/** The devices followed by Bluetooth in a room (D-035): a phone, a watch, keys. */
function thingsHere(sheet: DomoTwinRoom, t: Translator): TemplateResult | typeof nothing {
  if (sheet.things.length === 0) return nothing;
  return html`<h3>${t.t("people.things_here")}</h3>
    <div class="people" data-testid="room-things">
      ${sheet.things.map(
        (thing) =>
          html`<span class="thing" data-thing=${thing.sensor}
            >${icon(KIND_ICONS[thing.kind])}${thing.name}</span
          >`,
      )}
    </div>`;
}

/** Who is in a room (D-034): a chip each, a tap opens their sheet. */
function peopleHere(sheet: DomoTwinRoom, t: Translator): TemplateResult | typeof nothing {
  if (sheet.people.length === 0) return nothing;
  return html`<h3>${t.t("people.here")}</h3>
    <div class="people" data-testid="room-people">
      ${sheet.people.map(
        (person) =>
          html`<button
            data-person=${person.id}
            @click=${() => {
              fire(sheet, "domotwin-open-person", person.id);
            }}
          >
            ${avatar(person)}${person.name}
          </button>`,
      )}
    </div>`;
}

/**
 * `<domotwin-room>`: the room panel: what the room does together and its own actions (D-047),
 * its devices from its Home Assistant area, what it will do later, and who is there.
 */
export class DomoTwinRoom extends Sheet {
  static override properties = {
    ...Sheet.properties,
    devices: { attribute: false },
    actions: { attribute: false },
    refused: { state: true },
    area: { attribute: false },
    admin: { attribute: false },
    people: { attribute: false },
    things: { attribute: false },
    closed: { attribute: false },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    sheetStyles,
    avatarStyles,
    peopleStyles,
    roomBarStyles,
  ];

  /** The room's devices (its area's and its pieces'), and the actions an administrator gave it. */
  devices?: RoomDevices;
  actions: RoomAction[] = [];
  /** What Home Assistant refused last. */
  protected refused?: string;
  area?: string;
  admin = false;
  /** A private room the user viewing may not see (D-039): its name, and that it is private. */
  closed = false;
  /** Who is in the room now (D-034). */
  people: PersonShown[] = [];
  /** The devices followed by Bluetooth heard in it (D-035). */
  things: LocatedShown[] = [];

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    if (this.closed) {
      return this.frame(
        html`<p class="empty" data-testid="room-private">
          ${icon(mdiLock)}${t.t("room.private")}
        </p>`,
      );
    }
    const area = this.area;
    const here = html`${peopleHere(this, t)}${thingsHere(this, t)}${this.renderActions(t)}`;
    const later = this.renderLater(t);
    if (!area) {
      return this.frame(
        html`${here}
          <p class="empty">${t.t("room.no_area")}</p>
          ${this.admin ? html`<p class="empty">${t.t("room.no_area_admin")}</p>` : nothing} ${later}`,
      );
    }
    // Its air sensors' history (D-058), when it has some.
    const sensors = hass.sandbox ? [] : roomSensors(hass, area);
    const footer =
      sensors.length > 0
        ? html`<div class="footer">
            ${historyButton(this, t, sensors, "room-history", t.t("room.history"))}
          </div>`
        : nothing;
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
        html`${here}
          <p class="empty">${t.t("room.empty")}</p>
          ${later}${automations}`,
        footer,
      );
    }
    return this.frame(
      html`${here}${groups.map(
        (group) =>
          html`<h3>${t.t(`room.${group.key}`)}</h3>
            ${group.ids.map((id) => entityRow(hass, t, id, false))}`,
      )}${later}${automations}`,
      footer,
    );
  }

  /** What the room does together, then its own actions: a tap each. */
  private renderActions(t: Translator): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const commands = this.devices ? roomCommands(hass, this.devices) : [];
    if (commands.length === 0 && this.actions.length === 0) return nothing;
    return html`<h3>${t.t("room.actions")}</h3>
      <div class="room-commands" data-testid="room-commands">
        ${roomButtons(t, commands, this.actions, (what) => void this.run(what), true)}
      </div>
      ${this.refused ? html`<p class="empty" role="alert">${this.refused}</p>` : nothing}`;
  }

  /** What the room will do later (D-046): its lights or its blinds, at a time. */
  private renderLater(t: Translator): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass || !this.devices) return nothing;
    const groups = schedulableGroups(this.devices).map((group) => ({
      ...group,
      label: t.t(group.key === "lights" ? "room.later_lights" : "room.later_covers"),
    }));
    if (groups.length === 0) return nothing;
    return html`<domotwin-schedules .hass=${hass} .groups=${groups}></domotwin-schedules>`;
  }

  private async run(what: RoomCommand | RoomAction): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.refused = undefined;
    try {
      if (!(await runRoom(this, hass, what))) {
        this.refused = this.t.t(hass.sandbox ? "sandbox.no_dialog" : "demo.no_dialog");
      }
    } catch (error) {
      this.refused = failureText(this.t, error);
    }
  }
}

/**
 * `<domotwin-person>`: a person (D-034): the room they are in and since when, what said so, a
 * button to the room's panel; to hide themselves from the views (an administrator anyone).
 */
export class DomoTwinPerson extends Sheet {
  static override properties = {
    ...Sheet.properties,
    person: { attribute: false },
    devices: { attribute: false },
    busy: { state: true },
    error: { state: true },
  };
  static override styles = [baseStyles, sheetStyles, avatarStyles, peopleStyles];

  person?: PersonShown;
  /** Their devices followed by Bluetooth (D-035), and where each is. */
  devices: LocatedShown[] = [];
  protected busy = false;
  protected error?: string;

  private async hide(hidden: boolean): Promise<void> {
    const hass = this.hass;
    const person = this.person;
    if (!hass || !person) return;
    this.busy = true;
    this.error = undefined;
    try {
      await DomoTwinClient.for(hass).hidePerson(person.id, hidden);
      if (hidden) this.close();
    } catch (error) {
      this.error = this.t.t(
        isHassError(error) && error.code === "unauthorized"
          ? "people.hide_refused"
          : "people.hide_error",
      );
    } finally {
      this.busy = false;
    }
  }

  /** Their devices: where each is heard, the ones left behind first. */
  private renderDevices(t: Translator): TemplateResult | typeof nothing {
    if (this.devices.length === 0) return nothing;
    const ordered = [...this.devices].sort((a, b) => Number(b.leftBehind) - Number(a.leftBehind));
    return html`<h3>${t.t("people.devices")}</h3>
      <ul class="devices" data-testid="person-devices">
        ${ordered.map((device) => {
          let text: string;
          if (device.private) {
            text = t.t("people.device_private", { device: device.name });
          } else if (device.leftBehind && device.roomName) {
            text = t.t("people.left_behind", { device: device.name, room: device.roomName });
          } else if (device.roomName) {
            text = t.t("people.device_where", { device: device.name, room: device.roomName });
          } else text = t.t("people.device_unheard", { device: device.name });
          return html`<li class=${device.leftBehind ? "left" : ""} data-device=${device.sensor}>
            ${icon(KIND_ICONS[device.kind])}${text}
          </li>`;
        })}
      </ul>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const person = this.person;
    if (!hass || !person) return nothing;
    const t = this.t;
    let where: string;
    if (!person.home) where = t.t("people.away");
    else if (person.private) where = t.t("people.in_private_room");
    else if (person.roomName) where = t.t("people.in_room", { room: person.roomName });
    else where = t.t("people.somewhere");
    const since = person.since ? new Date(person.since) : undefined;
    const sinceText =
      since && !Number.isNaN(since.getTime())
        ? t.t("people.since", {
            time: new Intl.DateTimeFormat(t.language, {
              ...(nowOf(hass) - since.getTime() > 86_400_000 ? { dateStyle: "short" } : {}),
              timeStyle: "short",
              timeZone: hass.config?.time_zone,
            }).format(since),
          })
        : undefined;
    const sourceName = person.source ? entityName(hass, person.source) : undefined;
    const admin = hass.user?.is_admin === true;
    const canHide = person.self || admin;
    return this.frame(
      html`<div class="person" data-testid="person-where">
          ${avatar(person, true)}
          <div>
            <p>${where}</p>
            ${sinceText ? html`<small>${sinceText}</small>` : nothing}
            ${sourceName ? html`<p><small>${t.t("people.told_by", { source: sourceName })}</small></p>` : nothing}
          </div>
        </div>
        ${this.renderDevices(t)}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}`,
      html`<div class="footer">
        ${
          canHide
            ? html`<button
                class="action quiet"
                data-testid="person-hide"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.hide(true);
                }}
              >
                ${icon(mdiEyeOffOutline)}${t.t(person.self ? "people.hide_me" : "people.hide")}
              </button>`
            : nothing
        }
        ${
          person.room
            ? html`<button
                class="action quiet"
                data-testid="person-room"
                @click=${() => {
                  fire(this, "domotwin-open-room", undefined);
                }}
              >
                ${icon(mdiDoorOpen)}${t.t("upkeep.room_panel", { room: person.roomName ?? "" })}
              </button>`
            : nothing
        }
      </div>`,
    );
  }
}

define("domotwin-controls", DomoTwinControls);
define("domotwin-piece", DomoTwinPiece);
define("domotwin-room", DomoTwinRoom);
define("domotwin-person", DomoTwinPerson);
