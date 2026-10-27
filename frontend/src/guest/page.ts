/**
 * `<domotwin-guest>`, a guest's page (D-067): what a guest pass opens, on DomoTwin's own page
 * outside Home Assistant's sign-in. The home in 3D with the rooms the pass opens (the card, on the
 * guest's `hass`), the devices it gives, with DomoTwin's own controls, room by room, and the
 * home's Wi-Fi when the pass shows it. The link's secret is in the page's address; every request
 * goes through it, and the integration checks each one.
 */
import { mdiWifi } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import type { DomoTwinCard } from "../components/card";
import { inLanguage } from "../components/define";
import { entityRow, rowStyles } from "../components/entity-rows";
import { icon } from "../components/icon";
import { baseStyles } from "../components/styles";
import type { HomeAssistant } from "../ha/types";
import { addMessages, Translator } from "../i18n";
import { guestsEn, guestsFr } from "../i18n/guests";
import type { BindingsJson } from "../live/bindings";
import { planRooms } from "../live/suggest";
import { roomDevices, type PassRoom } from "../live/guests";
import {
  GuestConnection,
  PassError,
  askPass,
  guestHass,
  readRefusal,
  readSnapshot,
  type GuestRefusal,
  type GuestSnapshot,
} from "./home";

addMessages({ en: guestsEn, fr: guestsFr });

/** The refusals a guest is told in words; anything else is said as not understood. */
const REFUSALS = [
  "unknown",
  "home_only",
  "not_yet",
  "ended",
  "not_loaded",
  "offline",
  "look_only",
  "not_allowed",
  "too_many_calls",
  "too_many_pages",
  "invalid",
] as const;
/** After these, the page may be asked again. */
const AGAIN = ["home_only", "not_loaded", "offline", "too_many_pages"];
/** State changes shown together: those within this many milliseconds. */
const BATCH_MS = 50;
/** The longest wait before reading the home again after following it was refused (ms). */
const MAX_RETRY_MS = 60_000;

export class DomoTwinGuest extends LitElement {
  static override properties = {
    snapshot: { state: true },
    hass: { state: true },
    refusal: { state: true },
    wifiOpen: { state: true },
  };

  protected snapshot?: GuestSnapshot;
  protected hass?: HomeAssistant;
  protected refusal?: GuestRefusal;
  protected wifiOpen = false;
  /** The link's address: the page's, without a trailing slash. */
  private readonly base = location.pathname.replace(/\/+$/, "");
  private readonly t = new Translator(navigator.language);
  private readonly dark = matchMedia("(prefers-color-scheme: dark)");
  private connection?: GuestConnection;
  private source?: EventSource;
  private card?: DomoTwinCard;
  private batch?: ReturnType<typeof setTimeout>;
  /** Counts the reads of the home: the answer to an older one is dropped. */
  private reads = 0;
  /** Following the pass was refused this many times in a row; the next read waits longer. */
  private refused = 0;
  private retry?: ReturnType<typeof setTimeout>;

  static override styles = [
    baseStyles,
    rowStyles,
    css`
      :host {
        display: block;
        min-height: 100%;
        box-sizing: border-box;
        padding: 16px;
        padding-top: max(16px, env(safe-area-inset-top));
        padding-bottom: max(16px, env(safe-area-inset-bottom));
        background: var(--primary-background-color);
        --primary-color: #03a9f4;
        --card-background-color: #ffffff;
        --primary-background-color: #f4f5f7;
        --primary-text-color: #1f2328;
        --secondary-text-color: #5f6368;
        --divider-color: rgba(0, 0, 0, 0.12);
        --error-color: #d23a2f;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --card-background-color: #1c1c1e;
          --primary-background-color: #111111;
          --primary-text-color: #e8e8e8;
          --secondary-text-color: #a0a0a0;
          --divider-color: rgba(255, 255, 255, 0.14);
        }
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        display: grid;
        gap: 16px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      header div {
        flex: 1;
        min-width: 0;
      }
      h1 {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 600;
      }
      h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      h3 {
        margin: 8px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--secondary-text-color);
      }
      p {
        margin: 0;
      }
      .meta,
      .note {
        color: var(--secondary-text-color);
      }
      .said {
        padding: 24px 16px;
        text-align: center;
        display: grid;
        gap: 16px;
        justify-items: center;
      }
      section.devices {
        background: var(--card-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 16px;
        padding: 12px 16px;
        display: grid;
        gap: 4px;
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      domotwin-card {
        display: block;
        border-radius: 16px;
        overflow: hidden;
        background: var(--card-background-color);
        border: 1px solid var(--divider-color);
      }
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 10;
      }
      button.round {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border: 1px solid var(--divider-color);
        border-radius: 50%;
        background: var(--card-background-color);
        color: inherit;
        cursor: pointer;
        padding: 0;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.dark.addEventListener("change", this.restyle);
    void this.load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dark.removeEventListener("change", this.restyle);
    this.source?.close();
    this.source = undefined;
    clearTimeout(this.batch);
    clearTimeout(this.retry);
  }

  /** The page's look follows the device's dark mode, the 3D view's too. */
  private readonly restyle = (): void => {
    this.rebuild();
  };

  /** Reads the home through the pass, then follows its devices. */
  private async load(): Promise<void> {
    clearTimeout(this.retry);
    const read = ++this.reads;
    let response: Response;
    try {
      response = await askPass(`${this.base}/home`);
    } catch {
      if (read === this.reads) this.refuse({ code: "offline" });
      return;
    }
    const body: unknown = await response.json().catch(() => ({}));
    if (read !== this.reads) return;
    if (!response.ok) {
      this.refuse(readRefusal(body));
      return;
    }
    const snapshot = readSnapshot(body);
    this.refusal = undefined;
    this.snapshot = snapshot;
    if (this.connection) this.connection.replace(snapshot);
    else this.connection = new GuestConnection(snapshot);
    document.title = snapshot.home || "DomoTwin";
    this.rebuild();
    this.follow();
  }

  private refuse(refusal: GuestRefusal): void {
    this.source?.close();
    this.source = undefined;
    this.refusal = refusal;
    this.snapshot = undefined;
    this.hass = undefined;
    this.card = undefined;
  }

  /** A new `hass` of the states as they are now (as Home Assistant gives its cards a new one). */
  private rebuild(): void {
    const snapshot = this.snapshot;
    const connection = this.connection;
    if (!snapshot || !connection) return;
    this.hass = guestHass(snapshot, connection, this.call, this.base, {
      language: this.t.language,
      dark: this.dark.matches,
    });
    if (snapshot.storeys.length > 0) {
      if (!this.card) {
        const card = document.createElement("domotwin-card") as DomoTwinCard;
        // The guest is nobody: no voice, no people, no camera.
        card.setConfig({
          type: "custom:domotwin-card",
          height: "60svh",
          voice: false,
          people: false,
        });
        this.card = card;
      }
      this.card.hass = this.hass;
    } else {
      this.card = undefined;
    }
  }

  /** Follows the pass's devices: their states as they change, the home read again, the end. */
  private follow(): void {
    this.source?.close();
    const source = new EventSource(`${this.base}/events`);
    this.source = source;
    source.addEventListener("state", (event: MessageEvent<string>) => {
      const snapshot = this.snapshot;
      if (!snapshot || source !== this.source) return;
      try {
        const state = JSON.parse(event.data) as GuestSnapshot["states"][string];
        snapshot.states = { ...snapshot.states, [state.entity_id]: state };
      } catch {
        return;
      }
      clearTimeout(this.batch);
      this.batch = setTimeout(() => {
        this.rebuild();
      }, BATCH_MS);
    });
    const again = (): void => {
      if (source !== this.source) return;
      source.close();
      this.source = undefined;
      void this.load();
    };
    // The home or the pass changed, or the pass ended: read again, which says why.
    source.addEventListener("home", again);
    source.addEventListener("end", again);
    source.addEventListener("open", () => {
      this.refused = 0;
    });
    source.addEventListener("error", () => {
      // Closed for good (refused): read again to know why, later each time it is refused while
      // the home itself opens; otherwise it comes back by itself.
      if (source.readyState !== EventSource.CLOSED || source !== this.source) return;
      source.close();
      this.source = undefined;
      clearTimeout(this.retry);
      this.retry = setTimeout(
        () => void this.load(),
        Math.min(MAX_RETRY_MS, 1000 * 2 ** this.refused),
      );
      this.refused += 1;
    });
  }

  /** A guest's action, through the pass; refused, with words to show. */
  private readonly call = async (
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
    target: Record<string, unknown> = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await askPass(`${this.base}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, service, data, target }),
      });
    } catch {
      throw new PassError("offline", this.say({ code: "offline" }));
    }
    const body: unknown = await response.json().catch(() => ({}));
    if (response.ok) return body;
    const refusal = readRefusal(body);
    const said = (body as { message?: unknown }).message;
    const message =
      refusal.code === "refused"
        ? this.t.t("guest.errors.refused", { reason: typeof said === "string" ? said : "" })
        : this.say(refusal);
    throw new PassError(refusal.code, message);
  };

  private when(iso: string | undefined): string {
    const moment = iso ? new Date(iso) : undefined;
    if (!moment || Number.isNaN(moment.getTime())) return "";
    return new Intl.DateTimeFormat(this.t.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(moment);
  }

  /** Why the pass opens nothing, or what it refused, in words. */
  private say(refusal: GuestRefusal): string {
    const code = REFUSALS.find((known) => known === refusal.code) ?? "invalid";
    return this.t.t(`guest.errors.${code}`, {
      date: this.when(code === "not_yet" ? refusal.starts : refusal.ends),
    });
  }

  /** Drawn once the guest's own language, as their browser says it, is here (D-081). */
  protected override scheduleUpdate(): Promise<unknown> | undefined {
    return inLanguage(
      this,
      () => ({ language: navigator.language }),
      () => super.scheduleUpdate(),
    );
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const refusal = this.refusal;
    if (refusal) {
      return html`<main>
        <div class="said" role="alert" data-testid="guest-refused">
          <p>${this.say(refusal)}</p>
          ${
            AGAIN.includes(refusal.code)
              ? html`<button class="action" @click=${() => void this.load()}>
                  ${t.t("guest.again")}
                </button>`
              : nothing
          }
        </div>
      </main>`;
    }
    const snapshot = this.snapshot;
    const hass = this.hass;
    if (!snapshot || !hass) {
      return html`<main><p class="said" role="status">${t.t("guest.loading")}</p></main>`;
    }
    const wifiAlone = snapshot.wifi !== null && !this.card;
    return html`<main>
      <header>
        <div>
          <h1 data-testid="guest-home">${snapshot.home || t.t("guest.welcome")}</h1>
          <p class="meta" data-testid="guest-pass">
            ${t.t("guest.pass", { name: snapshot.pass.name, date: this.when(snapshot.pass.ends) })}
          </p>
        </div>
        ${
          wifiAlone
            ? html`<button
                class="round"
                data-testid="guest-wifi"
                title=${t.t("guest.wifi")}
                aria-label=${t.t("guest.wifi")}
                @click=${() => void this.openWifi()}
              >
                ${icon(mdiWifi)}
              </button>`
            : nothing
        }
      </header>
      ${
        snapshot.pass.act
          ? nothing
          : html`<p class="note" data-testid="guest-look-only">${t.t("guest.look_only")}</p>`
      }
      ${this.card ?? nothing} ${this.renderDevices(snapshot, hass)}
      ${
        this.wifiOpen && snapshot.wifi
          ? html`<div class="overlay">
              <domotwin-wifi
                .hass=${hass}
                .t=${t}
                .wifi=${snapshot.wifi}
                @domotwin-close=${() => (this.wifiOpen = false)}
              ></domotwin-wifi>
            </div>`
          : nothing
      }
    </main>`;
  }

  private async openWifi(): Promise<void> {
    await import("../components/wifi-dialog");
    this.wifiOpen = true;
  }

  /** The pass's devices, room by room; those of no room it opens, apart. */
  private renderDevices(
    snapshot: GuestSnapshot,
    hass: HomeAssistant,
  ): TemplateResult | typeof nothing {
    const given = snapshot.pass.entities.filter((id) => hass.states[id] !== undefined);
    if (given.length === 0) return nothing;
    const closed = snapshot.settings.rooms ?? {};
    const rooms: PassRoom[] = snapshot.storeys.flatMap((storey) =>
      planRooms(storey.plan).filter((room) => !(room.id in closed)),
    );
    const bindings: BindingsJson = snapshot.bindings as BindingsJson;
    const devices = roomDevices(hass, bindings, snapshot.storeys, rooms);
    const placed = new Set<string>();
    const groups: { name: string; ids: string[] }[] = [];
    for (const room of rooms) {
      const ids = (devices.get(room.id) ?? []).filter(
        (id) => given.includes(id) && !placed.has(id),
      );
      ids.forEach((id) => placed.add(id));
      if (ids.length > 0) groups.push({ name: room.name, ids });
    }
    const elsewhere = given.filter((id) => !placed.has(id));
    if (elsewhere.length > 0) groups.push({ name: this.t.t("guest.elsewhere"), ids: elsewhere });
    const t = this.t;
    return html`<section class="devices" data-testid="guest-devices">
      <h2>${t.t("guest.devices")}</h2>
      ${groups.map(
        (group) =>
          html`<h3>${group.name}</h3>
            <fieldset ?disabled=${!snapshot.pass.act}>
              ${group.ids.map((id) => entityRow(hass, t, id, true))}
            </fieldset>`,
      )}
    </section>`;
  }
}
