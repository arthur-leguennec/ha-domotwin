import { assetUrl } from "../assets";
import type { Rgb } from "../color";
import type { CutawayMode, QualityName } from "../config";
import type * as Wasm from "./pkg/domotwin_web.js";

/** What `loadPlan` returns: counts of the plan's elements. */
export interface PlanSummary {
  revision: number;
  title: string;
  rooms: number;
  walls: number;
  doors: number;
  windows: number;
  furniture: number;
}

/** A saved viewpoint of the plan. */
export interface SavedView {
  id: string;
  name: string;
}

/** The element under a screen point. */
export interface PickedElement {
  id: string;
  type: "room" | "wall" | "door" | "window" | "furniture";
}

/** Figures about the scene (diagnostics, performance smoke test). */
export interface SceneStats {
  triangles: number;
  groups: number;
  planView: boolean;
  quality: string;
  camera: {
    target: [number, number, number];
    distance: number;
    yaw: number;
    pitch: number;
    ortho: number;
  };
}

/**
 * An error raised by the engine; `code` is translated with `errors.plan.<code>`, `element` is the
 * id of the plan element at fault, when there is one.
 */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly element?: string,
  ) {
    super(code);
    this.name = "EngineError";
  }
}

let wasmModule: Promise<typeof Wasm> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** Loads the WebAssembly engine once per page (it is a separate chunk, fetched on demand). */
export function loadWasm(): Promise<typeof Wasm> {
  wasmModule ??= (async () => {
    const wasm = await import("./pkg/domotwin_web.js");
    const output = await wasm.default({ module_or_path: assetUrl(__DOMOTWIN_WASM__) });
    wasmMemory = output.memory;
    return wasm;
  })();
  wasmModule.catch(() => (wasmModule = undefined));
  return wasmModule;
}

/** Size of the engine's WebAssembly memory in bytes (it never shrinks; see PERFORMANCE.md). */
export function wasmMemoryBytes(): number | undefined {
  return wasmMemory?.buffer.byteLength;
}

/** The engine reports plan errors as JSON `{"code", "element"}`, other errors as a bare code. */
export function engineError(error: unknown): EngineError {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { code?: unknown; element?: unknown };
    if (typeof parsed.code === "string") {
      return new EngineError(
        parsed.code,
        typeof parsed.element === "string" ? parsed.element : undefined,
      );
    }
  } catch {
    // A bare code.
  }
  return new EngineError(message);
}

/** One engine per canvas: a typed wrapper around the WebAssembly `Engine`. */
export class DomoTwinEngine {
  private constructor(private engine: Wasm.Engine | undefined) {}

  static async create(canvas: HTMLCanvasElement): Promise<DomoTwinEngine> {
    const wasm = await loadWasm();
    try {
      return new DomoTwinEngine(new wasm.Engine(canvas));
    } catch (error) {
      throw engineError(error);
    }
  }

  private get live(): Wasm.Engine {
    if (!this.engine) throw new EngineError("disposed");
    return this.engine;
  }

  /**
   * Reads a plan and builds its scene; throws an `EngineError` with a stable code when it is
   * refused. The camera stays where it is when `keepCamera` (the same home, saved again).
   */
  loadPlan(json: string, keepCamera = false): PlanSummary {
    try {
      return JSON.parse(this.live.loadPlan(json, keepCamera)) as PlanSummary;
    } catch (error) {
      throw engineError(error);
    }
  }

  setCutaway(mode: CutawayMode): void {
    this.live.setCutaway(mode);
  }

  /** Turns the camera by a drag of `dx`, `dy` CSS pixels. */
  orbit(dx: number, dy: number): void {
    this.live.orbit(dx, dy);
  }

  /** Moves the view by a drag of `dx`, `dy` CSS pixels on a view `height` CSS pixels high. */
  pan(dx: number, dy: number, height: number): void {
    this.live.pan(dx, dy, height);
  }

  /** Zooms by `factor` (< 1 closer) towards the screen point `x`, `y` in −1…1 (y up). */
  zoom(factor: number, x: number, y: number): void {
    this.live.zoom(factor, x, y);
  }

  /** Shows the 2D plan (`true`) or the 3D view, with an animated move. */
  setPlanView(plan: boolean): void {
    this.live.setPlanView(plan, performance.now());
  }

  get planView(): boolean {
    return this.live.planView();
  }

  /** Back to the whole home. */
  overview(): void {
    this.live.overview(performance.now());
  }

  /** Frames an element; false when it has nothing to show. */
  focusElement(id: string): boolean {
    return this.live.focusElement(id, performance.now());
  }

  /** The plan's saved viewpoints. */
  views(): SavedView[] {
    return JSON.parse(this.live.views()) as SavedView[];
  }

  /** Moves to a saved viewpoint; false when there is none with this id. */
  showView(id: string): boolean {
    return this.live.showView(id, performance.now());
  }

  /** The element drawn at a device pixel of the canvas (from the top left), if any. */
  pick(x: number, y: number): PickedElement | undefined {
    const text = this.live.pick(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)));
    return text ? (JSON.parse(text) as PickedElement) : undefined;
  }

  get stats(): SceneStats {
    return JSON.parse(this.live.stats()) as SceneStats;
  }

  resize(width: number, height: number): void {
    this.live.resize(width, height);
  }

  setBackground(color: Rgb): void {
    this.live.setBackground(color.r, color.g, color.b);
  }

  setQuality(quality: QualityName): void {
    this.live.setQuality(quality);
  }

  get quality(): string {
    return this.live.quality();
  }

  get needsFrame(): boolean {
    return this.live.needsFrame();
  }

  invalidate(): void {
    this.live.invalidate();
  }

  /** Draws a frame; true while an animation needs more frames. */
  frame(time: number): boolean {
    return this.live.frame(time);
  }

  dispose(): void {
    this.engine?.free();
    this.engine = undefined;
  }
}

/** Checks a plan without a canvas (used by the import). */
export async function summarizePlan(json: string): Promise<PlanSummary> {
  const wasm = await loadWasm();
  try {
    return JSON.parse(wasm.summarizePlan(json)) as PlanSummary;
  } catch (error) {
    throw engineError(error);
  }
}
