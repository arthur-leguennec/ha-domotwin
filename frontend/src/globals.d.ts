/** Product version, injected by the build from package.json. */
declare const __DOMOTWIN_VERSION__: string;
/** File name of the engine's WebAssembly module (content-hashed by the build). */
declare const __DOMOTWIN_WASM__: string;
/** File name of the IFC import's WebAssembly module, loaded only to import a .ifc file. */
declare const __DOMOTWIN_IMPORT_WASM__: string;
/** File name of the 3D model reader's WebAssembly module, loaded only for plans with 3D files. */
declare const __DOMOTWIN_MODELS_WASM__: string;
/** File name of the plan editor's WebAssembly module, loaded only when the plan editor opens. */
declare const __DOMOTWIN_PLANNER_WASM__: string;
/** File name of the analysis module (D-043), loaded only when the network map or automations show. */
declare const __DOMOTWIN_ANALYSIS_WASM__: string;
/** Path of the bundled font (content-hashed by the build). */
declare const __DOMOTWIN_FONT__: string;

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
