import type { ThemeMode } from "../config";
import { readChoices, type Choices, type HomeCard, type Tab } from "../live/choices";
import type { LocatedCandidate, LocatedSettings, LocatingSettings } from "../live/locating";
import type { PeopleSettings, PersonSettings } from "../live/people";
import { readSchedules, type Schedule } from "../live/schedules";
import type { ShowRequest } from "../live/show";
import type { Upkeep, UpkeepCard } from "../live/upkeep";
import { readWifi, type Wifi, type WifiChange } from "../live/wifi";
import { readPass, readPasses, type GuestPass, type GuestPassChange } from "../live/guest-pass";
import type { HassConnection, HassMessage, HomeAssistant } from "./types";
import type { EnergySettings } from "../live/energy";
import type { AccessPoint } from "../live/placement";

export type PlanJson = Record<string, unknown> & { name?: unknown; items?: unknown };

/** A storey of the home (`docs/DECISIONS.md`, D-026). */
export interface StoreyInfo {
  id: string;
  /** Empty: named by its place among the storeys. */
  name: string;
  /** Height of its floor above the ground floor's (cm). */
  elevation: number;
}

/** The plan and overlay of one storey, with the list of storeys. */
export interface StoredPlan {
  plan: PlanJson | null;
  layout: Record<string, unknown>;
  /** The storey they belong to (null: no storey yet). */
  storey: string | null;
  /** Every storey, lowest first. */
  storeys: StoreyInfo[];
  revision: number;
}

/** What `saveStorey` changes: a new storey without `storey` (its plan is needed). */
export interface StoreyChange {
  storey?: string;
  name?: string;
  elevation?: number;
  plan?: PlanJson;
  layout?: Record<string, unknown>;
}

export interface Bindings {
  version: 1;
  rooms: Record<string, { area?: string }>;
  elements: Record<string, unknown>;
}

export interface StoredBindings {
  bindings: Bindings;
  revision: number;
}

/** A private room (D-039): kept for these people (none: for nobody), always or while an entity
 * is on. */
export interface PrivateRoom {
  people: string[];
  while?: string;
}

/** The home's settings, set by an administrator. */
export interface Settings {
  /** Where north points on the plan, degrees clockwise from its top (0: up). */
  north?: number;
  /** The look shown by default (D-027) and its accent (`#rrggbb`). */
  theme?: ThemeMode;
  accent?: string;
  /** The private rooms, by room id (D-039). */
  rooms?: Record<string, PrivateRoom>;
  /** Where the home's energy is read (D-049). */
  energy?: EnergySettings;
  /** The Wi-Fi access points placed on the plan (D-066). */
  access_points?: AccessPoint[];
  /** The weather drawn around the home (D-069): a `weather` entity, or `none`; absent, the one
   * the Home tab shows. */
  weather?: string;
}

export interface StoredSettings {
  settings: Settings;
  revision: number;
}

/** The upkeep cards (D-033), with today's date where the home is. */
export interface StoredUpkeep {
  upkeep: Upkeep;
  revision: number;
  today: string;
}

/** What a save changed: told to every screen listening, with its revision. */
export type SaveKind =
  "plan" | "bindings" | "settings" | "upkeep" | "people" | "locating" | "wifi" | "guests";

/** A save (its kind and revision), or a `domotwin.show` request (D-029). */
export type UpdateEvent =
  { kind: SaveKind; revision: number } | { kind: "show"; show: ShowRequest };

type Listener = (event: UpdateEvent) => void;

/**
 * An action to do later (D-046): switch the entities on at `at` (a time of day, the next one, or
 * an ISO date), and off again `duration` seconds later or at `until`; or switch them off.
 */
export interface NewSchedule {
  entities: string[];
  action?: "on" | "off";
  at: string;
  until?: string;
  duration?: number;
  /** For lights switched on (%). */
  brightness?: number;
}

const clients = new WeakMap<HassConnection, DomoTwinClient>();

/**
 * The DomoTwin websocket API of one Home Assistant connection. Cards and the panel share one
 * client, one cached plan and one subscription.
 */
export class DomoTwinClient {
  /** The plans asked for, by storey ("" for the ground floor). */
  private readonly plans = new Map<string, Promise<StoredPlan>>();
  private bindings?: Promise<StoredBindings>;
  private settings?: Promise<StoredSettings>;
  private upkeep?: Promise<StoredUpkeep>;
  private people?: Promise<PeopleSettings>;
  private readonly listeners = new Set<Listener>();
  private unsubscribe?: Promise<() => Promise<void>>;
  /** The actions waiting (D-046), as last listed, and who follows them. */
  private schedules?: Schedule[];
  private readonly scheduleListeners = new Set<(items: Schedule[]) => void>();
  private unsubscribeSchedules?: Promise<() => Promise<void>>;

  private constructor(private readonly connection: HassConnection) {}

  static for(hass: HomeAssistant): DomoTwinClient {
    let client = clients.get(hass.connection);
    if (!client) {
      client = new DomoTwinClient(hass.connection);
      clients.set(hass.connection, client);
    }
    return client;
  }

  /** The plan and overlay of storey `storey` (the ground floor by default), with the list of storeys. */
  getPlan(storey?: string): Promise<StoredPlan> {
    const key = storey ?? "";
    let plan = this.plans.get(key);
    if (!plan) {
      const message: HassMessage = { type: "domotwin/plan/get" };
      if (storey !== undefined) message.storey = storey;
      plan = this.connection.sendMessagePromise<StoredPlan>(message);
      this.plans.set(key, plan);
      plan.catch(() => this.plans.delete(key));
    }
    return plan;
  }

  getBindings(): Promise<StoredBindings> {
    this.bindings ??= this.connection.sendMessagePromise<StoredBindings>({
      type: "domotwin/bindings/get",
    });
    this.bindings.catch(() => (this.bindings = undefined));
    return this.bindings;
  }

  getSettings(): Promise<StoredSettings> {
    this.settings ??= this.connection.sendMessagePromise<StoredSettings>({
      type: "domotwin/settings/get",
    });
    this.settings.catch(() => (this.settings = undefined));
    return this.settings;
  }

  getUpkeep(): Promise<StoredUpkeep> {
    this.upkeep ??= this.connection.sendMessagePromise<StoredUpkeep>({
      type: "domotwin/upkeep/get",
    });
    this.upkeep.catch(() => (this.upkeep = undefined));
    return this.upkeep;
  }

  /**
   * Stores upkeep cards by piece id (`null` removes one) and, with `leadDays`, how many days
   * before it a task is due soon (admins only). Only the pieces given change.
   */
  async saveUpkeep(pieces: Record<string, UpkeepCard | null>, leadDays?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/upkeep/save", pieces };
    if (leadDays !== undefined) message.lead_days = leadDays;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.upkeep = undefined;
    return result.revision;
  }

  /** The people placed in their rooms (D-034): from what, in which colour, who sees them. */
  getPeople(): Promise<PeopleSettings> {
    this.people ??= this.connection.sendMessagePromise<PeopleSettings>({
      type: "domotwin/people/get",
    });
    this.people.catch(() => (this.people = undefined));
    return this.people;
  }

  /**
   * The same, with the entities that may say where someone is (`candidates`, administrators):
   * for the people's settings, not cached (the integration looks at every sensor for it).
   */
  getPeopleWithCandidates(): Promise<PeopleSettings> {
    return this.connection.sendMessagePromise<PeopleSettings>({
      type: "domotwin/people/get",
      candidates: true,
    });
  }

  /** Stores who is placed from what, who sees the people and how they look (admins only). */
  async savePeople(
    people: Record<string, PersonSettings>,
    shown?: PeopleSettings["shown"],
    look?: PeopleSettings["look"],
    expectedRevision?: number,
  ): Promise<number> {
    const message: HassMessage = { type: "domotwin/people/save", people };
    if (shown !== undefined) message.shown = shown;
    if (look !== undefined) message.look = look;
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.people = undefined;
    return result.revision;
  }

  /** Hides a person from DomoTwin's views, or shows them again (oneself, or as an admin). */
  async hidePerson(person: string, hidden: boolean): Promise<number> {
    const result = await this.connection.sendMessagePromise<{ revision: number }>({
      type: "domotwin/people/hide",
      person,
      hidden,
    });
    this.people = undefined;
    return result.revision;
  }

  /** Marks a task done today, where the home is (every user). Returns the date stored. */
  async upkeepDone(piece: string, task: string): Promise<string> {
    const result = await this.connection.sendMessagePromise<{ last_done: string }>({
      type: "domotwin/upkeep/done",
      piece,
      task,
    });
    this.upkeep = undefined;
    return result.last_done;
  }

  /** Stores the settings (admins only). */
  async saveSettings(settings: Settings): Promise<number> {
    const result = await this.connection.sendMessagePromise<{ revision: number }>({
      type: "domotwin/settings/save",
      settings,
    });
    this.settings = undefined;
    return result.revision;
  }

  /**
   * Stores a plan (admins only). `expectedRevision` refuses the save if another device saved;
   * `layout` replaces the edit overlay too (the plan editor stores the overlay in the plan).
   */
  async savePlan(
    plan: PlanJson | null,
    expectedRevision?: number,
    layout?: Record<string, unknown>,
    storey?: string,
  ): Promise<number> {
    const message: HassMessage = { type: "domotwin/plan/save", plan };
    if (layout) message.layout = layout;
    if (storey !== undefined) message.storey = storey;
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.plans.clear();
    return result.revision;
  }

  /** Stores the edit overlay of edit mode (admins only). `expectedRevision` as for `savePlan`. */
  async saveLayout(
    layout: Record<string, unknown>,
    expectedRevision?: number,
    storey?: string,
  ): Promise<number> {
    const message: HassMessage = { type: "domotwin/plan/save", layout };
    if (storey !== undefined) message.storey = storey;
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.plans.clear();
    return result.revision;
  }

  /**
   * Adds a storey (without `change.storey`; its plan is needed) or changes one (admins only).
   * Returns the revision and the storey's id.
   */
  async saveStorey(
    change: StoreyChange,
    expectedRevision?: number,
  ): Promise<{ revision: number; storey: string }> {
    const message: HassMessage = { type: "domotwin/storey/save", ...change };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number; storey: string }>(
      message,
    );
    this.plans.clear();
    return result;
  }

  /**
   * Replaces every storey of the home at once (admins only): all of them are stored, or none.
   * Returns the revision and the new storeys' ids, in order.
   */
  async replaceStoreys(
    storeys: { plan: PlanJson; name?: string; elevation?: number }[],
    expectedRevision?: number,
  ): Promise<{ revision: number; storeys: string[] }> {
    const message: HassMessage = { type: "domotwin/storeys/replace", storeys };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{
      revision: number;
      storeys: string[];
    }>(message);
    this.plans.clear();
    return result;
  }

  /** Removes a storey with its plan and overlay (admins only). */
  async removeStorey(storey: string, expectedRevision?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/storey/remove", storey };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.plans.clear();
    return result.revision;
  }

  /** Stores the bindings (admins only). `expectedRevision` as for `savePlan`. */
  /** The Bluetooth locating (D-035): receivers, devices followed, their rooms (admins only). */
  getLocating(): Promise<LocatingSettings> {
    return this.connection.sendMessagePromise<LocatingSettings>({ type: "domotwin/locating/get" });
  }

  /** Stores where the receivers are and which devices are followed (admins only). */
  async saveLocating(
    receivers: Record<string, { room?: string; piece?: string }>,
    devices: Record<string, LocatedSettings>,
    learn: boolean,
    expectedRevision?: number,
  ): Promise<number> {
    const message: HassMessage = { type: "domotwin/locating/save", receivers, devices, learn };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.people = undefined;
    return result.revision;
  }

  /** Devices that may be followed: Private BLE Device entries, iBeacons and tags heard. */
  async locatingCandidates(): Promise<LocatedCandidate[]> {
    const result = await this.connection.sendMessagePromise<{ candidates: LocatedCandidate[] }>({
      type: "domotwin/locating/candidates",
    });
    return result.candidates;
  }

  /** Teaches a room: the integration listens to a device held there for `seconds`. */
  teachRoom(
    device: string,
    room: string,
    seconds: number,
  ): Promise<{ readings: number; receivers: number }> {
    return this.connection.sendMessagePromise({
      type: "domotwin/locating/teach",
      device,
      room,
      seconds,
    });
  }

  /** Forgets what was learned in a room (every room without one). Returns how many were. */
  async forgetLearned(room?: string): Promise<number> {
    const message: HassMessage = { type: "domotwin/locating/forget" };
    if (room !== undefined) message.room = room;
    const result = await this.connection.sendMessagePromise<{ forgotten: number }>(message);
    return result.forgotten;
  }

  async saveBindings(bindings: Bindings, expectedRevision?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/bindings/save", bindings };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.bindings = undefined;
    return result.revision;
  }

  /**
   * Calls `listener` with the actions waiting, at once if they are known and whenever they
   * change (D-046). Without them (an integration older than D-046), it is never called. Returns a
   * function that stops it.
   */
  subscribeSchedules(listener: (items: Schedule[]) => void): () => void {
    this.scheduleListeners.add(listener);
    if (this.schedules) listener(this.schedules);
    if (!this.unsubscribeSchedules) {
      const subscribed = this.connection.subscribeMessage<unknown>(
        (event) => {
          this.schedules = readSchedules(event);
          for (const each of this.scheduleListeners) each(this.schedules);
        },
        { type: "domotwin/schedules/subscribe" },
      );
      this.unsubscribeSchedules = subscribed;
      subscribed.catch(() => {
        if (this.unsubscribeSchedules === subscribed) this.unsubscribeSchedules = undefined;
      });
    }
    return () => {
      this.scheduleListeners.delete(listener);
      if (this.scheduleListeners.size === 0 && this.unsubscribeSchedules) {
        const unsubscribe = this.unsubscribeSchedules;
        this.unsubscribeSchedules = undefined;
        this.schedules = undefined;
        void unsubscribe.then((stop) => stop()).catch(() => undefined);
      }
    };
  }

  /** Sets an action to do later; answers it and what will happen, in Home Assistant's words. */
  addSchedule(item: NewSchedule): Promise<{ schedule: Schedule; text: string }> {
    const message: HassMessage = { type: "domotwin/schedules/add", ...item };
    return this.connection.sendMessagePromise(message);
  }

  /** Cancels an action; answers whether it was still waiting. */
  async cancelSchedule(id: string): Promise<boolean> {
    const result = await this.connection.sendMessagePromise<{ cancelled: number }>({
      type: "domotwin/schedules/cancel",
      schedule_id: id,
    });
    return result.cancelled > 0;
  }

  /** The user's own choices (D-055): favourites, the tab DomoTwin opens on, the Home cards. */
  async getChoices(): Promise<Choices> {
    return readChoices(await this.connection.sendMessagePromise({ type: "domotwin/choices/get" }));
  }

  /** Stars an entity, or takes its star away; answers the favourites. */
  async setFavourite(entityId: string, favourite: boolean): Promise<string[]> {
    const result = await this.connection.sendMessagePromise<unknown>({
      type: "domotwin/choices/favourite",
      entity_id: entityId,
      favourite,
    });
    return readChoices(result).favourites;
  }

  /** Sets the tab DomoTwin opens on (`""`: none chosen) and the Home tab's cards. */
  async saveChoices(change: { start?: Tab | ""; cards?: HomeCard[] }): Promise<Choices> {
    return readChoices(
      await this.connection.sendMessagePromise({ type: "domotwin/choices/save", ...change }),
    );
  }

  /**
   * The home's Wi-Fi for guests (D-060), as this user may see it on `screen` (a card's, else
   * none): all of it for an administrator, what draws its code on a screen an administrator chose.
   * Its password only when asked for (`password`: the dialog open).
   */
  async getWifi(screen = "", password = false): Promise<Wifi> {
    return readWifi(
      await this.connection.sendMessagePromise({ type: "domotwin/wifi/get", screen, password }),
    );
  }

  /** Sets the home's Wi-Fi (administrators); answers it. */
  async saveWifi(wifi: WifiChange): Promise<Wifi> {
    return readWifi(await this.connection.sendMessagePromise({ type: "domotwin/wifi/save", wifi }));
  }

  /** Forgets the home's Wi-Fi (administrators). */
  async clearWifi(): Promise<Wifi> {
    return readWifi(await this.connection.sendMessagePromise({ type: "domotwin/wifi/clear" }));
  }

  /** The guest passes (D-067), with their links: administrators only. */
  async getGuests(): Promise<GuestPass[]> {
    return readPasses(await this.connection.sendMessagePromise({ type: "domotwin/guests/get" }));
  }

  /** Makes or changes a guest pass (administrators); answers it as kept. */
  async saveGuest(pass: GuestPassChange): Promise<GuestPass> {
    const saved = readPass(
      await this.connection.sendMessagePromise({ type: "domotwin/guests/save", pass }),
    );
    if (!saved) throw Object.assign(new Error("invalid"), { code: "invalid" });
    return saved;
  }

  /** Removes a guest pass (administrators): its link stops working at once. */
  async removeGuest(id: string): Promise<boolean> {
    const result = await this.connection.sendMessagePromise<{ removed: boolean }>({
      type: "domotwin/guests/remove",
      pass: id,
    });
    return result.removed;
  }

  /** Calls `listener` after every save, from any device. Returns a function that stops it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.unsubscribe ??= this.connection.subscribeMessage<UpdateEvent>(
      (event) => {
        // Each kind has its revision: a save of the bindings leaves the plans fetched valid. A
        // request to show something changes nothing.
        if (event.kind === "bindings") this.bindings = undefined;
        else if (event.kind === "settings") this.settings = undefined;
        else if (event.kind === "upkeep") this.upkeep = undefined;
        else if (event.kind === "people") this.people = undefined;
        else if (event.kind === "plan") this.plans.clear();
        for (const each of this.listeners) each(event);
      },
      { type: "domotwin/subscribe" },
    );
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubscribe) {
        const unsubscribe = this.unsubscribe;
        this.unsubscribe = undefined;
        void unsubscribe.then((stop) => stop()).catch(() => undefined);
        // Followed by nobody, what was read may change unseen: read again next time.
        this.plans.clear();
        this.bindings = undefined;
        this.settings = undefined;
        this.upkeep = undefined;
        this.people = undefined;
      }
    };
  }
}
