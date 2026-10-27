import { wasmLoader } from "../assets";
import type { Rgb } from "../color";
import type { CutawayMode, LightingMode, QualityName } from "../config";
import type * as Wasm from "./pkg/domotwin_web.js";

/** What `loadPlan` returns: counts of the plan's elements. */
export interface PlanSummary {
  /** Entries of the edit overlay left out because they made the plan invalid (an updated plan). */
  layoutRefused?: number;
  name: string;
  rooms: number;
  walls: number;
  doors: number;
  windows: number;
  furniture: number;
}

/** A storey of the home shown whole (`loadStoreys`, D-028): its plan with its overlay. */
export interface HomeStorey {
  id: string;
  name: string;
  /** Height of its floor (cm). */
  elevation: number;
  plan: unknown;
  layout?: Record<string, unknown>;
}

/** What `loadStoreys` returns: the counts of every storey's elements, and the storeys. */
export interface HomeSummary extends PlanSummary {
  storeys: number;
}

/** Where a storey of the home shown whole is drawn (device pixels from the top left). */
export interface StoreyLabel {
  id: string;
  name: string;
  /** Where its label goes (device pixels): beside the storey, or over it on the 2D plan (`top`). */
  x: number;
  y: number;
  top: boolean;
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
  /** The storey it is on, when the home is shown whole. */
  storey?: string;
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
  theme: string;
  /** Outlines drawn by the looks. */
  lines: number;
  /** Storeys shown, spread apart or not, the roof shown or not (D-028). */
  storeys: number;
  spread: boolean;
  roof: boolean;
  /** Walking at eye level (D-029). */
  walking: boolean;
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
  /** Furniture only: its kind. */
  kind?: string;
  /** A piece's, a door's or a window's room (a door's, of the side drawn with it), and a door's
   * or a window's room on its other side. */
  room?: string;
  beside?: string;
}

/** A value of a layer and where it goes on the picture (device pixels from the top left). */
export interface LayerLabel {
  /** The room's id (`heat`, `draw`: what it draws during a peak, D-063) or the piece's (`power`). */
  id: string;
  kind: "heat" | "draw" | "power";
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

/** A style of a kind of the catalogue (D-070), with its usual size (cm). */
export interface CatalogueStyle {
  style: string;
  w: number;
  d: number;
  h: number;
}

/** A kind of the catalogue, with its default size (cm) and its styles. */
export interface CatalogueKind {
  kind: string;
  w: number;
  d: number;
  h: number;
  light: boolean;
  styles: CatalogueStyle[];
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

let wasmMemory: WebAssembly.Memory | undefined;
let wasmLoaded: typeof Wasm | undefined;

const loadEngineWasm = wasmLoader(
  () => import("./pkg/domotwin_web.js"),
  __DOMOTWIN_WASM__,
  (output) => (wasmMemory = output.memory),
);

/** Loads the WebAssembly engine once per page (it is a separate chunk, fetched on demand). */
export async function loadWasm(): Promise<typeof Wasm> {
  const wasm = await loadEngineWasm();
  wasmLoaded = wasm;
  return wasm;
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

/**
 * Where every upkeep card stands on `today` (`YYYY-MM-DD`, D-033), as the engine's JSON text
 * `{piece: {"state", "warranty", "tasks": [{"id", "due", "state", "days"}]}}`, once the engine is
 * loaded.
 */
export function upkeepStates(upkeep: string, today: string): string | undefined {
  return wasmLoaded?.upkeepStates(upkeep, today);
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

/** Gives a canvas's WebGL context back now rather than at garbage collection. */
function releaseContext(canvas: HTMLCanvasElement): void {
  canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
}

/** One engine per canvas: a typed wrapper around the WebAssembly `Engine`. */
export class DomoTwinEngine {
  /** The canvas's context, which the engine made. */
  private readonly gl: WebGL2RenderingContext | null;

  private constructor(
    private engine: Wasm.Engine | undefined,
    canvas: HTMLCanvasElement,
  ) {
    this.gl = canvas.getContext("webgl2");
  }

  /** The GPU, as WebGL names it (as the engine reads it for its quality): the measure (D-053). */
  get renderer(): string | undefined {
    const gl = this.gl;
    if (!gl) return undefined;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return typeof name === "string" && name !== "" ? name : undefined;
  }

  /**
   * Creates the engine on `canvas` once the WebAssembly is loaded, unless `wanted` says by then
   * that it is no longer wanted (`cancelled`): the canvas is then left without a context.
   */
  static async create(
    canvas: HTMLCanvasElement,
    wanted: () => boolean = () => true,
  ): Promise<DomoTwinEngine> {
    const wasm = await loadWasm();
    if (!wanted()) throw new EngineError("cancelled");
    try {
      return new DomoTwinEngine(new wasm.Engine(canvas), canvas);
    } catch (error) {
      // The context may have been made before the engine failed.
      releaseContext(canvas);
      throw engineError(error);
    }
  }

  private get live(): Wasm.Engine {
    if (!this.engine) throw new EngineError("disposed");
    // A lost context makes nothing the renderer asks for: refused until the view starts again.
    if (this.gl?.isContextLost()) throw new EngineError("context_lost");
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

  /**
   * Shows every storey of the home at once (D-028), lowest first, the roof over the top one;
   * throws an `EngineError` (naming its storey) when a storey's plan is refused. Edit mode needs a
   * storey alone (`loadPlan`).
   */
  loadStoreys(storeys: HomeStorey[], keepCamera = false): HomeSummary {
    try {
      return JSON.parse(this.live.loadStoreys(JSON.stringify(storeys), keepCamera)) as HomeSummary;
    } catch (error) {
      throw engineError(error);
    }
  }

  /** Spreads the storeys of the home apart, or stacks them, with an animated move. */
  setSpread(spread: boolean): void {
    this.live.setSpread(spread, performance.now());
  }

  /** Shows or hides the roof over the top storey. */
  setRoof(shown: boolean): void {
    this.live.setRoof(shown);
  }

  /** Where each storey of the home shown whole is drawn (its label goes there). */
  storeyLabels(): StoreyLabel[] {
    return JSON.parse(this.live.storeyLabels()) as StoreyLabel[];
  }

  /**
   * A picture of storey `index` (lowest first) alone, `width` × `height` pixels: RGBA rows from
   * the top; empty without that storey.
   */
  storeyPicture(index: number, width: number, height: number): Uint8Array {
    return this.live.storeyPicture(index, width, height);
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

  /** Where each piece's upkeep stands (JSON `{piece: "fine" | "due" | "overdue"}`, D-033). */
  setUpkeep(json: string): void {
    this.live.setUpkeep(json);
  }

  /** Shows or hides the upkeep layer: the pieces tinted by where their upkeep stands. */
  setUpkeepLayer(shown: boolean): void {
    this.live.setUpkeepLayer(shown);
  }

  /**
   * The people to draw in their rooms (D-034): JSON `[{"id", "room", "color", "look"}]`. A figure
   * new to the home fades in, one whose room changed walks there, one gone fades out.
   */
  setPeople(json: string): void {
    this.live.setPeople(json);
  }

  /**
   * What the robot vacuums do (D-049): JSON `[{"id": "<robot-vacuum piece>", "state"}]`, the
   * state its vacuum's. A robot-vacuum piece not named rests on its dock.
   */
  setRobots(json: string): void {
    this.live.setRobots(json);
  }

  /** Where the people's names go: JSON `[{"id", "x", "y", "opacity"}]` in device pixels. */
  peoplePoints(): string {
    return this.live.peoplePoints();
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

  /** Where what the linked cameras see is on the screen, as the engine's JSON text (device
   * pixels; for tests and tools: the engine draws them, D-038). */
  cameraViews(): string {
    return this.live.cameraViews();
  }

  /** Draws the rooms `ids` closed: private rooms this viewer may not see (D-039). Returns
   * whether the scene was built again. */
  setPrivateRooms(ids: string[]): boolean {
    return this.live.setPrivateRooms(JSON.stringify(ids));
  }

  /** Draws what the linked cameras see on the floor, or not (D-038). */
  setCameraViews(shown: boolean): void {
    this.live.setCameraViews(shown);
  }

  /** Draws the view of the camera linked to element `id` whole for a while, the others faint
   * (another id, or "", draws them all faint); returns how long (ms), 0 for no camera. */
  focusCamera(id: string): number {
    return this.live.focusCamera(id, performance.now());
  }

  /** Where the elements `ids` (JSON array) are drawn now, as the engine's JSON text. */
  elementPoints(ids: string): string {
    return this.live.elementPoints(ids);
  }

  /**
   * Shows the radio mesh `drawing` draws (D-031; the analysis module's drawing, D-043) over the
   * home, or hides it (an empty string). Returns the room each device is in, as JSON text (an
   * array of names or nulls; empty when hidden).
   */
  setNetwork(drawing: string): string {
    return this.live.setNetwork(drawing);
  }

  /** The link of the network map nearest a device pixel, as JSON text `{"a", "b"}`, or "". */
  networkAt(x: number, y: number): string {
    return this.live.networkAt(x, y);
  }

  /**
   * Shows the wires of automations (D-032; JSON text `{"automations": [...], "grouped",
   * "faded", "bundle"}`, `"{}"` hides them). Returns the spots their ends are at, as JSON text.
   */
  setAutomations(json: string): string {
    return this.live.setAutomations(json);
  }

  /** Where each spot of the automations shown is drawn now, as JSON text `[[x, y] | null]`. */
  automationPoints(): string {
    return this.live.automationPoints();
  }

  /** The automations of the wire nearest a device pixel, as JSON text `["automation.…"]`, or "". */
  automationAt(x: number, y: number): string {
    return this.live.automationAt(x, y);
  }

  /** Picks one automation out of those shown (its id; "" for none). */
  pickAutomation(id: string): void {
    this.live.pickAutomation(id);
  }

  /** An automation ran: a pulse along its wires. Whether it has wires shown. */
  pulseAutomation(id: string, time: number): boolean {
    return this.live.pulseAutomation(id, time);
  }

  /** The values of the layers shown and where they go, as the engine's JSON text. */
  layerLabels(): string {
    return this.live.layerLabels();
  }

  /** Where the rooms' names go: JSON `[{id, name, x, y, area}]` (device pixels, m²). */
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

  /**
   * Walks through the storey shown at eye level (D-029), or stops; false when it cannot (every
   * storey shown, no plan, edit mode).
   */
  setWalk(on: boolean): boolean {
    return this.live.setWalk(on, performance.now());
  }

  get walking(): boolean {
    return this.live.walking;
  }

  /** Walking: moves on its own ahead and to the right (−1…1 each, 0 to stop). */
  setWalkVelocity(ahead: number, right: number): void {
    this.live.setWalkVelocity(ahead, right);
  }

  /** Walking: walks to the floor under a point (device pixels); false when there is none. */
  walkTo(x: number, y: number): boolean {
    return this.live.walkTo(x, y);
  }

  /** The kiosk's slow turn around the home (radians per second, 0 to stop). */
  setAutoOrbit(perSecond: number): void {
    this.live.setAutoOrbit(perSecond);
  }

  /** Whether the kiosk's turn moves the camera (frames go on, slowly). */
  get orbiting(): boolean {
    return this.live.orbiting;
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

  /**
   * Adds a piece of the catalogue in `style` (none: the kind's own) under the device pixel `x`,
   * `y` (or mid-view) and selects it.
   */
  editAdd(kind: string, name: string, x: number, y: number, style?: string): EditState {
    return editState(this.live.editAdd(kind, name, x, y, style ?? null));
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
   * The plan shown with its edit overlay in it (what the plan editor starts from); an empty
   * string when none is shown.
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

  /** Sets the look (`day`, `neon`, `blueprint`, `cartoon`, `clay`) and its accent (`#rrggbb`).
   * Returns the look. */
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

  /** Frees the engine and gives its canvas's context back. */
  dispose(): void {
    if (!this.engine) return;
    this.engine.free();
    this.engine = undefined;
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
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

/** The kinds a piece can be added as, with their default sizes and their styles. */
export async function catalogue(): Promise<CatalogueKind[]> {
  const wasm = await loadWasm();
  return JSON.parse(wasm.Engine.editCatalogue()) as CatalogueKind[];
}

/**
 * Draws the catalogue's pictures of its pieces (D-070) with an engine of its own, on a canvas
 * nobody sees, in the look of the view: made when the catalogue opens, freed when it closes.
 */
export class PieceArtist {
  private constructor(
    private engine: Wasm.Engine | undefined,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /** An artist drawing in `look` with `accent` (`#rrggbb`), by daylight. */
  static async create(look: string, accent: string): Promise<PieceArtist> {
    const wasm = await loadWasm();
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    try {
      const engine = new wasm.Engine(canvas);
      engine.setTheme(look, accent);
      engine.setLightingMood("day");
      return new PieceArtist(engine, canvas);
    } catch (error) {
      releaseContext(canvas);
      throw engineError(error);
    }
  }

  /**
   * A picture of `kind` in `style` (empty: its own) on `background` (`#rrggbb`), `width` ×
   * `height` device pixels; none once freed, when the context is lost or for a kind the engine
   * does not know.
   */
  draw(
    kind: string,
    style: string,
    width: number,
    height: number,
    background: string,
  ): ImageData | undefined {
    const engine = this.engine;
    if (!engine || this.canvas.getContext("webgl2")?.isContextLost()) return undefined;
    const pixels = engine.piecePicture(kind, style, width, height, background);
    if (pixels.length !== width * height * 4) return undefined;
    return new ImageData(new Uint8ClampedArray(pixels), width, height);
  }

  /** Frees the engine and gives its canvas's context back. */
  dispose(): void {
    if (!this.engine) return;
    this.engine.free();
    this.engine = undefined;
    releaseContext(this.canvas);
  }
}

/** The plan with its edit overlay applied, as **Export plan** writes it. */
export async function applyLayout(plan: string, layout: string): Promise<string> {
  const wasm = await loadWasm();
  try {
    return wasm.applyLayout(plan, layout);
  } catch (error) {
    throw engineError(error);
  }
}
