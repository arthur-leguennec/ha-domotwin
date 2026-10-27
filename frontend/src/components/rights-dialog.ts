/**
 * `<domotwin-rights>`: what each person uses, only sees or does not see in DomoTwin (D-071), for
 * administrators, in one place: everyone's, then each person's own, room by room on every storey
 * and device by device. Loaded when first opened.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";

import { DomoTwinClient, type Settings } from "../ha/client";
import { isEntityId, isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { rightsEn, rightsFr } from "../i18n/rights";
import { entityName, NO_BINDINGS, type BindingsJson } from "../live/bindings";
import { roomDevices } from "../live/guests";
import { LEVELS, type Level, type Rights, type RightsSet } from "../live/rights";
import { planRooms } from "../live/suggest";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: rightsEn, fr: rightsFr });

const EVERYONE = "";
const RANK: Record<Level, number> = { use: 0, see: 1, hidden: 2 };

/** A storey of the home, as stored. */
export interface RightsStorey {
  name: string;
  plan: unknown;
  layout?: Record<string, unknown>;
}

/** A room of the home, with its storey's name when there are several. */
interface RoomChoice {
  id: string;
  name: string;
  storey?: string;
}

/** Who rights can be set for: the people, each with whether they are an administrator. */
interface Person {
  id: string;
  name: string;
  /** Their Home Assistant user's, when they have one. */
  user?: string;
  admin: boolean;
}

/** A Home Assistant user, as `config/auth/list` gives it. */
interface HassUser {
  id: string;
  is_owner?: boolean;
  group_ids?: string[];
}

function copy(rights: Rights | undefined): Rights {
  const set = (given: RightsSet | undefined): RightsSet => ({
    rooms: { ...(given?.rooms ?? {}) },
    entities: { ...(given?.entities ?? {}) },
  });
  return {
    everyone: set(rights?.everyone),
    people: Object.fromEntries(
      Object.entries(rights?.people ?? {}).map(([person, given]) => [person, set(given)]),
    ),
  };
}

/**
 * The rights to keep: only the rooms of the plans (a room removed since is not kept for one of its
 * id drawn later), everyone's rooms used left out (the default).
 */
function cleaned(rights: Rights, rooms: ReadonlySet<string>): Rights {
  // No plan read: the rooms set are kept as they are, not taken for removed.
  const known = (room: string): boolean => rooms.size === 0 || rooms.has(room);
  const set = (given: RightsSet | undefined, everyone: boolean): RightsSet | undefined => {
    const kept = Object.entries(given?.rooms ?? {}).filter(
      ([room, level]) => known(room) && !(everyone && level === "use"),
    );
    const entities = Object.entries(given?.entities ?? {});
    const result: RightsSet = {};
    if (kept.length > 0) result.rooms = Object.fromEntries(kept);
    if (entities.length > 0) result.entities = Object.fromEntries(entities);
    return kept.length > 0 || entities.length > 0 ? result : undefined;
  };
  const result: Rights = {};
  const everyone = set(rights.everyone, true);
  if (everyone) result.everyone = everyone;
  const people = Object.entries(rights.people ?? {}).flatMap(([person, given]) => {
    const kept = set(given, false);
    return kept ? [[person, kept] as const] : [];
  });
  if (people.length > 0) result.people = Object.fromEntries(people);
  return result;
}

export class DomoTwinRights extends LitElement {
  static override properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    storeys: { attribute: false },
    bindings: { attribute: false },
    draft: { state: true },
    subject: { state: true },
    admins: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  static override styles = [
    baseStyles,
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
        width: min(560px, calc(100% - 32px));
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
      h3 {
        margin: 8px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      p {
        margin: 0;
      }
      p.hint,
      .storey,
      summary {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.summary {
        font-weight: 500;
      }
      p.error {
        color: var(--error-color, #d23a2f);
      }
      .room {
        display: grid;
        gap: 4px;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      label.row,
      .device {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      label.row > span,
      .device > span {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .device {
        padding: 2px 0 2px 12px;
      }
      .badge {
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
        font-size: 0.75rem;
      }
      details {
        display: grid;
        gap: 2px;
      }
      summary {
        cursor: pointer;
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
        max-width: 50%;
      }
      .add {
        display: flex;
        gap: 8px;
      }
      .add input {
        flex: 1;
        max-width: none;
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
  settings?: Settings;
  storeys: RightsStorey[] = [];
  bindings?: BindingsJson;
  protected draft?: Rights;
  /** The person whose rights are shown (`EVERYONE`: everyone's). */
  protected subject = EVERYONE;
  /** The users who are administrators, once read (none when they cannot be). */
  protected admins?: Set<string>;
  protected busy = false;
  protected error?: string;
  /** What the dialog reads of Home Assistant, once, when it opens. */
  private home?: {
    rooms: RoomChoice[];
    devices: Map<string, string[]>;
    people: Person[];
    entities: string[];
  };
  private extra = "";

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Home Assistant's states change all the time: what the dialog shows of them is read once. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.home !== undefined);
  }

  override willUpdate(): void {
    const hass = this.hass;
    if (!this.home && hass) {
      const several = this.storeys.length > 1;
      const rooms = this.storeys.flatMap((storey) =>
        planRooms(storey.plan).map((room) => ({
          ...room,
          ...(several ? { storey: storey.name } : {}),
        })),
      );
      const ids = Object.keys(hass.states).sort();
      this.home = {
        rooms,
        devices: roomDevices(
          hass,
          this.bindings ?? NO_BINDINGS,
          this.storeys,
          rooms,
          (entity) => hass.states[entity] !== undefined,
        ),
        people: ids
          .filter((id) => id.startsWith("person."))
          .map((id) => {
            const user = hass.states[id]?.attributes.user_id;
            return {
              id,
              name: entityName(hass, id),
              ...(typeof user === "string" ? { user } : {}),
              admin: false,
            };
          }),
        entities: ids,
      };
      void this.readAdmins(hass);
    }
    if (!this.draft && this.settings) this.draft = copy(this.settings.rights);
  }

  /** Which users are administrators: rights do not apply to them (said next to their name). */
  private async readAdmins(hass: HomeAssistant): Promise<void> {
    try {
      const users = await hass.connection.sendMessagePromise<HassUser[]>({
        type: "config/auth/list",
      });
      this.admins = new Set(
        users
          .filter((user) => user.is_owner === true || user.group_ids?.includes("system-admin"))
          .map((user) => user.id),
      );
    } catch {
      // Not said, then.
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** The rights being set for the subject. */
  private own(draft: Rights): RightsSet {
    return this.subject === EVERYONE
      ? (draft.everyone ?? {})
      : (draft.people?.[this.subject] ?? {});
  }

  private setLevel(kind: "rooms" | "entities", key: string, level: Level | undefined): void {
    const draft = copy(this.draft);
    const set =
      this.subject === EVERYONE
        ? (draft.everyone ??= {})
        : ((draft.people ??= {})[this.subject] ??= {});
    const levels = Object.entries(set[kind] ?? {}).filter(([k]) => k !== key);
    if (level !== undefined) levels.push([key, level]);
    set[kind] = Object.fromEntries(levels);
    this.draft = draft;
  }

  /** A room's level for the subject, and what it is without their own. */
  private roomLevels(draft: Rights, room: string): { own?: Level; inherited: Level } {
    const everyone = draft.everyone?.rooms?.[room] ?? "use";
    if (this.subject === EVERYONE) {
      const own = draft.everyone?.rooms?.[room];
      return { ...(own !== undefined && own !== "use" ? { own } : {}), inherited: "use" };
    }
    const own = draft.people?.[this.subject]?.rooms?.[room];
    return { ...(own !== undefined ? { own } : {}), inherited: everyone };
  }

  /** A device's level for the subject, and what it is without their own (`rooms`: its rooms). */
  private entityLevels(
    draft: Rights,
    entity: string,
    rooms: string[],
  ): { own?: Level; inherited: Level; roomHides?: boolean } {
    const strictest = rooms
      .map((room) => {
        const { own, inherited } = this.roomLevels(draft, room);
        return own ?? inherited;
      })
      .reduce<Level>((found, level) => (RANK[level] > RANK[found] ? level : found), "use");
    const own =
      this.subject === EVERYONE
        ? draft.everyone?.entities?.[entity]
        : draft.people?.[this.subject]?.entities?.[entity];
    // A room not seen hides everything in it, whatever their own level.
    const everyone = this.subject === EVERYONE ? undefined : draft.everyone?.entities?.[entity];
    return {
      ...(own !== undefined ? { own } : {}),
      inherited: strictest === "hidden" ? "hidden" : (everyone ?? strictest),
      ...(strictest === "hidden" ? { roomHides: true } : {}),
    };
  }

  /** The rooms a device is in, by room id. */
  private roomsOf(entity: string): string[] {
    const rooms: string[] = [];
    for (const [room, entities] of this.home?.devices ?? []) {
      if (entities.includes(entity)) rooms.push(room);
    }
    return rooms;
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const draft = this.draft;
    const home = this.home;
    if (!hass || !draft || !home) return;
    const t = this.t;
    this.busy = true;
    this.error = undefined;
    try {
      const rights = cleaned(draft, new Set(home.rooms.map((room) => room.id)));
      const settings: Settings = { ...this.settings };
      if (rights.everyone || rights.people) settings.rights = rights;
      else delete settings.rights;
      await DomoTwinClient.for(hass).saveSettings(settings);
      fire(this, "domotwin-saved", settings);
      this.close();
    } catch (error) {
      const reason = isHassError(error) ? t.error(error.code) : t.error("unknown");
      this.error = t.t("settings.save_failed", { reason });
    } finally {
      this.busy = false;
    }
  }

  private addDevice(): void {
    const entity = this.extra.trim();
    if (!isEntityId(entity)) {
      this.error = this.t.t("rights.bad_entity", { entity });
      return;
    }
    this.error = undefined;
    this.extra = "";
    const draft = this.draft;
    if (draft && this.own(draft).entities?.[entity] === undefined) {
      this.setLevel("entities", entity, "see");
    } else {
      this.requestUpdate();
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const draft = this.draft;
    const home = this.home;
    if (!draft || !home) return nothing;
    const t = this.t;
    const person = home.people.find((p) => p.id === this.subject);
    const admin = person?.user !== undefined && this.admins?.has(person.user) === true;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="rights-title"
      data-testid="rights-dialog"
    >
      <header>
        <h2 id="rights-title">${t.t("rights.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("panel.dismiss")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("rights.intro")}</p>
      <label class="row">
        <span>${t.t("rights.for")}</span>
        <select
          data-testid="rights-for"
          @change=${(event: Event) => {
            this.subject = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value=${EVERYONE} ?selected=${this.subject === EVERYONE}>
            ${t.t("rights.everyone")}
          </option>
          ${home.people.map(
            (p) =>
              html`<option value=${p.id} ?selected=${this.subject === p.id}>${p.name}</option>`,
          )}
        </select>
      </label>
      <p class="hint" data-testid="rights-who">
        ${
          person === undefined
            ? t.t("rights.everyone_hint")
            : admin
              ? t.t("rights.admin")
              : person.user === undefined
                ? t.t("rights.no_user")
                : t.t("rights.person_hint")
        }
      </p>
      <p class="summary" data-testid="rights-summary">${this.summary(draft, home.rooms)}</p>
      ${
        // Each one's own choices, made again for each (a choice made stays in its select).
        keyed(
          this.subject,
          html`${this.renderRooms(draft, home.rooms)} ${this.renderOther(draft, home)}`,
        )
      }
      <p class="hint" data-testid="rights-limit">${t.t("rights.limit")}</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <div class="footer">
        <button
          class="action quiet"
          @click=${() => {
            this.close();
          }}
        >
          ${t.t("rights.cancel")}
        </button>
        <button
          class="action"
          data-testid="rights-save"
          ?disabled=${this.busy}
          @click=${() => {
            void this.save();
          }}
        >
          ${t.t("rights.save")}
        </button>
      </div>
    </div>`;
  }

  /** What the subject uses, only sees and does not see, in a sentence. */
  private summary(draft: Rights, rooms: RoomChoice[]): string {
    const t = this.t;
    const counts: Record<Level, number> = { use: 0, see: 0, hidden: 0 };
    for (const room of rooms) {
      const { own, inherited } = this.roomLevels(draft, room.id);
      counts[own ?? inherited] += 1;
    }
    return t.t("rights.summary", {
      rooms: rooms.length,
      use: counts.use,
      see: counts.see,
      hidden: counts.hidden,
      devices: t.tp("rights.devices_apart", Object.keys(this.own(draft).entities ?? {}).length),
    });
  }

  /** A choice of level: as it is (the level it has without the subject's own), or one of them. */
  private levelSelect(
    testid: string,
    levels: { own?: Level; inherited: Level; roomHides?: boolean },
    change: (level: Level | undefined) => void,
    everyoneRoom = false,
  ): TemplateResult {
    const t = this.t;
    return html`<select
      data-testid=${testid}
      ?disabled=${levels.roomHides === true}
      title=${levels.roomHides ? t.t("rights.room_hides") : ""}
      @change=${(event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        change(value === "" ? undefined : (value as Level));
      }}
    >
      ${
        everyoneRoom
          ? nothing
          : html`<option value="" ?selected=${levels.own === undefined}>
              ${t.t("rights.default", { level: t.t(`rights.levels.${levels.inherited}`) })}
            </option>`
      }
      ${LEVELS.map(
        (level) =>
          html`<option
            value=${everyoneRoom && level === "use" ? "" : level}
            ?selected=${levels.own === level || (everyoneRoom && level === "use" && !levels.own)}
          >
            ${t.t(`rights.levels.${level}`)}
          </option>`,
      )}
    </select>`;
  }

  private renderRooms(draft: Rights, rooms: RoomChoice[]): TemplateResult {
    const t = this.t;
    const hass = this.hass;
    const privates = this.settings?.rooms ?? {};
    return html`<h3>${t.t("rights.rooms")}</h3>
      ${rooms.map((room) => {
        const devices = this.home?.devices.get(room.id) ?? [];
        return html`<div class="room" data-room=${room.id}>
          <label class="row">
            <span
              ><strong>${room.name}</strong>
              ${room.storey ? html`<span class="storey">${room.storey}</span>` : nothing}
              ${
                privates[room.id]
                  ? html`<span class="badge" title=${t.t("rights.private_hint")}
                      >${t.t("rights.private")}</span
                    >`
                  : nothing
              }</span
            >
            ${this.levelSelect(
              "room-level",
              this.roomLevels(draft, room.id),
              (level) => {
                this.setLevel("rooms", room.id, level);
              },
              this.subject === EVERYONE,
            )}
          </label>
          ${
            devices.length === 0 || !hass
              ? html`<p class="hint">${t.t("rights.no_devices")}</p>`
              : html`<details>
                  <summary>${t.tp("rights.devices_count", devices.length)}</summary>
                  ${devices.map((entity) =>
                    this.renderDevice(draft, entity, entityName(hass, entity)),
                  )}
                </details>`
          }
        </div>`;
      })}`;
  }

  private renderDevice(draft: Rights, entity: string, name: string): TemplateResult {
    return html`<div class="device" data-entity=${entity}>
      <span title=${entity}>${name}</span>
      ${this.levelSelect(
        "device-level",
        this.entityLevels(draft, entity, this.roomsOf(entity)),
        (level) => {
          this.setLevel("entities", entity, level);
        },
      )}
    </div>`;
  }

  /** The devices set apart that are in no room, and one more to add. */
  private renderOther(draft: Rights, home: NonNullable<DomoTwinRights["home"]>): TemplateResult {
    const t = this.t;
    const hass = this.hass;
    const inRooms = new Set([...home.devices.values()].flat());
    // A person's own, and everyone's they have unless they set theirs.
    const apart = [
      ...new Set([
        ...Object.keys(this.own(draft).entities ?? {}),
        ...(this.subject === EVERYONE ? [] : Object.keys(draft.everyone?.entities ?? {})),
      ]),
    ]
      .filter((entity) => !inRooms.has(entity))
      .sort();
    return html`<h3>${t.t("rights.other")}</h3>
      <p class="hint">${t.t("rights.other_hint")}</p>
      ${
        apart.length === 0
          ? html`<p class="hint">${t.t("rights.other_none")}</p>`
          : repeat(
              apart,
              (entity) => entity,
              (entity) =>
                this.renderDevice(draft, entity, hass ? entityName(hass, entity) : entity),
            )
      }
      <datalist id="rights-entities">
        ${home.entities.map((id) => html`<option value=${id}></option>`)}
      </datalist>
      <div class="add">
        <input
          type="text"
          list="rights-entities"
          data-testid="rights-extra"
          aria-label=${t.t("rights.add_label")}
          placeholder="script.movie_night"
          .value=${this.extra}
          @input=${(event: Event) => {
            this.extra = (event.target as HTMLInputElement).value;
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter") this.addDevice();
          }}
        />
        <button class="action quiet" data-testid="rights-add" @click=${() => this.addDevice()}>
          ${t.t("rights.add")}
        </button>
      </div>`;
  }
}

define("domotwin-rights", DomoTwinRights);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-rights": DomoTwinRights;
  }
}
