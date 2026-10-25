/**
 * `<domotwin-bluetooth-settings>`: DomoTwin's own Bluetooth locating (D-035), for administrators.
 * The receivers and where they are, the devices followed (a phone, a watch, a tag: its name, its
 * kind, whose it is) and where each is now, the devices that may be followed, a room taught by
 * holding a device in it, and what was learned. Loaded when first opened.
 */
import { mdiClose, mdiDeleteOutline } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import {
  deviceId,
  kindOf,
  sameMatch,
  settingsOf,
  type LocatedCandidate,
  type LocatedKind,
  type LocatedMatch,
  type LocatedSettings,
  type LocatingSettings,
} from "../live/locating";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** The choice of a receiver placed at a piece, in its room list. */
const PIECE = "@piece";
/** How long a room is taught (seconds). */
const TEACH_SECONDS = 30;
const KINDS: readonly LocatedKind[] = ["phone", "watch", "thing"];

interface Draft {
  receivers: Record<string, { room?: string; piece?: string }>;
  devices: Record<string, LocatedSettings>;
  learn: boolean;
}

export class DomoTwinBluetoothSettings extends LitElement {
  static override properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    candidates: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
    teaching: { state: true },
    taught: { state: true },
    teachDevice: { state: true },
    teachRoom: { state: true },
    teachingRoom: { state: true },
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
        width: min(520px, calc(100% - 32px));
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
        margin: 6px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      p {
        margin: 0;
      }
      p.hint,
      small {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.error,
      p.warning {
        color: var(--error-color, #d23a2f);
      }
      .row,
      label.row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .row > .grow {
        flex: 1;
        min-width: 8em;
      }
      .item {
        display: grid;
        gap: 6px;
        padding: 10px 0;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
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
  settings?: LocatingSettings;
  /** Devices that may be followed; undefined until looked for. */
  candidates?: LocatedCandidate[];
  protected draft?: Draft;
  protected busy = false;
  protected error?: string;
  /** Seconds left while a room is taught. */
  protected teaching?: number;
  protected taught?: string;
  protected teachDevice?: string;
  protected teachRoom?: string;
  /** The room being taught (the room chosen may change meanwhile). */
  protected teachingRoom?: string;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override willUpdate(): void {
    const settings = this.settings;
    if (!this.draft && settings) {
      const receivers: Draft["receivers"] = {};
      for (const receiver of settings.receivers) {
        if (receiver.room) receivers[receiver.source] = { room: receiver.room };
        else if (receiver.piece) receivers[receiver.source] = { piece: receiver.piece };
      }
      const devices = Object.fromEntries(
        Object.entries(settings.devices).map(([id, device]) => [id, settingsOf(device)]),
      );
      this.draft = { receivers, devices, learn: settings.learn };
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private reason(error: unknown): string {
    const t = this.t;
    return isHassError(error) ? t.error(error.code) : t.error("unknown");
  }

  private roomName(id: string): string {
    return this.settings?.rooms.find((room) => room.id === id)?.name ?? id;
  }

  /** A room as the lists show it: with its storey when another storey has a room so named. */
  private roomLabel(room: { id: string; name: string; storey: string }): string {
    const twins = this.settings?.rooms.filter((r) => r.name === room.name).length ?? 0;
    return twins > 1 && room.storey ? `${room.name} (${room.storey})` : room.name;
  }

  private personName(id: string): string {
    const name = this.hass?.states[id]?.attributes.friendly_name;
    return typeof name === "string" ? name : id.slice(7);
  }

  private changeDevice(id: string, device: LocatedSettings | undefined): void {
    const draft = this.draft;
    if (!draft) return;
    const devices = Object.fromEntries(Object.entries(draft.devices).filter(([d]) => d !== id));
    if (device) devices[id] = device;
    this.draft = { ...draft, devices };
  }

  private follow(candidate: LocatedCandidate): void {
    const draft = this.draft;
    if (!draft) return;
    const id = deviceId(candidate.name, Object.keys(draft.devices));
    // A key's title is kept for the list until saved (the save leaves it out).
    const match: LocatedMatch =
      "key" in candidate.match
        ? { key: candidate.match.key, title: candidate.match.title ?? candidate.name }
        : candidate.match;
    this.changeDevice(id, { name: candidate.name.slice(0, 60), kind: kindOf(match), match });
  }

  private async look(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    try {
      this.candidates = await DomoTwinClient.for(hass).locatingCandidates();
    } catch (error) {
      this.error = this.t.t("bluetooth.error", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const draft = this.draft;
    if (!hass || !draft) return;
    this.busy = true;
    this.error = undefined;
    try {
      await DomoTwinClient.for(hass).saveLocating(
        draft.receivers,
        Object.fromEntries(Object.entries(draft.devices).map(([id, d]) => [id, settingsOf(d)])),
        draft.learn,
        this.settings?.revision,
      );
      fire(this, "domotwin-saved", undefined);
      this.close();
    } catch (error) {
      this.error = this.t.t("bluetooth.save_error", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private async teach(device: string, room: string): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.error = undefined;
    this.taught = undefined;
    this.teachingRoom = room;
    this.teaching = TEACH_SECONDS;
    const timer = window.setInterval(() => {
      this.teaching = Math.max(0, (this.teaching ?? 1) - 1);
    }, 1000);
    try {
      const result = await DomoTwinClient.for(hass).teachRoom(device, room, TEACH_SECONDS);
      this.taught =
        result.readings === 0
          ? this.t.t("bluetooth.teach_nothing")
          : this.t.t("bluetooth.teach_done", {
              readings: result.readings,
              receivers: result.receivers,
            });
      if (result.readings > 0 && this.settings) {
        const learned = { ...this.settings.learned };
        learned[room] = (learned[room] ?? 0) + result.readings * result.receivers;
        this.settings = { ...this.settings, learned };
      }
    } catch (error) {
      this.error = this.t.t("bluetooth.error", { reason: this.reason(error) });
    } finally {
      window.clearInterval(timer);
      this.teaching = undefined;
      this.teachingRoom = undefined;
    }
  }

  private async forget(): Promise<void> {
    const hass = this.hass;
    if (!hass || !this.settings) return;
    try {
      await DomoTwinClient.for(hass).forgetLearned();
      this.settings = { ...this.settings, learned: {} };
    } catch (error) {
      this.error = this.t.t("bluetooth.error", { reason: this.reason(error) });
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const draft = this.draft;
    const settings = this.settings;
    if (!hass || !draft || !settings) return nothing;
    const t = this.t;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="bluetooth-title"
      data-testid="bluetooth-settings-dialog"
    >
      <header>
        <h2 id="bluetooth-title">${t.t("bluetooth.settings")}</h2>
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
      <p class="hint">${t.t("bluetooth.hint")}</p>
      ${
        settings.status === "ready"
          ? nothing
          : html`<p class="warning" data-testid="bluetooth-status">
              ${t.t(`bluetooth.${settings.status}`)}
            </p>`
      }
      ${this.renderReceivers(settings, draft)} ${this.renderDevices(hass, settings, draft)}
      ${this.renderCandidates(draft)} ${this.renderTeach(settings, draft)}
      ${this.renderLearned(settings, draft)}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <div class="footer">
        <button
          class="action quiet"
          @click=${() => {
            this.close();
          }}
        >
          ${t.t("panel.cancel")}
        </button>
        <button
          class="action"
          data-testid="bluetooth-save"
          ?disabled=${this.busy || this.teaching !== undefined}
          @click=${() => {
            void this.save();
          }}
        >
          ${t.t("bluetooth.save")}
        </button>
      </div>
    </div>`;
  }

  private renderReceivers(settings: LocatingSettings, draft: Draft): TemplateResult {
    const t = this.t;
    if (settings.receivers.length === 0) return html``;
    return html`<h3>${t.t("bluetooth.receivers")}</h3>
      <p class="hint">${t.t("bluetooth.receivers_hint")}</p>
      ${settings.receivers.map((receiver) => {
        // Placed by hand in a room, or at a piece (set through the API: kept as it is).
        const set = draft.receivers[receiver.source];
        const piece = set?.piece;
        const chosen = set?.room ?? (piece ? PIECE : "");
        let placed: string;
        if (receiver.placed_by === "device_area") placed = t.t("bluetooth.placed_device_area");
        else if (receiver.placed_by === "device_piece") {
          placed = t.t("bluetooth.placed_device_piece");
        } else placed = t.t("bluetooth.receiver_unplaced");
        return html`<div class="item" data-receiver=${receiver.source}>
          <div class="row">
            <strong class="grow">${receiver.name ?? receiver.source}</strong>
            <select
              data-testid="receiver-room"
              aria-label=${t.t("bluetooth.teach_room")}
              @change=${(event: Event) => {
                const room = (event.target as HTMLSelectElement).value;
                const receivers = Object.fromEntries(
                  Object.entries(draft.receivers).filter(([s]) => s !== receiver.source),
                );
                if (room === PIECE && piece) receivers[receiver.source] = { piece };
                else if (room) receivers[receiver.source] = { room };
                this.draft = { ...draft, receivers };
              }}
            >
              <option value="" ?selected=${chosen === ""}>${t.t("bluetooth.receiver_auto")}</option>
              ${
                piece
                  ? html`<option value=${PIECE} ?selected=${chosen === PIECE}>
                      ${t.t("bluetooth.placed_piece", { piece })}
                    </option>`
                  : nothing
              }
              ${settings.rooms.map(
                (room) =>
                  html`<option value=${room.id} ?selected=${chosen === room.id}>
                    ${this.roomLabel(room)}
                  </option>`,
              )}
            </select>
          </div>
          <small
            >${receiver.source}${chosen ? nothing : html` · ${placed}`}${
              receiver.idle !== null
                ? html` · ${t.t("bluetooth.heard_ago", { seconds: receiver.idle })}`
                : nothing
            }</small
          >
        </div>`;
      })}`;
  }

  private known(match: LocatedMatch, missing: boolean): string {
    const t = this.t;
    if (missing) return t.t("bluetooth.known_key_missing");
    if ("key" in match) return t.t("bluetooth.known_key", { title: match.title ?? match.key });
    if ("beacon" in match) {
      return t.t("bluetooth.known_beacon", {
        major: match.beacon.major,
        minor: match.beacon.minor,
      });
    }
    return t.t("bluetooth.known_address", { address: match.address });
  }

  private renderDevices(
    hass: HomeAssistant,
    settings: LocatingSettings,
    draft: Draft,
  ): TemplateResult {
    const t = this.t;
    const persons = Object.keys(hass.states)
      .filter((id) => id.startsWith("person."))
      .sort();
    const ids = Object.keys(draft.devices);
    return html`<h3>${t.t("bluetooth.devices")}</h3>
      ${ids.length === 0 ? html`<p class="hint">${t.t("bluetooth.devices_none")}</p>` : nothing}
      ${ids.map((id) => {
        const device = draft.devices[id];
        if (!device) return nothing;
        const now = settings.devices[id];
        const match = now && sameMatch(now.match, device.match) ? now.match : device.match;
        let where = "";
        if (now?.room) {
          where = t.t("bluetooth.now_in", {
            room: this.roomName(now.room),
            confidence: Math.round(now.confidence * 100),
          });
        } else if (now) where = t.t("bluetooth.not_heard");
        return html`<div class="item" data-device=${id}>
          <div class="row">
            <input
              type="text"
              class="grow"
              data-testid="device-name"
              aria-label=${t.t("bluetooth.name")}
              maxlength="60"
              .value=${device.name}
              @change=${(event: Event) => {
                const name = (event.target as HTMLInputElement).value.trim();
                if (name) this.changeDevice(id, { ...device, name });
              }}
            />
            <select
              data-testid="device-kind"
              aria-label=${t.t("bluetooth.kind")}
              @change=${(event: Event) => {
                const kind = (event.target as HTMLSelectElement).value as LocatedKind;
                this.changeDevice(id, { ...device, kind });
              }}
            >
              ${KINDS.map(
                (kind) =>
                  html`<option value=${kind} ?selected=${device.kind === kind}>
                    ${t.t(`bluetooth.kind_${kind}`)}
                  </option>`,
              )}
            </select>
            <select
              data-testid="device-owner"
              aria-label=${t.t("bluetooth.owner")}
              @change=${(event: Event) => {
                const person = (event.target as HTMLSelectElement).value;
                const changed: LocatedSettings = { ...device };
                if (person) changed.person = person;
                else delete changed.person;
                this.changeDevice(id, changed);
              }}
            >
              <option value="" ?selected=${!device.person}>${t.t("bluetooth.owner_none")}</option>
              ${persons.map(
                (person) =>
                  html`<option value=${person} ?selected=${device.person === person}>
                    ${this.personName(person)}
                  </option>`,
              )}
            </select>
            <button
              class="round"
              aria-label=${t.t("bluetooth.remove", { name: device.name })}
              @click=${() => {
                this.changeDevice(id, undefined);
              }}
            >
              ${icon(mdiDeleteOutline)}
            </button>
          </div>
          <small
            >${this.known(match, now?.missing_key === true)}${where ? ` · ${where}` : ""}</small
          >
        </div>`;
      })}`;
  }

  private renderCandidates(draft: Draft): TemplateResult {
    const t = this.t;
    const followed = Object.values(draft.devices);
    const offered = (this.candidates ?? []).filter(
      (candidate) => !followed.some((device) => sameMatch(device.match, candidate.match)),
    );
    return html`<h3>${t.t("bluetooth.add")}</h3>
      ${
        this.candidates === undefined
          ? html`<div class="row">
              <button
                class="action quiet"
                data-testid="bluetooth-find"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.look();
                }}
              >
                ${t.t("bluetooth.find")}
              </button>
            </div>`
          : offered.length === 0
            ? html`<p class="hint">${t.t("bluetooth.none_found")}</p>`
            : offered.map(
                (candidate) =>
                  html`<div class="row item" data-candidate=${candidate.name}>
                    <span class="grow"
                      >${candidate.name}<br /><small
                        >${this.known(
                          "key" in candidate.match
                            ? { ...candidate.match, title: candidate.match.title ?? candidate.name }
                            : candidate.match,
                          false,
                        )}${
                          candidate.rssi !== undefined ? ` · ${String(candidate.rssi)} dBm` : ""
                        }</small
                      ></span
                    >
                    <button
                      class="action quiet"
                      data-testid="bluetooth-follow"
                      @click=${() => {
                        this.follow(candidate);
                      }}
                    >
                      ${t.t("bluetooth.follow")}
                    </button>
                  </div>`,
              )
      }`;
  }

  private renderTeach(settings: LocatingSettings, draft: Draft): TemplateResult | typeof nothing {
    const t = this.t;
    if (settings.status === "no_bluetooth" || settings.rooms.length === 0) return nothing;
    const saved = Object.keys(settings.devices).filter((id) => id in draft.devices);
    // What the lists show: a choice no longer there (a device removed) falls back to the first.
    const device =
      this.teachDevice && saved.includes(this.teachDevice) ? this.teachDevice : saved[0];
    const room =
      this.teachRoom && settings.rooms.some((r) => r.id === this.teachRoom)
        ? this.teachRoom
        : settings.rooms[0]?.id;
    return html`<h3>${t.t("bluetooth.teach")}</h3>
      <p class="hint">${t.t("bluetooth.teach_hint")}</p>
      ${
        saved.length === 0
          ? html`<p class="hint">${t.t("bluetooth.teach_save_first")}</p>`
          : html`<div class="row">
              <select
                data-testid="teach-device"
                aria-label=${t.t("bluetooth.teach_device")}
                @change=${(event: Event) => {
                  this.teachDevice = (event.target as HTMLSelectElement).value;
                }}
              >
                ${saved.map(
                  (id) =>
                    html`<option value=${id} ?selected=${id === device}>
                      ${draft.devices[id]?.name ?? id}
                    </option>`,
                )}
              </select>
              <select
                data-testid="teach-room"
                aria-label=${t.t("bluetooth.teach_room")}
                @change=${(event: Event) => {
                  this.teachRoom = (event.target as HTMLSelectElement).value;
                }}
              >
                ${settings.rooms.map(
                  (r) =>
                    html`<option value=${r.id} ?selected=${r.id === room}>
                      ${this.roomLabel(r)}
                    </option>`,
                )}
              </select>
              <button
                class="action"
                data-testid="teach-start"
                ?disabled=${this.teaching !== undefined || !device || !room}
                @click=${() => {
                  if (device && room) void this.teach(device, room);
                }}
              >
                ${t.t("bluetooth.teach_start")}
              </button>
            </div>`
      }
      ${
        this.teaching !== undefined && this.teachingRoom
          ? html`<p data-testid="teach-status">
              ${t.t("bluetooth.teach_listening", {
                room: this.roomName(this.teachingRoom),
                seconds: this.teaching,
              })}
            </p>`
          : nothing
      }
      ${this.taught ? html`<p role="status" data-testid="teach-done">${this.taught}</p>` : nothing}`;
  }

  private renderLearned(settings: LocatingSettings, draft: Draft): TemplateResult {
    const t = this.t;
    const rooms = Object.keys(settings.learned);
    return html`<label class="row">
        <input
          type="checkbox"
          data-testid="bluetooth-learn"
          .checked=${draft.learn}
          @change=${(event: Event) => {
            this.draft = { ...draft, learn: (event.target as HTMLInputElement).checked };
          }}
        />
        ${t.t("bluetooth.learn")}
      </label>
      <h3>${t.t("bluetooth.learned")}</h3>
      ${
        rooms.length === 0
          ? html`<p class="hint" data-testid="learned">${t.t("bluetooth.learned_none")}</p>`
          : html`<div class="row">
              <span class="grow" data-testid="learned"
                >${rooms.map((room) => this.roomName(room)).join(", ")}</span
              >
              <button
                class="action quiet"
                data-testid="bluetooth-forget"
                @click=${() => {
                  void this.forget();
                }}
              >
                ${t.t("bluetooth.forget")}
              </button>
            </div>`
      }`;
  }
}

define("domotwin-bluetooth-settings", DomoTwinBluetoothSettings);
