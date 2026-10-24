/* tslint:disable */
/* eslint-disable */

/**
 * A plan being edited.
 */
export class Planner {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Places a door (`door`) or a window on the side of a room nearest to (`x`, `y`). Returns its
     * id, or an empty string when no side is near enough (60 cm).
     *
     * # Errors
     *
     * The reader's.
     */
    addOpening(door: boolean, x: number, y: number, name: string): string;
    /**
     * Adds a rectangular room from corner (`ax`, `ay`) to (`bx`, `by`). Returns its id.
     *
     * # Errors
     *
     * The reader's (`min_area`: a room smaller than 30 cm…).
     */
    addRoom(ax: number, ay: number, bx: number, by: number, name: string): string;
    /**
     * Adds a partition from (`ax`, `ay`) to (`bx`, `by`). Returns its id.
     *
     * # Errors
     *
     * The reader's (shorter than 5 cm…).
     */
    addWall(ax: number, ay: number, bx: number, by: number, name: string): string;
    /**
     * Starts a drag: its changes make one change to undo.
     */
    beginDrag(): void;
    /**
     * A new plan titled `title` holding one room of 400 × 300 cm named `room` (a change to save),
     * whose id is none of `reserved` (ids whose links are still stored).
     */
    static blank(title: string, room: string, reserved: string[]): Planner;
    canRedo(): boolean;
    canUndo(): boolean;
    /**
     * Changes not saved.
     */
    dirty(): boolean;
    /**
     * Element `id` as JSON (its fields in the plan file, with its `type` and an opening's
     * `width`), or an empty string.
     */
    element(id: string): string;
    /**
     * Ends the drag.
     */
    endDrag(): void;
    /**
     * Adds a corner to side `side` of room `id` at (`x`, `y`).
     *
     * # Errors
     *
     * The reader's.
     */
    insertCorner(id: string, side: number, x: number, y: number): void;
    /**
     * The draft was saved as it is.
     */
    markSaved(): void;
    /**
     * Moves corner `i` of room `id` to (`x`, `y`).
     *
     * # Errors
     *
     * The reader's (a shape that crosses itself…).
     */
    moveCorner(id: string, i: number, x: number, y: number): void;
    /**
     * Moves element `id` by (`dx`, `dy`): a room with everything in it, a partition, or a door or
     * a window along the rooms' sides.
     *
     * # Errors
     *
     * The reader's.
     */
    moveElement(id: string, dx: number, dy: number): void;
    /**
     * Starts editing a plan (JSON text, its edit overlay already applied).
     *
     * # Errors
     *
     * `{"code": "not_json"}` when the text is not JSON; the reader's error when it refuses the
     * plan (its changes could not be checked).
     */
    constructor(plan: string);
    /**
     * The draft, as JSON text (what Save stores).
     */
    plan(): string;
    /**
     * Does the last undone change again; false when there was none.
     */
    redo(): boolean;
    /**
     * Removes corner `i` of room `id` (three are kept at least).
     *
     * # Errors
     *
     * The reader's.
     */
    removeCorner(id: string, i: number): void;
    /**
     * Removes element `id` (a room takes its doors and windows with it).
     *
     * # Errors
     *
     * The reader's (the last element…).
     */
    remove(id: string): void;
    /**
     * Puts a whole plan in place (JSON text; a draft kept by the browser), as one change.
     *
     * # Errors
     *
     * The reader's, or `{"code": "not_json"}`.
     */
    replace(plan: string): void;
    /**
     * Ids new elements must not take: those whose links are still stored (an element removed
     * earlier), so that a new element never takes over another's links.
     */
    reserve(ids: string[]): void;
    /**
     * The corners of room `id` (plan cm, `[x0, y0, x1, y1, …]`); empty for anything else.
     */
    roomPoints(id: string): Float64Array;
    /**
     * Where a point goes, snapped (rooms' corners but those of `except`, lines of corners, the
     * 5 cm grid), then the guides it was lined up on: `[x, y, ax, ay, bx, by, …]` (plan cm).
     */
    snap(x: number, y: number, except?: string | null): Float64Array;
    /**
     * Undoes the last change; false when there was none.
     */
    undo(): boolean;
    /**
     * Changes fields of element `id` (a JSON object: `name`, `floor`, `width`, `opensTo`, `style`,
     * `thickness`… as its type allows; others are left alone).
     *
     * # Errors
     *
     * The reader's, or `{"code": "not_json"}`.
     */
    update(id: string, fields: string): void;
}

/**
 * The plan (JSON text) with ids none of `taken` has, for a storey joining a home whose other
 * storeys use some of them (`DECISIONS.md`, D-026); the `room` of its elements follows.
 *
 * # Errors
 *
 * `{"code": "not_json"}` when the text is not JSON.
 */
export function freeIds(plan: string, taken: string[]): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_planner_free: (a: number, b: number) => void;
    readonly freeIds: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly planner_addOpening: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly planner_addRoom: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly planner_addWall: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly planner_beginDrag: (a: number) => void;
    readonly planner_blank: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly planner_canRedo: (a: number) => number;
    readonly planner_canUndo: (a: number) => number;
    readonly planner_dirty: (a: number) => number;
    readonly planner_element: (a: number, b: number, c: number, d: number) => void;
    readonly planner_endDrag: (a: number) => void;
    readonly planner_insertCorner: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly planner_markSaved: (a: number) => void;
    readonly planner_moveCorner: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly planner_moveElement: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly planner_new: (a: number, b: number, c: number) => void;
    readonly planner_plan: (a: number, b: number) => void;
    readonly planner_redo: (a: number) => number;
    readonly planner_remove: (a: number, b: number, c: number, d: number) => void;
    readonly planner_removeCorner: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly planner_replace: (a: number, b: number, c: number, d: number) => void;
    readonly planner_reserve: (a: number, b: number, c: number) => void;
    readonly planner_roomPoints: (a: number, b: number, c: number, d: number) => void;
    readonly planner_snap: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly planner_undo: (a: number) => number;
    readonly planner_update: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
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
