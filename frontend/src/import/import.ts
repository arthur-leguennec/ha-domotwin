/**
 * The plan import (D-009, D-040, D-057): its own WebAssembly module, fetched only when a plan of
 * another app is imported: an IFC file, a Sweet Home 3D home, a DXF drawing, a room scan, a robot
 * vacuum's map, a Floorplanner plan or a mesh scan. It finds the format from the file's content,
 * lists its storeys and converts one into a plan.
 */
import { wasmLoader } from "../assets";
import { engineError } from "../engine/engine";
import type { PlanJson } from "../ha/client";
import type { UpkeepCard } from "../live/upkeep";
import type * as Wasm from "./pkg/domotwin_import.js";

/** The formats the import reads. */
export type ImportFormat = "ifc" | "sh3d" | "dxf" | "scan" | "robot" | "fml" | "mesh";

/** A storey of the file. */
export interface ImportStorey {
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
export interface ImportReport {
  rooms: number;
  doors: number;
  windows: number;
  furniture: number;
  skippedSpaces: number;
  unplacedOpenings: number;
  skippedFurniture: number;
  overLimit: number;
}

/** The rooms a room scan names by their kind, by key of `panel.import_rooms`. */
export type ScanRoom = "living_room" | "bedroom" | "bathroom" | "kitchen" | "dining_room";

/** Their names as the reader gives them (in English): shown in the user's language. */
const SCAN_ROOMS: ReadonlyMap<string, ScanRoom> = new Map([
  ["Living room", "living_room"],
  ["Bedroom", "bedroom"],
  ["Bathroom", "bathroom"],
  ["Kitchen", "kitchen"],
  ["Dining room", "dining_room"],
]);

const loadImportWasm = wasmLoader(
  () => import("./pkg/domotwin_import.js"),
  __DOMOTWIN_IMPORT_WASM__,
);

/** A file being imported. Errors are `EngineError`s with codes of `errors.plan`. */
export class PlanFile {
  private constructor(private file: Wasm.PlanImport | undefined) {}

  /** Reads a file; `title` names the plan when the file does not (its name, say). */
  static async read(bytes: Uint8Array, title: string): Promise<PlanFile> {
    const wasm = await loadImportWasm();
    try {
      return new PlanFile(new wasm.PlanImport(bytes, title));
    } catch (error) {
      throw engineError(error);
    }
  }

  private get live(): Wasm.PlanImport {
    if (!this.file) throw engineError(new Error("disposed"));
    return this.file;
  }

  /** The format found. */
  get format(): ImportFormat {
    return this.live.format() as ImportFormat;
  }

  /** The storeys, lowest first. */
  storeys(): ImportStorey[] {
    return JSON.parse(this.live.storeys()) as ImportStorey[];
  }

  /**
   * The plan of a storey, what was left out, and the upkeep cards the file fills (D-033: make,
   * model, serial number, dates), by piece id. `roomName` names the rooms a scan names by their
   * kind, from their key of `panel.import_rooms`.
   */
  convert(
    storey: number,
    roomName?: (key: ScanRoom) => string,
  ): {
    plan: PlanJson;
    report: ImportReport;
    upkeep: Record<string, UpkeepCard>;
  } {
    let converted: { plan: PlanJson; report: ImportReport; upkeep: Record<string, UpkeepCard> };
    try {
      converted = JSON.parse(this.live.convert(storey)) as typeof converted;
    } catch (error) {
      throw engineError(error);
    }
    const rooms = converted.plan.rooms;
    if (roomName && this.format === "scan" && Array.isArray(rooms)) {
      for (const room of rooms as { name?: unknown }[]) {
        const key = typeof room.name === "string" ? SCAN_ROOMS.get(room.name) : undefined;
        if (key) room.name = roomName(key);
      }
    }
    return converted;
  }

  dispose(): void {
    this.file?.free();
    this.file = undefined;
  }
}
