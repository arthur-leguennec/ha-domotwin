/**
 * `<domotwin-guests>`, guest access (D-067), for administrators: the passes, each with its link
 * and the link's QR code (drawn by the analysis module), and the form that makes or changes one:
 * who it is for, from and until when, the rooms it opens, the devices it gives, whether the guests
 * may use them, whether the home's Wi-Fi is shown and whether it opens from anywhere. Loaded the
 * first time it opens.
 */
import { mdiArrowLeft, mdiClose, mdiContentCopy, mdiPlus, mdiShareVariant } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { textQrCode, type QrCode } from "../analysis/analysis";
import type { HomeStorey } from "../engine/engine";
import { DomoTwinClient } from "../ha/client";
import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { guestsEn, guestsFr } from "../i18n/guests";
import { entityName, type BindingsJson } from "../live/bindings";
import {
  MAX_GUEST_ENTITIES,
  fromInput,
  givable,
  givenByDefault,
  localInput,
  newPassTimes,
  passLink,
  roomDevices,
  type GuestPass,
  type GuestPassChange,
  type PassRoom,
} from "../live/guests";
import { planRooms } from "../live/suggest";
import { define, fire } from "./define";
import { focusDialog } from "./dialog";
import { icon, mirroredIcon } from "./icon";
import { qrSvg } from "./qr";
import { baseStyles } from "./styles";

addMessages({ en: guestsEn, fr: guestsFr });

/** The integration's reasons for refusing a pass, said in the user's language. */
const PASS_ERRORS = [
  "ends_before",
  "already_ended",
  "too_long",
  "too_far",
  "unknown_room",
  "not_for_guests",
  "nothing_open",
  "too_many",
  "unknown_pass",
] as const;

const NO_BINDINGS: BindingsJson = { version: 1, rooms: {}, elements: {} };

/** What the form holds while it is changed. */
interface Draft {
  id?: string;
  name: string;
  /** `datetime-local` values, in this device's time. */
  starts: string;
  ends: string;
  rooms: string[];
  /** The devices ticked, those of the rooms chosen and others added. */
  entities: string[];
  act: boolean;
  wifi: boolean;
  anywhere: boolean;
  /** The device being added by its id. */
  extra: string;
}

export class DomoTwinGuests extends LitElement {
  static override properties = {
    hass: { attribute: false },
    storeys: { attribute: false },
    bindings: { attribute: false },
    wifiSet: { type: Boolean },
    passes: { state: true },
    shown: { state: true },
    draft: { state: true },
    code: { state: true },
    busy: { state: true },
    error: { state: true },
    said: { state: true },
  };

  hass?: HomeAssistant;
  /** Every storey's plan and overlay: their rooms, and what is in them. */
  storeys: HomeStorey[] = [];
  bindings?: BindingsJson;
  /** Whether the home's Wi-Fi is given (D-060): a pass can show it. */
  wifiSet = false;
  /** The passes, once read. */
  protected passes?: GuestPass[];
  /** The pass whose link is shown. */
  protected shown?: string;
  protected draft?: Draft;
  /** The shown pass's QR code, `null` when its link does not fit in one. */
  protected code?: QrCode | null;
  protected busy = false;
  protected error?: string;
  /** What was just done (copied, renewed). */
  protected said?: string;
  /** What the code was drawn for. */
  private drawn = "";

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 5;
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
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      p {
        margin: 0;
      }
      p.hint {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.error {
        color: var(--error-color, #d23a2f);
      }
      ul.passes {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 4px;
      }
      ul.passes button {
        width: 100%;
        display: grid;
        gap: 2px;
        text-align: start;
        padding: 8px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      ul.passes button.ended {
        opacity: 0.65;
      }
      .name {
        font-weight: 600;
      }
      .meta {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .code {
        justify-self: center;
        width: min(260px, 100%);
        aspect-ratio: 1;
        /* A reader needs dark modules on light, whatever the look. */
        background: #fff;
        border-radius: 8px;
      }
      .code svg {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 8px;
      }
      .link {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      /* Their room in the row, whatever their contents' width. */
      .link input,
      .link select {
        flex: 1;
        width: 0;
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
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
        padding: 0;
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        display: grid;
        gap: 6px;
      }
      legend {
        padding: 0;
        margin-bottom: 4px;
        font-weight: 600;
      }
      label.field {
        display: grid;
        gap: 4px;
      }
      label.row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .storey {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      /* Side by side where they fit, one above the other on a phone. */
      .times {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
        gap: 8px;
      }
      .devices {
        display: grid;
        gap: 4px;
        padding-inline-start: 12px;
      }
      input[type="text"],
      input[type="datetime-local"],
      select {
        font: inherit;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        background: var(--card-background-color, #fff);
        color: inherit;
        min-width: 0;
      }
    `,
  ];

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  /** Home Assistant's states change all the time: only the form follows them (its names). */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size === 1 && changed.has("hass")) return this.draft !== undefined;
    return true;
  }

  protected override willUpdate(): void {
    void this.drawCode();
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("draft") || changed.has("shown")) void focusDialog(this);
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private async load(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      this.passes = await DomoTwinClient.for(hass).getGuests();
      this.error = undefined;
    } catch (error) {
      this.error = this.reason(error);
    }
  }

  /** The shown pass's link drawn, once the analysis module is there. */
  private async drawCode(): Promise<void> {
    const pass = this.passes?.find((p) => p.id === this.shown);
    if (!pass) return;
    const link = passLink(pass, location.origin);
    if (link === this.drawn) return;
    this.drawn = link;
    this.code = undefined;
    try {
      const code = await textQrCode(link);
      if (link === this.drawn) this.code = code ?? null;
    } catch {
      if (link === this.drawn) {
        this.drawn = "";
        this.error = this.t.t("guests.unreadable");
      }
    }
  }

  /** The rooms of every storey, with their storey's name when there are several. */
  private rooms(): PassRoom[] {
    const several = this.storeys.length > 1;
    return this.storeys.flatMap((storey) =>
      planRooms(storey.plan).map((room) =>
        several ? { ...room, storey: storey.name || undefined } : room,
      ),
    );
  }

  private devices(hass: HomeAssistant): Map<string, string[]> {
    return roomDevices(hass, this.bindings ?? NO_BINDINGS, this.storeys, this.rooms());
  }

  private newDraft(): Draft {
    const times = newPassTimes(nowOf(this.hass));
    return {
      name: "",
      ...times,
      rooms: [],
      entities: [],
      act: true,
      wifi: this.wifiSet,
      anywhere: false,
      extra: "",
    };
  }

  /** A pass's rooms still in the plan: one removed since cannot be chosen again, nor kept. */
  private roomsOf(pass: GuestPass): string[] {
    const known = new Set(this.rooms().map((room) => room.id));
    return pass.rooms.filter((room) => known.has(room));
  }

  private draftOf(pass: GuestPass): Draft {
    return {
      id: pass.id,
      name: pass.name,
      starts: localInput(new Date(pass.starts)),
      ends: localInput(new Date(pass.ends)),
      rooms: this.roomsOf(pass),
      entities: [...pass.entities],
      act: pass.act,
      wifi: pass.wifi,
      anywhere: pass.anywhere,
      extra: "",
    };
  }

  /** A room chosen or left: its devices ticked as they are given by default, or unticked. */
  private chooseRoom(draft: Draft, room: string, chosen: boolean, hass: HomeAssistant): Draft {
    const devices = this.devices(hass);
    const rooms = chosen ? [...draft.rooms, room] : draft.rooms.filter((r) => r !== room);
    const kept = new Set(rooms.flatMap((r) => devices.get(r) ?? []));
    let entities: string[];
    if (chosen) {
      const added = (devices.get(room) ?? []).filter(
        (id) => !draft.entities.includes(id) && givenByDefault(hass, id),
      );
      entities = [...draft.entities, ...added];
    } else {
      // Its devices go, unless another room chosen has them too.
      const own = new Set(devices.get(room) ?? []);
      entities = draft.entities.filter((id) => !own.has(id) || kept.has(id));
    }
    return { ...draft, rooms, entities };
  }

  private async save(draft: Draft): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const t = this.t;
    const name = draft.name.trim();
    if (!name) {
      this.error = t.t("guests.errors.no_name");
      return;
    }
    const starts = fromInput(draft.starts);
    const ends = fromInput(draft.ends);
    if (!starts || !ends) {
      this.error = t.t("guests.errors.ends_before");
      return;
    }
    if (draft.entities.length > MAX_GUEST_ENTITIES) {
      this.error = t.t("guests.errors.too_many_devices", { count: MAX_GUEST_ENTITIES });
      return;
    }
    const change: GuestPassChange = {
      name,
      rooms: draft.rooms,
      entities: draft.entities,
      starts,
      ends,
      act: draft.act,
      wifi: draft.wifi,
      anywhere: draft.anywhere,
    };
    if (draft.id) change.id = draft.id;
    await this.store(change);
  }

  /** Saves a pass (a new link with `renew`), then shows it. */
  private async store(change: GuestPassChange, said?: string): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    this.error = undefined;
    try {
      const saved = await DomoTwinClient.for(hass).saveGuest(change);
      const passes = this.passes ?? [];
      this.passes = passes.some((p) => p.id === saved.id)
        ? passes.map((p) => (p.id === saved.id ? saved : p))
        : [...passes, saved];
      this.draft = undefined;
      this.shown = saved.id;
      this.said = said;
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  private async renew(pass: GuestPass): Promise<void> {
    const { id, name, entities, starts, ends, act, wifi, anywhere } = pass;
    const rooms = this.roomsOf(pass);
    await this.store(
      { id, name, rooms, entities, starts, ends, act, wifi, anywhere, renew: true },
      this.t.t("guests.renewed"),
    );
  }

  private async removePass(pass: GuestPass): Promise<void> {
    const hass = this.hass;
    if (!hass || !confirm(this.t.t("guests.remove_confirm", { name: pass.name }))) return;
    this.busy = true;
    this.error = undefined;
    try {
      await DomoTwinClient.for(hass).removeGuest(pass.id);
      this.passes = (this.passes ?? []).filter((p) => p.id !== pass.id);
      this.shown = undefined;
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  private async copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.said = this.t.t("guests.copied");
    } catch {
      // No clipboard here (a page served over HTTP): the link stays selected to copy by hand.
      this.renderRoot.querySelector<HTMLInputElement>("[data-testid=guest-link]")?.select();
    }
  }

  private reason(error: unknown): string {
    const t = this.t;
    if (!isHassError(error)) return t.error("unknown");
    const code = PASS_ERRORS.find((known) => known === error.code);
    if (code) return t.t(`guests.errors.${code}`);
    if (error.code === "invalid") return t.t("guests.errors.invalid", { reason: error.message });
    return t.error(error.code);
  }

  private when(iso: string): string {
    const hass = this.hass;
    const moment = new Date(iso);
    return new Intl.DateTimeFormat(hass?.locale?.language ?? hass?.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(moment);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const hass = this.hass;
    const pass = this.passes?.find((p) => p.id === this.shown);
    let title = t.t("guests.title");
    let back: (() => void) | undefined;
    let body: TemplateResult;
    if (this.draft && hass) {
      title = t.t(this.draft.id ? "guests.form.title_edit" : "guests.form.title_new");
      back = () => {
        this.draft = undefined;
        this.error = undefined;
      };
      body = this.renderForm(this.draft, t, hass);
    } else if (pass) {
      title = pass.name;
      back = () => {
        this.shown = undefined;
        this.said = undefined;
        this.error = undefined;
      };
      body = this.renderPass(pass, t);
    } else {
      body = this.renderList(t);
    }
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guests-title"
      data-testid="guests-dialog"
    >
      <header>
        ${
          back
            ? html`<button
                class="round"
                title=${t.t("guests.back")}
                aria-label=${t.t("guests.back")}
                data-testid="guests-back"
                @click=${back}
              >
                ${mirroredIcon(mdiArrowLeft)}
              </button>`
            : nothing
        }
        <h2 id="guests-title">${title}</h2>
        <button
          class="round"
          title=${t.t("guests.close")}
          aria-label=${t.t("guests.close")}
          data-cancel
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${body} ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
    </div>`;
  }

  private renderList(t: Translator): TemplateResult {
    const passes = this.passes;
    return html`<p class="hint">${t.t("guests.intro")}</p>
      ${
        passes === undefined
          ? nothing
          : passes.length === 0
            ? html`<p class="hint" data-testid="guests-none">${t.t("guests.none")}</p>`
            : html`<ul class="passes">
                ${passes.map(
                  (pass) =>
                    html`<li>
                      <button
                        class=${pass.status}
                        data-testid="guest-pass"
                        @click=${() => {
                          this.shown = pass.id;
                          this.said = undefined;
                        }}
                      >
                        <span class="name">${pass.name}</span>
                        <span class="meta">${this.summary(pass, t)}</span>
                      </button>
                    </li>`,
                )}
              </ul>`
      }
      <div class="footer">
        <button
          class="action"
          data-testid="guests-add"
          data-autofocus
          ?disabled=${this.busy || passes === undefined}
          @click=${() => {
            this.draft = this.newDraft();
            this.error = undefined;
          }}
        >
          ${icon(mdiPlus)}${t.t("guests.add")}
        </button>
      </div>`;
  }

  /** A pass in a line: when, how much it opens, how. */
  private summary(pass: GuestPass, t: Translator): string {
    const date = this.when(pass.status === "upcoming" ? pass.starts : pass.ends);
    const parts = [
      t.t(`guests.status.${pass.status}`, { date }),
      t.tp("guests.rooms_count", pass.rooms.length),
      t.tp("guests.devices_count", pass.entities.length),
    ];
    if (!pass.act) parts.push(t.t("guests.look_only"));
    parts.push(t.t(pass.anywhere ? "guests.anywhere" : "guests.home_only"));
    return parts.join(" · ");
  }

  private renderPass(pass: GuestPass, t: Translator): TemplateResult {
    const link = passLink(pass, location.origin);
    const code = this.code;
    return html`<p class="meta" data-testid="guest-summary">${this.summary(pass, t)}</p>
      ${
        pass.status === "ended"
          ? nothing
          : html`${
                code
                  ? html`<div class="code">${qrSvg(code, t.t("guests.scan"), "guest-code")}</div>`
                  : code === null
                    ? html`<p class="error" role="alert">${t.t("guests.too_long")}</p>`
                    : nothing
              }
              <p class="hint">${t.t("guests.scan")}</p>
              <label class="field">
                ${t.t("guests.link")}
                <span class="link">
                  <input
                    type="text"
                    readonly
                    data-testid="guest-link"
                    .value=${link}
                    @focus=${(event: Event) => {
                      (event.target as HTMLInputElement).select();
                    }}
                  />
                  <button
                    class="round"
                    title=${t.t("guests.copy")}
                    aria-label=${t.t("guests.copy")}
                    data-testid="guest-copy"
                    @click=${() => void this.copy(link)}
                  >
                    ${icon(mdiContentCopy)}
                  </button>
                  ${
                    "share" in navigator
                      ? html`<button
                          class="round"
                          title=${t.t("guests.share")}
                          aria-label=${t.t("guests.share")}
                          @click=${() => {
                            void navigator.share({ title: pass.name, url: link }).catch(() => {
                              // Shared or not: nothing to say.
                            });
                          }}
                        >
                          ${icon(mdiShareVariant)}
                        </button>`
                      : nothing
                  }
                </span>
              </label>`
      }
      ${this.said ? html`<p class="hint" role="status">${this.said}</p>` : nothing}
      <p class="hint">${t.t("guests.privacy")}</p>
      <div class="footer">
        <button
          class="action quiet"
          data-testid="guest-remove"
          ?disabled=${this.busy}
          @click=${() => void this.removePass(pass)}
        >
          ${t.t("guests.remove")}
        </button>
        ${
          pass.status === "ended"
            ? nothing
            : html`<button
                class="action quiet"
                data-testid="guest-renew"
                ?disabled=${this.busy}
                @click=${() => void this.renew(pass)}
              >
                ${t.t("guests.renew")}
              </button>`
        }
        <button
          class="action"
          data-testid="guest-edit"
          data-autofocus
          ?disabled=${this.busy}
          @click=${() => {
            this.draft = this.draftOf(pass);
            this.error = undefined;
          }}
        >
          ${t.t("guests.edit")}
        </button>
      </div>`;
  }

  private renderForm(draft: Draft, t: Translator, hass: HomeAssistant): TemplateResult {
    // Onto the draft as it is now: two fields filled at once (autofill) both kept.
    const set = (change: Partial<Draft>): void => {
      this.draft = { ...(this.draft ?? draft), ...change };
    };
    const rooms = this.rooms();
    const devices = this.devices(hass);
    const inRooms = new Set(draft.rooms.flatMap((room) => devices.get(room) ?? []));
    const extras = draft.entities.filter((id) => !inRooms.has(id));
    const offered = Object.keys(hass.states)
      .filter((id) => givable(id) && !draft.entities.includes(id))
      .sort((a, b) => entityName(hass, a).localeCompare(entityName(hass, b)));
    const tick = (id: string, on: boolean): void => {
      const current = this.draft ?? draft;
      set({
        entities: on
          ? [...current.entities, id]
          : current.entities.filter((entity) => entity !== id),
      });
    };
    const device = (id: string): TemplateResult =>
      html`<label class="row">
        <input
          type="checkbox"
          data-testid=${`guest-device-${id}`}
          .checked=${draft.entities.includes(id)}
          @change=${(event: Event) => {
            tick(id, (event.target as HTMLInputElement).checked);
          }}
        />
        <span>${entityName(hass, id)}</span>
      </label>`;
    return html`<p class="hint">${t.t("guests.privacy")}</p>
      <label class="field">
        ${t.t("guests.form.name")}
        <input
          type="text"
          maxlength="60"
          data-testid="guest-name"
          data-autofocus
          .value=${draft.name}
          @input=${(event: Event) => {
            set({ name: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="hint">${t.t("guests.form.name_hint")}</span>
      </label>
      <div class="times">
        <label class="field">
          ${t.t("guests.form.starts")}
          <input
            type="datetime-local"
            data-testid="guest-starts"
            .value=${draft.starts}
            @change=${(event: Event) => {
              set({ starts: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        <label class="field">
          ${t.t("guests.form.ends")}
          <input
            type="datetime-local"
            data-testid="guest-ends"
            .value=${draft.ends}
            @change=${(event: Event) => {
              set({ ends: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
      </div>
      <p class="hint">${t.t("guests.form.ends_hint")}</p>
      <fieldset>
        <legend>${t.t("guests.form.rooms")}</legend>
        <p class="hint">${t.t("guests.form.rooms_hint")}</p>
        ${rooms.map((room) => {
          const chosen = draft.rooms.includes(room.id);
          const own = devices.get(room.id) ?? [];
          return html`<label class="row">
              <input
                type="checkbox"
                data-testid=${`guest-room-${room.id}`}
                .checked=${chosen}
                @change=${(event: Event) => {
                  const on = (event.target as HTMLInputElement).checked;
                  this.draft = this.chooseRoom(this.draft ?? draft, room.id, on, hass);
                }}
              />
              <span>${room.name}</span>
              ${room.storey ? html`<span class="storey">${room.storey}</span>` : nothing}
            </label>
            ${
              chosen && own.length > 0
                ? html`<div class="devices" role="group" aria-label=${room.name}>
                    ${own.map(device)}
                  </div>`
                : nothing
            }`;
        })}
      </fieldset>
      <fieldset>
        <legend>${t.t("guests.form.devices")}</legend>
        <p class="hint">
          ${t.t(draft.rooms.length > 0 ? "guests.form.devices_hint" : "guests.form.devices_none")}
        </p>
        ${extras.length > 0 ? html`<div class="devices">${extras.map(device)}</div>` : nothing}
        <label class="field">
          ${t.t("guests.form.extra")}
          <span class="link">
            <select
              data-testid="guest-extra"
              @change=${(event: Event) => {
                set({ extra: (event.target as HTMLSelectElement).value });
              }}
            >
              <option value="" ?selected=${draft.extra === ""}></option>
              ${offered.map(
                (id) =>
                  html`<option value=${id} ?selected=${draft.extra === id}>
                    ${entityName(hass, id)}
                  </option>`,
              )}
            </select>
            <button
              class="action quiet"
              data-testid="guest-extra-add"
              ?disabled=${draft.extra === ""}
              @click=${() => {
                const current = this.draft ?? draft;
                set({ entities: [...current.entities, current.extra], extra: "" });
              }}
            >
              ${t.t("guests.form.extra_add")}
            </button>
          </span>
          <span class="hint">${t.t("guests.form.extra_hint")}</span>
        </label>
      </fieldset>
      <label class="row">
        <input
          type="checkbox"
          data-testid="guest-act"
          .checked=${draft.act}
          @change=${(event: Event) => {
            set({ act: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("guests.form.act")}</span>
      </label>
      <label class="row">
        <input
          type="checkbox"
          data-testid="guest-wifi"
          .checked=${draft.wifi && this.wifiSet}
          ?disabled=${!this.wifiSet}
          @change=${(event: Event) => {
            set({ wifi: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("guests.form.wifi")}</span>
      </label>
      ${this.wifiSet ? nothing : html`<p class="hint">${t.t("guests.form.wifi_none")}</p>`}
      <label class="row">
        <input
          type="checkbox"
          data-testid="guest-anywhere"
          .checked=${draft.anywhere}
          @change=${(event: Event) => {
            set({ anywhere: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("guests.form.anywhere")}</span>
      </label>
      <p class="hint">${t.t("guests.form.anywhere_hint")}</p>
      <p class="hint">${t.t("guests.limit")}</p>
      <div class="footer">
        <button
          class="action quiet"
          ?disabled=${this.busy}
          @click=${() => {
            this.draft = undefined;
            this.error = undefined;
          }}
        >
          ${t.t("guests.form.cancel")}
        </button>
        <button
          class="action"
          data-testid="guest-save"
          ?disabled=${this.busy}
          @click=${() => void this.save(this.draft ?? draft)}
        >
          ${t.t("guests.form.save")}
        </button>
      </div>`;
  }
}

define("domotwin-guests", DomoTwinGuests);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-guests": DomoTwinGuests;
  }
}
