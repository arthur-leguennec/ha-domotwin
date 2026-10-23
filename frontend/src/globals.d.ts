/** Product version, injected by the build from package.json. */
declare const __DOMOTWIN_VERSION__: string;
/** File name of the engine's WebAssembly module (content-hashed by the build). */
declare const __DOMOTWIN_WASM__: string;

interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
}

interface Window {
  customCards?: CustomCardEntry[];
  loadCardHelpers?: () => Promise<{
    createCardElement(config: { type: string; [key: string]: unknown }): Promise<HTMLElement>;
  }>;
}
