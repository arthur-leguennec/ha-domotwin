/**
 * `<domotwin-voice>`: voice at hand (D-041). Why the microphone cannot listen (a page served over
 * HTTP), voice to set up when Assist cannot hear, and, in the panel's settings, DomoTwin's voice
 * blueprints to add to Home Assistant. Loaded when first opened.
 */
import { mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { isHassError, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import {
  assistAvailable,
  canListen,
  installBlueprints,
  listeningPipeline,
  openAssist,
  setUpVoice,
  voiceState,
  writeDeviceVoice,
  type BlueprintName,
  type SpeechApp,
  type VoiceState,
} from "../live/voice";
import { navigate } from "../live/actions";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** Why the dialog opened: the microphone over HTTP, Assist that cannot hear, the settings. */
export type VoiceDialogMode = "https" | "setup" | "settings";

const BLUEPRINTS: BlueprintName[] = ["show_by_voice", "where_by_voice"];
/** How often a set-up in progress is asked about (ms). */
const POLL_MS = 2000;
/** Where Home Assistant says how to serve it over HTTPS. */
const HTTPS_DOCS = "https://www.home-assistant.io/docs/configuration/remote/";

/** Why a set-up failed, as the integration says it. */
const FAILURES = ["app", "app_unavailable", "not_found", "language", "ignored", "unknown"] as const;
/** The steps of a set-up still running. */
const RUNNING: readonly string[] = ["checking", "installing", "starting", "connecting", "pipeline"];

function failure(code: string | null): (typeof FAILURES)[number] {
  return FAILURES.find((known) => known === code) ?? "unknown";
}

export class DomoTwinVoice extends LitElement {
  static override properties = {
    hass: { attribute: false },
    mode: {},
    deviceVoice: { attribute: false },
    state: { state: true },
    pipeline: { state: true },
    app: { state: true },
    busy: { state: true },
    error: { state: true },
    pollError: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 4;
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
        margin: 4px 0 0;
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
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .row span {
        flex: 1;
        min-width: 12em;
      }
      label.choice {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        align-items: start;
        margin-bottom: 10px;
        cursor: pointer;
      }
      label.choice small {
        grid-column: 2;
        color: var(--secondary-text-color, #5f6368);
      }
      ol {
        margin: 0;
        padding-inline-start: 1.4em;
        display: grid;
        gap: 6px;
      }
      code {
        font-size: 0.8rem;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--primary-color, #03a9f4);
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
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
  mode: VoiceDialogMode = "settings";
  /** Voice on this device (D-085), turned off or on in the settings. */
  deviceVoice = true;
  /** DomoTwin's side: the blueprints, the Supervisor, a set-up in progress. */
  protected state?: VoiceState;
  /** The pipeline Assist listens with; `null` when none hears. */
  protected pipeline?: string | null;
  protected app: SpeechApp = "whisper";
  protected busy = false;
  protected error?: string;
  /** Home Assistant could not be asked how the set-up goes; asked again meanwhile. */
  protected pollError?: string;
  private poll?: number;
  private started = false;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  private get admin(): boolean {
    return this.hass?.user?.is_admin === true;
  }

  /** Home Assistant's states change all the time: the dialog reads what it needs itself. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.started);
  }

  override willUpdate(): void {
    if (!this.started && this.hass) {
      this.started = true;
      void this.refresh();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this.poll);
  }

  private async refresh(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      const [state, pipeline] = await Promise.all([
        voiceState(hass),
        listeningPipeline(hass).catch(() => undefined),
      ]);
      // Closed meanwhile: nothing more to follow.
      if (!this.isConnected) return;
      this.state = state;
      this.pipeline = pipeline ?? null;
      this.pollError = undefined;
      if (RUNNING.includes(state.setup.step)) {
        this.poll = window.setTimeout(() => void this.refresh(), POLL_MS);
      }
    } catch (error) {
      if (!this.isConnected) return;
      this.pollError = this.reason(error);
      // A set-up runs on in Home Assistant: asked about again (the connection may be back).
      if (this.state && RUNNING.includes(this.state.setup.step)) {
        this.poll = window.setTimeout(() => void this.refresh(), POLL_MS);
      }
    }
  }

  private reason(error: unknown): string {
    return isHassError(error) ? this.t.error(error.code) : this.t.error("unknown");
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private async addBlueprints(replace: boolean): Promise<void> {
    const hass = this.hass;
    if (!hass || !this.state) return;
    this.busy = true;
    this.error = undefined;
    try {
      const blueprints = await installBlueprints(hass, replace);
      this.state = { ...this.state, blueprints };
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  private async setUp(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.busy = true;
    this.error = undefined;
    try {
      await setUpVoice(hass, this.app);
      await this.refresh();
    } catch (error) {
      this.error = this.reason(error);
    } finally {
      this.busy = false;
    }
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const title =
      this.mode === "https"
        ? t.t("voice.https_title")
        : this.mode === "setup"
          ? t.t("voice.setup_title")
          : t.t("voice.title");
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="voice-title"
      data-testid="voice-dialog"
      data-mode=${this.mode}
    >
      <header>
        <h2 id="voice-title">${title}</h2>
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
      ${this.mode === "https" ? this.renderHttps() : nothing}
      ${this.mode === "settings" ? this.renderDevice() : nothing}
      ${this.mode !== "https" ? this.renderListening() : nothing}
      ${this.mode === "settings" && this.admin ? this.renderBlueprints() : nothing}
      ${this.mode === "settings" && this.hass && !canListen(this.hass) ? this.renderHttpsNote() : nothing}
      ${
        (this.error ?? this.pollError)
          ? html`<p class="error" role="alert">${this.error ?? this.pollError}</p>`
          : nothing
      }
    </div>`;
  }

  /** The microphone over HTTP: why, how to serve Home Assistant over HTTPS, typing meanwhile. */
  private renderHttps(): TemplateResult {
    const t = this.t;
    return html`<p>${t.t("voice.https")}</p>
      <p class="hint">
        ${t.t("voice.https_how")}
        <a href=${HTTPS_DOCS} target="_blank" rel="noreferrer">${t.t("voice.https_link")}</a>
      </p>
      <div class="footer">
        <button
          class="action quiet"
          data-testid="voice-type"
          @click=${() => {
            openAssist(this, "last_used", false);
            this.close();
          }}
        >
          ${t.t("voice.type")}
        </button>
      </div>`;
  }

  /** Voice on this device (D-085): off, no microphone button on it; Assist stays for the others. */
  /** Voice on this device (D-085), where Assist runs; not the demo house's or the sandbox's. */
  private renderDevice(): TemplateResult | typeof nothing {
    const t = this.t;
    const hass = this.hass;
    if (!hass || !assistAvailable(hass) || hass.demo || hass.sandbox) return nothing;
    return html`<label class="choice">
      <input
        type="checkbox"
        data-testid="voice-device"
        .checked=${this.deviceVoice}
        @change=${(event: Event) => {
          const on = (event.target as HTMLInputElement).checked;
          writeDeviceVoice(on);
          fire(this, "domotwin-device-voice", { on });
        }}
      />
      <span>${t.t("voice.device")}</span>
      <small>${t.t("voice.device_hint")}</small>
    </label>`;
  }

  private renderHttpsNote(): TemplateResult {
    return html`<p class="hint" data-testid="voice-https-note">${this.t.t("voice.https")}</p>`;
  }

  /** Whether Assist hears, and voice to set up when it does not. */
  private renderListening(): TemplateResult | typeof nothing {
    const t = this.t;
    const state = this.state;
    if (!state || this.pipeline === undefined)
      return html`<p class="hint">${t.t("voice.reading")}</p>`;
    const step = state.setup.step;
    const running = RUNNING.includes(step);
    // Assist hears (set up here, or another way after a set-up that failed).
    if (this.pipeline !== null && !running) {
      return html`<h3>${t.t("voice.assist")}</h3>
        <p data-testid="voice-ready">${t.t(step === "done" ? "voice.done" : "voice.ready")}</p>`;
    }
    if (!this.admin) {
      return html`<p data-testid="voice-ask-admin">${t.t("voice.ask_admin")}</p>`;
    }
    if (running) {
      const app = state.setup.app ?? "";
      return html`<h3>${t.t("voice.assist")}</h3>
        <p role="status" data-testid="voice-progress">
          ${t.t(`voice.step_${step as "checking" | "installing" | "starting" | "connecting" | "pipeline"}`, { app })}
        </p>
        <p class="hint">${t.t("voice.wait")}</p>`;
    }
    const failed =
      step === "failed"
        ? html`<p class="error" role="alert" data-testid="voice-failed">
            ${t.t(`voice.failed_${failure(state.setup.error)}`)}
          </p>`
        : nothing;
    if (!state.supervisor) {
      const { language, piper_voice: voice } = state;
      return html`<h3>${t.t("voice.assist")}</h3>
        <p>${t.t("voice.deaf")}</p>
        <p class="hint">${t.t("voice.container")}</p>
        <ol data-testid="voice-steps">
          <li>
            ${t.t("voice.container_whisper")}<br /><code
              >docker run -d -p 10300:10300 -v whisper-data:/data rhasspy/wyoming-whisper --model
              tiny-int8 --language ${language}</code
            >
          </li>
          <li>
            ${t.t("voice.container_piper")}<br /><code
              >docker run -d -p 10200:10200 -v piper-data:/data rhasspy/wyoming-piper --voice
              ${voice}</code
            >
          </li>
          <li>${t.t("voice.container_wyoming")}</li>
          <li>${t.t("voice.container_pipeline")}</li>
        </ol>
        ${failed}`;
    }
    return html`<h3 id="voice-assist">${t.t("voice.assist")}</h3>
      <p>${t.t("voice.deaf")}</p>
      <div role="radiogroup" aria-labelledby="voice-assist">
        ${(["whisper", "speech-to-phrase"] as const).map(
          (app) =>
            html`<label class="choice">
              <input
                type="radio"
                name="voice-app"
                value=${app}
                .checked=${this.app === app}
                @change=${() => (this.app = app)}
              />
              <span>${t.t(`voice.app_${app === "whisper" ? "whisper" : "phrase"}`)}</span>
              <small>${t.t(`voice.app_${app === "whisper" ? "whisper" : "phrase"}_hint`)}</small>
            </label>`,
        )}
      </div>
      <p class="hint" data-testid="voice-consent">${t.t("voice.consent")}</p>
      ${failed}
      <div class="footer">
        <button
          class="action"
          data-testid="voice-setup"
          ?disabled=${this.busy}
          @click=${() => {
            void this.setUp();
          }}
        >
          ${t.t("voice.set_up")}
        </button>
      </div>`;
  }

  /** DomoTwin's voice blueprints, added to Home Assistant in one tap. */
  private renderBlueprints(): TemplateResult | typeof nothing {
    const t = this.t;
    const state = this.state;
    if (!state) return nothing;
    const missing = BLUEPRINTS.some((name) => state.blueprints[name] === "missing");
    const changed = BLUEPRINTS.some((name) => state.blueprints[name] === "changed");
    return html`<h3>${t.t("voice.blueprints")}</h3>
      <p class="hint">${t.t("voice.blueprints_hint")}</p>
      ${BLUEPRINTS.map(
        (name) =>
          html`<div class="row" data-blueprint=${name}>
            <span>${t.t(`voice.blueprint_${name}`)}</span>
            <small data-testid="blueprint-status">
              ${t.t(`voice.blueprint_${state.blueprints[name]}`)}
            </small>
          </div>`,
      )}
      <div class="footer">
        ${
          changed
            ? html`<button
                class="action quiet"
                data-testid="blueprints-replace"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.addBlueprints(true);
                }}
              >
                ${t.t("voice.blueprints_replace")}
              </button>`
            : nothing
        }
        ${
          missing
            ? html`<button
                class="action"
                data-testid="blueprints-add"
                ?disabled=${this.busy}
                @click=${() => {
                  void this.addBlueprints(false);
                }}
              >
                ${t.t("voice.blueprints_add")}
              </button>`
            : html`<button
                class="action"
                data-testid="blueprints-use"
                @click=${() => {
                  this.close();
                  navigate("/config/blueprint/dashboard");
                }}
              >
                ${t.t("voice.blueprints_use")}
              </button>`
        }
      </div>`;
  }
}

define("domotwin-voice", DomoTwinVoice);
