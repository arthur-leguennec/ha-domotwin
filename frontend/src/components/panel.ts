import {
  mdiAccountMultipleOutline,
  mdiAccountKeyOutline,
  mdiAccountLockOutline,
  mdiBluetooth,
  mdiCheck,
  mdiClipboardCheckOutline,
  mdiClose,
  mdiFlaskOutline,
  mdiCogOutline,
  mdiHistory,
  mdiCubeOutline,
  mdiDotsVertical,
  mdiHomeOutline,
  mdiLightningBoltOutline,
  mdiLinkVariant,
  mdiLockOutline,
  mdiMicrophoneMessage,
  mdiPencilOutline,
  mdiRobotVacuum,
  mdiShieldHomeOutline,
  mdiSpeedometer,
  mdiStarFourPointsOutline,
  mdiTestTube,
  mdiStairs,
  mdiTrayArrowDown,
  mdiTrayArrowUp,
  mdiTuneVariant,
  mdiVectorSquareEdit,
  mdiViewGridOutline,
  mdiTabletDashboard,
  mdiWifi,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import {
  EngineError,
  applyLayout,
  catalogue,
  summarizePlan,
  type CatalogueKind,
  type EditState,
  type HomeStorey,
  type PickedElement,
  type UserModel,
} from "../engine/engine";
import {
  THEME_MODES,
  defaultAccent,
  readAccent,
  resolveLook,
  type LookName,
  type ThemeMode,
} from "../config";
import {
  DomoTwinClient,
  type PlanJson,
  type RoofSettings,
  type Settings,
  type StoreyInfo,
  type StoredPlan,
} from "../ha/client";
import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import type { DemoHome } from "../demo/home";
import type { DraftDay, SandboxHome } from "../sandbox/home";
import type { Config } from "../sandbox/config";
import {
  MAX_ENTITIES,
  NO_BINDINGS,
  areaOf,
  readBindings,
  roomArea,
  shownEntity,
  type BindingsJson,
  type ElementBinding,
  type RoomAction,
} from "../live/bindings";
import {
  clearDraft,
  clearPlanDraft,
  readDraft,
  readPlanDraft,
  writeDraft,
  writePlanDraft,
  type Draft,
  type PlanDraft,
} from "../live/draft";
import {
  ALL_STOREYS,
  idsElsewhere,
  loadHome,
  loadStorey,
  roomsElsewhere,
  storeyIds,
  storeyLevels,
  storeyName,
  withAlertsElsewhere,
  type StoreyAlert,
  type StoreyRooms,
} from "../live/storeys";
import { NOTHING_UNSEEN, seen, unseenOf, type Unseen } from "../live/privacy";
import { DoorbellWatch, RING_FRESH_MS, RING_SHOWN_MS, type Ring } from "../live/doorbell";
import {
  readSecurityAlerts,
  securityAlerts,
  securityAlertsKept,
  securityPage,
  shownAlerts,
  type SecurityAlert,
  type SecurityAlertChoice,
  type ShownAlert,
} from "../live/security";
import { plainWordsOffered } from "../live/ai-task";
import {
  closedRooms,
  gatedHass,
  hiddenEntities,
  RightsCache,
  viewerOf,
  type Gate,
} from "../live/rights";
import { usableActions } from "../live/room-actions";
import {
  NO_CHOICES,
  canDraw3d,
  pathOf,
  readDeviceStart,
  routeOf,
  startTab,
  type Choices,
  type Tab,
} from "../live/choices";
import {
  readDeviceScreen,
  saverDue,
  screenNamed,
  someoneThere,
  type ScreenLayout,
  type Screens,
} from "../live/screens";
import type { GlanceSources } from "../live/glance";
import { usualWeather, weatherEntities } from "../live/weather";
import { forScreen, resolveShow, type ShowRequest } from "../live/show";
import type { LocatingSettings } from "../live/locating";
import type { PeopleSettings } from "../live/people";
import type { AccessPoint } from "../live/placement";
import type { Wifi } from "../live/wifi";
import { mergeCards, renamedPieces, type Upkeep, type UpkeepCard } from "../live/upkeep";
import {
  applyLink,
  planElement,
  planRooms,
  roomPieces,
  type LinkChange,
  type PlanElementInfo,
} from "../live/suggest";
import type { ImportReport, ImportStorey, PlanFile, ScanRoom } from "../import/import";
import { IMPORTED_FILES, PLAN_FILES, isOtherAppJson } from "../import/files";
import { mapPath, robotMaps, type RobotMapSource } from "../live/robot-maps";
import type { ModelFormat, ModelInfo } from "../models/models";
import { languageOf, translatorFor, type Translator } from "../i18n";
import { documentFonts } from "../fonts";
import { icon } from "./icon";
import { saveText } from "./save";
import { inLanguage } from "./define";
import { DemoSwitch } from "./demo-switch";
import type { MeasureHost } from "./measure";
import type { PlainSession } from "./plain-dialog";
import { DialogFocus } from "./dialog";
import { focusBack, focusMenu, menuKeydown } from "./menu";
import { baseStyles, lookStyles } from "./styles";
import type { ModelChoice } from "./edit-bar";
import type { PlaceRequest } from "./network-panel";
import type { PlanEditState, PlanTool } from "./plan-editor";
import type { RoomChoice } from "./private-rooms";
import type { ReportPlan } from "./report-dialog";
import {
  nextFrame,
  type DomoTwinView,
  type EditCommand,
  type PlanCommand,
  type ViewOptions,
} from "./view";
import {
  ENERGY_SENSORS,
  energyCandidates,
  preferredFromHome,
  readEnergy,
  type EnergySensor,
  type EnergySettings,
} from "../live/energy";
import { watts } from "../live/devices";
import { formatPower, layerAsked, numberOf, roomLayers, type LayerName } from "../live/layers";
import { navigate } from "../live/actions";
import { areaPage, energyPage, energySetUp } from "../live/overview";
import type { PeriodChoice } from "../live/history";

/** The roofs' shapes, and the slope and colours they have before one is chosen (D-077): tiles,
 * a flat roof's membrane, as the engine draws them. */
const ROOF_SHAPES = ["gable", "hip", "shed", "flat"] as const;
const ROOF_PITCH = 30;
const ROOF_TILES = "#6b5a52";
const ROOF_MEMBRANE = "#5d6062";
/** The plan format allows files up to 32 MB. */
const MAX_FILE_BYTES = 32_000_000;
/** Plans of other apps are read in the browser's memory: larger ones are refused. */
const MAX_IMPORT_BYTES = 200_000_000;
const PANEL_OPTIONS: ViewOptions = {
  quality: "auto",
  view: "3d",
  cutaway: "auto",
  lighting: "auto",
};
const TOAST_MS = 6000;
/** How long a layer asked for in the address waits for the plan to be drawn, and how often it
 * looks (ms). */
const LAYER_WAIT_MS = 5 * 60_000;
const LAYER_POLL_MS = 250;
/** How long before settings that could not be read are asked for again (ms). */
const SETTINGS_RETRY_MS = 10_000;
/** How often a wall screen asks itself whether its saver is due (ms, D-076). */
const SAVER_CHECK_MS = 5_000;
/** What says someone is before the screen, besides its sensors. */
const ACTIVITY = ["pointerdown", "keydown", "wheel"] as const;
/** No Wi-Fi access point placed (D-066): the same array every time. */
const NO_ACCESS_POINTS: AccessPoint[] = [];
/** Upkeep cards saved at once when a file fills them (the integration takes up to 2 000). */
const CARDS_AT_ONCE = 400;
/** The highest a storey's floor may be (cm), as the integration checks. */
const MAX_ELEVATION = 100_000;
/** The plan drawn is kept by the browser once the drawing pauses this long (ms). */
const PLAN_DRAFT_MS = 800;

interface Toast {
  text: string;
  error: boolean;
  /** What the toast offers to do (a button beside its text). */
  action?: { label: string; run: () => void };
}

/**
 * Whether a JSON file is a plan of another app (a room scan, a robot's map, a Floorplanner
 * project, D-040, D-064) rather than a DomoTwin plan: read by the import module.
 */
async function isOtherApp(file: File): Promise<boolean> {
  // Larger than a plan may be: refused as one.
  if (file.size > MAX_FILE_BYTES) return false;
  try {
    const text = await file.text();
    // A DomoTwin plan says so: not parsed twice.
    if (text.includes('"domotwin-plan"')) return false;
    return isOtherAppJson(JSON.parse(text.replace(/^\uFEFF/, "")) as unknown);
  } catch {
    return false;
  }
}

/** A plan of another app waiting for the user to pick a storey. */
interface ImportChoice {
  file: PlanFile;
  name: string;
  storeys: ImportStorey[];
  /** Each storey's level among all the file's storeys (0: the ground floor), by id. */
  levels: Map<number, number>;
}

/** A message already translated (a refused model of an imported plan). */
class TranslatedError extends Error {
  override name = "TranslatedError";
}

/** The 3D files of a plan total at most this (`plan-format.md`). */
const MAX_MODELS_BYTES = 20_000_000;
/** A link editor's room without actions, or without linked pieces (one value, not a new one). */
const NO_ACTIONS: RoomAction[] = [];
const NO_ENTITIES: string[] = [];

/** A 3D file read, waiting for its name and size. */
interface ModelImport {
  fileName: string;
  format: ModelFormat;
  bytes: Uint8Array;
  info: ModelInfo;
  mesh: Uint8Array;
}

/** A user model of a plan, as far as the import and export read it. */
interface PlanModel {
  name?: unknown;
  file?: { format?: unknown; hash?: unknown; bytes?: unknown; up?: unknown; data?: unknown };
}

/** The element open in the link editor. */
interface LinkTarget {
  element: PlanElementInfo;
  binding?: ElementBinding;
  area?: string;
  roomArea?: string;
  /** A room's own actions, and the entities linked to its pieces (D-047). */
  roomActions?: RoomAction[];
  pieceEntities?: string[];
}

function fileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(Boolean)
    .join("-");
  return `${slug || "plan"}.domotwin.json`;
}

/** Saves `value` as a JSON file named `name` (the browser's download). */
function download(name: string, value: unknown): void {
  saveText(name, `${JSON.stringify(value, null, 2)}\n`, "application/json");
}

/** The panel's dialogs and sheets, which the focus goes into and comes back from (D-042). */
const PANEL_DIALOGS = [
  // A doorbell ringing (D-068), over everything else.
  "domotwin-doorbell",
  '[role="dialog"]',
  '[role="alertdialog"]',
  "domotwin-people-settings",
  "domotwin-bluetooth-settings",
  "domotwin-private-rooms",
  "domotwin-voice",
  "domotwin-config-history",
  "domotwin-plain",
  "domotwin-guests",
  "domotwin-rights",
  "domotwin-link",
  "domotwin-catalogue",
  "domotwin-model-import",
  "domotwin-measure",
  "domotwin-choices",
  "domotwin-screens",
  "domotwin-history",
]
  .map((dialog) => `.body > ${dialog}`)
  .join(", ");

/** Narrower than this (CSS pixels), the panel's toolbar keeps only the daily actions. */
const TIGHT_WIDTH = 560;
/** The room the panel's title keeps beside the buttons' names before they give way (CSS px). */
const TITLE_ROOM = 120;

/** `<domotwin-panel>`: the full-screen DomoTwin in the sidebar, with import and export. */
export class DomoTwinPanel extends LitElement {
  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    plan: { state: true },
    layout: { state: true },
    planError: { state: true },
    bindings: { state: true },
    toast: { state: true },
    busy: { state: true },
    linking: { state: true },
    linkTarget: { state: true },
    importChoice: { state: true },
    robotChoice: { state: true },
    editing: { state: true },
    edit: { state: true },
    multi: { state: true },
    catalogue: { state: true },
    models: { state: true },
    modelImport: { state: true },
    discardAsk: { state: true },
    draft: { state: true },
    settings: { state: true },
    settingsRead: { state: true },
    bindingsRead: { state: true },
    elsewhereRead: { state: true },
    upkeep: { state: true },
    people: { state: true },
    wifi: { state: true },
    northDraft: { state: true },
    peopleOpen: { state: true },
    bluetoothOpen: { state: true },
    privacyRooms: { state: true },
    guestsStoreys: { state: true },
    rightsStoreys: { state: true },
    voiceOpen: { state: true },
    configHistoryOpen: { state: true },
    plainOpen: { state: true },
    reportOpen: { state: true },
    moreOpen: { state: true },
    tight: { state: true },
    compact: { type: Boolean, reflect: true },
    lookDraft: { state: true },
    energyDraft: { state: true },
    energyPreferred: { state: true },
    weatherDraft: { state: true },
    roofDraft: { state: true },
    look: { reflect: true },
    planning: { state: true },
    planState: { state: true },
    planTool: { state: true },
    planOffer: { state: true },
    planDiscardAsk: { state: true },
    storeys: { state: true },
    storey: { state: true },
    showAll: { state: true },
    home: { state: true },
    elsewhere: { state: true },
    storeysOpen: { state: true },
    storeyRemoveAsk: { state: true },
    planNew: { state: true },
    planReserved: { state: true },
    measureOpen: { state: true },
    measureLook: { state: true },
    route: { attribute: false },
    tab: { state: true },
    roomOpen: { state: true },
    roomGraphs: { state: true },
    from3d: { state: true },
    report: { state: true },
    energyKnown: { state: true },
    choices: { state: true },
    choicesRead: { state: true },
    choicesOpen: { state: true },
    practicalReady: { state: true },
    securityChoices: { state: true },
    ring: { state: true },
    doorbellReady: { state: true },
    screens: { state: true },
    saverShown: { state: true },
    saverReady: { state: true },
    screensOpen: { state: true },
    screensReady: { state: true },
  };

  narrow = false;
  panel?: unknown;
  /** Where Home Assistant shows the panel: its own path, and the page's after it. */
  route?: { prefix: string; path: string };
  /** The tab shown (D-055); unknown until the tab to open on is. */
  protected tab?: Tab;
  /**
   * The room open in the Rooms tab (an area), whether its graphs are (D-069), and whether it was
   * opened from the 3D view.
   */
  protected roomOpen?: string;
  protected roomGraphs = false;
  protected from3d = false;
  /** A history report opened from a room's graphs (D-058, D-069), its module loaded. */
  protected report?: { heading: string; entities: string[]; period?: PeriodChoice };
  private reportModule?: Promise<unknown>;
  /** Whether Home Assistant's energy has something set up (D-069), and on which connection. */
  protected energyKnown?: { connection: unknown; setUp: boolean };
  private energyAsked?: unknown;
  /** The user's own choices (D-055); undefined until read, or until reading them failed. */
  protected choices?: Choices;
  /** They were read: the dialog that changes them may open. */
  protected choicesRead = false;
  private choicesTimer?: ReturnType<typeof setTimeout>;
  private wifiTimer?: ReturnType<typeof setTimeout>;
  /** Counts the stars given or taken away: the answer to the last one sets the favourites. */
  private stars = 0;
  protected choicesOpen = false;
  /** The Home and Rooms tabs' module is loaded. */
  protected practicalReady = false;
  private practicalModule?: Promise<void>;
  /** Its module could not be loaded: tried again when a tab is chosen. */
  private practicalFailed = false;
  /** The 3D view was shown once: it stays, hidden on the other tabs, its engine and camera. */
  private shown3d = false;
  /** The alerts chosen on Home Assistant's Security page (D-068), followed while it shows. */
  protected securityChoices: SecurityAlertChoice[] = [];
  private securityFollowed?: Promise<(() => Promise<void>) | undefined>;
  /** Home Assistant's alerts last given to the 3D view: the same list while they are the same. */
  private securityShown: { key: string; alerts: SecurityAlert[] } = { key: "[]", alerts: [] };
  /** The alerts last given to the other tabs, the same way. */
  private homeAlertsShown: { key: string; alerts: ShownAlert[] } = { key: "[]", alerts: [] };
  /** The home's doorbells, watched on every tab (D-068), and the ring shown full screen. */
  private readonly doorbells = new DoorbellWatch();
  protected ring?: Ring;
  private ringTimer?: ReturnType<typeof setTimeout>;
  /** A ring heard before the settings were read, shown once they are if still fresh. */
  private ringWaiting?: Ring;
  /** The full screen's module, loaded when a doorbell first rings. */
  protected doorbellReady = false;
  private doorbellModule?: Promise<void>;
  /** A layer the Home tab asked the 3D view to show (D-063), until it is shown. */
  private layerWanted?: LayerName;
  /** What the 3D view was last given of Home Assistant. */
  private viewHass?: HomeAssistant;
  /** The viewer's rights as last worked out (D-071). */
  private readonly rightsCache = new RightsCache();
  /** The tab this device opens on, when it has one of its own. */
  private deviceStart = readDeviceStart();
  /** The wall screen this device is (D-076), and every screen's layout once read. */
  private deviceScreen = readDeviceScreen();
  protected screens?: Screens;
  private screensRead = false;
  private screensTimer?: ReturnType<typeof setTimeout>;
  /** When the screen was last touched, or someone last moved before it (ms). */
  private quietSince = Date.now();
  private saverTimer?: ReturnType<typeof setInterval>;
  /** The screen saver shows, its module loaded the first time it comes. */
  protected saverShown = false;
  protected saverReady = false;
  private saverModule?: Promise<void>;
  /** The wall screens' dialog (administrators), its module loaded the first time it opens. */
  protected screensOpen = false;
  protected screensReady = false;
  private screensModule?: Promise<void>;
  /** What the Home and Rooms tabs were given last, and what it was read from. */
  private practicalShown?: {
    from: unknown[];
    sources: GlanceSources;
    unseen: Unseen;
    actions: Map<string, RoomAction[]>;
  };
  protected plan?: StoredPlan["plan"];
  protected layout?: StoredPlan["layout"];
  protected planError?: string;
  protected bindings?: BindingsJson;
  /** The links were asked for once (read, or not readable): what a private room links is known. */
  protected bindingsRead = false;
  /** The rooms of the other storeys are those of the storey shown (D-039: what they keep private). */
  protected elsewhereRead = false;
  protected toast?: Toast;
  protected busy = false;
  protected linking = false;
  protected linkTarget?: LinkTarget;
  /** A device of the network map to place: the next piece picked stands for it (D-031). */
  private placing?: PlaceRequest;
  protected importChoice?: ImportChoice;
  /** The robots whose map Home Assistant has, one to pick (D-064). */
  protected robotChoice?: RobotMapSource[];
  /** Edit mode: on, its state, taps adding to the selection, the catalogue open. */
  protected editing = false;
  protected edit?: EditState;
  protected multi = false;
  protected catalogue?: CatalogueKind[];
  /** The plan's own models, in the catalogue. */
  protected models: UserModel[] = [];
  /** A 3D file being imported. */
  protected modelImport?: ModelImport;
  /** Asking whether to discard the changes. */
  protected discardAsk = false;
  /** Changes not saved, kept by this browser, offered when edit mode starts. */
  protected draft?: Draft;
  /** The home's settings, and north being set (the settings dialog is open). */
  protected settings?: Settings;
  /** The settings were read once: the home is not shown before, its private rooms unknown
   * (D-039), except to change it. */
  protected settingsRead = false;
  private settingsTimer?: ReturnType<typeof setTimeout>;
  /** The upkeep cards (D-033). */
  protected upkeep?: Upkeep;
  /** The people placed in their rooms (D-034). */
  protected people?: PeopleSettings;
  /** The home's Wi-Fi for guests (D-060): all of it for an administrator. */
  protected wifi?: Wifi;
  protected northDraft?: number;
  /** The people's settings are open (D-034), their module loaded, with the candidates. */
  protected peopleOpen = false;
  /** The rooms of the home while the private rooms' settings are open (D-039). */
  protected privacyRooms?: RoomChoice[];
  /** Guest access (D-067), open: every storey's plan, whose rooms and devices a pass opens. */
  protected guestsStoreys?: HomeStorey[];
  /** The rights' dialog (D-071), open with every storey's plan. */
  protected rightsStoreys?: HomeStorey[];
  /** The voice settings (D-041) are open. */
  protected voiceOpen = false;
  /** The configuration history (D-062) is open, its module loaded. */
  protected configHistoryOpen = false;
  /** An automation in plain words (D-070) is being written, its module loaded. */
  protected plainOpen = false;
  /** The automation being written in plain words: it outlives its dialog and the sandbox. */
  private plainSession?: PlainSession;
  /** The weekly report is open (D-081), on the report asked for (the notification's link). */
  protected reportOpen = false;
  private reportAsked?: number;
  /** The plans the report is drawn on, the same while they are. */
  private reportShown?: { from: unknown[]; plans: ReportPlan[] };
  private reportClosedShown?: Set<string>;
  /** The menu of the export and the home's settings is open. */
  protected moreOpen = false;
  /** Too narrow for every button (a phone): the import and the storeys go in the More menu. */
  protected tight = false;
  /** The toolbar's buttons keep their icons alone (their names stay as tooltips and for screen
   * readers): their names do not fit, or Home Assistant says the screen is narrow. */
  protected compact = false;
  /** The panel's width (CSS pixels), and the width its toolbar needs with these names. */
  private panelWidth = 0;
  private namesWidth?: { names: string; width: number };
  /** What the toolbar's buttons were last fitted for (the mode, the language, the width…). */
  private fitted = "";
  private sizeObserver?: ResizeObserver;
  /** A font loaded (the bundled one comes after the first picture) widens the names. */
  private readonly onFonts = (): void => {
    this.namesWidth = undefined;
    this.fitToolbar();
  };
  /** The focus goes into the dialog shown and comes back (D-042). */
  private readonly dialogs = new DialogFocus();
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.dialogs.escape(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private privacyModule?: Promise<unknown>;
  private peopleSettings?: PeopleSettings;
  private peopleModule?: Promise<unknown>;
  /** The Bluetooth locating's settings are open (D-035), their module loaded. */
  protected bluetoothOpen = false;
  private locating?: LocatingSettings;
  private bluetoothModule?: Promise<unknown>;
  /**
   * The look being chosen in the settings (shown as it is chosen), while they are open: its mode,
   * and its accent (none: the look's own).
   */
  protected lookDraft?: { theme: ThemeMode; accent?: string };
  /** Where the energy is read, being chosen in the settings (D-049). */
  protected energyDraft?: EnergySettings;
  /** The weather drawn around the home, being chosen in the settings (D-072): an entity, `none`,
   * or `""` for the usual one. */
  protected weatherDraft?: string;
  /** How the roofs are drawn, being chosen in the settings (D-077). */
  protected roofDraft?: RoofSettings;
  /** The draft last shown, and its settings as read. */
  private energyShown?: { draft: EnergySettings; energy: EnergySettings | undefined };
  /** The power sensors Home Assistant's own energy settings name, offered first. */
  protected energyPreferred?: Record<EnergySensor, string[]>;
  /** The look shown (D-027), on the element for the colours of the header and the dialogs. */
  look: LookName = "day";
  /** The storeys, the one shown, the storeys dialog and a storey being removed. */
  protected storeys: StoreyInfo[] = [];
  protected storey?: string;
  /**
   * Every storey at once (D-028): the view shows `home` while no tool runs; the tools work on
   * `storey`, shown alone meanwhile.
   */
  protected showAll = false;
  protected home?: HomeStorey[];
  /** The rooms of the storeys not shown, for their alerts. */
  protected elsewhere: StoreyRooms[] = [];
  protected storeysOpen = false;
  /** The changes of the storeys' names and heights, saved in turn. */
  private storeyChanges: Promise<void> = Promise.resolve();
  /** Counts the plan's loads: the answer to an older one is dropped. */
  private loads = 0;
  /** Counts `domotwin.show` requests: an older one still on its way is dropped. */
  private shows = 0;
  protected storeyRemoveAsk?: StoreyInfo;
  /** The plan editor draws a new storey; the ids of the other storeys' elements. */
  protected planNew = false;
  protected planReserved: string[] = [];
  /** Where the next file imported goes: the storey shown, or a new storey. */
  private importTarget: "storey" | "new" = "storey";
  /**
   * The plan editor: on, its state and tool, a plan drawn and kept by this browser (offered when
   * it starts), and the discard question.
   */
  protected planning = false;
  protected planState?: PlanEditState;
  protected planTool: PlanTool = "select";
  protected planOffer?: PlanDraft;
  protected planDiscardAsk = false;
  /** The stored revision the plan editor started from (saving is refused if another save came). */
  private planRevision?: number;
  private planDraftTimer?: number;
  private revision?: number;
  /**
   * The overlay's change count last seen: a draft is written only when the overlay changed (a drag
   * reports its guides every frame), and a count going back means the view started a new session.
   */
  private editChanges = 0;
  /** Saving: the save's own update event is not a save from another device. */
  private saving = false;
  /** The stored revision edit mode started from (saving is refused if another save came). */
  private editRevision?: number;
  private _hass?: HomeAssistant;
  private unsubscribe?: () => void;
  private toastTimer?: number;
  /** The demo house shown instead of the home (D-050). */
  private readonly demoSwitch = new DemoSwitch(this);
  /** When the panel was opened (`performance.now()`), for the measure's first picture (D-053). */
  private openedAt?: number;
  /** The measure of this device is open (D-053), and the look it draws meanwhile. */
  protected measureOpen = false;
  protected measureLook?: LookName;
  /** What the measure is lent of the panel. */
  private readonly measureHost: MeasureHost = {
    view: () => this.view,
    // Held by the measure already: nothing else may run on the home meanwhile.
    openDemo: async () => {
      if (!this.demo) {
        await this.demoSwitch.start(
          () => !this.importChoice && !this.editing && !this.planning && !this.linking,
        );
      }
      return this.demo;
    },
    oneStorey: async () => {
      // Its ground floor alone, as every device draws it; the storey shown before, after.
      const before = { showAll: this.showAll, storey: this.storey };
      this.showAll = false;
      this.storey = undefined;
      await this.loadPlan();
      return async () => {
        // On the demo house still, when it showed another storey or all of them.
        if (!this.demo || (!before.showAll && before.storey === this.storey)) return;
        this.showAll = before.showAll;
        this.storey = before.storey;
        await this.loadPlan();
      };
    },
    setLook: async (look) => {
      this.measureLook = look;
      await this.updateComplete;
    },
    look: () => this.look,
    hold: (held) => {
      if (held && this.busy) return false;
      this.busy = held;
      return true;
    },
    firstPictureMs: () => {
      const drawn = this.view?.firstPictureAt;
      // The home's plan drawn as the panel opened, the page shown meanwhile.
      return drawn !== undefined && this.openedAt !== undefined && this.firstPlan === true
        ? drawn - this.openedAt
        : undefined;
    },
  };
  /** Whether the home had a plan when the panel opened, the page shown until it was drawn. */
  private firstPlan?: boolean;
  private readonly onPageHidden = (): void => {
    if (document.visibilityState !== "visible" && this.view?.firstPictureAt === undefined) {
      this.firstPlan = false;
    }
    // The page shown again (the screen woken): someone is there (D-076).
    if (document.visibilityState === "visible") this.quietSince = Date.now();
  };

  static override styles = [
    baseStyles,
    lookStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        /* Home Assistant's custom panel (ha-panel-custom) is as high as its content, so a
           percentage has no height to take. The panel is as high as the window (its visible part
           on phones whose bars come and go), less the screen's safe areas that element pads. */
        height: calc(100vh - var(--safe-area-inset-top, 0px) - var(--safe-area-inset-bottom, 0px));
        height: calc(100dvh - var(--safe-area-inset-top, 0px) - var(--safe-area-inset-bottom, 0px));
        background: var(--primary-background-color, #fafafa);
        /* Never wider than the screen: a toolbar too long is cut, the page does not scroll
           sideways. Menus and dialogs still go past it downwards. */
        min-width: 0;
        overflow-x: hidden; /* Safari before 16 */
        overflow-x: clip;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--header-height, 56px);
        padding: 0 12px;
        box-sizing: border-box;
        background: var(--app-header-background-color, var(--primary-color, #03a9f4));
        color: var(--app-header-text-color, var(--text-primary-color, #fff));
        border-bottom: var(--app-header-border-bottom, none);
      }
      .toolbar h1 {
        margin-block: 0;
        margin-inline: 4px 0;
        font-size: 1.25rem;
        font-weight: 400;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .toolbar button.action {
        flex: none;
        background: rgba(255, 255, 255, 0.16);
        color: inherit;
      }
      /* The header is in the primary colour: its ring is in its text's. */
      .toolbar button.action:focus-visible {
        outline-color: var(--app-header-text-color, var(--text-primary-color, #fff));
      }
      /* Phones and narrow windows: the buttons keep their icons (their names stay for screen
         readers and as tooltips). */
      :host([compact]) .toolbar {
        gap: 4px;
        padding: 0 4px;
      }
      :host([compact]) .toolbar .label {
        display: none;
      }
      :host([compact]) .toolbar button.action {
        padding: 0 8px;
      }
      .more {
        position: relative;
      }
      .more .menu {
        position: absolute;
        top: calc(100% + 8px);
        inset-inline-end: 0;
        z-index: 5;
        min-width: 220px;
        max-height: calc(100vh - 80px);
        max-height: calc(100dvh - 80px);
        overflow-y: auto;
        padding: 6px;
        display: grid;
        color: var(--primary-text-color, #1f2328);
      }
      .menu button {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 40px;
        padding: 0 12px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        white-space: nowrap;
        cursor: pointer;
      }
      .menu button:hover:not([disabled]),
      .menu button:focus-visible {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 8%, transparent);
      }
      .menu button[disabled] {
        opacity: 0.5;
        cursor: default;
      }
      .menu hr {
        width: 100%;
        margin: 4px 0;
        border: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      domotwin-view {
        flex: 1;
      }
      /* The 3D view stays while another tab shows: its engine and camera (D-055). */
      domotwin-view[hidden] {
        display: none;
      }
      domotwin-home,
      domotwin-rooms,
      domotwin-safety {
        flex: 1;
        min-width: 0;
        min-height: 0;
      }
      /* The alerts above the Home and Rooms tabs (D-068). */
      .practical {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .main {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      /* The tabs (D-055): a rail on the side of a tablet or a computer. */
      .tabs {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 4px;
        background: var(--card-background-color, #fff);
        border-inline-end: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .tabs a {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-width: 64px;
        min-height: 56px;
        padding: 4px;
        border-radius: 12px;
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.75rem;
        text-decoration: none;
      }
      .tabs a[aria-current="page"] {
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 12%,
          transparent
        );
      }
      .tabs a:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: -2px;
      }
      .tabs svg {
        width: 24px;
        height: 24px;
        fill: currentColor;
      }
      /* On a phone, at the bottom, under the thumb. */
      .tabs.bottom {
        flex-direction: row;
        gap: 0;
        padding: 0;
        border-inline-end: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .tabs.bottom a {
        flex: 1;
        border-radius: 0;
      }
      .toast {
        position: absolute;
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: min(560px, calc(100% - 32px));
        padding-block: 10px;
        padding-inline: 16px 10px;
      }
      .toast.error {
        border-color: var(--error-color, #db4437);
      }
      .toast button {
        border: none;
        background: none;
        color: inherit;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: grid;
      }
      .body {
        position: relative;
        flex: 1;
        min-width: 0;
        display: flex;
      }
      input[type="file"] {
        display: none;
      }
      .storeys {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(420px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        padding: 16px;
        display: grid;
        gap: 6px;
        z-index: 3;
      }
      .storeys h2 {
        margin: 0 0 6px;
        font-size: 1.05rem;
        font-weight: 600;
      }
      .storeys button.storey {
        display: grid;
        gap: 2px;
        text-align: start;
        padding: 10px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .storeys button.storey:hover {
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 6%, transparent);
      }
      .storeys .detail {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .storeys .footer,
      .ask .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .toast.top {
        bottom: auto;
        top: 20px;
      }
      .ask {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(380px, calc(100% - 32px));
        max-height: calc(100% - 32px);
        overflow: auto;
        padding: 16px;
        display: grid;
        gap: 12px;
        z-index: 3;
      }
      .ask h2,
      .ask p {
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
      }
      .draft {
        position: absolute;
        top: 12px;
        inset-inline-start: 12px;
        inset-inline-end: 68px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding-block: 8px;
        padding-inline: 14px 8px;
        z-index: 2;
      }
      .draft span {
        flex: 1;
        min-width: 160px;
      }
      .ask label.north {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      .ask label.north input {
        grid-column: 1 / -1;
        width: 100%;
        accent-color: var(--primary-color, #03a9f4);
      }
      .ask .look {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 10px;
      }
      .ask .look select {
        min-height: 36px;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      .ask .look .accent {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ask .look .reset {
        min-height: 32px;
        padding: 0 8px;
        border: none;
        border-radius: 8px;
        background: none;
        color: var(--primary-color, #03a9f4);
        font: inherit;
        cursor: pointer;
      }
      .ask .look input[type="color"] {
        width: 48px;
        height: 32px;
        padding: 0;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 8px;
        background: none;
      }
      .compass {
        display: flex;
        align-items: center;
        gap: 6px;
        font-variant-numeric: tabular-nums;
      }
      .compass svg {
        width: 28px;
        height: 28px;
        fill: var(--error-color, #db4437);
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 50%;
      }
      .empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .storeys.manage {
        width: min(520px, calc(100% - 32px));
        gap: 10px;
      }
      .storeys .hint {
        margin: 4px 0 0;
        font-size: 0.85rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .storey-row {
        display: grid;
        grid-template-columns: 1fr 120px auto;
        align-items: end;
        gap: 8px;
      }
      .storey-row label {
        display: grid;
        gap: 2px;
        font-size: 0.75rem;
        color: var(--secondary-text-color, #5f6368);
      }
      .storey-row input {
        box-sizing: border-box;
        min-height: 36px;
        width: 100%;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font: inherit;
        font-size: 0.875rem;
      }
      .storey-row input[aria-invalid="true"] {
        border-color: var(--error-color, #db4437);
      }
      .storey-row .icon-button {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .storey-row .icon-button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .storeys .footer {
        flex-wrap: wrap;
      }
      .ask p.hint {
        font-size: 0.85rem;
        font-weight: 400;
        color: var(--secondary-text-color, #5f6368);
      }
      .ask h3 {
        margin: 8px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      .ask .look select {
        max-width: 60%;
      }
      .ask label.reversed {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.85rem;
      }
    `,
  ];

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  set hass(hass: HomeAssistant | undefined) {
    this.demoSwitch.realHass = hass;
    this.watchWake(hass);
    if (hass) {
      // The home's doorbells and Home Assistant's alerts, whatever home is shown (D-068).
      const ring = this.doorbells.check(hass);
      if (ring) this.showRing(hass, ring);
      if (this.isConnected) this.followSecurity();
    }
    // A home kept in the page (the demo house, the sandbox) has its own Home Assistant.
    if (this.demoSwitch.home) return;
    const first = !this._hass && hass;
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
    if (first && this.isConnected) this.connectData();
    // The weekly report asked for in the address (D-081), once the user is known.
    if (hass?.user && !old?.user) this.openReportAsked();
  }

  /** The translator of the language shown, the same object while it is (the tabs keep theirs). */
  private get t(): Translator {
    const hass = this._hass;
    const language = languageOf(hass);
    if (this.translator?.language !== language) this.translator = translatorFor(hass);
    return this.translator;
  }
  private translator?: Translator;

  private get client(): DomoTwinClient | undefined {
    return this._hass ? DomoTwinClient.for(this._hass) : undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.openedAt === undefined) {
      this.openedAt = performance.now();
      if (document.visibilityState !== "visible") this.firstPlan = false;
    }
    document.addEventListener("visibilitychange", this.onPageHidden);
    if (this._hass) this.connectData();
    this.followSecurity();
    window.addEventListener("pointerdown", this.closeMore, true);
    this.addEventListener("keydown", this.onEscape);
    for (const type of ACTIVITY) window.addEventListener(type, this.onActivity, true);
    // Shown again (the screen woken, the panel opened): someone is there.
    this.quietSince = Date.now();
    this.saverTimer = setInterval(this.checkSaver, SAVER_CHECK_MS);
    this.sizeObserver = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (!width) return;
      this.panelWidth = width;
      this.tight = width < TIGHT_WIDTH;
      this.fitToolbar();
    });
    this.sizeObserver.observe(this);
    documentFonts()?.addEventListener("loadingdone", this.onFonts);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("pointerdown", this.closeMore, true);
    this.removeEventListener("keydown", this.onEscape);
    for (const type of ACTIVITY) window.removeEventListener(type, this.onActivity, true);
    clearInterval(this.saverTimer);
    clearTimeout(this.screensTimer);
    this.saverShown = false;
    document.removeEventListener("visibilitychange", this.onPageHidden);
    this.sizeObserver?.disconnect();
    this.sizeObserver = undefined;
    documentFonts()?.removeEventListener("loadingdone", this.onFonts);
    clearTimeout(this.settingsTimer);
    clearTimeout(this.choicesTimer);
    clearTimeout(this.wifiTimer);
    clearTimeout(this.ringTimer);
    this.ring = undefined;
    this.unfollowSecurity();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.planDraftTimer);
    this.cancelIfc();
  }

  /** The demo house shown, if one is (D-050). */
  private get demo(): DemoHome | undefined {
    const home = this.demoSwitch.home;
    return home?.kind === "demo" ? home : undefined;
  }

  /** The sandbox shown, if one is (D-057). */
  private get sandbox(): SandboxHome | undefined {
    const home = this.demoSwitch.home;
    return home?.kind === "sandbox" ? home : undefined;
  }

  /**
   * Whether the home shown may change for the demo house or back: nothing running on it (edit
   * mode, the plan editor, link mode, an import being read or a storey to pick).
   */
  private switchable(): boolean {
    return !this.busy && !this.importChoice && !this.editing && !this.planning && !this.linking;
  }

  /** Shows the demo house (D-050): its own Home Assistant, the home's left as it is. */
  private readonly enterDemo = async (): Promise<void> => {
    this.moreOpen = false;
    await this.demoSwitch.start(() => this.switchable());
  };

  /**
   * Shows the sandbox (D-057): the home copied, its automations, scripts and scenes read (Home
   * Assistant gives them to administrators), its day played on the copy.
   */
  private readonly enterSandbox = async (
    peakDay = false,
    draft?: { entity: string; name: string; config: Config },
  ): Promise<void> => {
    this.moreOpen = false;
    const real = this.demoSwitch.realHass ?? this._hass;
    if (!real || !this.switchable()) return;
    const t = this.t;
    this.show(t.t("sandbox.reading"));
    // An automation written in plain words (D-070), as an entity of its own.
    const session = draft ? this.plainSession : undefined;
    const revision = session?.revision;
    const played = draft
      ? {
          entity: draft.entity,
          name: draft.name,
          config: structuredClone(draft.config),
          // Only once it is shown: a sandbox read but not shown (a tool started meanwhile)
          // played no day.
          onDay: (day: DraftDay) => {
            if (revision !== undefined && this.sandbox?.draft?.entity === draft.entity) {
              session?.addDay(day, revision);
            }
          },
        }
      : undefined;
    try {
      await this.demoSwitch.show(
        () => this.switchable(),
        async () => {
          const { SandboxHome, copyHome } = await import("../sandbox/sandbox-bar");
          return new SandboxHome(await copyHome(real), {
            language: real.locale?.language ?? real.language,
            ...(real.user ? { user: real.user } : {}),
            darkMode: real.themes?.darkMode === true,
            peakDay,
            ...(played ? { draft: played } : {}),
          });
        },
      );
      // The sandbox's day is watched on the 3D view.
      if (this.sandbox && this.tab !== "3d") this.go("3d");
      const shown = this.sandbox;
      if (played && shown?.draft) {
        // The day it opened on, played before it was shown.
        const day = shown.draftDay();
        if (day && revision !== undefined) session?.addDay(day, revision);
        // The draft on the plan, as the automation wires draw an automation (D-032).
        void this.showDraftWires(played.entity);
      }
    } catch (error) {
      this.show(t.t("sandbox.failed", { reason: this.describe(error) }), true);
    }
  };

  /**
   * Draws a draft's wires (D-070) once the sandbox's plan is drawn: a plan loaded after them
   * would forget them. Given up when the sandbox is left, or after a few minutes.
   */
  private async showDraftWires(entity: string): Promise<void> {
    const until = performance.now() + LAYER_WAIT_MS;
    for (;;) {
      await this.updateComplete;
      const view = this.view;
      await view?.updateComplete;
      if (!this.isConnected || this.tab !== "3d" || this.sandbox?.draft?.entity !== entity) return;
      const drawn = view?.planDrawn();
      if (view && this.plan && drawn === "ready") {
        view.showWires([entity]);
        return;
      }
      if (drawn === "failed" || performance.now() > until) return;
      await new Promise((resolve) => setTimeout(resolve, LAYER_POLL_MS));
    }
  }

  /** Opens an automation in plain words (D-070): its module and texts, loaded the first time. */
  private readonly openPlain = async (): Promise<void> => {
    try {
      const { PlainSession } = await import("./plain-dialog");
      this.plainSession ??= new PlainSession();
      this.plainOpen = true;
    } catch (error) {
      this.show(this.describe(error), true);
    }
  };

  /** The draft played in the sandbox, beside the home's automations (D-070). */
  private readonly playPlain = async (
    event: CustomEvent<{ entity: string; name: string; config: Config }>,
  ): Promise<void> => {
    this.plainOpen = false;
    await this.enterSandbox(false, event.detail);
    // The sandbox did not open: back to the draft.
    if (!this.sandbox) this.plainOpen = true;
  };

  /** From the sandbox back to the draft it played (D-070). */
  private readonly backToPlain = (): void => {
    this.leaveDemo();
    if (!this.demoSwitch.home && this.plainSession) this.plainOpen = true;
  };

  /** The day of Hydro-Québec's announced peak, played in the sandbox (D-063). */
  private readonly playPeak = async (): Promise<void> => {
    await this.enterSandbox(true);
    // The copy said no peak after all (it ended meanwhile): its own day, and why.
    const sandbox = this.sandbox;
    if (sandbox && !sandbox.peakToday()) this.show(this.t.t("sandbox.no_peak"), true);
  };

  /** Back to the home from the demo house or the sandbox: what runs on it ends, nothing saved. */
  private readonly leaveDemo = (): void => {
    this.moreOpen = false;
    // An import running on the demo house finishes there first.
    if (!this.demoSwitch.home || this.busy) return;
    if (this.editing) this.discardEdit();
    if (this.planning) this.discardPlan();
    this.cancelIfc();
    this.demoSwitch.stop();
  };

  /** A new `hass` of the demo house's day (D-050). */
  demoChanged(hass: HomeAssistant): void {
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
  }

  /**
   * Shows another home's Home Assistant: what was read of the one before forgotten, its dialogs
   * closed, its answers still on their way dropped.
   */
  showHome(hass: HomeAssistant | undefined): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.settingsTimer);
    this.ringWaiting = undefined;
    this.loads += 1;
    this.linking = false;
    this.linkTarget = undefined;
    this.placing = undefined;
    this.northDraft = undefined;
    this.lookDraft = undefined;
    this.energyDraft = undefined;
    this.energyPreferred = undefined;
    this.weatherDraft = undefined;
    this.roofDraft = undefined;
    this.peopleOpen = false;
    this.peopleSettings = undefined;
    this.bluetoothOpen = false;
    this.locating = undefined;
    this.privacyRooms = undefined;
    this.guestsStoreys = undefined;
    this.rightsStoreys = undefined;
    this.voiceOpen = false;
    this.configHistoryOpen = false;
    this.plainOpen = false;
    this.reportOpen = false;
    this.storeysOpen = false;
    this.storeyRemoveAsk = undefined;
    this.plan = undefined;
    this.layout = undefined;
    this.planError = undefined;
    this.bindings = undefined;
    this.bindingsRead = false;
    this.elsewhereRead = false;
    this.settings = undefined;
    this.settingsRead = false;
    this.upkeep = undefined;
    this.wifi = undefined;
    this.people = undefined;
    this.storeys = [];
    this.storey = undefined;
    this.showAll = false;
    this.home = undefined;
    this.elsewhere = [];
    this.toast = undefined;
    this.choices = undefined;
    this.choicesRead = false;
    clearTimeout(this.choicesTimer);
    clearTimeout(this.wifiTimer);
    this.choicesOpen = false;
    this.screens = undefined;
    this.screensRead = false;
    clearTimeout(this.screensTimer);
    this.screensOpen = false;
    const old = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", old);
    if (hass && this.isConnected) this.connectData();
  }

  private connectData(): void {
    const client = this.client;
    if (!client || this.unsubscribe) return;
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "show") void this.showRequest(event.show);
      else if (event.kind === "plan") void this.loadPlan();
      else if (event.kind === "bindings") void this.loadBindings();
      else if (event.kind === "upkeep") void this.loadUpkeep();
      else if (event.kind === "people") void this.loadPeople();
      else if (event.kind === "wifi") void this.loadWifi();
      else if (event.kind === "screens") void this.loadScreens();
      // The lawns (D-077) are the view's.
      else if (event.kind !== "garden") void this.loadSettings();
    });
    void this.loadPlan();
    void this.loadBindings();
    void this.loadSettings();
    void this.loadUpkeep();
    void this.loadPeople();
    void this.loadChoices();
    void this.loadWifi();
    void this.loadScreens();
  }

  /**
   * Follows the alerts an administrator chose on Home Assistant's Security page (D-068), where Home
   * Assistant keeps them (2026.9 and later): its system data, sent again whenever it changes.
   */
  private followSecurity(): void {
    const hass = this.demoSwitch.realHass ?? this._hass;
    if (this.securityFollowed || !hass || !securityAlertsKept(hass)) return;
    this.securityFollowed = hass.connection
      .subscribeMessage<{ value?: unknown }>(
        (message) => {
          this.securityChoices = readSecurityAlerts(message.value);
        },
        { type: "frontend/subscribe_system_data", key: "security" },
      )
      // Refused (a Home Assistant that changed it): no alert of its own is shown.
      .catch(() => undefined);
  }

  private unfollowSecurity(): void {
    const followed = this.securityFollowed;
    this.securityFollowed = undefined;
    this.securityChoices = [];
    void followed?.then((unsubscribe) => unsubscribe?.()).catch(() => undefined);
  }

  /**
   * A doorbell rang (D-068): shown full screen, its module loaded the first time, for two minutes
   * unless closed or rung again. Not one the viewer may not see (D-039), nor over the demo house or
   * the sandbox, which are homes of their own.
   */
  private showRing(hass: HomeAssistant, ring: Ring): void {
    if (this.demoSwitch.home) return;
    // Who may see what is known once the settings are read (D-039): the ring waits for them.
    if (!this.settingsRead) {
      this.ringWaiting = ring;
      return;
    }
    if (!seen(this.practical(hass).unseen, ring.entity, areaOf(hass, ring.entity))) return;
    this.ring = ring;
    this.wakeScreen();
    clearTimeout(this.ringTimer);
    this.ringTimer = setTimeout(() => {
      this.ring = undefined;
    }, RING_SHOWN_MS);
    this.doorbellModule ??= import("./doorbell").then(
      () => {
        this.doorbellReady = true;
      },
      () => {
        // Offline, or DomoTwin updated meanwhile: tried again at the next ring.
        this.doorbellModule = undefined;
      },
    );
  }

  private readonly closeRing = (): void => {
    clearTimeout(this.ringTimer);
    this.ring = undefined;
  };

  /**
   * The Wi-Fi as this user may see it in the panel. Not read (Home Assistant starting), it is asked
   * for again in a while; an integration older than D-060 has none.
   */
  private async loadWifi(): Promise<void> {
    const client = this.client;
    if (!client) return;
    clearTimeout(this.wifiTimer);
    try {
      const wifi = await client.getWifi(this.deviceScreen ?? "");
      if (client === this.client) this.wifi = wifi;
    } catch (error) {
      if (client !== this.client) return;
      this.wifi = undefined;
      if (isHassError(error) && error.code === "unknown_command") return;
      if (this.unsubscribe) {
        this.wifiTimer = setTimeout(() => void this.loadWifi(), SETTINGS_RETRY_MS);
      }
    }
  }

  /**
   * The user's own choices (D-055). Not read (Home Assistant starting), none are shown and they
   * are asked for again in a while, the dialog that changes them closed meanwhile; an integration
   * older than D-055 has none.
   */
  private async loadChoices(): Promise<void> {
    const client = this.client;
    if (!client) return;
    clearTimeout(this.choicesTimer);
    try {
      const choices = await client.getChoices();
      if (client === this.client) {
        this.choices = choices;
        this.choicesRead = true;
      }
    } catch (error) {
      if (client !== this.client) return;
      this.choices ??= NO_CHOICES;
      if (isHassError(error) && error.code === "unknown_command") return;
      if (this.unsubscribe) {
        this.choicesTimer = setTimeout(() => void this.loadChoices(), SETTINGS_RETRY_MS);
      }
    }
  }

  /**
   * The wall screens' layouts (D-076). Not read (Home Assistant starting), a screen opens on what
   * it would without and they are asked for again in a while; an integration older than D-076 has
   * none.
   */
  private async loadScreens(): Promise<void> {
    const client = this.client;
    if (!client) return;
    clearTimeout(this.screensTimer);
    try {
      const screens = await client.getScreens();
      if (client === this.client) {
        this.screens = screens;
        this.screensRead = true;
        // This device's screen removed meanwhile: its saver goes with it.
        if (!this.screenLayout) this.saverShown = false;
      }
    } catch (error) {
      if (client !== this.client) return;
      // Not known is not none: the screens stay unknown (a device's own not said removed), and
      // the device opens on what it would without.
      this.screensRead = true;
      if (isHassError(error) && error.code === "unknown_command") return;
      if (this.unsubscribe) {
        this.screensTimer = setTimeout(() => void this.loadScreens(), SETTINGS_RETRY_MS);
      }
    }
  }

  /** The layout of the wall screen this device is, when it is one and the screen is still there. */
  private get screenLayout(): ScreenLayout | undefined {
    const screens = this.screens;
    const name = screens ? screenNamed(screens, this.deviceScreen) : undefined;
    return name ? screens?.[name] : undefined;
  }

  /**
   * Someone touched the screen, pressed a key or scrolled: not quiet. A key wakes it, and does
   * nothing else; so does a touch while the saver is not drawn yet (its module on its way), lest
   * it come later over someone using the screen. A touch on the saver drawn wakes it on its own.
   */
  private readonly onActivity = (event: Event): void => {
    this.quietSince = Date.now();
    if (!this.saverShown) return;
    if (event.type === "keydown") {
      event.preventDefault();
      event.stopPropagation();
      this.wakeScreen();
    } else if (!this.saverDrawn) this.wakeScreen();
  };

  /** The saver is drawn over the panel: its module loaded, this device's screen still there. */
  private get saverDrawn(): boolean {
    return this.saverShown && this.saverReady && !!this.screenLayout;
  }

  /** Someone before the screen, as its sensors say (D-076): not quiet, and woken. */
  private watchWake(hass: HomeAssistant | undefined): void {
    const wake = this.screenLayout?.saver.wake;
    if (!wake?.length || !someoneThere(hass, wake)) return;
    this.quietSince = Date.now();
    if (this.saverShown) this.wakeScreen();
  }

  /**
   * The screen saver comes once the screen was quiet long enough (D-076): not while a tool runs
   * (what is drawn or linked would wait under it), a doorbell rings, another home is shown or the
   * page is hidden.
   */
  private readonly checkSaver = (): void => {
    if (!this.deviceScreen) return;
    const layout = this.screenLayout;
    if (!layout || this.saverShown || this.ring || this.demoSwitch.home) return;
    if (this.editing || this.planning || this.linking || document.visibilityState !== "visible") {
      return;
    }
    // Someone still there, the sensor on and nothing else changed meanwhile: not quiet.
    if (someoneThere(this.demoSwitch.realHass, layout.saver.wake)) {
      this.quietSince = Date.now();
      return;
    }
    if (!saverDue(layout.saver, this.quietSince, Date.now())) return;
    this.saverShown = true;
    // Back on its tab under the saver, for whoever comes next.
    const own = layout.start ?? this.deviceStart;
    const start = startTab(this.choices ?? NO_CHOICES, own, canDraw3d());
    // Its tab alone: a room, its graphs or a report left open are closed.
    if (this.tab !== start || this.roomOpen !== undefined || this.report !== undefined) {
      this.go(start, undefined, false, true);
    }
    this.saverModule ??= import("./saver").then(
      () => {
        this.saverReady = true;
      },
      () => {
        // Offline, or DomoTwin updated meanwhile: tried again the next time it is due.
        this.saverModule = undefined;
        this.saverShown = false;
        this.quietSince = Date.now();
      },
    );
  };

  /** The screen woken: the saver goes, and the wait starts again. */
  private readonly wakeScreen = (): void => {
    this.quietSince = Date.now();
    this.saverShown = false;
  };

  /** A wall screen's saver (D-076), over every tab but a doorbell ringing. */
  private renderSaver(): TemplateResult | typeof nothing {
    const saver = this.screenLayout?.saver;
    const hass = this._hass;
    if (!this.saverDrawn || !saver || !hass) return nothing;
    return html`<domotwin-saver
      .hass=${hass}
      .t=${this.t}
      .saver=${saver}
      .weather=${this.settings?.weather}
      @domotwin-wake=${this.wakeScreen}
    ></domotwin-saver>`;
  }

  /** Stars an entity, or takes its star away (D-055): shown at once, kept by the integration. */
  private readonly onFavourite = async (
    event: CustomEvent<{ entity: string; favourite: boolean }>,
  ): Promise<void> => {
    const client = this.client;
    if (!client) return;
    const { entity, favourite } = event.detail;
    // Shown at once; the integration's list is taken from the answer to the last star only, so
    // that a quicker answer to an earlier one does not take a later star away meanwhile.
    const star = (on: boolean): void => {
      const choices = this.choices ?? NO_CHOICES;
      const others = choices.favourites.filter((id) => id !== entity);
      this.choices = { ...choices, favourites: on ? [...others, entity] : others };
    };
    star(favourite);
    const ticket = ++this.stars;
    try {
      const favourites = await client.setFavourite(entity, favourite);
      if (client === this.client && ticket === this.stars) {
        this.choices = { ...(this.choices ?? NO_CHOICES), favourites };
      }
    } catch (error) {
      if (client !== this.client) return;
      // This star alone, put back.
      star(!favourite);
      this.show(this.t.t("rooms.star_failed", { reason: this.describe(error) }), true);
    }
  };

  /** Without people's settings (an integration older than D-034 too) nobody is drawn. */
  private async loadPeople(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const people = await client.getPeople();
      if (client === this.client) this.people = people;
    } catch {
      if (client === this.client) this.people = undefined;
    }
  }

  /** Without upkeep cards (an integration older than D-033 too) nothing is due. */
  private async loadUpkeep(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const { upkeep } = await client.getUpkeep();
      if (client === this.client) this.upkeep = upkeep;
    } catch {
      if (client === this.client) this.upkeep = undefined;
    }
  }

  /** `domotwin.show` (D-029), when no tool runs; a request naming a screen is this device's if
   * it is that wall screen (D-076), else a card's: the storey asked for, then what to frame. */
  private async showRequest(request: ShowRequest): Promise<void> {
    const client = this.client;
    const mine = forScreen(request, this.deviceScreen);
    if (!client || !this.hass || !mine || this.editing || this.planning || this.linking) {
      return;
    }
    this.wakeScreen();
    const shown = this.wholeHome() ? ALL_STOREYS : this.storey;
    const ticket = ++this.shows;
    const target = await resolveShow(
      client,
      this.t,
      this.storeys,
      { plan: this.plan, storey: shown },
      request,
      closedRooms(this.settings?.rooms, this.settings?.rights, this.hass),
    );
    if (!target || ticket !== this.shows) return;
    // Shown in 3D, from the other tabs too (not one more step back for each request).
    if (this.tab !== "3d") {
      this.go("3d", undefined, false, true);
      await this.updateComplete;
    }
    if (target.storey !== undefined && target.storey !== shown) {
      this.showAll = target.storey === ALL_STOREYS;
      if (!this.showAll) this.storey = target.storey;
      await this.loadPlan();
      await this.updateComplete;
    }
    const view = await this.drawnView(ticket);
    view?.show(target);
  }

  /**
   * The 3D view once it has drawn the plan (shown for the first time, its engine loads first);
   * none if another request (`ticket`, of `shows`) came meanwhile.
   */
  private async drawnView(ticket: number): Promise<DomoTwinView | undefined> {
    const view = this.view;
    await view?.updateComplete;
    while (view?.planDrawn() === "waiting") {
      await nextFrame();
      if (ticket !== this.shows) return undefined;
    }
    return ticket === this.shows ? (view ?? undefined) : undefined;
  }

  /**
   * The settings; unreadable, those read before stay (their private rooms, D-039), and never read,
   * they are asked for again in a while, the home not shown meanwhile.
   */
  private async loadSettings(): Promise<void> {
    const client = this.client;
    if (!client) return;
    clearTimeout(this.settingsTimer);
    try {
      const { settings } = await client.getSettings();
      // Another home's meanwhile (the demo house, D-050): not this one's.
      if (client !== this.client) return;
      this.settings = settings;
      this.settingsRead = true;
      const waiting = this.ringWaiting;
      this.ringWaiting = undefined;
      if (waiting && this._hass && nowOf(this._hass) - waiting.at <= RING_FRESH_MS) {
        this.showRing(this._hass, waiting);
      }
    } catch {
      if (client === this.client && !this.settingsRead && this.unsubscribe) {
        this.settingsTimer = setTimeout(() => void this.loadSettings(), SETTINGS_RETRY_MS);
      }
    }
  }

  /**
   * Opens the Bluetooth locating's settings (D-035): their module (loaded the first time), the
   * receivers and the devices followed.
   */
  private readonly openBluetooth = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    this.bluetoothModule ??= import("./bluetooth-settings");
    this.busy = true;
    try {
      const [, locating] = await Promise.all([this.bluetoothModule, client.getLocating()]);
      this.locating = locating;
      this.bluetoothOpen = true;
    } catch (error) {
      this.bluetoothModule = undefined;
      this.show(this.describe(error), true);
    } finally {
      this.busy = false;
    }
  };

  /**
   * Opens the people's settings (D-034): their module (loaded the first time) and the people with
   * the entities that may say where they are.
   */
  private readonly openPeople = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    this.peopleModule ??= import("./people-settings");
    this.busy = true;
    try {
      const [, settings] = await Promise.all([this.peopleModule, client.getPeopleWithCandidates()]);
      this.peopleSettings = settings;
      this.peopleOpen = true;
    } catch (error) {
      this.peopleModule = undefined;
      this.show(this.describe(error), true);
    } finally {
      this.busy = false;
    }
  };

  /**
   * Opens the private rooms' settings (D-039): their module (loaded the first time) and the rooms
   * of every storey.
   */
  private readonly openPrivacy = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    this.privacyModule ??= import("./private-rooms");
    this.busy = true;
    try {
      const [, home] = await Promise.all([
        this.privacyModule,
        this.storeys.length > 1 ? loadHome(client, this.storeys) : Promise.resolve([]),
      ]);
      this.privacyRooms =
        home.length > 1
          ? home.flatMap((storey) =>
              planRooms(storey.plan).map((room) => ({ ...room, storey: storey.name })),
            )
          : planRooms(this.plan);
    } catch (error) {
      this.privacyModule = undefined;
      this.show(this.describe(error), true);
    } finally {
      this.busy = false;
    }
  };

  private readonly openSettings = (): void => {
    this.northDraft = this.settings?.north ?? 0;
    this.lookDraft = { theme: this.settings?.theme ?? "auto" };
    if (this.settings?.accent) this.lookDraft.accent = this.settings.accent;
    this.energyDraft = { ...(this.settings?.energy ?? {}) };
    this.weatherDraft = this.settings?.weather ?? "";
    this.roofDraft = { ...this.settings?.roof };
    void this.loadEnergyPreferred();
  };

  /** Home Assistant's own energy settings, for the sensors they name (none when they cannot be
   * read). */
  private async loadEnergyPreferred(): Promise<void> {
    const hass = this._hass;
    if (this.energyPreferred || !hass) return;
    let prefs: unknown = null;
    try {
      prefs = await hass.connection.sendMessagePromise({ type: "energy/get_prefs" });
    } catch {
      // None read: none preferred.
    }
    if (hass.connection === this._hass?.connection) this.energyPreferred = preferredFromHome(prefs);
  }

  private readonly saveSettings = async (): Promise<void> => {
    const client = this.client;
    const north = this.northDraft;
    if (!client || north === undefined) return;
    this.busy = true;
    try {
      const settings: Settings = { ...this.settings, north };
      // The look is stored once one is chosen (automatic and the default accent until then).
      const look = this.lookDraft;
      if (look && (look.theme !== "auto" || settings.theme !== undefined)) {
        settings.theme = look.theme;
      }
      if (look?.accent !== undefined) settings.accent = look.accent;
      else if (look) delete settings.accent;
      if (this.energyDraft) {
        const energy = readEnergy(this.energyDraft);
        if (energy) settings.energy = energy;
        else delete settings.energy;
      }
      if (this.weatherDraft) settings.weather = this.weatherDraft;
      else if (this.weatherDraft !== undefined) delete settings.weather;
      // The roof as chosen; all its defaults, none stored.
      const roof = this.roofDraft;
      if (roof && Object.keys(roof).length > 0) settings.roof = roof;
      else if (roof) delete settings.roof;
      await client.saveSettings(settings);
      this.settings = settings;
      this.northDraft = undefined;
      this.show(this.t.t("settings.saved"));
    } catch (error) {
      const t = this.t;
      const reason = isHassError(error) ? t.error(error.code) : t.error("unknown");
      this.show(t.t("settings.save_failed", { reason }), true);
    } finally {
      this.busy = false;
    }
  };

  /** Without bindings the home still shows, without live states. */
  private async loadBindings(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const bindings = readBindings((await client.getBindings()).bindings);
      if (client === this.client) this.bindings = bindings;
    } catch {
      if (client === this.client) this.bindings = undefined;
    }
    if (client === this.client) this.bindingsRead = true;
  }

  private async loadPlan(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const ticket = ++this.loads;
    try {
      // The storey shown, or the ground floor when it was removed (here or elsewhere); every
      // storey's too to show them all, before anything changes (D-028: two with a plan at least).
      const stored = await loadStorey(client, this.storey);
      const storeys =
        this.showAll && stored.storeys.length > 1 ? await loadHome(client, stored.storeys) : [];
      const home = storeys.length > 1 ? storeys : undefined;
      // A later load (another storey asked for) wins.
      if (ticket !== this.loads) return;
      const started = this.editing ? this.editRevision : this.planRevision;
      if ((this.editing || this.planning) && !this.saving && stored.revision !== started) {
        // Saved elsewhere: the view keeps the plan being edited; saving will be refused.
        this.show(this.t.t("edit.changed_elsewhere"), true);
      }
      this.plan = stored.plan;
      // The first picture measured is of a plan there as the panel opened (D-053).
      if (!this.demoSwitch.home) this.firstPlan ??= stored.plan !== null;
      this.layout = stored.layout;
      this.storeys = stored.storeys;
      this.storey = stored.storey ?? undefined;
      void this.loadElsewhere(client, stored);
      this.revision = stored.revision;
      this.planError = undefined;
      this.showAll &&= home !== undefined;
      this.home = home;
    } catch (error) {
      // A later load's, or another home's (the demo house, D-050), is not this one's.
      if (ticket !== this.loads) return;
      this.planError = isHassError(error) ? error.code : "unknown";
      this.firstPlan ??= false;
    }
  }

  /** The rooms of the other storeys (plans the client has are not fetched again). */
  private async loadElsewhere(client: DomoTwinClient, stored: StoredPlan): Promise<void> {
    this.elsewhereRead = false;
    const elsewhere =
      stored.storeys.length > 1 ? await roomsElsewhere(client, stored.storeys, stored.storey) : [];
    // Another storey shown meanwhile, or another home: its own load sets them.
    if (client === this.client && (stored.storey ?? undefined) === this.storey) {
      this.elsewhere = elsewhere;
      this.elsewhereRead = true;
    }
  }

  private show(text: string, error = false): void {
    this.toast = { text, error };
    window.clearTimeout(this.toastTimer);
    if (!error) this.toastTimer = window.setTimeout(() => (this.toast = undefined), TOAST_MS);
  }

  private describe(error: unknown): string {
    if (error instanceof EngineError) return this.t.errorAt(error.code, error.element);
    if (isHassError(error)) return this.t.error(error.code);
    if (error instanceof TranslatedError) return error.message;
    return this.t.error(error instanceof Error ? error.name : "unknown");
  }

  private get view(): DomoTwinView | null {
    return this.renderRoot.querySelector("domotwin-view");
  }

  private readonly startEdit = async (): Promise<void> => {
    if (!this.plan || this.busy || this.editing || this.planning) return;
    await import("./edit-bar");
    this.linking = false;
    this.linkTarget = undefined;
    // A north being set and not saved is dropped.
    this.northDraft = undefined;
    this.multi = false;
    this.busy = true;
    try {
      // Pieces added take no id another storey uses (D-026).
      this.planReserved = await this.otherIds(this.storey);
    } catch {
      // Saving would be refused (`duplicate_id`) if one clashed.
      this.planReserved = [];
    } finally {
      this.busy = false;
    }
    this.editRevision = this.revision;
    this.editChanges = 0;
    const draft =
      this.revision === undefined ? undefined : readDraft(this.revision, this.editDraftStorey());
    if (draft && JSON.stringify(draft.layout) !== JSON.stringify(this.layout ?? {})) {
      this.draft = draft;
    }
    this.editing = true;
  };

  private stopEditing(): void {
    this.editing = false;
    this.edit = undefined;
    this.multi = false;
    this.catalogue = undefined;
    this.modelImport = undefined;
    this.discardAsk = false;
    this.draft = undefined;
  }

  /** Every change of the edit session: kept as a draft while it is not saved. */
  private readonly onEdit = (event: Event): void => {
    const state = (event as CustomEvent<EditState>).detail;
    this.edit = state.editing ? state : undefined;
    if (!state.editing || state.changes === this.editChanges) return;
    const restarted = state.changes < this.editChanges;
    this.editChanges = state.changes;
    if (restarted) {
      // The view started a new session (its engine restarted): offer what was kept.
      const draft =
        this.editRevision === undefined
          ? undefined
          : readDraft(this.editRevision, this.editDraftStorey());
      if (draft) this.draft = draft;
      return;
    }
    const layout = state.dirty ? this.view?.editLayout() : undefined;
    if (layout && this.editRevision !== undefined) {
      writeDraft({ revision: this.editRevision, storey: this.editDraftStorey(), layout });
    } else if (!this.draft) {
      // Undone back to what is stored: nothing left to keep.
      clearDraft(this.editDraftStorey());
    }
  };

  private readonly onEditCommand = (event: Event): void => {
    this.view?.editCommand((event as CustomEvent<EditCommand>).detail);
  };

  private readonly openCatalogue = async (): Promise<void> => {
    this.models = this.view?.editModels() ?? [];
    this.catalogue = await catalogue();
  };

  private readonly onAdd = (event: Event): void => {
    const { kind, style, name } = (
      event as CustomEvent<{ kind: string; style?: string; name: string }>
    ).detail;
    this.catalogue = undefined;
    this.view?.editAdd(kind, name, style);
  };

  private readonly onAddModel = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.catalogue = undefined;
    this.view?.editAddModel(id);
  };

  private readonly onForgetModel = (event: Event): void => {
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this.view?.editRemoveModel(id);
    this.models = this.view?.editModels() ?? [];
  };

  private readonly chooseModel = (): void => {
    if (this.busy) return;
    this.renderRoot.querySelector<HTMLInputElement>("input.model-file")?.click();
  };

  /** Reads a 3D file with the model module (loaded now), then asks for its name and size. */
  private readonly readModelFile = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.show(t.t("edit.model_reading", { name: file.name }));
    try {
      const { MAX_MODEL_BYTES, formatOf, readModel } = await import("../models/models");
      const format = formatOf(file.name);
      if (!format) throw new EngineError("not_model");
      if (file.size > MAX_MODEL_BYTES) throw new EngineError("too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = await readModel(bytes, format);
      this.toast = undefined;
      this.catalogue = undefined;
      this.modelImport = { fileName: file.name, format, bytes, ...read };
    } catch (error) {
      this.show(t.t("edit.model_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  /** Uploads the file being imported and adds a piece of its new model. */
  private readonly confirmModel = async (event: Event): Promise<void> => {
    const choice = (event as CustomEvent<ModelChoice>).detail;
    const pending = this.modelImport;
    const hass = this._hass;
    if (!pending || !hass || this.busy) return;
    const t = this.t;
    this.busy = true;
    try {
      const stored = (this.view?.editModels() ?? []).reduce((sum, m) => sum + (m.bytes ?? 0), 0);
      if (stored + pending.bytes.length > MAX_MODELS_BYTES)
        throw new EngineError("models_too_large");
      const { keepMesh, newModelId, uploadModel } = await import("../models/models");
      const uploaded = await uploadModel(hass, pending.bytes, pending.format);
      keepMesh(uploaded.hash, pending.mesh);
      const definition: Record<string, unknown> = {
        name: choice.name,
        size: choice.size,
        file: {
          format: pending.format,
          hash: uploaded.hash,
          bytes: uploaded.bytes,
          up: choice.up,
        },
      };
      if (choice.color) definition.color = choice.color;
      this.modelImport = undefined;
      this.view?.editAddModel(newModelId(), definition, {
        hash: uploaded.hash,
        mesh: pending.mesh,
      });
    } catch (error) {
      this.show(t.t("edit.model_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  private readonly restoreDraft = (): void => {
    const draft = this.draft;
    this.draft = undefined;
    if (draft) this.view?.editRestore(draft.layout);
  };

  private readonly forgetDraft = (): void => {
    this.draft = undefined;
    clearDraft(this.editDraftStorey());
  };

  /**
   * Saves the overlay. Changes made while it is on its way stay in edit mode, to be saved too;
   * otherwise edit mode ends.
   */
  private readonly saveEdit = async (): Promise<void> => {
    const view = this.view;
    const client = this.client;
    const sent = view?.editLayout();
    if (!view || !client || !sent || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.saving = true;
    try {
      const revision = await client.saveLayout(sent, this.editRevision, this.storey);
      this.editRevision = revision;
      // The home shown whole comes back with what was saved, not before.
      this.home = undefined;
      view.editSaved(sent);
      const now = view.editLayout();
      if (now && JSON.stringify(now) !== JSON.stringify(sent)) {
        writeDraft({ revision, storey: this.editDraftStorey(), layout: now });
      } else {
        clearDraft(this.editDraftStorey());
        this.stopEditing();
      }
      await this.loadPlan();
      this.show(t.t("edit.saved"));
    } catch (error) {
      this.show(t.t("edit.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
      this.saving = false;
    }
  };

  private readonly cancelEdit = (): void => {
    if (this.edit?.dirty) {
      this.discardAsk = true;
      return;
    }
    this.discardEdit();
  };

  private readonly discardEdit = (): void => {
    // A draft still offered stays, unless changes were discarded on purpose.
    if (this.edit?.dirty || !this.draft) clearDraft(this.editDraftStorey());
    this.view?.endEdit(false);
    this.stopEditing();
  };

  /**
   * Starts the plan editor: on the plan shown, or on a new plan when none is stored or for a new
   * storey (`newStorey`).
   */
  private async startPlanFor(newStorey: boolean): Promise<void> {
    if (this.busy || this.editing || this.planning || this.plan === undefined) return;
    this.busy = true;
    try {
      await import("./plan-bar");
      // Ids are the home's: those of the other storeys are not given to new elements.
      this.planReserved = await this.otherIds(newStorey ? undefined : this.storey);
    } catch (error) {
      this.show(this.t.t("plan.open_failed", { reason: this.describe(error) }), true);
      return;
    } finally {
      this.busy = false;
    }
    this.linking = false;
    this.linkTarget = undefined;
    this.northDraft = undefined;
    this.storeysOpen = false;
    this.planNew = newStorey;
    this.planRevision = this.revision;
    this.planTool = this.plan && !newStorey ? "select" : "room";
    this.planOffer =
      this.revision === undefined ? undefined : readPlanDraft(this.revision, this.draftStorey());
    this.planning = true;
  }

  private readonly startPlan = (): void => {
    void this.startPlanFor(false);
  };

  /** What the plan editor's draft is kept for: the storey shown, or "" for a new storey. */
  private draftStorey(): string {
    return this.draftKey(this.planNew ? "" : (this.storey ?? ""));
  }

  /** What edit mode's draft is kept for: the storey shown. */
  private editDraftStorey(): string {
    return this.draftKey(this.storey ?? "");
  }

  /** The drafts of a home kept in the page (D-050, D-057) are its own, never the home's. */
  private draftKey(storey: string): string {
    return this.demoSwitch.home ? `demo/${storey}` : storey;
  }

  /** The ids every storey but `except` uses. */
  private async otherIds(except?: string): Promise<string[]> {
    const client = this.client;
    return client ? idsElsewhere(client, this.storeys, except) : [];
  }

  /** A plan joining the home (an import): its ids that other storeys use are changed. */
  private async ownIds(plan: PlanJson, except?: string): Promise<PlanJson> {
    const taken = await this.otherIds(except);
    if (taken.length === 0) return plan;
    const { freeIds } = await import("../planner/planner");
    return await freeIds(plan, taken);
  }

  /**
   * Where a new storey goes: 2.8 m above the highest one, on the ground (0) when that is within
   * 1 m of it (a home with only a cellar), within the 1 000 m a height may be.
   */
  private nextElevation(): number {
    if (this.storeys.length === 0) return 0;
    const next = Math.max(...this.storeys.map((storey) => storey.elevation)) + 280;
    return Math.abs(next) < 100 ? 0 : Math.min(next, MAX_ELEVATION);
  }

  private stopPlanning(): void {
    window.clearTimeout(this.planDraftTimer);
    this.planning = false;
    this.planNew = false;
    this.planState = undefined;
    this.planOffer = undefined;
    this.planDiscardAsk = false;
  }

  /** Every change of the plan editor: a refused change said, the plan drawn kept by the browser. */
  private readonly onPlanEdit = (event: Event): void => {
    const state = (event as CustomEvent<PlanEditState>).detail;
    const before = this.planState;
    this.planState = state;
    const t = this.t;
    if (state.error && state.refusals !== before?.refusals) {
      this.show(
        state.error === "no_side"
          ? t.t("plan.no_side")
          : t.t("plan.refused", { reason: t.error(state.error) }),
        true,
      );
    }
    window.clearTimeout(this.planDraftTimer);
    this.planDraftTimer = window.setTimeout(() => {
      this.keepPlanDraft();
    }, PLAN_DRAFT_MS);
  };

  private keepPlanDraft(): void {
    const revision = this.planRevision;
    if (!this.planning || revision === undefined) return;
    const plan = this.planState?.dirty ? this.view?.planDraft() : undefined;
    if (plan) writePlanDraft({ revision, storey: this.draftStorey(), plan });
    else if (!this.planOffer) clearPlanDraft(this.draftStorey());
  }

  private readonly onPlanCommand = (event: Event): void => {
    this.view?.planCommand((event as CustomEvent<PlanCommand>).detail);
  };

  private readonly onPlanUpdate = (event: Event): void => {
    this.view?.planUpdate((event as CustomEvent<Record<string, unknown>>).detail);
  };

  private readonly restorePlanDraft = (): void => {
    const offer = this.planOffer;
    this.planOffer = undefined;
    if (offer) this.view?.planRestore(offer.plan);
  };

  private readonly forgetPlanDraft = (): void => {
    this.planOffer = undefined;
    clearPlanDraft(this.draftStorey());
  };

  /**
   * Saves the plan drawn, its edit overlay in it (the stored overlay is emptied), and leaves the
   * plan editor. Refused when another device saved since it started.
   */
  private readonly savePlanEdit = async (): Promise<void> => {
    const view = this.view;
    const client = this.client;
    const plan = view?.planDraft();
    if (!view || !client || !plan || this.busy) return;
    const t = this.t;
    this.busy = true;
    this.saving = true;
    try {
      if (this.planNew) {
        const added = await client.saveStorey(
          { plan, layout: {}, elevation: this.nextElevation() },
          this.planRevision,
        );
        this.storey = added.storey;
      } else {
        await client.savePlan(plan, this.planRevision, {}, this.storey);
      }
      this.home = undefined;
      view.planSaved();
      clearPlanDraft(this.draftStorey());
      view.endPlanEdit(true);
      this.stopPlanning();
      await this.loadPlan();
      this.show(t.t("plan.saved"));
    } catch (error) {
      this.show(t.t("plan.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
      this.saving = false;
    }
  };

  private readonly cancelPlan = (): void => {
    if (this.planState?.dirty) {
      this.planDiscardAsk = true;
      return;
    }
    this.discardPlan();
  };

  private readonly discardPlan = (): void => {
    // A draft still offered stays, unless changes were discarded on purpose.
    if (this.planState?.dirty || !this.planOffer) clearPlanDraft(this.draftStorey());
    this.view?.endPlanEdit(false);
    this.stopPlanning();
  };

  private readonly toggleLinking = (): void => {
    this.linking = !this.linking;
    this.linkTarget = undefined;
    this.placing = undefined;
    this.northDraft = undefined;
  };

  /** A piece's bubble asked for its links (D-047): link mode, with its editor open. */
  private readonly onLinkElement = async (event: Event): Promise<void> => {
    this.linking = true;
    this.linkTarget = undefined;
    this.placing = undefined;
    await this.onPick(event);
  };

  /** Link mode: an element was picked in the view, open its editor. */
  private readonly onPick = async (event: Event): Promise<void> => {
    const picked = (event as CustomEvent<PickedElement>).detail;
    const hass = this._hass;
    const element = planElement(this.plan, picked.id);
    if (!hass || !element) return;
    await import("./link-editor");
    const bindings = this.bindings ?? { version: 1, rooms: {}, elements: {} };
    const roomId = element.type === "room" ? element.id : picked.room || element.parent;
    const target: LinkTarget = { element };
    let binding = bindings.elements[element.id];
    const placing = this.placing;
    if (placing && element.type === "room") {
      // A device of the network map is being placed: a piece, a door or a window stands for it,
      // not a room.
      this.show(this.t.t("network.place_hint", { name: placing.name }));
      return;
    }
    if (placing) {
      // The device being placed: its entities worth linking, with what the piece already had,
      // and itself unless the piece already stands for another device (its entities place it).
      const entities = [...(binding?.entities ?? [])];
      let added = 0;
      let left = 0;
      for (const id of placing.entities) {
        if (!shownEntity(hass, id) || entities.some((e) => e.entity_id === id)) continue;
        if (entities.length < MAX_ENTITIES) {
          entities.push({ entity_id: id });
          added += 1;
        } else left += 1;
      }
      const taken = binding?.device !== undefined && binding.device !== placing.deviceId;
      if (taken && added === 0) {
        // Nothing would place it there: another piece is needed.
        this.show(this.t.t("network.place_taken", { name: placing.name }));
        return;
      }
      this.placing = undefined;
      if (left > 0) this.show(this.t.tp("network.place_full", left));
      binding = { ...binding, entities };
      if (placing.deviceId && !taken) binding.device = placing.deviceId;
    }
    if (binding) target.binding = binding;
    const area = element.type === "room" ? bindings.rooms[element.id]?.area : undefined;
    if (area) target.area = area;
    if (element.type === "room") {
      target.roomActions = bindings.rooms[element.id]?.actions ?? [];
      // Where the view places the pieces (the plan's own rooms, its edits); the plan's otherwise.
      const pieces = this.view?.piecesIn(element.id) ?? roomPieces(this.plan, element.id);
      target.pieceEntities = pieces.flatMap(
        (id) => bindings.elements[id]?.entities.map((entity) => entity.entity_id) ?? [],
      );
    }
    if (roomId) {
      const room = roomArea(hass, bindings, roomId, planElement(this.plan, roomId)?.name ?? "");
      if (room) target.roomArea = room;
    }
    this.linkTarget = target;
  };

  /** The network map asks to place one of its devices: link mode, the next piece picked. */
  private readonly onNetworkPlace = (event: Event): void => {
    const request = (event as CustomEvent<PlaceRequest>).detail;
    this.placing = request;
    this.linking = true;
    this.linkTarget = undefined;
    this.show(this.t.t("network.place_hint", { name: request.name }));
  };

  /** Saves one edit on top of the latest stored bindings, refused if another save came first. */
  private readonly onLinkSave = async (event: Event): Promise<void> => {
    const change = (event as CustomEvent<LinkChange>).detail;
    const client = this.client;
    if (!client) return;
    const t = this.t;
    this.busy = true;
    try {
      const stored = await client.getBindings();
      await client.saveBindings(applyLink(readBindings(stored.bindings), change), stored.revision);
      this.linkTarget = undefined;
      await this.loadBindings();
      this.show(t.t("link.saved"));
    } catch (error) {
      this.show(t.t("link.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  private readonly chooseFile = (): void => {
    // One import at a time: not while a file is read or its storey is being chosen.
    if (this.busy || this.importChoice) return;
    this.importTarget = "storey";
    this.renderRoot.querySelector<HTMLInputElement>("input.plan-file")?.click();
  };

  /** Whether the home is shown: its settings read (D-039), or a tool changes it. */
  private get homeShown(): boolean {
    return this.settingsRead || this.editing || this.planning || this.linking;
  }

  /** Whether the view shows every storey at once: chosen, and no tool works on a storey. */
  private wholeHome(): boolean {
    return (
      this.showAll && this.home !== undefined && !this.editing && !this.planning && !this.linking
    );
  }

  /** The view's storey switcher: another storey is shown, or all of them (not while editing). */
  private readonly onStorey = (event: Event): void => {
    if (this.editing || this.planning) return;
    const storey = (event as CustomEvent<string>).detail;
    this.showAll = storey === ALL_STOREYS;
    if (!this.showAll) this.storey = storey;
    this.linkTarget = undefined;
    void this.loadPlan();
  };

  private readonly openStoreys = (): void => {
    this.northDraft = undefined;
    this.linkTarget = undefined;
    this.storeyRemoveAsk = undefined;
    this.storeysOpen = true;
  };

  /** Changes a storey's name or height, at once. */
  private changeStorey(
    storey: StoreyInfo,
    change: { name?: string; elevation?: number },
  ): Promise<void> {
    const client = this.client;
    if (!client) return Promise.resolve();
    // One after the other: a height typed while a name is being saved is saved next.
    this.storeyChanges = this.storeyChanges.then(async () => {
      try {
        await client.saveStorey({ storey: storey.id, ...change });
        await this.loadPlan();
      } catch (error) {
        this.show(this.t.t("storey.save_failed", { reason: this.describe(error) }), true);
      }
    });
    return this.storeyChanges;
  }

  private async removeStorey(storey: StoreyInfo, name: string): Promise<void> {
    const client = this.client;
    if (!client || this.busy) return;
    this.busy = true;
    try {
      await client.removeStorey(storey.id);
      this.storeyRemoveAsk = undefined;
      if (this.storey === storey.id) this.storey = undefined;
      await this.loadPlan();
      this.show(this.t.t("storey.removed", { name }));
    } catch (error) {
      this.show(this.t.t("storey.save_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  }

  private readonly drawStorey = (): void => {
    this.storeysOpen = false;
    void this.startPlanFor(true);
  };

  private readonly importStoreyFile = (): void => {
    if (this.busy || this.importChoice) return;
    this.storeysOpen = false;
    this.importTarget = "new";
    this.renderRoot.querySelector<HTMLInputElement>("input.plan-file")?.click();
  };

  private readonly importFile = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    const client = this.client;
    if (!file || !client || this.busy || this.importChoice) return;
    if (IMPORTED_FILES.test(file.name)) {
      await this.readImport(file);
      return;
    }
    const t = this.t;
    // Busy while the file is looked at: one import at a time.
    this.busy = true;
    if (await isOtherApp(file)) {
      await this.readImport(file);
      return;
    }
    try {
      if (file.size > MAX_FILE_BYTES) throw new EngineError("too_large");
      const text = await file.text();
      const summary = await summarizePlan(text);
      const read = JSON.parse(text.replace(/^\uFEFF/, "")) as PlanJson;
      await this.storeEmbeddedModels(read);
      await this.storePlan(read);
      this.show(t.t("panel.imported", { title: summary.name || t.t("view.untitled") }));
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  /**
   * The 3D files an exported plan embeds (`data:` URLs) are read, checked and uploaded, and the
   * plan keeps only their references. A file that is refused fails the import with its model's
   * name.
   */
  private async storeEmbeddedModels(plan: PlanJson): Promise<void> {
    const hass = this._hass;
    const models = plan.models;
    if (!hass || typeof models !== "object" || models === null) return;
    const embedded = Object.values(models as Record<string, PlanModel>).filter(
      (model) => typeof model.file?.data === "string",
    );
    if (embedded.length === 0) return;
    const t = this.t;
    this.show(t.t("panel.models_reading"));
    const { MODEL_FORMATS, fromDataUrl, keepMesh, readModel, uploadModel } =
      await import("../models/models");
    for (const model of embedded) {
      const file = model.file ?? {};
      const name = typeof model.name === "string" ? model.name : "";
      try {
        const format = MODEL_FORMATS.find((f) => f === file.format);
        const bytes = fromDataUrl(String(file.data));
        if (!format || !bytes) throw new EngineError("not_model");
        const read = await readModel(bytes, format);
        const uploaded = await uploadModel(hass, bytes, format);
        keepMesh(uploaded.hash, read.mesh);
        file.hash = uploaded.hash;
        file.bytes = uploaded.bytes;
        delete file.data;
      } catch (error) {
        throw new TranslatedError(
          t.t("panel.model_refused", { name, reason: this.describe(error) }),
          { cause: error },
        );
      }
    }
  }

  /**
   * Reads a plan of another app with the import module (loaded now), then imports its storey or
   * asks which.
   */
  private async readImport(file: File): Promise<void> {
    const t = this.t;
    this.busy = true;
    this.show(t.t("panel.import_reading", { name: file.name }));
    let read: PlanFile | undefined;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new EngineError("too_large");
      const { PlanFile } = await import("../import/import");
      // The file's name, for a plan the file does not name.
      const title = file.name.replace(/\.[^.]*$/, "");
      read = await PlanFile.read(new Uint8Array(await file.arrayBuffer()), title);
      const all = read.storeys();
      const storeys = all.filter((s) => s.spaces > 0);
      const only = storeys[0];
      if (!only) throw new EngineError("no_spaces");
      if (storeys.length > 1) {
        const levels = new Map(storeyLevels(all).map(({ storey, level }) => [storey.id, level]));
        this.importChoice = { file: read, name: file.name, storeys, levels };
        read = undefined;
        this.toast = undefined;
        return;
      }
      await this.importStorey(read, only);
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      read?.dispose();
      this.busy = false;
    }
  }

  /**
   * Converts a storey, has the engine check the plan, stores it and says what was left out. A
   * robot's map links its dock to `robot`'s vacuum (D-064).
   */
  private async importStorey(
    file: PlanFile,
    storey: ImportStorey,
    robot?: RobotMapSource,
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    const { plan, report, upkeep } = file.convert(storey.id, this.roomName);
    const summary = await summarizePlan(JSON.stringify(plan));
    const stored = await this.storePlan(plan);
    const cards = stored
      ? await this.fillCards([{ found: upkeep, before: plan, after: stored }])
      : { filled: 0 };
    const linked =
      stored && robot?.vacuum ? await this.linkDock(plan, stored, robot) : { text: "" };
    const imported = t.t("panel.import_from", {
      source: t.t(`panel.import_sources.${file.format}`),
      title: summary.name || t.t("view.untitled"),
    });
    const left = this.leftOut(report);
    this.show(
      (left ? `${imported} ${t.t("panel.import_left_out", { list: left })}` : imported) +
        this.cardsText(cards) +
        linked.text,
      cards.failed !== undefined || linked.failed === true,
    );
  }

  /**
   * Links the dock of a robot's map, under the id it got when stored, to the robot's vacuum
   * (D-049, D-064). Returns what it did, for the import's message, and whether it failed.
   */
  private async linkDock(
    before: PlanJson,
    after: PlanJson,
    robot: RobotMapSource,
  ): Promise<{ text: string; failed?: boolean }> {
    const client = this.client;
    const vacuum = robot.vacuum;
    if (!client || !vacuum) return { text: "" };
    const t = this.t;
    const items = Array.isArray(before.items)
      ? (before.items as { id?: unknown; kind?: unknown }[])
      : [];
    const dock = items.find((item) => item.kind === "robot-vacuum")?.id;
    if (typeof dock !== "string") return { text: "" };
    const id = renamedPieces(before, after).get(dock) ?? dock;
    try {
      const stored = await client.getBindings();
      const change: LinkChange = { element: id, binding: { entities: [{ entity_id: vacuum }] } };
      await client.saveBindings(applyLink(readBindings(stored.bindings), change), stored.revision);
      await this.loadBindings();
      return { text: ` ${t.t("panel.import_robot_linked", { name: robot.name })}` };
    } catch (error) {
      const reason = this.describe(error);
      return {
        text: ` ${t.t("panel.import_robot_link_failed", { name: robot.name, reason })}`,
        failed: true,
      };
    }
  }

  /** The robots whose map Home Assistant has: one imported, or one to pick (D-064). */
  private readonly chooseRobotMap = (): void => {
    if (this.busy || this.importChoice || this.robotChoice) return;
    this.moreOpen = false;
    const maps = robotMaps(this._hass);
    const only = maps[0];
    if (maps.length === 1 && only) {
      void this.importRobotMap(only);
    } else if (maps.length > 1) {
      this.robotChoice = maps;
    }
  };

  /** Reads a robot's map through Home Assistant (its camera's picture) and imports it. */
  private async importRobotMap(robot: RobotMapSource): Promise<void> {
    const hass = this._hass;
    if (!hass) return;
    const t = this.t;
    this.robotChoice = undefined;
    this.importTarget = "storey";
    this.busy = true;
    this.show(t.t("panel.import_robot_reading", { name: robot.name }));
    let read: PlanFile | undefined;
    try {
      const fetchWithAuth = hass.fetchWithAuth?.bind(hass);
      if (!fetchWithAuth) throw new EngineError("robot_map_missing");
      const response = await fetchWithAuth(mapPath(robot));
      if (!response.ok) throw new EngineError("robot_map_missing");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { PlanFile } = await import("../import/import");
      try {
        read = await PlanFile.read(bytes, robot.name);
      } catch (error) {
        // A picture without a map in it: not Valetudo's map data.
        throw error instanceof EngineError && error.code === "picture"
          ? new EngineError("not_robot_map")
          : error;
      }
      const storey = read.storeys()[0];
      if (read.format !== "robot") throw new EngineError("not_robot_map");
      if (!storey || storey.spaces === 0) throw new EngineError("no_spaces");
      await this.importStorey(read, storey, robot);
    } catch (error) {
      this.show(t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      read?.dispose();
      this.busy = false;
    }
  }

  /**
   * Fills the upkeep cards of the pieces an imported file speaks of (D-033), under the ids the
   * pieces got when stored: what a card says already stays. Returns how many cards changed.
   */
  private async fillCards(
    imports: { found: Record<string, UpkeepCard>; before: PlanJson; after: PlanJson }[],
  ): Promise<{ filled: number; failed?: { left: number; reason: string } }> {
    const client = this.client;
    if (!client) return { filled: 0 };
    const cards: Record<string, UpkeepCard> = {};
    for (const { found, before, after } of imports) {
      const renamed = renamedPieces(before, after);
      for (const [id, card] of Object.entries(found)) cards[renamed.get(id) ?? id] = card;
    }
    if (Object.keys(cards).length === 0) return { filled: 0 };
    let kept: Record<string, UpkeepCard>;
    try {
      kept = (await client.getUpkeep()).upkeep.pieces;
    } catch {
      // An integration without upkeep cards: the plan is imported all the same.
      return { filled: 0 };
    }
    const changed = Object.entries(mergeCards(kept, cards));
    let filled = 0;
    try {
      // In parts, each well within what the integration takes at once.
      for (let at = 0; at < changed.length; at += CARDS_AT_ONCE) {
        const part = changed.slice(at, at + CARDS_AT_ONCE);
        await client.saveUpkeep(Object.fromEntries(part));
        filled += part.length;
      }
    } catch (error) {
      return { filled, failed: { left: changed.length - filled, reason: this.describe(error) } };
    }
    return { filled };
  }

  /** What filling the cards from a file did, for the import's message. */
  private cardsText(result: { filled: number; failed?: { left: number; reason: string } }): string {
    const t = this.t;
    const parts: string[] = [];
    if (result.filled > 0) parts.push(t.tp("panel.import_cards", result.filled));
    if (result.failed) {
      parts.push(
        t.tp("panel.import_cards_failed", result.failed.left, { reason: result.failed.reason }),
      );
    }
    return parts.map((part) => ` ${part}`).join("");
  }

  /**
   * Stores an imported plan: in the storey shown (its overlay kept, for an updated plan), or as a
   * new storey above the others; its ids that other storeys use are changed first. Returns the
   * plan stored.
   */
  private async storePlan(read: PlanJson): Promise<PlanJson | undefined> {
    const client = this.client;
    if (!client) return undefined;
    const target = this.importTarget;
    this.importTarget = "storey";
    let plan: PlanJson;
    if (target === "new") {
      plan = await this.ownIds(read);
      const added = await client.saveStorey({ plan, elevation: this.nextElevation() });
      this.storey = added.storey;
    } else {
      plan = await this.ownIds(read, this.storey);
      await client.savePlan(plan, undefined, undefined, this.storey);
    }
    await this.loadPlan();
    return plan;
  }

  /**
   * Every storey of a file with rooms: each plan read by the engine first, then they replace
   * the home's storeys in one save (all of them, or none if one is refused).
   */
  private async importAllStoreys(choice: ImportChoice): Promise<void> {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    const storeys: { plan: PlanJson; name: string; elevation: number }[] = [];
    const imports: { found: Record<string, UpkeepCard>; before: PlanJson; after: PlanJson }[] = [];
    const taken: string[] = [];
    const { freeIds } = await import("../planner/planner");
    for (const storey of choice.storeys) {
      const converted = choice.file.convert(storey.id, this.roomName);
      const plan = (await freeIds(converted.plan, taken)) as PlanJson;
      await summarizePlan(JSON.stringify(plan));
      taken.push(...storeyIds(plan));
      storeys.push({ plan, name: storey.name.slice(0, 60), elevation: storey.elevation });
      imports.push({ found: converted.upkeep, before: converted.plan, after: plan });
    }
    await client.replaceStoreys(storeys);
    const cards = await this.fillCards(imports);
    // The server's ground floor.
    this.storey = undefined;
    await this.loadPlan();
    this.show(
      t.tp("storey.import_all_imported", storeys.length) + this.cardsText(cards),
      cards.failed !== undefined,
    );
  }

  /** The name of a room a scan names by its kind, in the user's language. */
  private readonly roomName = (key: ScanRoom): string => this.t.t(`panel.import_rooms.${key}`);

  private leftOut(report: ImportReport): string {
    const t = this.t;
    const parts: string[] = [];
    if (report.unplacedOpenings > 0)
      parts.push(t.tp("panel.import_unplaced", report.unplacedOpenings));
    if (report.skippedFurniture > 0)
      parts.push(t.tp("panel.import_skipped_furniture", report.skippedFurniture));
    if (report.skippedSpaces > 0)
      parts.push(t.tp("panel.import_skipped_spaces", report.skippedSpaces));
    if (report.overLimit > 0) parts.push(t.tp("panel.import_over_limit", report.overLimit));
    return parts.join(", ");
  }

  private async pickStorey(storey: ImportStorey): Promise<void> {
    const choice = this.importChoice;
    if (!choice) return;
    this.importChoice = undefined;
    this.busy = true;
    try {
      await this.importStorey(choice.file, storey);
    } catch (error) {
      this.show(this.t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      choice.file.dispose();
      this.busy = false;
    }
  }

  private async pickAllStoreys(): Promise<void> {
    const choice = this.importChoice;
    if (!choice) return;
    this.importChoice = undefined;
    this.busy = true;
    try {
      await this.importAllStoreys(choice);
    } catch (error) {
      this.show(this.t.t("panel.import_failed", { reason: this.describe(error) }), true);
    } finally {
      choice.file.dispose();
      this.busy = false;
    }
  }

  private readonly cancelIfc = (): void => {
    this.importChoice?.file.dispose();
    this.importChoice = undefined;
  };

  private readonly exportPlan = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    const t = this.t;
    try {
      const { plan: stored, layout } = await client.getPlan(this.storey);
      if (!stored) {
        this.show(t.t("panel.nothing_to_export"));
        return;
      }
      // The plan as it is now: the edits of edit mode applied.
      const plan = JSON.parse(
        await applyLayout(JSON.stringify(stored), JSON.stringify(layout)),
      ) as PlanJson;
      const missing = await this.embedModels(plan);
      const title = typeof plan.name === "string" ? plan.name : "";
      // With several storeys, the file says which.
      const level = storeyLevels(this.storeys).find(({ storey }) => storey.id === this.storey);
      const name = fileName(
        level && this.storeys.length > 1
          ? `${title} ${storeyName(t, level.storey, level.level)}`
          : title,
      );
      download(name, plan);
      const unembedded = missing > 0 ? t.tp("panel.models_not_embedded", missing) : "";
      // The upkeep cards of its pieces (D-033), kept apart from the plan: offered as a file of
      // their own, as they say what the home holds (makes, serial numbers).
      const cards = this.cardsOf(plan);
      const count = Object.keys(cards).length;
      if (count === 0 && unembedded) this.show(unembedded, true);
      if (count > 0) {
        // The offer stays until it is taken or dismissed.
        window.clearTimeout(this.toastTimer);
        this.toast = {
          text: [unembedded, t.tp("panel.export_upkeep_offer", count)].filter(Boolean).join(" "),
          error: missing > 0,
          action: {
            label: t.t("panel.export_upkeep"),
            run: () => {
              download(name.replace(/\.domotwin\.json$/, ".upkeep.json"), {
                format: "domotwin-upkeep",
                version: 1,
                lead_days: this.upkeep?.lead_days ?? 14,
                pieces: cards,
              });
              this.toast = undefined;
            },
          },
        };
      }
    } catch (error) {
      this.show(t.t("panel.export_failed", { reason: this.describe(error) }), true);
    }
  };

  /** The upkeep cards of a plan's pieces, by piece id. */
  private cardsOf(plan: PlanJson): Record<string, UpkeepCard> {
    const pieces = this.upkeep?.pieces ?? {};
    const out: Record<string, UpkeepCard> = {};
    const items = Array.isArray(plan.items) ? (plan.items as { id?: unknown }[]) : [];
    for (const item of items) {
      const id = item.id;
      const card = typeof id === "string" ? pieces[id] : undefined;
      if (typeof id === "string" && card) out[id] = card;
    }
    return out;
  }

  /**
   * Embeds the plan's 3D files as `data:` URLs, so that it opens with its models elsewhere. A
   * model whose file cannot be fetched is left out with its pieces. Returns how many.
   */
  private async embedModels(plan: PlanJson): Promise<number> {
    const hass = this._hass;
    const models = plan.models as Record<string, PlanModel> | null | undefined;
    if (!hass || !models || typeof models !== "object") return 0;
    const files = Object.entries(models).filter(([, m]) => typeof m.file?.hash === "string");
    if (files.length === 0) return 0;
    const { MODEL_FORMATS, fetchModel, toDataUrl } = await import("../models/models");
    const left: string[] = [];
    for (const [id, model] of files) {
      const file = model.file ?? {};
      const format = MODEL_FORMATS.find((f) => f === file.format);
      try {
        if (!format) throw new EngineError("not_model");
        file.data = toDataUrl(await fetchModel(hass, String(file.hash), format), format);
      } catch {
        left.push(id);
      }
    }
    if (left.length > 0) {
      for (const id of left) Reflect.deleteProperty(models, id);
      if (Array.isArray(plan.items)) {
        plan.items = (plan.items as { model?: unknown }[]).filter(
          (item) => typeof item.model !== "string" || !left.includes(item.model),
        );
      }
    }
    return left.length;
  }

  /** The robots whose map Home Assistant has, to pick one (D-064). */
  private renderRobotMaps(maps: RobotMapSource[]): TemplateResult {
    const t = this.t;
    return html`<div
      class="storeys glass"
      role="dialog"
      aria-label=${t.t("panel.import_robot_pick")}
      data-testid="import-robots"
    >
      <h2>${t.t("panel.import_robot_pick")}</h2>
      ${maps.map(
        (robot) =>
          html`<button
            class="storey"
            @click=${() => {
              void this.importRobotMap(robot);
            }}
          >
            <span class="name">${robot.name}</span>
            <span class="detail">${robot.camera}</span>
          </button>`,
      )}
      <div class="footer">
        <button
          class="action quiet"
          data-cancel
          @click=${() => {
            this.robotChoice = undefined;
          }}
        >
          ${t.t("panel.cancel")}
        </button>
      </div>
    </div>`;
  }

  private renderStoreys(choice: ImportChoice): TemplateResult {
    const t = this.t;
    const metres = new Intl.NumberFormat(t.language, { maximumFractionDigits: 2 });
    return html`<div
      class="storeys glass"
      role="dialog"
      aria-label=${t.t("panel.import_pick", { name: choice.name })}
      data-testid="import-storeys"
    >
      <h2>${t.t("panel.import_pick", { name: choice.name })}</h2>
      ${choice.storeys.map(
        (storey) =>
          html`<button
            class="storey"
            @click=${() => {
              void this.pickStorey(storey);
            }}
          >
            <span class="name">${storeyName(t, storey, choice.levels.get(storey.id) ?? 0)}</span>
            <span class="detail"
              >${t.tp("view.rooms", storey.spaces)} · ${metres.format(storey.elevation / 100)}
              m</span
            >
          </button>`,
      )}
      <p class="hint">${t.t("storey.import_all_hint")}</p>
      <div class="footer">
        <button class="action quiet" data-cancel @click=${this.cancelIfc}>
          ${t.t("panel.cancel")}
        </button>
        <button
          class="action"
          data-testid="import-all"
          @click=${() => {
            void this.pickAllStoreys();
          }}
        >
          ${t.t("storey.import_all")}
        </button>
      </div>
    </div>`;
  }

  /** The home's look (as being chosen, while the settings are open). */
  private homeLook(): { theme?: ThemeMode; accent?: string } {
    // Measuring (D-053), each look with its own accent.
    if (this.measureLook) return { theme: this.measureLook };
    const draft = this.northDraft !== undefined ? this.lookDraft : undefined;
    // While the settings are open, the draft says it all: no accent in it is the look's own.
    if (draft) return { theme: draft.theme, accent: draft.accent };
    return { theme: this.settings?.theme, accent: this.settings?.accent };
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("moreOpen")) {
      if (this.moreOpen) {
        focusMenu(this.renderRoot.querySelector<HTMLElement>('[data-testid="more-menu"]'));
      } else if (changed.get("moreOpen") === true) {
        focusBack(this.renderRoot.querySelector<HTMLElement>('[data-testid="more"]'));
      }
    }
    // After the menu: a dialog opened from it gives the focus back to its button.
    this.dialogs.update(this.renderRoot.querySelector(PANEL_DIALOGS) ?? undefined);
    const view = this.layerWanted && this.tab === "3d" ? this.view : null;
    if (view && this.layerWanted) {
      view.setLayer(this.layerWanted);
      this.layerWanted = undefined;
    }
    const hass = this._hass;
    const fitting = [
      hass?.locale?.language ?? hass?.language,
      hass?.user?.is_admin,
      hass?.dockedSidebar,
      this.editing,
      this.planning,
      this.linking,
      Boolean(this.plan),
      this.tight,
      this.narrow,
      this.compact,
      this.tab,
    ].join("|");
    if (fitting !== this.fitted) {
      this.fitted = fitting;
      this.fitToolbar();
    }
  }

  /**
   * Whether the buttons' names fit beside the title (D-045), whatever the language and the
   * buttons shown: measured with them shown, again whenever they change, before the page is
   * drawn.
   */
  private fitToolbar(): void {
    const toolbar = this.renderRoot.querySelector<HTMLElement>(".toolbar");
    const title = toolbar?.querySelector("h1");
    if (!toolbar || !title || this.panelWidth === 0) return;
    if (this.narrow) {
      this.compact = true;
      return;
    }
    // The names, and Home Assistant's menu button (hidden while its sidebar is docked).
    const menu = toolbar.querySelector("ha-menu-button")?.getBoundingClientRect().width ?? 0;
    const names = [...toolbar.querySelectorAll(".label")]
      .map((label) => label.textContent)
      .concat(String(menu))
      .join("|");
    if (this.namesWidth?.names !== names) {
      if (this.compact) {
        // Shown to be measured on the next update.
        this.compact = false;
        return;
      }
      this.namesWidth = { names, width: toolbar.scrollWidth - title.offsetWidth + TITLE_ROOM };
    }
    this.compact = this.panelWidth < this.namesWidth.width;
  }

  /**
   * The tab of Home Assistant's address (D-055); the panel's own address alone opens on the tab
   * chosen, once the user's choices are known (this device's own at once), and says it.
   */
  private followRoute(): void {
    const { tab, area, graphs } = routeOf(this.route?.path);
    if (tab) {
      // Opened from the 3D view, the room's way back leads there, also come back to by back.
      const state: unknown = window.history.state;
      const from3d = (state as { domotwin?: unknown } | null)?.domotwin === "from3d";
      if (tab !== "rooms" || area !== this.roomOpen)
        this.from3d = tab === "rooms" && !!area && from3d;
      // A report opened on another page stays there.
      if (tab !== this.tab || area !== this.roomOpen || (graphs === true) !== this.roomGraphs)
        this.report = undefined;
      this.tab = tab;
      this.roomOpen = tab === "rooms" ? area : undefined;
      this.roomGraphs = tab === "rooms" && graphs === true;
      if (tab === "3d") void this.showLayerAsked();
    } else {
      // A wall screen opens on its own tab, once its layout is read (D-076).
      if (this.deviceScreen && !this.screensRead) return;
      const own = this.screenLayout?.start ?? this.deviceStart;
      if (own === undefined && this.choices === undefined) return;
      this.tab = startTab(this.choices ?? NO_CHOICES, own, canDraw3d());
      this.roomOpen = undefined;
      this.roomGraphs = false;
      this.from3d = false;
      this.address(true);
    }
    // The first picture measured is of the 3D view shown as the panel opened (D-053).
    if (this.tab !== "3d" && !this.shown3d) this.firstPlan = false;
    this.openReportAsked();
  }

  /** Home Assistant's address says the tab shown: replacing the one there, or after it. */
  private address(replace: boolean): void {
    const route = this.route;
    const tab = this.tab;
    if (!route || !tab) return;
    const path = `${route.prefix}${pathOf(tab, this.roomOpen, this.roomGraphs)}`;
    if (window.location.pathname === path) return;
    // What the address says beyond the page (a kiosk's choices) stays.
    const url = `${path}${window.location.search}${window.location.hash}`;
    // A room opened from the 3D view leads back there, whichever way it is come back to.
    const state = this.from3d ? { domotwin: "from3d" } : null;
    if (replace) window.history.replaceState(state, "", url);
    else window.history.pushState(state, "", url);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
  }

  /** Shows a tab, a room in the Rooms tab and its graphs (D-069): through Home Assistant's
   * address, so that back works. */
  private go(tab: Tab, area?: string, from3d = false, replace = false, graphs = false): void {
    this.retryPractical();
    this.tab = tab;
    this.roomOpen = tab === "rooms" ? area : undefined;
    this.roomGraphs = tab === "rooms" && area !== undefined && graphs;
    this.from3d = from3d;
    this.moreOpen = false;
    this.report = undefined;
    this.address(replace);
  }

  private readonly onGo = (
    event: CustomEvent<{ tab: Tab; area?: string; graphs?: boolean; layer?: LayerName }>,
  ): void => {
    const { tab, area, graphs, layer } = event.detail;
    // A layer asked for (the peak's, D-063): shown once the 3D view is there.
    this.layerWanted = tab === "3d" ? layer : undefined;
    // A room opened from one opened from the 3D view: back to the rooms, not to the 3D view; its
    // graphs and back keep the room's way back (D-069).
    const same = tab === "rooms" && area !== undefined && area === this.roomOpen;
    this.go(tab, area, same && this.from3d, false, graphs === true);
  };

  /** A room's graphs asked for a history report of their entities (D-058, D-069). */
  private readonly onOpenHistory = (
    event: CustomEvent<{ heading?: string; entities: string[]; period?: PeriodChoice }>,
  ): void => {
    const { heading, entities, period } = event.detail;
    const report = { heading: heading ?? "", entities, ...(period ? { period } : {}) };
    const from = `${this.tab ?? ""}:${this.roomOpen ?? ""}:${String(this.roomGraphs)}`;
    this.reportModule ??= import("./history-report");
    this.reportModule.then(
      () => {
        // Still on the page it was asked from, its module come since.
        if (from === `${this.tab ?? ""}:${this.roomOpen ?? ""}:${String(this.roomGraphs)}`)
          this.report = report;
      },
      (error: unknown) => {
        this.reportModule = undefined;
        this.show(this.describe(error), true);
      },
    );
  };

  /**
   * The viewer's rights (D-071): their gate, and the bindings without the devices they may not
   * see; the same while nothing they read changes. None for an administrator.
   */
  private rightsOf(hass: HomeAssistant): { gate?: Gate; bindings: BindingsJson } {
    const settings = this.settings;
    return this.rightsCache.read(
      hass,
      settings?.rights,
      {
        bindings: this.bindings ?? NO_BINDINGS,
        closed: closedRooms(settings?.rooms, settings?.rights, hass),
      },
      () => ({
        rooms: [...planRooms(this.plan), ...this.elsewhere.flatMap((storey) => storey.rooms)],
        storeys: [{ plan: this.plan, layout: this.layout }, ...this.elsewhere],
      }),
      [this.plan, this.layout, this.elsewhere],
    );
  }

  /**
   * What the Home and Rooms tabs read beyond Home Assistant's states (D-055): the rooms of every
   * storey, the private rooms the viewer may not see and their areas; the same while nothing
   * they come from changes.
   */
  private practical(hass: HomeAssistant): {
    sources: GlanceSources;
    unseen: Unseen;
    actions: Map<string, RoomAction[]>;
  } {
    // `hass` is Home Assistant's own; the viewer's rights are worked out here (D-071).
    const gate = this.rightsOf(hass).gate;
    const closed = closedRooms(this.settings?.rooms, this.settings?.rights, hass);
    const from = [
      this.plan,
      this.layout,
      this.elsewhere,
      this.bindings,
      this.people,
      this.settings,
      hass.areas,
      [...closed].sort().join("\n"),
      gate,
    ];
    const shown = this.practicalShown;
    if (shown && from.every((value, i) => value === shown.from[i])) return shown;
    const rooms = [...planRooms(this.plan), ...this.elsewhere.flatMap((storey) => storey.rooms)];
    const bindings = this.bindings ?? NO_BINDINGS;
    const closedUnseen = unseenOf(
      hass,
      bindings,
      rooms,
      [{ plan: this.plan, layout: this.layout }, ...this.elsewhere],
      closed,
    );
    // And the devices the viewer's rights hide (D-071).
    const hidden = hiddenEntities(viewerOf(this.settings?.rights, hass));
    const unseen =
      hidden.size === 0
        ? closedUnseen
        : { ...closedUnseen, entities: new Set([...closedUnseen.entities, ...hidden]) };
    const sources: GlanceSources = {
      rooms,
      bindings,
      closed,
      closedAreas: unseen.areas,
      closedEntities: unseen.entities,
      meters: new Set(
        ENERGY_SENSORS.flatMap((key) => this.settings?.energy?.[key] ?? []).filter(Boolean),
      ),
    };
    if (this.people) sources.people = this.people;
    // The rooms' own actions (D-047), on their area's page.
    const actions = new Map<string, RoomAction[]>();
    for (const room of rooms) {
      const own = usableActions(gatedHass(hass, gate), bindings.rooms[room.id]?.actions ?? []);
      const area = own.length ? roomArea(hass, bindings, room.id, room.name) : undefined;
      if (area) actions.set(area, [...(actions.get(area) ?? []), ...own]);
    }
    this.practicalShown = { from, sources, unseen, actions };
    return this.practicalShown;
  }

  /**
   * Whether Home Assistant's energy has something set up (D-069), read once for each connection
   * where it has its Energy page; never set up when it cannot be read (`not_found`: never saved).
   */
  private readEnergy(hass: HomeAssistant): void {
    const connection = hass.connection;
    if (!energyPage(hass) || this.energyAsked === connection) return;
    this.energyAsked = connection;
    connection.sendMessagePromise<unknown>({ type: "energy/get_prefs" }).then(
      (prefs) => {
        this.energyKnown = { connection, setUp: energySetUp(prefs) };
      },
      () => {
        this.energyKnown = { connection, setUp: false };
      },
    );
  }

  /**
   * A room tapped in the 3D view opens its room in the Rooms tab, and back (D-055); its graphs,
   * asked for from its panel, open there too (D-069).
   */
  private readonly onRoomOpen = (event: CustomEvent<{ area: string; graphs?: boolean }>): void => {
    const { area, graphs } = event.detail;
    // Home Assistant's own page of the area where it has one (D-061), else DomoTwin's; Home
    // Assistant's has no graphs.
    const page = graphs ? undefined : areaPage(this._hass, area);
    if (page) navigate(page);
    else this.go("rooms", area, true, false, graphs === true);
  };

  /**
   * A layer asked for in the address (`/domotwin/3d?layer=upkeep`, a summary card's, D-061):
   * chosen once the 3D view has drawn the plan (the view shows none this user may not see), then
   * left out of the address so that the layer menu has the last word.
   */
  private async showLayerAsked(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const layer = layerAsked(params.get("layer"));
    if (!params.has("layer")) return;
    params.delete("layer");
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
    if (!layer) return;
    await this.updateComplete;
    const view = this.view;
    await view?.updateComplete;
    // The plan drawn first, however long a slow device takes, while the 3D view stays open;
    // given up after a few minutes (no plan, or an engine that never came).
    const until = performance.now() + LAYER_WAIT_MS;
    while (
      view?.planDrawn() === "waiting" &&
      this.isConnected &&
      this.tab === "3d" &&
      performance.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, LAYER_POLL_MS));
    }
    if (this.isConnected && this.tab === "3d" && view?.planDrawn() === "ready") {
      view.setLayer(layer);
    }
  }

  /** A press outside the open menu closes it. */
  private readonly closeMore = (event: PointerEvent): void => {
    const more = this.renderRoot.querySelector(".more");
    if (this.moreOpen && more && !event.composedPath().includes(more)) this.moreOpen = false;
  };

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("route") || this.tab === undefined) this.followRoute();
    if (this._hass) this.readEnergy(this._hass);
    if (this.tab === "3d") this.shown3d = true;
    // The Home, Rooms and Safety tabs, and the choices: their module the first time one shows;
    // failed (offline, an update since), tried again when a tab is chosen, not on every update.
    const practical = this.tab === "home" || this.tab === "rooms" || this.tab === "safety";
    if ((practical || this.choicesOpen) && !this.practicalModule) {
      this.practicalModule = import("./practical").then(
        () => {
          this.practicalReady = true;
        },
        (error: unknown) => {
          this.practicalFailed = true;
          this.choicesOpen = false;
          this.show(this.describe(error), true);
        },
      );
    }
    const { theme, accent } = this.homeLook();
    this.look = resolveLook(theme, this._hass);
    this.style.setProperty("--domotwin-accent", accent ?? defaultAccent(this.look));
  }

  /** Drawn once Home Assistant's language is here (D-082). */
  protected override scheduleUpdate(): Promise<unknown> | undefined {
    return inLanguage(
      this,
      () => this._hass,
      () => super.scheduleUpdate(),
    );
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const admin = this._hass?.user?.is_admin === true;
    const tool = this.editing || this.planning || this.linking;
    // The 3D view's tab, or a tool working on it (D-055).
    const on3d = this.tab === "3d" || tool;
    // The tabs, unless a tool works on the 3D view: at the bottom of a phone, else on the side.
    const tabs = !tool && this.tab !== undefined;
    // One template in both modes: the view stays the same element (engine, camera, 2D or 3D).
    return html`<div class="toolbar">
        <ha-menu-button
          .hass=${this.demoSwitch.realHass ?? this._hass}
          .narrow=${this.narrow}
        ></ha-menu-button>
        <h1>
          ${
            this.editing
              ? t.t("edit.title")
              : this.planning
                ? t.t("plan.title")
                : t.t("panel.title")
          }
        </h1>
        ${
          this.editing
            ? this.renderEditActions()
            : this.planning
              ? this.renderPlanActions()
              : on3d
                ? this.renderActions(admin)
                : this.renderPracticalActions(admin)
        }
      </div>
      ${
        this.demo
          ? html`<domotwin-demo-bar
              .home=${this.demo}
              leave
              ?held=${this.busy}
              @domotwin-demo-leave=${this.leaveDemo}
            ></domotwin-demo-bar>`
          : this.sandbox
            ? html`<domotwin-sandbox-bar
                .home=${this.sandbox}
                ?held=${this.busy}
                @domotwin-sandbox-leave=${this.leaveDemo}
                @domotwin-sandbox-draft=${this.backToPlain}
              ></domotwin-sandbox-bar>`
            : nothing
      }
      <div class="main">
        ${tabs && !this.tight ? this.renderTabs("side") : nothing}
        <div class="body">
          ${this.renderDoorbell()} ${this.renderSaver()}
          ${
            // Under the saver, the 3D view is not drawn (D-076).
            this.shown3d || tool ? this.renderView(admin, on3d && !this.saverDrawn) : nothing
          }
          ${on3d ? nothing : this.renderPractical()} ${on3d ? nothing : this.renderReport()}
          ${
            this.editing
              ? this.renderEditTools()
              : this.planning
                ? this.renderPlanTools()
                : this.renderSheets()
          }
          ${
            this.choicesOpen && this.choicesRead && this.practicalReady && this._hass
              ? html`<domotwin-choices
                  .hass=${this._hass}
                  .t=${t}
                  .choices=${this.choices ?? NO_CHOICES}
                  .deviceStart=${this.deviceStart}
                  .screens=${this.screens}
                  .deviceScreen=${this.deviceScreen}
                  .panelPath=${this.panelPath()}
                  @domotwin-close=${() => (this.choicesOpen = false)}
                  @domotwin-saved=${this.onChoicesSaved}
                ></domotwin-choices>`
              : nothing
          }
          ${
            this.screensOpen && this.screensReady && this._hass
              ? html`<domotwin-screens
                  .hass=${this._hass}
                  .t=${t}
                  .screens=${this.screens ?? {}}
                  .current=${this.deviceScreen}
                  @domotwin-close=${() => (this.screensOpen = false)}
                  @domotwin-saved=${this.onScreensSaved}
                ></domotwin-screens>`
              : nothing
          }
          ${
            this.measureOpen
              ? html`<domotwin-measure
                  .hass=${this._hass}
                  .host=${this.measureHost}
                  @domotwin-close=${() => {
                    this.measureOpen = false;
                  }}
                ></domotwin-measure>`
              : nothing
          }
          <div role="status" data-testid="announcer">
            ${this.toast && !this.toast.error ? this.renderToast() : nothing}
          </div>
          ${this.toast?.error ? this.renderToast() : nothing}
        </div>
      </div>
      ${tabs && this.tight ? this.renderTabs("bottom") : nothing}
      <input class="plan-file" type="file" accept=${PLAN_FILES} @change=${this.importFile} />
      <input
        class="model-file"
        type="file"
        accept=".glb,.gltf,.obj,.stl,.3mf"
        @change=${this.readModelFile}
      />`;
  }

  /**
   * The 3D view, kept on the other tabs (hidden, not drawn): its engine, its camera. Hidden, it
   * keeps the `hass` it had, so that Home Assistant's changes do not update it for nothing.
   */
  private renderView(admin: boolean, shown: boolean): TemplateResult {
    const t = this.t;
    // Under the viewer's rights (D-071): what they may do, the devices they may not see unlinked.
    const rights = this._hass ? this.rightsOf(this._hass) : undefined;
    if (shown || !this.viewHass) {
      this.viewHass = this._hass && gatedHass(this._hass, rights?.gate);
    }
    return html`<domotwin-view
      ?hidden=${!shown}
      .hass=${this.viewHass}
      .plan=${this.homeShown ? this.plan : undefined}
      .layout=${this.layout}
      .bindings=${rights && this.bindings ? rights.bindings : this.bindings}
      .upkeep=${this.upkeep}
      .people=${this.people}
      .wifi=${this.wifi}
      .planError=${this.planError}
      .options=${PANEL_OPTIONS}
      .north=${this.northDraft ?? this.settings?.north ?? 0}
      .privateRooms=${this.settings?.rooms}
      .rights=${this.settings?.rights}
      .linking=${this.linking}
      .editing=${this.editing}
      .planEditing=${this.planning}
      .planTool=${this.planTool}
      .planBlank=${this.planNew}
      .planReserved=${this.planReserved}
      .homeTheme=${this.homeLook().theme}
      .homeAccent=${this.homeLook().accent}
      .energy=${this.northDraft !== undefined ? this.energyPreview() : this.settings?.energy}
      .weather=${
        this.northDraft !== undefined && this.weatherDraft !== undefined
          ? this.weatherDraft || undefined
          : this.settings?.weather
      }
      .roofStyle=${
        this.northDraft !== undefined && this.roofDraft ? this.roofDraft : this.settings?.roof
      }
      .storeys=${this.storeys}
      .storey=${this.wholeHome() ? ALL_STOREYS : this.storey}
      .home=${this.wholeHome() && this.homeShown ? this.home : undefined}
      .elsewhere=${this.wholeHome() ? [] : this.elsewhere}
      @domotwin-storey=${this.onStorey}
      .multiSelect=${this.multi}
      .editKeys=${!this.catalogue && !this.discardAsk && !this.modelImport && !this.planDiscardAsk}
      @domotwin-pick=${this.onPick}
      @domotwin-edit=${this.onEdit}
      @domotwin-plan-edit=${this.onPlanEdit}
      .placeDevices=${admin}
      .linkable=${admin}
      @domotwin-link-element=${this.onLinkElement}
      @domotwin-network-place=${this.onNetworkPlace}
      .accessPoints=${this.settings?.access_points ?? NO_ACCESS_POINTS}
      @domotwin-open-bluetooth=${this.openBluetooth}
      .roomTab=${true}
      .securityAlerts=${shown ? this.securityAlertsShown() : this.securityShown.alerts}
      @domotwin-room-open=${this.onRoomOpen}
    >
      <span slot="empty-action" class="empty-actions">
        ${
          admin
            ? html`<button class="action" @click=${this.chooseFile}>
                  ${icon(mdiTrayArrowUp)}${t.t("panel.import")}
                </button>
                <button class="action" data-testid="plan-new" @click=${this.startPlan}>
                  ${icon(mdiVectorSquareEdit)}${t.t("plan.new")}
                </button>
                ${
                  robotMaps(this._hass).length > 0
                    ? html`<button
                        class="action"
                        data-testid="robot-map"
                        ?disabled=${this.busy}
                        @click=${this.chooseRobotMap}
                      >
                        ${icon(mdiRobotVacuum)}${t.t("panel.import_robot")}
                      </button>`
                    : nothing
                }`
            : nothing
        }
        <button
          class="action"
          data-testid="demo-try"
          ?disabled=${this.busy}
          @click=${this.enterDemo}
        >
          ${icon(mdiFlaskOutline)}${t.t("demo.try")}
        </button>
      </span>
    </domotwin-view>`;
  }

  /** A history report opened from a room's graphs (D-069), over the Rooms tab. */
  private renderReport(): TemplateResult | typeof nothing {
    const report = this.report;
    const hass = this._hass;
    if (!report || !hass || !this.practicalReady) return nothing;
    return html`<domotwin-history
      .hass=${hass}
      .heading=${report.heading}
      .entities=${report.entities}
      .opensOn=${report.period}
      .unseen=${this.practical(hass).unseen}
      @domotwin-close=${() => {
        this.report = undefined;
      }}
    ></domotwin-history>`;
  }

  /**
   * The Energy tab (D-069): Home Assistant's own Energy page where it has one, which DomoTwin
   * opens rather than copies, its back arrow leading back here; in the demo house, whose energy
   * Home Assistant does not know, DomoTwin's own, the 3D view's power layer (D-049).
   */
  private renderEnergyTab(): TemplateResult | typeof nothing {
    const hass = this._hass;
    const route = this.route;
    const t = this.t;
    if (!hass || !this.tab) return nothing;
    // Its page shows only its setup wizard until something is set up: no tab until then.
    const known = this.energyKnown;
    const page =
      known?.connection === hass.connection && known.setUp
        ? energyPage(
            hass,
            route && `${route.prefix}${pathOf(this.tab, this.roomOpen, this.roomGraphs)}`,
          )
        : undefined;
    const demo = hass.demo === true && canDraw3d();
    if (!page && !demo) return nothing;
    const href = page ?? (route ? `${route.prefix}/3d?layer=power` : "#energy");
    return html`<a
      href=${href}
      data-testid="tab-energy"
      aria-current="false"
      @click=${(event: MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        if (page) {
          navigate(page);
        } else {
          this.layerWanted = "power";
          this.go("3d");
          // Already on the 3D tab, nothing else changes: the layer is chosen all the same.
          this.requestUpdate();
        }
      }}
      >${icon(mdiLightningBoltOutline)}<span>${t.t("tabs.energy")}</span></a
    >`;
  }

  /** The tabs (D-055): on the side of a tablet or a computer, at the bottom of a phone. */
  private renderTabs(where: "side" | "bottom"): TemplateResult {
    const t = this.t;
    const tab = (id: Tab, glyph: string, label: string): TemplateResult =>
      html`<a
        href=${this.route ? `${this.route.prefix}${pathOf(id)}` : `#${id}`}
        data-testid="tab-${id}"
        aria-current=${this.tab === id ? "page" : "false"}
        @click=${(event: MouseEvent) => {
          // A new window or tab opened as the browser does it.
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          this.go(id);
        }}
        >${icon(glyph)}<span>${label}</span></a
      >`;
    return html`<nav class="tabs ${where}" aria-label=${t.t("tabs.label")}>
      ${tab("home", mdiHomeOutline, t.t("tabs.home"))}
      ${tab("rooms", mdiViewGridOutline, t.t("tabs.rooms"))} ${this.renderEnergyTab()}
      ${tab("safety", mdiShieldHomeOutline, t.t("tabs.safety"))}
      ${tab("3d", mdiCubeOutline, t.t("tabs.three_d"))}
    </nav>`;
  }

  /**
   * The Home, Rooms or Safety tab (D-055, D-068), once its module is loaded and the private rooms
   * known; above the Home and Rooms tabs, the alerts the 3D view shows (the Safety tab lists them).
   */
  private renderPractical(): TemplateResult | typeof nothing {
    const real = this._hass;
    if (!real || !this.practicalReady || !this.settingsRead) return nothing;
    // Under the viewer's rights (D-071): only looked at, a card does nothing on a tap.
    const hass = gatedHass(real, this.rightsOf(real).gate);
    const { sources, unseen, actions } = this.practical(real);
    const alerts = this.homeAlerts(hass, sources.closed, unseen);
    const page = securityPage(hass);
    if (this.tab === "safety") {
      return html`<domotwin-safety
        .hass=${hass}
        .t=${this.t}
        .alerts=${alerts}
        .storeys=${this.storeys}
        .unseen=${unseen}
        .page=${page}
        @domotwin-alert-room=${this.onAlertRoom}
      ></domotwin-safety>`;
    }
    return html`<div class="practical">
      <domotwin-alert-bar
        .t=${this.t}
        .alerts=${alerts}
        .storeys=${this.storeys}
        .page=${page}
        @domotwin-alert-room=${this.onAlertRoom}
        @domotwin-go=${this.onGo}
      ></domotwin-alert-bar>
      ${
        this.tab === "rooms"
          ? html`<domotwin-rooms
              .hass=${hass}
              .t=${this.t}
              .favourites=${this.choices?.favourites ?? []}
              .unseen=${unseen}
              .actions=${actions}
              .area=${this.roomOpen}
              ?graphs=${this.roomGraphs}
              ?from3d=${this.from3d}
              @domotwin-go=${this.onGo}
              @domotwin-favourite=${this.onFavourite}
              @domotwin-open-history=${this.onOpenHistory}
            ></domotwin-rooms>`
          : html`<domotwin-home
              .hass=${hass}
              .t=${this.t}
              ?can3d=${canDraw3d()}
              .choices=${this.choices ?? NO_CHOICES}
              .sources=${sources}
              .unseen=${unseen}
              @domotwin-go=${this.onGo}
              @domotwin-favourite=${this.onFavourite}
              @domotwin-sandbox-peak=${this.playPeak}
            ></domotwin-home>`
      }
    </div>`;
  }

  /**
   * The alerts the 3D view shows, for the other tabs (D-068): the rooms' of the storey shown, then
   * those of the other storeys, and Home Assistant's own, dangers first.
   */
  private homeAlerts(hass: HomeAssistant, closed: Set<string>, unseen: Unseen): ShownAlert[] {
    const bindings = this.bindings ?? NO_BINDINGS;
    const here = roomLayers(hass, bindings, planRooms(this.plan), {
      layer: "off",
      alerts: true,
      presence: false,
      closed,
    }).alerts;
    const rooms = withAlertsElsewhere(hass, bindings, here, this.elsewhere, this.storey, closed);
    const alerts = shownAlerts(
      rooms,
      this.securityAlertsOf(hass, () => unseen),
    );
    // The same list while it says the same: the bar and the Safety tab are not drawn again.
    const key = JSON.stringify(alerts);
    if (key !== this.homeAlertsShown.key) this.homeAlertsShown = { key, alerts };
    return this.homeAlertsShown.alerts;
  }

  /**
   * Home Assistant's alerts on now, for the home itself (not the demo house's, D-068); what the
   * viewer may not see is worked out only when some are chosen.
   */
  private securityAlertsOf(hass: HomeAssistant, unseen: () => Unseen): SecurityAlert[] {
    if (this.securityChoices.length === 0 || !securityAlertsKept(hass)) return [];
    return securityAlerts(hass, this.securityChoices, unseen());
  }

  /** Home Assistant's alerts for the 3D view shown: the same list while they say the same. */
  private securityAlertsShown(): SecurityAlert[] {
    const hass = this._hass;
    const alerts =
      hass && this.settingsRead
        ? this.securityAlertsOf(hass, () => this.practical(hass).unseen)
        : [];
    const key = JSON.stringify(alerts);
    if (key !== this.securityShown.key) this.securityShown = { key, alerts };
    return this.securityShown.alerts;
  }

  /**
   * A room's alert tapped on another tab (D-068): the 3D view framing it, its storey shown first,
   * as a tap on the 3D view's own banner does; where the 3D view cannot draw, its room's page.
   */
  private readonly onAlertRoom = async (
    event: CustomEvent<Pick<StoreyAlert, "room" | "name" | "storey">>,
  ): Promise<void> => {
    const alert = event.detail;
    const hass = this._hass;
    if (!canDraw3d()) {
      const area = hass
        ? roomArea(hass, this.bindings ?? NO_BINDINGS, alert.room, alert.name)
        : undefined;
      const page = area ? areaPage(hass, area) : undefined;
      if (page) navigate(page);
      else this.go("rooms", area);
      return;
    }
    const ticket = ++this.shows;
    this.go("3d");
    await this.updateComplete;
    const view = await this.drawnView(ticket);
    // Every storey shown at once: the room is framed among them.
    view?.frameAlert(this.wholeHome() ? { room: alert.room, name: alert.name } : alert);
  };

  /** A doorbell ringing (D-068), full screen over every tab, once its module is loaded. */
  private renderDoorbell(): TemplateResult | typeof nothing {
    const hass = this._hass;
    if (!this.ring || !this.doorbellReady || !hass || this.demoSwitch.home) return nothing;
    // Its lock under the viewer's rights (D-071): only looked at, its tile does nothing.
    return html`<domotwin-doorbell
      .hass=${gatedHass(hass, this.rightsOf(hass).gate)}
      .t=${this.t}
      .ring=${this.ring}
      .unseen=${this.settingsRead ? this.practical(hass).unseen : NOTHING_UNSEEN}
      @domotwin-close=${this.closeRing}
    ></domotwin-doorbell>`;
  }

  /** The toolbar of the Home and Rooms tabs: the user's choices, and the home's settings. */
  private renderPracticalActions(admin: boolean): TemplateResult {
    const t = this.t;
    return html`<button
        class="action"
        data-testid="choices-open"
        ?disabled=${this.choicesOpen || !this.choicesRead}
        @click=${this.openChoices}
        aria-label=${t.t("choices.title")}
        title=${t.t("choices.title")}
      >
        ${icon(mdiTuneVariant)}<span class="label">${t.t("choices.title")}</span>
      </button>
      ${
        // Without a plan there is no More menu: the wall screens are reached from here (D-076).
        admin && !this.plan
          ? html`<button
              class="action"
              data-testid="screens-open"
              ?disabled=${this.screensOpen || this.screens === undefined || !!this.demoSwitch.home}
              @click=${this.openScreens}
              aria-label=${t.t("screens.menu")}
              title=${t.t("screens.menu")}
            >
              ${icon(mdiTabletDashboard)}<span class="label">${t.t("screens.menu")}</span>
            </button>`
          : nothing
      }
      ${admin && this.plan ? this.renderMore() : nothing}`;
  }

  private readonly openChoices = (): void => {
    this.moreOpen = false;
    this.retryPractical();
    this.choicesOpen = true;
  };

  /** The tabs' module, tried again after it failed to load. */
  private retryPractical(): void {
    if (!this.practicalFailed) return;
    this.practicalFailed = false;
    this.practicalModule = undefined;
  }

  private readonly onChoicesSaved = (
    event: CustomEvent<{ choices: Choices; device?: Tab; screen?: string }>,
  ): void => {
    this.choices = event.detail.choices;
    this.deviceStart = event.detail.device;
    if (event.detail.screen !== this.deviceScreen) {
      this.deviceScreen = event.detail.screen;
      this.quietSince = Date.now();
      // The Wi-Fi a screen shows (D-060) is that screen's.
      void this.loadWifi();
    }
    this.show(this.t.t("choices.saved"));
  };

  /** The wall screens' dialog (D-076), for administrators: its module the first time. */
  private readonly openScreens = (): void => {
    this.moreOpen = false;
    this.screensOpen = true;
    this.screensModule ??= import("./screens-dialog").then(
      () => {
        this.screensReady = true;
      },
      (error: unknown) => {
        // Offline, or DomoTwin updated meanwhile: tried again the next time.
        this.screensModule = undefined;
        this.screensOpen = false;
        this.show(this.describe(error), true);
      },
    );
  };

  /** Screens saved or removed: kept; a saver whose screen is gone goes too. */
  private readonly onScreensSaved = (event: CustomEvent<{ screens: Screens }>): void => {
    this.screens = event.detail.screens;
    if (!this.screenLayout) this.saverShown = false;
  };

  /** The panel's path in Home Assistant (`domotwin`). */
  private panelPath(): string {
    return this.route?.prefix.replace(/^\//, "") || "domotwin";
  }

  private renderActions(admin: boolean): TemplateResult {
    const t = this.t;
    // On a phone, the import and the storeys go in the More menu, when it is there.
    const more = admin && Boolean(this.plan) && !this.linking;
    return html`${
      admin && !(this.tight && more)
        ? html`<button
            class="action"
            ?disabled=${this.busy || this.importChoice !== undefined}
            @click=${this.chooseFile}
            aria-label=${t.t("panel.import")}
            title=${t.t("panel.import")}
          >
            ${icon(mdiTrayArrowUp)}<span class="label">${t.t("panel.import")}</span>
          </button>`
        : nothing
    }
    ${
      more && !this.tight
        ? html`<button
            class="action"
            data-testid="storeys-manage"
            ?disabled=${this.busy || this.importChoice !== undefined}
            @click=${this.openStoreys}
            aria-label=${t.t("storey.manage")}
            title=${t.t("storey.manage")}
          >
            ${icon(mdiStairs)}<span class="label">${t.t("storey.manage")}</span>
          </button>`
        : nothing
    }
    ${
      admin && this.plan && !this.linking
        ? html`<button
            class="action"
            data-testid="plan-mode"
            ?disabled=${this.busy || this.importChoice !== undefined}
            @click=${this.startPlan}
            aria-label=${t.t("plan.mode")}
            title=${t.t("plan.mode")}
          >
            ${icon(mdiVectorSquareEdit)}<span class="label">${t.t("plan.mode")}</span>
          </button>`
        : nothing
    }
    ${
      admin && this.plan && !this.linking
        ? html`<button
            class="action"
            data-testid="edit-mode"
            ?disabled=${this.busy || this.importChoice !== undefined}
            @click=${this.startEdit}
            aria-label=${t.t("edit.mode")}
            title=${t.t("edit.mode")}
          >
            ${icon(mdiPencilOutline)}<span class="label">${t.t("edit.mode")}</span>
          </button>`
        : nothing
    }
    ${
      admin && this.plan
        ? html`<button
            class="action"
            data-testid="link-mode"
            @click=${this.toggleLinking}
            aria-label=${this.linking ? t.t("link.done") : t.t("link.mode")}
            title=${this.linking ? t.t("link.done") : t.t("link.mode")}
          >
            ${icon(this.linking ? mdiCheck : mdiLinkVariant)}<span class="label"
              >${this.linking ? t.t("link.done") : t.t("link.mode")}</span
            >
          </button>`
        : nothing
    }
    ${more ? this.renderMore() : this.renderExport()}`;
  }

  private renderExport(): TemplateResult {
    const t = this.t;
    return html`<button
      class="action"
      @click=${this.exportPlan}
      aria-label=${t.t("panel.export")}
      title=${t.t("panel.export")}
    >
      ${icon(mdiTrayArrowDown)}<span class="label">${t.t("panel.export")}</span>
    </button>`;
  }

  /** The menu of what is not done every day: the export and the home's settings. */
  private renderMore(): TemplateResult {
    const t = this.t;
    const close = (): void => {
      this.moreOpen = false;
    };
    const busy = this.busy || this.importChoice !== undefined;
    const item = (
      testId: string,
      glyph: string,
      label: string,
      disabled: boolean,
      run: () => unknown,
    ): TemplateResult =>
      html`<button
        role="menuitem"
        data-testid=${testId}
        ?disabled=${disabled}
        @click=${() => {
          close();
          void run();
        }}
      >
        ${icon(glyph)}<span>${label}</span>
      </button>`;
    return html`<div class="more">
      <button
        class="action"
        data-testid="more"
        aria-haspopup="menu"
        aria-expanded=${this.moreOpen ? "true" : "false"}
        aria-label=${t.t("panel.more")}
        title=${t.t("panel.more")}
        @click=${() => {
          this.moreOpen = !this.moreOpen;
        }}
      >
        ${icon(mdiDotsVertical)}
      </button>
      ${
        this.moreOpen
          ? html`<div
              class="menu glass"
              role="menu"
              aria-label=${t.t("panel.more")}
              data-testid="more-menu"
              @keydown=${(event: KeyboardEvent) => {
                menuKeydown(
                  event,
                  close,
                  this.renderRoot.querySelector<HTMLElement>(".more > button"),
                );
              }}
            >
              ${
                // On a phone, the import and the storeys, which have no room in the toolbar.
                this.tight
                  ? html`${item("more-import", mdiTrayArrowUp, t.t("panel.import"), busy, this.chooseFile)}
                    ${item("more-storeys", mdiStairs, t.t("storey.manage"), busy, this.openStoreys)}`
                  : nothing
              }
              ${item("export", mdiTrayArrowDown, t.t("panel.export"), false, this.exportPlan)}
              ${
                this._hass?.user?.is_admin === true && robotMaps(this._hass).length > 0
                  ? item(
                      "more-robot-map",
                      mdiRobotVacuum,
                      t.t("panel.import_robot"),
                      busy,
                      this.chooseRobotMap,
                    )
                  : nothing
              }
              <hr />
              ${item("settings", mdiCogOutline, t.t("settings.title"), this.busy, this.openSettings)}
              ${item(
                "people-settings",
                mdiAccountMultipleOutline,
                t.t("people.settings"),
                this.busy || this.people === undefined,
                this.openPeople,
              )}
              ${item(
                "bluetooth-settings",
                mdiBluetooth,
                t.t("bluetooth.settings"),
                this.busy || this.people === undefined,
                this.openBluetooth,
              )}
              ${item("privacy-settings", mdiLockOutline, t.t("privacy.title"), this.busy, this.openPrivacy)}
              ${item("rights-menu", mdiAccountLockOutline, t.t("rights.menu"), this.busy || this.demo !== undefined || this.sandbox !== undefined, this.openRights)}
              ${item("voice-settings", mdiMicrophoneMessage, t.t("voice.settings"), this.busy, this.openVoice)}
              ${item("wifi-menu", mdiWifi, t.t("wifi.menu"), this.busy || this.wifi === undefined || this.sandbox !== undefined, this.openWifi)}
              ${item("screens-menu", mdiTabletDashboard, t.t("screens.menu"), this.busy || this.screens === undefined || this.demo !== undefined || this.sandbox !== undefined, this.openScreens)}
              ${item("guests-menu", mdiAccountKeyOutline, t.t("guests.menu"), this.busy || this.demo !== undefined || this.sandbox !== undefined, this.openGuests)}
              ${item("config-history", mdiHistory, t.t("config_history.menu"), this.busy || this.sandbox !== undefined, this.openConfigHistory)}
              ${
                // Where Home Assistant has an AI task, for administrators (D-070).
                plainWordsOffered(this._hass)
                  ? item(
                      "plain-words",
                      mdiStarFourPointsOutline,
                      t.t("plain.menu"),
                      this.busy,
                      this.openPlain,
                    )
                  : nothing
              }
              ${item("report-menu", mdiClipboardCheckOutline, t.t("report.menu"), this.busy || this.sandbox !== undefined, () => this.openReport())}
              ${item("measure", mdiSpeedometer, t.t("measure.menu"), this.busy || this.measureOpen || this.sandbox !== undefined, this.openMeasure)}
              <hr />
              ${
                this.demo
                  ? item("demo-leave-menu", mdiClose, t.t("demo.leave"), this.busy, this.leaveDemo)
                  : this.sandbox
                    ? item(
                        "sandbox-leave-menu",
                        mdiClose,
                        t.t("sandbox.leave"),
                        this.busy,
                        this.leaveDemo,
                      )
                    : html`${item("demo-menu", mdiFlaskOutline, t.t("demo.menu"), this.busy, this.enterDemo)}
                      ${item("sandbox-menu", mdiTestTube, t.t("sandbox.menu"), this.busy, this.enterSandbox)}`
              }
            </div>`
          : nothing
      }
    </div>`;
  }

  /** Opens the measure of this device (D-053): its module, loaded the first time. */
  private readonly openMeasure = async (): Promise<void> => {
    try {
      // It measures the 3D view.
      if (this.tab !== "3d") this.go("3d");
      await import("./measure");
      this.measureOpen = true;
    } catch (error) {
      this.show(this.describe(error), true);
    }
  };

  /** Opens the configuration history (D-062): its module and texts, loaded the first time. */
  private readonly openConfigHistory = async (): Promise<void> => {
    try {
      await import("./config-history-dialog");
      this.configHistoryOpen = true;
    } catch (error) {
      this.show(this.describe(error), true);
    }
  };

  /** Opens the weekly report (D-081), on a report or the newest: its module and texts, loaded
   * the first time. */
  private async openReport(asked?: number): Promise<void> {
    try {
      await import("./report-dialog");
      this.reportAsked = asked;
      this.reportOpen = true;
    } catch (error) {
      this.show(this.describe(error), true);
    }
  }

  /**
   * A report asked for in the address (`/domotwin?report=12`, the weekly notification's link,
   * D-081): opened for an administrator, then left out of the address.
   */
  private openReportAsked(): void {
    const hass = this._hass;
    const params = new URLSearchParams(window.location.search);
    // Left in the address until the user is known: whether they may see it is not known before.
    if (!hass?.user || !params.has("report")) return;
    const asked = Number(params.get("report"));
    params.delete("report");
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
    if (hass.user.is_admin) {
      void this.openReport(Number.isInteger(asked) && asked > 0 ? asked : undefined);
    }
  }

  /** Every storey's plan, lowest first, and its name: what the report is drawn on. */
  private reportPlans(): ReportPlan[] {
    const from = [this.plan, this.elsewhere, this.storeys, this.storey, this.t];
    const shown = this.reportShown;
    if (shown && from.every((value, i) => value === shown.from[i])) return shown.plans;
    const elsewhere = new Map(this.elsewhere.map((other) => [other.storey, other.plan]));
    const levels = storeyLevels(this.storeys);
    // The storey shown is the one whose plan is not among the others'.
    const here = this.storey ?? levels.find(({ storey }) => !elsewhere.has(storey.id))?.storey.id;
    const plans = levels.flatMap(({ storey, level }): ReportPlan[] => {
      const plan = storey.id === here ? this.plan : elsewhere.get(storey.id);
      return plan ? [{ storey: storey.id, name: storeyName(this.t, storey, level), plan }] : [];
    });
    // A home of one storey not listed yet: its plan alone.
    if (plans.length === 0 && this.plan)
      plans.push({ storey: here ?? "", name: "", plan: this.plan });
    this.reportShown = { from, plans };
    return plans;
  }

  /** The rooms the viewer may not see now (D-039, D-071), the same set while they are the same. */
  private reportClosed(): Set<string> {
    const closed = closedRooms(this.settings?.rooms, this.settings?.rights, this._hass);
    const kept = this.reportClosedShown;
    if (kept && kept.size === closed.size && [...closed].every((room) => kept.has(room))) {
      return kept;
    }
    this.reportClosedShown = closed;
    return closed;
  }

  /** "Show in 3D" from the report: closed, the element framed in the 3D view. */
  private readonly onReportShow = (event: CustomEvent<{ element: string }>): void => {
    this.reportOpen = false;
    void this.showRequest({ element: event.detail.element });
  };

  /** Opens guest access (D-067): its module (loaded the first time) and every storey's plan. */
  private readonly openGuests = async (): Promise<void> => {
    const client = this.client;
    if (!client) return;
    this.busy = true;
    try {
      const [, home] = await Promise.all([
        import("./guests-dialog"),
        this.storeys.length > 1 ? loadHome(client, this.storeys) : Promise.resolve([]),
      ]);
      const shown: HomeStorey[] = this.plan
        ? [{ id: this.storey ?? "", name: "", elevation: 0, plan: this.plan, layout: this.layout }]
        : [];
      this.guestsStoreys = home.length > 0 ? home : shown;
    } catch (error) {
      this.show(this.describe(error), true);
    } finally {
      this.busy = false;
    }
  };

  /** Opens the rights (D-071): their module (loaded the first time) and every storey's plan. */
  private readonly openRights = async (): Promise<void> => {
    const client = this.client;
    // Saved over the settings read: none read, nothing to save over.
    if (!client || !this.settingsRead) return;
    this.busy = true;
    try {
      const [, home] = await Promise.all([
        import("./rights-dialog"),
        this.storeys.length > 1 ? loadHome(client, this.storeys) : Promise.resolve([]),
      ]);
      const shown: HomeStorey[] = this.plan
        ? [{ id: this.storey ?? "", name: "", elevation: 0, plan: this.plan, layout: this.layout }]
        : [];
      this.rightsStoreys = home.length > 0 ? home : shown;
    } catch (error) {
      this.show(this.describe(error), true);
    } finally {
      this.busy = false;
    }
  };

  /** Opens the Wi-Fi for guests (D-060), over the 3D view. */
  private readonly openWifi = async (): Promise<void> => {
    if (this.tab !== "3d") this.go("3d");
    await this.updateComplete;
    await this.view?.openWifi();
  };

  /** Opens the voice settings (D-041): their module, loaded the first time. */
  private readonly openVoice = async (): Promise<void> => {
    try {
      await import("./voice-dialog");
      this.voiceOpen = true;
    } catch (error) {
      this.show(this.describe(error), true);
    }
  };

  /** The home's settings: where north points on the plan, shown live while it is set. */
  private renderSettings(north: number): TemplateResult {
    const t = this.t;
    return html`<div
      class="ask glass"
      role="dialog"
      aria-labelledby="settings-title"
      data-testid="settings-dialog"
    >
      <h2 id="settings-title">${t.t("settings.title")}</h2>
      <label class="north">
        <span>${t.t("settings.north")}</span>
        <span class="compass" aria-hidden="true">
          <svg viewBox="-12 -12 24 24" style="transform:rotate(${north}deg)">
            <path d="M0 -10 L4 4 L0 1.5 L-4 4 Z"></path>
          </svg>
          <output>${t.t("settings.degrees", { value: north })}</output>
        </span>
        <input
          type="range"
          min="0"
          max="359"
          step="1"
          data-testid="settings-north"
          .value=${String(north)}
          @input=${(event: Event) => {
            this.northDraft = Number((event.target as HTMLInputElement).value);
          }}
        />
      </label>
      <p class="hint">${t.t("settings.north_hint")}</p>
      ${this.renderLookSettings()} ${this.renderRoofSettings()} ${this.renderWeatherSettings()}
      ${this.renderEnergySettings()}
      <div class="footer">
        <button class="action quiet" data-cancel @click=${() => (this.northDraft = undefined)}>
          ${t.t("panel.cancel")}
        </button>
        <button
          class="action"
          data-testid="settings-save"
          ?disabled=${this.busy}
          @click=${this.saveSettings}
        >
          ${t.t("settings.save")}
        </button>
      </div>
    </div>`;
  }

  /** The energy settings being chosen, as the view shows them (the same while the draft is). */
  private energyPreview(): EnergySettings | undefined {
    const draft = this.energyDraft;
    if (!draft) return this.settings?.energy;
    if (this.energyShown?.draft !== draft) {
      this.energyShown = { draft, energy: readEnergy(draft) };
    }
    return this.energyShown.energy;
  }

  /** Where the home's energy is read (D-049): a sensor of each kind, the likeliest offered first. */
  private renderEnergySettings(): TemplateResult | typeof nothing {
    const t = this.t;
    const draft = this.energyDraft;
    const hass = this._hass;
    if (!draft || !hass) return nothing;
    const language = t.language;
    // Each sensor with its name and what it says now: a power, or a charge.
    const label = (id: string): string => {
      const entity = hass.states[id];
      const friendly = entity?.attributes.friendly_name;
      const name = typeof friendly === "string" && friendly ? friendly : id;
      const power = entity ? watts(entity) : undefined;
      if (power !== undefined) {
        return `${name} · ${power < 0 ? "−" : ""}${formatPower(Math.abs(power), language)}`;
      }
      const charge =
        entity?.attributes.unit_of_measurement === "%" ? numberOf(entity.state) : undefined;
      return charge === undefined ? name : `${name} · ${Math.round(charge)} %`;
    };
    const set = (patch: EnergySettings): void => {
      this.energyDraft = { ...draft, ...patch };
    };
    const sensor = (key: EnergySensor) => {
      const chosen = draft[key];
      const offered = energyCandidates(hass, key, this.energyPreferred?.[key] ?? []);
      if (chosen && !offered.includes(chosen)) offered.unshift(chosen);
      return html`<label class="look">
        <span>${t.t(`settings.energy_${key}`)}</span>
        <select
          data-testid=${`settings-energy-${key}`}
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value || undefined;
            // A sensor left out takes its turned sign with it.
            const sign = key === "grid" || key === "battery" ? `${key}_reversed` : undefined;
            set({ [key]: value, ...(sign && !value ? { [sign]: undefined } : {}) });
          }}
        >
          <option value="" ?selected=${!chosen}>${t.t("settings.energy_none")}</option>
          ${offered.map(
            (id) => html`<option value=${id} ?selected=${id === chosen}>${label(id)}</option>`,
          )}
        </select>
      </label>`;
    };
    const reversed = (key: "grid_reversed" | "battery_reversed", shown: boolean) =>
      shown
        ? html`<label class="reversed">
            <input
              type="checkbox"
              data-testid=${`settings-energy-${key}`}
              .checked=${draft[key] === true}
              @change=${(event: Event) => {
                set({ [key]: (event.target as HTMLInputElement).checked || undefined });
              }}
            />
            <span>${t.t(`settings.energy_${key}`)}</span>
          </label>`
        : nothing;
    return html`<h3>${t.t("settings.energy")}</h3>
      <p class="hint">${t.t("settings.energy_hint")}</p>
      ${sensor("solar")} ${sensor("grid")} ${reversed("grid_reversed", Boolean(draft.grid))}
      ${sensor("battery")} ${reversed("battery_reversed", Boolean(draft.battery))}
      ${sensor("battery_level")}`;
  }

  /** How the roofs are drawn (D-077): their shape, slope and colour, shown as they are chosen. */
  private renderRoofSettings(): TemplateResult | typeof nothing {
    const t = this.t;
    const draft = this.roofDraft;
    if (!draft) return nothing;
    const shape = draft.shape ?? "gable";
    const pitch = draft.pitch ?? ROOF_PITCH;
    return html`<h3>${t.t("settings.roof")}</h3>
      <p class="hint">${t.t("settings.roof_hint")}</p>
      <label class="look">
        <span>${t.t("settings.roof_shape")}</span>
        <select
          data-testid="settings-roof-shape"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value as RoofSettings["shape"];
            this.roofDraft = { ...draft, shape: value };
          }}
        >
          ${ROOF_SHAPES.map(
            (s) =>
              html`<option value=${s} ?selected=${s === shape}>
                ${t.t(`settings.roof_${s}`)}
              </option>`,
          )}
        </select>
      </label>
      ${
        shape === "flat"
          ? nothing
          : html`<label class="look">
              <span>${t.t("settings.roof_pitch", { degrees: pitch })}</span>
              <input
                type="range"
                data-testid="settings-roof-pitch"
                min="5"
                max="60"
                step="5"
                .value=${String(pitch)}
                @change=${(event: Event) => {
                  this.roofDraft = {
                    ...draft,
                    pitch: Number((event.target as HTMLInputElement).value),
                  };
                }}
              />
            </label>`
      }
      <label class="look">
        <span>${t.t("settings.roof_color")}</span>
        <input
          type="color"
          data-testid="settings-roof-color"
          .value=${draft.color ?? (shape === "flat" ? ROOF_MEMBRANE : ROOF_TILES)}
          @change=${(event: Event) => {
            this.roofDraft = { ...draft, color: (event.target as HTMLInputElement).value };
          }}
        />
      </label>
      ${
        draft.color
          ? html`<button
              class="quiet"
              data-testid="settings-roof-color-default"
              @click=${() => {
                const rest = { ...draft };
                delete rest.color;
                this.roofDraft = rest;
              }}
            >
              ${t.t("settings.roof_color_default")}
            </button>`
          : nothing
      }`;
  }

  /** The weather drawn around the home (D-072): the usual entity, one chosen, or none; shown as
   * it is chosen. */
  private renderWeatherSettings(): TemplateResult | typeof nothing {
    const t = this.t;
    const draft = this.weatherDraft;
    const hass = this._hass;
    if (draft === undefined || !hass) return nothing;
    const name = (id: string): string => {
      const friendly = hass.states[id]?.attributes.friendly_name;
      return typeof friendly === "string" && friendly ? friendly : id;
    };
    const usual = usualWeather(hass);
    const offered = weatherEntities(hass);
    if (draft && draft !== "none" && !offered.includes(draft)) offered.unshift(draft);
    return html`<h3>${t.t("settings.weather")}</h3>
      <p class="hint">${t.t("settings.weather_hint")}</p>
      <label class="look">
        <span>${t.t("settings.weather_source")}</span>
        <select
          data-testid="settings-weather"
          @change=${(event: Event) => {
            this.weatherDraft = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="" ?selected=${draft === ""}>
            ${
              usual
                ? t.t("settings.weather_auto", { entity: name(usual) })
                : t.t("settings.weather_auto_none")
            }
          </option>
          ${offered.map(
            (id) => html`<option value=${id} ?selected=${id === draft}>${name(id)}</option>`,
          )}
          <option value="none" ?selected=${draft === "none"}>
            ${t.t("settings.weather_none")}
          </option>
        </select>
      </label>`;
  }

  /** The look of the home in the settings: shown as it is chosen, kept on Save. */
  private renderLookSettings(): TemplateResult | typeof nothing {
    const t = this.t;
    const draft = this.lookDraft;
    if (!draft) return nothing;
    return html`<label class="look">
        <span>${t.t("settings.theme")}</span>
        <select
          data-testid="settings-theme"
          @change=${(event: Event) => {
            const theme = (event.target as HTMLSelectElement).value as ThemeMode;
            this.lookDraft = { ...draft, theme };
          }}
        >
          ${THEME_MODES.map(
            (mode) =>
              html`<option value=${mode} ?selected=${mode === draft.theme}>
                ${t.t(`settings.theme_${mode}`)}
              </option>`,
          )}
        </select>
      </label>
      <div class="look">
        <label for="settings-accent">${t.t("settings.accent")}</label>
        <span class="accent">
          ${
            draft.accent === undefined
              ? nothing
              : html`<button
                  type="button"
                  class="reset"
                  data-testid="settings-accent-default"
                  aria-label=${t.t("settings.accent_reset")}
                  @click=${async () => {
                    // Back to the look's own accent (each look has one); the button goes, the
                    // focus stays on the colour.
                    this.lookDraft = { theme: draft.theme };
                    await this.updateComplete;
                    this.renderRoot.querySelector<HTMLElement>("#settings-accent")?.focus();
                  }}
                >
                  ${t.t("settings.accent_default")}
                </button>`
          }
          <input
            id="settings-accent"
            type="color"
            data-testid="settings-accent"
            .value=${draft.accent ?? defaultAccent(this.look)}
            @input=${(event: Event) => {
              const accent = readAccent((event.target as HTMLInputElement).value);
              if (accent) this.lookDraft = { ...draft, accent };
            }}
          />
        </span>
      </div>
      <p class="hint">${t.t("settings.theme_hint")}</p>`;
  }

  /** Edit mode's header: Cancel and Save. */
  private renderEditActions(): TemplateResult {
    const t = this.t;
    return html`<button
        class="action"
        data-testid="edit-cancel"
        ?disabled=${this.busy}
        @click=${this.cancelEdit}
        aria-label=${t.t("edit.cancel")}
        title=${t.t("edit.cancel")}
      >
        ${icon(mdiClose)}<span class="label">${t.t("edit.cancel")}</span>
      </button>
      <button
        class="action"
        data-testid="edit-save"
        ?disabled=${this.busy || !this.edit?.dirty}
        @click=${this.saveEdit}
        aria-label=${t.t("edit.save")}
        title=${t.t("edit.save")}
      >
        ${icon(mdiCheck)}<span class="label">${t.t("edit.save")}</span>
      </button>`;
  }

  /** The plan editor's header: Cancel and Save. */
  private renderPlanActions(): TemplateResult {
    const t = this.t;
    return html`<button
        class="action"
        data-testid="plan-cancel"
        ?disabled=${this.busy}
        @click=${this.cancelPlan}
        aria-label=${t.t("edit.cancel")}
        title=${t.t("edit.cancel")}
      >
        ${icon(mdiClose)}<span class="label">${t.t("edit.cancel")}</span>
      </button>
      <button
        class="action"
        data-testid="plan-save"
        ?disabled=${this.busy || !this.planState?.dirty}
        @click=${this.savePlanEdit}
        aria-label=${t.t("edit.save")}
        title=${t.t("edit.save")}
      >
        ${icon(mdiCheck)}<span class="label">${t.t("edit.save")}</span>
      </button>`;
  }

  /** The plan editor over the view: its bar, the draft offer, the discard question. */
  private renderPlanTools(): TemplateResult {
    const t = this.t;
    return html`${
      this.planState
        ? html`<domotwin-plan-bar
            .hass=${this._hass}
            .state=${this.planState}
            .tool=${this.planTool}
            @domotwin-plan-tool=${(event: Event) => {
              this.planTool = (event as CustomEvent<PlanTool>).detail;
            }}
            @domotwin-plan-command=${this.onPlanCommand}
            @domotwin-plan-update=${this.onPlanUpdate}
          ></domotwin-plan-bar>`
        : nothing
    }
    ${
      this.planOffer
        ? html`<div class="draft glass" role="status" data-testid="plan-draft">
            <span>${t.t("plan.draft")}</span>
            <button class="action quiet" @click=${this.forgetPlanDraft}>
              ${t.t("edit.forget")}
            </button>
            <button class="action" data-testid="plan-restore" @click=${this.restorePlanDraft}>
              ${t.t("edit.restore")}
            </button>
          </div>`
        : nothing
    }
    ${
      this.planDiscardAsk
        ? html`<div
            class="ask glass"
            role="alertdialog"
            aria-labelledby="plan-discard-title"
            data-testid="plan-discard"
          >
            <h2 id="plan-discard-title">${t.t("plan.discard_title")}</h2>
            <div class="footer">
              <button
                class="action quiet"
                data-cancel
                data-autofocus
                @click=${() => (this.planDiscardAsk = false)}
              >
                ${t.t("edit.keep")}
              </button>
              <button class="action" data-testid="plan-discard-confirm" @click=${this.discardPlan}>
                ${t.t("edit.discard")}
              </button>
            </div>
          </div>`
        : nothing
    }`;
  }

  /** Over the view outside edit mode: the link editor, the storey picker. */
  private renderSheets(): TemplateResult {
    const target = this.linkTarget;
    return html`${
      target
        ? html`<domotwin-link
            .hass=${this._hass}
            .heading=${target.element.name || target.element.id}
            .element=${target.element}
            .binding=${target.binding}
            .area=${target.area}
            .roomArea=${target.roomArea}
            .roomActions=${target.roomActions ?? NO_ACTIONS}
            .pieceEntities=${target.pieceEntities ?? NO_ENTITIES}
            .busy=${this.busy}
            @domotwin-link-save=${this.onLinkSave}
            @domotwin-close=${() => (this.linkTarget = undefined)}
          ></domotwin-link>`
        : nothing
    }
    ${this.importChoice ? this.renderStoreys(this.importChoice) : nothing}
    ${this.robotChoice ? this.renderRobotMaps(this.robotChoice) : nothing}
    ${this.northDraft !== undefined ? this.renderSettings(this.northDraft) : nothing}
    ${
      this.peopleOpen
        ? html`<domotwin-people-settings
            .hass=${this._hass}
            .settings=${this.peopleSettings}
            @domotwin-close=${() => (this.peopleOpen = false)}
            @domotwin-saved=${() => {
              this.show(this.t.t("people.saved"));
            }}
          ></domotwin-people-settings>`
        : nothing
    }
    ${
      this.bluetoothOpen
        ? html`<domotwin-bluetooth-settings
            .hass=${this._hass}
            .settings=${this.locating}
            @domotwin-close=${() => (this.bluetoothOpen = false)}
            @domotwin-saved=${() => {
              this.show(this.t.t("bluetooth.saved"));
            }}
          ></domotwin-bluetooth-settings>`
        : nothing
    }
    ${
      this.privacyRooms
        ? html`<domotwin-private-rooms
            .hass=${this._hass}
            .settings=${this.settings ?? {}}
            .rooms=${this.privacyRooms}
            @domotwin-close=${() => (this.privacyRooms = undefined)}
            @domotwin-saved=${(event: CustomEvent<Settings>) => {
              this.settings = event.detail;
              this.show(this.t.t("settings.saved"));
            }}
          ></domotwin-private-rooms>`
        : nothing
    }
    ${
      this.voiceOpen
        ? html`<domotwin-voice
            .hass=${this._hass}
            .mode=${"settings"}
            @domotwin-close=${() => (this.voiceOpen = false)}
          ></domotwin-voice>`
        : nothing
    }
    ${
      this.guestsStoreys
        ? html`<domotwin-guests
            .hass=${this._hass}
            .storeys=${this.guestsStoreys}
            .bindings=${this.bindings}
            ?wifiSet=${this.wifi?.set === true}
            @domotwin-close=${() => (this.guestsStoreys = undefined)}
          ></domotwin-guests>`
        : nothing
    }
    ${
      this.rightsStoreys
        ? html`<domotwin-rights
            .hass=${this._hass}
            .settings=${this.settings ?? {}}
            .storeys=${this.rightsStoreys}
            .bindings=${this.bindings}
            @domotwin-close=${() => (this.rightsStoreys = undefined)}
            @domotwin-saved=${(event: CustomEvent<Settings>) => {
              this.settings = event.detail;
              this.show(this.t.t("settings.saved"));
            }}
          ></domotwin-rights>`
        : nothing
    }
    ${
      this.configHistoryOpen
        ? html`<domotwin-config-history
            .hass=${this._hass}
            @domotwin-close=${() => (this.configHistoryOpen = false)}
          ></domotwin-config-history>`
        : nothing
    }
    ${
      this.reportOpen
        ? html`<domotwin-report
            .hass=${this._hass}
            .plans=${this.reportPlans()}
            .closed=${this.reportClosed()}
            .asked=${this.reportAsked}
            @domotwin-close=${() => (this.reportOpen = false)}
            @domotwin-show=${this.onReportShow}
          ></domotwin-report>`
        : nothing
    }
    ${this.plainOpen && this.plainSession && this._hass ? this.renderPlain(this._hass, this.plainSession) : nothing}
    ${this.storeysOpen ? this.renderStoreysDialog() : nothing}`;
  }

  /**
   * Whether what the viewer may not see is known (D-039): the settings, the plan (or that there
   * is none), its links and the other storeys' rooms read. Until then nothing is named to an AI
   * task (D-070).
   */
  private homeRead(): boolean {
    return (
      this.settingsRead &&
      this.bindingsRead &&
      this.plan !== undefined &&
      (this.storeys.length <= 1 || this.elsewhereRead)
    );
  }

  /** An automation in plain words (D-070), with what the viewer may not see left out of it. */
  private renderPlain(hass: HomeAssistant, session: PlainSession): TemplateResult {
    return html`<domotwin-plain
      .hass=${hass}
      .session=${session}
      .unseen=${this.homeRead() ? this.practical(hass).unseen : undefined}
      @domotwin-close=${() => (this.plainOpen = false)}
      @domotwin-plain-play=${this.playPlain}
    ></domotwin-plain>`;
  }

  /** The storeys of the home: name, height, removal; a new storey drawn or imported. */
  private renderStoreysDialog(): TemplateResult {
    const t = this.t;
    const metres = new Intl.NumberFormat("en", { maximumFractionDigits: 2, useGrouping: false });
    const ask = this.storeyRemoveAsk;
    const levels = storeyLevels(this.storeys).reverse();
    if (ask) {
      const level = levels.find(({ storey }) => storey.id === ask.id)?.level ?? 0;
      const name = storeyName(t, ask, level);
      return html`<div
        class="ask glass"
        role="alertdialog"
        aria-labelledby="storey-remove-title"
        data-testid="storey-remove"
      >
        <h2 id="storey-remove-title">${t.t("storey.remove_title", { name })}</h2>
        <div class="footer">
          <button
            class="action quiet"
            data-cancel
            data-autofocus
            @click=${() => (this.storeyRemoveAsk = undefined)}
          >
            ${t.t("panel.cancel")}
          </button>
          <button
            class="action"
            data-testid="storey-remove-confirm"
            ?disabled=${this.busy}
            @click=${() => {
              void this.removeStorey(ask, name);
            }}
          >
            ${t.t("storey.remove", { name })}
          </button>
        </div>
      </div>`;
    }
    return html`<div
      class="storeys glass manage"
      role="dialog"
      aria-labelledby="storeys-title"
      data-testid="storeys-dialog"
    >
      <h2 id="storeys-title">${t.t("storey.title")}</h2>
      ${levels.map(({ storey, level }) => {
        const name = storeyName(t, storey, level);
        return html`<div class="storey-row" data-storey=${storey.id}>
          <label
            >${t.t("storey.name")}
            <input
              data-testid="storey-name"
              ?disabled=${this.busy}
              maxlength="60"
              placeholder=${storeyName(t, { ...storey, name: "" }, level)}
              .value=${storey.name}
              @change=${(event: Event) => {
                const value = (event.target as HTMLInputElement).value.trim();
                if (value !== storey.name) void this.changeStorey(storey, { name: value });
              }}
          /></label>
          <label
            >${t.t("storey.elevation")}
            <input
              class="metres"
              data-testid="storey-elevation"
              ?disabled=${this.busy}
              inputmode="decimal"
              .value=${metres.format(storey.elevation / 100)}
              @change=${(event: Event) => {
                const input = event.target as HTMLInputElement;
                const value = Number(input.value.trim().replace(",", ".").replace("−", "-"));
                if (
                  !input.value.trim() ||
                  !Number.isFinite(value) ||
                  value < -100 ||
                  value > 1000
                ) {
                  input.setAttribute("aria-invalid", "true");
                  input.title = t.t("storey.bad_elevation");
                  return;
                }
                input.removeAttribute("aria-invalid");
                const elevation = Math.round(value * 100);
                if (elevation !== storey.elevation) void this.changeStorey(storey, { elevation });
              }}
          /></label>
          <button
            class="icon-button"
            data-testid="storey-remove-ask"
            title=${t.t("storey.remove", { name })}
            aria-label=${t.t("storey.remove", { name })}
            ?disabled=${this.busy || this.storeys.length < 2}
            @click=${() => (this.storeyRemoveAsk = storey)}
          >
            ${icon(mdiClose)}
          </button>
        </div>`;
      })}
      <div class="footer">
        <button class="action quiet" data-testid="storey-import" @click=${this.importStoreyFile}>
          ${icon(mdiTrayArrowUp)}${t.t("storey.import")}
        </button>
        <button class="action quiet" data-testid="storey-draw" @click=${this.drawStorey}>
          ${icon(mdiVectorSquareEdit)}${t.t("storey.draw")}
        </button>
        <button class="action" data-cancel @click=${() => (this.storeysOpen = false)}>
          ${t.t("storey.close")}
        </button>
      </div>
    </div>`;
  }

  private renderToast(): TemplateResult | typeof nothing {
    const toast = this.toast;
    if (!toast) return nothing;
    return html`<div
      class="toast glass ${toast.error ? "error" : ""} ${this.editing || this.planning ? "top" : ""}"
      role=${toast.error ? "alert" : nothing}
      data-testid="toast"
    >
      <span>${toast.text}</span>
      ${
        toast.action
          ? html`<button class="action" data-testid="toast-action" @click=${toast.action.run}>
              ${toast.action.label}
            </button>`
          : nothing
      }
      <button @click=${() => (this.toast = undefined)} aria-label=${this.t.t("panel.dismiss")}>
        ${icon(mdiClose)}
      </button>
    </div>`;
  }

  /** Edit mode over the view: the edit bar, the catalogue, the draft offer, the discard question. */
  private renderEditTools(): TemplateResult {
    const t = this.t;
    // The catalogue covers the bottom of the view: the bar comes back when it closes.
    return html`${
      this.edit && !this.catalogue && !this.modelImport
        ? html`<domotwin-edit-bar
            .hass=${this._hass}
            .state=${this.edit}
            .multi=${this.multi}
            @domotwin-edit-command=${this.onEditCommand}
            @domotwin-edit-multi=${(event: Event) => {
              this.multi = (event as CustomEvent<boolean>).detail;
            }}
            @domotwin-edit-catalogue=${this.openCatalogue}
          ></domotwin-edit-bar>`
        : nothing
    }
    ${
      this.catalogue
        ? html`<domotwin-catalogue
            data-testid="catalogue"
            .hass=${this._hass}
            .heading=${t.t("edit.add")}
            .kinds=${this.catalogue}
            .models=${this.models}
            .look=${this.view?.look ?? "day"}
            .accent=${this.view?.accentShown ?? ""}
            @domotwin-add=${this.onAdd}
            @domotwin-add-model=${this.onAddModel}
            @domotwin-forget-model=${this.onForgetModel}
            @domotwin-import-model=${this.chooseModel}
            @domotwin-close=${() => (this.catalogue = undefined)}
          ></domotwin-catalogue>`
        : nothing
    }
    ${
      this.modelImport
        ? html`<domotwin-model-import
            data-testid="model-import-sheet"
            .hass=${this._hass}
            .heading=${t.t("model.title")}
            .fileName=${this.modelImport.fileName}
            .format=${this.modelImport.format}
            .info=${this.modelImport.info}
            .busy=${this.busy}
            @domotwin-model-confirm=${this.confirmModel}
            @domotwin-close=${() => (this.modelImport = undefined)}
          ></domotwin-model-import>`
        : nothing
    }
    ${
      this.draft
        ? html`<div class="draft glass" role="status" data-testid="edit-draft">
            <span>${t.t("edit.draft")}</span>
            <button class="action quiet" @click=${this.forgetDraft}>${t.t("edit.forget")}</button>
            <button class="action" data-testid="edit-restore" @click=${this.restoreDraft}>
              ${t.t("edit.restore")}
            </button>
          </div>`
        : nothing
    }
    ${
      this.discardAsk
        ? html`<div
            class="ask glass"
            role="alertdialog"
            aria-labelledby="edit-discard-title"
            data-testid="edit-discard"
          >
            <h2 id="edit-discard-title">${t.t("edit.discard_title")}</h2>
            <div class="footer">
              <button
                class="action quiet"
                data-cancel
                data-autofocus
                @click=${() => (this.discardAsk = false)}
              >
                ${t.t("edit.keep")}
              </button>
              <button class="action" data-testid="edit-discard-confirm" @click=${this.discardEdit}>
                ${t.t("edit.discard")}
              </button>
            </div>
          </div>`
        : nothing
    }`;
  }
}
