/* tslint:disable */
/* eslint-disable */

/**
 * One DomoTwin view drawn on one canvas.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Frames an element (a room, a piece). Returns `false` when it has no geometry.
     */
    focusElement(id: string, time_ms: number): boolean;
    /**
     * Draws one frame. Returns `true` while an animation needs more frames.
     */
    frame(time_ms: number): boolean;
    /**
     * Flashes an element briefly (tap feedback).
     */
    highlight(id: string): void;
    /**
     * Asks for a new frame even though nothing changed.
     */
    invalidate(): void;
    /**
     * Loads a plan (the text of a `*.plan.json`) and builds its scene. Returns a JSON summary.
     * The camera keeps its place when `keep_camera` (a plan saved from another view).
     *
     * # Errors
     *
     * Fails with the JSON error of the plan reader (stable code and element id), which the
     * frontend translates.
     */
    loadPlan(json: string, keep_camera?: boolean | null): string;
    /**
     * Whether a frame is needed (something changed or an animation is running).
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
     * Turns the camera by a pointer move of `dx`, `dy` CSS pixels.
     */
    orbit(dx: number, dy: number): void;
    /**
     * Back to the whole home (animated from `time_ms`).
     */
    overview(time_ms: number): void;
    /**
     * Pans by a pointer move of `dx`, `dy` CSS pixels on a view `height` CSS pixels high.
     */
    pan(dx: number, dy: number, height: number): void;
    /**
     * The element drawn at the device pixel `x`, `y` (from the top left), as JSON
     * `{"id", "type", "name", "room"}` (`room`: the id of the room it is in, maybe empty), or an
     * empty string.
     */
    pick(x: number, y: number): string;
    /**
     * Whether the 2D plan is shown.
     */
    planView(): boolean;
    /**
     * The active quality preset.
     */
    quality(): string;
    /**
     * Sets the drawing buffer size in device pixels.
     */
    resize(width: number, height: number): void;
    /**
     * Where the centre of an element is drawn now, as JSON `[x, y]` in device pixels from the
     * top left, or an empty string (no such element, no geometry, behind the camera).
     */
    screenPoint(id: string): string;
    /**
     * Sets the background colour (sRGB, 0–255) from the Home Assistant theme.
     */
    setBackground(r: number, g: number, b: number): void;
    /**
     * Sets the bindings (the JSON stored by the integration). Malformed entries are skipped.
     */
    setBindings(json: string): void;
    /**
     * Sets the cut-away mode: `auto`, `always` or `off`.
     */
    setCutaway(name: string): void;
    /**
     * Fixes the light to a mood: `morning`, `day`, `evening` or `night`. Returns `false` for
     * another name (the light then follows the sun or the clock).
     */
    setLightingMood(name: string): boolean;
    /**
     * Lights the scene for a local time of day (`hour` 0–24) when the sun is unknown.
     */
    setLocalHour(hour: number): void;
    /**
     * Switches between the 3D view and the 2D plan (animated from `time_ms`).
     */
    setPlanView(plan: boolean, time_ms: number): void;
    /**
     * Forces a quality preset (`eco`, `balanced`, `high`) or returns to automatic (`auto`).
     */
    setQuality(name: string): void;
    /**
     * Updates entity states: JSON `{ "entity_id": { "state", "attributes" } | null }`, only the
     * entities that changed (`null` forgets one).
     */
    setStates(json: string): void;
    /**
     * Lights the scene for the sun's `elevation` (degrees), `rising` before noon (Home
     * Assistant's `sun.sun`).
     */
    setSun(elevation: number, rising: boolean): void;
    /**
     * Moves to a saved viewpoint. Returns `false` when there is none with this id.
     */
    showView(id: string, time_ms: number): boolean;
    /**
     * Figures about the scene, as JSON (for the diagnostics and the performance smoke test).
     */
    stats(): string;
    /**
     * The plan's saved viewpoints, as JSON `[{"id", "name"}]` (eye-level views are skipped).
     */
    views(): string;
    /**
     * Zooms by `factor` (< 1 closer) towards the screen point `x`, `y` (−1…1, y up).
     */
    zoom(factor: number, x: number, y: number): void;
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
 * Fails with the JSON error of the plan reader (stable code and element id).
 */
export function summarizePlan(json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engineVersion: (a: number) => void;
    readonly engine_focusElement: (a: number, b: number, c: number, d: number) => number;
    readonly engine_frame: (a: number, b: number) => number;
    readonly engine_highlight: (a: number, b: number, c: number) => void;
    readonly engine_invalidate: (a: number) => void;
    readonly engine_loadPlan: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_needsFrame: (a: number) => number;
    readonly engine_new: (a: number, b: number) => void;
    readonly engine_orbit: (a: number, b: number, c: number) => void;
    readonly engine_overview: (a: number, b: number) => void;
    readonly engine_pan: (a: number, b: number, c: number, d: number) => void;
    readonly engine_pick: (a: number, b: number, c: number, d: number) => void;
    readonly engine_planView: (a: number) => number;
    readonly engine_quality: (a: number, b: number) => void;
    readonly engine_resize: (a: number, b: number, c: number) => void;
    readonly engine_screenPoint: (a: number, b: number, c: number, d: number) => void;
    readonly engine_setBackground: (a: number, b: number, c: number, d: number) => void;
    readonly engine_setBindings: (a: number, b: number, c: number) => void;
    readonly engine_setCutaway: (a: number, b: number, c: number) => void;
    readonly engine_setLightingMood: (a: number, b: number, c: number) => number;
    readonly engine_setLocalHour: (a: number, b: number) => void;
    readonly engine_setPlanView: (a: number, b: number, c: number) => void;
    readonly engine_setQuality: (a: number, b: number, c: number) => void;
    readonly engine_setStates: (a: number, b: number, c: number) => void;
    readonly engine_setSun: (a: number, b: number, c: number) => void;
    readonly engine_showView: (a: number, b: number, c: number, d: number) => number;
    readonly engine_stats: (a: number, b: number) => void;
    readonly engine_views: (a: number, b: number) => void;
    readonly engine_zoom: (a: number, b: number, c: number, d: number) => void;
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
