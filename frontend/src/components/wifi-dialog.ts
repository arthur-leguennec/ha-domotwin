/**
 * `<domotwin-wifi>`, the Wi-Fi for guests (D-060): the QR code a phone's camera joins the home's
 * network with, drawn in the page by the analysis module (or the router's own code, an image
 * entity, shown as it is), the network's name and, on demand, its password; and, for an
 * administrator, the form that gives it. Loaded the first time it opens.
 */
import { mdiClose, mdiEye, mdiEyeOff } from "@mdi/js";
import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";

import { wifiQrCode, type QrCode } from "../analysis/analysis";
import { DomoTwinClient } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { wifiEn, wifiFr } from "../i18n/wifi";
import { entityName } from "../live/bindings";
import {
  SCREEN_NAME,
  WIFI_SECURITIES,
  nameProblem,
  passwordProblem,
  screensOf,
  withoutPassword,
  type Wifi,
  type WifiChange,
  type WifiSecurity,
} from "../live/wifi";
import { define, fire } from "./define";
import { focusDialog } from "./dialog";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: wifiEn, fr: wifiFr });

/** The integration's reasons for refusing a network, said in the user's language. */
const WIFI_ERRORS = ["no_name", "long_name", "bad_wpa", "bad_wep"] as const;

/** The modules of quiet border a reader needs around a QR code. */
const QUIET = 4;

/** What the form holds while it is changed. */
interface Draft {
  source: "typed" | "image";
  name: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
  image: string;
  screens: string;
}

export class DomoTwinWifi extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    wifi: { attribute: false },
    screen: { attribute: false },
    editable: { type: Boolean },
    full: { state: true },
    code: { state: true },
    failed: { state: true },
    unreachable: { state: true },
    revealed: { state: true },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  /** The network as the view keeps it: without its password. */
  wifi?: Wifi;
  /** The card's screen, for which the network is asked. */
  screen = "";
  /** An administrator's: the network can be given, changed and forgotten. */
  editable = false;
  /** The network with its password, asked for when the dialog opens and each time it changes. */
  protected full?: Wifi;
  /** The code drawn, `null` when the network does not fit in one. */
  protected code?: QrCode | null;
  /** The analysis module could not be fetched: the code cannot be drawn. */
  protected failed = false;
  /** The network could not be asked for. */
  protected unreachable = false;
  protected revealed = false;
  protected draft?: Draft;
  protected busy = false;
  protected error?: string;
  /** What the code was drawn for, not to draw it again for the same network. */
  private drawn = "";
  /** The last network asked for, its answer kept only if no other was asked for since. */
  private asked = 0;
  /** The network this dialog saved, as it told the view: its password is already here. */
  private told?: Wifi;

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
        width: min(420px, calc(100% - 32px));
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
      .code {
        justify-self: center;
        width: min(280px, 100%);
        aspect-ratio: 1;
        /* A reader needs dark modules on light, whatever the look. */
        background: #fff;
        border-radius: 8px;
      }
      .code svg,
      .code img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: 8px;
      }
      dl {
        margin: 0;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 4px 12px;
        align-items: center;
      }
      dt {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      dd {
        margin: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      dd.span {
        grid-column: 2 / 4;
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
      .secret {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .secret input {
        flex: 1;
      }
      input[type="text"],
      input[type="password"],
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

  /** Home Assistant's states change all the time: only the router's picture follows them. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size === 1 && changed.has("hass")) return this.wifi?.image !== undefined;
    return true;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Nothing given yet: an administrator gives it straight away.
    if (changed.has("wifi") && this.editable && this.wifi && !this.wifi.set && !this.draft) {
      this.draft = this.draftOf(this.wifi);
    }
    if (changed.has("wifi") && this.wifi !== this.told) void this.askFull();
    void this.drawCode();
  }

  protected override updated(changed: PropertyValues): void {
    // From the form to the code and back: the focus stays in the dialog.
    if (
      changed.has("draft") &&
      (changed.get("draft") !== undefined) !== (this.draft !== undefined)
    ) {
      void focusDialog(this);
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** The network with its password, which only an open dialog asks for (D-060). */
  private async askFull(): Promise<void> {
    const wifi = this.wifi;
    const hass = this.hass;
    const asked = ++this.asked;
    if (!hass || !wifi?.shown || wifi.image !== undefined) {
      this.full = undefined;
      return;
    }
    try {
      const full = await DomoTwinClient.for(hass).getWifi(this.screen, true);
      if (asked === this.asked) {
        this.full = full;
        this.unreachable = false;
      }
    } catch {
      if (asked === this.asked) this.unreachable = true;
    }
  }

  /** Draws the network's code once the analysis module is there (the first time it opens). */
  private async drawCode(): Promise<void> {
    const wifi = this.full;
    if (!wifi?.shown || wifi.image !== undefined || wifi.name === undefined) return;
    const key = JSON.stringify([wifi.name, wifi.password, wifi.security, wifi.hidden]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.failed = false;
    try {
      const code = await wifiQrCode(
        wifi.name,
        wifi.password ?? "",
        wifi.security ?? "WPA",
        wifi.hidden === true,
      );
      if (key === this.drawn) this.code = code ?? null;
    } catch {
      // The module could not be fetched: tried again when the dialog opens next (not on each
      // update, which would fetch it over and over).
      if (key === this.drawn) this.failed = true;
    }
  }

  private draftOf(wifi: Wifi): Draft {
    return {
      source: wifi.image !== undefined ? "image" : "typed",
      name: wifi.name ?? "",
      password: "",
      security: wifi.security ?? "WPA",
      hidden: wifi.hidden === true,
      image: wifi.image ?? "",
      screens: (wifi.screens ?? []).join(", "),
    };
  }

  private async save(draft: Draft): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return;
    const screens = screensOf(draft.screens);
    const wrong = screens.find((screen) => !SCREEN_NAME.test(screen));
    if (wrong !== undefined) {
      this.error = t.t("wifi.form.bad_screen", { name: wrong });
      return;
    }
    const change: WifiChange = {
      security: draft.security,
      hidden: draft.hidden,
      screens,
    };
    if (draft.source === "image") {
      // The router's code says itself how to join: nothing typed is kept with it.
      change.image = draft.image;
      change.hidden = false;
    } else {
      const wrong = nameProblem(draft.name);
      if (wrong) {
        this.error = t.t(`wifi.errors.${wrong}`);
        return;
      }
      change.name = draft.name;
      // Left empty, the same network's password is kept; a new one is checked here first.
      if (draft.password !== "" || draft.security === "nopass") change.password = draft.password;
      const problem =
        draft.password !== "" ? passwordProblem(draft.security, draft.password) : undefined;
      if (problem) {
        this.error = t.t(`wifi.errors.${problem}`);
        return;
      }
    }
    this.busy = true;
    this.error = undefined;
    try {
      const wifi = await DomoTwinClient.for(hass).saveWifi(change);
      this.draft = undefined;
      this.revealed = false;
      // Its answer is the network with its password: drawn here; the view (and whatever listens
      // above it) is told it without.
      this.asked += 1;
      this.full = wifi;
      this.unreachable = false;
      this.told = withoutPassword(wifi);
      fire(this, "domotwin-wifi-changed", this.told);
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  private async forget(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    this.error = undefined;
    try {
      const wifi = await DomoTwinClient.for(hass).clearWifi();
      fire(this, "domotwin-wifi-changed", wifi);
      this.close();
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  private reason(error: unknown): string {
    const t = this.t;
    if (!t) return "";
    if (!isHassError(error)) return t.error("unknown");
    const code = WIFI_ERRORS.find((known) => known === error.code);
    if (code) return t.t(`wifi.errors.${code}`);
    if (error.code === "invalid") {
      return t.t("wifi.errors.invalid", { reason: error.message });
    }
    return t.error(error.code);
  }

  /** The code as squares on white, a quiet border around it. */
  private renderCode(code: QrCode): TemplateResult {
    const side = code.size + 2 * QUIET;
    let path = "";
    for (let y = 0; y < code.size; y += 1) {
      for (let x = 0; x < code.size; x += 1) {
        if (code.dark(x, y)) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return html`${svg`<svg
      viewBox="0 0 ${side} ${side}"
      shape-rendering="crispEdges"
      role="img"
      aria-label=${this.t?.t("wifi.scan") ?? ""}
      data-testid="wifi-code"
    ><rect width=${side} height=${side} fill="#fff"></rect><path d=${path} fill="#000"></path></svg>`}`;
  }

  private renderShown(wifi: Wifi, t: Translator, hass: HomeAssistant): TemplateResult {
    let picture: TemplateResult | typeof nothing = nothing;
    if (wifi.image !== undefined) {
      const src = hass.states[wifi.image]?.attributes.entity_picture;
      picture =
        typeof src === "string"
          ? html`<div class="code">
              <img src=${src} alt=${t.t("wifi.router")} data-testid="wifi-image" />
            </div>`
          : html`<p class="error" role="alert">${t.t("wifi.unreadable")}</p>`;
    } else if (this.failed || this.unreachable) {
      picture = html`<p class="error" role="alert">${t.t("wifi.unreadable")}</p>`;
    } else if (this.code === null) {
      picture = html`<p class="error" role="alert">${t.t("wifi.too_long")}</p>`;
    } else if (this.code) {
      picture = html`<div class="code">${this.renderCode(this.code)}</div>`;
    }
    const password = this.full?.password;
    const secret = password !== undefined && wifi.security !== "nopass";
    const typed = wifi.image === undefined;
    return html`${picture}
      <p class="hint">${t.t("wifi.scan")}</p>
      ${
        wifi.name !== undefined
          ? html`<dl>
              <dt>${t.t("wifi.network")}</dt>
              <dd class="span" data-testid="wifi-name">${wifi.name}</dd>
              ${
                secret
                  ? html`<dt>${t.t("wifi.password")}</dt>
                      <dd data-testid="wifi-password">${this.revealed ? password : "••••••••"}</dd>
                      <button
                        class="round"
                        data-testid="wifi-reveal"
                        aria-pressed=${this.revealed ? "true" : "false"}
                        title=${t.t(this.revealed ? "wifi.hide_password" : "wifi.show_password")}
                        aria-label=${t.t(this.revealed ? "wifi.hide_password" : "wifi.show_password")}
                        @click=${() => {
                          this.revealed = !this.revealed;
                        }}
                      >
                        ${icon(this.revealed ? mdiEyeOff : mdiEye)}
                      </button>`
                  : nothing
              }
            </dl>`
          : nothing
      }
      ${typed && wifi.security === "nopass" ? html`<p class="hint">${t.t("wifi.open")}</p>` : nothing}
      ${typed && wifi.hidden === true ? html`<p class="hint">${t.t("wifi.hidden_note")}</p>` : nothing}`;
  }

  private renderForm(draft: Draft, t: Translator, hass: HomeAssistant): TemplateResult {
    const wifi = this.wifi;
    // Onto the draft as it is now: two fields filled at once (autofill) both kept.
    const set = (change: Partial<Draft>): void => {
      this.draft = { ...(this.draft ?? draft), ...change };
    };
    const images = Object.keys(hass.states)
      .filter((id) => id.startsWith("image."))
      .sort();
    // As the integration keeps it: the same network's (its name and kind).
    const full = this.full;
    const kept =
      full?.password !== undefined && full.name === draft.name && full.security === draft.security;
    return html`<p class="hint">${t.t("wifi.form.privacy")}</p>
      <fieldset>
        <legend>${t.t("wifi.form.source")}</legend>
        ${(["typed", "image"] as const).map(
          (source) =>
            html`<label class="row">
              <input
                type="radio"
                name="source"
                data-testid=${`wifi-source-${source}`}
                .checked=${draft.source === source}
                @change=${() => {
                  set({ source });
                }}
              />
              ${t.t(`wifi.form.${source}`)}
            </label>`,
        )}
      </fieldset>
      ${
        draft.source === "image"
          ? images.length === 0
            ? html`<p class="hint">${t.t("wifi.form.image_none")}</p>`
            : html`<label class="field">
                ${t.t("wifi.form.image_entity")}
                <select
                  data-testid="wifi-image-entity"
                  @change=${(event: Event) => {
                    set({ image: (event.target as HTMLSelectElement).value });
                  }}
                >
                  <option value="" ?selected=${draft.image === ""}></option>
                  ${images.map(
                    (id) =>
                      html`<option value=${id} ?selected=${draft.image === id}>
                        ${entityName(hass, id)}
                      </option>`,
                  )}
                </select>
              </label>`
          : html`<label class="field">
                ${t.t("wifi.form.name")}
                <input
                  type="text"
                  data-testid="wifi-name-input"
                  data-autofocus
                  autocomplete="off"
                  spellcheck="false"
                  .value=${draft.name}
                  @input=${(event: Event) => {
                    set({ name: (event.target as HTMLInputElement).value });
                  }}
                />
              </label>
              <label class="field">
                ${t.t("wifi.form.security")}
                <select
                  data-testid="wifi-security"
                  @change=${(event: Event) => {
                    const value = (event.target as HTMLSelectElement).value;
                    const security = WIFI_SECURITIES.find((s) => s === value);
                    if (security) set({ security });
                  }}
                >
                  ${WIFI_SECURITIES.map(
                    (security) =>
                      html`<option value=${security} ?selected=${draft.security === security}>
                        ${t.t(`wifi.form.security_${security}`)}
                      </option>`,
                  )}
                </select>
              </label>
              ${
                draft.security === "nopass"
                  ? nothing
                  : html`<label class="field">
                      ${t.t("wifi.form.password")}
                      <span class="secret">
                        <input
                          type=${this.revealed ? "text" : "password"}
                          data-testid="wifi-password-input"
                          autocomplete="new-password"
                          spellcheck="false"
                          placeholder=${kept ? t.t("wifi.form.password_kept") : ""}
                          .value=${draft.password}
                          @input=${(event: Event) => {
                            set({ password: (event.target as HTMLInputElement).value });
                          }}
                        />
                        <button
                          type="button"
                          class="round"
                          aria-pressed=${this.revealed ? "true" : "false"}
                          title=${t.t(this.revealed ? "wifi.hide_password" : "wifi.show_password")}
                          aria-label=${t.t(
                            this.revealed ? "wifi.hide_password" : "wifi.show_password",
                          )}
                          @click=${() => {
                            this.revealed = !this.revealed;
                          }}
                        >
                          ${icon(this.revealed ? mdiEyeOff : mdiEye)}
                        </button>
                      </span>
                    </label>`
              }
              <label class="row">
                <input
                  type="checkbox"
                  data-testid="wifi-hidden"
                  .checked=${draft.hidden}
                  @change=${(event: Event) => {
                    set({ hidden: (event.target as HTMLInputElement).checked });
                  }}
                />
                ${t.t("wifi.form.hidden")}
              </label>`
      }
      <label class="field">
        ${t.t("wifi.form.screens")}
        <input
          type="text"
          data-testid="wifi-screens"
          autocomplete="off"
          spellcheck="false"
          .value=${draft.screens}
          @input=${(event: Event) => {
            set({ screens: (event.target as HTMLInputElement).value });
          }}
        />
        <small class="hint">${t.t("wifi.form.screens_hint")}</small>
      </label>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <div class="footer">
        ${
          wifi?.set
            ? html`<button
                class="action quiet"
                data-testid="wifi-forget"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.forget();
                }}
              >
                ${t.t("wifi.form.forget")}
              </button>`
            : nothing
        }
        <button
          class="action quiet"
          @click=${() => {
            this.error = undefined;
            this.revealed = false;
            if (wifi?.set) this.draft = undefined;
            else this.close();
          }}
        >
          ${t.t("wifi.form.cancel")}
        </button>
        <button
          class="action"
          data-testid="wifi-save"
          ?disabled=${this.busy || (draft.source === "image" && draft.image === "")}
          @click=${() => {
            void this.save(draft);
          }}
        >
          ${t.t("wifi.form.save")}
        </button>
      </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    const wifi = this.wifi;
    if (!hass || !t || !wifi) return nothing;
    const draft = this.draft;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="wifi-title"
      data-testid="wifi-dialog"
    >
      <header>
        <h2 id="wifi-title">${t.t(draft ? "wifi.form.title" : "wifi.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("wifi.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${
        draft
          ? this.renderForm(draft, t, hass)
          : wifi.shown
            ? this.renderShown(wifi, t, hass)
            : html`<p class="hint">${t.t("wifi.none")}</p>`
      }
      ${
        !draft && this.editable
          ? html`<div class="footer">
              <button
                class="action"
                data-testid="wifi-change"
                data-autofocus
                @click=${() => {
                  this.revealed = false;
                  this.draft = this.draftOf(wifi);
                }}
              >
                ${t.t("wifi.change")}
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-wifi", DomoTwinWifi);
