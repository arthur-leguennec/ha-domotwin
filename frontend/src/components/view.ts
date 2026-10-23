import { mdiAlertCircleOutline, mdiFloorPlan } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { themeBackground, type Rgb } from "../color";
import type { QualityName } from "../config";
import { DomoTwinEngine, EngineError, wasmMemoryBytes, type PlanSummary } from "../engine/engine";
import type { StoredPlan } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { FrameScheduler } from "../scheduler";
import { icon } from "./icon";
import { baseStyles } from "./styles";

type EngineState = "idle" | "loading" | "ready" | "unsupported" | "failed";

/** Options of a view (from the card configuration or the panel). */
export interface ViewOptions {
  quality: QualityName;
}

/** Device pixel ratio cap: sharper than this costs fill rate for little visible gain. */
const MAX_PIXEL_RATIO = 2;
const FALLBACK_BACKGROUND: Rgb = { r: 242, g: 242, b: 240 };

/** Frame timings measured by `benchmark()` (frame-time smoke test). */
export interface FrameStats {
  frames: number;
  wasmMemoryBytes: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  intervalMedianMs: number;
  intervalP95Ms: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/**
 * `<domotwin-view>`: one canvas, one engine, rendered on demand. Shared by the card and the panel.
 * Everything GPU-side is released when the element leaves the page.
 */
export class DomoTwinView extends LitElement {
  static override properties = {
    hass: { attribute: false },
    plan: { attribute: false },
    options: { attribute: false },
    planError: { attribute: false },
    engineState: { state: true },
    summary: { state: true },
    loadError: { state: true },
  };

  hass?: HomeAssistant;
  /** `undefined` while loading, `null` when no plan is stored. */
  plan?: StoredPlan["plan"];
  options: ViewOptions = { quality: "auto" };
  /** An error to show instead of the plan (e.g. the stored plan could not be fetched). */
  planError?: string;

  protected engineState: EngineState = "idle";
  protected summary?: PlanSummary;
  protected loadError?: string;

  private engine?: DomoTwinEngine;
  private canvas?: HTMLCanvasElement;
  private scheduler?: FrameScheduler;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private generation = 0;
  private background?: Rgb;
  private loadedPlan?: unknown;
  private readonly onVisibility = (): void => {
    this.scheduler?.setPageVisible(document.visibilityState === "visible");
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        min-height: 160px;
        background: var(--card-background-color, #f2f2f0);
      }
      .stage,
      .stage canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        touch-action: none;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        pointer-events: none;
      }
      .message {
        pointer-events: auto;
        max-width: 340px;
        padding: 20px 24px;
        display: grid;
        justify-items: center;
        gap: 8px;
        text-align: center;
      }
      .message svg.icon {
        width: 36px;
        height: 36px;
        color: var(--primary-color, #03a9f4);
      }
      .message.error svg.icon {
        color: var(--error-color, #db4437);
      }
      .message h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      .message p {
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
        line-height: 1.4;
      }
      .chip {
        position: absolute;
        left: 12px;
        bottom: 12px;
        max-width: calc(100% - 24px);
        padding: 8px 14px;
        font-size: 0.875rem;
        display: grid;
        gap: 2px;
      }
      .chip .note {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.8rem;
      }
      .spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-top-color: var(--primary-color, #03a9f4);
        animation: spin 900ms linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  private get translator(): Translator {
    return translatorFor(this.hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.hasUpdated) void this.startEngine();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopEngine();
  }

  protected override firstUpdated(): void {
    void this.startEngine();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("plan")) this.applyPlan();
    if (changed.has("options") && this.engine) {
      this.engine.setQuality(this.options.quality);
      this.scheduler?.request();
    }
    if (changed.has("hass")) this.applyTheme();
  }

  /** Draws a new frame as soon as possible (when visible). */
  requestFrame(): void {
    this.scheduler?.request();
  }

  /** State for tests and diagnostics. */
  debugState(): { engine: EngineState; frames: number; quality?: string; summary?: PlanSummary } {
    const state: { engine: EngineState; frames: number; quality?: string; summary?: PlanSummary } =
      {
        engine: this.engineState,
        frames: this.scheduler?.frames ?? 0,
      };
    if (this.engine) state.quality = this.engine.quality;
    if (this.summary) state.summary = this.summary;
    return state;
  }

  /**
   * Draws a frame and returns the canvas pixels as a PNG data URL, read in the same task so the
   * drawing buffer is still intact (visual regression tests: pixels only, no overlays or fonts).
   */
  captureFrame(): string {
    if (!this.engine || !this.canvas) throw new Error("engine not ready");
    this.engine.invalidate();
    this.engine.frame(performance.now());
    return this.canvas.toDataURL("image/png");
  }

  /** Forces `frames` consecutive frames and measures them (frame-time smoke test). */
  async benchmark(frames = 120): Promise<FrameStats> {
    const engine = this.engine;
    if (!engine) throw new Error("engine not ready");
    const cpu: number[] = [];
    const intervals: number[] = [];
    let last: number | undefined;
    for (let i = 0; i < frames; i += 1) {
      const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      if (last !== undefined) intervals.push(time - last);
      last = time;
      engine.invalidate();
      const start = performance.now();
      engine.frame(time);
      cpu.push(performance.now() - start);
    }
    return {
      frames,
      wasmMemoryBytes: wasmMemoryBytes() ?? 0,
      cpuMedianMs: percentile(cpu, 50),
      cpuP95Ms: percentile(cpu, 95),
      intervalMedianMs: percentile(intervals, 50),
      intervalP95Ms: percentile(intervals, 95),
    };
  }

  private async startEngine(): Promise<void> {
    if (this.canvas) return;
    const stage = this.renderRoot.querySelector<HTMLElement>(".stage");
    if (!stage) return;
    const generation = ++this.generation;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    stage.append(canvas);
    this.canvas = canvas;
    this.engineState = "loading";
    this.resize(stage);

    let engine: DomoTwinEngine;
    try {
      engine = await DomoTwinEngine.create(canvas);
    } catch (error) {
      if (generation !== this.generation) return;
      this.engineState =
        error instanceof EngineError && error.code === "webgl2_unavailable"
          ? "unsupported"
          : "failed";
      return;
    }
    if (generation !== this.generation) {
      engine.dispose();
      return;
    }
    this.engine = engine;
    engine.setQuality(this.options.quality);
    this.scheduler = new FrameScheduler((time) => engine.frame(time));
    this.scheduler.setPageVisible(document.visibilityState === "visible");
    this.resizeObserver = new ResizeObserver(() => {
      this.resize(stage);
    });
    this.resizeObserver.observe(stage);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) this.scheduler?.setOnScreen(entry.isIntersecting);
    });
    this.intersectionObserver.observe(this);
    this.engineState = "ready";
    this.background = undefined;
    this.applyTheme();
    this.loadedPlan = undefined;
    this.applyPlan();
    this.resize(stage);
    this.scheduler.request();
  }

  private stopEngine(): void {
    this.generation += 1;
    this.scheduler?.dispose();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.engine?.dispose();
    // Give the GPU memory back now rather than at garbage collection.
    this.canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas?.remove();
    this.scheduler = undefined;
    this.resizeObserver = undefined;
    this.intersectionObserver = undefined;
    this.engine = undefined;
    this.canvas = undefined;
    this.engineState = "idle";
  }

  private resize(stage: HTMLElement): void {
    if (!this.canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.engine) {
      this.engine.resize(width, height);
      this.scheduler?.request();
    }
  }

  private applyTheme(): void {
    if (!this.engine) return;
    const background = themeBackground(this, FALLBACK_BACKGROUND);
    const previous = this.background;
    if (
      previous?.r === background.r &&
      previous.g === background.g &&
      previous.b === background.b
    ) {
      return;
    }
    this.background = background;
    this.engine.setBackground(background);
    this.scheduler?.request();
  }

  private applyPlan(): void {
    if (!this.engine || this.plan === this.loadedPlan) return;
    this.loadedPlan = this.plan;
    this.summary = undefined;
    this.loadError = undefined;
    if (!this.plan) return;
    try {
      this.summary = this.engine.loadPlan(JSON.stringify(this.plan));
    } catch (error) {
      this.loadError = error instanceof EngineError ? error.code : String(error);
    }
    this.scheduler?.request();
  }

  protected override render(): TemplateResult {
    return html`<div class="stage"></div>
      ${this.renderOverlay()}`;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    const t = this.translator;
    if (this.engineState === "unsupported" || this.engineState === "failed") {
      const text =
        this.engineState === "unsupported"
          ? t.t("view.webgl2_unavailable")
          : t.t("view.engine_failed");
      return this.message(mdiAlertCircleOutline, text, undefined, true);
    }
    if (this.planError) {
      return this.message(mdiAlertCircleOutline, t.error(this.planError), undefined, true);
    }
    if (this.engineState !== "ready" || this.plan === undefined) {
      return html`<div class="overlay" role="status" aria-live="polite">
        <div class="message glass">
          <div class="spinner" aria-hidden="true"></div>
          <p>${t.t("view.loading")}</p>
        </div>
      </div>`;
    }
    if (this.plan === null) {
      const hint = this.hass?.user?.is_admin ? t.t("view.no_plan_admin") : t.t("view.no_plan_user");
      return this.message(mdiFloorPlan, t.t("view.no_plan"), hint, false, true);
    }
    if (this.loadError) {
      return this.message(
        mdiAlertCircleOutline,
        t.t("view.plan_unreadable", { reason: t.error(this.loadError) }),
        undefined,
        true,
      );
    }
    if (!this.summary) return nothing;
    const title = this.summary.title || t.t("view.untitled");
    return html`<div class="chip glass" role="status" data-testid="summary">
      <span
        >${title} · ${t.tp("view.rooms", this.summary.rooms)} ·
        ${t.tp("view.pieces", this.summary.furniture)}</span
      >
      <span class="note">${t.t("view.render_soon")}</span>
    </div>`;
  }

  private message(
    path: string,
    title: string,
    text?: string,
    error = false,
    withAction = false,
  ): TemplateResult {
    return html`<div class="overlay">
      <div class="message glass ${error ? "error" : ""}" role=${error ? "alert" : "status"}>
        ${icon(path)}
        <h2>${title}</h2>
        ${text ? html`<p>${text}</p>` : nothing}
        ${withAction ? html`<slot name="empty-action"></slot>` : nothing}
      </div>
    </div>`;
  }
}
