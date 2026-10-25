/**
 * Where the integration serves DomoTwin's files. The entry module records its own URL at startup,
 * so assets resolve next to it whatever chunk asks for them.
 */
let base: URL | undefined;

export function setAssetBase(url: URL): void {
  base = url;
}

export function assetUrl(file: string): URL {
  return new URL(file, base ?? new URL("/domotwin_static/", location.origin));
}

/** A wasm module's glue, as wasm-bindgen writes it: started with where its wasm is. */
interface WasmGlue {
  default(init: { module_or_path: URL }): Promise<unknown>;
}

/**
 * What loads a wasm module on demand, once: `glue` imports its glue, `file` is its wasm among the
 * assets, `started` is handed what the module's start gives (its exports). A load that failed is
 * tried again the next time.
 */
export function wasmLoader<T extends WasmGlue>(
  glue: () => Promise<T>,
  file: string,
  started?: (output: Awaited<ReturnType<T["default"]>>) => void,
): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => {
    if (!loaded) {
      loaded = (async () => {
        const wasm = await glue();
        const output = await wasm.default({ module_or_path: assetUrl(file) });
        started?.(output as Awaited<ReturnType<T["default"]>>);
        return wasm;
      })();
      loaded.catch(() => (loaded = undefined));
    }
    return loaded;
  };
}
