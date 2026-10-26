/* tslint:disable */
/* eslint-disable */

/**
 * A radio mesh read from a snapshot (JSON, see `domotwin_core::network`).
 */
export class NetworkAnalysis {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * What the engine draws of it (JSON, for the engine's `setNetwork`).
     */
    drawing(): string;
    /**
     * Reads `snapshot`; anything that is not one gives an empty mesh.
     */
    constructor(snapshot: string);
    /**
     * The analysis (JSON: devices, links, health), with the room each device is in (`rooms`:
     * the JSON array the engine's `setNetwork` returns).
     */
    report(rooms: string): string;
}

/**
 * How well one radio covers the home, and where the next one helps most (JSON in and out, see
 * `domotwin_core::coverage`): `{"rooms", "radios", "spots", "check", "agreement"}`.
 */
export function advisePlacement(input: string): string;

/**
 * What an automation's configuration (JSON, `automation/config`'s `config`) involves: JSON
 * `{"ends": [{"role", "entity" | "device" | "area" | "floor" | "label" | "place" | "dynamic":
 * name}], "skipped"}`.
 */
export function readAutomation(config: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_networkanalysis_free: (a: number, b: number) => void;
    readonly advisePlacement: (a: number, b: number, c: number) => void;
    readonly networkanalysis_drawing: (a: number, b: number) => void;
    readonly networkanalysis_new: (a: number, b: number) => number;
    readonly networkanalysis_report: (a: number, b: number, c: number, d: number) => void;
    readonly readAutomation: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
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
