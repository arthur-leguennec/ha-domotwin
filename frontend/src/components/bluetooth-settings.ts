/**
 * `<domotwin-bluetooth-settings>`: DomoTwin's own Bluetooth locating (D-035), for administrators.
 * The receivers and where they are, the devices followed (a phone, a watch, a tag: its name, its
 * kind, whose it is) and where each is now, the devices that may be followed, a room taught by
 * holding a device in it, what was learned, and how well the rooms are found (M41), Bermuda's
 * figures beside. Loaded when first opened.
 */
import { mdiClose, mdiDeleteOutline } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { iphoneEn, iphoneFr } from "../i18n/iphone";
import { measuredEn, measuredFr } from "../i18n/measured";
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
import {
  MEASURED_ROWS,
  measuredCells,
  measureTable,
  percent,
  type LocatingMeasure,
  type MeasuredFigures,
  type MeasuredRow,
} from "../live/measured";
import { timeStyle } from "../live/schedules";
import { define, fire } from "./define";
import { icon } from "./icon";
import { copyText } from "./save";
import { baseStyles } from "./styles";

addMessages({ en: measuredEn, fr: measuredFr });
addMessages({ en: iphoneEn, fr: iphoneFr });

/** The guide's part on an iPhone's identity key (`docs/bluetooth.md`). */
const KEY_GUIDE =
  "https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/bluetooth.md#an-iphones-identity-key";

/** The choice of a receiver placed at a piece, in its room list. */
const PIECE = "@piece";
/** How long a room is taught (seconds). */
const TEACH_SECONDS = 30;
// As the integration has them: the devices followed, an identity key as written, at most.
const MAX_DEVICES = 30;
const MAX_KEY_TEXT = 80;
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
    measure: { state: true },
    measureCopied: { state: true },
    measureResetAsk: { state: true },
    measureText: { state: true },
    keyBusy: { state: true },
    keyStatus: { state: true },
    keyError: { state: true },
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
      .hint a {
        color: var(--primary-color, #03a9f4);
      }
      /* Hidden as a password is, without a password field password managers offer to keep. */
      input.irk {
        -webkit-text-security: disc;
      }
      table.measured {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      table.measured caption {
        text-align: start;
        font-weight: 600;
        padding: 10px 0 4px;
      }
      table.measured th,
      table.measured td {
        padding: 3px 8px 3px 0;
        text-align: start;
        font-size: 0.875rem;
      }
      /* The first row sets the columns (fixed layout): the labels' the same on every device. */
      table.measured thead td {
        width: 44%;
      }
      table.measured th[scope="row"] {
        font-weight: normal;
        color: var(--secondary-text-color, #5f6368);
      }
      table.measured th[scope="col"] {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--secondary-text-color, #5f6368);
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
  /** How well the rooms are found (M41); undefined until read. */
  protected measure?: LocatingMeasure;
  /** The measurements' table copied, or shown to copy by hand (`measureText`). */
  protected measureCopied?: "done" | "manual";
  protected measureText = "";
  /** Starting the measurements again is being asked. */
  protected measureResetAsk = false;
  /** The measurements asked last: an answer to an earlier question is old. */
  private measureAsked = 0;
  /** An identity key being handed to Private BLE Device (D-074), and what came of it. */
  protected keyBusy = false;
  protected keyStatus?: string;
  protected keyError?: string;

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

  protected override firstUpdated(): void {
    void this.loadMeasure();
  }

  /** Reads the measurements; `asked` by a tap, a failure is said. */
  private async loadMeasure(asked = false): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const question = ++this.measureAsked;
    try {
      const measure = await DomoTwinClient.for(hass).getLocatingMeasure();
      if (question === this.measureAsked) {
        this.measure = measure;
        this.measureCopied = undefined;
      }
    } catch (error) {
      // When the dialog opens, an integration before M41 measures nothing: the section is left out.
      if (asked && question === this.measureAsked) {
        this.error = this.t.t("measured.refresh_failed", { reason: this.reason(error) });
      }
    }
  }

  private async resetMeasure(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    // A reading asked before is older than the start again.
    this.measureAsked += 1;
    this.measureResetAsk = false;
    try {
      const since = await DomoTwinClient.for(hass).resetLocatingMeasure();
      this.measure = { since, devices: {} };
      this.measureCopied = undefined;
    } catch (error) {
      this.error = this.t.t("bluetooth.error", { reason: this.reason(error) });
    }
  }

  private async copyMeasure(): Promise<void> {
    const measure = this.measure;
    if (!measure) return;
    this.measureText = measureTable(measure, (key, params) => this.t.t(key, params));
    // Some companion apps refuse the clipboard: the table is then selected to copy by hand.
    await copyText(
      this.measureText,
      this,
      (copied) => (this.measureCopied = copied),
      "textarea.measure",
    );
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

  /** A moment as Home Assistant's user reads it: their time zone, 12 or 24 hours. */
  private when(at: string): string {
    const moment = new Date(at);
    if (Number.isNaN(moment.getTime())) return at;
    const { language, timeZone, hour12 } = this.hass
      ? timeStyle(this.hass)
      : { language: this.t.language, timeZone: undefined, hour12: undefined };
    return new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
      hour12,
    }).format(moment);
  }

  private entityName(id: string): string {
    const name = this.hass?.states[id]?.attributes.friendly_name;
    return typeof name === "string" && name ? name : id;
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

  /**
   * Hands the identity key typed to Home Assistant's Private BLE Device (D-074), then follows the
   * device it now knows. The key is cleared from the field and never shown again.
   */
  private async addKey(): Promise<void> {
    const hass = this.hass;
    const field = this.renderRoot.querySelector<HTMLInputElement>("input.irk");
    const key = field?.value.trim() ?? "";
    // Not while a save is on its way: the device would join a draft already sent.
    if (!hass || !field || !key || this.keyBusy || this.busy) return;
    const t = this.t;
    this.keyStatus = undefined;
    this.keyError = undefined;
    // Full: the key is not handed to Home Assistant for a device that could not be followed.
    if (Object.keys(this.draft?.devices ?? {}).length >= MAX_DEVICES) {
      this.keyError = t.t("iphone.full", { count: MAX_DEVICES });
      return;
    }
    this.keyBusy = true;
    try {
      const { entry, title, named, added } = await DomoTwinClient.for(hass).addLocatingKey(key);
      if (field.value.trim() === key) field.value = "";
      const match: LocatedMatch = { key: entry, title };
      const followed = Object.values(this.draft?.devices ?? {}).find((device) =>
        sameMatch(device.match, match),
      );
      if (followed) this.keyStatus = t.t("iphone.followed", { name: followed.name });
      else {
        // An entry titled by an address alone (a phone that sends no name) is "iPhone".
        const name = named ? title : t.t("iphone.unnamed");
        this.follow({ match, name });
        this.keyStatus = t.t(added ? "iphone.added" : "iphone.known", { name });
      }
    } catch (error) {
      this.keyError = this.reason(error);
    } finally {
      this.keyBusy = false;
    }
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
      ${this.renderCandidates(settings, draft)} ${this.renderTeach(settings, draft)}
      ${this.renderLearned(settings, draft)} ${this.renderMeasure(draft)}
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
          ?disabled=${this.busy || this.keyBusy || this.teaching !== undefined}
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
            ${
              (settings.bermuda ?? []).length > 0 || device.bermuda
                ? html`<select
                    data-testid="device-bermuda"
                    aria-label=${t.t("measured.bermuda")}
                    @change=${(event: Event) => {
                      const bermuda = (event.target as HTMLSelectElement).value;
                      const changed: LocatedSettings = { ...device };
                      if (bermuda) changed.bermuda = bermuda;
                      else delete changed.bermuda;
                      this.changeDevice(id, changed);
                    }}
                  >
                    <option value="" ?selected=${!device.bermuda}>
                      ${t.t("measured.bermuda_none")}
                    </option>
                    ${[
                      ...new Set([
                        ...(device.bermuda ? [device.bermuda] : []),
                        // One sensor, one device: those paired with another are not offered.
                        ...(settings.bermuda ?? []).filter(
                          (sensor) =>
                            !Object.entries(draft.devices).some(
                              ([other, followed]) => other !== id && followed.bermuda === sensor,
                            ),
                        ),
                      ]),
                    ].map(
                      (sensor) =>
                        html`<option value=${sensor} ?selected=${device.bermuda === sensor}>
                          ${t.t("measured.bermuda_sensor", { name: this.entityName(sensor) })}
                        </option>`,
                    )}
                  </select>`
                : nothing
            }
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

  private renderCandidates(settings: LocatingSettings, draft: Draft): TemplateResult {
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
      }
      ${
        // Private BLE Device listens through Home Assistant's Bluetooth: none, no key to give it.
        settings.status === "no_bluetooth" ? nothing : this.renderKey()
      }`;
  }

  /** An iPhone's or a watch's identity key, handed to Private BLE Device (M45, D-074). */
  private renderKey(): TemplateResult {
    const t = this.t;
    return html`<h4>${t.t("iphone.title")}</h4>
      <p class="hint">
        ${t.t("iphone.hint")}
        <a href=${KEY_GUIDE} target="_blank" rel="noreferrer" data-testid="iphone-guide"
          >${t.t("iphone.guide")}</a
        >
      </p>
      <div class="row">
        <input
          class="irk grow"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          maxlength=${MAX_KEY_TEXT}
          ?readonly=${this.keyBusy}
          data-testid="iphone-key"
          aria-label=${t.t("iphone.field")}
          placeholder=${t.t("iphone.placeholder")}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter") void this.addKey();
          }}
        />
        <button
          class="action"
          data-testid="iphone-add"
          ?disabled=${this.keyBusy || this.busy}
          @click=${() => {
            void this.addKey();
          }}
        >
          ${this.keyBusy ? t.t("iphone.adding") : t.t("iphone.add")}
        </button>
      </div>
      <p class="hint">${t.t("iphone.kept")}</p>
      ${
        this.keyStatus
          ? html`<p role="status" data-testid="iphone-added">${this.keyStatus}</p>`
          : nothing
      }
      ${
        this.keyError
          ? html`<p class="error" role="alert" data-testid="iphone-error">${this.keyError}</p>`
          : nothing
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

  /** How well the rooms are found (M41): for each device followed, Bermuda's beside. */
  private renderMeasure(draft: Draft): TemplateResult | typeof nothing {
    const measure = this.measure;
    if (!measure) return nothing;
    const t = this.t;
    const since = this.when(measure.since);
    const ids = Object.keys(measure.devices).sort();
    // A narrow dialog breaks "97 % (2.4 h)" before its hours only.
    const cells = (f: MeasuredFigures): Record<MeasuredRow, string> => {
      const shown = measuredCells(f);
      for (const row of MEASURED_ROWS) {
        shown[row] = shown[row].replace(/ /g, "\u00a0").replace("\u00a0(", " (");
      }
      return shown;
    };
    return html`<h3>${t.t("measured.title")}</h3>
      <p class="hint">${t.t("measured.hint", { since })}</p>
      ${
        ids.length === 0
          ? html`<p class="hint" data-testid="measured-none">${t.t("measured.none")}</p>`
          : ids.map((id) => {
              const shown = measure.devices[id];
              if (!shown) return nothing;
              const own = cells(shown.domotwin);
              const byArea = shown.domotwin_areas ? cells(shown.domotwin_areas) : undefined;
              const bermuda = shown.bermuda ? cells(shown.bermuda) : undefined;
              return html`<table class="measured" data-measured=${id}>
                <caption>
                  ${draft.devices[id]?.name ?? id}
                </caption>
                <thead>
                  <tr>
                    <td></td>
                    <th scope="col">DomoTwin</th>
                    ${byArea ? html`<th scope="col">${t.t("measured.by_area")}</th>` : nothing}
                    ${bermuda ? html`<th scope="col">Bermuda</th>` : nothing}
                  </tr>
                </thead>
                <tbody>
                  ${MEASURED_ROWS.map(
                    (row) =>
                      html`<tr data-row=${row}>
                        <th scope="row">${t.t(`measured.${row}`)}</th>
                        <td data-way="domotwin">${own[row]}</td>
                        ${byArea ? html`<td data-way="by-area">${byArea[row]}</td>` : nothing}
                        ${bermuda ? html`<td data-way="bermuda">${bermuda[row]}</td>` : nothing}
                      </tr>`,
                  )}
                  ${
                    bermuda
                      ? html`<tr data-row="agreement">
                          <th scope="row">${t.t("measured.agreement")}</th>
                          <td></td>
                          <td colspan="2" data-way="agreement">${percent(shown.agreement)}</td>
                        </tr>`
                      : nothing
                  }
                </tbody>
              </table>`;
            })
      }
      ${
        this.measureResetAsk
          ? html`<div class="row" role="group" aria-labelledby="measured-reset-ask">
              <span class="grow" id="measured-reset-ask"
                >${t.t("measured.reset_ask", { since })}</span
              >
              <button
                class="action quiet"
                data-testid="measured-reset-keep"
                @click=${() => (this.measureResetAsk = false)}
              >
                ${t.t("measured.reset_keep")}
              </button>
              <button
                class="action"
                data-testid="measured-reset-confirm"
                @click=${() => {
                  void this.resetMeasure();
                }}
              >
                ${t.t("measured.reset")}
              </button>
            </div>`
          : html`<div class="row">
              <button
                class="action quiet"
                data-testid="measured-refresh"
                @click=${() => {
                  void this.loadMeasure(true);
                }}
              >
                ${t.t("measured.refresh")}
              </button>
              <button
                class="action quiet"
                data-testid="measured-copy"
                ?disabled=${ids.length === 0}
                @click=${() => {
                  void this.copyMeasure();
                }}
              >
                ${t.t("measured.copy")}
              </button>
              <button
                class="action quiet"
                data-testid="measured-reset"
                ?disabled=${ids.length === 0}
                @click=${() => (this.measureResetAsk = true)}
              >
                ${t.t("measured.reset")}
              </button>
            </div>`
      }
      ${
        this.measureCopied === "done"
          ? html`<p role="status" data-testid="measured-copied">${t.t("measured.copied")}</p>`
          : nothing
      }
      ${
        this.measureCopied === "manual"
          ? html`<textarea
              class="measure"
              readonly
              rows="5"
              aria-label=${t.t("measured.copy")}
              .value=${this.measureText}
            ></textarea>`
          : nothing
      }`;
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
