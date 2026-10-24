/* tslint:disable */
/* eslint-disable */

/**
 * One DomoTwin view drawn on one canvas.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Starts edit mode on the plan shown. Returns the edit state.
     */
    beginEdit(): string;
    /**
     * Adds a piece of the user model `model` under the device pixel `x`, `y` (or in the middle of
     * the view), and selects it. `definition` is the model itself (JSON) when it is imported now,
     * empty for a model the plan has. The state has `refused: true` when it could not be added.
     */
    editAddModel(model: string, definition: string, x: number, y: number): string;
    /**
     * Adds a piece of the catalogue `kind` named `name` under the device pixel `x`, `y` (or in
     * the middle of the view when the floor is not there), and selects it. The state has
     * `refused: true` when it could not be added (the plan holds 500 elements).
     */
    editAdd(kind: string, name: string, x: number, y: number): string;
    /**
     * The catalogue of kinds a piece can be added as, as JSON `[{"kind", "w", "d", "h",
     * "light"}]` (default sizes in cm).
     */
    static editCatalogue(): string;
    /**
     * Drops the pieces of the drag where they are.
     */
    editDragEnd(): string;
    /**
     * Moves the pieces of the drag to the device pixel `x`, `y`. Returns the edit state, with
     * the guides.
     */
    editDragMove(x: number, y: number): string;
    /**
     * Starts moving the selection when the device pixel `x`, `y` shows a selected piece that is
     * not fixed. Returns whether it did (else the pointer turns or pans the view).
     */
    editDragStart(x: number, y: number): boolean;
    /**
     * The edit overlay now, as JSON (what **Save** stores).
     */
    editLayout(): string;
    /**
     * The user models of the plan shown (« My models »), as JSON `[{"id", "name", "w", "d",
     * "h", "color", "format", "bytes", "pieces", "removable"}]`: `format` and `bytes` are the 3D
     * file's (`null` for a kit), `pieces` how many pieces show it, `removable` whether it was
     * imported in edit mode and no piece shows it.
     */
    editModels(): string;
    /**
     * Does again the last change undone.
     */
    editRedo(): string;
    /**
     * Forgets a model imported in edit mode that no piece shows.
     */
    editRemoveModel(model: string): string;
    /**
     * Removes the selected pieces.
     */
    editRemove(): string;
    /**
     * Puts a whole overlay (JSON, a draft kept by the browser) in place as one change that can
     * be undone.
     */
    editRestore(layout: string): string;
    /**
     * Turns the selection by `steps` of 15° (negative: anticlockwise on the plan).
     */
    editRotate(steps: number): string;
    /**
     * The overlay `layout` (JSON, what was sent) was stored. Changes made while it was being saved
     * stay to be saved.
     */
    editSaved(layout: string): void;
    /**
     * Selects the piece `id` (`add`: adds it to the selection or takes it out); another id
     * clears the selection unless `add`.
     */
    editSelect(id: string, add: boolean): string;
    /**
     * What edit mode shows, as JSON: `editing`, `selection` (`[{"id", "name", "kind",
     * "locked"}]`), `conflicts` (ids), `guides` (`[{"a": [x, y], "b": [x, y], "cm"}]`, device
     * pixels, `cm` only for distances), `canUndo`, `canRedo`, `dirty`, and `changes` (a number
     * that changes with the overlay).
     */
    editState(): string;
    /**
     * Undoes the last change.
     */
    editUndo(): string;
    /**
     * Leaves edit mode, keeping the changes shown (`keep`) or going back to the overlay saved.
     */
    endEdit(keep: boolean): void;
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
     * Loads a plan (the text of a `*.plan.json`) with its edit overlay (`layout`, JSON) and
     * builds its scene. Returns a JSON summary; `layoutRefused` counts the entries of the overlay
     * left out because they made the plan invalid (an updated plan). The camera keeps its place
     * when `keep_camera` (a plan saved from another view).
     *
     * # Errors
     *
     * Fails with the JSON error of the plan reader (stable code and element id), which the
     * frontend translates.
     */
    loadPlan(json: string, keep_camera?: boolean | null, layout?: string | null): string;
    /**
     * The 3D files the pieces of the plan shown are drawn from, as JSON `[{"hash", "format",
     * "bytes"}]`, each once: the frontend fetches and reads them, then gives their meshes with
     * [`Engine::set_model_mesh`]. Files already given are left out.
     */
    modelFiles(): string;
    /**
     * How many pieces are drawn as boxes because the 3D files of the plan pass the scene's
     * triangle budget.
     */
    modelsOverBudget(): number;
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
     * Gives the mesh of the 3D file `hash` (`DTM1`, from the model module); the pieces drawn
     * from it change at the next [`Engine::show_models`]. Returns `false` when the mesh is refused.
     */
    setModelMesh(hash: string, mesh: Uint8Array): boolean;
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
     * Draws the pieces whose 3D file came since the scene was built, in one rebuild for all of
     * them. Returns whether it did.
     */
    showModels(): boolean;
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
 * The plan with the edit overlay applied, as written by **Export plan** (revision 10).
 *
 * # Errors
 *
 * Fails with the JSON error of the plan reader when the result is not a valid plan.
 */
export function applyLayout(plan: string, layout: string): string;

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
    readonly applyLayout: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engineVersion: (a: number) => void;
    readonly engine_beginEdit: (a: number, b: number) => void;
    readonly engine_editAdd: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly engine_editAddModel: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly engine_editCatalogue: (a: number) => void;
    readonly engine_editDragEnd: (a: number, b: number) => void;
    readonly engine_editDragMove: (a: number, b: number, c: number, d: number) => void;
    readonly engine_editDragStart: (a: number, b: number, c: number) => number;
    readonly engine_editLayout: (a: number, b: number) => void;
    readonly engine_editModels: (a: number, b: number) => void;
    readonly engine_editRedo: (a: number, b: number) => void;
    readonly engine_editRemove: (a: number, b: number) => void;
    readonly engine_editRemoveModel: (a: number, b: number, c: number, d: number) => void;
    readonly engine_editRestore: (a: number, b: number, c: number, d: number) => void;
    readonly engine_editRotate: (a: number, b: number, c: number) => void;
    readonly engine_editSaved: (a: number, b: number, c: number) => void;
    readonly engine_editSelect: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_editState: (a: number, b: number) => void;
    readonly engine_editUndo: (a: number, b: number) => void;
    readonly engine_endEdit: (a: number, b: number) => void;
    readonly engine_focusElement: (a: number, b: number, c: number, d: number) => number;
    readonly engine_frame: (a: number, b: number) => number;
    readonly engine_highlight: (a: number, b: number, c: number) => void;
    readonly engine_invalidate: (a: number) => void;
    readonly engine_loadPlan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly engine_modelFiles: (a: number, b: number) => void;
    readonly engine_modelsOverBudget: (a: number) => number;
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
    readonly engine_setModelMesh: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly engine_setPlanView: (a: number, b: number, c: number) => void;
    readonly engine_setQuality: (a: number, b: number, c: number) => void;
    readonly engine_setStates: (a: number, b: number, c: number) => void;
    readonly engine_setSun: (a: number, b: number, c: number) => void;
    readonly engine_showModels: (a: number) => number;
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
