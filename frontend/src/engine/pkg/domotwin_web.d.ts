/* tslint:disable */
/* eslint-disable */

/**
 * One DomoTwin view drawn on one canvas.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Draws one frame. Returns `true` while an animation needs more frames.
     */
    frame(time_ms: number): boolean;
    /**
     * Asks for a new frame even though nothing changed.
     */
    invalidate(): void;
    /**
     * Loads a plan (the text of a `*.plan.json`). Returns a JSON summary of the plan.
     *
     * # Errors
     *
     * Fails with a stable error code (`not_json`, `bad_unit`…) that the frontend translates.
     */
    loadPlan(json: string): string;
    /**
     * Whether a frame is needed (something changed since the last one).
     */
    needsFrame(): boolean;
    /**
     * Creates the engine on a canvas (a WebGL2 context is created on it).
     *
     * # Errors
     *
     * Fails with `webgl2_unavailable` when the browser cannot create a WebGL2 context.
     */
    constructor(canvas: HTMLCanvasElement);
    /**
     * The active quality preset.
     */
    quality(): string;
    /**
     * Sets the drawing buffer size in device pixels.
     */
    resize(width: number, height: number): void;
    /**
     * Sets the background colour (sRGB, 0–255) from the Home Assistant theme.
     */
    setBackground(r: number, g: number, b: number): void;
    /**
     * Forces a quality preset (`eco`, `balanced`, `high`) or returns to automatic (`auto`).
     */
    setQuality(name: string): void;
}

/**
 * The version of the engine (the product version is set by the frontend).
 */
export function engineVersion(): string;

/**
 * Installs the panic hook so that a bug shows a readable message in the console.
 */
export function start(): void;

/**
 * Reads a plan without drawing it (the import checks a file with it). Returns a JSON summary.
 *
 * # Errors
 *
 * Fails with the stable error code of the plan reader.
 */
export function summarizePlan(json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engineVersion: (a: number) => void;
    readonly engine_frame: (a: number, b: number) => number;
    readonly engine_invalidate: (a: number) => void;
    readonly engine_loadPlan: (a: number, b: number, c: number, d: number) => void;
    readonly engine_needsFrame: (a: number) => number;
    readonly engine_new: (a: number, b: number) => void;
    readonly engine_quality: (a: number, b: number) => void;
    readonly engine_resize: (a: number, b: number, c: number) => void;
    readonly engine_setBackground: (a: number, b: number, c: number, d: number) => void;
    readonly engine_setQuality: (a: number, b: number, c: number) => void;
    readonly start: () => void;
    readonly summarizePlan: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
