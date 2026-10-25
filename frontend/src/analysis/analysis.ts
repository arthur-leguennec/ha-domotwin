/**
 * The analysis module (`docs/DECISIONS.md`, D-043), loaded the first time the network map or the
 * automations are shown: it reads a radio mesh's snapshot and automations' configurations, and
 * analyses them. The engine is handed what it draws, so none of this is in the first load.
 */
import { wasmLoader } from "../assets";

const loadAnalysisWasm = wasmLoader(
  () => import("./pkg/domotwin_analysis.js"),
  __DOMOTWIN_ANALYSIS_WASM__,
);

/**
 * What reads an automation's configuration (D-032): JSON text `{"ends": [{"role", "entity" |
 * "device" | "area" | "floor" | "label" | "place" | "dynamic": name}], "skipped"}`. Rejects when
 * the module cannot be loaded (asked for again next time).
 */
export async function automationReader(): Promise<(config: string) => string> {
  const wasm = await loadAnalysisWasm();
  return (config) => wasm.readAutomation(config);
}

/**
 * Reads the radio mesh of `snapshot` (D-031) and analyses it, unless it is no longer `wanted` once
 * the module is loaded: `draw` is handed what the engine draws (the engine's `setNetwork`) and
 * returns the room each device is in. Returns the analysis as JSON text (nothing when not wanted).
 */
export async function analyseNetwork(
  snapshot: string,
  wanted: () => boolean,
  draw: (drawing: string) => string,
): Promise<string | undefined> {
  const wasm = await loadAnalysisWasm();
  if (!wanted()) return undefined;
  const analysis = new wasm.NetworkAnalysis(snapshot);
  try {
    return analysis.report(draw(analysis.drawing()));
  } finally {
    analysis.free();
  }
}
