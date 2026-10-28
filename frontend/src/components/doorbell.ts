/**
 * `<domotwin-doorbell>`: a doorbell rang (D-068), full screen over every tab of the panel, or over
 * a dashboard's page from a card (D-087): who rang and when, its camera live, the lock of its door
 * with its buttons, and a way to close it. Home Assistant's own cards; a chunk loaded the first
 * time a doorbell rings.
 */
import { mdiBellRing, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { cameraCard, lockTile } from "../ha/cards";
import { nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { safetyEn, safetyFr } from "../i18n/safety";
import { entityName } from "../live/bindings";
import { RING_SHOWN_MS, type Ring } from "../live/doorbell";
import { NOTHING_UNSEEN, type Unseen } from "../live/privacy";
import { doorbellOf, type Doorbell } from "../live/safety";
import { timeStyle, whenText } from "../live/schedules";
import { define } from "./define";
import { cancelDialog, deepActive, focusDialog, fromField } from "./dialog";
import "./ha-card";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: safetyEn, fr: safetyFr });

export class DomoTwinDoorbell extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    ring: { attribute: false },
    unseen: { attribute: false },
  };

  hass?: HomeAssistant;
  t?: Translator;
  ring?: Ring;
  /** What the viewer may not see (D-039): a camera or a lock in a private room is not shown. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The doorbell's camera and lock, found again only when the registries or the ring change. */
  private doorbell?: Doorbell;
  private foundFrom?: unknown[];

  static override styles = [
    baseStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.72);
      }
      .doorbell {
        box-sizing: border-box;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: 12px;
        width: min(1080px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        padding: 16px;
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
      }
      .doorbell:focus {
        outline: none;
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      header > svg.icon {
        width: 32px;
        height: 32px;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      .words {
        flex: 1;
        display: grid;
        min-width: 0;
      }
      h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
      }
      .when {
        color: var(--secondary-text-color, #5f6368);
      }
      button.close {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      button.close:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
      }
      button.close svg.icon {
        width: 28px;
        height: 28px;
      }
      .camera {
        min-height: 0;
        overflow: auto;
      }
      .none {
        display: grid;
        place-items: center;
        min-height: 160px;
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 8px;
      }
      .footer domotwin-ha-card {
        flex: 1 1 260px;
      }
      .footer button.action {
        min-height: 48px;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues): void {
    const { hass, ring } = this;
    if (!hass || !ring || !(changed.has("hass") || changed.has("ring") || changed.has("unseen"))) {
      return;
    }
    const from = [ring, hass.entities, hass.devices, this.unseen];
    if (this.foundFrom && from.every((value, i) => value === this.foundFrom?.[i])) return;
    this.foundFrom = from;
    this.doorbell = doorbellOf(hass, ring.entity, this.unseen);
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent("domotwin-close", { bubbles: true, composed: true }));
  };

  protected override render(): TemplateResult | typeof nothing {
    const { hass, t, ring, doorbell } = this;
    if (!hass || !t || !ring || !doorbell) return nothing;
    const when = whenText(new Date(ring.at), new Date(nowOf(hass)), timeStyle(hass));
    return html`<div
      class="doorbell"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="doorbell-title"
      aria-describedby="doorbell-when"
      data-testid="doorbell"
      data-entity=${ring.entity}
    >
      <header>
        ${icon(mdiBellRing)}
        <div class="words">
          <h2 id="doorbell-title">${t.t("doorbell.title")}</h2>
          <span class="when" id="doorbell-when"
            >${t.t("doorbell.rang", { name: entityName(hass, ring.entity), when })}</span
          >
        </div>
        <button
          class="close"
          data-cancel
          data-testid="doorbell-close"
          aria-label=${t.t("doorbell.close")}
          title=${t.t("doorbell.close")}
          @click=${this.close}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <div class="camera">
        ${
          doorbell.camera
            ? html`<domotwin-ha-card
                data-testid="doorbell-camera"
                .hass=${hass}
                .t=${t}
                .config=${cameraCard(doorbell.camera, true)}
              ></domotwin-ha-card>`
            : html`<p class="none">${t.t("doorbell.no_camera")}</p>`
        }
      </div>
      <div class="footer">
        ${
          doorbell.lock
            ? html`<domotwin-ha-card
                data-testid="doorbell-lock"
                .hass=${hass}
                .t=${t}
                .config=${lockTile(doorbell.lock)}
              ></domotwin-ha-card>`
            : nothing
        }
        <button class="action" @click=${this.close}>${t.t("doorbell.close")}</button>
      </div>
    </div>`;
  }
}

define("domotwin-doorbell", DomoTwinDoorbell);

/**
 * What Home Assistant's own cards ask of Home Assistant's page (a lock's more-info, its code's
 * dialog, a toast, an action): heard by the page's `<home-assistant>`, which a doorbell put on the
 * page's body is not inside of, so they go through the card that showed it.
 */
const ASKED_OF_HOME_ASSISTANT = [
  "hass-more-info",
  "show-dialog",
  "hass-notification",
  "hass-action",
  "ll-custom",
] as const;
/** How long a card may be away (a dashboard laying its columns out again) before its ring goes. */
const AWAY_MS = 2000;

/** A ring shown over a dashboard's page by one of its cards (D-087). */
interface OnPage {
  owner: HTMLElement;
  element: DomoTwinDoorbell;
  timer: ReturnType<typeof setTimeout>;
  /** The card left the page: the ring goes unless it is back soon. */
  away?: ReturnType<typeof setTimeout>;
  /** What had the focus before: it gets it back. */
  opener: HTMLElement | null;
  /** Escape anywhere on the page closes it, unless a dialog of Home Assistant's has the focus. */
  onKey: (event: KeyboardEvent) => void;
}

let onPage: OnPage | undefined;

/** Whether `node` is in `host`, through the shadow roots. */
function within(host: Element, node: Node): boolean {
  for (let at: Node | null = node; at; at = at instanceof ShadowRoot ? at.host : at.parentNode) {
    if (at === host) return true;
  }
  return false;
}
/** The ring shown over the page last: another card that heard it too does not show it again. */
let shownLast: string | undefined;

/**
 * Shows a ring over the page from a dashboard's card (D-087), on the page's body so that no card's
 * box holds it: one at a time, whichever card heard it first, until two minutes after it rang
 * unless closed. The card (`owner`) has checked that its viewer may see that doorbell.
 */
export function ringOnPage(
  owner: HTMLElement,
  hass: HomeAssistant,
  t: Translator,
  ring: Ring,
  unseen: Unseen,
): void {
  const key = `${ring.entity} ${ring.at}`;
  // Two minutes after it rang, as the panel's (a device's clock behind Home Assistant's no longer).
  const left = Math.min(RING_SHOWN_MS - (nowOf(hass) - ring.at), RING_SHOWN_MS);
  if (key === shownLast || left <= 0) return;
  shownLast = key;
  closeOnPage();
  const element = document.createElement("domotwin-doorbell") as DomoTwinDoorbell;
  element.hass = hass;
  element.t = t;
  element.ring = ring;
  element.unseen = unseen;
  element.addEventListener("domotwin-close", () => {
    closeOnPage();
  });
  for (const type of ASKED_OF_HOME_ASSISTANT) {
    element.addEventListener(type, (event) => {
      event.stopPropagation();
      const from = onPage?.element === element ? onPage.owner : owner;
      from.dispatchEvent(
        new CustomEvent(type, {
          detail: (event as CustomEvent<unknown>).detail,
          bubbles: true,
          composed: true,
        }),
      );
    });
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || fromField(event)) return;
    const active = deepActive();
    const ours = active === null || active === document.body || within(element, active);
    if (ours && cancelDialog(element)) event.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  const opener = deepActive();
  document.body.append(element);
  void focusDialog(element);
  onPage = { owner, element, opener, onKey, timer: setTimeout(closeOnPage, left) };
}

/** Whether the ring over the page is the one `owner` showed. */
export function shownBy(owner: HTMLElement): boolean {
  return onPage?.owner === owner;
}

/** Home Assistant's new states for the ring over the page (its camera, its lock). */
export function updateOnPage(owner: HTMLElement, hass: HomeAssistant, unseen: Unseen): void {
  if (onPage?.owner !== owner) return;
  onPage.element.hass = hass;
  onPage.element.unseen = unseen;
}

/**
 * The card that showed the ring left the page (`away`) or came back: a dashboard laying out its
 * columns again takes its cards away for an instant, which closes nothing; gone for longer, it
 * goes, nothing telling it Home Assistant's states any more.
 */
export function awayFromPage(owner: HTMLElement, away: boolean): void {
  const shown = onPage;
  if (shown?.owner !== owner) return;
  clearTimeout(shown.away);
  shown.away = away
    ? setTimeout(() => {
        closeOnPage(owner);
      }, AWAY_MS)
    : undefined;
}

/** Closes the ring over the page: whichever shows, or only `owner`'s. */
export function closeOnPage(owner?: HTMLElement): void {
  const shown = onPage;
  if (!shown || (owner !== undefined && shown.owner !== owner)) return;
  onPage = undefined;
  clearTimeout(shown.timer);
  clearTimeout(shown.away);
  document.removeEventListener("keydown", shown.onKey);
  shown.element.remove();
  // The focus back to what had it, unless the user moved it elsewhere.
  const active = deepActive();
  if ((active === null || active === document.body) && shown.opener?.isConnected) {
    shown.opener.focus({ preventScroll: true });
  }
}
