import {
  mdiAlert,
  mdiAlertCircleOutline,
  mdiBatteryAlertVariantOutline,
  mdiCamera,
  mdiCctv,
  mdiCctvOff,
  mdiChevronUp,
  mdiCubeOutline,
  mdiDishwasher,
  mdiDoorOpen,
  mdiFan,
  mdiFloorPlan,
  mdiHomeOutline,
  mdiLayersOutline,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiPlay,
  mdiPowerPlug,
  mdiPrinter,
  mdiPrinter3d,
  mdiRecordRec,
  mdiStove,
  mdiTumbleDryer,
  mdiWashingMachine,
} from "@mdi/js";
import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";

import { themeBackground, type Rgb } from "../color";
import type { CutawayMode, LightingMode, QualityName, SunMode, ViewMode } from "../config";
import {
  DomoTwinEngine,
  EngineError,
  engineError,
  heatLegend,
  wasmMemoryBytes,
  type EditState,
  type LayerLabel,
  type PickedElement,
  type PlanSummary,
  type SavedView,
  type SceneStats,
  type UserModel,
} from "../engine/engine";
import {
  GestureTracker,
  HOLD_TIME,
  TAP_SLOP,
  wheelFactor,
  type Gesture,
  type PointerSample,
} from "../gestures";
import type { StoreyInfo, StoredPlan } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { runAction } from "../live/actions";
import {
  boundEntityIds,
  entityName,
  holdAction,
  primaryEntity,
  roomArea,
  tapAction,
  type Action,
  type BindingsJson,
  type ElementBinding,
} from "../live/bindings";
import {
  HEAT_KINDS,
  LAYER_NAMES,
  formatHeat,
  formatPower,
  roomLayers,
  type LayerName,
  type PlanRoom,
} from "../live/layers";
import { deviceBadges, type Badge, type BadgeKind } from "../live/devices";
import { StateSync } from "../live/states";
import {
  storeyLevels,
  storeyName,
  storeyShort,
  withAlertsElsewhere,
  type StoreyAlert,
  type StoreyRooms,
} from "../live/storeys";
import { planRooms } from "../live/suggest";
import { FrameScheduler } from "../scheduler";
import { fire } from "./define";
import { icon } from "./icon";
import type { Planner } from "../planner/planner";
import type { PlanEditState, PlanEditor, PlanTool } from "./plan-editor";
import { baseStyles } from "./styles";

type EngineState = "idle" | "loading" | "ready" | "unsupported" | "failed";

/** Options of a view (from the card configuration or the panel). */
export interface ViewOptions {
  quality: QualityName;
  /** View shown first. */
  view?: ViewMode;
  cutaway?: CutawayMode;
  /** The light: following the time of day (`auto`, the default) or fixed. */
  lighting?: LightingMode;
  /** Room framed first (an element id of the plan). */
  room?: string;
  /** The layer shown first. */
  layer?: LayerName;
  /** Room alerts (on unless `false`). */
  alerts?: boolean;
  /** Rooms someone is in glow (on unless `false`). */
  presence?: boolean;
  /** Where the sun lights from (`fixed` unless set). */
  sun?: SunMode;
  /** Badges over the devices (on unless `false`). */
  badges?: boolean;
  /** What the cameras see, on the floor (on unless `false`). */
  cameras?: boolean;
}

/** What a camera sees, as drawn now (device pixels). */
interface CameraShape {
  id: string;
  entity: string;
  points: [number, number][];
}

/** The icon of each badge; running appliances show their own. */
const BADGE_ICONS: Record<Exclude<BadgeKind, "running">, string> = {
  locked: mdiLock,
  unlocked: mdiLockOpenVariant,
  jammed: mdiLockAlert,
  lock_moving: mdiLockClock,
  lock_open: mdiDoorOpen,
  camera: mdiCctv,
  recording: mdiRecordRec,
  camera_off: mdiCctvOff,
  playing: mdiPlay,
  battery_low: mdiBatteryAlertVariantOutline,
};
const APPLIANCE_ICONS: Record<string, string> = {
  washer: mdiWashingMachine,
  dryer: mdiTumbleDryer,
  dishwasher: mdiDishwasher,
  stove: mdiStove,
  hood: mdiFan,
  printer: mdiPrinter,
  printer3d: mdiPrinter3d,
};

function badgeIcon(badge: Badge): string {
  return badge.kind === "running"
    ? (APPLIANCE_ICONS[badge.appliance ?? ""] ?? mdiPowerPlug)
    : BADGE_ICONS[badge.kind];
}

/** Device pixel ratio cap: sharper than this costs fill rate for little visible gain. */
const MAX_PIXEL_RATIO = 2;
/** Adaptive resolution: lowest scale of the drawing buffer, and frame budgets (ms of CPU). */
const MIN_RESOLUTION = 0.6;
const SLOW_FRAME_MS = 22;
const FAST_FRAME_MS = 8;
/** Keyboard steps: pixels of drag per arrow press, zoom factor per +/- press. */
const KEY_STEP = 40;
const KEY_ZOOM = 0.85;
/** How often the light follows the time of day without a `hass` update (ms). */
const LIGHT_REFRESH_MS = 5 * 60 * 1000;
const FALLBACK_BACKGROUND: Rgb = { r: 242, g: 242, b: 240 };
/** How long a notice (a failed action) stays (ms). */
const NOTICE_MS = 5000;
/** Frame interval of the layers' animation alone (ms): 24 frames per second. */
const LAYER_FRAME_MS = 1000 / 24;
/** Alerts listed in the banner; the others are counted. */
const MAX_ALERTS_SHOWN = 2;
/** The power layer's colours, from a few watts to 3 kW (`shaders.rs`). */
const POWER_GRADIENT = ["#ffe459", "#ff7b2b"];
const NO_BINDINGS: BindingsJson = { version: 1, rooms: {}, elements: {} };

/** The panel open over the scene: an element's controls or a room's panel. */
type Sheet =
  | { kind: "controls"; heading: string; entities: string[] }
  | { kind: "room"; heading: string; area?: string };

/** A room framed by a tap. */
interface FocusedRoom {
  id: string;
  name: string;
}

/** What the edit bar asks the view to do. */
export type EditCommand = "undo" | "redo" | "rotate-left" | "rotate-right" | "remove" | "clear";

/** Edit mode's keys: Delete, R (Shift+R the other way), Ctrl+Z, Ctrl+Y, Escape. */
export function editCommandFor(event: KeyboardEvent): EditCommand | undefined {
  const control = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === "Delete" || event.key === "Backspace") return "remove";
  if (key === "r" && !control) return event.shiftKey ? "rotate-left" : "rotate-right";
  if (key === "z" && control) return event.shiftKey ? "redo" : "undo";
  if (key === "y" && control) return "redo";
  if (event.key === "Escape") return "clear";
  return undefined;
}

/** What the plan bar and the keys ask the plan editor to do. */
export type PlanCommand = "undo" | "redo" | "remove" | "clear" | "remove-corner";

/** The plan editor's keys: Delete, Ctrl+Z, Ctrl+Y (Ctrl+Shift+Z), Escape. */
export function planCommandFor(event: KeyboardEvent): PlanCommand | undefined {
  const control = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === "Delete" || event.key === "Backspace") return "remove";
  if (key === "z" && control) return event.shiftKey ? "redo" : "undo";
  if (key === "y" && control) return "redo";
  if (event.key === "Escape") return "clear";
  return undefined;
}

/** Frame timings measured by `benchmark()` (frame-time smoke test). */
export interface FrameStats {
  frames: number;
  wasmMemoryBytes: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  intervalMedianMs: number;
  intervalP95Ms: number;
}

/** What `debugState()` reports. */
export interface DebugState {
  engine: EngineState;
  frames: number;
  /** Least time between the frames of an animation (ms; 0: the display's rate). */
  frameInterval: number;
  planView: boolean;
  resolution: number;
  /** What the light follows: `mood:<name>`, `sun:<elevation>:<rising>` or `clock:<hour>`. */
  light?: string;
  /** Where the sun lights from: `default`, or `<azimuth>:<elevation>:<north>` (the real sun). */
  sun?: string;
  /** The layer shown and what the engine was given for the rooms (`setLayers`). */
  layer?: string;
  layers?: string;
  /** Rooms with an alert, dangers first. */
  alerts?: string[];
  quality?: string;
  summary?: PlanSummary;
  stats?: SceneStats;
  /** The open panel: `controls:<entities>` or `room:<area>`. */
  sheet?: string;
  /** Edit mode, when on. */
  edit?: { selection: string[]; conflicts: string[]; guides: number; dirty: boolean };
  /** The plan editor, when on: its tool, the element selected, its corners, unsaved changes. */
  planEdit?: { tool: string; selection: string | null; corners: number; dirty: boolean };
  /** 3D files: fetched and read (`loadMs`, each), drawn (`drawMs`, each rebuild), and failed. */
  models?: { loadMs: number[]; drawMs: number[]; failed: number };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/**
 * `<domotwin-view>`: one canvas, one engine, rendered on demand. Shared by the card and the panel.
 * Everything GPU-side is released when the element leaves the page.
 */
export class DomoTwinView extends LitElement {
  static override properties = {
    hass: { attribute: false },
    plan: { attribute: false },
    layout: { attribute: false },
    bindings: { attribute: false },
    linking: { attribute: false },
    editing: { attribute: false },
    planEditing: { attribute: false },
    planTool: { attribute: false },
    planBlank: { attribute: false },
    planReserved: { attribute: false },
    multiSelect: { attribute: false },
    editKeys: { attribute: false },
    options: { attribute: false },
    planError: { attribute: false },
    engineState: { state: true },
    summary: { state: true },
    loadError: { state: true },
    planView: { state: true },
    savedViews: { state: true },
    viewsOpen: { state: true },
    sheet: { state: true },
    focusedRoom: { state: true },
    notice: { state: true },
    edit: { state: true },
    planEditor: { state: true },
    north: { attribute: false },
    storeys: { attribute: false },
    storey: { attribute: false },
    elsewhere: { attribute: false },
    layer: { state: true },
    layersOpen: { state: true },
    realSun: { state: true },
    alerts: { state: true },
    labels: { state: true },
    showBadges: { state: true },
    showCameras: { state: true },
    badges: { state: true },
    badgePoints: { state: true },
    cameraShapes: { state: true },
  };

  hass?: HomeAssistant;
  /** `undefined` while loading, `null` when no plan is stored. */
  plan?: StoredPlan["plan"];
  /** The edit overlay applied to the plan (pieces moved, removed or added in edit mode). */
  layout?: StoredPlan["layout"];
  /** What the plan's elements and rooms are bound to (`undefined`: nothing bound). */
  bindings?: BindingsJson;
  /**
   * Link mode (the panel's bindings editor): taps and long presses pick an element
   * (`domotwin-pick`, detail: the picked element) instead of acting.
   */
  linking = false;
  /**
   * Edit mode (the panel's): a tap selects a piece, dragging a selected piece moves it. Every
   * change fires `domotwin-edit` (detail: the `EditState`).
   */
  editing = false;
  /**
   * The plan editor (the panel's; `DECISIONS.md`, D-025): rooms, partitions, doors and windows are
   * drawn and changed with `planTool`, in 2D. Every change fires `domotwin-plan-edit` (detail: the
   * `PlanEditState`). Without a plan, it starts a new one.
   */
  planEditing = false;
  planTool: PlanTool = "select";
  /** The plan editor starts on a new plan, whatever is shown (a new storey). */
  planBlank = false;
  /**
   * Ids the other storeys use: what the plan editor draws and what edit mode adds never take them
   * (ids are the home's).
   */
  planReserved: string[] = [];
  /** In edit mode, taps add pieces to the selection (or take them out). */
  multiSelect = false;
  /** Edit mode's keys act (not while the panel shows a dialog over the view). */
  editKeys = true;
  options: ViewOptions = { quality: "auto" };
  /** An error to show instead of the plan (e.g. the stored plan could not be fetched). */
  planError?: string;
  /** Where north points on the plan, degrees clockwise from its top (the home's settings). */
  north = 0;
  /**
   * The storeys of the home and the one shown (its `plan`): with several, a switcher fires
   * `domotwin-storey` (detail: the storey's id) for the host to show it.
   */
  storeys: StoreyInfo[] = [];
  storey?: string;
  /** The rooms of the other storeys: their alerts show too, and a tap on one goes there. */
  elsewhere: StoreyRooms[] = [];

  protected engineState: EngineState = "idle";
  protected summary?: PlanSummary;
  protected loadError?: EngineError;
  protected planView = false;
  protected savedViews: SavedView[] = [];
  protected viewsOpen = false;
  protected sheet?: Sheet;
  protected focusedRoom?: FocusedRoom;
  protected notice?: string;
  /** The edit session's state while edit mode is on. */
  protected edit?: EditState;
  /** The plan editor while it is on (and while its module loads), and whether the 3D view was shown before it. */
  protected planEditor?: PlanEditor;
  private planOpening = false;
  /** Counts the plan editor's opens: one that ends after a later one (or after the view left the page) is dropped. */
  private planToken = 0;
  /** The draft kept while the view is away from the page, to go on with when it comes back. */
  private parked?: { planner: Planner; empty: boolean };
  private planViewBefore = false;
  /** The layer shown (the layer menu), and the menu open. */
  protected layer: LayerName = "off";
  protected layersOpen = false;
  /** Sunlight through the windows: the sun where it really is. */
  protected realSun = false;
  /** Rooms with an alert, dangers first (the other storeys' with their storey). */
  protected alerts: StoreyAlert[] = [];
  /** A room to frame once its storey is shown (an alert on another storey was tapped). */
  private focusAfterLoad?: { id: string; name: string };
  /** The values of the layer shown and where they go (device pixels). */
  protected labels: LayerLabel[] = [];
  /** The devices' badges and what the cameras see (the layer menu turns them off). */
  protected showBadges = true;
  protected showCameras = true;
  protected badges = new Map<string, Badge[]>();
  /** Where each element with badges is drawn (device pixels). */
  protected badgePoints: Record<string, [number, number] | undefined> = {};
  protected cameraShapes: CameraShape[] = [];

  private engine?: DomoTwinEngine;
  private canvas?: HTMLCanvasElement;
  private scheduler?: FrameScheduler;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private generation = 0;
  private background?: Rgb;
  private loadedPlan?: unknown;
  private loadedLayout?: unknown;
  private readonly gestures = new GestureTracker();
  /** Scale of the drawing buffer, lowered while frames are slow. */
  private resolution = 1;
  private frameCost = 0;
  private lastResolutionChange = 0;
  private stage?: HTMLElement;
  /** What the light was last set from (mood, sun position or clock), to skip repeats. */
  private lightKey?: string;
  /** Where the sun was last set from, and the room layers last sent, to skip repeats. */
  private sunKey?: string;
  private layersKey?: string;
  /** The rooms of the plan shown, and whether a heatmap found values in them. */
  private rooms: PlanRoom[] = [];
  private heatValues = 0;
  /** The badges last worked out, and the badges' points and cameras last read from the engine. */
  private badgesKey = "";
  private pointsText = "{}";
  private camerasText = "[]";
  /** The kind of each piece and the name and type of each element of the plan shown. */
  private kinds: Record<string, string> = {};
  private names: Record<string, { name: string; type: string }> = {};
  /** The labels' JSON last read from the engine, and whether they must be read again. */
  private labelsText = "";
  private labelsDue = true;
  private readonly motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : undefined;
  private readonly onMotion = (): void => {
    this.engine?.setMotion(!this.motionQuery?.matches);
    this.redraw();
  };
  private lightTimer?: number;
  /** Entity states already sent to the engine, and the entities bound. */
  private readonly states = new StateSync();
  /** 3D files asked for (by hash), those that could not be read, and how long they took. */
  private readonly modelsLoading = new Set<string>();
  private readonly modelsFailed = new Set<string>();
  private readonly modelTimes: { loadMs: number[]; drawMs: number[] } = { loadMs: [], drawMs: [] };
  /** Meshes came since the last frame: their pieces are drawn at the next one. */
  private modelsCame = false;
  private bound = new Set<string>();
  private holdTimer?: number;
  private noticeTimer?: number;
  /**
   * The pointer that grabbed pieces in edit mode, where it was pressed, whether it has moved past
   * the tap distance (before that, nothing moves), and where it waits to be applied.
   */
  private dragPointer?: number;
  private dragFrom?: { x: number; y: number };
  private dragging = false;
  /** The press on a selected piece was held: a long press, not a tap. */
  private dragHeld = false;
  private dragTo?: { x: number; y: number };
  /** Ctrl, Cmd or Shift held at the last press: a tap adds to the selection. */
  private addModifier = false;
  /** The panels' module, loaded the first time one opens. */
  private sheets?: Promise<unknown>;
  private readonly onVisibility = (): void => {
    this.scheduler?.setPageVisible(document.visibilityState === "visible");
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        min-height: 160px;
        background: var(--card-background-color, #f2f2f0);
      }
      .stage,
      .stage canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        touch-action: none;
      }
      .stage {
        cursor: grab;
        outline: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .stage:active {
        cursor: grabbing;
      }
      .stage:focus-visible {
        box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
      }
      .tools {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
      }
      .tools button {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color, #1f2328);
        cursor: pointer;
      }
      .tools button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .tools button[aria-pressed="true"] {
        color: var(--primary-color, #03a9f4);
      }
      .tools .storey {
        font: inherit;
        font-weight: 600;
        font-size: 0.95rem;
        font-variant-numeric: tabular-nums;
      }
      .tools .storey[aria-pressed="true"] {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent);
      }
      .tools .storey.alert {
        position: relative;
      }
      .tools .storey.alert::after {
        content: "";
        position: absolute;
        top: 5px;
        right: 5px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--warning-color, #ff9800);
      }
      .tools .storey.alert.danger::after {
        background: var(--error-color, #db4437);
      }
      .tools .rule {
        height: 1px;
        margin: 2px 6px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .views {
        position: absolute;
        top: 12px;
        right: 68px;
        min-width: 160px;
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 6px;
        display: grid;
      }
      .views button {
        min-height: 40px;
        padding: 0 12px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .views button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .views button[aria-checked="true"] {
        color: var(--primary-color, #03a9f4);
        font-weight: 600;
      }
      .views hr {
        width: 100%;
        margin: 4px 0;
        border: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .legend {
        position: absolute;
        right: 12px;
        bottom: 12px;
        width: 168px;
        padding: 8px 12px;
        display: grid;
        gap: 4px;
        font-size: 0.75rem;
      }
      .legend .bar {
        height: 8px;
        border-radius: 4px;
      }
      .legend .ends {
        display: flex;
        justify-content: space-between;
        color: var(--secondary-text-color, #5f6368);
      }
      .legend .name {
        font-weight: 600;
      }
      :host([legend]) .chip {
        max-width: calc(100% - 216px);
      }
      .labels {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
      }
      .labels span {
        position: absolute;
        transform: translate(-50%, -50%);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.75rem;
        font-weight: 600;
        white-space: nowrap;
        color: var(--primary-text-color, #1f2328);
        background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
      }
      .labels span.power {
        transform: translate(-50%, -130%);
      }
      .cameras {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .cameras polygon {
        fill: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, transparent);
        stroke: color-mix(in srgb, var(--primary-color, #03a9f4) 55%, transparent);
        stroke-width: 1.5;
        stroke-linejoin: round;
      }
      .cameras polygon.recording {
        fill: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent);
        stroke: color-mix(in srgb, var(--error-color, #db4437) 60%, transparent);
      }
      .cameras polygon.off {
        fill: color-mix(in srgb, var(--secondary-text-color, #5f6368) 10%, transparent);
        stroke: color-mix(in srgb, var(--secondary-text-color, #5f6368) 40%, transparent);
        stroke-dasharray: 5 4;
      }
      .badges {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
      }
      .badge-group {
        position: absolute;
        transform: translate(-50%, calc(-100% - 6px));
        display: flex;
        gap: 2px;
        padding: 2px;
        border: none;
        border-radius: 14px;
        background: color-mix(in srgb, var(--card-background-color, #fff) 86%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        color: inherit;
        font: inherit;
        cursor: pointer;
        pointer-events: auto;
      }
      .badges.raised .badge-group {
        transform: translate(-50%, calc(-100% - 34px));
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-width: 22px;
        height: 22px;
        padding: 0 3px;
        box-sizing: border-box;
        border-radius: 11px;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--secondary-text-color, #5f6368);
      }
      .badge svg.icon {
        width: 16px;
        height: 16px;
      }
      .badge.ok {
        color: var(--success-color, #43a047);
      }
      .badge.warning {
        color: var(--warning-color, #ffa600);
      }
      .badge.danger {
        color: var(--error-color, #db4437);
      }
      .badge.running,
      .badge.recording {
        animation: badge-pulse 1.6s ease-in-out infinite;
      }
      @keyframes badge-pulse {
        50% {
          opacity: 0.45;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .badge.running,
        .badge.recording {
          animation: none;
        }
      }
      .alerts {
        position: absolute;
        top: 12px;
        left: 12px;
        max-width: calc(100% - 92px);
        display: grid;
        gap: 6px;
        justify-items: start;
      }
      .alerts button {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 100%;
        padding: 8px 14px 8px 10px;
        border: none;
        box-shadow:
          inset 0 0 0 2px var(--warning-color, #ffa600),
          0 8px 28px rgba(0, 0, 0, 0.1);
        color: inherit;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
      }
      .alerts button.danger {
        box-shadow:
          inset 0 0 0 2px var(--error-color, #db4437),
          0 8px 28px rgba(0, 0, 0, 0.1);
      }
      .alerts button svg.icon {
        flex: none;
        width: 20px;
        height: 20px;
        color: var(--warning-color, #ffa600);
      }
      .alerts button.danger svg.icon {
        color: var(--error-color, #db4437);
      }
      .alerts .more {
        padding: 0 4px;
        font-size: 0.75rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        pointer-events: none;
      }
      .message {
        pointer-events: auto;
        max-width: 340px;
        padding: 20px 24px;
        display: grid;
        justify-items: center;
        gap: 8px;
        text-align: center;
      }
      .message svg.icon {
        width: 36px;
        height: 36px;
        color: var(--primary-color, #03a9f4);
      }
      .message.error svg.icon {
        color: var(--error-color, #db4437);
      }
      .message h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      .message p {
        margin: 0;
        color: var(--secondary-text-color, #5f6368);
        line-height: 1.4;
      }
      .chip {
        position: absolute;
        left: 12px;
        bottom: 12px;
        max-width: calc(100% - 24px);
        padding: 8px 14px;
        font-size: 0.875rem;
        display: grid;
        gap: 2px;
      }
      button.chip {
        display: flex;
        align-items: center;
        gap: 6px;
        border: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.chip svg.icon {
        width: 18px;
        height: 18px;
      }
      .notice {
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        max-width: calc(100% - 120px);
        padding: 8px 14px;
        font-size: 0.875rem;
        border-color: var(--error-color, #db4437);
      }
      .guides {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }
      .guides line {
        stroke-linecap: round;
      }
      .guides .snap {
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 1.5;
        stroke-dasharray: 6 4;
      }
      .guides .distance {
        stroke: var(--primary-text-color, #1f2328);
        stroke-opacity: 0.55;
        stroke-width: 1;
      }
      .guides text {
        font-size: 12px;
        font-weight: 600;
        fill: var(--primary-text-color, #1f2328);
        stroke: var(--card-background-color, #fff);
        stroke-width: 3px;
        paint-order: stroke;
        text-anchor: middle;
        dominant-baseline: middle;
      }
      .plan-handles {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }
      .plan-handles .snap {
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 1.5;
        stroke-dasharray: 6 4;
      }
      .plan-handles .drawn {
        fill: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 2;
        stroke-dasharray: 8 4;
      }
      .plan-handles .corner {
        fill: var(--card-background-color, #fff);
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 2.5;
      }
      .plan-handles .corner.active {
        fill: var(--primary-color, #03a9f4);
      }
      .plan-handles .insert {
        pointer-events: auto;
        cursor: copy;
      }
      .plan-handles .insert circle {
        fill: var(--card-background-color, #fff);
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 1.5;
        opacity: 0.9;
      }
      .plan-handles .insert path {
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 2;
        stroke-linecap: round;
      }
      .plan-handles .insert:focus-visible circle {
        stroke-width: 3;
      }
      .plan-handles text {
        font-size: 12px;
        font-weight: 600;
        fill: var(--primary-text-color, #1f2328);
        stroke: var(--card-background-color, #fff);
        stroke-width: 3px;
        paint-order: stroke;
        text-anchor: middle;
        dominant-baseline: middle;
      }
      .spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-top-color: var(--primary-color, #03a9f4);
        animation: spin 900ms linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  private get translator(): Translator {
    return translatorFor(this.hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.motionQuery?.addEventListener("change", this.onMotion);
    if (this.hasUpdated) void this.startEngine();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motionQuery?.removeEventListener("change", this.onMotion);
    window.removeEventListener("keydown", this.onEditKey);
    window.removeEventListener("keydown", this.onPlanKey);
    window.clearTimeout(this.noticeTimer);
    // The engine goes; the plan drawn is kept, to go on with if the view comes back.
    if (this.planEditor) {
      this.parked = { planner: this.planEditor.release(), empty: this.planEditor.state.empty };
      this.planEditor = undefined;
    }
    this.planToken += 1;
    this.planOpening = false;
    this.stopEngine();
  }

  protected override firstUpdated(): void {
    void this.startEngine();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("options")) {
      // The layer and the sun start as the options say; the layer menu changes them after.
      const previous = changed.get("options");
      if (previous?.layer !== this.options.layer) this.layer = this.options.layer ?? "off";
      if (previous?.sun !== this.options.sun) this.realSun = this.options.sun === "real";
      if (previous?.badges !== this.options.badges) this.showBadges = this.options.badges !== false;
      if (previous?.cameras !== this.options.cameras) {
        this.showCameras = this.options.cameras !== false;
      }
    }
    if (this.layer === "off" && this.labels.length > 0) {
      this.labels = [];
      this.labelsText = "";
    }
    // The room chip leaves room for the legend (`renderLegend`).
    this.toggleAttribute("legend", this.layer !== "off" && !this.editingAny);
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("bindings")) this.applyBindings();
    if (changed.has("editing")) this.applyEditing();
    if (changed.has("plan") || changed.has("layout")) this.applyPlan();
    if (changed.has("planEditing")) this.applyPlanEditing();
    if (changed.has("planTool") && this.planEditor) {
      this.planEditor.tool = this.planTool;
      this.requestUpdate();
    }
    if (changed.has("options") && this.engine) {
      const previous = changed.get("options");
      this.engine.setQuality(this.options.quality);
      this.engine.setCutaway(this.options.cutaway ?? "auto");
      this.applyLighting();
      if (previous?.view !== this.options.view) this.setPlanView(this.options.view === "2d");
      this.redraw();
    }
    if (changed.has("hass")) {
      this.applyTheme();
      this.applyLighting();
      this.syncStates();
    }
    // `layer` and `realSun` are this view's own state.
    const own = changed as PropertyValues;
    if (
      changed.has("hass") ||
      changed.has("bindings") ||
      changed.has("options") ||
      changed.has("elsewhere") ||
      own.has("layer")
    ) {
      this.applyLayers();
    }
    if (changed.has("north") || own.has("realSun") || changed.has("hass")) this.applySun();
    if (changed.has("hass") || changed.has("bindings") || changed.has("plan")) {
      this.applyDevices();
    }
    if (changed.has("linking") || own.has("showBadges") || own.has("showCameras")) this.redraw();
  }

  /** Draws a new frame as soon as possible (when visible). */
  requestFrame(): void {
    this.redraw();
  }

  /**
   * Asks for a frame because something changed (camera, states, layers, size…): the values of
   * the layer are read again with it. The layers' own animation does not read them.
   */
  private redraw(): void {
    this.labelsDue = true;
    this.scheduler?.request();
  }

  /** State for tests and diagnostics. */
  debugState(): DebugState {
    const state: DebugState = {
      engine: this.engineState,
      frames: this.scheduler?.frames ?? 0,
      frameInterval: this.scheduler?.minInterval ?? 0,
      planView: this.planView,
      resolution: this.resolution,
    };
    if (this.lightKey) state.light = this.lightKey;
    if (this.sunKey) state.sun = this.sunKey;
    state.layer = this.layer;
    if (this.layersKey) state.layers = this.layersKey;
    state.alerts = this.alerts.map((alert) =>
      alert.storey ? `${alert.storey}:${alert.room}` : alert.room,
    );
    if (this.engine) {
      state.quality = this.engine.quality;
      state.stats = this.engine.stats;
    }
    if (this.summary) state.summary = this.summary;
    if (this.modelsLoading.size > 0) {
      state.models = {
        loadMs: [...this.modelTimes.loadMs],
        drawMs: [...this.modelTimes.drawMs],
        failed: this.modelsFailed.size,
      };
    }
    const sheet = this.sheet;
    if (sheet) {
      state.sheet =
        sheet.kind === "controls"
          ? `controls:${sheet.entities.join(",")}`
          : `room:${sheet.area ?? ""}`;
    }
    const edit = this.edit;
    if (edit) {
      state.edit = {
        selection: edit.selection.map((piece) => piece.id),
        conflicts: edit.conflicts,
        guides: edit.guides.length,
        dirty: edit.dirty,
      };
    }
    const plan = this.planEditor;
    if (plan) {
      state.planEdit = {
        tool: plan.tool,
        selection: plan.state.selection?.id ?? null,
        corners: plan.state.cornerCount,
        dirty: plan.state.dirty,
      };
    }
    return state;
  }

  /** Runs a command of the edit bar. */
  editCommand(command: EditCommand): void {
    const engine = this.engine;
    if (!engine || !this.edit) return;
    switch (command) {
      case "undo":
        this.setEdit(engine.editUndo());
        this.loadModels();
        break;
      case "redo":
        this.setEdit(engine.editRedo());
        this.loadModels();
        break;
      case "rotate-left":
        this.setEdit(engine.editRotate(-1));
        break;
      case "rotate-right":
        this.setEdit(engine.editRotate(1));
        break;
      case "remove":
        this.setEdit(engine.editRemove());
        break;
      case "clear":
        this.setEdit(engine.editSelect("", false));
        break;
    }
  }

  /** Adds a piece of the catalogue in the middle of the view and selects it. */
  editAdd(kind: string, name: string): void {
    const engine = this.engine;
    const canvas = this.canvas;
    if (!engine || !canvas || !this.edit) return;
    const state = engine.editAdd(kind, name, canvas.width / 2, canvas.height / 2);
    this.setEdit(state);
    if (state.refused) this.notify(this.translator.t("edit.too_many"));
  }

  /**
   * Adds a piece of a user model in the middle of the view and selects it. A model imported now
   * comes with its definition and the mesh of its file.
   */
  editAddModel(
    id: string,
    definition?: Record<string, unknown>,
    file?: { hash: string; mesh: Uint8Array },
  ): void {
    const engine = this.engine;
    const canvas = this.canvas;
    if (!engine || !canvas || !this.edit) return;
    if (file) engine.setModelMesh(file.hash, file.mesh);
    const state = engine.editAddModel(id, definition, canvas.width / 2, canvas.height / 2);
    this.setEdit(state);
    if (state.refused) this.notify(this.translator.t("edit.model_refused"));
    // A model of the plan that no piece showed: its file is fetched now.
    this.loadModels();
  }

  /** Forgets a model imported in edit mode that no piece shows. */
  editRemoveModel(id: string): void {
    if (this.engine && this.edit) this.setEdit(this.engine.editRemoveModel(id));
  }

  /** The user models of the plan shown (« My models »). */
  editModels(): UserModel[] {
    return this.engine?.editModels() ?? [];
  }

  /** Puts a draft overlay in place, as one change that can be undone. */
  editRestore(layout: Record<string, unknown>): void {
    if (this.engine && this.edit) this.setEdit(this.engine.editRestore(layout));
    this.loadModels();
  }

  /** The edit overlay now (what Save stores). */
  editLayout(): Record<string, unknown> | undefined {
    return this.edit ? this.engine?.editLayout() : undefined;
  }

  /** The overlay `layout` (what was sent) was stored. */
  editSaved(layout: Record<string, unknown>): void {
    if (!this.engine || !this.edit) return;
    this.engine.editSaved(layout);
    this.setEdit(this.engine.editState);
  }

  /**
   * Leaves edit mode, keeping the changes shown (`keep`) or going back to what was saved, then
   * shows the plan changes that came while editing.
   */
  endEdit(keep: boolean): void {
    if (!this.edit) return;
    this.engine?.endEdit(keep);
    this.edit = undefined;
    window.removeEventListener("keydown", this.onEditKey);
    window.clearTimeout(this.holdTimer);
    this.dragPointer = undefined;
    this.dragTo = undefined;
    this.dragHeld = false;
    this.applyPlan();
    this.redraw();
  }

  /** Runs a command of the plan bar. */
  planCommand(command: PlanCommand): void {
    this.planEditor?.command(command);
  }

  /** Changes fields of the element selected in the plan editor. */
  planUpdate(fields: Record<string, unknown>): void {
    this.planEditor?.update(fields);
  }

  /** The plan drawn (what Save stores, with an empty overlay). */
  planDraft(): Record<string, unknown> | undefined {
    return this.planEditor?.plan;
  }

  /** The plan drawn was stored as it is. */
  planSaved(): void {
    this.planEditor?.saved();
  }

  /** Puts a plan kept by the browser in place, as one change that can be undone. */
  planRestore(plan: Record<string, unknown>): void {
    this.planEditor?.restore(plan);
  }

  /**
   * Leaves the plan editor. With `keep` (once saved) the plan drawn stays shown until the plan
   * stored comes back; else the plan stored is shown again (nothing, for a new plan).
   */
  endPlanEdit(keep: boolean): void {
    // Asked by the panel, which leaves the plan editor: not opened again meanwhile.
    this.planEditing = false;
    const editor = this.planEditor;
    if (!editor) return;
    this.planEditor = undefined;
    editor.dispose();
    window.removeEventListener("keydown", this.onPlanKey);
    this.setPlanView(this.planViewBefore);
    if (!keep) {
      if (this.plan) this.applyPlan(true);
      else this.engine?.clearPlan();
    }
    this.applyPlan();
    this.redraw();
  }

  /** Shows the 2D plan or the 3D view. */
  setPlanView(plan: boolean): void {
    this.viewsOpen = false;
    if (!this.engine || this.engine.planView === plan) {
      this.planView = plan;
      return;
    }
    this.engine.setPlanView(plan);
    this.planView = plan;
    this.redraw();
  }

  /** Back to the whole home. */
  overview(): void {
    this.viewsOpen = false;
    this.focusedRoom = undefined;
    this.engine?.overview();
    this.redraw();
  }

  /** Shows a layer (the layer menu). */
  setLayer(layer: LayerName): void {
    this.layersOpen = false;
    this.layer = layer;
    this.redraw();
  }

  /** Lights the rooms from where the sun really is (through the windows), or not. */
  setRealSun(real: boolean): void {
    this.layersOpen = false;
    this.realSun = real;
  }

  /** Frames an element of the plan; false when it has nothing to show. */
  showElement(id: string): boolean {
    const done = this.engine?.focusElement(id) ?? false;
    this.redraw();
    return done;
  }

  /** What a tap at a point of the view does (CSS pixels from its top left). */
  tap(x: number, y: number): void {
    this.sheet = undefined;
    const engine = this.engine;
    if (!engine) return;
    if (this.planEditor) {
      this.gestures.forgetTap();
      this.planEditor.tap(x, y);
      return;
    }
    if (this.edit) {
      // Edit mode: a tap selects a piece (anything else clears the selection).
      const picked = this.elementAt(x, y);
      const id = picked?.type === "furniture" ? picked.id : "";
      this.gestures.forgetTap();
      this.setEdit(engine.editSelect(id, this.multiSelect || this.addModifier));
      return;
    }
    const picked = this.elementAt(x, y);
    if (!picked) return;
    if (this.linking) {
      this.pick(picked);
      return;
    }
    const binding = this.bindings?.elements[picked.id];
    if (binding && this.hass) {
      engine.highlight(picked.id);
      // An action ran: a second tap soon after is a new tap, not a double tap.
      this.gestures.forgetTap();
      void this.act(tapAction(binding, this.hass), binding, picked);
    } else if (this.kinds[picked.id] === "stairs" && this.nextStorey()) {
      // Stairs lead to the storey above (from the top one, to the one below).
      this.gestures.forgetTap();
      this.chooseStorey(this.nextStorey() ?? "");
    } else if (picked.room && engine.focusElement(picked.room)) {
      this.focusedRoom = { id: picked.room, name: this.roomName(picked) };
    }
    this.redraw();
  }

  /** The storey stairs lead to: the one above the storey shown, else the one below. */
  private nextStorey(): string | undefined {
    const levels = storeyLevels(this.storeys);
    const i = levels.findIndex(({ storey }) => storey.id === this.storey);
    if (i < 0) return undefined;
    return (levels[i + 1] ?? levels[i - 1])?.storey.id;
  }

  /** What a long press at a point of the view does (CSS pixels from its top left). */
  hold(x: number, y: number): void {
    if (this.planEditor) return;
    const picked = this.elementAt(x, y);
    if (this.edit) {
      // Edit mode: a long press adds a piece to the selection (or takes it out).
      if (picked?.type === "furniture" && this.engine) {
        this.setEdit(this.engine.editSelect(picked.id, true));
      }
      return;
    }
    if (!picked) return;
    if (this.linking) {
      this.pick(picked);
      return;
    }
    const binding = this.bindings?.elements[picked.id];
    if (binding && this.hass) {
      this.engine?.highlight(picked.id);
      void this.act(holdAction(binding), binding, picked);
    } else if (picked.room) {
      void this.openRoom(picked.room, this.roomName(picked));
    }
    this.redraw();
  }

  /** The element at a point of the view (CSS pixels from its top left). */
  elementAt(x: number, y: number): PickedElement | undefined {
    if (!this.engine || !this.canvas) return undefined;
    const scale = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    return this.engine.pick(x * scale, y * scale);
  }

  /** Edit mode or the plan editor is on: the live overlays (badges, cones, values) step aside. */
  private get editingAny(): boolean {
    return this.edit !== undefined || this.planEditor !== undefined;
  }

  /** Device pixels of the drawing buffer for a point of the view in CSS pixels. */
  private devicePoint(x: number, y: number): { x: number; y: number } {
    const scale = this.canvas ? this.canvas.width / Math.max(1, this.canvas.clientWidth) : 1;
    return { x: x * scale, y: y * scale };
  }

  /** Where an element's centre is drawn (CSS pixels from the top left of the view), if anywhere. */
  elementPoint(id: string): { x: number; y: number } | undefined {
    if (!this.engine || !this.canvas) return undefined;
    const point = this.engine.screenPoint(id);
    if (!point) return undefined;
    const scale = Math.max(1, this.canvas.clientWidth) / this.canvas.width;
    return { x: point[0] * scale, y: point[1] * scale };
  }

  /**
   * Draws a frame and returns the canvas pixels as a PNG data URL, read in the same task so the
   * drawing buffer is still intact (visual regression tests: pixels only, no overlays or fonts).
   */
  captureFrame(): string {
    if (!this.engine || !this.canvas) throw new Error("engine not ready");
    this.settle();
    this.engine.invalidate();
    this.engine.frame(performance.now());
    return this.canvas.toDataURL("image/png");
  }

  /** Runs camera moves, wall animations and fades to their end at once (tests). */
  settle(): void {
    const engine = this.engine;
    if (!engine) return;
    let time = performance.now();
    // The layers' animation never ends: it does not count.
    for (let i = 0; i < 300 && engine.frame(time) && engine.moving; i += 1) time += 100;
  }

  /** Forces `frames` consecutive frames and measures them (frame-time smoke test). */
  async benchmark(frames = 120): Promise<FrameStats> {
    const engine = this.engine;
    if (!engine) throw new Error("engine not ready");
    const cpu: number[] = [];
    const intervals: number[] = [];
    let last: number | undefined;
    for (let i = 0; i < frames; i += 1) {
      const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      if (last !== undefined) intervals.push(time - last);
      last = time;
      engine.invalidate();
      const start = performance.now();
      engine.frame(time);
      cpu.push(performance.now() - start);
    }
    return {
      frames,
      wasmMemoryBytes: wasmMemoryBytes() ?? 0,
      cpuMedianMs: percentile(cpu, 50),
      cpuP95Ms: percentile(cpu, 95),
      intervalMedianMs: percentile(intervals, 50),
      intervalP95Ms: percentile(intervals, 95),
    };
  }

  private async startEngine(): Promise<void> {
    if (this.canvas) return;
    const stage = this.renderRoot.querySelector<HTMLElement>(".stage");
    if (!stage) return;
    this.stage = stage;
    const generation = ++this.generation;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    stage.append(canvas);
    this.canvas = canvas;
    this.engineState = "loading";
    this.resize(stage);

    let engine: DomoTwinEngine;
    try {
      engine = await DomoTwinEngine.create(canvas);
    } catch (error) {
      if (generation !== this.generation) return;
      this.engineState =
        error instanceof EngineError && error.code === "webgl2_unavailable"
          ? "unsupported"
          : "failed";
      return;
    }
    if (generation !== this.generation) {
      engine.dispose();
      return;
    }
    this.engine = engine;
    engine.setQuality(this.options.quality);
    engine.setCutaway(this.options.cutaway ?? "auto");
    engine.setMotion(!this.motionQuery?.matches);
    this.lightKey = undefined;
    this.sunKey = undefined;
    this.layersKey = undefined;
    this.labelsText = "";
    this.scheduler = new FrameScheduler((time) => this.drawFrame(engine, time));
    this.scheduler.setPageVisible(document.visibilityState === "visible");
    this.resizeObserver = new ResizeObserver(() => {
      this.resize(stage);
    });
    this.resizeObserver.observe(stage);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) this.scheduler?.setOnScreen(entry.isIntersecting);
    });
    this.intersectionObserver.observe(this);
    this.engineState = "ready";
    this.background = undefined;
    this.applyTheme();
    this.applyLighting();
    this.lightTimer = window.setInterval(() => {
      this.applyLighting();
    }, LIGHT_REFRESH_MS);
    this.states.reset();
    this.modelsLoading.clear();
    this.modelsFailed.clear();
    this.applyBindings();
    this.loadedPlan = undefined;
    this.loadedLayout = undefined;
    this.edit = undefined;
    this.planEditor?.dispose();
    this.planEditor = undefined;
    this.applyPlan();
    this.applyEditing();
    this.applyPlanEditing();
    this.applySun();
    this.resize(stage);
    this.scheduler.request();
  }

  private stopEngine(): void {
    this.generation += 1;
    this.scheduler?.dispose();
    window.clearInterval(this.lightTimer);
    window.clearTimeout(this.holdTimer);
    this.lightTimer = undefined;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.engine?.dispose();
    // Give the GPU memory back now rather than at garbage collection.
    this.canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas?.remove();
    this.scheduler = undefined;
    this.resizeObserver = undefined;
    this.intersectionObserver = undefined;
    this.engine = undefined;
    this.canvas = undefined;
    this.engineState = "idle";
  }

  /** Draws a frame and adapts the resolution to how long frames take. */
  private drawFrame(engine: DomoTwinEngine, time: number): boolean {
    this.flushDrag();
    this.planEditor?.flush();
    if (this.modelsCame) {
      // Every mesh that came since the last frame, in one rebuild.
      this.modelsCame = false;
      const started = performance.now();
      if (engine.showModels()) this.modelTimes.drawMs.push(performance.now() - started);
      const over = engine.modelsOverBudget;
      if (over > 0) this.notify(this.translator.tp("view.models_over_budget", over));
    }
    const movingBefore = engine.moving;
    const start = performance.now();
    const more = engine.frame(time);
    const cost = performance.now() - start;
    const movingAfter = engine.moving;
    // The values, badges and cameras' views move with the camera, or change: not with the
    // layers' own animation.
    if (this.labelsDue || movingBefore || movingAfter) {
      this.labelsDue = false;
      this.readOverlays(engine);
    }
    // The layers' animation alone runs at 24 frames per second; camera moves, wall animations
    // and fades at the display's rate (a gesture sets it back at once, see `apply`).
    this.scheduler?.setMinInterval(
      more && engine.layersAnimating && !engine.moving ? LAYER_FRAME_MS : 0,
    );
    this.frameCost = this.frameCost === 0 ? cost : this.frameCost * 0.8 + cost * 0.2;
    // Only animations tell: a single frame after an idle period is not representative.
    if (more && time - this.lastResolutionChange > 600 && this.stage) {
      const slow = this.frameCost > SLOW_FRAME_MS && this.resolution > MIN_RESOLUTION;
      const fast = this.frameCost < FAST_FRAME_MS && this.resolution < 1;
      if (slow || fast) {
        this.resolution = slow
          ? Math.max(MIN_RESOLUTION, this.resolution * 0.85)
          : Math.min(1, this.resolution / 0.85);
        this.lastResolutionChange = time;
        this.resize(this.stage);
      }
    }
    return more;
  }

  private resize(stage: HTMLElement): void {
    if (!this.canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.resolution;
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.engine) {
      this.engine.resize(width, height);
      this.redraw();
    }
  }

  private applyTheme(): void {
    if (!this.engine) return;
    const background = themeBackground(this, FALLBACK_BACKGROUND);
    const previous = this.background;
    if (
      previous?.r === background.r &&
      previous.g === background.g &&
      previous.b === background.b
    ) {
      return;
    }
    this.background = background;
    this.engine.setBackground(background);
    this.redraw();
  }

  /**
   * Sets the light: a fixed mood, or the time of day from Home Assistant's sun (`sun.sun`), or
   * from the local clock when there is no sun entity. Small changes are skipped.
   */
  private applyLighting(): void {
    const engine = this.engine;
    if (!engine) return;
    const mode = this.options.lighting ?? "auto";
    let key: string;
    let apply: () => void;
    if (mode !== "auto") {
      key = `mood:${mode}`;
      apply = () => {
        engine.setLightingMood(mode);
      };
    } else {
      const sun = this.hass?.states["sun.sun"];
      const elevation = Number(sun?.attributes.elevation);
      if (sun && Number.isFinite(elevation)) {
        const rounded = Math.round(elevation * 2) / 2;
        const rising = sun.attributes.rising === true;
        key = `sun:${rounded}:${rising}`;
        apply = () => {
          engine.setSun(rounded, rising);
        };
      } else {
        const now = new Date();
        const hour = Math.round((now.getHours() + now.getMinutes() / 60) * 12) / 12;
        key = `clock:${hour}`;
        apply = () => {
          engine.setLocalHour(hour);
        };
      }
    }
    if (key === this.lightKey) return;
    this.lightKey = key;
    apply();
    this.redraw();
  }

  /**
   * Sets where the sun lights from: where it is (`sun.sun`'s azimuth and elevation, with the
   * home's north) when sunlight through the windows is on, else the default sun.
   */
  private applySun(): void {
    const engine = this.engine;
    if (!engine) return;
    const sun = this.hass?.states["sun.sun"];
    const azimuth = Number(sun?.attributes.azimuth);
    const elevation = Number(sun?.attributes.elevation);
    const real = this.realSun && Number.isFinite(azimuth) && Number.isFinite(elevation);
    // Half a degree: the shadows are drawn again only when the sun has visibly moved.
    const a = Math.round(azimuth * 2) / 2;
    const e = Math.round(elevation * 2) / 2;
    const north = Number.isFinite(this.north) ? this.north : 0;
    const key = real ? `${a}:${e}:${north}` : "default";
    if (key === this.sunKey) return;
    this.sunKey = key;
    if (real) engine.setSunPosition(a, e, north);
    else engine.useDefaultSun();
    this.redraw();
  }

  /** Temperatures are shown in °F when Home Assistant uses them (the scales stay in °C). */
  private get fahrenheit(): boolean {
    return this.hass?.config?.unit_system?.temperature === "°F";
  }

  /** Sends the engine what the layers show now (only when it changed) and lists the alerts. */
  private applyLayers(): void {
    const engine = this.engine;
    if (!engine || !this.summary) return;
    const hass = this.hass;
    const layers = hass
      ? roomLayers(hass, this.bindings ?? NO_BINDINGS, this.rooms, {
          layer: this.layer,
          alerts: this.options.alerts !== false,
          presence: this.options.presence !== false,
        })
      : undefined;
    const json = layers?.json ?? "{}";
    if (json !== this.layersKey) {
      this.layersKey = json;
      engine.setLayers(json);
      this.redraw();
    }
    engine.setPowerLayer(this.layer === "power");
    const values = Object.keys(layers?.values ?? {}).length;
    const here = layers?.alerts ?? [];
    const alerts =
      hass && this.options.alerts !== false && this.elsewhere.length > 0
        ? withAlertsElsewhere(hass, this.bindings ?? NO_BINDINGS, here, this.elsewhere, this.storey)
        : here;
    if (values !== this.heatValues) {
      this.heatValues = values;
      this.requestUpdate();
    }
    if (JSON.stringify(alerts) !== JSON.stringify(this.alerts)) this.alerts = alerts;
  }

  /**
   * Reads the kind and name of the elements of the plan shown (the edit overlay applied), then
   * works out the badges again.
   */
  private readElements(engine: DomoTwinEngine): void {
    this.kinds = {};
    this.names = {};
    for (const element of engine.elementList()) {
      if (element.kind) this.kinds[element.id] = element.kind;
      this.names[element.id] = { name: element.name || element.id, type: element.type };
    }
    this.applyDevices();
  }

  /** Works out the devices' badges; the view changes only when they did. */
  private applyDevices(): void {
    const hass = this.hass;
    const badges =
      hass && this.bindings
        ? deviceBadges(hass, this.bindings, this.kinds)
        : new Map<string, Badge[]>();
    const key = JSON.stringify([...badges]);
    if (key === this.badgesKey) return;
    this.badgesKey = key;
    this.badges = badges;
    this.redraw();
  }

  /** Reads where the layer's values, the badges and what the cameras see go now. */
  private readOverlays(engine: DomoTwinEngine): void {
    this.planEditor?.reproject();
    if (this.layer !== "off") this.readLabels(engine);
    const shown = !this.editingAny && !this.linking;
    const ids = shown && this.showBadges ? [...this.badges.keys()] : [];
    const points = ids.length > 0 ? engine.elementPoints(JSON.stringify(ids)) : "{}";
    if (points !== this.pointsText) {
      this.pointsText = points;
      this.badgePoints = JSON.parse(points) as Record<string, [number, number]>;
    }
    const cameras = shown && this.showCameras ? engine.cameraViews() : "[]";
    if (cameras !== this.camerasText) {
      this.camerasText = cameras;
      this.cameraShapes = JSON.parse(cameras) as CameraShape[];
    }
  }

  /** A tap on an element's badges: the element's tap. */
  private tapElement(id: string): void {
    this.sheet = undefined;
    const binding = this.bindings?.elements[id];
    const hass = this.hass;
    if (!binding || !hass) return;
    this.engine?.highlight(id);
    // An action ran: a second tap soon after is a new tap, not a double tap.
    this.gestures.forgetTap();
    const info = this.names[id];
    const picked: PickedElement = {
      id,
      type: (info?.type ?? "furniture") as PickedElement["type"],
      name: info?.name ?? id,
      room: "",
    };
    void this.act(tapAction(binding, hass), binding, picked);
    this.redraw();
  }

  /** Reads where the layer's values go; the labels change only when they moved. */
  private readLabels(engine: DomoTwinEngine): void {
    const text = this.editingAny ? "[]" : engine.layerLabels();
    if (text === this.labelsText) return;
    this.labelsText = text;
    this.labels = JSON.parse(text) as LayerLabel[];
  }

  /** Starts or ends the engine's edit session to follow `editing`. */
  private applyEditing(): void {
    const engine = this.engine;
    if (!engine) return;
    if (this.editing && !this.edit && this.summary) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
      this.viewsOpen = false;
      this.setEdit(engine.beginEdit());
      engine.editReserve(this.planReserved);
    } else if (!this.editing && this.edit) {
      this.endEdit(true);
    }
  }

  /**
   * Ids a new element of the plan editor never takes: those with links, and those of the other
   * storeys' elements.
   */
  private takenIds(): string[] {
    const bindings = this.bindings ?? NO_BINDINGS;
    return [
      ...Object.keys(bindings.elements),
      ...Object.keys(bindings.rooms),
      ...this.planReserved,
    ];
  }

  /**
   * Starts or ends the plan editor to follow `planEditing`, once the stored plan is known: on the
   * draft kept while the view was away from the page, else on the plan shown (its overlay in it),
   * or on a new plan when none is stored or it cannot be read. The plan editor's module is loaded
   * now.
   */
  private applyPlanEditing(): void {
    const engine = this.engine;
    if (!this.planEditing) {
      if (this.planEditor) this.endPlanEdit(false);
      this.parked?.planner.dispose();
      this.parked = undefined;
      return;
    }
    if (!engine || this.planEditor || this.planOpening || this.edit || this.plan === undefined) {
      return;
    }
    const t = this.translator;
    const token = ++this.planToken;
    const parked = this.parked;
    this.parked = undefined;
    const shown =
      parked || this.planBlank || !this.plan || this.loadError ? "" : engine.shownPlan();
    const plan = shown ? (JSON.parse(shown) as Record<string, unknown>) : null;
    const empty = parked ? parked.empty : plan === null;
    this.planOpening = true;
    Promise.all([import("../planner/planner"), import("./plan-editor")])
      .then(async ([{ Planner }, { PlanEditor }]) => ({
        PlanEditor,
        planner:
          parked?.planner ??
          (await Planner.open(plan, t.t("plan.new_title"), t.t("plan.new_room"), this.takenIds())),
      }))
      .then(
        ({ PlanEditor, planner }) => {
          // A later open, or the view left the page meanwhile: this one is not wanted any more.
          if (token !== this.planToken) {
            planner.dispose();
            return;
          }
          this.planOpening = false;
          if (!this.planEditing || this.engine !== engine || this.edit) {
            planner.dispose();
            return;
          }
          // Ids with links stay theirs: a new element never takes over another's links.
          planner.reserve(this.takenIds());
          this.sheet = undefined;
          this.focusedRoom = undefined;
          this.viewsOpen = false;
          this.layersOpen = false;
          const editor = new PlanEditor(
            engine,
            planner,
            {
              devicePoint: (x, y) => this.devicePoint(x, y),
              planChanged: (state) => {
                if (state) this.setPlanState(state);
                else this.requestUpdate();
              },
              redraw: () => {
                this.redraw();
              },
            },
            t,
            empty,
          );
          editor.tool = this.planTool;
          this.planEditor = editor;
          // The draft first: a new scene stops the camera's moves, the one to 2D included.
          editor.show();
          this.planViewBefore = this.planView;
          this.setPlanView(true);
          window.addEventListener("keydown", this.onPlanKey);
          this.setPlanState(editor.state);
        },
        (error: unknown) => {
          if (token !== this.planToken) return;
          this.planOpening = false;
          this.notify(
            t.t("plan.open_failed", {
              reason: t.error(error instanceof EngineError ? error.code : "unknown"),
            }),
          );
        },
      );
  }

  private setPlanState(state: PlanEditState): void {
    fire(this, "domotwin-plan-edit", state);
    this.requestUpdate();
    this.redraw();
  }

  /** The plan editor's keys work anywhere on the page, except while typing or under a dialog. */
  private readonly onPlanKey = (event: KeyboardEvent): void => {
    if (!this.planEditor || !this.editKeys || event.defaultPrevented) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }
    const command = planCommandFor(event);
    if (!command) return;
    event.preventDefault();
    this.planEditor.command(command);
  };

  private setEdit(state: EditState): void {
    const was = this.edit !== undefined;
    this.edit = state.editing ? state : undefined;
    if (!was && this.edit) window.addEventListener("keydown", this.onEditKey);
    if (was && !this.edit) window.removeEventListener("keydown", this.onEditKey);
    fire(this, "domotwin-edit", state);
    this.redraw();
  }

  /** Moves the dragged pieces to the last pointer position, once per frame. */
  private flushDrag(): void {
    const to = this.dragTo;
    if (!to || !this.engine || this.dragPointer === undefined) return;
    this.dragTo = undefined;
    const point = this.devicePoint(to.x, to.y);
    this.setEdit(this.engine.editDragMove(point.x, point.y));
  }

  private endDrag(): void {
    if (this.dragPointer === undefined || !this.engine) return;
    this.flushDrag();
    this.dragPointer = undefined;
    this.dragFrom = undefined;
    this.dragging = false;
    this.dragHeld = false;
    this.setEdit(this.engine.editDragEnd());
  }

  /** Shows the plan stored when it changed (`force`: even if not, e.g. after a draft). */
  private applyPlan(force = false): void {
    // Not while editing: the session works on the plan shown; changes wait for its end.
    if (
      !this.engine ||
      this.edit ||
      this.planEditor ||
      (!force && this.plan === this.loadedPlan && this.layout === this.loadedLayout)
    ) {
      return;
    }
    const sameHome = this.loadedPlan !== undefined && this.loadedPlan !== null;
    this.loadedPlan = this.plan;
    this.loadedLayout = this.layout;
    if (!sameHome) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
    }
    this.summary = undefined;
    this.loadError = undefined;
    this.savedViews = [];
    this.rooms = planRooms(this.plan);
    if (!this.plan) return;
    try {
      this.summary = this.engine.loadPlan(
        JSON.stringify(this.plan),
        sameHome,
        this.layout ? JSON.stringify(this.layout) : undefined,
      );
      const refused = this.summary.layoutRefused ?? 0;
      if (refused > 0) this.notify(this.translator.tp("view.layout_refused", refused));
      this.loadModels();
      this.savedViews = this.engine.views();
      this.layersKey = undefined;
      this.applyLayers();
      this.readElements(this.engine);
      if (!sameHome) {
        if (this.options.view === "2d") this.setPlanView(true);
        if (this.options.room) this.engine.focusElement(this.options.room);
      }
      const focus = this.focusAfterLoad;
      this.focusAfterLoad = undefined;
      if (focus && this.engine.focusElement(focus.id)) this.focusedRoom = focus;
    } catch (error) {
      this.loadError = error instanceof EngineError ? error : engineError(error);
    }
    this.applyPlanEditing();
    this.redraw();
  }

  /**
   * Fetches and reads the 3D files the pieces shown are drawn from (they are boxes until then),
   * with the model module, loaded only now.
   */
  private loadModels(): void {
    const engine = this.engine;
    const hass = this.hass;
    if (!engine || !hass) return;
    const files = engine.modelFiles().filter((file) => !this.modelsLoading.has(file.hash));
    if (files.length === 0) return;
    for (const file of files) this.modelsLoading.add(file.hash);
    const asked = performance.now();
    const failed = (hash: string): void => {
      if (this.engine !== engine) return;
      // Asked again with the next plan shown.
      this.modelsLoading.delete(hash);
      this.modelsFailed.add(hash);
      this.notify(this.translator.tp("view.models_failed", this.modelsFailed.size));
    };
    import("../models/models").then(
      ({ modelMesh }) => {
        for (const file of files) {
          modelMesh(hass, file.hash, file.format).then(
            (mesh) => {
              if (this.engine !== engine) return;
              const read = performance.now();
              engine.setModelMesh(file.hash, mesh);
              this.modelsFailed.delete(file.hash);
              this.modelTimes.loadMs.push(read - asked);
              this.modelsCame = true;
              this.redraw();
            },
            () => {
              failed(file.hash);
            },
          );
        }
      },
      () => {
        for (const file of files) failed(file.hash);
      },
    );
  }

  private pick(picked: PickedElement): void {
    this.engine?.highlight(picked.id);
    this.gestures.forgetTap();
    fire(this, "domotwin-pick", picked);
    this.redraw();
  }

  /** Sends the bindings to the engine, then the states of the entities now bound. */
  private applyBindings(): void {
    const engine = this.engine;
    if (!engine) return;
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    engine.setBindings(JSON.stringify(bindings));
    // Links added meanwhile: their ids are not given to new elements either.
    this.planEditor?.reserve(this.takenIds());
    this.bound = boundEntityIds(bindings);
    this.syncStates();
    this.redraw();
  }

  /** Sends the engine the bound entities whose state changed. */
  private syncStates(): void {
    const engine = this.engine;
    if (!engine || !this.hass) return;
    const changes = this.states.changes(this.hass, this.bound);
    if (changes === undefined) return;
    engine.setStates(changes);
    this.redraw();
  }

  private roomName(picked: PickedElement): string {
    if (picked.type === "room" && picked.name) return picked.name;
    return this.focusedRoom?.id === picked.room ? this.focusedRoom.name : picked.room;
  }

  /** Runs an action of a binding; `controls` opens the element's panel. */
  private async act(action: Action, binding: ElementBinding, picked: PickedElement): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      if ((await runAction(this, hass, action, binding)) === "controls") {
        await this.openControls(binding, picked);
      }
    } catch (error) {
      const t = this.translator;
      const reason = isHassError(error)
        ? error.message || t.error(error.code)
        : t.error(error instanceof Error ? error.name : "unknown");
      this.notify(t.t("view.action_failed", { reason }));
    }
  }

  private loadSheets(): Promise<unknown> {
    this.sheets ??= import("./sheets");
    this.sheets.catch(() => (this.sheets = undefined));
    return this.sheets;
  }

  private async openControls(binding: ElementBinding, picked: PickedElement): Promise<void> {
    await this.loadSheets();
    const hass = this.hass;
    const primary = primaryEntity(binding, hass);
    const heading = picked.name || (hass && primary ? entityName(hass, primary) : picked.id);
    this.sheet = {
      kind: "controls",
      heading,
      entities: binding.entities.map((entity) => entity.entity_id),
    };
  }

  private async openRoom(id: string, name: string): Promise<void> {
    await this.loadSheets();
    const hass = this.hass;
    const sheet: Sheet = { kind: "room", heading: name };
    const area = hass
      ? roomArea(hass, this.bindings ?? { version: 1, rooms: {}, elements: {} }, id, name)
      : undefined;
    if (area) sheet.area = area;
    this.sheet = sheet;
  }

  private readonly closeSheet = (): void => {
    this.sheet = undefined;
  };

  private notify(text: string): void {
    this.notice = text;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice = undefined), NOTICE_MS);
  }

  private sample(event: PointerEvent): PointerSample {
    return {
      pointerId: event.pointerId,
      x: event.offsetX,
      y: event.offsetY,
      button: event.button,
      shiftKey: event.shiftKey,
      time: event.timeStamp,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.engine) return;
    this.viewsOpen = false;
    this.layersOpen = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.addModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    // The plan editor: a press grabs a corner or the selection, or starts drawing.
    if (this.planEditor && this.gestures.active === 0 && this.planEditor.down(event)) return;
    if (
      this.edit &&
      this.dragPointer === undefined &&
      this.gestures.active === 0 &&
      event.button === 0 &&
      !event.shiftKey
    ) {
      // Edit mode: pressing a selected piece grabs it.
      const point = this.devicePoint(event.offsetX, event.offsetY);
      if (this.engine.editDragStart(point.x, point.y)) {
        const from = { x: event.offsetX, y: event.offsetY };
        this.dragPointer = event.pointerId;
        this.dragFrom = from;
        this.dragging = false;
        this.dragHeld = false;
        // Held still: a long press (adds to the selection or takes out), not a drag.
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          if (this.dragPointer !== event.pointerId || this.dragging) return;
          this.dragHeld = true;
          this.hold(from.x, from.y);
        }, HOLD_TIME + 20);
        return;
      }
    }
    this.apply(this.gestures.down(this.sample(event)));
    window.clearTimeout(this.holdTimer);
    if (this.gestures.active === 1) {
      this.holdTimer = window.setTimeout(() => {
        this.apply(this.gestures.hold(performance.now()));
      }, HOLD_TIME + 20);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.planEditor?.move(event)) return;
    if (event.pointerId === this.dragPointer) {
      const from = this.dragFrom;
      this.dragging ||=
        !from || Math.hypot(event.offsetX - from.x, event.offsetY - from.y) >= TAP_SLOP;
      if (this.dragging) {
        this.dragTo = { x: event.offsetX, y: event.offsetY };
        this.redraw();
      }
      return;
    }
    if (this.gestures.active === 0) return;
    this.apply(this.gestures.move(this.sample(event)));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    window.clearTimeout(this.holdTimer);
    if (this.planEditor?.up(event)) return;
    if (event.pointerId === this.dragPointer) {
      const moved = this.dragging;
      const held = this.dragHeld;
      if (moved) this.dragTo = { x: event.offsetX, y: event.offsetY };
      this.endDrag();
      // Pressed without moving: a tap (selects this piece alone, or toggles it).
      if (!moved && !held) this.tap(event.offsetX, event.offsetY);
      return;
    }
    this.apply(this.gestures.up(this.sample(event)));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    window.clearTimeout(this.holdTimer);
    if (this.planEditor?.cancel(event)) return;
    if (event.pointerId === this.dragPointer) {
      this.endDrag();
      return;
    }
    this.gestures.cancel(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.engine) return;
    event.preventDefault();
    this.apply([
      {
        kind: "zoom",
        factor: wheelFactor(event.deltaY, event.deltaMode),
        x: event.offsetX,
        y: event.offsetY,
      },
    ]);
  };

  /**
   * Edit mode's keys work anywhere on the page, except while typing or while the panel shows a
   * dialog over the view (`editKeys` off).
   */
  private readonly onEditKey = (event: KeyboardEvent): void => {
    if (!this.edit || !this.editKeys || event.defaultPrevented) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }
    const command = editCommandFor(event);
    if (!command) return;
    event.preventDefault();
    this.editCommand(command);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Edit mode's and the plan editor's keys are handled on the window (onEditKey, onPlanKey).
    if (this.edit && editCommandFor(event)) return;
    if (this.planEditor && planCommandFor(event)) return;
    const keys: Record<string, Gesture | undefined> = {
      ArrowLeft: { kind: event.shiftKey ? "pan" : "drag", dx: -KEY_STEP, dy: 0 },
      ArrowRight: { kind: event.shiftKey ? "pan" : "drag", dx: KEY_STEP, dy: 0 },
      ArrowUp: { kind: event.shiftKey ? "pan" : "drag", dx: 0, dy: -KEY_STEP },
      ArrowDown: { kind: event.shiftKey ? "pan" : "drag", dx: 0, dy: KEY_STEP },
    };
    const stage = this.stage;
    const centre = { x: (stage?.clientWidth ?? 0) / 2, y: (stage?.clientHeight ?? 0) / 2 };
    let gesture = keys[event.key];
    if (event.key === "+" || event.key === "=")
      gesture = { kind: "zoom", factor: KEY_ZOOM, ...centre };
    if (event.key === "-") gesture = { kind: "zoom", factor: 1 / KEY_ZOOM, ...centre };
    if (event.key === "Home") {
      event.preventDefault();
      this.overview();
      return;
    }
    if (event.key === "Enter" && this.focusedRoom) {
      event.preventDefault();
      void this.openRoom(this.focusedRoom.id, this.focusedRoom.name);
      return;
    }
    if (!gesture) return;
    event.preventDefault();
    this.apply([gesture]);
  };

  /** Applies gestures to the camera. */
  private apply(gestures: Gesture[]): void {
    const engine = this.engine;
    const stage = this.stage;
    if (!engine || !stage || gestures.length === 0) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    // Gestures draw at the display's rate, even while the layers run slower.
    this.scheduler?.setMinInterval(0);
    for (const gesture of gestures) {
      switch (gesture.kind) {
        case "drag":
          if (this.planView) engine.pan(gesture.dx, gesture.dy, height);
          else engine.orbit(gesture.dx, gesture.dy);
          break;
        case "pan":
          engine.pan(gesture.dx, gesture.dy, height);
          break;
        case "zoom":
          engine.zoom(gesture.factor, (gesture.x / width) * 2 - 1, 1 - (gesture.y / height) * 2);
          break;
        case "tap":
          this.tap(gesture.x, gesture.y);
          break;
        case "hold":
          this.hold(gesture.x, gesture.y);
          break;
        case "double-tap":
          this.overview();
          break;
      }
    }
    this.redraw();
  }

  private readonly toggleViews = (): void => {
    this.viewsOpen = !this.viewsOpen;
    this.layersOpen = false;
    this.sheet = undefined;
  };

  private readonly toggleLayers = (): void => {
    this.layersOpen = !this.layersOpen;
    this.viewsOpen = false;
    this.sheet = undefined;
  };

  private showView(id: string): void {
    this.viewsOpen = false;
    if (this.engine?.showView(id)) {
      this.planView = false;
      this.redraw();
    }
  }

  protected override render(): TemplateResult {
    const t = this.translator;
    const ready =
      this.engineState === "ready" && (this.summary !== undefined || this.planEditor !== undefined);
    const title = this.summary?.title || t.t("view.untitled");
    return html`<div
        class="stage"
        tabindex=${ready ? "0" : "-1"}
        role=${ready ? "img" : nothing}
        aria-label=${ready ? t.t("view.canvas_label", { title }) : nothing}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @wheel=${this.onWheel}
        @keydown=${this.onKeyDown}
        @contextmenu=${(event: Event) => {
          event.preventDefault();
        }}
      ></div>
      ${ready ? this.renderCameras() : nothing} ${ready ? this.renderLabels() : nothing}
      ${ready ? this.renderBadges() : nothing} ${this.renderGuides()} ${this.renderPlanHandles()}
      ${this.renderOverlay()} ${ready ? this.renderLegend() : nothing}
      ${ready ? this.renderAlerts() : nothing} ${ready ? this.renderTools() : nothing}
      ${ready ? this.renderSheet() : nothing}
      ${
        this.notice
          ? html`<div class="notice glass" role="alert" data-testid="notice">${this.notice}</div>`
          : nothing
      }`;
  }

  /** With several storeys, one button each, the highest on top (not while editing one). */
  private renderStoreys(): TemplateResult | typeof nothing {
    if (this.storeys.length < 2 || this.editingAny) return nothing;
    const t = this.translator;
    const levels = storeyLevels(this.storeys).reverse();
    return html`<span class="rule" aria-hidden="true"></span>
      <div role="group" aria-label=${t.t("storey.menu")} data-testid="storeys">
        ${levels.map(({ storey, level }) => {
          const name = storeyName(t, storey, level);
          // Another storey with an alert is marked (the most urgent's colour).
          const alert = this.alerts.find((a) => a.storey === storey.id);
          const label = alert ? t.t("storey.with_alert", { name }) : name;
          return html`<button
            class="storey ${alert ? `alert ${alert.level}` : ""}"
            data-storey=${storey.id}
            title=${label}
            aria-label=${label}
            aria-pressed=${storey.id === this.storey ? "true" : "false"}
            @click=${() => {
              this.chooseStorey(storey.id);
            }}
          >
            ${storeyShort(level)}
          </button>`;
        })}
      </div>`;
  }

  /** Asks the host to show another storey. */
  private chooseStorey(id: string): void {
    this.viewsOpen = false;
    this.layersOpen = false;
    this.sheet = undefined;
    this.focusedRoom = undefined;
    if (id !== this.storey) fire(this, "domotwin-storey", id);
  }

  /** The plan editor's handles: the selected room's corners and sides, guides, what is drawn. */
  private renderPlanHandles(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!this.planEditor || !canvas) return nothing;
    return this.planEditor.render(Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width));
  }

  /** Edit mode's guides: the faces a piece snapped onto, and its distances to the walls. */
  private renderGuides(): TemplateResult | typeof nothing {
    const guides = this.edit?.guides;
    const canvas = this.canvas;
    if (!guides || guides.length === 0 || !canvas) return nothing;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    const format = new Intl.NumberFormat(this.translator.language, { maximumFractionDigits: 0 });
    return html`<svg class="guides" aria-hidden="true" data-testid="guides">
      ${guides.map((guide) => {
        const [x1, y1, x2, y2] = [guide.a[0] * k, guide.a[1] * k, guide.b[0] * k, guide.b[1] * k];
        if (guide.cm === undefined) {
          return svg`<line class="snap" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
        }
        if (guide.cm < 1 || Math.hypot(x2 - x1, y2 - y1) < 24) return nothing;
        return svg`<line class="distance" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
          <text x=${(x1 + x2) / 2} y=${(y1 + y2) / 2}>${format.format(guide.cm)} cm</text>`;
      })}
    </svg>`;
  }

  private renderSheet(): TemplateResult | typeof nothing {
    const sheet = this.sheet;
    if (!sheet) return nothing;
    if (sheet.kind === "controls") {
      return html`<domotwin-controls
        data-testid="controls"
        .hass=${this.hass}
        .heading=${sheet.heading}
        .entities=${sheet.entities}
        @domotwin-close=${this.closeSheet}
      ></domotwin-controls>`;
    }
    return html`<domotwin-room
      data-testid="room"
      .hass=${this.hass}
      .heading=${sheet.heading}
      .area=${sheet.area}
      .admin=${this.hass?.user?.is_admin === true}
      @domotwin-close=${this.closeSheet}
    ></domotwin-room>`;
  }

  private renderTools(): TemplateResult {
    const t = this.translator;
    const plan = this.planView;
    if (this.planEditor) {
      // The plan editor draws in 2D: only the whole home to frame again.
      return html`<div class="tools glass" role="toolbar" aria-label=${t.t("view.toolbar")}>
        <button
          data-testid="overview"
          title=${t.t("view.overview")}
          aria-label=${t.t("view.overview")}
          @click=${() => {
            this.overview();
          }}
        >
          ${icon(mdiHomeOutline)}
        </button>
      </div>`;
    }
    return html`<div class="tools glass" role="toolbar" aria-label=${t.t("view.toolbar")}>
        <button
          data-testid="toggle-plan"
          aria-pressed=${plan ? "true" : "false"}
          title=${plan ? t.t("view.show_3d") : t.t("view.show_plan")}
          aria-label=${plan ? t.t("view.show_3d") : t.t("view.show_plan")}
          @click=${() => {
            this.setPlanView(!plan);
          }}
        >
          ${icon(plan ? mdiCubeOutline : mdiFloorPlan)}
        </button>
        <button
          data-testid="overview"
          title=${t.t("view.overview")}
          aria-label=${t.t("view.overview")}
          @click=${() => {
            this.overview();
          }}
        >
          ${icon(mdiHomeOutline)}
        </button>
        <button
          data-testid="layers"
          title=${t.t("layers.menu")}
          aria-label=${t.t("layers.menu")}
          aria-haspopup="menu"
          aria-expanded=${this.layersOpen ? "true" : "false"}
          aria-pressed=${this.layer !== "off" || this.realSun ? "true" : "false"}
          @click=${this.toggleLayers}
        >
          ${icon(mdiLayersOutline)}
        </button>
        ${
          this.savedViews.length > 0
            ? html`<button
                data-testid="views"
                title=${t.t("view.views")}
                aria-label=${t.t("view.views")}
                aria-haspopup="menu"
                aria-expanded=${this.viewsOpen ? "true" : "false"}
                @click=${this.toggleViews}
              >
                ${icon(mdiCamera)}
              </button>`
            : nothing
        }
        ${this.renderStoreys()}
      </div>
      ${
        this.viewsOpen
          ? html`<div class="views glass" role="menu" aria-label=${t.t("view.views")}>
              ${this.savedViews.map(
                (view) =>
                  html`<button
                    role="menuitem"
                    @click=${() => {
                      this.showView(view.id);
                    }}
                  >
                    ${view.name}
                  </button>`,
              )}
            </div>`
          : nothing
      }
      ${this.layersOpen ? this.renderLayerMenu() : nothing}`;
  }

  /** The layer menu: one layer at a time, and sunlight through the windows. */
  private renderLayerMenu(): TemplateResult {
    const t = this.translator;
    return html`<div
      class="views glass"
      role="menu"
      aria-label=${t.t("layers.menu")}
      data-testid="layer-menu"
    >
      ${LAYER_NAMES.map(
        (layer) =>
          html`<button
            role="menuitemradio"
            data-layer=${layer}
            aria-checked=${this.layer === layer ? "true" : "false"}
            @click=${() => {
              this.setLayer(layer);
            }}
          >
            ${t.t(`layers.${layer}`)}
          </button>`,
      )}
      <hr />
      <button
        role="menuitemcheckbox"
        data-testid="real-sun"
        aria-checked=${this.realSun ? "true" : "false"}
        @click=${() => {
          this.setRealSun(!this.realSun);
        }}
      >
        ${t.t("layers.sun")}
      </button>
      <button
        role="menuitemcheckbox"
        data-testid="show-badges"
        aria-checked=${this.showBadges ? "true" : "false"}
        @click=${() => {
          this.layersOpen = false;
          this.showBadges = !this.showBadges;
        }}
      >
        ${t.t("layers.badges")}
      </button>
      <button
        role="menuitemcheckbox"
        data-testid="show-cameras"
        aria-checked=${this.showCameras ? "true" : "false"}
        @click=${() => {
          this.layersOpen = false;
          this.showCameras = !this.showCameras;
        }}
      >
        ${t.t("layers.cameras")}
      </button>
    </div>`;
  }

  /** What the cameras see: their cones on the floor, red while recording. */
  private renderCameras(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!canvas || !this.showCameras || this.editingAny || this.linking) return nothing;
    if (this.cameraShapes.length === 0) return nothing;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    return html`<svg class="cameras" aria-hidden="true" data-testid="cameras">
      ${this.cameraShapes.map((shape) => {
        const state = this.hass?.states[shape.entity]?.state;
        // A camera Home Assistant no longer has is off too.
        const tone =
          state === "recording"
            ? "recording"
            : state === undefined || state === "unavailable"
              ? "off"
              : "on";
        const points = shape.points.map(([x, y]) => `${x * k},${y * k}`).join(" ");
        return svg`<polygon class=${tone} data-id=${shape.id} points=${points}></polygon>`;
      })}
    </svg>`;
  }

  /** The devices' badges over their elements; a tap does what a tap on the element does. */
  private renderBadges(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!canvas || !this.showBadges || this.editingAny || this.linking || this.badges.size === 0) {
      return nothing;
    }
    const t = this.translator;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    // Above the power layer's labels, which stand at the same place.
    const raised = this.layer === "power" ? "raised" : "";
    return html`<div class="badges ${raised}" data-testid="badges">
      ${[...this.badges].map(([id, badges]) => {
        const point = this.badgePoints[id];
        if (!point) return nothing;
        const name = this.names[id]?.name ?? id;
        const label = badges
          .map((badge) => {
            const text = t.t(`devices.${badge.kind}`, { name });
            return badge.text ? `${text} (${badge.text})` : text;
          })
          .join(", ");
        return html`<button
          class="badge-group"
          data-element=${id}
          style="left:${point[0] * k}px;top:${point[1] * k}px"
          aria-label=${label}
          title=${label}
          @click=${() => {
            this.tapElement(id);
          }}
        >
          ${badges.map(
            (badge) =>
              html`<span class="badge ${badge.tone} ${badge.kind}" data-kind=${badge.kind}
                >${icon(badgeIcon(badge))}${
                  badge.kind === "battery_low" && badge.text
                    ? html`<small>${badge.text}</small>`
                    : nothing
                }</span
              >`,
          )}
        </button>`;
      })}
    </div>`;
  }

  /** The legend of the layer shown: its colours from end to end, or why it shows nothing. */
  private renderLegend(): TemplateResult | typeof nothing {
    const t = this.translator;
    const layer = this.layer;
    if (layer === "off" || this.editingAny) return nothing;
    const name = t.t(`layers.${layer}`);
    if (layer === "power") {
      const gradient = `linear-gradient(to right, ${POWER_GRADIENT.join(", ")})`;
      return html`<div class="legend glass" data-testid="legend" role="note">
        <span class="name">${name}</span>
        <div class="bar" style="background:${gradient}"></div>
        <div class="ends"><span>3 W</span><span>3 kW</span></div>
      </div>`;
    }
    if (!(HEAT_KINDS as readonly string[]).includes(layer)) return nothing;
    const legend = heatLegend(layer);
    if (!legend) return nothing;
    if (this.heatValues === 0) {
      return html`<div class="legend glass" data-testid="legend" role="note">
        <span>${t.t("layers.no_values", { layer: name })}</span>
      </div>`;
    }
    const language = t.language;
    const fahrenheit = this.fahrenheit;
    const low = formatHeat(legend.stops[0]?.[0] ?? 0, legend.unit, language, fahrenheit);
    const high = formatHeat(
      legend.stops[legend.stops.length - 1]?.[0] ?? 0,
      legend.unit,
      language,
      fahrenheit,
    );
    const gradient = `linear-gradient(to right, ${legend.gradient.join(", ")})`;
    return html`<div
      class="legend glass"
      data-testid="legend"
      role="note"
      aria-label=${t.t("layers.legend", { layer: name, low, high })}
    >
      <span class="name">${name}</span>
      <div class="bar" style="background:${gradient}"></div>
      <div class="ends" aria-hidden="true"><span>${low}</span><span>${high}</span></div>
    </div>`;
  }

  /** The values of the layer shown: each room's at its centre, each piece's power above it. */
  private renderLabels(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (this.labels.length === 0 || !canvas || this.editingAny) return nothing;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    const language = this.translator.language;
    const fahrenheit = this.fahrenheit;
    const unit = (HEAT_KINDS as readonly string[]).includes(this.layer)
      ? (heatLegend(this.layer)?.unit ?? "")
      : "";
    return html`<div class="labels" aria-hidden="true" data-testid="labels">
      ${this.labels.map(
        (label) =>
          html`<span
            class=${label.kind}
            data-id=${label.id}
            style="left:${label.x * k}px;top:${label.y * k}px"
            >${
              label.kind === "power"
                ? formatPower(label.value, language)
                : formatHeat(label.value, unit, language, fahrenheit)
            }</span
          >`,
      )}
    </div>`;
  }

  /** What an alert says; on another storey, which one. */
  private alertText(alert: StoreyAlert): string {
    const t = this.translator;
    const text = t.t(`layers.alert_${alert.reason}`, { room: alert.name });
    if (!alert.storey) return text;
    const level = storeyLevels(this.storeys).find(({ storey }) => storey.id === alert.storey);
    if (!level) return text;
    return t.t("storey.alert_on", {
      alert: text,
      storey: storeyName(t, level.storey, level.level),
    });
  }

  /** The rooms with an alert: a tap frames the room (showing its storey first). */
  private renderAlerts(): TemplateResult | typeof nothing {
    const alerts = this.alerts;
    if (alerts.length === 0 || this.planEditor) return nothing;
    const t = this.translator;
    const shown = alerts.slice(0, MAX_ALERTS_SHOWN);
    const more = alerts.length - shown.length;
    return html`<div class="alerts" role="alert" data-testid="alerts">
      ${shown.map(
        (alert) =>
          html`<button
            class="glass ${alert.level}"
            data-room=${alert.room}
            data-storey=${alert.storey ?? nothing}
            @click=${() => {
              const room = { id: alert.room, name: alert.name };
              if (alert.storey) {
                // On another storey: shown first, then the room framed.
                this.chooseStorey(alert.storey);
                this.focusAfterLoad = room;
                return;
              }
              if (this.engine?.focusElement(alert.room)) this.focusedRoom = room;
              this.redraw();
            }}
          >
            ${icon(alert.level === "danger" ? mdiAlert : mdiAlertCircleOutline)}
            <span>${this.alertText(alert)}</span>
          </button>`,
      )}
      ${more > 0 ? html`<span class="more">${t.tp("layers.more_alerts", more)}</span>` : nothing}
    </div>`;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    const t = this.translator;
    if (this.engineState === "unsupported" || this.engineState === "failed") {
      const text =
        this.engineState === "unsupported"
          ? t.t("view.webgl2_unavailable")
          : t.t("view.engine_failed");
      return this.message(mdiAlertCircleOutline, text, undefined, true);
    }
    if (this.planError) {
      return this.message(mdiAlertCircleOutline, t.error(this.planError), undefined, true);
    }
    if (this.planEditor) return nothing;
    if (this.engineState !== "ready" || this.plan === undefined) {
      return html`<div class="overlay" role="status" aria-live="polite">
        <div class="message glass">
          <div class="spinner" aria-hidden="true"></div>
          <p>${t.t("view.loading")}</p>
        </div>
      </div>`;
    }
    if (this.plan === null) {
      const hint = this.hass?.user?.is_admin ? t.t("view.no_plan_admin") : t.t("view.no_plan_user");
      return this.message(mdiFloorPlan, t.t("view.no_plan"), hint, false, true);
    }
    if (this.loadError) {
      return this.message(
        mdiAlertCircleOutline,
        t.t("view.plan_unreadable", {
          reason: t.errorAt(this.loadError.code, this.loadError.element),
        }),
        undefined,
        true,
      );
    }
    if (!this.summary || this.sheet || this.editingAny) return nothing;
    if (this.linking) {
      return html`<div class="chip glass" role="status" data-testid="link-hint">
        ${t.t("link.hint")}
      </div>`;
    }
    const room = this.focusedRoom;
    if (room) {
      return html`<button
        class="chip glass"
        data-testid="room-chip"
        aria-label=${t.t("view.room_panel", { room: room.name })}
        @click=${() => {
          void this.openRoom(room.id, room.name);
        }}
      >
        <span>${room.name}</span>${icon(mdiChevronUp)}
      </button>`;
    }
    const title = this.summary.title || t.t("view.untitled");
    return html`<div class="chip glass" role="status" data-testid="summary">
      <span
        >${title} · ${t.tp("view.rooms", this.summary.rooms)} ·
        ${t.tp("view.pieces", this.summary.furniture)}</span
      >
    </div>`;
  }

  private message(
    path: string,
    title: string,
    text?: string,
    error = false,
    withAction = false,
  ): TemplateResult {
    return html`<div class="overlay">
      <div class="message glass ${error ? "error" : ""}" role=${error ? "alert" : "status"}>
        ${icon(path)}
        <h2>${title}</h2>
        ${text ? html`<p>${text}</p>` : nothing}
        ${withAction ? html`<slot name="empty-action"></slot>` : nothing}
      </div>
    </div>`;
  }
}
