/**
 * The demo house's bar (D-050): that this is the demo and touches nothing of the home, the time
 * of its day, the day going on or held, a moment of the day to go to, and the way out.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { mdiClose, mdiFlaskOutline, mdiPause, mdiPlay } from "@mdi/js";

import { define, fire } from "../components/define";
import { icon } from "../components/icon";
import { baseStyles } from "../components/styles";
import { translatorFor } from "../i18n";
import { at } from "./day";
import type { DemoHome } from "./home";

/** Moments of the day to go to: breakfast, the sun's height, the evening lamps lit, the night. */
const MOMENTS = [
  ["morning", at(7, 15)],
  ["noon", at(12, 50)],
  ["evening", at(19, 40)],
  ["night", at(21, 30)],
] as const;

/** `minute` of the day as `HH:MM`. */
function clock(minute: number): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

export class DomoTwinDemoBar extends LitElement {
  static override properties = {
    home: { attribute: false },
    leave: { type: Boolean },
    held: { type: Boolean },
  };

  /** The demo house shown. */
  home?: DemoHome;
  /** Offers the way out (the panel; a card set to the demo stays on it). */
  leave = false;
  /** The way out held while something runs on the demo house (an import being read). */
  held = false;
  private unwatch?: () => void;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        padding: 6px 12px;
        font-size: 0.85rem;
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 12%,
          var(--card-background-color, #fff)
        );
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .what {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
      .note {
        color: var(--secondary-text-color, #5f6368);
        flex: 1 1 12em;
      }
      .time {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      time {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        min-width: 3.2em;
        text-align: center;
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 32px;
        padding: 4px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.16));
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button.round {
        width: 32px;
        padding: 0;
        justify-content: center;
      }
      button:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: 2px;
      }
      .moments {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      svg.icon {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
    `,
  ];

  protected override updated(changed: PropertyValues): void {
    if (changed.has("home")) {
      this.unwatch?.();
      this.unwatch = this.home?.watchClock(() => {
        this.requestUpdate();
      });
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.home && !this.unwatch) {
      this.unwatch = this.home.watchClock(() => {
        this.requestUpdate();
      });
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unwatch?.();
    this.unwatch = undefined;
  }

  protected override render(): TemplateResult | typeof nothing {
    const home = this.home;
    if (!home) return nothing;
    const t = translatorFor(home.hass);
    const playing = home.playing;
    return html`<div
      class="bar"
      role="region"
      aria-label=${t.t("demo.title")}
      data-testid="demo-bar"
    >
      <span class="what">${icon(mdiFlaskOutline)}${t.t("demo.title")}</span>
      <span class="note">${t.t("demo.note")}</span>
      <span class="time">
        <time aria-label=${t.t("demo.time")} data-testid="demo-time">${clock(home.minute)}</time>
        <button
          class="round"
          data-testid="demo-play"
          aria-pressed=${playing ? "true" : "false"}
          aria-label=${t.t(playing ? "demo.pause" : "demo.play")}
          title=${t.t(playing ? "demo.pause" : "demo.play")}
          @click=${() => {
            home.play(!playing);
          }}
        >
          ${icon(playing ? mdiPause : mdiPlay)}
        </button>
      </span>
      <span class="moments">
        ${MOMENTS.map(
          ([name, minute]) =>
            html`<button
              data-testid=${`demo-${name}`}
              @click=${() => {
                home.jump(minute);
              }}
            >
              ${t.t(`demo.${name}`)}
            </button>`,
        )}
      </span>
      ${
        this.leave
          ? html`<button
              data-testid="demo-leave"
              ?disabled=${this.held}
              @click=${() => {
                fire(this, "domotwin-demo-leave", {});
              }}
            >
              ${icon(mdiClose)}${t.t("demo.leave")}
            </button>`
          : nothing
      }
    </div>`;
  }
}

define("domotwin-demo-bar", DomoTwinDemoBar);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-demo-bar": DomoTwinDemoBar;
  }
}

export { DemoHome } from "./home";
