/**
 * "Why?" in a device's sheet (`DECISIONS.md`, D-059): when asked, who or what last changed the
 * device, as a chain from what started it to the change, each step with when it happened; the
 * runs' traces for administrators; the chain drawn in the home, and Home Assistant's Activity on
 * it. Asked again when the device changes while its chain shows. Loaded with the sheets.
 */
import {
  mdiAccount,
  mdiAccountKeyOutline,
  mdiClockOutline,
  mdiCogOutline,
  mdiFormatListBulletedType,
  mdiGestureTap,
  mdiHelpRhombusOutline,
  mdiLightningBolt,
  mdiPower,
  mdiPowerPlug,
  mdiRobot,
  mdiScriptTextOutline,
  mdiSwapHorizontal,
  mdiTimelineClockOutline,
  mdiVectorPolyline,
  mdiWeatherSunny,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { nowOf, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { navigate } from "../live/actions";
import { entityName } from "../live/bindings";
import { timeAgo } from "../live/text";
import {
  activityPath,
  explain,
  traceLinks,
  userNames,
  type WhyChain,
  type WhyKind,
} from "../live/why";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";
import { stepWords } from "./why-text";

/** What the section asks the view: draw this chain in the home. */
export interface ShowWhy {
  entity: string;
  chain: WhyChain;
  /** The names of the chain's users. */
  users: ReadonlyMap<string, string>;
  /** Whether the viewer may not see an entity (D-039). */
  unseen?: (entity: string) => boolean;
}

const KIND_ICONS: Record<WhyKind, string> = {
  person: mdiAccount,
  change: mdiSwapHorizontal,
  automation: mdiRobot,
  script: mdiScriptTextOutline,
  action: mdiGestureTap,
  time: mdiClockOutline,
  sun: mdiWeatherSunny,
  start: mdiPower,
  event: mdiLightningBolt,
  trigger: mdiLightningBolt,
  integration: mdiCogOutline,
  guest: mdiAccountKeyOutline,
  unattributed: mdiPowerPlug,
  lost: mdiHelpRhombusOutline,
};

/** `<domotwin-why-section>`: why a device is as it is, when asked. */
export class DomoTwinWhySection extends LitElement {
  static override properties = {
    hass: { attribute: false },
    entity: { attribute: false },
    unseen: { attribute: false },
    chain: { state: true },
    loading: { state: true },
  };
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h3 {
        margin: 12px 0 0;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #5f6368);
      }
      ol {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
      }
      li {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
      }
      /* The steps joined, from what started it down to the device. */
      li:not(:last-child)::after {
        content: "";
        position: absolute;
        inset-inline-start: 13px;
        top: 34px;
        bottom: -6px;
        width: 2px;
        background: var(--divider-color, rgba(0, 0, 0, 0.15));
      }
      .glyph {
        flex: none;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, transparent);
      }
      .glyph svg {
        width: 16px;
        height: 16px;
      }
      li.unattributed .glyph,
      li.lost .glyph {
        background: transparent;
        outline: 2px dashed var(--secondary-text-color, #5f6368);
        outline-offset: -2px;
      }
      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow-wrap: anywhere;
      }
      .text small,
      p.note {
        color: var(--secondary-text-color, #5f6368);
      }
      a.trace {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: inherit;
      }
      p.note {
        margin: 8px 0 0;
        font-size: 0.85rem;
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        padding-top: 4px;
      }
    `,
  ];

  hass?: HomeAssistant;
  /** The device's entity explained. */
  entity = "";
  /** Whether the viewer may not see an entity (D-039): not named, not linked to. */
  unseen?: (entity: string) => boolean;
  /** The chain, once asked (none: not asked yet). */
  protected chain?: WhyChain;
  protected loading = false;
  /** The names of the chain's users, and the traces of its runs (administrators). */
  private users = new Map<string, string>();
  private traces = new Map<string, string>();
  /** The change asked about (the device and when its state last changed): "" before asking. */
  private asked = "";
  /** A chain is being read; the device changed meanwhile: why, again, once it is. */
  private reading = false;
  private again = false;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** The device's last change of state, which the chain explains. */
  private change(): string {
    return `${this.entity} ${this.hass?.states[this.entity]?.last_changed ?? ""}`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Another device: its own chain, when asked.
    if (changed.has("entity") && changed.get("entity") !== undefined) {
      this.asked = "";
      this.chain = undefined;
      this.loading = false;
    }
    // The device changed again while its chain shows: why, again (once the chain being read is
    // read, for a device that changes often).
    if (this.asked !== "" && this.change() !== this.asked) {
      if (this.reading) this.again = true;
      else void this.ask();
    }
  }

  private readonly ask = async (): Promise<void> => {
    const hass = this.hass;
    if (!hass) return;
    const asked = this.change();
    this.asked = asked;
    this.loading = true;
    this.reading = true;
    const chain = await explain(hass, this.entity).finally(() => {
      this.reading = false;
    });
    if (this.again) {
      this.again = false;
      void this.ask();
      return;
    }
    const users = chain.steps.flatMap((s) => (s.kind === "person" && s.user ? [s.user] : []));
    const [names, traces] = await Promise.all([
      userNames(hass, users),
      chain.steps.some((s) => s.context !== undefined)
        ? traceLinks(hass)
        : Promise.resolve(new Map<string, string>()),
    ]);
    // Asked again meanwhile: that answer counts.
    if (asked !== this.asked) return;
    this.users = names;
    this.traces = traces;
    this.chain = chain;
    this.loading = false;
  };

  private ago(when: number | undefined): string {
    if (when === undefined) return "";
    return timeAgo(this.t.language, Math.max(0, (nowOf(this.hass) - when) / 1000));
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass || !this.entity) return nothing;
    const t = this.t;
    const chain = this.chain;
    return html`<section data-testid="why">
      <h3>${t.t("why.title")}</h3>
      ${
        chain
          ? this.renderChain(hass, t, chain)
          : this.loading
            ? html`<p class="note" role="status">${t.t("why.loading")}</p>`
            : html`<div class="footer">
                <button class="action quiet" data-testid="why-ask" @click=${this.ask}>
                  ${icon(mdiHelpRhombusOutline)}${t.t("why.ask")}
                </button>
              </div>`
      }
    </section>`;
  }

  private renderChain(hass: HomeAssistant, t: Translator, chain: WhyChain): TemplateResult {
    const admin = hass.user?.is_admin === true && !hass.demo;
    const activity = hass.demo ? undefined : activityPath(chain, this.unseen);
    const name = entityName(hass, this.entity);
    return html`<ol aria-label=${t.t("why.chain", { name })}>
        ${chain.steps.map((step) => {
          const words = stepWords(t, hass, step, this.users, this.unseen);
          const trace = admin && step.context ? this.traces.get(step.context) : undefined;
          const ago = this.ago(step.when);
          return html`<li class=${step.kind} data-kind=${step.kind}>
            <span class="glyph">${icon(KIND_ICONS[step.kind])}</span>
            <span class="text">
              <span>${words.main}</span>
              <small>${ago ? `${words.detail} · ${ago}` : words.detail}</small>
            </span>
            ${
              trace
                ? html`<a
                    class="trace"
                    href=${trace}
                    title=${t.t("why.trace_of", { name: words.main })}
                    aria-label=${t.t("why.trace_of", { name: words.main })}
                    @click=${(event: Event) => {
                      event.preventDefault();
                      navigate(trace);
                    }}
                    >${icon(mdiTimelineClockOutline)}</a
                  >`
                : nothing
            }
          </li>`;
        })}
      </ol>
      ${chain.unread ? html`<p class="note" role="note">${t.t("why.unread")}</p>` : nothing}
      ${chain.cut ? html`<p class="note" role="note">${t.t("why.cut")}</p>` : nothing}
      <div class="footer">
        ${
          activity
            ? html`<button
                class="action quiet"
                data-testid="why-activity"
                @click=${() => {
                  navigate(activity);
                }}
              >
                ${icon(mdiFormatListBulletedType)}${t.t("why.activity")}
              </button>`
            : nothing
        }
        <button
          class="action quiet"
          data-testid="why-show"
          @click=${() => {
            fire(this, "domotwin-show-why", {
              entity: this.entity,
              chain,
              users: this.users,
              ...(this.unseen ? { unseen: this.unseen } : {}),
            } satisfies ShowWhy);
          }}
        >
          ${icon(mdiVectorPolyline)}${t.t("why.show")}
        </button>
      </div>`;
  }
}

define("domotwin-why-section", DomoTwinWhySection);
