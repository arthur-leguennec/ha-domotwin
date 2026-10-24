import { assetUrl } from "../assets";
import type { Rgb } from "../color";
import type { CutawayMode, LightingMode, QualityName } from "../config";
import type * as Wasm from "./pkg/domotwin_web.js";

/** What `loadPlan` returns: counts of the plan's elements. */
export interface PlanSummary {
  revision: number;
  /** Entries of the edit overlay left out because they made the plan invalid (an updated plan). */
  layoutRefused?: number;
  title: string;
  rooms: number;
  walls: number;
  doors: number;
  windows: number;
  furniture: number;
}

/** A saved viewpoint of the plan. */
export interface SavedView {
  id: string;
  name: string;
}

/** The element under a screen point. */
export interface PickedElement {
  id: string;
  type: "room" | "wall" | "door" | "window" | "furniture";
  /** Its name in the plan (may be empty). */
  name: string;
  /** The id of the room it is in (a room is its own), empty when none. */
  room: string;
}

/** Figures about the scene (diagnostics, performance smoke test). */
export interface SceneStats {
  triangles: number;
  groups: number;
  planView: boolean;
  /** Point lights in use, lit elements (lamps, screens) and elements with bindings. */
  lights: number;
  lit: number;
  bound: number;
  quality: string;
  camera: {
    target: [number, number, number];
    distance: number;
    yaw: number;
    pitch: number;
    ortho: number;
  };
}

/** A guide edit mode draws while a piece moves (device pixels); `cm` for a distance to a wall. */
export interface EditGuide {
  a: [number, number];
  b: [number, number];
  cm?: number;
}

/** A selected piece. */
export interface EditPiece {
  id: string;
  name: string;
  kind: string;
  /** Fixed in the plan: it cannot be moved, turned or removed. */
  locked: boolean;
}

/** What edit mode shows. */
export interface EditState {
  editing: boolean;
  selection: EditPiece[];
  /** Pieces overlapping another piece or a wall. */
  conflicts: string[];
  guides: EditGuide[];
  canUndo: boolean;
  canRedo: boolean;
  /** Changes not saved. */
  dirty: boolean;
  /** A number that changes whenever the overlay does. */
  changes: number;
  /** `editAdd` and `editAddModel` only: the piece could not be added (500 elements, 50 models). */
  refused?: boolean;
}

/** A 3D file the plan shown draws pieces from, to fetch and read (`setModelMesh`). */
export interface ModelFileRef {
  /** SHA-256 of the file (its name on the server). */
  hash: string;
  format: string;
  bytes: number;
}

/** A user model of the plan shown (« My models »). */
export interface UserModel {
  id: string;
  name: string;
  /** Size of a new piece (cm). */
  w: number;
  d: number;
  h: number;
  color: string | null;
  /** The 3D file's format and size, `null` for a kit of parts. */
  format: string | null;
  bytes: number | null;
  /** How many pieces show it. */
  pieces: number;
  /** Imported in edit mode and shown by no piece: it can be forgotten. */
  removable: boolean;
}

/** An element of the plan shown. */
export interface PlanElement {
  id: string;
  type: "room" | "wall" | "door" | "window" | "furniture";
  name: string;
  /** Furniture only. */
  kind?: string;
}

/** A value of a layer and where it goes on the picture (device pixels from the top left). */
export interface LayerLabel {
  /** The room's id (`heat`) or the piece's (`power`). */
  id: string;
  kind: "heat" | "power";
  /** In the heatmap's unit, or watts. */
  value: number;
  x: number;
  y: number;
}

/** The legend of a heatmap. */
export interface HeatLegend {
  unit: string;
  /** The scale's stops: value and colour (`#rrggbb`). */
  stops: [number, string][];
  /** 16 colours from the first stop to the last, for a CSS gradient. */
  gradient: string[];
}

/** A kind of the catalogue, with its default size (cm). */
export interface CatalogueKind {
  kind: string;
  w: number;
  d: number;
  h: number;
  light: boolean;
}

const NOT_EDITING: EditState = {
  editing: false,
  selection: [],
  conflicts: [],
  guides: [],
  canUndo: false,
  canRedo: false,
  dirty: false,
  changes: 0,
};

function editState(text: string): EditState {
  return { ...NOT_EDITING, ...(JSON.parse(text) as Partial<EditState>) };
}

/**
 * An error raised by the engine; `code` is translated with `errors.plan.<code>`, `element` is the
 * id of the plan element at fault, when there is one.
 */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly element?: string,
  ) {
    super(code);
    this.name = "EngineError";
  }
}

let wasmModule: Promise<typeof Wasm> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;
let wasmLoaded: typeof Wasm | undefined;

/** Loads the WebAssembly engine once per page (it is a separate chunk, fetched on demand). */
export function loadWasm(): Promise<typeof Wasm> {
  wasmModule ??= (async () => {
    const wasm = await import("./pkg/domotwin_web.js");
    const output = await wasm.default({ module_or_path: assetUrl(__DOMOTWIN_WASM__) });
    wasmMemory = output.memory;
    wasmLoaded = wasm;
    return wasm;
  })();
  wasmModule.catch(() => (wasmModule = undefined));
  return wasmModule;
}

/** Size of the engine's WebAssembly memory in bytes (it never shrinks; see PERFORMANCE.md). */
export function wasmMemoryBytes(): number | undefined {
  return wasmMemory?.buffer.byteLength;
}

const legends = new Map<string, HeatLegend | undefined>();

/** The legend of a heatmap (`temperature`, `humidity`, `co2`, `pm25`), once the engine is loaded. */
export function heatLegend(kind: string): HeatLegend | undefined {
  if (!wasmLoaded) return undefined;
  if (!legends.has(kind)) {
    const text = wasmLoaded.heatLegend(kind);
    legends.set(kind, text ? (JSON.parse(text) as HeatLegend) : undefined);
  }
  return legends.get(kind);
}

/** The engine reports plan errors as JSON `{"code", "element"}`, other errors as a bare code. */
export function engineError(error: unknown): EngineError {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { code?: unknown; element?: unknown };
    if (typeof parsed.code === "string") {
      return new EngineError(
        parsed.code,
        typeof parsed.element === "string" ? parsed.element : undefined,
      );
    }
  } catch {
    // A bare code.
  }
  return new EngineError(message);
}

/** One engine per canvas: a typed wrapper around the WebAssembly `Engine`. */
export class DomoTwinEngine {
  private constructor(private engine: Wasm.Engine | undefined) {}

  static async create(canvas: HTMLCanvasElement): Promise<DomoTwinEngine> {
    const wasm = await loadWasm();
    try {
      return new DomoTwinEngine(new wasm.Engine(canvas));
    } catch (error) {
      throw engineError(error);
    }
  }

  private get live(): Wasm.Engine {
    if (!this.engine) throw new EngineError("disposed");
    return this.engine;
  }

  /**
   * Reads a plan and builds its scene; throws an `EngineError` with a stable code when it is
   * refused. The camera stays where it is when `keepCamera` (the same home, saved again).
   */
  loadPlan(json: string, keepCamera = false, layout?: string): PlanSummary {
    try {
      return JSON.parse(this.live.loadPlan(json, keepCamera, layout)) as PlanSummary;
    } catch (error) {
      throw engineError(error);
    }
  }

  /** Sets the bindings (the stored JSON); the scene follows them at once. */
  setBindings(json: string): void {
    this.live.setBindings(json);
  }

  /**
   * Updates entity states: JSON `{ "entity_id": { "state", "attributes" } | null }` with only
   * the entities that changed (`null` forgets one). Lamps fade and moving parts move to them.
   */
  setStates(json: string): void {
    this.live.setStates(json);
  }

  /** Flashes an element briefly (tap feedback). */
  highlight(id: string): void {
    this.live.highlight(id);
  }

  setCutaway(mode: CutawayMode): void {
    this.live.setCutaway(mode);
  }

  /** Fixes the light to a mood (`morning`, `day`, `evening`, `night`). */
  setLightingMood(mood: Exclude<LightingMode, "auto">): void {
    this.live.setLightingMood(mood);
  }

  /** Lights the scene for the sun's elevation (degrees), rising before noon. */
  setSun(elevation: number, rising: boolean): void {
    this.live.setSun(elevation, rising);
  }

  /** Lights the scene for a local time of day (0–24 h). */
  setLocalHour(hour: number): void {
    this.live.setLocalHour(hour);
  }

  /**
   * Lights the scene from where the sun is (`sun.sun`'s azimuth and elevation, degrees) for a
   * plan whose north is `north` degrees clockwise from its top: the light comes in through the
   * windows.
   */
  setSunPosition(azimuth: number, elevation: number, north: number): void {
    this.live.setSunPosition(azimuth, elevation, north);
  }

  /** Back to the default sun, high in the south-east of the plan. */
  useDefaultSun(): void {
    this.live.useDefaultSun();
  }

  /** Shows the room layers (the JSON of `roomLayers`). */
  setLayers(json: string): void {
    this.live.setLayers(json);
  }

  /** Shows or hides the power layer. */
  setPowerLayer(shown: boolean): void {
    this.live.setPowerLayer(shown);
  }

  /** Lets the layers move, or holds them still (reduced motion). */
  setMotion(motion: boolean): void {
    this.live.setMotion(motion);
  }

  /** Whether the layers shown move (frames are then needed all the time). */
  get layersAnimating(): boolean {
    return this.live.layersAnimating();
  }

  /** Whether a camera move, a wall animation or a fade is running (frames at the display rate). */
  get moving(): boolean {
    return this.live.moving();
  }

  /** The elements of the plan shown, the edit overlay applied. */
  elementList(): PlanElement[] {
    return JSON.parse(this.live.elementList()) as PlanElement[];
  }

  /** What the linked cameras see on the floor, as the engine's JSON text (device pixels). */
  cameraViews(): string {
    return this.live.cameraViews();
  }

  /** Where the elements `ids` (JSON array) are drawn now, as the engine's JSON text. */
  elementPoints(ids: string): string {
    return this.live.elementPoints(ids);
  }

  /** The values of the layers shown and where they go, as the engine's JSON text. */
  layerLabels(): string {
    return this.live.layerLabels();
  }

  /** Where the rooms' names go: JSON `[{id, name, x, y}]` (device pixels). */
  roomLabels(): string {
    return this.live.roomLabels();
  }

  /** Turns the camera by a drag of `dx`, `dy` CSS pixels. */
  orbit(dx: number, dy: number): void {
    this.live.orbit(dx, dy);
  }

  /** Moves the view by a drag of `dx`, `dy` CSS pixels on a view `height` CSS pixels high. */
  pan(dx: number, dy: number, height: number): void {
    this.live.pan(dx, dy, height);
  }

  /** Zooms by `factor` (< 1 closer) towards the screen point `x`, `y` in −1…1 (y up). */
  zoom(factor: number, x: number, y: number): void {
    this.live.zoom(factor, x, y);
  }

  /** Shows the 2D plan (`true`) or the 3D view, with an animated move. */
  setPlanView(plan: boolean): void {
    this.live.setPlanView(plan, performance.now());
  }

  get planView(): boolean {
    return this.live.planView();
  }

  /** Back to the whole home. */
  overview(): void {
    this.live.overview(performance.now());
  }

  /** Frames an element; false when it has nothing to show. */
  focusElement(id: string): boolean {
    return this.live.focusElement(id, performance.now());
  }

  /** The plan's saved viewpoints. */
  views(): SavedView[] {
    return JSON.parse(this.live.views()) as SavedView[];
  }

  /** Moves to a saved viewpoint; false when there is none with this id. */
  showView(id: string): boolean {
    return this.live.showView(id, performance.now());
  }

  /** The element drawn at a device pixel of the canvas (from the top left), if any. */
  pick(x: number, y: number): PickedElement | undefined {
    const text = this.live.pick(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)));
    return text ? (JSON.parse(text) as PickedElement) : undefined;
  }

  /** Where an element's centre is drawn now (device pixels from the top left), if anywhere. */
  screenPoint(id: string): [number, number] | undefined {
    const text = this.live.screenPoint(id);
    return text ? (JSON.parse(text) as [number, number]) : undefined;
  }

  get stats(): SceneStats {
    return JSON.parse(this.live.stats()) as SceneStats;
  }

  /** The 3D files the pieces shown are drawn from and whose mesh the engine does not have. */
  modelFiles(): ModelFileRef[] {
    return JSON.parse(this.live.modelFiles()) as ModelFileRef[];
  }

  /** Gives the mesh of a 3D file (from the model module); its pieces change at `showModels`. */
  setModelMesh(hash: string, mesh: Uint8Array): boolean {
    return this.live.setModelMesh(hash, mesh);
  }

  /** Draws the pieces whose 3D file came since the scene was built (one rebuild for all). */
  showModels(): boolean {
    return this.live.showModels();
  }

  /** Pieces drawn as boxes because the plan's 3D files pass the triangle budget. */
  get modelsOverBudget(): number {
    return this.live.modelsOverBudget();
  }

  /** Starts edit mode on the plan shown. */
  beginEdit(): EditState {
    return editState(this.live.beginEdit());
  }

  /** Ids the pieces added in this session must not take (the other storeys'). */
  editReserve(ids: string[]): void {
    this.live.editReserve(ids);
  }

  /** Leaves edit mode, keeping what is shown (`keep`) or going back to what was saved. */
  endEdit(keep: boolean): void {
    this.live.endEdit(keep);
  }

  get editState(): EditState {
    return editState(this.live.editState());
  }

  /** Selects a piece (`add`: adds it to the selection or takes it out; another id clears it). */
  editSelect(id: string, add: boolean): EditState {
    return editState(this.live.editSelect(id, add));
  }

  /** Grabs the selection when the device pixel shows a selected piece that may move. */
  editDragStart(x: number, y: number): boolean {
    return this.live.editDragStart(x, y);
  }

  editDragMove(x: number, y: number): EditState {
    return editState(this.live.editDragMove(x, y));
  }

  editDragEnd(): EditState {
    return editState(this.live.editDragEnd());
  }

  /** Turns the selection by `steps` of 15° (negative: anticlockwise on the plan). */
  editRotate(steps: number): EditState {
    return editState(this.live.editRotate(steps));
  }

  editRemove(): EditState {
    return editState(this.live.editRemove());
  }

  /** Adds a piece of the catalogue under the device pixel `x`, `y` (or mid-view) and selects it. */
  editAdd(kind: string, name: string, x: number, y: number): EditState {
    return editState(this.live.editAdd(kind, name, x, y));
  }

  /**
   * Adds a piece of a user model under the device pixel `x`, `y` (or mid-view) and selects it;
   * `definition` is the model itself when it is imported now.
   */
  editAddModel(
    id: string,
    definition: Record<string, unknown> | undefined,
    x: number,
    y: number,
  ): EditState {
    const text = definition ? JSON.stringify(definition) : "";
    return editState(this.live.editAddModel(id, text, x, y));
  }

  /** Forgets a model imported in edit mode that no piece shows. */
  editRemoveModel(id: string): EditState {
    return editState(this.live.editRemoveModel(id));
  }

  /** The plan's user models (« My models »). */
  editModels(): UserModel[] {
    return JSON.parse(this.live.editModels()) as UserModel[];
  }

  editUndo(): EditState {
    return editState(this.live.editUndo());
  }

  editRedo(): EditState {
    return editState(this.live.editRedo());
  }

  /** Puts a whole overlay in place (a draft kept by the browser), as one change to undo. */
  editRestore(layout: Record<string, unknown>): EditState {
    return editState(this.live.editRestore(JSON.stringify(layout)));
  }

  /** The edit overlay now (what Save stores). */
  editLayout(): Record<string, unknown> {
    return JSON.parse(this.live.editLayout()) as Record<string, unknown>;
  }

  /** The overlay `layout` (what was sent) was stored; later changes stay to be saved. */
  editSaved(layout: Record<string, unknown>): void {
    this.live.editSaved(JSON.stringify(layout));
  }

  /**
   * Shows a plan drawn in the plan editor (no overlay), `selected` marked; the plan stored stays,
   * to come back to with `loadPlan`. The camera stays, unless nothing was shown.
   */
  showDraft(plan: string, selected: string): void {
    try {
      this.live.showDraft(plan, selected);
    } catch (error) {
      throw engineError(error);
    }
  }

  /**
   * The plan shown with its edit overlay in it, at the current revision (what the plan editor
   * starts from); an empty string when none is shown.
   */
  shownPlan(): string {
    return this.live.shownPlan();
  }

  /** Marks an element as selected in the draft shown ("": none), without building it again. */
  markSelected(id: string): void {
    this.live.markSelected(id);
  }

  /** Shows no plan (a new plan drawn and dropped). */
  clearPlan(): void {
    this.live.clearPlan();
  }

  /** The plan point (cm) on the floor under a device pixel; undefined off the floor. */
  planPoint(x: number, y: number): [number, number] | undefined {
    const p = this.live.planPoint(x, y);
    return p.length === 2 ? [p[0] ?? 0, p[1] ?? 0] : undefined;
  }

  /** Where plan points (cm, `[x0, y0, x1, y1…]`) are drawn, in device pixels (NaN: not drawn). */
  screenPoints(points: ArrayLike<number>): Float64Array {
    return this.live.screenPoints(Float64Array.from(points));
  }

  resize(width: number, height: number): void {
    this.live.resize(width, height);
  }

  setBackground(color: Rgb): void {
    this.live.setBackground(color.r, color.g, color.b);
  }

  /** Sets the look (`day`, `neon`, `blueprint`) and its accent (`#rrggbb`). Returns the look. */
  setTheme(theme: string, accent: string): string {
    return this.live.setTheme(theme, accent);
  }

  setQuality(quality: QualityName): void {
    this.live.setQuality(quality);
  }

  get quality(): string {
    return this.live.quality();
  }

  get needsFrame(): boolean {
    return this.live.needsFrame();
  }

  invalidate(): void {
    this.live.invalidate();
  }

  /** Draws a frame; true while an animation needs more frames. */
  frame(time: number): boolean {
    return this.live.frame(time);
  }

  dispose(): void {
    this.engine?.free();
    this.engine = undefined;
  }
}

/** Checks a plan without a canvas (used by the import). */
export async function summarizePlan(json: string): Promise<PlanSummary> {
  const wasm = await loadWasm();
  try {
    return JSON.parse(wasm.summarizePlan(json)) as PlanSummary;
  } catch (error) {
    throw engineError(error);
  }
}

/** The kinds a piece can be added as, with their default sizes. */
export async function catalogue(): Promise<CatalogueKind[]> {
  const wasm = await loadWasm();
  return JSON.parse(wasm.Engine.editCatalogue()) as CatalogueKind[];
}

/** The plan with its edit overlay applied, as **Export plan** writes it (revision 10). */
export async function applyLayout(plan: string, layout: string): Promise<string> {
  const wasm = await loadWasm();
  try {
    return wasm.applyLayout(plan, layout);
  } catch (error) {
    throw engineError(error);
  }
}
