import {
  mdiAlertCircleOutline,
  mdiCamera,
  mdiCubeOutline,
  mdiFloorPlan,
  mdiHomeOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { themeBackground, type Rgb } from "../color";
import type { CutawayMode, LightingMode, QualityName, ViewMode } from "../config";
import {
  DomoTwinEngine,
  EngineError,
  engineError,
  wasmMemoryBytes,
  type PlanSummary,
  type SavedView,
  type SceneStats,
} from "../engine/engine";
import { GestureTracker, wheelFactor, type Gesture, type PointerSample } from "../gestures";
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
  /** View shown first. */
  view?: ViewMode;
  cutaway?: CutawayMode;
  /** The light: following the time of day (`auto`, the default) or fixed. */
  lighting?: LightingMode;
  /** Room framed first (an element id of the plan). */
  room?: string;
}

/** Device pixel ratio cap: sharper than this costs fill rate for little visible gain. */
const MAX_PIXEL_RATIO = 2;
/** Adaptive resolution: lowest scale of the drawing buffer, and frame budgets (ms of CPU). */
const MIN_RESOLUTION = 0.6;
const SLOW_FRAME_MS = 22;
const FAST_FRAME_MS = 8;
/** Keyboard steps: pixels of drag per arrow press, zoom factor per +/- press. */
const KEY_STEP = 40;
const KEY_ZOOM = 0.85;
/** How often the light follows the time of day without a `hass` update (ms). */
const LIGHT_REFRESH_MS = 5 * 60 * 1000;
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

/** What `debugState()` reports. */
export interface DebugState {
  engine: EngineState;
  frames: number;
  planView: boolean;
  resolution: number;
  /** What the light follows: `mood:<name>`, `sun:<elevation>:<rising>` or `clock:<hour>`. */
  light?: string;
  quality?: string;
  summary?: PlanSummary;
  stats?: SceneStats;
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
    planView: { state: true },
    savedViews: { state: true },
    viewsOpen: { state: true },
  };

  hass?: HomeAssistant;
  /** `undefined` while loading, `null` when no plan is stored. */
  plan?: StoredPlan["plan"];
  options: ViewOptions = { quality: "auto" };
  /** An error to show instead of the plan (e.g. the stored plan could not be fetched). */
  planError?: string;

  protected engineState: EngineState = "idle";
  protected summary?: PlanSummary;
  protected loadError?: EngineError;
  protected planView = false;
  protected savedViews: SavedView[] = [];
  protected viewsOpen = false;

  private engine?: DomoTwinEngine;
  private canvas?: HTMLCanvasElement;
  private scheduler?: FrameScheduler;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private generation = 0;
  private background?: Rgb;
  private loadedPlan?: unknown;
  private readonly gestures = new GestureTracker();
  /** Scale of the drawing buffer, lowered while frames are slow. */
  private resolution = 1;
  private frameCost = 0;
  private lastResolutionChange = 0;
  private stage?: HTMLElement;
  /** What the light was last set from (mood, sun position or clock), to skip repeats. */
  private lightKey?: string;
  private lightTimer?: number;
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
      .stage {
        cursor: grab;
        outline: none;
      }
      .stage:active {
        cursor: grabbing;
      }
      .stage:focus-visible {
        box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
      }
      .tools {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
      }
      .tools button {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color, #1f2328);
        cursor: pointer;
      }
      .tools button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .tools button[aria-pressed="true"] {
        color: var(--primary-color, #03a9f4);
      }
      .views {
        position: absolute;
        top: 12px;
        right: 68px;
        min-width: 160px;
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 6px;
        display: grid;
      }
      .views button {
        min-height: 40px;
        padding: 0 12px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .views button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
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
      const previous = changed.get("options");
      this.engine.setQuality(this.options.quality);
      this.engine.setCutaway(this.options.cutaway ?? "auto");
      this.applyLighting();
      if (previous?.view !== this.options.view) this.setPlanView(this.options.view === "2d");
      this.scheduler?.request();
    }
    if (changed.has("hass")) {
      this.applyTheme();
      this.applyLighting();
    }
  }

  /** Draws a new frame as soon as possible (when visible). */
  requestFrame(): void {
    this.scheduler?.request();
  }

  /** State for tests and diagnostics. */
  debugState(): DebugState {
    const state: DebugState = {
      engine: this.engineState,
      frames: this.scheduler?.frames ?? 0,
      planView: this.planView,
      resolution: this.resolution,
    };
    if (this.lightKey) state.light = this.lightKey;
    if (this.engine) {
      state.quality = this.engine.quality;
      state.stats = this.engine.stats;
    }
    if (this.summary) state.summary = this.summary;
    return state;
  }

  /** Shows the 2D plan or the 3D view. */
  setPlanView(plan: boolean): void {
    this.viewsOpen = false;
    if (!this.engine || this.engine.planView === plan) {
      this.planView = plan;
      return;
    }
    this.engine.setPlanView(plan);
    this.planView = plan;
    this.scheduler?.request();
  }

  /** Back to the whole home. */
  overview(): void {
    this.viewsOpen = false;
    this.engine?.overview();
    this.scheduler?.request();
  }

  /** The element at a point of the view (CSS pixels from its top left). */
  elementAt(x: number, y: number): { id: string; type: string } | undefined {
    if (!this.engine || !this.canvas) return undefined;
    const scale = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    return this.engine.pick(x * scale, y * scale);
  }

  /**
   * Draws a frame and returns the canvas pixels as a PNG data URL, read in the same task so the
   * drawing buffer is still intact (visual regression tests: pixels only, no overlays or fonts).
   */
  captureFrame(): string {
    if (!this.engine || !this.canvas) throw new Error("engine not ready");
    this.settle();
    this.engine.invalidate();
    this.engine.frame(performance.now());
    return this.canvas.toDataURL("image/png");
  }

  /** Runs camera moves and wall animations to their end at once (tests). */
  settle(): void {
    const engine = this.engine;
    if (!engine) return;
    let time = performance.now();
    for (let i = 0; i < 300 && engine.frame(time); i += 1) time += 100;
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
    this.stage = stage;
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
    engine.setCutaway(this.options.cutaway ?? "auto");
    this.lightKey = undefined;
    this.scheduler = new FrameScheduler((time) => this.drawFrame(engine, time));
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
    this.applyLighting();
    this.lightTimer = window.setInterval(() => {
      this.applyLighting();
    }, LIGHT_REFRESH_MS);
    this.loadedPlan = undefined;
    this.applyPlan();
    this.resize(stage);
    this.scheduler.request();
  }

  private stopEngine(): void {
    this.generation += 1;
    this.scheduler?.dispose();
    window.clearInterval(this.lightTimer);
    this.lightTimer = undefined;
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

  /** Draws a frame and adapts the resolution to how long frames take. */
  private drawFrame(engine: DomoTwinEngine, time: number): boolean {
    const start = performance.now();
    const more = engine.frame(time);
    const cost = performance.now() - start;
    this.frameCost = this.frameCost === 0 ? cost : this.frameCost * 0.8 + cost * 0.2;
    // Only animations tell: a single frame after an idle period is not representative.
    if (more && time - this.lastResolutionChange > 600 && this.stage) {
      const slow = this.frameCost > SLOW_FRAME_MS && this.resolution > MIN_RESOLUTION;
      const fast = this.frameCost < FAST_FRAME_MS && this.resolution < 1;
      if (slow || fast) {
        this.resolution = slow
          ? Math.max(MIN_RESOLUTION, this.resolution * 0.85)
          : Math.min(1, this.resolution / 0.85);
        this.lastResolutionChange = time;
        this.resize(this.stage);
      }
    }
    return more;
  }

  private resize(stage: HTMLElement): void {
    if (!this.canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.resolution;
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

  /**
   * Sets the light: a fixed mood, or the time of day from Home Assistant's sun (`sun.sun`), or
   * from the local clock when there is no sun entity. Small changes are skipped.
   */
  private applyLighting(): void {
    const engine = this.engine;
    if (!engine) return;
    const mode = this.options.lighting ?? "auto";
    let key: string;
    let apply: () => void;
    if (mode !== "auto") {
      key = `mood:${mode}`;
      apply = () => {
        engine.setLightingMood(mode);
      };
    } else {
      const sun = this.hass?.states["sun.sun"];
      const elevation = Number(sun?.attributes.elevation);
      if (sun && Number.isFinite(elevation)) {
        const rounded = Math.round(elevation * 2) / 2;
        const rising = sun.attributes.rising === true;
        key = `sun:${rounded}:${rising}`;
        apply = () => {
          engine.setSun(rounded, rising);
        };
      } else {
        const now = new Date();
        const hour = Math.round((now.getHours() + now.getMinutes() / 60) * 12) / 12;
        key = `clock:${hour}`;
        apply = () => {
          engine.setLocalHour(hour);
        };
      }
    }
    if (key === this.lightKey) return;
    this.lightKey = key;
    apply();
    this.scheduler?.request();
  }

  private applyPlan(): void {
    if (!this.engine || this.plan === this.loadedPlan) return;
    const sameHome = this.loadedPlan !== undefined && this.loadedPlan !== null;
    this.loadedPlan = this.plan;
    this.summary = undefined;
    this.loadError = undefined;
    this.savedViews = [];
    if (!this.plan) return;
    try {
      this.summary = this.engine.loadPlan(JSON.stringify(this.plan), sameHome);
      this.savedViews = this.engine.views();
      if (!sameHome) {
        if (this.options.view === "2d") this.setPlanView(true);
        if (this.options.room) this.engine.focusElement(this.options.room);
      }
    } catch (error) {
      this.loadError = error instanceof EngineError ? error : engineError(error);
    }
    this.scheduler?.request();
  }

  private sample(event: PointerEvent): PointerSample {
    return {
      pointerId: event.pointerId,
      x: event.offsetX,
      y: event.offsetY,
      button: event.button,
      shiftKey: event.shiftKey,
      time: event.timeStamp,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.engine) return;
    this.viewsOpen = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.apply(this.gestures.down(this.sample(event)));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.gestures.active === 0) return;
    this.apply(this.gestures.move(this.sample(event)));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.apply(this.gestures.up(this.sample(event)));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.gestures.cancel(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.engine) return;
    event.preventDefault();
    this.apply([
      {
        kind: "zoom",
        factor: wheelFactor(event.deltaY, event.deltaMode),
        x: event.offsetX,
        y: event.offsetY,
      },
    ]);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const keys: Record<string, Gesture | undefined> = {
      ArrowLeft: { kind: event.shiftKey ? "pan" : "drag", dx: -KEY_STEP, dy: 0 },
      ArrowRight: { kind: event.shiftKey ? "pan" : "drag", dx: KEY_STEP, dy: 0 },
      ArrowUp: { kind: event.shiftKey ? "pan" : "drag", dx: 0, dy: -KEY_STEP },
      ArrowDown: { kind: event.shiftKey ? "pan" : "drag", dx: 0, dy: KEY_STEP },
    };
    const stage = this.stage;
    const centre = { x: (stage?.clientWidth ?? 0) / 2, y: (stage?.clientHeight ?? 0) / 2 };
    let gesture = keys[event.key];
    if (event.key === "+" || event.key === "=")
      gesture = { kind: "zoom", factor: KEY_ZOOM, ...centre };
    if (event.key === "-") gesture = { kind: "zoom", factor: 1 / KEY_ZOOM, ...centre };
    if (event.key === "Home") {
      event.preventDefault();
      this.overview();
      return;
    }
    if (!gesture) return;
    event.preventDefault();
    this.apply([gesture]);
  };

  /** Applies gestures to the camera. */
  private apply(gestures: Gesture[]): void {
    const engine = this.engine;
    const stage = this.stage;
    if (!engine || !stage || gestures.length === 0) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    for (const gesture of gestures) {
      switch (gesture.kind) {
        case "drag":
          if (this.planView) engine.pan(gesture.dx, gesture.dy, height);
          else engine.orbit(gesture.dx, gesture.dy);
          break;
        case "pan":
          engine.pan(gesture.dx, gesture.dy, height);
          break;
        case "zoom":
          engine.zoom(gesture.factor, (gesture.x / width) * 2 - 1, 1 - (gesture.y / height) * 2);
          break;
        case "tap": {
          const picked = this.elementAt(gesture.x, gesture.y);
          if (picked?.type === "room") engine.focusElement(picked.id);
          break;
        }
        case "double-tap":
          engine.overview();
          break;
      }
    }
    this.scheduler?.request();
  }

  private readonly toggleViews = (): void => {
    this.viewsOpen = !this.viewsOpen;
  };

  private showView(id: string): void {
    this.viewsOpen = false;
    if (this.engine?.showView(id)) {
      this.planView = false;
      this.scheduler?.request();
    }
  }

  protected override render(): TemplateResult {
    const t = this.translator;
    const ready = this.engineState === "ready" && this.summary !== undefined;
    const title = this.summary?.title || t.t("view.untitled");
    return html`<div
        class="stage"
        tabindex=${ready ? "0" : "-1"}
        role=${ready ? "img" : nothing}
        aria-label=${ready ? t.t("view.canvas_label", { title }) : nothing}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @wheel=${this.onWheel}
        @keydown=${this.onKeyDown}
        @contextmenu=${(event: Event) => {
          event.preventDefault();
        }}
      ></div>
      ${this.renderOverlay()} ${ready ? this.renderTools() : nothing}`;
  }

  private renderTools(): TemplateResult {
    const t = this.translator;
    const plan = this.planView;
    return html`<div class="tools glass" role="toolbar" aria-label=${t.t("view.toolbar")}>
        <button
          data-testid="toggle-plan"
          aria-pressed=${plan ? "true" : "false"}
          title=${plan ? t.t("view.show_3d") : t.t("view.show_plan")}
          aria-label=${plan ? t.t("view.show_3d") : t.t("view.show_plan")}
          @click=${() => {
            this.setPlanView(!plan);
          }}
        >
          ${icon(plan ? mdiCubeOutline : mdiFloorPlan)}
        </button>
        <button
          data-testid="overview"
          title=${t.t("view.overview")}
          aria-label=${t.t("view.overview")}
          @click=${() => {
            this.overview();
          }}
        >
          ${icon(mdiHomeOutline)}
        </button>
        ${
          this.savedViews.length > 0
            ? html`<button
                data-testid="views"
                title=${t.t("view.views")}
                aria-label=${t.t("view.views")}
                aria-haspopup="menu"
                aria-expanded=${this.viewsOpen ? "true" : "false"}
                @click=${this.toggleViews}
              >
                ${icon(mdiCamera)}
              </button>`
            : nothing
        }
      </div>
      ${
        this.viewsOpen
          ? html`<div class="views glass" role="menu" aria-label=${t.t("view.views")}>
              ${this.savedViews.map(
                (view) =>
                  html`<button
                    role="menuitem"
                    @click=${() => {
                      this.showView(view.id);
                    }}
                  >
                    ${view.name}
                  </button>`,
              )}
            </div>`
          : nothing
      }`;
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
        t.t("view.plan_unreadable", {
          reason: t.errorAt(this.loadError.code, this.loadError.element),
        }),
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
