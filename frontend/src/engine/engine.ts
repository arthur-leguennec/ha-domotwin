import { assetUrl } from "../assets";
import type { Rgb } from "../color";
import type { QualityName } from "../config";
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
  unknown: number;
}

/** An error raised by the engine; `code` is translated with `errors.plan.<code>`. */
export class EngineError extends Error {
  constructor(readonly code: string) {
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

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One engine per canvas: a typed wrapper around the WebAssembly `Engine`. */
export class DomoTwinEngine {
  private constructor(private engine: Wasm.Engine | undefined) {}

  static async create(canvas: HTMLCanvasElement): Promise<DomoTwinEngine> {
    const wasm = await loadWasm();
    try {
      return new DomoTwinEngine(new wasm.Engine(canvas));
    } catch (error) {
      throw new EngineError(codeOf(error));
    }
  }

  private get live(): Wasm.Engine {
    if (!this.engine) throw new EngineError("disposed");
    return this.engine;
  }

  /** Reads a plan; throws an `EngineError` with a stable code when it is refused. */
  loadPlan(json: string): PlanSummary {
    try {
      return JSON.parse(this.live.loadPlan(json)) as PlanSummary;
    } catch (error) {
      throw new EngineError(codeOf(error));
    }
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
    throw new EngineError(codeOf(error));
  }
}
