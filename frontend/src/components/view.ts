import {
  mdiAlertCircleOutline,
  mdiCamera,
  mdiChevronUp,
  mdiCubeOutline,
  mdiFloorPlan,
  mdiHomeOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";

import { themeBackground, type Rgb } from "../color";
import type { CutawayMode, LightingMode, QualityName, ViewMode } from "../config";
import {
  DomoTwinEngine,
  EngineError,
  engineError,
  wasmMemoryBytes,
  type EditState,
  type PickedElement,
  type PlanSummary,
  type SavedView,
  type SceneStats,
} from "../engine/engine";
import {
  GestureTracker,
  HOLD_TIME,
  TAP_SLOP,
  wheelFactor,
  type Gesture,
  type PointerSample,
} from "../gestures";
import type { StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { runAction } from "../live/actions";
import {
  boundEntityIds,
  entityName,
  holdAction,
  primaryEntity,
  roomArea,
  tapAction,
  type Action,
  type BindingsJson,
  type ElementBinding,
} from "../live/bindings";
import { StateSync } from "../live/states";
import { FrameScheduler } from "../scheduler";
import { fire } from "./define";
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
/** How long a notice (a failed action) stays (ms). */
const NOTICE_MS = 5000;

/** The panel open over the scene: an element's controls or a room's panel. */
type Sheet =
  | { kind: "controls"; heading: string; entities: string[] }
  | { kind: "room"; heading: string; area?: string };

/** A room framed by a tap. */
interface FocusedRoom {
  id: string;
  name: string;
}

/** What the edit bar asks the view to do. */
export type EditCommand = "undo" | "redo" | "rotate-left" | "rotate-right" | "remove" | "clear";

/** Edit mode's keys: Delete, R (Shift+R the other way), Ctrl+Z, Ctrl+Y, Escape. */
export function editCommandFor(event: KeyboardEvent): EditCommand | undefined {
  const control = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === "Delete" || event.key === "Backspace") return "remove";
  if (key === "r" && !control) return event.shiftKey ? "rotate-left" : "rotate-right";
  if (key === "z" && control) return event.shiftKey ? "redo" : "undo";
  if (key === "y" && control) return "redo";
  if (event.key === "Escape") return "clear";
  return undefined;
}

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
  /** The open panel: `controls:<entities>` or `room:<area>`. */
  sheet?: string;
  /** Edit mode, when on. */
  edit?: { selection: string[]; conflicts: string[]; guides: number; dirty: boolean };
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
    layout: { attribute: false },
    bindings: { attribute: false },
    linking: { attribute: false },
    editing: { attribute: false },
    multiSelect: { attribute: false },
    editKeys: { attribute: false },
    options: { attribute: false },
    planError: { attribute: false },
    engineState: { state: true },
    summary: { state: true },
    loadError: { state: true },
    planView: { state: true },
    savedViews: { state: true },
    viewsOpen: { state: true },
    sheet: { state: true },
    focusedRoom: { state: true },
    notice: { state: true },
    edit: { state: true },
  };

  hass?: HomeAssistant;
  /** `undefined` while loading, `null` when no plan is stored. */
  plan?: StoredPlan["plan"];
  /** The edit overlay applied to the plan (pieces moved, removed or added in edit mode). */
  layout?: StoredPlan["layout"];
  /** What the plan's elements and rooms are bound to (`undefined`: nothing bound). */
  bindings?: BindingsJson;
  /**
   * Link mode (the panel's bindings editor): taps and long presses pick an element
   * (`domotwin-pick`, detail: the picked element) instead of acting.
   */
  linking = false;
  /**
   * Edit mode (the panel's): a tap selects a piece, dragging a selected piece moves it. Every
   * change fires `domotwin-edit` (detail: the `EditState`).
   */
  editing = false;
  /** In edit mode, taps add pieces to the selection (or take them out). */
  multiSelect = false;
  /** Edit mode's keys act (not while the panel shows a dialog over the view). */
  editKeys = true;
  options: ViewOptions = { quality: "auto" };
  /** An error to show instead of the plan (e.g. the stored plan could not be fetched). */
  planError?: string;

  protected engineState: EngineState = "idle";
  protected summary?: PlanSummary;
  protected loadError?: EngineError;
  protected planView = false;
  protected savedViews: SavedView[] = [];
  protected viewsOpen = false;
  protected sheet?: Sheet;
  protected focusedRoom?: FocusedRoom;
  protected notice?: string;
  /** The edit session's state while edit mode is on. */
  protected edit?: EditState;

  private engine?: DomoTwinEngine;
  private canvas?: HTMLCanvasElement;
  private scheduler?: FrameScheduler;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private generation = 0;
  private background?: Rgb;
  private loadedPlan?: unknown;
  private loadedLayout?: unknown;
  private readonly gestures = new GestureTracker();
  /** Scale of the drawing buffer, lowered while frames are slow. */
  private resolution = 1;
  private frameCost = 0;
  private lastResolutionChange = 0;
  private stage?: HTMLElement;
  /** What the light was last set from (mood, sun position or clock), to skip repeats. */
  private lightKey?: string;
  private lightTimer?: number;
  /** Entity states already sent to the engine, and the entities bound. */
  private readonly states = new StateSync();
  private bound = new Set<string>();
  private holdTimer?: number;
  private noticeTimer?: number;
  /**
   * The pointer that grabbed pieces in edit mode, where it was pressed, whether it has moved past
   * the tap distance (before that, nothing moves), and where it waits to be applied.
   */
  private dragPointer?: number;
  private dragFrom?: { x: number; y: number };
  private dragging = false;
  /** The press on a selected piece was held: a long press, not a tap. */
  private dragHeld = false;
  private dragTo?: { x: number; y: number };
  /** Ctrl, Cmd or Shift held at the last press: a tap adds to the selection. */
  private addModifier = false;
  /** The panels' module, loaded the first time one opens. */
  private sheets?: Promise<unknown>;
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
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
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
      button.chip {
        display: flex;
        align-items: center;
        gap: 6px;
        border: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.chip svg.icon {
        width: 18px;
        height: 18px;
      }
      .notice {
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        max-width: calc(100% - 120px);
        padding: 8px 14px;
        font-size: 0.875rem;
        border-color: var(--error-color, #db4437);
      }
      .guides {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }
      .guides line {
        stroke-linecap: round;
      }
      .guides .snap {
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 1.5;
        stroke-dasharray: 6 4;
      }
      .guides .distance {
        stroke: var(--primary-text-color, #1f2328);
        stroke-opacity: 0.55;
        stroke-width: 1;
      }
      .guides text {
        font-size: 12px;
        font-weight: 600;
        fill: var(--primary-text-color, #1f2328);
        stroke: var(--card-background-color, #fff);
        stroke-width: 3px;
        paint-order: stroke;
        text-anchor: middle;
        dominant-baseline: middle;
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
    window.removeEventListener("keydown", this.onEditKey);
    window.clearTimeout(this.noticeTimer);
    this.stopEngine();
  }

  protected override firstUpdated(): void {
    void this.startEngine();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("bindings")) this.applyBindings();
    if (changed.has("editing")) this.applyEditing();
    if (changed.has("plan") || changed.has("layout")) this.applyPlan();
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
      this.syncStates();
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
    const sheet = this.sheet;
    if (sheet) {
      state.sheet =
        sheet.kind === "controls"
          ? `controls:${sheet.entities.join(",")}`
          : `room:${sheet.area ?? ""}`;
    }
    const edit = this.edit;
    if (edit) {
      state.edit = {
        selection: edit.selection.map((piece) => piece.id),
        conflicts: edit.conflicts,
        guides: edit.guides.length,
        dirty: edit.dirty,
      };
    }
    return state;
  }

  /** Runs a command of the edit bar. */
  editCommand(command: EditCommand): void {
    const engine = this.engine;
    if (!engine || !this.edit) return;
    switch (command) {
      case "undo":
        this.setEdit(engine.editUndo());
        break;
      case "redo":
        this.setEdit(engine.editRedo());
        break;
      case "rotate-left":
        this.setEdit(engine.editRotate(-1));
        break;
      case "rotate-right":
        this.setEdit(engine.editRotate(1));
        break;
      case "remove":
        this.setEdit(engine.editRemove());
        break;
      case "clear":
        this.setEdit(engine.editSelect("", false));
        break;
    }
  }

  /** Adds a piece of the catalogue in the middle of the view and selects it. */
  editAdd(kind: string, name: string): void {
    const engine = this.engine;
    const canvas = this.canvas;
    if (!engine || !canvas || !this.edit) return;
    const state = engine.editAdd(kind, name, canvas.width / 2, canvas.height / 2);
    this.setEdit(state);
    if (state.refused) this.notify(this.translator.t("edit.too_many"));
  }

  /** Puts a draft overlay in place, as one change that can be undone. */
  editRestore(layout: Record<string, unknown>): void {
    if (this.engine && this.edit) this.setEdit(this.engine.editRestore(layout));
  }

  /** The edit overlay now (what Save stores). */
  editLayout(): Record<string, unknown> | undefined {
    return this.edit ? this.engine?.editLayout() : undefined;
  }

  /** The overlay `layout` (what was sent) was stored. */
  editSaved(layout: Record<string, unknown>): void {
    if (!this.engine || !this.edit) return;
    this.engine.editSaved(layout);
    this.setEdit(this.engine.editState);
  }

  /**
   * Leaves edit mode, keeping the changes shown (`keep`) or going back to what was saved, then
   * shows the plan changes that came while editing.
   */
  endEdit(keep: boolean): void {
    if (!this.edit) return;
    this.engine?.endEdit(keep);
    this.edit = undefined;
    window.removeEventListener("keydown", this.onEditKey);
    window.clearTimeout(this.holdTimer);
    this.dragPointer = undefined;
    this.dragTo = undefined;
    this.dragHeld = false;
    this.applyPlan();
    this.scheduler?.request();
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
    this.focusedRoom = undefined;
    this.engine?.overview();
    this.scheduler?.request();
  }

  /** Frames an element of the plan; false when it has nothing to show. */
  showElement(id: string): boolean {
    const done = this.engine?.focusElement(id) ?? false;
    this.scheduler?.request();
    return done;
  }

  /** What a tap at a point of the view does (CSS pixels from its top left). */
  tap(x: number, y: number): void {
    this.sheet = undefined;
    const engine = this.engine;
    if (!engine) return;
    if (this.edit) {
      // Edit mode: a tap selects a piece (anything else clears the selection).
      const picked = this.elementAt(x, y);
      const id = picked?.type === "furniture" ? picked.id : "";
      this.gestures.forgetTap();
      this.setEdit(engine.editSelect(id, this.multiSelect || this.addModifier));
      return;
    }
    const picked = this.elementAt(x, y);
    if (!picked) return;
    if (this.linking) {
      this.pick(picked);
      return;
    }
    const binding = this.bindings?.elements[picked.id];
    if (binding && this.hass) {
      engine.highlight(picked.id);
      // An action ran: a second tap soon after is a new tap, not a double tap.
      this.gestures.forgetTap();
      void this.act(tapAction(binding, this.hass), binding, picked);
    } else if (picked.room && engine.focusElement(picked.room)) {
      this.focusedRoom = { id: picked.room, name: this.roomName(picked) };
    }
    this.scheduler?.request();
  }

  /** What a long press at a point of the view does (CSS pixels from its top left). */
  hold(x: number, y: number): void {
    const picked = this.elementAt(x, y);
    if (this.edit) {
      // Edit mode: a long press adds a piece to the selection (or takes it out).
      if (picked?.type === "furniture" && this.engine) {
        this.setEdit(this.engine.editSelect(picked.id, true));
      }
      return;
    }
    if (!picked) return;
    if (this.linking) {
      this.pick(picked);
      return;
    }
    const binding = this.bindings?.elements[picked.id];
    if (binding && this.hass) {
      this.engine?.highlight(picked.id);
      void this.act(holdAction(binding), binding, picked);
    } else if (picked.room) {
      void this.openRoom(picked.room, this.roomName(picked));
    }
    this.scheduler?.request();
  }

  /** The element at a point of the view (CSS pixels from its top left). */
  elementAt(x: number, y: number): PickedElement | undefined {
    if (!this.engine || !this.canvas) return undefined;
    const scale = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    return this.engine.pick(x * scale, y * scale);
  }

  /** Device pixels of the drawing buffer for a point of the view in CSS pixels. */
  private devicePoint(x: number, y: number): { x: number; y: number } {
    const scale = this.canvas ? this.canvas.width / Math.max(1, this.canvas.clientWidth) : 1;
    return { x: x * scale, y: y * scale };
  }

  /** Where an element's centre is drawn (CSS pixels from the top left of the view), if anywhere. */
  elementPoint(id: string): { x: number; y: number } | undefined {
    if (!this.engine || !this.canvas) return undefined;
    const point = this.engine.screenPoint(id);
    if (!point) return undefined;
    const scale = Math.max(1, this.canvas.clientWidth) / this.canvas.width;
    return { x: point[0] * scale, y: point[1] * scale };
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
    this.states.reset();
    this.applyBindings();
    this.loadedPlan = undefined;
    this.loadedLayout = undefined;
    this.edit = undefined;
    this.applyPlan();
    this.applyEditing();
    this.resize(stage);
    this.scheduler.request();
  }

  private stopEngine(): void {
    this.generation += 1;
    this.scheduler?.dispose();
    window.clearInterval(this.lightTimer);
    window.clearTimeout(this.holdTimer);
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
    this.flushDrag();
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

  /** Starts or ends the engine's edit session to follow `editing`. */
  private applyEditing(): void {
    const engine = this.engine;
    if (!engine) return;
    if (this.editing && !this.edit && this.summary) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
      this.viewsOpen = false;
      this.setEdit(engine.beginEdit());
    } else if (!this.editing && this.edit) {
      this.endEdit(true);
    }
  }

  private setEdit(state: EditState): void {
    const was = this.edit !== undefined;
    this.edit = state.editing ? state : undefined;
    if (!was && this.edit) window.addEventListener("keydown", this.onEditKey);
    if (was && !this.edit) window.removeEventListener("keydown", this.onEditKey);
    fire(this, "domotwin-edit", state);
    this.scheduler?.request();
  }

  /** Moves the dragged pieces to the last pointer position, once per frame. */
  private flushDrag(): void {
    const to = this.dragTo;
    if (!to || !this.engine || this.dragPointer === undefined) return;
    this.dragTo = undefined;
    const point = this.devicePoint(to.x, to.y);
    this.setEdit(this.engine.editDragMove(point.x, point.y));
  }

  private endDrag(): void {
    if (this.dragPointer === undefined || !this.engine) return;
    this.flushDrag();
    this.dragPointer = undefined;
    this.dragFrom = undefined;
    this.dragging = false;
    this.dragHeld = false;
    this.setEdit(this.engine.editDragEnd());
  }

  private applyPlan(): void {
    // Not while editing: the session works on the plan shown; changes wait for its end.
    if (
      !this.engine ||
      this.edit ||
      (this.plan === this.loadedPlan && this.layout === this.loadedLayout)
    ) {
      return;
    }
    const sameHome = this.loadedPlan !== undefined && this.loadedPlan !== null;
    this.loadedPlan = this.plan;
    this.loadedLayout = this.layout;
    if (!sameHome) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
    }
    this.summary = undefined;
    this.loadError = undefined;
    this.savedViews = [];
    if (!this.plan) return;
    try {
      this.summary = this.engine.loadPlan(
        JSON.stringify(this.plan),
        sameHome,
        this.layout ? JSON.stringify(this.layout) : undefined,
      );
      const refused = this.summary.layoutRefused ?? 0;
      if (refused > 0) this.notify(this.translator.tp("view.layout_refused", refused));
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

  private pick(picked: PickedElement): void {
    this.engine?.highlight(picked.id);
    this.gestures.forgetTap();
    fire(this, "domotwin-pick", picked);
    this.scheduler?.request();
  }

  /** Sends the bindings to the engine, then the states of the entities now bound. */
  private applyBindings(): void {
    const engine = this.engine;
    if (!engine) return;
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    engine.setBindings(JSON.stringify(bindings));
    this.bound = boundEntityIds(bindings);
    this.syncStates();
    this.scheduler?.request();
  }

  /** Sends the engine the bound entities whose state changed. */
  private syncStates(): void {
    const engine = this.engine;
    if (!engine || !this.hass) return;
    const changes = this.states.changes(this.hass, this.bound);
    if (changes === undefined) return;
    engine.setStates(changes);
    this.scheduler?.request();
  }

  private roomName(picked: PickedElement): string {
    if (picked.type === "room" && picked.name) return picked.name;
    return this.focusedRoom?.id === picked.room ? this.focusedRoom.name : picked.room;
  }

  /** Runs an action of a binding; `controls` opens the element's panel. */
  private async act(action: Action, binding: ElementBinding, picked: PickedElement): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      if ((await runAction(this, hass, action, binding)) === "controls") {
        await this.openControls(binding, picked);
      }
    } catch (error) {
      const t = this.translator;
      const reason = isHassError(error)
        ? error.message || t.error(error.code)
        : t.error(error instanceof Error ? error.name : "unknown");
      this.notify(t.t("view.action_failed", { reason }));
    }
  }

  private loadSheets(): Promise<unknown> {
    this.sheets ??= import("./sheets");
    this.sheets.catch(() => (this.sheets = undefined));
    return this.sheets;
  }

  private async openControls(binding: ElementBinding, picked: PickedElement): Promise<void> {
    await this.loadSheets();
    const hass = this.hass;
    const primary = primaryEntity(binding, hass);
    const heading = picked.name || (hass && primary ? entityName(hass, primary) : picked.id);
    this.sheet = {
      kind: "controls",
      heading,
      entities: binding.entities.map((entity) => entity.entity_id),
    };
  }

  private async openRoom(id: string, name: string): Promise<void> {
    await this.loadSheets();
    const hass = this.hass;
    const sheet: Sheet = { kind: "room", heading: name };
    const area = hass
      ? roomArea(hass, this.bindings ?? { version: 1, rooms: {}, elements: {} }, id, name)
      : undefined;
    if (area) sheet.area = area;
    this.sheet = sheet;
  }

  private readonly closeSheet = (): void => {
    this.sheet = undefined;
  };

  private notify(text: string): void {
    this.notice = text;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice = undefined), NOTICE_MS);
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
    this.addModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (
      this.edit &&
      this.dragPointer === undefined &&
      this.gestures.active === 0 &&
      event.button === 0 &&
      !event.shiftKey
    ) {
      // Edit mode: pressing a selected piece grabs it.
      const point = this.devicePoint(event.offsetX, event.offsetY);
      if (this.engine.editDragStart(point.x, point.y)) {
        const from = { x: event.offsetX, y: event.offsetY };
        this.dragPointer = event.pointerId;
        this.dragFrom = from;
        this.dragging = false;
        this.dragHeld = false;
        // Held still: a long press (adds to the selection or takes out), not a drag.
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          if (this.dragPointer !== event.pointerId || this.dragging) return;
          this.dragHeld = true;
          this.hold(from.x, from.y);
        }, HOLD_TIME + 20);
        return;
      }
    }
    this.apply(this.gestures.down(this.sample(event)));
    window.clearTimeout(this.holdTimer);
    if (this.gestures.active === 1) {
      this.holdTimer = window.setTimeout(() => {
        this.apply(this.gestures.hold(performance.now()));
      }, HOLD_TIME + 20);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointer) {
      const from = this.dragFrom;
      this.dragging ||=
        !from || Math.hypot(event.offsetX - from.x, event.offsetY - from.y) >= TAP_SLOP;
      if (this.dragging) {
        this.dragTo = { x: event.offsetX, y: event.offsetY };
        this.scheduler?.request();
      }
      return;
    }
    if (this.gestures.active === 0) return;
    this.apply(this.gestures.move(this.sample(event)));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    window.clearTimeout(this.holdTimer);
    if (event.pointerId === this.dragPointer) {
      const moved = this.dragging;
      const held = this.dragHeld;
      if (moved) this.dragTo = { x: event.offsetX, y: event.offsetY };
      this.endDrag();
      // Pressed without moving: a tap (selects this piece alone, or toggles it).
      if (!moved && !held) this.tap(event.offsetX, event.offsetY);
      return;
    }
    this.apply(this.gestures.up(this.sample(event)));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    window.clearTimeout(this.holdTimer);
    if (event.pointerId === this.dragPointer) {
      this.endDrag();
      return;
    }
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

  /**
   * Edit mode's keys work anywhere on the page, except while typing or while the panel shows a
   * dialog over the view (`editKeys` off).
   */
  private readonly onEditKey = (event: KeyboardEvent): void => {
    if (!this.edit || !this.editKeys || event.defaultPrevented) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }
    const command = editCommandFor(event);
    if (!command) return;
    event.preventDefault();
    this.editCommand(command);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Edit mode's keys are handled on the window (onEditKey).
    if (this.edit && editCommandFor(event)) return;
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
    if (event.key === "Enter" && this.focusedRoom) {
      event.preventDefault();
      void this.openRoom(this.focusedRoom.id, this.focusedRoom.name);
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
        case "tap":
          this.tap(gesture.x, gesture.y);
          break;
        case "hold":
          this.hold(gesture.x, gesture.y);
          break;
        case "double-tap":
          this.overview();
          break;
      }
    }
    this.scheduler?.request();
  }

  private readonly toggleViews = (): void => {
    this.viewsOpen = !this.viewsOpen;
    this.sheet = undefined;
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
      ${this.renderGuides()} ${this.renderOverlay()} ${ready ? this.renderTools() : nothing}
      ${ready ? this.renderSheet() : nothing}
      ${
        this.notice
          ? html`<div class="notice glass" role="alert" data-testid="notice">${this.notice}</div>`
          : nothing
      }`;
  }

  /** Edit mode's guides: the faces a piece snapped onto, and its distances to the walls. */
  private renderGuides(): TemplateResult | typeof nothing {
    const guides = this.edit?.guides;
    const canvas = this.canvas;
    if (!guides || guides.length === 0 || !canvas) return nothing;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    const format = new Intl.NumberFormat(this.translator.language, { maximumFractionDigits: 0 });
    return html`<svg class="guides" aria-hidden="true" data-testid="guides">
      ${guides.map((guide) => {
        const [x1, y1, x2, y2] = [guide.a[0] * k, guide.a[1] * k, guide.b[0] * k, guide.b[1] * k];
        if (guide.cm === undefined) {
          return svg`<line class="snap" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
        }
        if (guide.cm < 1 || Math.hypot(x2 - x1, y2 - y1) < 24) return nothing;
        return svg`<line class="distance" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
          <text x=${(x1 + x2) / 2} y=${(y1 + y2) / 2}>${format.format(guide.cm)} cm</text>`;
      })}
    </svg>`;
  }

  private renderSheet(): TemplateResult | typeof nothing {
    const sheet = this.sheet;
    if (!sheet) return nothing;
    if (sheet.kind === "controls") {
      return html`<domotwin-controls
        data-testid="controls"
        .hass=${this.hass}
        .heading=${sheet.heading}
        .entities=${sheet.entities}
        @domotwin-close=${this.closeSheet}
      ></domotwin-controls>`;
    }
    return html`<domotwin-room
      data-testid="room"
      .hass=${this.hass}
      .heading=${sheet.heading}
      .area=${sheet.area}
      .admin=${this.hass?.user?.is_admin === true}
      @domotwin-close=${this.closeSheet}
    ></domotwin-room>`;
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
    if (!this.summary || this.sheet || this.edit) return nothing;
    if (this.linking) {
      return html`<div class="chip glass" role="status" data-testid="link-hint">
        ${t.t("link.hint")}
      </div>`;
    }
    const room = this.focusedRoom;
    if (room) {
      return html`<button
        class="chip glass"
        data-testid="room-chip"
        aria-label=${t.t("view.room_panel", { room: room.name })}
        @click=${() => {
          void this.openRoom(room.id, room.name);
        }}
      >
        <span>${room.name}</span>${icon(mdiChevronUp)}
      </button>`;
    }
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
