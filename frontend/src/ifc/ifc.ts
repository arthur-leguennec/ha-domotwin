/**
 * The IFC import (ISO 16739): its own WebAssembly module, fetched only when a `.ifc` file is
 * imported. It lists the storeys of a file and converts one into a plan.
 */
import { assetUrl } from "../assets";
import { engineError } from "../engine/engine";
import type { PlanJson } from "../ha/client";
import type { UpkeepCard } from "../live/upkeep";
import type * as Wasm from "./pkg/domotwin_ifc.js";

/** A storey of the file. */
export interface IfcStorey {
  id: number;
  name: string;
  /**
   * Height of its floor above the ground floor's (cm; negative below it): the storey nearest 0
   * when one is within 2 m of it, else the lowest.
   */
  elevation: number;
  spaces: number;
  doors: number;
  windows: number;
  furniture: number;
}

/** What a conversion kept and left out. */
export interface IfcReport {
  rooms: number;
  doors: number;
  windows: number;
  furniture: number;
  skippedSpaces: number;
  unplacedOpenings: number;
  skippedFurniture: number;
  overLimit: number;
}

let wasmModule: Promise<typeof Wasm> | undefined;

function loadIfcWasm(): Promise<typeof Wasm> {
  wasmModule ??= (async () => {
    const wasm = await import("./pkg/domotwin_ifc.js");
    await wasm.default({ module_or_path: assetUrl(__DOMOTWIN_IFC_WASM__) });
    return wasm;
  })();
  wasmModule.catch(() => (wasmModule = undefined));
  return wasmModule;
}

/** An IFC file being imported. Errors are `EngineError`s with codes of `errors.plan`. */
export class IfcFile {
  private constructor(private file: Wasm.IfcImport | undefined) {}

  static async read(bytes: Uint8Array): Promise<IfcFile> {
    const wasm = await loadIfcWasm();
    try {
      return new IfcFile(new wasm.IfcImport(bytes));
    } catch (error) {
      throw engineError(error);
    }
  }

  private get live(): Wasm.IfcImport {
    if (!this.file) throw engineError(new Error("disposed"));
    return this.file;
  }

  /** The storeys, lowest first. */
  storeys(): IfcStorey[] {
    return JSON.parse(this.live.storeys()) as IfcStorey[];
  }

  /**
   * The plan of a storey, what was left out, and the upkeep cards the file fills (D-033: make,
   * model, serial number, dates), by piece id.
   */
  convert(storey: number): {
    plan: PlanJson;
    report: IfcReport;
    upkeep: Record<string, UpkeepCard>;
  } {
    try {
      return JSON.parse(this.live.convert(storey)) as {
        plan: PlanJson;
        report: IfcReport;
        upkeep: Record<string, UpkeepCard>;
      };
    } catch (error) {
      throw engineError(error);
    }
  }

  dispose(): void {
    this.file?.free();
    this.file = undefined;
  }
}
