/**
 * The "Measure performance" button (D-053): the demo house drawn for five seconds turning around
 * it, then five seconds still while a lamp dims, in the look shown (or in each look), on this
 * device; the result shown, with a row to paste in `docs/PERFORMANCE.md`. Nothing is sent or
 * kept. A chunk of its own, loaded when the menu item is used.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { LookName } from "../config";
import type { DemoHome, DemoSnapshot } from "../demo/home";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type MessageKey, type Translator } from "../i18n";
import {
  deviceName,
  framesPerSecond,
  markdownRows,
  readDevice,
  type LookRun,
  type MeasureReport,
} from "../measure/report";
import { define, fire } from "./define";
import { toClipboard } from "./save";
import { baseStyles } from "./styles";
import { nextFrame, type DomoTwinView, type FrameStats } from "./view";

/** What the panel lends the measure. */
export interface MeasureHost {
  /** The panel's 3D view. */
  view(): DomoTwinView | null;
  /** The demo house, opened when it is not shown. */
  openDemo(): Promise<DemoHome | undefined>;
  /** Its ground floor alone, shown; what puts back the storey shown before. */
  oneStorey(): Promise<() => Promise<void>>;
  /** The look drawn while measuring; none: the home's own again. */
  setLook(look: LookName | undefined): Promise<void>;
  /** The look shown now. */
  look(): LookName;
  /** Holds the panel's tools (and the demo's time and way out) while measuring, and lets them
   * go; whether it could (nothing else runs). */
  hold(held: boolean): boolean;
  /** From opening the panel to the home's first picture (ms), when it was drawn. */
  firstPictureMs(): number | undefined;
}

/** Every look, in the order of the settings. */
const LOOKS: readonly LookName[] = ["day", "neon", "blueprint", "cartoon", "clay"];
/** How long each half of a look's run lasts (ms). */
const RUN_MS = 5000;
/** Half a turn around the home in those five seconds (radians a second). */
const TURN = Math.PI / 5;
/** The demo house's evening: its lamps on, the same every time (minute of the day). */
const EVENING = 19 * 60 + 40;
/** The lamp dimmed while the camera stands still, and how often it is told (ms). */
const LAMP = "light.living_pendant";
const DIM_EVERY_MS = 100;
/** Frames drawn before measuring a look (its shaders built). */
const WARM_UP_FRAMES = 5;
/** How long the demo house may take to be drawn (ms). */
const DRAWN_WITHIN_MS = 60_000;

type Phase = "intro" | "running" | "result" | "failed";

/** What stops a measure, said to the user. */
class MeasureError extends Error {}

export class DomoTwinMeasure extends LitElement {
  static override properties = {
    hass: { attribute: false },
    host: { attribute: false },
    phase: { state: true },
    everyLook: { state: true },
    progress: { state: true },
    report: { state: true },
    copied: { state: true },
    error: { state: true },
  };

  hass?: HomeAssistant;
  host?: MeasureHost;
  protected phase: Phase = "intro";
  protected everyLook = false;
  protected progress = "";
  protected report?: MeasureReport;
  /** The row copied, or to be copied by hand (the clipboard refused). */
  protected copied?: "done" | "manual";
  protected error?: string;
  /** The rows of the result, worked out once. */
  private rows = "";
  /** Counts the runs: one left behind (the panel closed meanwhile) stops at its next step. */
  private current = 0;
  /** The run going on, waited for before another starts, and one asked for meanwhile. */
  private running: Promise<void> = Promise.resolve();
  private asked = false;
  private lastDim = Number.NEGATIVE_INFINITY;

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 6;
        pointer-events: none;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 12px;
        box-sizing: border-box;
      }
      .progress {
        pointer-events: auto;
        max-width: min(560px, 100%);
        padding: 10px 16px;
        border-radius: 16px;
        font-size: 0.95rem;
      }
      /* Its buttons always in sight, what is above them scrolled. */
      [role="dialog"] {
        pointer-events: auto;
        width: min(640px, 100%);
        max-height: calc(100% - 8px);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }
      .scroll {
        overflow: auto;
        padding: 16px 20px 4px;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 1.15rem;
      }
      h3 {
        margin: 16px 0 4px;
        font-size: 1rem;
      }
      p {
        margin: 8px 0;
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 12px;
        margin: 8px 0;
      }
      dt {
        color: var(--secondary-text-color, #5f6368);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      label.option {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 12px 0;
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 7em;
        font:
          0.8rem/1.4 ui-monospace,
          monospace;
        resize: vertical;
      }
      .footer {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px 16px;
      }
      .note {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.9rem;
      }
      .error {
        color: var(--error-color, #db4437);
      }
    `,
  ];

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Back after the panel was away (a phone locked): the run it left is over.
    if (this.phase === "running") {
      this.error = this.t.t("measure.interrupted");
      this.phase = "failed";
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.current += 1;
  }

  /** Whether run `token` was left behind: the measure ends there. */
  private gone(token: number): boolean {
    return token !== this.current;
  }

  /** Only a change of language draws it again, not each new state of the demo house. */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size === 1 && changed.has("hass")) {
      const before = changed.get("hass") as HomeAssistant | undefined;
      return translatorFor(before).language !== this.t.language;
    }
    return true;
  }

  protected override updated(changed: PropertyValues): void {
    // The result's Copy button, or the intro's Start, has the focus as it shows.
    if (changed.has("phase") && this.phase !== "running") {
      this.renderRoot
        .querySelector<HTMLElement>("[data-autofocus]")
        ?.focus({ preventScroll: true });
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** Waits until the demo house is drawn in `look`, its moves over. */
  private async drawn(host: MeasureHost, look: LookName, token: number): Promise<DomoTwinView> {
    const until = performance.now() + DRAWN_WITHIN_MS;
    for (;;) {
      if (this.gone(token)) throw new MeasureError("");
      const view = host.view();
      const state = view?.readyFor(look);
      if (state === "failed") throw new MeasureError(this.t.t("measure.no_view"));
      if (view && state === "ready") {
        await view.updateComplete;
        // In 3D, framed whole, at rest, as every device draws it.
        view.restView();
        view.settle();
        await nextFrame();
        await nextFrame();
        return view;
      }
      if (performance.now() > until) throw new MeasureError(this.t.t("measure.no_view"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** The lamp dimmed and brightened again, a few times a second, while the camera is still. */
  private dim(demo: DemoHome, fraction: number): void {
    const now = performance.now();
    if (now - this.lastDim < DIM_EVERY_MS) return;
    this.lastDim = now;
    // Down and up twice in the five seconds.
    const wave = Math.abs(1 - 2 * ((fraction * 2) % 1));
    void demo.hass
      .callService(
        "light",
        "turn_on",
        { brightness_pct: Math.round(15 + 85 * wave) },
        {
          entity_id: LAMP,
        },
      )
      .catch(() => undefined);
  }

  /** Starts a measure, once the one before (left behind) has put everything back. */
  private start(): void {
    if (this.asked) return;
    this.asked = true;
    this.phase = "running";
    this.progress = this.t.t("measure.opening");
    void this.running.then(() => {
      this.asked = false;
      const token = ++this.current;
      this.running = this.run(token);
    });
  }

  private async run(token: number): Promise<void> {
    const host = this.host;
    if (!host) return;
    const t = this.t;
    this.phase = "running";
    this.report = undefined;
    this.copied = undefined;
    this.error = undefined;
    this.progress = t.t("measure.opening");
    const firstPictureMs = host.firstPictureMs();
    const shown = host.look();
    const looks = this.everyLook ? [shown, ...LOOKS.filter((look) => look !== shown)] : [shown];
    let held = false;
    let demo: DemoHome | undefined;
    let before: DemoSnapshot | undefined;
    let storeyBack: (() => Promise<void>) | undefined;
    let planView = false;
    try {
      held = host.hold(true);
      if (!held) throw new MeasureError(t.t("measure.busy"));
      demo = await host.openDemo();
      if (!demo) throw new MeasureError(t.t("measure.no_demo"));
      // The same moment every time: the evening, its lamps on, the day held; the house as it
      // was put back after.
      before = demo.snapshot();
      demo.play(false);
      demo.jump(EVENING);
      planView = host.view()?.debugState().planView ?? false;
      storeyBack = await host.oneStorey();
      const runs: LookRun[] = [];
      const steps = looks.length * 2;
      const measured = (stats: FrameStats): FrameStats => {
        if (this.gone(token)) throw new MeasureError("");
        if (stats.interrupted) throw new MeasureError(t.t("measure.hidden"));
        return stats;
      };
      for (const [i, look] of looks.entries()) {
        await host.setLook(look);
        const view = await this.drawn(host, look, token);
        // A look's first frames build its shaders: not measured.
        await view.benchmark(WARM_UP_FRAMES);
        const name = t.t(`settings.theme_${look}` as MessageKey);
        this.progress = t.t("measure.turning", { look: name, step: i * 2 + 1, steps });
        const turning = measured(await view.benchmark({ ms: RUN_MS, turn: TURN }));
        this.progress = t.t("measure.still", { look: name, step: i * 2 + 2, steps });
        const lit = demo;
        this.lastDim = Number.NEGATIVE_INFINITY;
        const still = measured(
          await view.benchmark({
            ms: RUN_MS,
            step: (fraction) => {
              this.dim(lit, fraction);
            },
          }),
        );
        const state = view.debugState();
        runs.push({
          look,
          ...(state.quality !== undefined ? { quality: state.quality } : {}),
          resolution: state.resolution,
          ...(state.stats ? { triangles: state.stats.triangles } : {}),
          turning,
          still,
        });
      }
      const report: MeasureReport = {
        device: readDevice(__DOMOTWIN_VERSION__, host.view()?.renderer()),
        ...(firstPictureMs !== undefined ? { firstPictureMs } : {}),
        runs,
      };
      this.report = report;
      this.rows = markdownRows(report);
      this.phase = "result";
    } catch (error) {
      if (this.gone(token)) return;
      // What went wrong underneath (a lost engine) is said plainly.
      this.error =
        error instanceof MeasureError && error.message ? error.message : t.t("measure.interrupted");
      this.phase = "failed";
    } finally {
      if (held) {
        // As it was: the house, its storey and the home's look; the view in 2D if it was.
        if (demo && before) demo.restore(before);
        await storeyBack?.();
        await host.setLook(undefined);
        if (planView) host.view()?.setPlanView(true);
        host.hold(false);
      }
    }
  }

  private async copy(): Promise<void> {
    // Some companion apps refuse the clipboard: the text is then selected to copy by hand.
    if (await toClipboard(this.rows)) {
      this.copied = "done";
      return;
    }
    this.copied = "manual";
    await this.updateComplete;
    const area = this.renderRoot.querySelector("textarea");
    area?.focus();
    area?.select();
  }

  protected override render(): TemplateResult {
    const t = this.t;
    switch (this.phase) {
      case "running":
        return html`<div class="progress glass" role="status" data-testid="measure-progress">
          ${this.progress}
        </div>`;
      case "result":
        return this.renderResult(t);
      case "failed":
        return html`<div class="glass" role="dialog" aria-labelledby="measure-title">
          <div class="scroll">
            <h2 id="measure-title">${t.t("measure.title")}</h2>
            <p class="error" role="alert">${t.t("measure.failed", { reason: this.error ?? "" })}</p>
          </div>
          <div class="footer">
            <button class="action quiet" data-cancel @click=${() => this.close()}>
              ${t.t("measure.close")}
            </button>
            <button
              class="action"
              data-autofocus
              @click=${() => {
                this.start();
              }}
            >
              ${t.t("measure.again")}
            </button>
          </div>
        </div>`;
      default:
        return html`<div
          class="glass"
          role="dialog"
          aria-labelledby="measure-title"
          data-testid="measure-dialog"
        >
          <div class="scroll">
            <h2 id="measure-title">${t.t("measure.title")}</h2>
            <p>${t.t("measure.intro")}</p>
            <p class="note">${t.t("measure.private")}</p>
            ${
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? html`<p class="note">${t.t("measure.motion")}</p>`
                : nothing
            }
            <label class="option">
              <input
                type="checkbox"
                data-testid="measure-every-look"
                .checked=${this.everyLook}
                @change=${(event: Event) => {
                  this.everyLook = (event.target as HTMLInputElement).checked;
                }}
              />
              <span>${t.t("measure.every_look")}</span>
            </label>
          </div>
          <div class="footer">
            <button class="action quiet" data-cancel @click=${() => this.close()}>
              ${t.t("panel.cancel")}
            </button>
            <button
              class="action"
              data-autofocus
              data-testid="measure-start"
              @click=${() => {
                this.start();
              }}
            >
              ${t.t("measure.start")}
            </button>
          </div>
        </div>`;
    }
  }

  private renderResult(t: Translator): TemplateResult {
    const report = this.report;
    if (!report) return html``;
    const { device } = report;
    const language = t.language;
    const formats = new Map<number, Intl.NumberFormat>();
    const number = (value: number, digits = 1): string => {
      let format = formats.get(digits);
      if (!format) {
        format = new Intl.NumberFormat(language, { maximumFractionDigits: digits });
        formats.set(digits, format);
      }
      return format.format(value);
    };
    const ms = (value: number): string => t.t("measure.ms", { value: number(value) });
    const unknown = t.t("measure.unknown");
    const run = (label: string, stats: FrameStats): TemplateResult => {
      const fps = framesPerSecond(stats);
      return html`<dt>${label}</dt>
        <dd>
          ${
            fps !== undefined
              ? html`${t.t("measure.fps", { fps: number(fps, 0) })} ·
                ${t.t("measure.interval", {
                  median: ms(stats.intervalMedianMs),
                  p95: ms(stats.intervalP95Ms),
                })}
                ·`
              : nothing
          }
          ${t.t("measure.cpu", { median: ms(stats.cpuMedianMs), p95: ms(stats.cpuP95Ms) })}
        </dd>`;
    };
    return html`<div
      class="glass"
      role="dialog"
      aria-labelledby="measure-title"
      data-testid="measure-result"
    >
      <div class="scroll">
        <h2 id="measure-title">${t.t("measure.result")}</h2>
        <dl>
          <dt>${t.t("measure.device")}</dt>
          <dd>
            ${deviceName(device.userAgent, device.touch)} ·
            ${device.app ? t.t("measure.app") : t.t("measure.browser")}
          </dd>
          <dt>${t.t("measure.screen")}</dt>
          <dd>
            ${t.t("measure.screen_size", {
              width: device.screen.width,
              height: device.screen.height,
              ratio: number(device.screen.pixelRatio, 2),
            })}
          </dd>
          <dt>${t.t("measure.cores")}</dt>
          <dd>${device.cores !== undefined ? String(device.cores) : unknown}</dd>
          <dt>${t.t("measure.memory")}</dt>
          <dd>
            ${
              device.memoryGb !== undefined
                ? t.t("measure.gigabytes", { value: number(device.memoryGb) })
                : unknown
            }
          </dd>
          <dt>${t.t("measure.gpu")}</dt>
          <dd>${device.renderer ?? unknown}</dd>
          <dt>DomoTwin</dt>
          <dd>${device.version}</dd>
          <dt>${t.t("measure.first_picture")}</dt>
          <dd>
            ${
              report.firstPictureMs !== undefined
                ? t.t("measure.seconds", { value: number(report.firstPictureMs / 1000) })
                : t.t("measure.no_first_picture")
            }
          </dd>
        </dl>
        ${report.runs.map(
          (look) =>
            html`<h3>${t.t(`settings.theme_${look.look}` as MessageKey)}</h3>
              <dl data-look=${look.look}>
                <dt>${t.t("measure.quality")}</dt>
                <dd>
                  ${look.quality ? t.t(`editor.quality_${look.quality}` as MessageKey) : unknown} ·
                  ${t.t("measure.scale", { value: number(look.resolution, 2) })}
                </dd>
                <dt>${t.t("measure.triangles")}</dt>
                <dd>${look.triangles !== undefined ? number(look.triangles, 0) : unknown}</dd>
                <dt>${t.t("measure.wasm")}</dt>
                <dd>
                  ${t.t("measure.megabytes", {
                    value: number(
                      Math.max(look.turning.wasmMemoryBytes, look.still.wasmMemoryBytes) / 1e6,
                    ),
                  })}
                </dd>
                ${run(t.t("measure.turning_label"), look.turning)}
                ${run(t.t("measure.still_label"), look.still)}
              </dl>`,
        )}
        <h3>${t.t("measure.row")}</h3>
        <p class="note">${t.t("measure.row_hint")}</p>
        <textarea
          readonly
          data-testid="measure-row"
          aria-label=${t.t("measure.row")}
          .value=${this.rows}
        ></textarea>
        <p role="status" class="note" data-testid="measure-copied">
          ${
            this.copied === "done"
              ? t.t("measure.copied")
              : this.copied === "manual"
                ? t.t("measure.copy_manual")
                : nothing
          }
        </p>
      </div>
      <div class="footer">
        <button class="action quiet" data-cancel @click=${() => this.close()}>
          ${t.t("measure.close")}
        </button>
        <button
          class="action quiet"
          @click=${() => {
            this.start();
          }}
        >
          ${t.t("measure.again")}
        </button>
        <button
          class="action"
          data-autofocus
          data-testid="measure-copy"
          @click=${() => void this.copy()}
        >
          ${t.t("measure.copy")}
        </button>
      </div>
    </div>`;
  }
}

define("domotwin-measure", DomoTwinMeasure);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-measure": DomoTwinMeasure;
  }
}
