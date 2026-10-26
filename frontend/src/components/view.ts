import {
  mdiBathtubOutline,
  mdiBedKingOutline,
  mdiDesk,
  mdiGarage,
  mdiSilverwareForkKnife,
  mdiSofaOutline,
  mdiStairs,
  mdiToilet,
  mdiTree,
  mdiWardrobeOutline,
  mdiAlert,
  mdiAlertCircleOutline,
  mdiArrowCollapseVertical,
  mdiArrowExpandVertical,
  mdiBatteryAlertVariantOutline,
  mdiCamera,
  mdiCctv,
  mdiCctvOff,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiCubeOutline,
  mdiDishwasher,
  mdiDoorOpen,
  mdiFan,
  mdiFloorPlan,
  mdiHomeOutline,
  mdiHomeRoof,
  mdiLayersOutline,
  mdiLayersTriple,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiMicrophone,
  mdiPlay,
  mdiPowerPlug,
  mdiPrinter,
  mdiPrinter3d,
  mdiRecordRec,
  mdiShieldAlertOutline,
  mdiStove,
  mdiTumbleDryer,
  mdiWalk,
  mdiWashingMachine,
  mdiWrenchClock,
  mdiClockOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";

import { themeBackground, type Rgb } from "../color";
import {
  DEFAULT_ACCENT,
  defaultAccent,
  resolveLook,
  type CutawayMode,
  type LightingMode,
  type LookName,
  type QualityName,
  type SunMode,
  type ThemeMode,
  type ViewMode,
} from "../config";
import {
  DomoTwinEngine,
  EngineError,
  engineError,
  heatLegend,
  upkeepStates,
  wasmMemoryBytes,
  type EditState,
  type HomeStorey,
  type LayerLabel,
  type PickedElement,
  type PlanSummary,
  type SavedView,
  type SceneStats,
  type StoreyLabel,
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
import { DomoTwinClient, type Settings, type StoreyInfo, type StoredPlan } from "../ha/client";
import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import { translatorFor, type KindName, type Translator } from "../i18n";
import { failureText, runAction } from "../live/actions";
import type { ReadAutomation } from "../live/automations";
import {
  boundEntityIds,
  entityName,
  holdAction,
  primaryEntity,
  readBindings,
  roomArea,
  tapAction,
  type Action,
  type BindingsJson,
  type ElementBinding,
  type RoomAction,
} from "../live/bindings";
import {
  HEAT_KINDS,
  LAYER_NAMES,
  automationsAvailable,
  networkAvailable,
  formatHeat,
  formatPower,
  roomLayers,
  type LayerName,
  type PlanRoom,
} from "../live/layers";
import { deviceBadges, mergeBadges, type Badge, type BadgeKind } from "../live/devices";
import { scheduleBadges, timeStyle, whenText, type Schedule } from "../live/schedules";
import {
  readStandings,
  todayIn,
  upkeepBadges,
  upkeepShades,
  type Standings,
  type Upkeep,
} from "../live/upkeep";
import {
  peopleByRoom,
  peopleByStorey,
  peopleJson,
  ownHidden,
  peopleShown,
  type PeopleSettings,
  type PersonShown,
} from "../live/people";
import { robotDocks, robotsShown, type RobotDock } from "../live/robots";
import { energyFlows, energyNow, type EnergyNow, type EnergySettings } from "../live/energy";
import { energyFlow, energyStyles } from "./energy-flow";
import { locatedSensors, locatedShown, type LocatedShown } from "../live/locating";
import { outOfSight, privateRooms } from "../live/privacy";
import { avatar, avatarStyles } from "./person-avatar";
import { spoken } from "../live/show";
import { StateSync } from "../live/states";
import {
  presentDevices,
  roomActions,
  roomCommands,
  roomDevices,
  runRoom,
  type RoomCommand,
  type RoomDevices,
} from "../live/room-actions";
import { roomBarStyles, roomButtons } from "./room-bar";
import {
  ALL_STOREYS,
  storeyCounts,
  storeyLevels,
  storeyName,
  storeyShort,
  withAlertsElsewhere,
  type StoreyAlert,
  type StoreyRooms,
} from "../live/storeys";
import { applyLink, planElement, planRooms, suggestions } from "../live/suggest";
import {
  placeLabels,
  textWidth,
  type PlacedLabel,
  type RoomKind,
  type RoomLabel,
} from "../live/room-labels";
import { assistAvailable, canListen, listeningPipeline, openAssist } from "../live/voice";
import { FrameScheduler } from "../scheduler";
import { readTip, tipRead } from "../live/draft";
import { fire } from "./define";
import { icon } from "./icon";
import { DialogFocus } from "./dialog";
import { focusBack, focusMenu, menuKeydown } from "./menu";
import type { Planner } from "../planner/planner";
import { documentFonts } from "../fonts";
import type { PlanEditState, PlanEditor, PlanTool } from "./plan-editor";
import type { VoiceDialogMode } from "./voice-dialog";
import { baseStyles, lookStyles } from "./styles";

type EngineState = "idle" | "loading" | "ready" | "unsupported" | "failed";

/** Options of a view (from the card configuration or the panel). */
export interface ViewOptions {
  quality: QualityName;
  /** The look (D-027); absent: the home's, else `auto`. */
  theme?: ThemeMode;
  /** Its accent (`#rrggbb`); absent: the home's. */
  accent?: string;
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
  /** The people in their rooms, as figures (on unless `false`, D-034). */
  people?: boolean;
  /** Where the sun lights from (`fixed` unless set). */
  sun?: SunMode;
  /** Badges over the devices (on unless `false`). */
  badges?: boolean;
  /** What the cameras see, on the floor (on unless `false`). */
  cameras?: boolean;
  /** The rooms' names over their floor (on unless `false`). */
  names?: boolean;
  /** The names of small rooms too (closets, rooms under 2.5 m²; off unless `true`). */
  small_rooms?: boolean;
  /** Every storey at once (D-028): spread apart and the roof shown, unless `false`. */
  spread?: boolean;
  roof?: boolean;
  /**
   * The kiosk (D-029): back to the view it opened on after this many seconds untouched (0 or
   * absent: never), turning slowly meanwhile (`orbit`), dimmed at night (`nightDim`).
   */
  idle?: number;
  orbit?: boolean;
  nightDim?: boolean;
  /** The buttons (on unless `false`). */
  tools?: boolean;
  /** The microphone among them, when Assist runs (on unless `false`, D-041). */
  voice?: boolean;
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
  upkeep_due: mdiWrenchClock,
  upkeep_overdue: mdiWrenchClock,
  warranty_ending: mdiShieldAlertOutline,
  scheduled: mdiClockOutline,
};
const APPLIANCE_ICONS: Record<string, string> = {
  washer: mdiWashingMachine,
  dryer: mdiTumbleDryer,
  dishwasher: mdiDishwasher,
  stove: mdiStove,
  hood: mdiFan,
  printer: mdiPrinter,
  "3d-printer": mdiPrinter3d,
} satisfies Partial<Record<KindName, string>>;

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
/** The icon of each kind of room, before its name over the view. */
const ROOM_ICONS: Record<RoomKind, string> = {
  kitchen: mdiStove,
  living: mdiSofaOutline,
  dining: mdiSilverwareForkKnife,
  bedroom: mdiBedKingOutline,
  bathroom: mdiBathtubOutline,
  toilet: mdiToilet,
  office: mdiDesk,
  laundry: mdiWashingMachine,
  hall: mdiDoorOpen,
  closet: mdiWardrobeOutline,
  garage: mdiGarage,
  stairs: mdiStairs,
  outdoor: mdiTree,
  room: mdiHomeOutline,
};
/** A lost WebGL context starts the engine again, once a minute at most: more, the GPU is failing. */
const CONTEXT_RESTART_MS = 60 * 1000;
const FALLBACK_BACKGROUND: Rgb = { r: 242, g: 242, b: 240 };
/** How long a notice (a failed action) stays (ms). */
const NOTICE_MS = 5000;
/** What the view asks of the network map (`network-panel.ts`, loaded on demand). */
type NetworkMap = HTMLElement & {
  reproject(scale: number): void;
  selectLink(a: string, b: string): void;
};

/** What the view asks of the automation wires (`automation-wires.ts`, loaded on demand). */
type WiresView = HTMLElement & {
  reproject(scale: number): void;
  tap(x: number, y: number): boolean;
};

/** What a panel already read of the automations whose wires it asks for. */
type WiresReads = ReadonlyMap<string, ReadAutomation>;

/** Frame interval of the layers' animation alone (ms): 24 frames per second. */
const LAYER_FRAME_MS = 1000 / 24;
/** The kiosk's turn (D-029): a round in two and a half minutes (radians per second), drawn at 20
 * frames per second. */
const ORBIT_SPEED = (2 * Math.PI) / 150;
const ORBIT_FRAME_MS = 1000 / 20;
/** How long the hint on how to walk shows (ms). */
const WALK_HINT_MS = 6000;
/** Without `idle`, the slow turn and night dimming wait this long untouched (seconds). */
const IDLE_AFTER = 60;
/** Keys that walk (D-029), where they are on the keyboard: ahead, back, to the left and to the
 * right (W, S, A and D on QWERTY; Z, S, Q and D on AZERTY). */
const WALK_KEYS: Record<string, [number, number]> = {
  ArrowUp: [1, 0],
  KeyW: [1, 0],
  ArrowDown: [-1, 0],
  KeyS: [-1, 0],
  KeyA: [0, -1],
  KeyD: [0, 1],
};
/** The view's sheets: the focus goes into them and comes back (D-042). */
const VIEW_SHEETS = "domotwin-controls, domotwin-piece, domotwin-room, domotwin-person";
/** Alerts listed in the banner; the others are counted. */
const MAX_ALERTS_SHOWN = 2;
/** The power layer's colours, from a few watts to 3 kW (`shaders.rs`). */
const POWER_GRADIENT = ["#ffe459", "#ff7b2b"];
const NO_BINDINGS: BindingsJson = { version: 1, rooms: {}, elements: {} };
const NO_ACTIONS: RoomAction[] = [];
/** Size of the storeys' pictures (device pixels; shown at half that). */
const PICTURE_WIDTH = 280;
const PICTURE_HEIGHT = 180;
/** The narrowest view (CSS pixels) that shows them beside the home. */
const PICTURES_MIN_WIDTH = 560;
/** Under this width (CSS pixels) the energy legend stands above the room chip (D-049). */
const NARROW_WIDTH = 480;
/** Room kept on the right of a storey's label for itself and the toolbar (CSS pixels). */
const STOREY_LABEL_ROOM = 250;
/** About half the width and the height (with its gap) of a label over a storey (CSS pixels). */
const STOREY_LABEL_HALF = 80;
const STOREY_LABEL_HEIGHT = 56;

/** A storey's picture (RGBA rows from the top) as a data URL; empty without one. */
function pictureUrl(pixels: Uint8Array): string {
  if (pixels.length !== PICTURE_WIDTH * PICTURE_HEIGHT * 4) return "";
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE_WIDTH;
  canvas.height = PICTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), PICTURE_WIDTH, PICTURE_HEIGHT),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

/**
 * The panel open over the scene: an element's controls, a piece's own sheet (a piece linked to
 * nothing, for its upkeep card, D-033) or a room's panel.
 */
type Sheet =
  | {
      kind: "controls";
      heading: string;
      /** The element whose controls these are. */
      element: string;
      entities: string[];
      device?: string;
      area?: string;
      piece?: string;
    }
  | { kind: "piece"; heading: string; piece: string; room?: FocusedRoom }
  | { kind: "room"; heading: string; area?: string; room?: string; closed?: boolean }
  | { kind: "person"; heading: string; person: string };

/**
 * The name and type of each element of the plan shown, the room of its pieces, doors and windows,
 * and the room on the other side of its doors and windows.
 */
type ElementNames = Record<string, { name: string; type: string; room?: string; beside?: string }>;

/** The bubble over a piece: its device and main control, or the devices it could be linked to. */
interface Bubble {
  element: string;
  heading: string;
  entity?: string;
  suggestions: string[];
}

/** A bubble goes this long after it was last touched (ms). */
const BUBBLE_MS = 8000;
/** A bubble's width (the bubble's own, `bubble.ts`), and how far it keeps from the view's edges. */
const BUBBLE_WIDTH = 300;
const EDGE = 12;

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

/** The next frame's time (`requestAnimationFrame`). */
export function nextFrame(): Promise<number> {
  return new Promise<number>((resolve) => requestAnimationFrame(resolve));
}

/** A run of `benchmark()` that lasts a time (the "Measure performance" button, D-053). */
export interface BenchmarkRun {
  /** How long it runs (ms). */
  ms: number;
  /** The camera turns around the home meanwhile (radians a second). */
  turn?: number;
  /** Called before each frame with how far the run is (0–1). */
  step?: (fraction: number) => void;
}

/** Frame timings measured by `benchmark()` (frame-time smoke test). */
export interface FrameStats {
  frames: number;
  wasmMemoryBytes: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  intervalMedianMs: number;
  intervalP95Ms: number;
  /** The page was hidden during the run: its intervals mean nothing. */
  interrupted?: boolean;
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
  /** The look and accent drawn: `<look> <#accent>`. */
  look?: string;
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
  /** What the engine was told the robot vacuums do (D-049), as JSON. */
  robots?: string;
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
    upkeep: { attribute: false },
    upkeepLoaded: { state: true },
    people: { attribute: false },
    shownPeople: { state: true },
    located: { state: true },
    personPoints: { state: true },
    standings: { state: true },
    linking: { attribute: false },
    placeDevices: { attribute: false },
    linkable: { attribute: false },
    bubble: { state: true },
    tip: { state: true },
    bubbleBusy: { state: true },
    networkLoaded: { state: true },
    wiresAsked: { state: true },
    wiresLoaded: { state: true },
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
    privateRooms: { attribute: false },
    homeTheme: { attribute: false },
    homeAccent: { attribute: false },
    energy: { attribute: false },
    look: { reflect: true },
    storeys: { attribute: false },
    storey: { attribute: false },
    home: { attribute: false },
    elsewhere: { attribute: false },
    spread: { state: true },
    roof: { state: true },
    walking: { state: true },
    walkHint: { state: true },
    dimmed: { state: true },
    storeyLabels: { state: true },
    pictures: { state: true },
    layer: { state: true },
    layersOpen: { state: true },
    voiceHelp: { state: true },
    realSun: { state: true },
    alerts: { state: true },
    labels: { state: true },
    roomNames: { state: true },
    showBadges: { state: true },
    showCameras: { state: true },
    smallRooms: { state: true },
    badges: { state: true },
    badgePoints: { state: true },
  };

  hass?: HomeAssistant;
  /** `undefined` while loading, `null` when no plan is stored. */
  plan?: StoredPlan["plan"];
  /** The edit overlay applied to the plan (pieces moved, removed or added in edit mode). */
  layout?: StoredPlan["layout"];
  /** What the plan's elements and rooms are bound to (`undefined`: nothing bound). */
  bindings?: BindingsJson;
  /** The upkeep cards (D-033; `undefined`: none, or an integration without them). */
  upkeep?: Upkeep;
  /** The people placed in their rooms (D-034; `undefined`: none, or an older integration). */
  people?: PeopleSettings;
  /**
   * Link mode (the panel's bindings editor): taps and long presses pick an element
   * (`domotwin-pick`, detail: the picked element) instead of acting.
   */
  linking = false;
  /** Devices of the network map can be placed in the home (the panel, which links them). */
  placeDevices = false;
  /**
   * A link editor is at hand (the panel): a piece's bubble offers it (`domotwin-link-element`,
   * detail: the piece, as `domotwin-pick`'s).
   */
  linkable = false;
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
  /** The home's private rooms (its settings, D-039). */
  privateRooms?: Settings["rooms"];
  /** The private rooms this viewer may not see now, drawn closed (none while editing or
   * linking: administrators change the home). */
  protected closed = new Set<string>();
  private closedKey = "";
  /** The closed rooms the engine was told, and whether the overlays still have to follow. */
  private closedSent?: string;
  private closedChanged = false;
  /** The home's look and accent (its settings), for views whose options do not choose one. */
  homeTheme?: ThemeMode;
  homeAccent?: string;
  /** Where the home's energy is read (its settings, D-049): shown with the power layer. */
  energy?: EnergySettings;
  /** The look shown (D-027), on the element as an attribute for the overlays' colours. */
  look: LookName = "day";
  /**
   * The storeys of the home and the one shown (its `plan`): with several, a switcher fires
   * `domotwin-storey` (detail: the storey's id) for the host to show it.
   */
  storeys: StoreyInfo[] = [];
  storey?: string;
  /**
   * Every storey's plan, lowest first, to show the home whole (D-028; `storey` is then
   * `ALL_STOREYS`): `plan` and `layout` are not shown, edit mode and the plan editor wait for a
   * storey alone.
   */
  home?: HomeStorey[];
  /** The rooms of the other storeys: their alerts show too, and a tap on one goes there. */
  elsewhere: StoreyRooms[] = [];

  protected engineState: EngineState = "idle";
  protected summary?: PlanSummary;
  /** When the home's first picture was drawn (`performance.now()`), for the measure (D-053). */
  firstPictureAt?: number;
  protected loadError?: EngineError;
  protected planView = false;
  protected savedViews: SavedView[] = [];
  protected viewsOpen = false;
  /** The focus goes into the sheet or dialog shown and comes back (D-042). */
  private readonly dialogs = new DialogFocus();
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.dialogs.escape(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  protected sheet?: Sheet;
  /** The bubble a tap left over a piece (D-047), and a link of its being saved. */
  protected bubble?: Bubble;
  /** The piece whose link a bubble is saving. */
  protected bubbleBusy?: string;
  private bubbleTimer?: number;
  /** Taps and long presses so far: a bubble still loading for an older one is not shown. */
  private gestureCount = 0;
  /** The tip on what a tap does, until it is read once on this device (D-047). */
  protected tip = false;
  /** Where the mouse last was over the scene, looked up at the next frame. */
  private hoverAt?: { x: number; y: number };
  private hoverFrame = 0;
  protected focusedRoom?: FocusedRoom;
  /** The framed room's devices, and what they were read from (`roomDevicesOf`). */
  private devicesMemo?: {
    id: string;
    name: string;
    entities: HomeAssistant["entities"];
    areas: HomeAssistant["areas"];
    devices: HomeAssistant["devices"];
    bindings: BindingsJson;
    names: ElementNames;
    value: RoomDevices;
    /** Those Home Assistant has, for these states. */
    states?: HomeAssistant["states"];
    present?: RoomDevices;
  };
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
  /** The network map's module is loaded (D-031). */
  protected networkLoaded = false;
  private networkModule?: Promise<unknown>;
  /** The automations whose wires a panel asked for (D-032), and the wires' module loaded. */
  protected wiresAsked?: { ids: string[]; reads?: WiresReads };
  protected wiresLoaded = false;
  private wiresModule?: Promise<unknown>;
  protected layersOpen = false;
  /** Why voice cannot listen, shown over the view (D-041). */
  protected voiceHelp?: VoiceDialogMode;
  /** Sunlight through the windows: the sun where it really is. */
  protected realSun = false;
  /** Rooms with an alert, dangers first (the other storeys' with their storey). */
  protected alerts: StoreyAlert[] = [];
  /** A room to frame once its storey is shown (an alert on another storey was tapped). */
  private focusAfterLoad?: { id: string; name: string };
  /** The values of the layer shown and where they go (device pixels). */
  protected labels: LayerLabel[] = [];
  /** The rooms' names, where they go (device pixels) and their areas, while no layer shows its
   * values. */
  protected roomNames: RoomLabel[] = [];
  private roomNamesText = "[]";
  /** The names placed last, and what for: placed again only when that changes. */
  private placedNames?: {
    names: RoomLabel[];
    focused?: string;
    width: number;
    height: number;
    small: boolean;
    placed: PlacedLabel[];
  };
  /** How wide each name is drawn in the view's font (CSS pixels), measured once. */
  private readonly nameWidths = new Map<string, number>();
  private nameFont?: string;
  private measuring?: CanvasRenderingContext2D | null;
  /** A font loaded (the bundled one comes after the first picture): the names are measured again. */
  private readonly onFonts = (): void => {
    this.nameWidths.clear();
    this.nameFont = undefined;
    this.placedNames = undefined;
    this.requestUpdate();
  };
  /** The home shown whole: its storeys spread apart, its roof, where each storey is drawn, and a
   * picture of each (data URLs, lowest first). */
  protected spread = true;
  protected roof = true;
  protected storeyLabels: StoreyLabel[] = [];
  private storeyLabelsText = "[]";
  protected pictures: string[] = [];
  /** Walking at eye level (D-029), and the keys held to walk. */
  protected walking = false;
  private readonly walkKeys = new Set<string>();
  /** How to walk, shown for a few seconds once walking starts. */
  protected walkHint = false;
  private walkHintTimer?: number;
  /** The kiosk (D-029): when the view was last touched, whether it went back since, dimmed. */
  private lastTouch = performance.now();
  private idleNow = false;
  protected dimmed = false;
  /** The touch that woke a dimmed kiosk: its click is swallowed too. */
  private wakeTouch = false;
  private idleTimer?: number;
  /** The pictures of the storeys are to be drawn again (a new home, a new look, models came). */
  private picturesDue = false;
  /** The devices' badges and what the cameras see (the layer menu turns them off). */
  protected showBadges = true;
  protected showCameras = true;
  /** The names of small rooms too (closets, rooms under 2.5 m²). */
  protected smallRooms = false;
  protected badges = new Map<string, Badge[]>();
  /** The actions waiting (D-046), and the connection they are followed on. */
  private schedules: Schedule[] = [];
  private schedulesOn?: HomeAssistant["connection"];
  private stopSchedules?: () => void;
  /** Where each element with badges is drawn (device pixels). */
  protected badgePoints: Record<string, [number, number] | undefined> = {};
  /** Where each upkeep card stands today (D-033), and what it was worked out from. */
  protected standings: Standings = {};
  private standingsFrom?: { upkeep: Upkeep; today: string; engine: DomoTwinEngine };
  /** When today's date was last read (ms), and the date. */
  private todayRead = 0;
  private today = "";
  /** The upkeep list's module is loaded. */
  protected upkeepLoaded = false;
  /** The people shown (D-034), and where their names go (device pixels). */
  protected shownPeople: PersonShown[] = [];
  private shownPeopleText = "[]";
  /** The devices followed by Bluetooth (D-035), for the room panels and the people's sheets. */
  protected located: LocatedShown[] = [];
  private locatedText = "[]";
  /** Their room sensors, looked up again only when Home Assistant's registry changed. */
  private locatedFrom?: { entities: unknown; sensors: string[] };
  protected personPoints: { id: string; x: number; y: number; opacity: number }[] = [];
  private personPointsText = "[]";
  /** What the engine was last told of the people, and which engine. */
  private peopleSent?: { engine: DomoTwinEngine; json: string };
  /** What the engine was last told of the robot vacuums (D-049), and which engine. */
  private robotsSent?: { engine: DomoTwinEngine; json: string };
  /** The docks and their vacuums, for the links and the pieces they were read from. */
  private docks?: {
    bindings: BindingsJson | undefined;
    kinds: Record<string, string>;
    docks: RobotDock[];
  };
  private upkeepModule?: Promise<unknown>;

  private engine?: DomoTwinEngine;
  private canvas?: HTMLCanvasElement;
  private scheduler?: FrameScheduler;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private generation = 0;
  /** When the engine last started again after a lost context. */
  private contextRestart?: number;
  /** The context was lost: the engine waits to start again (the page shown, the minute past). */
  private contextLost = false;
  private contextTimer?: number;
  private background?: Rgb;
  /** The look and accent last given to the engine. */
  private lookKey?: string;
  /** The accent colour of the look. */
  private accent = DEFAULT_ACCENT;
  private loadedPlan?: unknown;
  private loadedLayout?: unknown;
  private loadedHome?: HomeStorey[];
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
  /** The badges last worked out, and the badges' points last read from the engine. */
  private badgesKey = "";
  private pointsText = "{}";
  /** Whether the engine was told to draw what the cameras see (D-038). */
  private camerasShown: boolean | undefined;
  /** A frame when a tapped camera's view goes back to faint (the engine times it, D-038). */
  private cameraFocusTimer: ReturnType<typeof setTimeout> | undefined;
  /** The kind of each piece and the name and type of each element of the plan shown. */
  private kinds: Record<string, string> = {};
  private names: ElementNames = {};
  /** `openNames`, and what it was worked out from. */
  private openNamesFrom?: { names: ElementNames; closed: Set<string>; open: ElementNames };
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
    this.startAgain();
  };

  static override styles = [
    baseStyles,
    lookStyles,
    avatarStyles,
    roomBarStyles,
    energyStyles,
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
      /* Over what a tap acts on (D-047); dragging still grabs. */
      .stage.acts:not(:active) {
        cursor: pointer;
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
      .walk-pad {
        position: absolute;
        right: 12px;
        bottom: 12px;
        display: grid;
        grid-template-columns: repeat(3, 44px);
        grid-template-rows: repeat(2, 44px);
        gap: 4px;
        padding: 6px;
        border-radius: 16px;
      }
      .walk-pad button {
        display: grid;
        place-items: center;
        border: none;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        touch-action: none;
      }
      .walk-pad button:active {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 18%, transparent);
      }
      .walk-pad .pad-ahead {
        grid-column: 2;
        grid-row: 1;
      }
      .walk-pad .pad-left {
        grid-column: 1;
        grid-row: 2;
      }
      .walk-pad .pad-back {
        grid-column: 2;
        grid-row: 2;
      }
      .walk-pad .pad-right {
        grid-column: 3;
        grid-row: 2;
      }
      .walk-hint {
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        max-width: calc(100% - 120px);
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        text-align: center;
        pointer-events: none;
      }
      .dim {
        position: absolute;
        inset: 0;
        background: #000;
        opacity: 0.7;
        pointer-events: none;
      }
      .tools button:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      /* What is on: the button's label says what a press does (the storeys say which is shown). */
      .tools button[aria-pressed="true"],
      .tools button.on {
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
      /* How many people are on a storey (D-034). */
      .tools .storey {
        position: relative;
      }
      .tools .storey .people-count {
        position: absolute;
        bottom: 2px;
        right: 2px;
        min-width: 14px;
        height: 14px;
        padding: 0 3px;
        box-sizing: border-box;
        border-radius: 7px;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 65%, #000);
        color: #fff;
        font-size: 0.65rem;
        font-weight: 700;
        line-height: 14px;
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
      .views .group {
        display: grid;
      }
      .views hr {
        width: 100%;
        margin: 4px 0;
        border: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .room-list {
        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 4;
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 6px;
      }
      /* Out of sight until the keyboard reaches it. */
      .room-list:not(:focus-within) {
        width: 1px;
        height: 1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        clip-path: inset(50%);
      }
      .room-list ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .room-list button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
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
      .room-list button:hover,
      .room-list button:focus-visible {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .room-list small {
        color: var(--secondary-text-color, #5f6368);
      }
      .room-list .value {
        margin-inline-start: auto;
        padding-inline-start: 16px;
        color: var(--secondary-text-color, #5f6368);
        font-variant-numeric: tabular-nums;
      }
      .room-list svg.icon {
        width: 16px;
        height: 16px;
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
      .legend.with-energy {
        width: 220px;
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
      :host([legend="energy"]) .chip {
        max-width: calc(100% - 268px);
      }
      /* A narrow view: the energy legend above the chip, which keeps the whole width. */
      :host([narrow][legend="energy"]) .chip {
        max-width: calc(100% - 24px);
      }
      :host([narrow]) .legend.with-energy {
        bottom: 76px;
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
      .badges,
      .people,
      .room-names,
      .storey-labels {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
      }
      /* A person's name over their figure (D-034), in their colour. */
      .person-tag {
        position: absolute;
        transform: translate(-50%, -100%);
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 28px;
        padding: 2px 9px 2px 3px;
        border: 2px solid var(--person);
        border-radius: 16px;
        background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
        color: inherit;
        font: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        pointer-events: auto;
        transition: opacity 0.2s;
      }
      :host([look="neon"]) .person-tag,
      :host([look="blueprint"]) .person-tag {
        box-shadow: 0 0 10px color-mix(in srgb, var(--person) 70%, transparent);
      }
      /* The cartoon's labels are inked like its outlines (D-036); a person keeps their colour. */
      :host([look="cartoon"]) .room-name {
        border: 2px solid var(--domotwin-ink);
        box-shadow: 2px 2px 0 var(--domotwin-ink);
      }
      :host([look="cartoon"]) .person-tag {
        box-shadow:
          0 0 0 2px var(--domotwin-ink),
          3px 3px 0 2px var(--domotwin-ink);
      }
      .storey-label {
        position: absolute;
        transform: translate(14px, -50%);
        display: grid;
        gap: 1px;
        max-width: 38%;
        padding: 6px 12px;
        border-radius: 12px;
        border-left: 3px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        pointer-events: auto;
        cursor: pointer;
        font: inherit;
        text-align: left;
        color: inherit;
      }
      .storey-label.top {
        transform: translate(-50%, calc(-100% - 10px));
        border-left: none;
        border-bottom: 3px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        max-width: 60%;
      }
      .storey-label strong {
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .storey-label span {
        font-size: 11px;
        color: var(--secondary-text-color, #5f6368);
        white-space: nowrap;
      }
      .pictures {
        position: absolute;
        left: 12px;
        top: 12px;
        display: grid;
        gap: 8px;
        max-height: calc(100% - 80px);
        overflow-y: auto;
        /* Room for the focus rings. */
        padding: 4px;
        margin: -4px;
      }
      .picture {
        display: grid;
        gap: 4px;
        width: 140px;
        padding: 6px;
        border-radius: 12px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        color: inherit;
        text-align: left;
      }
      .picture img {
        width: 100%;
        aspect-ratio: 14 / 9;
        border-radius: 8px;
        display: block;
      }

      .room-name {
        position: absolute;
        transform: translate(-50%, -50%);
        /* As the names are placed (room-labels.ts), padding and border included. */
        box-sizing: border-box;
        max-width: min(240px, 40%);
        overflow: hidden;
        padding: 3px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 999px;
        background: color-mix(in srgb, var(--card-background-color, #fff) 78%, transparent);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
        font-size: 12px;
        font-weight: 600;
        line-height: 16px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* A private room this viewer may not see (D-039): a lock before its name. */
      .room-name svg {
        width: 13px;
        height: 13px;
        margin-right: 4px;
        vertical-align: -2px;
        fill: currentColor;
      }
      /* Only the icon: the name covered another, bigger room's. */
      .room-name.compact {
        padding: 4px;
        line-height: 0;
      }
      .room-name.compact svg {
        width: 16px;
        height: 16px;
        margin: 0;
        vertical-align: 0;
      }
      :host([look="neon"]) .room-name {
        border-color: color-mix(in srgb, var(--domotwin-accent, #ffae45) 45%, transparent);
        box-shadow: 0 0 14px color-mix(in srgb, var(--domotwin-accent, #ffae45) 22%, transparent);
      }
      /* The tip on what a tap does (D-047), once. */
      /* Above the chip at the bottom of the view. */
      .tip {
        position: absolute;
        left: 50%;
        bottom: 64px;
        z-index: 3;
        transform: translateX(-50%);
        width: max-content;
        max-width: calc(100% - 32px);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 6px 6px 14px;
        border-radius: 22px;
      }
      /* A piece's bubble (D-047), above it, or below it near the top of the view. */
      .bubble-at {
        position: absolute;
        z-index: 3;
        transform: translate(-50%, calc(-100% - 20px));
        filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.18));
      }
      .bubble-at.below {
        transform: translate(-50%, 20px);
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
      .chip.room-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        padding: 4px;
      }
      .room-bar button.room-open {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        min-height: 40px;
        padding: 0 10px;
        border: none;
        border-radius: 20px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .room-bar button.room-open span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .room-bar button.room-open svg.icon {
        flex: none;
        width: 18px;
        height: 18px;
      }
      .room-bar button.round {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .room-bar button.round:hover {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      .room-bar button.round svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      .room-bar button.pill {
        min-height: 32px;
        max-width: 160px;
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
      /* SVG groups draw no outline: the circle grows a ring in the text's colour. */
      .plan-handles .insert:focus {
        outline: none;
      }
      .plan-handles .insert:focus-visible circle {
        r: 11px;
        stroke: var(--primary-text-color, #1f2328);
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
    this.addEventListener("keydown", this.onEscape);
    // Any touch, click, key or wheel in the view counts for the kiosk.
    this.addEventListener("pointerdown", this.onTouch, true);
    this.addEventListener("click", this.onWakeClick, true);
    this.addEventListener("keydown", this.onTouch, true);
    this.addEventListener("wheel", this.onTouch, { capture: true, passive: true });
    documentFonts()?.addEventListener("loadingdone", this.onFonts);
    this.lastTouch = performance.now();
    this.idleTimer = window.setInterval(this.checkIdle, 1000);
    if (this.hasUpdated) void this.startEngine();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motionQuery?.removeEventListener("change", this.onMotion);
    this.removeEventListener("keydown", this.onEscape);
    this.removeEventListener("pointerdown", this.onTouch, true);
    this.removeEventListener("click", this.onWakeClick, true);
    this.removeEventListener("keydown", this.onTouch, true);
    this.removeEventListener("wheel", this.onTouch, true);
    documentFonts()?.removeEventListener("loadingdone", this.onFonts);
    window.clearInterval(this.idleTimer);
    window.clearTimeout(this.walkHintTimer);
    clearTimeout(this.cameraFocusTimer);
    window.removeEventListener("keydown", this.onEditKey);
    window.removeEventListener("keydown", this.onPlanKey);
    window.clearTimeout(this.noticeTimer);
    window.clearTimeout(this.contextTimer);
    this.stopSchedules?.();
    this.stopSchedules = undefined;
    window.clearTimeout(this.bubbleTimer);
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    this.schedulesOn = undefined;
    this.parkPlanEditor();
    this.stopEngine();
  }

  /** The actions waiting (D-046), followed on this view's connection: their clocks over the pieces. */
  private followSchedules(): void {
    const hass = this.hass;
    if (!hass || !this.isConnected || this.schedulesOn === hass.connection) return;
    this.stopSchedules?.();
    this.schedulesOn = hass.connection;
    this.stopSchedules = DomoTwinClient.for(hass).subscribeSchedules((items) => {
      this.schedules = items;
      this.applyDevices();
    });
  }

  /** The engine goes; the plan drawn is kept, to go on with when it comes back. */
  private parkPlanEditor(): void {
    if (this.planEditor) {
      this.parked = { planner: this.planEditor.release(), empty: this.planEditor.state.empty };
      this.planEditor = undefined;
    }
    this.planToken += 1;
    this.planOpening = false;
  }

  protected override firstUpdated(): void {
    void this.startEngine();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Another home's Home Assistant (the demo house's, D-050): what was open on the one before
    // is closed.
    const before = changed.get("hass");
    if (before && this.hass && before.connection !== this.hass.connection) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
      this.wiresAsked = undefined;
    }
    if (changed.has("options")) {
      // The layer and the sun start as the options say; the layer menu changes them after.
      const previous = changed.get("options");
      if (previous?.layer !== this.options.layer) this.layer = this.options.layer ?? "off";
      if (previous?.sun !== this.options.sun) this.realSun = this.options.sun === "real";
      if (previous?.badges !== this.options.badges) this.showBadges = this.options.badges !== false;
      // The card's font (`font_family`) may have changed: the names are measured again.
      if (previous !== this.options) this.onFonts();
      if (previous?.small_rooms !== this.options.small_rooms) {
        this.smallRooms = this.options.small_rooms === true;
      }
      if (previous?.cameras !== this.options.cameras) {
        this.showCameras = this.options.cameras !== false;
      }
      if (previous?.spread !== this.options.spread) this.spread = this.options.spread !== false;
      if (previous?.roof !== this.options.roof) this.roof = this.options.roof !== false;
    }
    if (!this.valueLayer && this.labels.length > 0) {
      this.labels = [];
      this.labelsText = "";
    }
    // Where the upkeep cards stand, before the sheets and the list show them.
    if (changed.has("upkeep") || changed.has("hass")) this.applyUpkeep();
    // The private rooms this viewer may not see (D-039), before what is in them is shown.
    const closed =
      this.editingAny || this.linking
        ? new Set<string>()
        : privateRooms(this.privateRooms, this.hass);
    const closedKey = [...closed].sort().join("\n");
    if (closedKey !== this.closedKey) {
      this.closedKey = closedKey;
      this.closed = closed;
      this.closedChanged = true;
    }
    // Who is shown where (D-034), before the sheets and the names show them.
    if (
      changed.has("people") ||
      changed.has("hass") ||
      changed.has("options") ||
      this.closedChanged
    ) {
      this.readPeople();
    }
    // The room chip leaves room for the legend (`renderLegend`), wider with the energy.
    if (this.valueLayer && !this.editingAny) {
      const energy = this.layer === "power" && this.energyShown() !== undefined;
      this.setAttribute("legend", energy ? "energy" : "");
    } else {
      this.removeAttribute("legend");
    }
    if (
      changed.has("hass") ||
      changed.has("options") ||
      changed.has("homeTheme") ||
      changed.has("homeAccent")
    ) {
      this.updateLook();
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    this.followMenus(changed);
    this.followDialogs(changed);
    if (changed.has("bindings")) this.applyBindings();
    // A storey alone again before edit mode starts on it.
    if (changed.has("home")) this.applyPlan();
    // Tools work from above.
    if (this.walking && (this.editing || this.planEditing || this.linking)) this.setWalk(false);
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
      this.followSchedules();
    }
    this.applyLook();
    // `layer` and `realSun` are this view's own state.
    const own = changed as PropertyValues;
    if (
      changed.has("hass") ||
      changed.has("bindings") ||
      changed.has("options") ||
      changed.has("elsewhere") ||
      changed.has("upkeep") ||
      own.has("layer")
    ) {
      this.applyLayers();
    }
    if (changed.has("north") || own.has("realSun") || changed.has("hass")) this.applySun();
    this.applyPeople();
    this.applyRobots();
    if (
      changed.has("hass") ||
      changed.has("bindings") ||
      changed.has("plan") ||
      changed.has("upkeep")
    ) {
      this.applyDevices();
    }
    if (changed.has("linking") || own.has("showBadges") || own.has("showCameras")) this.redraw();
    if (this.closedChanged) {
      // What a room now closed (or open again) holds: its badges, values and people, and the
      // sheet open on it or on something in it.
      this.closedChanged = false;
      this.closeSheetsInside();
      this.applyDevices();
      this.applyLayers();
      this.applyPeople();
      this.redraw();
    }
    if ((own.has("spread") || own.has("roof")) && this.engine && this.loadedHome) {
      this.engine.setSpread(this.spread);
      this.engine.setRoof(this.roof);
      this.redraw();
    }
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
    state.look = this.lookKey ?? this.look;
    if (this.sunKey) state.sun = this.sunKey;
    state.layer = this.layer;
    if (this.layersKey) state.layers = this.layersKey;
    if (this.robotsSent) state.robots = this.robotsSent.json;
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
          : sheet.kind === "piece"
            ? `piece:${sheet.piece}`
            : sheet.kind === "person"
              ? `person:${sheet.person}`
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

  /**
   * `domotwin.show` (D-029): shows a view (`overview`, `3d`, `2d`, `walk` or a saved viewpoint's
   * name), frames an element (walking: goes there); a kiosk waiting wakes up.
   */
  show(target: { element?: string; view?: string }): void {
    this.onTouch();
    this.sheet = undefined;
    const view = target.view ? spoken(target.view) : "";
    if (view === "walk") {
      if (!this.walking) this.setWalk(true);
    } else if (view) {
      if (this.walking) this.setWalk(false);
      if (view === "2d" || view === "plan") this.setPlanView(true);
      else if (view === "3d") this.setPlanView(false);
      else if (view === "overview") {
        if (!target.element) this.overview();
      } else {
        const saved = this.savedViews.find((v) => spoken(v.name) === view);
        if (saved) this.showView(saved.id);
      }
    }
    // A private room this viewer may not see, or a piece in it, is not framed here (D-039).
    if (target.element && !this.inClosedRoom(target.element)) this.showElement(target.element);
    this.redraw();
  }

  /** Walks through the storey shown at eye level, or stops (D-029). */
  setWalk(on: boolean): void {
    const engine = this.engine;
    if (!engine) return;
    this.walkKeys.clear();
    this.walking = engine.setWalk(on);
    window.clearTimeout(this.walkHintTimer);
    this.walkHint = this.walking;
    if (this.walking) {
      this.walkHintTimer = window.setTimeout(() => {
        this.walkHint = false;
      }, WALK_HINT_MS);
      this.planView = false;
      this.sheet = undefined;
      this.layersOpen = false;
      this.viewsOpen = false;
    }
    this.redraw();
  }

  /** Whether walking can start: a storey alone, no tool on it. */
  private get walkable(): boolean {
    return (
      this.loadedHome === undefined &&
      !this.editingAny &&
      !this.linking &&
      this.summary !== undefined &&
      this.engine !== undefined
    );
  }

  /** Walking: moves as the keys held say. */
  private walkFromKeys(): void {
    let [ahead, right] = [0, 0];
    for (const key of this.walkKeys) {
      const [a, r] = WALK_KEYS[key] ?? [0, 0];
      ahead += a;
      right += r;
    }
    this.engine?.setWalkVelocity(Math.sign(ahead), Math.sign(right));
    this.redraw();
  }

  /** The kiosk: the view was touched; it wakes up. Dimmed, the touch or key that wakes it does
   * nothing else: what it was on could not be seen. */
  private readonly onTouch = (event?: Event): void => {
    this.lastTouch = performance.now();
    if (event?.type === "pointerdown") this.wakeTouch = false;
    if (this.idleNow) {
      if (this.dimmed && (event?.type === "pointerdown" || event?.type === "keydown")) {
        event.stopPropagation();
        event.preventDefault();
        this.wakeTouch = event.type === "pointerdown";
      }
      this.idleNow = false;
      this.dimmed = false;
      this.engine?.setAutoOrbit(0);
      this.redraw();
    }
  };

  /** The click of the touch that woke a dimmed kiosk. */
  private readonly onWakeClick = (event: Event): void => {
    if (!this.wakeTouch) return;
    this.wakeTouch = false;
    event.stopPropagation();
    event.preventDefault();
  };

  /** The kiosk: untouched long enough (`idle`, else a minute), back to the view it opened on,
   * turning slowly; dimmed at night unless an alert shows. */
  private readonly checkIdle = (): void => {
    const idle = this.options.idle ?? 0;
    const dim = this.options.nightDim === true;
    const orbit = this.options.orbit === true && !this.motionQuery?.matches;
    if ((idle <= 0 && !dim && !orbit) || !this.engine) return;
    if (performance.now() - this.lastTouch < (idle > 0 ? idle : IDLE_AFTER) * 1000) return;
    if (!this.idleNow) {
      this.idleNow = true;
      if (idle > 0) this.goBack();
      this.engine.setAutoOrbit(this.kioskTurn());
      this.redraw();
    }
    const dimmed = dim && this.isNight() && this.alerts.length === 0;
    if (dimmed !== this.dimmed) {
      this.dimmed = dimmed;
      this.engine.setAutoOrbit(this.kioskTurn());
      this.redraw();
    }
  };

  /** The kiosk's slow turn now (radians a second): idle, chosen, not in the dark, not in 2D. */
  private kioskTurn(): number {
    const orbit = this.options.orbit === true && !this.motionQuery?.matches;
    return this.idleNow && !this.dimmed && orbit && !this.planView ? ORBIT_SPEED : 0;
  }

  /** The kiosk: back to the view it opened on (2D or 3D, its room), the panels closed. */
  private goBack(): void {
    this.sheet = undefined;
    this.layersOpen = false;
    this.viewsOpen = false;
    this.focusedRoom = undefined;
    if (this.walking) this.setWalk(false);
    this.frameHome();
    fire(this, "domotwin-idle", undefined);
  }

  /** The view it opened on: the 2D plan or 3D, its room or the whole home. */
  frameHome(): void {
    this.setPlanView(this.options.view === "2d");
    const room = this.options.room;
    if (!room || !this.showElement(room)) this.overview();
  }

  /** Whether it is night: the sun below the horizon, else between 22:00 and 07:00. */
  private isNight(): boolean {
    const sun = this.hass?.states["sun.sun"]?.state;
    if (sun === "below_horizon") return true;
    if (sun === "above_horizon") return false;
    const hour = new Date(nowOf(this.hass)).getHours();
    return hour >= 22 || hour < 7;
  }

  /** Shows a layer (the layer menu). */
  setLayer(layer: LayerName): void {
    // Every automation of the home takes over from those of a panel.
    if (layer === "automations") this.wiresAsked = undefined;
    this.layersOpen = false;
    this.layer = layer;
    this.redraw();
  }

  /** Lights the rooms from where the sun really is (through the windows), or not. */
  setRealSun(real: boolean): void {
    this.layersOpen = false;
    this.realSun = real;
  }

  /**
   * The sheet open when rooms close or open (D-039): a room's says whether it is private now; an
   * element's in a room now closed is closed.
   */
  private closeSheetsInside(): void {
    const sheet = this.sheet;
    if (sheet?.kind === "room" && sheet.room !== undefined) {
      const closed = this.closed.has(sheet.room);
      if (closed !== (sheet.closed ?? false)) this.sheet = { ...sheet, closed };
    } else if (sheet?.kind === "controls" || sheet?.kind === "piece") {
      if (this.inClosedRoom(sheet.kind === "controls" ? sheet.element : sheet.piece)) {
        this.sheet = undefined;
      }
    }
  }

  /**
   * The private room this viewer may not see (D-039) that `id` is, is in, or is a door or a
   * window of.
   */
  private closedRoomOf(id: string): string | undefined {
    const info = this.names[id];
    return [id, info?.room, info?.beside].find(
      (room) => room !== undefined && this.closed.has(room),
    );
  }

  /** Whether `id` is a private room this viewer may not see, or something of one (D-039). */
  private inClosedRoom(id: string): boolean {
    return this.closedRoomOf(id) !== undefined;
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
    this.bubble = undefined;
    this.gestureCount += 1;
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
    // A camera's piece tapped: its view whole for a while; anything else: all faint (D-038).
    if (!this.linking) this.focusCamera(picked?.id ?? "");
    // A private room this viewer may not see, or a door of one: a tap does nothing (D-039).
    if (picked !== undefined && (this.closed.has(picked.room) || this.inClosedRoom(picked.id))) {
      this.gestures.forgetTap();
      return;
    }
    // A linked piece acts on a tap even under a wire passing over it.
    const acts = !this.linking && picked !== undefined && this.actingBinding(picked.id);
    if (this.wiresShown && !acts) {
      // Automation wires: a tap on one picks its automation out.
      const point = this.devicePoint(x, y);
      if (this.wiresElement()?.tap(point.x, point.y)) {
        this.gestures.forgetTap();
        return;
      }
    }
    if (this.networkShown && !acts) {
      // The network map: a tap on a link shows it.
      const point = this.devicePoint(x, y);
      const hit = engine.networkAt(point.x, point.y);
      if (hit) {
        const link = JSON.parse(hit) as { a: string; b: string };
        this.networkElement()?.selectLink(link.a, link.b);
        this.gestures.forgetTap();
        return;
      }
    }
    if (this.walking && !this.linking) {
      // Walking: a tap on the floor (or on what has nothing to do) goes there.
      const bound = picked && this.hass && this.actingBinding(picked.id);
      const stairs = picked && this.kinds[picked.id] === "stairs";
      if (!bound && !stairs) {
        const point = this.devicePoint(x, y);
        engine.walkTo(point.x, point.y);
        this.redraw();
        return;
      }
    }
    if (!picked) return;
    if (this.linking) {
      this.pick(picked);
      return;
    }
    const binding = this.actingBinding(picked.id);
    if (binding && this.hass) {
      engine.highlight(picked.id);
      // An action ran: a second tap soon after is a new tap, not a double tap.
      this.gestures.forgetTap();
      this.tapPiece(picked, binding);
    } else if (this.kinds[picked.id] === "stairs" && this.nextStorey()) {
      // Stairs lead to the storey above (from the top one, to the one below).
      this.gestures.forgetTap();
      this.chooseStorey(this.nextStorey() ?? "");
    } else {
      if (picked.room && engine.focusElement(picked.room)) {
        this.focusedRoom = { id: picked.room, name: this.roomName(picked) };
      }
      // A piece linked to nothing: an administrator may link it there and then.
      if (picked.type === "furniture" && this.hass?.user?.is_admin === true) {
        void this.showBubble(picked);
      }
    }
    this.redraw();
  }

  /**
   * The bubble over a piece just tapped (D-047): with its device, as it is now and its main
   * control; or, linked to nothing, the devices of its room that fit it.
   */
  private async showBubble(
    picked: PickedElement,
    binding?: ElementBinding,
    entity?: string,
  ): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    // A gesture made while the sheets load wins over this bubble.
    const gesture = this.gestureCount;
    await this.loadSheets();
    if (gesture !== this.gestureCount) return;
    const heading = this.names[picked.id]?.name ?? (picked.name || picked.id);
    let suggested: string[] = [];
    if (!binding) {
      // A piece of another storey, every storey shown: linked from its own storey.
      const info = planElement(this.plan, picked.id);
      if (!info) return;
      const roomId = this.names[picked.id]?.room ?? picked.room;
      const room = this.rooms.find((r) => r.id === roomId);
      const area = room
        ? roomArea(hass, this.bindings ?? NO_BINDINGS, room.id, room.name)
        : undefined;
      suggested = suggestions(hass, info, area, [...this.bound]).slice(0, 3);
    }
    this.bubble = {
      element: picked.id,
      heading,
      entity: binding ? (entity ?? primaryEntity(binding, hass)) : undefined,
      suggestions: suggested,
    };
    this.keepBubble();
    this.redraw();
  }

  /** The tip on what a tap does was read, or done. */
  private readonly readTapTip = (): void => {
    this.tip = false;
    readTip("tap");
  };

  /** The bubble stays a while longer after a touch. */
  private readonly keepBubble = (): void => {
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      if (this.bubbleBusy === undefined) this.bubble = undefined;
    }, BUBBLE_MS);
  };

  /** Links a piece to a device from its bubble, saved at once (administrators). */
  private async quickLink(element: string, entity: string): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.bubbleBusy = element;
    try {
      const client = DomoTwinClient.for(hass);
      const stored = await client.getBindings();
      const latest = readBindings(stored.bindings);
      // Added to what the piece has (a device it stands for, D-031), as saved now.
      const before = latest.elements[element];
      const entities = before?.entities ?? [];
      const bindings = applyLink(latest, {
        element,
        binding: {
          ...before,
          entities: entities.some((e) => e.entity_id === entity)
            ? entities
            : [...entities, { entity_id: entity }],
        },
      });
      await client.saveBindings(bindings, stored.revision);
      this.notify(this.translator.t("bubble.linked", { name: entityName(hass, entity) }));
      // Its own bubble, not another piece's tapped since.
      if (this.bubble?.element === element) this.bubble = undefined;
    } catch (error) {
      const t = this.translator;
      this.notify(t.error(isHassError(error) ? error.code : "unknown"));
    } finally {
      this.bubbleBusy = undefined;
      // Its time ran out while it saved: it goes in a while.
      if (this.bubble) this.keepBubble();
    }
  }

  /**
   * An element's binding when it has entities to act on. A piece that only stands for a device
   * (a Zigbee coordinator on the network map, D-031) taps, holds and is walked to as an unlinked
   * one.
   */
  private actingBinding(id: string): ElementBinding | undefined {
    const binding = this.bindings?.elements[id];
    return binding && binding.entities.length > 0 ? binding : undefined;
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
    this.bubble = undefined;
    this.gestureCount += 1;
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
    // A private room this viewer may not see (or a door of one): its panel says so, and nothing
    // else (D-039).
    const closed = this.closed.has(picked.room) ? picked.room : this.closedRoomOf(picked.id);
    if (closed !== undefined) {
      const name =
        closed === picked.room
          ? this.roomName(picked)
          : (this.rooms.find((r) => r.id === closed)?.name ?? closed);
      void this.openRoom(closed, name);
      this.redraw();
      return;
    }
    const binding = this.actingBinding(picked.id);
    if (binding && this.hass) {
      this.engine?.highlight(picked.id);
      void this.act(holdAction(binding), binding, picked);
    } else if (picked.type === "furniture" && this.hasPieceSheet(picked.id)) {
      this.engine?.highlight(picked.id);
      const room = picked.room ? { id: picked.room, name: this.roomName(picked) } : undefined;
      void this.openPiece(picked.id, picked.name, room);
    } else if (picked.room) {
      void this.openRoom(picked.room, this.roomName(picked));
    }
    this.redraw();
  }

  /**
   * Whether a piece linked to nothing has a sheet of its own (D-033): an upkeep card to show, or
   * an administrator to write one. Others still open the room's panel.
   */
  private hasPieceSheet(id: string): boolean {
    const upkeep = this.upkeep;
    if (!upkeep) return false;
    return upkeep.pieces[id] !== undefined || this.hass?.user?.is_admin === true;
  }

  /** A piece's own sheet: its upkeep card, and its room's panel a tap away. */
  private async openPiece(id: string, name: string, room?: FocusedRoom): Promise<void> {
    await this.loadSheets();
    const sheet: Sheet = { kind: "piece", heading: name || id, piece: id };
    if (room) sheet.room = room;
    this.sheet = sheet;
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

  /** The network map can be offered: to administrators, with ZHA set up (D-031). */
  private get networkAllowed(): boolean {
    return networkAvailable(this.hass);
  }

  /**
   * The layer shown: the one chosen, but no network map where it cannot be (a card set to it,
   * seen by someone who is not an administrator, or without ZHA).
   */
  private get shownLayer(): LayerName {
    if (this.layer === "network" && !this.networkAllowed) return "off";
    if (this.layer === "automations" && !automationsAvailable(this.hass)) return "off";
    if (this.layer === "upkeep" && !this.upkeep) return "off";
    return this.layer;
  }

  /** The rooms' names are drawn: where no layer shows a value (the storeys' labels take their
   * place when every storey is shown). */
  private get namesShown(): boolean {
    return this.options.names !== false && !this.valueLayer && !this.loadedHome;
  }

  /** The layer shown puts values on the home (a heatmap, the power drawn) and has a legend. */
  private get valueLayer(): boolean {
    const layer = this.shownLayer;
    return layer !== "off" && layer !== "network" && layer !== "automations" && layer !== "upkeep";
  }

  /**
   * The automation wires shown (D-032): those a panel asked for, else every automation's when
   * their layer is chosen (`ids` undefined); none while a tool is at work over the view, nor
   * while walking (at eye level the wires would cross the view).
   */
  private get wiresShown(): { ids?: string[]; reads?: WiresReads } | undefined {
    if (this.editingAny || this.linking || this.walking) return undefined;
    if (this.wiresAsked) return this.wiresAsked;
    return this.shownLayer === "automations" ? {} : undefined;
  }

  /** The automation wires over the view, while they are shown. */
  private wiresElement(): WiresView | null {
    return this.renderRoot.querySelector<WiresView>("domotwin-wires");
  }

  /** A panel asked for the wires of its automations (and hands what it read of them). */
  private readonly onShowWires = (event: Event): void => {
    this.sheet = undefined;
    const { ids, reads } = (event as CustomEvent<{ ids: string[]; reads?: WiresReads }>).detail;
    this.wiresAsked = { ids, reads };
  };

  /** The wires' close button: those a panel asked for go, else their layer. */
  private readonly onWiresClose = (): void => {
    if (this.wiresAsked) this.wiresAsked = undefined;
    else this.setLayer("off");
  };

  /**
   * The network map is shown: chosen, allowed, no tool at work over the view, and not walking
   * (at eye level the map has nothing to show, and its sheet would cover the walk pad).
   */
  private get networkShown(): boolean {
    return (
      this.layer === "network" &&
      this.networkAllowed &&
      !this.editingAny &&
      !this.linking &&
      !this.walking
    );
  }

  /** The network map over the view, while it is shown. */
  private networkElement(): NetworkMap | null {
    return this.renderRoot.querySelector<NetworkMap>("domotwin-network");
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
    // Labels and badges where the home now is.
    this.readOverlays(engine);
  }

  /** The GPU drawing the view, as WebGL names it (the measure, D-053), when it says. */
  renderer(): string | undefined {
    return this.engine?.renderer;
  }

  /**
   * Whether the view draws the demo house in `look`, one storey of it (the measure, D-053):
   * `failed` when it cannot draw at all.
   */
  readyFor(look: string): "ready" | "waiting" | "failed" {
    if (this.engineState === "failed" || this.engineState === "unsupported") return "failed";
    const ready =
      this.engineState === "ready" &&
      this.summary !== undefined &&
      this.loadedHome === undefined &&
      this.hass?.demo === true &&
      (this.lookKey ?? this.look).startsWith(look);
    return ready ? "ready" : "waiting";
  }

  /**
   * Forces consecutive frames and measures them: `length` frames of the engine alone (the
   * frame-time smoke test), or for a time as a frame is drawn in use, its labels and badges read
   * and its resolution adapted, the camera turning or something changing at each frame (D-053).
   * The view draws no frame of its own meanwhile. A run during which the page was hidden says
   * so (`interrupted`): its intervals mean nothing.
   */
  async benchmark(length: number | BenchmarkRun = 120): Promise<FrameStats> {
    const engine = this.engine;
    if (!engine) throw new Error("engine not ready");
    const run = typeof length === "number" ? undefined : length;
    const count = typeof length === "number" ? length : Number.POSITIVE_INFINITY;
    const cpu: number[] = [];
    const intervals: number[] = [];
    let first: number | undefined;
    let last: number | undefined;
    let frames = 0;
    let interrupted = document.visibilityState !== "visible";
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") interrupted = true;
    };
    try {
      document.addEventListener("visibilitychange", onVisibility);
      this.scheduler?.setHeld(true);
      if (run?.turn) engine.setAutoOrbit(run.turn);
      for (;;) {
        const time = await nextFrame();
        // The view left the page, or its engine was lost meanwhile.
        if (this.engine !== engine) throw new Error("engine lost");
        first ??= time;
        if (run ? time - first >= run.ms : frames >= count) break;
        if (last !== undefined) intervals.push(time - last);
        last = time;
        run?.step?.((time - first) / run.ms);
        engine.invalidate();
        const start = performance.now();
        engine.frame(time);
        const cost = performance.now() - start;
        if (run && (run.turn !== undefined || this.labelsDue || engine.moving)) {
          // As in use: the labels and badges read when the camera moves or something changed.
          this.labelsDue = false;
          this.readOverlays(engine);
        }
        cpu.push(run ? performance.now() - start : cost);
        // As in use, the resolution follows what frames cost.
        if (run) this.adaptResolution(time, cost, true);
        frames += 1;
      }
    } finally {
      document.removeEventListener("visibilitychange", onVisibility);
      this.scheduler?.setHeld(false);
      // The kiosk's own turn again, if it was turning.
      if (run?.turn && this.engine === engine) engine.setAutoOrbit(this.kioskTurn());
      // The labels and badges where the camera now is, the view's own frames again.
      this.redraw();
    }
    return {
      frames,
      wasmMemoryBytes: wasmMemoryBytes() ?? 0,
      cpuMedianMs: percentile(cpu, 50),
      cpuP95Ms: percentile(cpu, 95),
      intervalMedianMs: percentile(intervals, 50),
      intervalP95Ms: percentile(intervals, 95),
      ...(interrupted ? { interrupted } : {}),
    };
  }

  /** The home as a measure starts from it (D-053): in 3D, not walking, framed whole. */
  restView(): void {
    if (this.walking) this.setWalk(false);
    this.setPlanView(false);
    this.overview();
  }

  private async startEngine(): Promise<void> {
    if (this.canvas) return;
    const stage = this.renderRoot.querySelector<HTMLElement>(".stage");
    if (!stage) return;
    this.contextLost = false;
    window.clearTimeout(this.contextTimer);
    this.stage = stage;
    const generation = ++this.generation;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    stage.append(canvas);
    this.canvas = canvas;
    this.engineState = "loading";
    this.resize(stage);

    let engine: DomoTwinEngine;
    try {
      // Not built at all when the view was stopped meanwhile (a card moved while it loads).
      engine = await DomoTwinEngine.create(canvas, () => generation === this.generation);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof EngineError && error.code === "context_lost") {
        this.loseEngine();
        return;
      }
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
    this.camerasShown = undefined;
    this.closedSent = undefined;
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
    this.lookKey = undefined;
    this.applyTheme();
    this.applyLook();
    this.applyLighting();
    this.lightTimer = window.setInterval(() => {
      this.applyLighting();
      // A new day where the home is (upkeep falls due), in a home where nothing changes.
      this.applyDevices();
    }, LIGHT_REFRESH_MS);
    this.states.reset();
    this.modelsLoading.clear();
    this.modelsFailed.clear();
    this.applyBindings();
    this.loadedPlan = undefined;
    this.loadedLayout = undefined;
    this.loadedHome = undefined;
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
    // The engine gives its context back. While it is still coming, its canvas has none: the
    // engine is then not built at all.
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.engine?.dispose();
    this.canvas?.remove();
    this.scheduler = undefined;
    this.resizeObserver = undefined;
    this.intersectionObserver = undefined;
    this.engine = undefined;
    this.canvas = undefined;
    this.engineState = "idle";
  }

  /**
   * The view's WebGL context was lost (a GPU reset, the browser's limit on contexts, a phone that
   * put the page away): what was drawn is gone, so the engine starts again on a fresh canvas. An
   * engine still coming finds its context lost itself (`context_lost`).
   */
  private readonly onContextLost = (event: Event): void => {
    if (event.target === this.canvas && this.engine) this.loseEngine();
  };

  private loseEngine(): void {
    this.parkPlanEditor();
    this.stopEngine();
    this.contextLost = true;
    this.startAgain();
  }

  /**
   * Starts the engine again after a lost context, once the page is shown (a hidden page may lose
   * a new one at once) and once a minute at most: lost again within the minute, the GPU is
   * failing, and the view says so until the minute is past.
   */
  private startAgain(): void {
    window.clearTimeout(this.contextTimer);
    if (!this.contextLost || !this.isConnected || document.visibilityState !== "visible") return;
    const wait =
      this.contextRestart === undefined
        ? 0
        : this.contextRestart + CONTEXT_RESTART_MS - performance.now();
    if (wait > 0) {
      this.engineState = "failed";
      this.contextTimer = window.setTimeout(() => this.startAgain(), wait);
      return;
    }
    this.contextRestart = performance.now();
    void this.startEngine();
  }

  /** Draws a frame and adapts the resolution to how long frames take. */
  private drawFrame(engine: DomoTwinEngine, time: number): boolean {
    this.flushDrag();
    this.planEditor?.flush();
    // What the cameras see is drawn by the engine on the floor (D-038), left out while editing
    // or linking: told before the frame, so that the frame shows it.
    const cameras = this.showCameras && !this.editingAny && !this.linking;
    if (cameras !== this.camerasShown) {
      this.camerasShown = cameras;
      engine.setCameraViews(cameras);
    }
    // The rooms drawn closed (D-039): built again when they change, with the models come so far,
    // and the storeys' pictures with them.
    if (this.closedKey !== this.closedSent) {
      this.closedSent = this.closedKey;
      if (engine.setPrivateRooms([...this.closed])) {
        this.labelsDue = true;
        this.picturesDue = this.loadedHome !== undefined;
        // The 3D files of the pieces of a room open again.
        this.loadModels();
      }
    }
    if (this.modelsCame) {
      // Every mesh that came since the last frame, in one rebuild.
      this.modelsCame = false;
      const started = performance.now();
      if (engine.showModels()) {
        this.modelTimes.drawMs.push(performance.now() - started);
        // The storeys' pictures show the models too.
        this.picturesDue = this.loadedHome !== undefined;
      }
      const over = engine.modelsOverBudget;
      if (over > 0) this.notify(this.translator.tp("view.models_over_budget", over));
    }
    if (this.picturesDue && this.loadedHome) {
      // A picture of each storey of the home shown whole, in the look shown.
      this.picturesDue = false;
      this.pictures = this.loadedHome.map((_, i) =>
        pictureUrl(engine.storeyPicture(i, PICTURE_WIDTH, PICTURE_HEIGHT)),
      );
    }
    const movingBefore = engine.moving;
    const start = performance.now();
    const more = engine.frame(time);
    const cost = performance.now() - start;
    // The home's first picture (not the demo house's), for the measure (D-053).
    if (this.firstPictureAt === undefined && this.summary && this.hass && !this.hass.demo) {
      this.firstPictureAt = performance.now();
    }
    const movingAfter = engine.moving;
    // The values and badges move with the camera (the kiosk's turn too), or change: not with
    // the layers' own animation.
    if (this.labelsDue || movingBefore || movingAfter || engine.orbiting) {
      this.labelsDue = false;
      this.readOverlays(engine);
    }
    // The layers' animation alone runs at 24 frames per second; camera moves, wall animations
    // and fades at the display's rate (a gesture sets it back at once, see `apply`).
    if (engine.walking !== this.walking) this.walking = engine.walking;
    // The kiosk's turn goes slower still.
    const slow = engine.orbiting ? ORBIT_FRAME_MS : LAYER_FRAME_MS;
    this.scheduler?.setMinInterval(
      more && (engine.layersAnimating || engine.orbiting) && !engine.moving ? slow : 0,
    );
    this.adaptResolution(time, cost, more);
    return more;
  }

  /**
   * The drawing buffer's scale follows what frames cost: lower while they are slow, back up when
   * they are fast. Only animations tell: a single frame after an idle period is not
   * representative.
   */
  private adaptResolution(time: number, cost: number, animating: boolean): void {
    this.frameCost = this.frameCost === 0 ? cost : this.frameCost * 0.8 + cost * 0.2;
    if (animating && time - this.lastResolutionChange > 600 && this.stage) {
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
  }

  private resize(stage: HTMLElement): void {
    this.toggleAttribute("narrow", stage.clientWidth < NARROW_WIDTH);
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
   * The look (D-027): the view's option, else the home's, else `auto`, which follows Home
   * Assistant's dark mode (neon when dark, day otherwise). The overlays' colours follow `look`.
   */
  private updateLook(): void {
    this.look = resolveLook(this.options.theme ?? this.homeTheme, this.hass);
    this.accent = this.options.accent ?? this.homeAccent ?? defaultAccent(this.look);
    this.style.setProperty("--domotwin-accent", this.accent);
  }

  /** Draws the look found by `updateLook`, when it changed. */
  private applyLook(): void {
    const engine = this.engine;
    const key = `${this.look} ${this.accent}`;
    if (!engine || key === this.lookKey) return;
    this.lookKey = key;
    engine.setTheme(this.look, this.accent);
    this.picturesDue = this.loadedHome !== undefined;
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
        const now = new Date(nowOf(this.hass));
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
          closed: this.closed,
        })
      : undefined;
    const json = layers?.json ?? "{}";
    if (json !== this.layersKey) {
      this.layersKey = json;
      engine.setLayers(json);
      this.redraw();
    }
    engine.setPowerLayer(this.layer === "power");
    engine.setUpkeepLayer(this.shownLayer === "upkeep");
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
      this.names[element.id] = {
        name: element.name || element.id,
        type: element.type,
        ...(element.room ? { room: element.room } : {}),
        ...(element.beside ? { beside: element.beside } : {}),
      };
    }
    this.applyDevices();
  }

  /** Works out the devices' and upkeep's badges; the view changes only when they did. */
  private applyDevices(): void {
    const hass = this.hass;
    this.applyUpkeep();
    const devices =
      hass && this.bindings
        ? deviceBadges(hass, this.bindings, this.kinds)
        : new Map<string, Badge[]>();
    const style = hass ? timeStyle(hass) : undefined;
    const now = new Date(nowOf(hass));
    const later =
      style && this.bindings
        ? scheduleBadges(this.bindings, this.schedules, (at) => whenText(at, now, style))
        : new Map<string, Badge[]>();
    const badges = mergeBadges(mergeBadges(devices, upkeepBadges(this.standings)), later);
    // None for what a private room holds, nor for its doors and windows (D-039).
    for (const id of badges.keys()) {
      if (this.inClosedRoom(id)) badges.delete(id);
    }
    const key = JSON.stringify([...badges]);
    if (key === this.badgesKey) return;
    this.badgesKey = key;
    this.badges = badges;
    this.redraw();
  }

  /**
   * Who is shown where (D-034): the people placed, at home and not hidden, from their room
   * sensors; nobody when the card says so. The view changes only when they did.
   */
  private readPeople(): void {
    const hass = this.hass;
    const people =
      hass && this.options.people !== false
        ? outOfSight(peopleShown(this.people, hass), this.closed)
        : ([] as PersonShown[]);
    const text = JSON.stringify(people);
    if (text !== this.shownPeopleText) {
      this.shownPeopleText = text;
      this.shownPeople = people;
    }
    // Someone's devices only where they could be shown: never without the people's settings (not
    // loaded, an older integration), or on a card without people.
    const settings = this.people;
    const hidden = new Set(settings?.hidden ?? []);
    const toldAny =
      settings !== undefined && (settings.shown !== "admins" || hass?.user?.is_admin === true);
    if (hass && this.locatedFrom?.entities !== hass.entities) {
      this.locatedFrom = { entities: hass.entities, sensors: locatedSensors(hass) };
    }
    const located =
      hass && this.options.people !== false
        ? outOfSight(
            locatedShown(
              hass,
              (person) => toldAny && !hidden.has(person),
              this.locatedFrom?.sensors ?? [],
            ),
            this.closed,
          )
        : [];
    const locatedText = JSON.stringify(located);
    if (locatedText !== this.locatedText) {
      this.locatedText = locatedText;
      this.located = located;
    }
  }

  /** Tells the engine what the robot vacuums do (D-049), when that or the engine changed. */
  private applyRobots(): void {
    const engine = this.engine;
    if (!engine) return;
    let docks = this.docks;
    if (docks?.bindings !== this.bindings || docks?.kinds !== this.kinds) {
      docks = {
        bindings: this.bindings,
        kinds: this.kinds,
        docks: robotDocks(this.bindings, this.kinds),
      };
      this.docks = docks;
    }
    // At rest on their docks while the plan, its pieces or its links are edited.
    const shown = this.editingAny || this.linking ? [] : robotsShown(this.hass, docks.docks);
    const json = JSON.stringify(shown);
    if (this.robotsSent?.engine === engine && this.robotsSent.json === json) return;
    this.robotsSent = { engine, json };
    engine.setRobots(json);
    this.redraw();
  }

  /** Tells the engine who is in which room, when that or the engine changed. */
  private applyPeople(): void {
    const engine = this.engine;
    if (!engine) return;
    // Nobody stands in the way while the plan, its pieces or its links are edited.
    const shown = this.editingAny || this.linking ? [] : this.shownPeople;
    const json = peopleJson(shown, this.people?.look ?? "figure");
    if (this.peopleSent?.engine === engine && this.peopleSent.json === json) return;
    this.peopleSent = { engine, json };
    engine.setPeople(json);
    this.redraw();
  }

  /** A person's sheet (D-034). */
  private async openPerson(id: string): Promise<void> {
    const person = this.shownPeople.find((p) => p.id === id);
    if (!person) return;
    await this.loadSheets();
    this.sheet = { kind: "person", heading: person.name, person: id };
  }

  /**
   * Works out where each upkeep card stands today, where the home is (D-033), when the cards, the
   * day or the engine changed, and tells the engine for the upkeep layer.
   */
  private applyUpkeep(): void {
    const engine = this.engine;
    const upkeep = this.upkeep;
    if (!engine || !upkeep) {
      // Once: a new empty object would render the view again at every update.
      if (this.standingsFrom) this.standings = {};
      this.standingsFrom = undefined;
      return;
    }
    // The date is read again at most once a minute (of its clock: the demo house's goes back
    // when it is left, D-050).
    const now = nowOf(this.hass);
    if (Math.abs(now - this.todayRead) > 60_000) {
      this.todayRead = now;
      this.today = todayIn(this.hass?.config?.time_zone, new Date(now));
    }
    const from = this.standingsFrom;
    if (from?.upkeep === upkeep && from.today === this.today && from.engine === engine) return;
    this.standingsFrom = { upkeep, today: this.today, engine };
    this.standings = readStandings(upkeepStates(JSON.stringify(upkeep), this.today));
    engine.setUpkeep(JSON.stringify(upkeepShades(this.standings)));
    this.redraw();
  }

  /** Reads where the layer's values, the rooms' names and the badges go now. */
  private readOverlays(engine: DomoTwinEngine): void {
    this.planEditor?.reproject();
    const canvas = this.canvas;
    if (canvas && this.networkShown) {
      this.networkElement()?.reproject(Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width));
    }
    if (canvas && this.wiresShown) {
      this.wiresElement()?.reproject(Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width));
    }
    if (this.valueLayer) this.readLabels(engine);
    const shown = !this.editingAny && !this.linking;
    const names = shown && this.namesShown ? engine.roomLabels() : "[]";
    if (names !== this.roomNamesText) {
      this.roomNamesText = names;
      this.roomNames = JSON.parse(names) as typeof this.roomNames;
    }
    const ids = shown && this.showBadges ? [...this.badges.keys()] : [];
    if (this.bubble && !ids.includes(this.bubble.element)) ids.push(this.bubble.element);
    const points = ids.length > 0 ? engine.elementPoints(JSON.stringify(ids)) : "{}";
    if (points !== this.pointsText) {
      this.pointsText = points;
      this.badgePoints = JSON.parse(points) as Record<string, [number, number]>;
    }
    // Where the people's names go (D-034).
    const placed = shown && this.shownPeople.some((p) => p.room !== undefined);
    const people = placed ? engine.peoplePoints() : "[]";
    if (people !== this.personPointsText) {
      this.personPointsText = people;
      this.personPoints = JSON.parse(people) as typeof this.personPoints;
    }
    // Where each storey of the home shown whole is.
    const storeys = this.loadedHome ? engine.storeyLabels() : [];
    const storeysText = JSON.stringify(storeys);
    if (storeysText !== this.storeyLabelsText) {
      this.storeyLabelsText = storeysText;
      this.storeyLabels = storeys;
    }
  }

  /**
   * A tap on an element's badges: the element's tap; where one says what upkeep is due (D-033),
   * its card (with its controls, for a linked piece).
   */
  private tapElement(id: string): void {
    this.sheet = undefined;
    this.bubble = undefined;
    this.gestureCount += 1;
    if (this.inClosedRoom(id)) return;
    // A camera's badge: its view whole for a while; another badge: all faint (D-038).
    this.focusCamera(id);
    const binding = this.actingBinding(id);
    const hass = this.hass;
    const upkeep = this.badges
      .get(id)
      ?.some(
        (b) =>
          b.kind === "upkeep_due" || b.kind === "upkeep_overdue" || b.kind === "warranty_ending",
      );
    if (upkeep && this.upkeep?.pieces[id]) {
      const info = this.names[id];
      const name = info?.name ?? id;
      const room = info?.room ?? "";
      if (binding) {
        void this.openControls(binding, { id, type: "furniture", name, room });
      } else {
        const named = this.rooms.find((r) => r.id === room);
        void this.openPiece(id, name, named ? { id: room, name: named.name } : undefined);
      }
      return;
    }
    if (!binding || !hass) return;
    const info = this.names[id];
    const picked: PickedElement = {
      id,
      type: (info?.type ?? "furniture") as PickedElement["type"],
      name: info?.name ?? id,
      room: "",
    };
    // A clock tapped: the actions waiting, in the sheet, rather than the device switched.
    if (this.badges.get(id)?.some((b) => b.kind === "scheduled")) {
      void this.openControls(binding, picked);
      return;
    }
    this.engine?.highlight(id);
    // An action ran: a second tap soon after is a new tap, not a double tap.
    this.gestures.forgetTap();
    this.tapPiece(picked, binding);
    this.redraw();
  }

  /**
   * A linked piece tapped, or its badge (D-047): its tap action, then its bubble: DomoTwin's
   * controls are the bubble itself (a long press opens them all), a switch or an action shows
   * what it did.
   */
  private tapPiece(picked: PickedElement, binding: ElementBinding): void {
    const hass = this.hass;
    if (!hass) return;
    this.bubble = undefined;
    this.gestureCount += 1;
    const action = tapAction(binding, hass);
    if (this.tip) this.readTapTip();
    if (action.action !== "controls") void this.act(action, binding, picked);
    if (["controls", "toggle", "perform-action", "call-service"].includes(action.action)) {
      // The device the action was aimed at, when it is one of the piece's; its main one otherwise.
      const target = action.target?.entity_id;
      const aimed = action.entity_id ?? (typeof target === "string" ? target : undefined);
      const linked = binding.entities.some((e) => e.entity_id === aimed);
      void this.showBubble(picked, binding, linked ? aimed : undefined);
    }
  }

  /** A camera tapped: its view drawn whole for a while (D-038); anything else: all faint. */
  private focusCamera(id: string): void {
    const engine = this.engine;
    if (!engine) return;
    clearTimeout(this.cameraFocusTimer);
    const whole = engine.focusCamera(id);
    if (whole > 0) this.cameraFocusTimer = setTimeout(() => this.redraw(), whole + 50);
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
      (!force &&
        this.plan === this.loadedPlan &&
        this.layout === this.loadedLayout &&
        this.home === this.loadedHome)
    ) {
      return;
    }
    // Every storey at once (D-028), with several.
    const home = this.home && this.home.length > 1 ? this.home : undefined;
    const sameHome =
      (this.loadedPlan !== undefined && this.loadedPlan !== null) || this.loadedHome !== undefined;
    // The camera stays for the same home saved again; a storey alone and every storey at once
    // are framed afresh.
    const keep = sameHome && (this.loadedHome !== undefined) === (home !== undefined);
    this.loadedPlan = this.plan;
    this.loadedLayout = this.layout;
    this.loadedHome = this.home;
    if (!sameHome) {
      this.sheet = undefined;
      this.focusedRoom = undefined;
      this.wiresAsked = undefined;
    }
    this.summary = undefined;
    this.loadError = undefined;
    this.savedViews = [];
    this.rooms = home ? home.flatMap((storey) => planRooms(storey.plan)) : planRooms(this.plan);
    this.storeyLabels = [];
    this.storeyLabelsText = "[]";
    this.pictures = [];
    if (!home && !this.plan) return;
    // The rooms drawn closed (D-039), before the scene is built rather than built again for them.
    if (this.closedKey !== this.closedSent) {
      this.closedSent = this.closedKey;
      this.engine.setPrivateRooms([...this.closed]);
    }
    try {
      if (home) {
        this.engine.setSpread(this.spread);
        this.engine.setRoof(this.roof);
        this.summary = this.engine.loadStoreys(home, keep);
        this.picturesDue = true;
      } else {
        this.summary = this.engine.loadPlan(
          JSON.stringify(this.plan),
          keep,
          this.layout ? JSON.stringify(this.layout) : undefined,
        );
        const refused = this.summary.layoutRefused ?? 0;
        if (refused > 0) this.notify(this.translator.tp("view.layout_refused", refused));
      }
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
    // Something to tap: the tip on what a tap does, once (not on a kiosk without buttons).
    this.tip =
      this.bound.size > 0 && this.options.tools !== false && !this.linking && !tipRead("tap");
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
      this.notify(failureText(this.translator, error));
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
    const sheet: Sheet = {
      kind: "controls",
      heading,
      element: picked.id,
      entities: binding.entities.map((entity) => entity.entity_id),
    };
    if (binding.device) sheet.device = binding.device;
    // A piece's upkeep card (D-033) shows with its controls.
    if (picked.type === "furniture") sheet.piece = picked.id;
    // Its room's area: the automations of the room take part in it too.
    const room = picked.room;
    const roomName = this.rooms.find((r) => r.id === room)?.name ?? "";
    const area =
      hass && room ? roomArea(hass, this.bindings ?? NO_BINDINGS, room, roomName) : undefined;
    if (area) sheet.area = area;
    this.sheet = sheet;
  }

  private async openRoom(id: string, name: string): Promise<void> {
    await this.loadSheets();
    const hass = this.hass;
    const sheet: Sheet = { kind: "room", heading: name, room: id };
    if (this.closed.has(id)) sheet.closed = true;
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
    if (this.gestures.active === 0) {
      this.hover(event);
      return;
    }
    this.apply(this.gestures.move(this.sample(event)));
  };

  /**
   * The mouse over the scene: a hand over what a tap acts on (D-047), a piece linked to nothing
   * for an administrator, anything while linking. Looked up once a frame at most.
   */
  private hover(event: PointerEvent): void {
    if (event.pointerType !== "mouse") return;
    if (this.editingAny) {
      this.stage?.classList.remove("acts");
      return;
    }
    this.hoverAt = { x: event.offsetX, y: event.offsetY };
    if (this.hoverFrame !== 0) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const at = this.hoverAt;
      const stage = this.stage;
      if (!at || !stage) return;
      const picked = this.elementAt(at.x, at.y);
      const acts =
        picked !== undefined &&
        !this.closed.has(picked.room) &&
        (this.linking ||
          this.actingBinding(picked.id) !== undefined ||
          (picked.type === "furniture" && this.hass?.user?.is_admin === true));
      stage.classList.toggle("acts", acts);
    });
  }

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
    if (this.walking) {
      // Where the keys are, whatever the layout (W on QWERTY is Z on AZERTY).
      const key = event.code;
      if (event.key === "Escape") {
        event.preventDefault();
        this.setWalk(false);
        return;
      }
      if (WALK_KEYS[key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.walkKeys.add(key);
        this.walkFromKeys();
        return;
      }
    }
    // Walking, → turns right: the scene goes the other way than a drag would take it.
    const turn = this.walking ? -KEY_STEP : KEY_STEP;
    const keys: Record<string, Gesture | undefined> = {
      ArrowLeft: { kind: event.shiftKey ? "pan" : "drag", dx: -turn, dy: 0 },
      ArrowRight: { kind: event.shiftKey ? "pan" : "drag", dx: turn, dy: 0 },
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

  /** Walking: a key let go. */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.walkKeys.delete(event.code)) this.walkFromKeys();
  };

  /** Walking: the view lost the keys (focus elsewhere); the walker stops. */
  private readonly onBlur = (): void => {
    if (this.walkKeys.size === 0) return;
    this.walkKeys.clear();
    this.walkFromKeys();
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

  /** A sheet or the voice dialog shown takes the focus, and gives it back when it goes. */
  private followDialogs(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("sheet") && !changed.has("voiceHelp")) return;
    // The voice dialog stands over a sheet: it has the focus first.
    const root = this.renderRoot;
    this.dialogs.update(
      root.querySelector("domotwin-voice") ?? root.querySelector(VIEW_SHEETS) ?? undefined,
    );
  }

  /** The menus take the focus when they open, and give it back to their button after a choice. */
  private followMenus(changed: Map<PropertyKey, unknown>): void {
    for (const [open, menu, opener] of [
      ["viewsOpen", "views-menu", "views"],
      ["layersOpen", "layer-menu", "layers"],
    ] as const) {
      if (!changed.has(open)) continue;
      const root = this.renderRoot;
      if (this[open]) focusMenu(root.querySelector<HTMLElement>(`[data-testid="${menu}"]`));
      else if (changed.get(open) === true) {
        focusBack(root.querySelector<HTMLElement>(`[data-testid="${opener}"]`));
      }
    }
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
    const title = this.summary?.name || t.t("view.untitled");
    return html`<div
        class="stage"
        tabindex=${ready ? "0" : "-1"}
        role=${ready ? "application" : nothing}
        aria-label=${ready ? t.t("view.canvas_label", { title }) : nothing}
        aria-describedby=${ready ? "stage-keys" : nothing}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @wheel=${this.onWheel}
        @keydown=${this.onKeyDown}
        @keyup=${this.onKeyUp}
        @blur=${this.onBlur}
        @contextmenu=${(event: Event) => {
          event.preventDefault();
        }}
      ></div>
      <p id="stage-keys" class="hidden-text">${t.t("view.keys")}</p>
      ${ready ? this.renderRoomList() : nothing} ${ready ? this.renderLabels() : nothing}
      ${ready ? this.renderRoomNames() : nothing} ${ready ? this.renderBadges() : nothing}
      ${ready ? this.renderPeople() : nothing} ${ready ? this.renderStoreyLabels() : nothing}
      ${ready ? this.renderPictures() : nothing} ${this.renderGuides()} ${this.renderPlanHandles()}
      ${this.renderOverlay()} ${ready ? this.renderLegend() : nothing}
      ${ready ? this.renderAlerts() : nothing} ${ready ? this.renderWalkPad() : nothing}
      ${ready ? this.renderNetwork() : nothing} ${ready ? this.renderUpkeep() : nothing}
      ${ready ? this.renderWires() : nothing}
      ${ready && this.options.tools !== false ? this.renderTools() : nothing}
      ${ready ? this.renderBubble() : nothing} ${ready ? this.renderSheet() : nothing}
      ${
        // Not over a framed room's buttons, nor under a notice.
        ready && this.tip && !this.sheet && !this.editingAny && !this.focusedRoom && !this.notice
          ? this.renderTip()
          : nothing
      }
      ${
        this.voiceHelp
          ? html`<domotwin-voice
              .hass=${this.hass}
              .mode=${this.voiceHelp}
              @domotwin-close=${() => (this.voiceHelp = undefined)}
            ></domotwin-voice>`
          : nothing
      }
      ${this.dimmed ? html`<div class="dim" data-testid="dim" aria-hidden="true"></div>` : nothing}
      ${
        this.notice
          ? html`<div class="notice glass" role="alert" data-testid="notice">${this.notice}</div>`
          : nothing
      }`;
  }

  /**
   * The upkeep layer's list (D-033) is shown: chosen, no tool at work over the view, and not
   * walking (its sheet would cover the walk pad).
   */
  private get upkeepShown(): boolean {
    return this.shownLayer === "upkeep" && !this.editingAny && !this.linking && !this.walking;
  }

  /** The elements outside the private rooms this viewer may not see (D-039), worked out once. */
  private openNames(): ElementNames {
    if (this.closed.size === 0) return this.names;
    const from = this.openNamesFrom;
    if (from?.names === this.names && from.closed === this.closed) return from.open;
    const open = Object.fromEntries(
      Object.entries(this.names).filter(([id]) => !this.inClosedRoom(id)),
    );
    this.openNamesFrom = { names: this.names, closed: this.closed, open };
    return open;
  }

  /** The upkeep layer's list: its module is loaded the first time it is shown. */
  private renderUpkeep(): TemplateResult | typeof nothing {
    if (!this.upkeepShown) return nothing;
    if (!this.upkeepLoaded) {
      this.upkeepModule ??= import("./upkeep-panel").then(
        () => (this.upkeepLoaded = true),
        () => (this.upkeepModule = undefined),
      );
      return nothing;
    }
    return html`<domotwin-upkeep-list
      .hass=${this.hass}
      .upkeep=${this.upkeep}
      .standings=${this.standings}
      .names=${this.openNames()}
      @domotwin-show-element=${(event: CustomEvent<string>) => {
        this.showElement(event.detail);
      }}
      @domotwin-close=${() => {
        this.setLayer("off");
      }}
    ></domotwin-upkeep-list>`;
  }

  /** The network map (D-031): its module is loaded the first time it is shown. */
  private renderNetwork(): TemplateResult | typeof nothing {
    if (!this.networkShown) return nothing;
    if (!this.networkLoaded) {
      this.networkModule ??= import("./network-panel").then(
        () => (this.networkLoaded = true),
        () => (this.networkModule = undefined),
      );
      return nothing;
    }
    return html`<domotwin-network
      .hass=${this.hass}
      .engine=${this.engine}
      .bindings=${this.bindings}
      .names=${this.names}
      .placeable=${this.placeDevices}
      @domotwin-redraw=${() => {
        this.redraw();
      }}
    ></domotwin-network>`;
  }

  /** The automation wires (D-032): their module is loaded the first time they are shown. */
  private renderWires(): TemplateResult | typeof nothing {
    const shown = this.wiresShown;
    if (!shown) return nothing;
    if (!this.wiresLoaded) {
      this.wiresModule ??= import("./automation-wires").then(
        () => (this.wiresLoaded = true),
        () => (this.wiresModule = undefined),
      );
      return nothing;
    }
    return html`<domotwin-wires
      .hass=${this.hass}
      .engine=${this.engine}
      .bindings=${this.bindings}
      .rooms=${this.rooms}
      .names=${this.names}
      .ids=${shown.ids}
      .known=${shown.reads}
      @domotwin-redraw=${() => {
        this.redraw();
      }}
      @domotwin-wires-close=${this.onWiresClose}
    ></domotwin-wires>`;
  }

  /** Walking: the pad that walks while held, and how to look around and go somewhere. */
  private renderWalkPad(): TemplateResult | typeof nothing {
    if (!this.walking) return nothing;
    const t = this.translator;
    const stop = (): void => {
      this.engine?.setWalkVelocity(0, 0);
    };
    const pad = (dir: "ahead" | "back" | "left" | "right", path: string, v: [number, number]) =>
      html`<button
        class="pad-${dir}"
        data-testid=${`walk-${dir}`}
        title=${t.t(`walk.${dir}`)}
        aria-label=${t.t(`walk.${dir}`)}
        @pointerdown=${(event: PointerEvent) => {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          this.engine?.setWalkVelocity(v[0], v[1]);
          this.redraw();
        }}
        @pointerup=${stop}
        @pointercancel=${stop}
        @lostpointercapture=${stop}
        @click=${(event: MouseEvent) => {
          // From the keyboard: a few steps.
          if (event.detail !== 0) return;
          this.engine?.setWalkVelocity(v[0], v[1]);
          this.redraw();
          window.setTimeout(stop, 400);
        }}
      >
        ${icon(path)}
      </button>`;
    return html`<div class="walk-pad glass" role="group" aria-label=${t.t("walk.pad")}>
        ${pad("ahead", mdiChevronUp, [1, 0])} ${pad("left", mdiChevronLeft, [0, -1])}
        ${pad("back", mdiChevronDown, [-1, 0])} ${pad("right", mdiChevronRight, [0, 1])}
      </div>
      ${
        this.walkHint
          ? html`<div class="walk-hint glass" data-testid="walk-hint">${t.t("walk.hint")}</div>`
          : nothing
      }`;
  }

  /** With several storeys, one button each, the highest on top (not while editing one). */
  private renderStoreys(): TemplateResult | typeof nothing {
    if (this.storeys.length < 2 || this.editingAny) return nothing;
    const t = this.translator;
    const levels = storeyLevels(this.storeys).reverse();
    const all = this.storey === ALL_STOREYS;
    const people = peopleByStorey(this.shownPeople);
    return html`<span class="rule" aria-hidden="true"></span>
      <div role="group" aria-label=${t.t("storey.menu")} data-testid="storeys">
        <button
          class="storey"
          data-storey=${ALL_STOREYS}
          title=${t.t("storey.all")}
          aria-label=${t.t("storey.all")}
          aria-pressed=${all ? "true" : "false"}
          @click=${() => {
            this.chooseStorey(ALL_STOREYS);
          }}
        >
          ${icon(mdiLayersTriple)}
        </button>
        ${levels.map(({ storey, level }) => {
          const name = storeyName(t, storey, level);
          // Another storey with an alert is marked (the most urgent's colour).
          const alert = this.alerts.find((a) => a.storey === storey.id);
          const count = people.get(storey.id) ?? 0;
          const label = [
            alert ? t.t("storey.with_alert", { name }) : name,
            ...(count > 0 ? [t.tp("people.on_storey", count)] : []),
          ].join(", ");
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
            ${storeyShort(level)}${
              count > 0
                ? html`<span class="people-count" aria-hidden="true">${count}</span>`
                : nothing
            }
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

  /** The home shown whole: its storeys spread apart or stacked, its roof shown or not. */
  private renderHomeTools(): TemplateResult {
    const t = this.translator;
    const spread = t.t(this.spread ? "storey.stack" : "storey.spread");
    const roof = t.t(this.roof ? "storey.roof_hide" : "storey.roof_show");
    return html`<button
        data-testid="spread"
        title=${spread}
        aria-label=${spread}
        class=${this.spread ? "on" : ""}
        @click=${() => {
          this.spread = !this.spread;
        }}
      >
        ${icon(this.spread ? mdiArrowCollapseVertical : mdiArrowExpandVertical)}
      </button>
      <button
        data-testid="roof"
        title=${roof}
        aria-label=${roof}
        class=${this.roof ? "on" : ""}
        @click=${() => {
          this.roof = !this.roof;
        }}
      >
        ${icon(mdiHomeRoof)}
      </button>`;
  }

  /** What a storey of the home is called, and how many rooms and lights on it has. */
  private storeyText(id: string): { name: string; counts: string } {
    const t = this.translator;
    const level = storeyLevels(this.storeys).find(({ storey }) => storey.id === id);
    const name = level ? storeyName(t, level.storey, level.level) : id;
    const storey = this.loadedHome?.find((s) => s.id === id);
    // The lights of a private room this viewer may not see are not counted (D-039).
    const { rooms, lights } = storeyCounts(
      this.hass,
      this.bindings,
      storey?.plan,
      storey?.layout,
      (element) => this.inClosedRoom(element),
    );
    const counts = [t.tp("storey.rooms", rooms), lights > 0 ? t.tp("storey.lights_on", lights) : ""]
      .filter(Boolean)
      .join(" · ");
    return { name, counts };
  }

  /** The home shown whole: each storey's name beside it; a tap shows it alone. */
  private renderStoreyLabels(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!canvas || !this.loadedHome || this.storeyLabels.length === 0 || this.linking) {
      return nothing;
    }
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    return html`<div class="storey-labels" data-testid="storey-labels">
      ${this.storeyLabels.map((label) => {
        const { name, counts } = this.storeyText(label.id);
        // Beside the storey, clear of the toolbar; over it on the plan. Inside the view.
        const width = canvas.clientWidth;
        const left = label.top
          ? Math.max(STOREY_LABEL_HALF, Math.min(label.x * k, width - STOREY_LABEL_HALF))
          : Math.max(0, Math.min(label.x * k, width - STOREY_LABEL_ROOM));
        const top = label.top ? Math.max(label.y * k, STOREY_LABEL_HEIGHT) : label.y * k;
        return html`<button
          class="storey-label glass ${label.top ? "top" : ""}"
          data-storey=${label.id}
          style="left:${left}px;top:${top}px"
          @click=${() => {
            this.chooseStorey(label.id);
          }}
        >
          <strong>${name}</strong><span>${counts}</span>
        </button>`;
      })}
    </div>`;
  }

  /** The home shown whole: a picture of each storey, the highest on top; a tap shows it alone. */
  private renderPictures(): TemplateResult | typeof nothing {
    const home = this.loadedHome;
    if (!home || this.pictures.length !== home.length || this.linking) return nothing;
    // Small views keep the pictures out of the way.
    if ((this.canvas?.clientWidth ?? 0) < PICTURES_MIN_WIDTH) return nothing;
    const t = this.translator;
    return html`<div
      class="pictures"
      role="group"
      aria-label=${t.t("storey.pictures")}
      data-testid="storey-pictures"
    >
      ${[...home.keys()].reverse().map((i) => {
        const storey = home[i];
        const picture = this.pictures[i];
        if (!storey || !picture) return nothing;
        const { name } = this.storeyText(storey.id);
        return html`<button
          class="picture glass"
          data-storey=${storey.id}
          @click=${() => {
            this.chooseStorey(storey.id);
          }}
        >
          <img src=${picture} alt="" /><span>${name}</span>
        </button>`;
      })}
    </div>`;
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

  /** The tip on what a tap does, along the bottom of the view. */
  private renderTip(): TemplateResult {
    const t = this.translator;
    return html`<div class="tip glass" role="status" data-testid="tip">
      <span>${t.t("bubble.hint")}</span>
      <button class="action quiet" @click=${this.readTapTip}>${t.t("bubble.hint_ok")}</button>
    </div>`;
  }

  /** The bubble over the piece last tapped, above it (below, near the top of the view). */
  private renderBubble(): TemplateResult | typeof nothing {
    const bubble = this.bubble;
    const canvas = this.canvas;
    if (!bubble || !canvas || this.sheet || this.editingAny || this.linking) return nothing;
    const point = this.badgePoints[bubble.element];
    if (!point) return nothing;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    // Within the view, and clear of the toolbar on its right when there is room beside it.
    const width = canvas.clientWidth;
    const tools = this.renderRoot.querySelector<HTMLElement>(".tools")?.offsetLeft ?? width;
    const right = tools - BUBBLE_WIDTH - 2 * EDGE >= 0 ? tools - EDGE : width - EDGE;
    const half = Math.min(BUBBLE_WIDTH / 2, (right - EDGE) / 2);
    const x = Math.min(Math.max(point[0] * k, EDGE + half), right - half);
    const y = point[1] * k;
    const below = y < 200;
    return html`<div
      class="bubble-at ${below ? "below" : ""}"
      data-testid="bubble"
      data-element=${bubble.element}
      style="left:${x}px;top:${y}px"
      @pointerdown=${this.keepBubble}
      @focusin=${this.keepBubble}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") this.bubble = undefined;
        else this.keepBubble();
      }}
    >
      <domotwin-bubble
        .hass=${this.hass}
        .heading=${bubble.heading}
        .entity=${bubble.entity}
        .suggestions=${bubble.suggestions}
        .linkable=${this.linkable}
        .busy=${this.bubbleBusy === bubble.element}
        @domotwin-close=${() => {
          this.bubble = undefined;
        }}
        @domotwin-bubble-more=${() => {
          const binding = this.actingBinding(bubble.element);
          this.bubble = undefined;
          if (binding) {
            const info = this.names[bubble.element];
            void this.openControls(binding, {
              id: bubble.element,
              type: (info?.type ?? "furniture") as PickedElement["type"],
              name: bubble.heading,
              room: info?.room ?? "",
            });
          }
        }}
        @domotwin-bubble-link=${(event: CustomEvent<{ entity: string }>) => {
          void this.quickLink(bubble.element, event.detail.entity);
        }}
        @domotwin-bubble-link-more=${() => {
          this.bubble = undefined;
          const info = this.names[bubble.element];
          const picked: PickedElement = {
            id: bubble.element,
            type: (info?.type ?? "furniture") as PickedElement["type"],
            name: bubble.heading,
            room: info?.room ?? "",
          };
          fire(this, "domotwin-link-element", picked);
        }}
      ></domotwin-bubble>
    </div>`;
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
        .device=${sheet.device}
        .area=${sheet.area}
        .piece=${sheet.piece}
        .upkeep=${this.upkeep}
        .standing=${sheet.piece ? this.standings[sheet.piece] : undefined}
        @domotwin-close=${this.closeSheet}
        @domotwin-show-wires=${this.onShowWires}
      ></domotwin-controls>`;
    }
    if (sheet.kind === "piece") {
      const room = sheet.room;
      return html`<domotwin-piece
        data-testid="piece"
        .hass=${this.hass}
        .heading=${sheet.heading}
        .piece=${sheet.piece}
        .roomName=${room?.name}
        .upkeep=${this.upkeep}
        .standing=${this.standings[sheet.piece]}
        @domotwin-close=${this.closeSheet}
        @domotwin-open-room=${() => {
          if (room) void this.openRoom(room.id, room.name);
        }}
      ></domotwin-piece>`;
    }
    if (sheet.kind === "person") {
      const person = this.shownPeople.find((p) => p.id === sheet.person);
      return html`<domotwin-person
        data-testid="person"
        .hass=${this.hass}
        .heading=${sheet.heading}
        .person=${person}
        .devices=${this.located.filter((d) => d.person === sheet.person)}
        @domotwin-close=${this.closeSheet}
        @domotwin-open-room=${() => {
          if (person?.room) void this.openRoom(person.room, person.roomName ?? person.room);
        }}
      ></domotwin-person>`;
    }
    const here = sheet.room ? (peopleByRoom(this.shownPeople).get(sheet.room) ?? []) : [];
    return html`<domotwin-room
      data-testid="room"
      .hass=${this.hass}
      .heading=${sheet.heading}
      .area=${sheet.area}
      .devices=${sheet.room ? this.roomDevicesOf(sheet.room, sheet.heading) : undefined}
      .actions=${sheet.room ? roomActions(this.bindings ?? NO_BINDINGS, sheet.room) : NO_ACTIONS}
      .admin=${this.hass?.user?.is_admin === true}
      .closed=${sheet.closed === true}
      .people=${here}
      .things=${sheet.room ? this.located.filter((d) => d.room === sheet.room) : []}
      @domotwin-close=${this.closeSheet}
      @domotwin-show-wires=${this.onShowWires}
      @domotwin-open-person=${(event: CustomEvent<string>) => {
        void this.openPerson(event.detail);
      }}
    ></domotwin-room>`;
  }

  /**
   * The microphone: Home Assistant's Assist, already listening with a pipeline that hears; else
   * why it cannot (a page over HTTP, voice not set up).
   */
  private readonly listen = async (): Promise<void> => {
    const hass = this.hass;
    if (!hass) return;
    this.layersOpen = false;
    let help: VoiceDialogMode | undefined;
    if (!canListen(hass)) {
      help = "https";
    } else {
      // Unknown (an old Home Assistant, a refusal): Assist decides.
      const pipeline = await listeningPipeline(hass).catch(() => "last_used");
      if (pipeline === undefined) help = "setup";
      else openAssist(this, pipeline, true);
    }
    if (help) {
      try {
        await import("./voice-dialog");
        this.voiceHelp = help;
      } catch {
        this.notify(
          this.translator.t("view.action_failed", { reason: this.translator.error("unknown") }),
        );
      }
    }
  };

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
          class=${plan ? "on" : ""}
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
        ${
          this.walkable
            ? html`<button
                data-testid="walk"
                class=${this.walking ? "on" : ""}
                title=${t.t(this.walking ? "walk.stop" : "walk.start")}
                aria-label=${t.t(this.walking ? "walk.stop" : "walk.start")}
                @click=${() => {
                  this.setWalk(!this.walking);
                }}
              >
                ${icon(mdiWalk)}
              </button>`
            : nothing
        }
        <button
          data-testid="layers"
          title=${t.t("layers.menu")}
          aria-label=${this.layersLabel()}
          aria-haspopup="menu"
          aria-expanded=${this.layersOpen ? "true" : "false"}
          class=${this.shownLayer !== "off" || this.realSun ? "on" : ""}
          @click=${this.toggleLayers}
        >
          ${icon(mdiLayersOutline)}
        </button>
        ${
          this.options.voice !== false && assistAvailable(this.hass)
            ? html`<button
                data-testid="voice"
                title=${t.t("voice.listen")}
                aria-label=${t.t("voice.listen")}
                @click=${this.listen}
              >
                ${icon(mdiMicrophone)}
              </button>`
            : nothing
        }
        ${this.loadedHome && !this.planView ? this.renderHomeTools() : nothing}
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
          ? html`<div
              class="views glass"
              role="menu"
              aria-label=${t.t("view.views")}
              data-testid="views-menu"
              @keydown=${(event: KeyboardEvent) => {
                menuKeydown(
                  event,
                  () => (this.viewsOpen = false),
                  this.renderRoot.querySelector<HTMLElement>('[data-testid="views"]'),
                );
              }}
            >
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

  /** The layers button's name, with what is shown (its colour says it to the eye). */
  private layersLabel(): string {
    const t = this.translator;
    const shown = [
      this.shownLayer !== "off" ? t.t(`layers.${this.shownLayer}`) : "",
      this.realSun ? t.t("layers.sun") : "",
    ].filter(Boolean);
    return shown.length > 0 ? `${t.t("layers.menu")}: ${shown.join(", ")}` : t.t("layers.menu");
  }

  /** The layer menu: one layer at a time, and sunlight through the windows. */
  private renderLayerMenu(): TemplateResult {
    const t = this.translator;
    return html`<div
      class="views glass"
      role="menu"
      aria-label=${t.t("layers.menu")}
      data-testid="layer-menu"
      @keydown=${(event: KeyboardEvent) => {
        menuKeydown(
          event,
          () => (this.layersOpen = false),
          this.renderRoot.querySelector<HTMLElement>('[data-testid="layers"]'),
        );
      }}
    >
      <div class="group" role="group" aria-label=${t.t("layers.menu")}>
        ${LAYER_NAMES.filter(
          (layer) =>
            (layer !== "network" || this.networkAllowed) &&
            (layer !== "automations" || automationsAvailable(this.hass)) &&
            (layer !== "upkeep" || this.upkeep !== undefined),
        ).map(
          (layer) =>
            html`<button
              role="menuitemradio"
              data-layer=${layer}
              aria-checked=${this.shownLayer === layer ? "true" : "false"}
              @click=${() => {
                this.setLayer(layer);
              }}
            >
              ${t.t(`layers.${layer}`)}
            </button>`,
        )}
      </div>
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
      ${
        this.namesShown
          ? html`<button
              role="menuitemcheckbox"
              data-testid="show-small-rooms"
              aria-checked=${this.smallRooms ? "true" : "false"}
              @click=${() => {
                this.layersOpen = false;
                this.smallRooms = !this.smallRooms;
              }}
            >
              ${t.t("layers.small_rooms")}
            </button>`
          : nothing
      }
      ${this.renderShowMe()}
    </div>`;
  }

  /** The user viewing hid themselves (D-034): they may show themselves again from here. */
  private renderShowMe(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const own = hass ? ownHidden(this.people, hass) : undefined;
    if (!hass || !own) return nothing;
    return html`<button
      role="menuitem"
      data-testid="show-me"
      @click=${() => {
        this.layersOpen = false;
        void DomoTwinClient.for(hass)
          .hidePerson(own, false)
          .catch(() => {
            this.notify(this.translator.t("people.hide_error"));
          });
      }}
    >
      ${this.translator.t("people.show_me")}
    </button>`;
  }

  /**
   * The rooms as buttons, for the keyboard and screen readers: what a tap on a floor and a long
   * press do, with the layer's value of each room. Out of sight until it has the focus.
   */
  private renderRoomList(): TemplateResult | typeof nothing {
    if (this.rooms.length === 0 || this.editingAny || this.linking || this.walking) return nothing;
    const t = this.translator;
    const unit = (HEAT_KINDS as readonly string[]).includes(this.layer)
      ? (heatLegend(this.layer)?.unit ?? "")
      : "";
    const values = new Map(
      this.labels
        .filter((label) => label.kind === "heat")
        .map((label) => [label.id, formatHeat(label.value, unit, t.language, this.fahrenheit)]),
    );
    // Every storey at once: each room says its storey (two may share a name).
    const rooms =
      this.loadedHome && this.home
        ? this.home.flatMap((storey) =>
            planRooms(storey.plan).map((room) => ({ ...room, storey: storey.name })),
          )
        : this.rooms.map((room) => ({ ...room, storey: "" }));
    return html`<nav
      class="room-list glass"
      aria-label=${t.t("view.room_list")}
      data-testid="room-list"
    >
      <ul>
        ${rooms.map((room) => {
          const name = room.name || room.id;
          const value = values.get(room.id);
          const closed = this.closed.has(room.id);
          return html`<li>
            <button
              data-room=${room.id}
              @click=${() => {
                // A private room is not framed, as a tap on its floor does nothing (D-039); its
                // sheet says it is private.
                if (!closed && this.engine?.focusElement(room.id)) {
                  this.focusedRoom = { id: room.id, name };
                }
                void this.openRoom(room.id, name);
              }}
            >
              ${closed ? icon(mdiLock) : nothing}<span>${name}</span>${
                room.storey ? html`<small>${room.storey}</small>` : nothing
              }${value ? html`<span class="value">${value}</span>` : nothing}
            </button>
          </li>`;
        })}
      </ul>
    </nav>`;
  }

  /** The rooms' names, on their floor; the room framed has its own chip. */
  private renderRoomNames(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!canvas || this.roomNames.length === 0 || this.editingAny || this.linking) return nothing;
    const last = this.placedNames;
    const now = {
      names: this.roomNames,
      focused: this.focusedRoom?.id,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      small: this.smallRooms,
    };
    let placed = last?.placed;
    if (
      !last ||
      last.names !== now.names ||
      last.focused !== now.focused ||
      last.width !== now.width ||
      last.height !== now.height ||
      last.small !== now.small
    ) {
      const k = Math.max(1, now.width) / Math.max(1, canvas.width);
      placed = placeLabels(
        now.names
          .filter((room) => room.id !== now.focused)
          .map((room) => ({ ...room, x: room.x * k, y: room.y * k })),
        {
          ...now,
          measure: this.measureName,
          before: new Map(last?.placed.map((room) => [room.id, room.compact])),
        },
      );
      this.placedNames = { ...now, placed };
    }
    return html`<div class="room-names" data-testid="room-names" aria-hidden="true">
      ${(placed ?? []).map((room) => {
        const closed = this.closed.has(room.id);
        return html`<span
          class="room-name ${room.compact ? "compact" : ""}"
          data-room=${room.id}
          data-kind=${room.kind}
          ?data-private=${closed}
          style="left:${room.x}px;top:${room.y}px"
          >${icon(closed ? mdiLock : ROOM_ICONS[room.kind])}${room.compact ? nothing : room.name}</span
        >`;
      })}
    </div>`;
  }

  /** How wide a name is drawn: measured in the view's font, the names' weight and size. */
  private readonly measureName = (name: string): number => {
    let width = this.nameWidths.get(name);
    if (width === undefined) {
      this.measuring ??= document.createElement("canvas").getContext("2d");
      if (!this.measuring) return textWidth(name);
      this.nameFont ??= `600 12px ${getComputedStyle(this).fontFamily}`;
      this.measuring.font = this.nameFont;
      // A little more, for the rounding of the text's layout.
      width = this.measuring.measureText(name).width + 1;
      this.nameWidths.set(name, width);
    }
    return width;
  };

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
                  (badge.kind === "battery_low" || badge.kind === "scheduled") && badge.text
                    ? html`<small>${badge.text}</small>`
                    : nothing
                }</span
              >`,
          )}
        </button>`;
      })}
    </div>`;
  }

  /** The names over the people (D-034): a tap opens a person's sheet. */
  private renderPeople(): TemplateResult | typeof nothing {
    const canvas = this.canvas;
    if (!canvas || this.personPoints.length === 0 || this.editingAny || this.linking) {
      return nothing;
    }
    const t = this.translator;
    const k = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.width);
    return html`<div class="people" data-testid="people">
      ${this.personPoints.map((point) => {
        const person = this.shownPeople.find((p) => p.id === point.id);
        if (!person) return nothing;
        const where = person.roomName
          ? t.t("people.in_room", { room: person.roomName })
          : t.t("people.somewhere");
        const label = t.t("people.label", { name: person.name, where });
        return html`<button
          class="person-tag"
          data-person=${person.id}
          style="left:${point.x * k}px;top:${point.y * k}px;opacity:${point.opacity};--person:${person.color}"
          aria-label=${label}
          title=${label}
          @click=${() => {
            void this.openPerson(person.id);
          }}
        >
          ${avatar(person)}<span class="name">${person.name.split(/\s+/)[0]}</span>
        </button>`;
      })}
    </div>`;
  }

  /** What the home's energy sensors say now, when one says something (D-049). */
  private energyShown(): EnergyNow | undefined {
    if (!this.hass || !this.energy) return undefined;
    const now = energyNow(this.hass, this.energy);
    return Object.keys(now).length > 0 ? now : undefined;
  }

  /** The legend of the layer shown: its colours from end to end, or why it shows nothing. */
  private renderLegend(): TemplateResult | typeof nothing {
    const t = this.translator;
    const layer = this.layer;
    if (!this.valueLayer || this.editingAny) return nothing;
    const name = t.t(`layers.${layer}`);
    if (layer === "power") {
      const gradient = `linear-gradient(to right, ${POWER_GRADIENT.join(", ")})`;
      // The home's energy above the power of its pieces, when its sensors say something.
      const energy = this.energyShown();
      const flow = energy ? energyFlow(t, energy, energyFlows(energy)) : nothing;
      return html`<div
        class="legend glass ${flow === nothing ? "" : "with-energy"}"
        data-testid="legend"
        role="note"
      >
        ${flow}
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
    if (this.engineState !== "ready" || (this.plan === undefined && !this.home)) {
      return html`<div class="overlay" role="status" aria-live="polite">
        <div class="message glass">
          <div class="spinner" aria-hidden="true"></div>
          <p>${t.t("view.loading")}</p>
        </div>
      </div>`;
    }
    if (this.plan === null && !this.home) {
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
    if (room) return this.renderRoomBar(t, room);
    const title = this.summary.name || t.t("view.untitled");
    return html`<div class="chip glass" role="status" data-testid="summary">
      <span
        >${title} · ${t.tp("view.rooms", this.summary.rooms)} ·
        ${t.tp("view.pieces", this.summary.furniture)}</span
      >
    </div>`;
  }

  /**
   * The framed room's chip: its name, which opens its panel, and what it does with a tap (D-047):
   * its lights, its blinds, its media, its own actions.
   */
  private renderRoomBar(t: Translator, room: FocusedRoom): TemplateResult {
    const name = html`<button
      class=${this.hass ? "room-open" : "chip glass"}
      data-testid="room-chip"
      aria-label=${t.t("view.room_panel", { room: room.name })}
      @click=${() => {
        void this.openRoom(room.id, room.name);
      }}
    >
      <span>${room.name}</span>${icon(mdiChevronUp)}
    </button>`;
    const hass = this.hass;
    if (!hass) return name;
    const devices = this.roomDevicesOf(room.id, room.name);
    const commands = devices ? roomCommands(hass, devices) : [];
    const actions = devices ? roomActions(this.bindings ?? NO_BINDINGS, room.id) : [];
    return html`<div
      class="chip glass room-bar"
      role="group"
      aria-label=${room.name}
      data-testid="room-bar"
    >
      ${name} ${roomButtons(t, commands, actions, (what) => void this.roomRun(what), false)}
    </div>`;
  }

  /**
   * A room's devices (its area's and its pieces') that Home Assistant has now. Read from the
   * registries and the links again only when they or the pieces change; none for a private room
   * this viewer may not see (D-039).
   */
  private roomDevicesOf(id: string, name: string): RoomDevices | undefined {
    const hass = this.hass;
    if (!hass || this.closed.has(id)) return undefined;
    const bindings = this.bindings ?? NO_BINDINGS;
    const memo = this.devicesMemo;
    if (
      memo?.id === id &&
      memo.name === name &&
      memo.entities === hass.entities &&
      memo.areas === hass.areas &&
      memo.devices === hass.devices &&
      memo.bindings === bindings &&
      memo.names === this.names
    ) {
      if (memo.states !== hass.states || !memo.present) {
        memo.states = hass.states;
        memo.present = presentDevices(hass, memo.value);
      }
      return memo.present;
    }
    const area = roomArea(hass, bindings, id, name);
    const value = roomDevices(hass, bindings, area, this.piecesIn(id));
    this.devicesMemo = {
      id,
      name,
      entities: hass.entities,
      areas: hass.areas,
      devices: hass.devices,
      bindings,
      names: this.names,
      value,
      states: hass.states,
      present: presentDevices(hass, value),
    };
    return this.devicesMemo.present;
  }

  /** The pieces in a room, where the plan and its edits place them (D-047's room devices). */
  piecesIn(room: string): string[] {
    return Object.entries(this.names)
      .filter(([, info]) => info.room === room)
      .map(([piece]) => piece);
  }

  /** A command of the framed room or one of its own actions (D-047). */
  private async roomRun(what: RoomCommand | RoomAction): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      if (!(await runRoom(this, hass, what))) this.notify(this.translator.t("demo.no_dialog"));
    } catch (error) {
      this.notify(failureText(this.translator, error));
    }
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
