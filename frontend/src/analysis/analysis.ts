/**
 * The analysis module (`docs/DECISIONS.md`, D-043), loaded the first time the network map, the
 * automations, the Wi-Fi QR code or the radio coverage are shown: it reads a radio mesh's snapshot
 * and automations' configurations, and analyses them, draws the home's Wi-Fi QR code (D-060) and
 * advises where the next radio helps most (D-065). The engine is handed what it draws, so none of
 * this is in the first load.
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

/** A QR code: the modules on a side, and each one row by row (`true`: dark). */
export interface QrCode {
  size: number;
  dark: (x: number, y: number) => boolean;
}

/**
 * The QR code a phone's camera joins a Wi-Fi network with (D-060), drawn in the page; `undefined`
 * when the network does not fit in one. Rejects when the module cannot be loaded.
 */
export async function wifiQrCode(
  name: string,
  password: string,
  security: string,
  hidden: boolean,
): Promise<QrCode | undefined> {
  const wasm = await loadAnalysisWasm();
  // The network as one JSON object, as the module reads it.
  const read = JSON.parse(wasm.wifiQr(JSON.stringify({ name, password, security, hidden }))) as {
    size?: number;
    modules?: string;
  };
  const size = read.size ?? 0;
  const modules = read.modules ?? "";
  if (size <= 0 || modules.length !== size * size) return undefined;
  return { size, dark: (x, y) => modules.charCodeAt(y * size + x) === 49 };
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

/**
 * How well one radio covers the home and where the next one helps most (D-065), for `input`
 * (`placementInput`), unless it is no longer `wanted` once the module is loaded: the advice as
 * JSON text (nothing when not wanted). Rejects when the module cannot be loaded.
 */
export async function advisePlacement(
  input: string,
  wanted: () => boolean,
): Promise<string | undefined> {
  const wasm = await loadAnalysisWasm();
  return wanted() ? wasm.advisePlacement(input) : undefined;
}
