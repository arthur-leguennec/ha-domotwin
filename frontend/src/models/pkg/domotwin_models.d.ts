/* tslint:disable */
/* eslint-disable */

/**
 * A 3D file being read.
 */
export class ModelFile {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The encoded picture `index`.
     */
    imageBytes(index: number): Uint8Array;
    /**
     * Number of pictures to decode.
     */
    imageCount(): number;
    /**
     * The media type of picture `index`.
     */
    imageType(index: number): string;
    /**
     * What the file holds, as JSON `{"triangles", "size": [x, y, z], "unit", "up", "images",
     * "colors"}`: the size of its box in its own unit (`unit`: `mm`, `cm`, `m`, `in`, `ft`, `um`,
     * or null when the format does not say), the axis that usually points up for the format, and
     * whether it has colours of its own.
     */
    info(): string;
    /**
     * The mesh for the engine (`DTM1`).
     */
    mesh(): Uint8Array;
    /**
     * Reads a file of a format (`glb`, `gltf`, `obj`, `stl`, `3mf`). Errors are JSON
     * `{"code"}`: `not_model`, `too_large`, `too_many_triangles`, `too_many_meshes`,
     * `external_reference`, `unsupported`, `no_geometry`, `image_too_large`.
     */
    constructor(bytes: Uint8Array, format: string);
    /**
     * Gives the decoded pixels of picture `index` (RGBA rows, top first, any size).
     */
    setImage(index: number, width: number, height: number, rgba: Uint8Array): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_modelfile_free: (a: number, b: number) => void;
    readonly modelfile_imageBytes: (a: number, b: number, c: number) => void;
    readonly modelfile_imageCount: (a: number) => number;
    readonly modelfile_imageType: (a: number, b: number, c: number) => void;
    readonly modelfile_info: (a: number, b: number) => void;
    readonly modelfile_mesh: (a: number, b: number) => void;
    readonly modelfile_new: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly modelfile_setImage: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
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
