/**
 * `<domotwin-screens>`, the wall screens (D-076), for administrators: each screen's name, the tab
 * it opens on and its screen saver (after how long, the sensors that wake it, the weather, a folder
 * of Home Assistant's media whose photos it shows, at night dimmed). The integration keeps them;
 * each device chooses the screen it is in the user's choices. Loaded the first time it opens.
 */
import { mdiArrowUp, mdiClose, mdiFolderOutline } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { wallEn, wallFr } from "../i18n/wall";
import { entityName } from "../live/bindings";
import { browseMedia, type MediaFolder } from "../live/media";
import { TABS, isTab, type Tab } from "../live/choices";
import {
  MAX_SAVER_MINUTES,
  MAX_WAKE_SENSORS,
  NO_SAVER,
  SCREEN_NAME,
  screenNamed,
  wakeSensors,
  type ScreenLayout,
  type Screens,
} from "../live/screens";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: wallEn, fr: wallFr });

/** The waits offered before the saver comes (minutes; 0: never). */
const AFTER = [0, 1, 2, 5, 10, 15, 30, 60, 120] as const;
/** How long each photo may be shown (seconds). */
const EVERY = [10, 20, 30, 60, 120, 300] as const;

/** The names of a tab's words. */
const TAB_KEYS = {
  home: "tabs.home",
  rooms: "tabs.rooms",
  safety: "tabs.safety",
  "3d": "tabs.three_d",
} as const;

/** A screen while it is changed: its name (`fresh`: a new one, still named) and its layout. */
interface Draft {
  fresh?: boolean;
  name: string;
  start: Tab | "";
  /** Voice on the screen (D-085). */
  voice: boolean;
  after: number;
  wake: string[];
  weather: boolean;
  photos?: string;
  every: number;
  dim: boolean;
}

/** A folder being looked into: the way down to it, and what it holds once read. */
interface Browsing {
  path: { id?: string; title: string }[];
  folder?: MediaFolder;
  error?: string;
}

function draftOf(name: string, layout: ScreenLayout): Draft {
  const { saver } = layout;
  const draft: Draft = {
    name,
    start: layout.start ?? "",
    voice: layout.voice !== false,
    after: saver.after,
    wake: [...saver.wake],
    weather: saver.weather,
    every: saver.every,
    dim: saver.dim,
  };
  if (saver.photos) draft.photos = saver.photos;
  return draft;
}

/** The layout a draft keeps. */
export function layoutOf(draft: Draft): ScreenLayout {
  const layout: ScreenLayout = {
    saver: {
      after: draft.after,
      wake: draft.wake,
      weather: draft.weather,
      every: draft.every,
      dim: draft.dim,
    },
  };
  if (draft.start) layout.start = draft.start;
  if (!draft.voice) layout.voice = false;
  if (draft.photos) layout.saver.photos = draft.photos;
  return layout;
}

/** A name not taken yet: `base`, else `base_2`, `base_3`… */
export function freeName(screens: Screens, base: string): string {
  let name = base;
  for (let n = 2; screenNamed(screens, name); n += 1) name = `${base}_${String(n)}`;
  return name;
}

/** The last part of a media folder's id, to say which it is before it is opened again. */
export function folderName(id: string): string {
  const path = id.replace(/^media-source:\/\//, "").replace(/\/+$/, "");
  const last = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export class DomoTwinScreens extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    screens: { attribute: false },
    current: { attribute: false },
    draft: { state: true },
    browsing: { state: true },
    asking: { state: true },
    busy: { state: true },
    status: { state: true },
    error: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  /** Every screen, as the integration answered them. */
  screens: Screens = {};
  /** The screen this device is, chosen first. */
  current?: string;
  protected draft?: Draft;
  protected browsing?: Browsing;
  protected asking = false;
  protected busy = false;
  protected status?: string;
  protected error?: string;
  private opened = false;
  /** The folder last asked for, its answer kept only if no other was asked for since. */
  private asked = 0;

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
      p.hint,
      small {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      p.error {
        color: var(--error-color, #d23a2f);
      }
      .chips,
      .footer,
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .footer {
        justify-content: flex-end;
      }
      .footer .grow {
        flex: 1;
      }
      button.chip {
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 16px;
        padding: 4px 12px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
      }
      button.chip[aria-pressed="true"] {
        border-color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 16%,
          transparent
        );
      }
      label.field {
        display: grid;
        gap: 4px;
      }
      label.row span {
        flex: 1;
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
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        display: grid;
        gap: 4px;
      }
      legend {
        padding: 0;
        margin-bottom: 4px;
      }
      .browse {
        display: grid;
        gap: 6px;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .browse ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 2px;
        max-height: 200px;
        overflow: auto;
      }
      .browse li button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        padding: 6px 4px;
        border-radius: 6px;
        cursor: pointer;
      }
      .browse li button:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
      }
      svg.icon {
        width: 20px;
        height: 20px;
        flex: none;
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
    `,
  ];

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (this.opened || !changed.has("screens")) return;
    this.opened = true;
    const name = screenNamed(this.screens, this.current) ?? Object.keys(this.screens)[0];
    const layout = name ? this.screens[name] : undefined;
    if (name && layout) this.draft = draftOf(name, layout);
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private reason(error: unknown): string {
    const t = this.t;
    if (!t) return "";
    return isHassError(error) ? t.error(error.code) : t.error("unknown");
  }

  private change(change: Partial<Draft>): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, ...change };
    this.status = undefined;
  }

  private pick(name: string): void {
    if (this.busy) return;
    const layout = this.screens[name];
    if (!layout) return;
    this.draft = draftOf(name, layout);
    this.browsing = undefined;
    this.asking = false;
    this.status = undefined;
    this.error = undefined;
  }

  private add(): void {
    const t = this.t;
    if (!t) return;
    if (this.busy) return;
    this.draft = {
      fresh: true,
      name: freeName(this.screens, t.t("wall.new_name")),
      start: "",
      voice: true,
      after: 5,
      wake: [],
      weather: true,
      every: NO_SAVER.every,
      dim: true,
    };
    this.browsing = undefined;
    this.asking = false;
    this.status = undefined;
    this.error = undefined;
  }

  /** Opens a folder of Home Assistant's media (none: its sources). */
  private async browse(path: Browsing["path"]): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const ticket = ++this.asked;
    this.browsing = { path };
    try {
      const folder = await browseMedia(hass, path[path.length - 1]?.id);
      if (ticket === this.asked) this.browsing = { path, folder };
    } catch (error) {
      if (ticket !== this.asked) return;
      this.browsing = {
        path,
        error: this.t?.t("wall.photos_failed", { reason: this.reason(error) }) ?? "",
      };
    }
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    const draft = this.draft;
    if (!hass || !t || !draft) return;
    const name = draft.name.trim();
    if (!SCREEN_NAME.test(name)) {
      this.error = t.t("wall.bad_name");
      return;
    }
    if (draft.fresh && screenNamed(this.screens, name)) {
      this.error = t.t("wall.taken");
      return;
    }
    this.busy = true;
    this.error = undefined;
    try {
      const screens = await DomoTwinClient.for(hass).saveScreen(
        name,
        layoutOf(draft),
        draft.fresh === true,
      );
      this.screens = screens;
      const kept = screenNamed(screens, name) ?? name;
      // Still the screen saved (what was changed meanwhile stays changed): no longer new.
      const now = this.draft;
      if (now && now.name.trim().toLowerCase() === name.toLowerCase()) {
        this.draft = { ...now, name: kept, fresh: false };
      }
      this.status = t.t("wall.saved", { name: kept });
      fire(this, "domotwin-saved", { screens });
    } catch (error) {
      this.error = t.t("wall.failed", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private async forget(): Promise<void> {
    const hass = this.hass;
    const t = this.t;
    const draft = this.draft;
    const name = draft && !draft.fresh ? draft.name : undefined;
    if (!hass || !t || !name) return;
    this.busy = true;
    this.error = undefined;
    try {
      const screens = await DomoTwinClient.for(hass).removeScreen(name);
      this.screens = screens;
      const next = Object.keys(screens)[0];
      const layout = next ? screens[next] : undefined;
      this.draft = next && layout ? draftOf(next, layout) : undefined;
      this.asking = false;
      this.status = t.t("wall.removed", { name });
      fire(this, "domotwin-saved", { screens });
    } catch (error) {
      this.error = t.t("wall.failed", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private renderPhotos(draft: Draft, t: Translator): TemplateResult {
    const browsing = this.browsing;
    const chosen = draft.photos
      ? t.t("wall.photos_folder", { name: folderName(draft.photos) })
      : t.t("wall.photos_none");
    return html`<fieldset>
      <legend>${t.t("wall.photos")}</legend>
      <div class="row">
        <span data-testid="screens-photos">${chosen}</span>
        <button
          class="action quiet"
          data-testid="screens-photos-pick"
          @click=${() => {
            void this.browse([{ title: t.t("wall.photos_media") }]);
          }}
        >
          ${t.t("wall.photos_pick")}
        </button>
        ${
          draft.photos
            ? html`<button
                class="action quiet"
                data-testid="screens-photos-none"
                @click=${() => {
                  this.change({ photos: undefined });
                }}
              >
                ${t.t("wall.photos_none")}
              </button>`
            : nothing
        }
      </div>
      ${browsing ? this.renderBrowse(browsing, t) : nothing}
      ${
        draft.photos
          ? html`<label class="row">
              <span>${t.t("wall.every")}</span>
              <select
                data-testid="screens-every"
                @change=${(event: Event) => {
                  this.change({ every: Number((event.target as HTMLSelectElement).value) });
                }}
              >
                ${[...new Set([...EVERY, draft.every])]
                  .sort((a, b) => a - b)
                  .map(
                    (seconds) =>
                      html`<option value=${seconds} .selected=${seconds === draft.every}>
                        ${t.tp("wall.seconds", seconds)}
                      </option>`,
                  )}
              </select>
            </label>`
          : nothing
      }
    </fieldset>`;
  }

  private renderBrowse(browsing: Browsing, t: Translator): TemplateResult {
    const here = browsing.path[browsing.path.length - 1];
    const folder = browsing.folder;
    return html`<div class="browse" data-testid="screens-browse">
      <div class="row">
        ${
          browsing.path.length > 1
            ? html`<button
                class="round"
                aria-label=${t.t("wall.photos_up")}
                data-testid="screens-browse-up"
                @click=${() => {
                  void this.browse(browsing.path.slice(0, -1));
                }}
              >
                ${icon(mdiArrowUp)}
              </button>`
            : nothing
        }
        <strong>${folder?.title || here?.title}</strong>
      </div>
      ${browsing.error ? html`<p class="error" role="alert">${browsing.error}</p>` : nothing}
      ${
        folder
          ? html`<ul>
                ${folder.folders.map(
                  (item) =>
                    html`<li>
                      <button
                        data-folder=${item.title}
                        @click=${() => {
                          void this.browse([...browsing.path, { id: item.id, title: item.title }]);
                        }}
                      >
                        ${icon(mdiFolderOutline)}<span>${item.title}</span>
                      </button>
                    </li>`,
                )}
              </ul>
              <p class="hint">
                ${
                  folder.photos.length > 0
                    ? t.tp("wall.photos_count", folder.photos.length)
                    : t.t("wall.photos_empty")
                }
              </p>
              <div class="footer">
                <button
                  class="action"
                  data-testid="screens-browse-use"
                  ?disabled=${!here?.id || folder.photos.length === 0}
                  @click=${() => {
                    if (here?.id) this.change({ photos: here.id });
                    this.browsing = undefined;
                  }}
                >
                  ${t.t("wall.photos_use")}
                </button>
              </div>`
          : nothing
      }
    </div>`;
  }

  private renderDraft(draft: Draft, t: Translator, hass: HomeAssistant): TemplateResult {
    const sensors = wakeSensors(hass);
    // A sensor chosen and gone from Home Assistant is still listed, to be taken away.
    const listed = [...new Set([...draft.wake, ...sensors])];
    const full = draft.wake.length >= MAX_WAKE_SENSORS;
    // A screen keeps its name: the devices, cards and automations that name it keep theirs too.
    return html`${
        draft.fresh
          ? html`<label class="field">
              <span>${t.t("wall.name")}</span>
              <input
                type="text"
                data-testid="screens-name"
                maxlength="64"
                autocapitalize="off"
                spellcheck="false"
                .value=${draft.name}
                @input=${(event: Event) => {
                  this.change({ name: (event.target as HTMLInputElement).value });
                }}
              />
              <small>${t.t("wall.name_hint")}</small>
            </label>`
          : html`<h3 data-testid="screens-shown">${draft.name}</h3>`
      }
      <label class="row">
        <span>${t.t("wall.start")}</span>
        <select
          data-testid="screens-start"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            this.change({ start: isTab(value) ? value : "" });
          }}
        >
          <option value="" .selected=${draft.start === ""}>${t.t("wall.start_same")}</option>
          ${TABS.map(
            (tab) =>
              html`<option value=${tab} .selected=${draft.start === tab}>
                ${t.t(TAB_KEYS[tab])}
              </option>`,
          )}
        </select>
      </label>
      <label class="row">
        <input
          type="checkbox"
          data-testid="screens-voice"
          .checked=${draft.voice}
          @change=${(event: Event) => {
            this.change({ voice: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("wall.voice")}<br /><small>${t.t("wall.voice_hint")}</small></span>
      </label>
      <h3>${t.t("wall.saver_title")}</h3>
      <label class="row">
        <span>${t.t("wall.after")}</span>
        <select
          data-testid="screens-after"
          @change=${(event: Event) => {
            this.change({ after: Number((event.target as HTMLSelectElement).value) });
          }}
        >
          ${[...new Set([...AFTER, draft.after])]
            .filter((minutes) => minutes <= MAX_SAVER_MINUTES)
            .sort((a, b) => a - b)
            .map(
              (minutes) =>
                html`<option value=${minutes} .selected=${minutes === draft.after}>
                  ${minutes === 0 ? t.t("wall.never") : t.tp("wall.minutes", minutes)}
                </option>`,
            )}
        </select>
      </label>
      <fieldset data-testid="screens-wake">
        <legend>${t.t("wall.wake")}</legend>
        ${
          listed.length === 0
            ? html`<p class="hint">${t.t("wall.no_wake")}</p>`
            : html`<p class="hint">${t.t("wall.wake_hint")}</p>
                ${listed.map((id) => {
                  const on = draft.wake.includes(id);
                  return html`<label class="row">
                    <input
                      type="checkbox"
                      data-wake=${id}
                      .checked=${on}
                      ?disabled=${!on && full}
                      @change=${(event: Event) => {
                        const checked = (event.target as HTMLInputElement).checked;
                        const others = draft.wake.filter((other) => other !== id);
                        this.change({ wake: checked ? [...others, id] : others });
                      }}
                    />
                    <span>${entityName(hass, id)}</span>
                  </label>`;
                })}`
        }
      </fieldset>
      <label class="row">
        <input
          type="checkbox"
          data-testid="screens-weather"
          .checked=${draft.weather}
          @change=${(event: Event) => {
            this.change({ weather: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("wall.weather")}</span>
      </label>
      ${this.renderPhotos(draft, t)}
      <label class="row">
        <input
          type="checkbox"
          data-testid="screens-dim"
          .checked=${draft.dim}
          @change=${(event: Event) => {
            this.change({ dim: (event.target as HTMLInputElement).checked });
          }}
        />
        <span>${t.t("wall.dim")}</span>
      </label>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    const names = Object.keys(this.screens);
    const draft = this.draft;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screens-title"
      data-testid="screens-dialog"
    >
      <header>
        <h2 id="screens-title">${t.t("wall.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("wall.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <p class="hint">${t.t("wall.hint")}</p>
      <div class="chips" role="group" aria-label=${t.t("wall.title")}>
        ${names.map(
          (name) =>
            html`<button
              class="chip"
              data-screen=${name}
              aria-pressed=${draft && !draft.fresh && draft.name === name ? "true" : "false"}
              @click=${() => {
                this.pick(name);
              }}
            >
              ${name}
            </button>`,
        )}
        <button
          class="chip"
          data-testid="screens-add"
          data-autofocus
          aria-pressed=${draft?.fresh ? "true" : "false"}
          @click=${() => {
            this.add();
          }}
        >
          ${t.t("wall.add")}
        </button>
      </div>
      ${names.length === 0 && !draft ? html`<p class="hint">${t.t("wall.none")}</p>` : nothing}
      ${draft ? this.renderDraft(draft, t, hass) : nothing}
      ${
        this.status
          ? html`<p role="status" data-testid="screens-status">${this.status}</p>`
          : nothing
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        draft
          ? html`<div class="footer">
              ${
                !draft.fresh
                  ? this.asking
                    ? html`<span class="grow">${t.t("wall.remove_ask", { name: draft.name })}</span>
                        <button
                          class="action quiet"
                          @click=${() => {
                            this.asking = false;
                          }}
                        >
                          ${t.t("wall.cancel")}
                        </button>
                        <button
                          class="action"
                          data-testid="screens-remove-yes"
                          ?disabled=${this.busy}
                          @click=${() => void this.forget()}
                        >
                          ${t.t("wall.remove")}
                        </button>`
                    : html`<button
                        class="action quiet"
                        data-testid="screens-remove"
                        ?disabled=${this.busy}
                        @click=${() => {
                          this.asking = true;
                        }}
                      >
                        ${t.t("wall.remove")}
                      </button>`
                  : nothing
              }
              <span class="grow"></span>
              <button
                class="action"
                data-testid="screens-save"
                ?disabled=${this.busy || this.asking}
                @click=${() => void this.save()}
              >
                ${t.t("wall.save")}
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-screens", DomoTwinScreens);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-screens": DomoTwinScreens;
  }
}
