/**
 * `<domotwin-automation-guide>`: how to make an automation (D-093), step by step. What an
 * automation is — When, Only if, Then — with an example from the home; what each part can be; and
 * the ways to make one: Home Assistant's editor, plain words (D-070), the sandbox to try them
 * (D-057). Loaded when first opened.
 */
import { mdiClose, mdiPencilOutline, mdiStarFourPointsOutline, mdiTestTube } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type MessageKey, type Translator } from "../i18n";
import { guideEn, guideFr } from "../i18n/guide";
import { navigate } from "../live/actions";
import { guideExample } from "../live/guide";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: guideEn, fr: guideFr });

/** The guide's steps, in their order. */
const STEPS = ["intro", "when", "if", "then", "make"] as const;
type Step = (typeof STEPS)[number];

/** What each part's step lists. */
const KINDS: Record<"when" | "if" | "then", readonly string[]> = {
  when: ["state", "time", "sun", "people"],
  if: ["state", "time", "sun", "people"],
  then: ["device", "scene", "notify", "wait"],
};

/** Where Home Assistant makes a new automation. */
export const NEW_AUTOMATION = "/config/automation/edit/new";

export class DomoTwinAutomationGuide extends LitElement {
  static override properties = {
    hass: { attribute: false },
    plain: { attribute: false },
    sandbox: { attribute: false },
    demo: { attribute: false },
    step: { state: true },
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
        width: min(560px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        box-sizing: border-box;
        padding: 16px;
        display: grid;
        gap: 12px;
        font-size: 0.95rem;
        line-height: 1.45;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        outline: none;
      }
      p {
        margin: 0;
      }
      .hint {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.875rem;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 8px;
      }
      ul.kinds {
        padding-inline-start: 1.2em;
        list-style: disc;
        gap: 6px;
      }
      .part {
        display: grid;
        grid-template-columns: 7.5em 1fr;
        gap: 8px;
        align-items: baseline;
      }
      .part b {
        justify-self: start;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 0.85rem;
        color: #fff;
      }
      .part.when b,
      .chip.when {
        background: #3b82c4;
      }
      .part.if b,
      .chip.if {
        background: #b07a12;
      }
      .part.then b,
      .chip.then {
        background: #2f8a55;
      }
      .chip {
        display: inline-block;
        padding: 0 8px;
        border-radius: 10px;
        color: #fff;
        font-size: 0.8rem;
        font-weight: 600;
        vertical-align: 1px;
      }
      .example {
        padding: 10px 12px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 10%, transparent);
        display: grid;
        gap: 4px;
      }
      .step,
      .ways {
        display: grid;
        gap: 10px;
      }
      .way {
        display: grid;
        gap: 4px;
        justify-items: start;
      }
      .way button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      footer .count {
        flex: 1;
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .dots {
        display: flex;
        gap: 4px;
      }
      .dots i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--divider-color, rgba(0, 0, 0, 0.2));
      }
      .dots i.on {
        background: var(--primary-color, #03a9f4);
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
      @media (max-width: 420px) {
        .part {
          grid-template-columns: 1fr;
          gap: 2px;
        }
      }
    `,
  ];

  hass?: HomeAssistant;
  /** Plain words can be offered (D-070): an administrator, an AI task. */
  plain = false;
  /** The sandbox can be entered (D-057). */
  sandbox = false;
  /** A home kept in the page (the demo house, the sandbox): no editor of its own. */
  demo = false;
  protected step = 0;

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  protected override updated(changed: PropertyValues<this>): void {
    // Another step: its heading has the focus, so that it is read from its start.
    const own = changed as PropertyValues;
    if (own.has("step") && own.get("step") !== undefined) {
      this.renderRoot.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const step = STEPS[this.step] ?? "intro";
    const last = this.step === STEPS.length - 1;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      data-testid="automation-guide"
    >
      <header>
        <h2 id="guide-title">${t.t("guide.title")}</h2>
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
      <section class="step" data-testid="guide-step" data-step=${step}>
        ${this.renderStep(t, step)}
      </section>
      <footer>
        <span class="count"
          >${t.t("guide.step", { step: this.step + 1, count: STEPS.length })}</span
        >
        <span class="dots" aria-hidden="true">
          ${STEPS.map((_, k) => html`<i class=${k === this.step ? "on" : ""}></i>`)}
        </span>
        ${
          this.step > 0
            ? html`<button
                class="action quiet"
                data-testid="guide-back"
                @click=${() => {
                  this.go(this.step - 1);
                }}
              >
                ${t.t("guide.back")}
              </button>`
            : nothing
        }
        <button
          class="action"
          data-testid=${last ? "guide-done" : "guide-next"}
          data-autofocus
          @click=${() => {
            if (last) this.close();
            else this.go(this.step + 1);
          }}
        >
          ${last ? t.t("guide.done") : t.t("guide.next")}
        </button>
      </footer>
    </div>`;
  }

  private renderStep(t: Translator, step: Step): TemplateResult {
    switch (step) {
      case "intro":
        return this.renderIntro(t);
      case "make":
        return this.renderMake(t);
      default: {
        const tip = `guide.${step}_tip` as MessageKey;
        return html`<h3 tabindex="-1">${t.t(`guide.${step}_title` as MessageKey)}</h3>
          <ul class="kinds">
            ${KINDS[step].map(
              (kind) => html`<li>${t.t(`guide.${step}_${kind}` as MessageKey)}</li>`,
            )}
          </ul>
          <p class="hint">${t.t(tip)}</p>`;
      }
    }
  }

  private renderIntro(t: Translator): TemplateResult {
    const example = guideExample(this.hass);
    const text = example
      ? t.t(example.kind === "motion" ? "guide.example_motion" : "guide.example_door", {
          sensor: example.sensor,
          light: example.light,
        })
      : t.t("guide.example_none");
    return html`<h3 tabindex="-1">${t.t("guide.intro_title")}</h3>
      <p>${t.t("guide.intro")}</p>
      <ul>
        <li class="part when">
          <b>${t.t("guide.when")}</b><span>${t.t("guide.when_about")}</span>
        </li>
        <li class="part if">
          <b>${t.t("guide.only_if")}</b><span>${t.t("guide.only_if_about")}</span>
        </li>
        <li class="part then">
          <b>${t.t("guide.then")}</b><span>${t.t("guide.then_about")}</span>
        </li>
      </ul>
      <div class="example" data-testid="guide-example">
        <strong>${t.t("guide.example_title")}</strong>
        <span>${text}</span>
      </div>`;
  }

  private renderMake(t: Translator): TemplateResult {
    const admin = this.hass?.user?.is_admin === true;
    const editor =
      admin && !this.demo
        ? html`<div class="way">
            <button
              class="action"
              data-testid="guide-editor"
              @click=${() => {
                this.close();
                navigate(NEW_AUTOMATION);
              }}
            >
              ${icon(mdiPencilOutline)}${t.t("guide.make_editor")}
            </button>
            <span class="hint">${t.t("guide.make_editor_about")}</span>
          </div>`
        : html`<p class="hint" data-testid="guide-no-editor">
            ${this.demo ? t.t("guide.make_demo") : t.t("guide.make_not_admin")}
          </p>`;
    return html`<h3 tabindex="-1">${t.t("guide.make_title")}</h3>
      <div class="ways">
        ${editor}
        ${
          this.plain
            ? html`<div class="way">
                <button
                  class="action quiet"
                  data-testid="guide-plain"
                  @click=${() => {
                    fire(this, "domotwin-guide-plain", undefined);
                  }}
                >
                  ${icon(mdiStarFourPointsOutline)}${t.t("guide.make_plain")}
                </button>
                <span class="hint">${t.t("guide.make_plain_about")}</span>
              </div>`
            : nothing
        }
        ${
          this.sandbox
            ? html`<div class="way">
                <button
                  class="action quiet"
                  data-testid="guide-sandbox"
                  @click=${() => {
                    fire(this, "domotwin-guide-sandbox", undefined);
                  }}
                >
                  ${icon(mdiTestTube)}${t.t("guide.make_sandbox")}
                </button>
                <span class="hint">${t.t("guide.make_sandbox_about")}</span>
              </div>`
            : nothing
        }
      </div>
      <p>${t.t("guide.make_check")}</p>`;
  }
}

define("domotwin-automation-guide", DomoTwinAutomationGuide);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-automation-guide": DomoTwinAutomationGuide;
  }
}
