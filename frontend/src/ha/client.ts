import type { ThemeMode } from "../config";
import type { ShowRequest } from "../live/show";
import type { HassConnection, HassMessage, HomeAssistant } from "./types";

export type PlanJson = Record<string, unknown> & { title?: unknown; elements?: unknown };

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

/** The home's settings, set by an administrator. */
export interface Settings {
  /** Where north points on the plan, degrees clockwise from its top (0: up). */
  north?: number;
  /** The look shown by default (D-027) and its accent (`#rrggbb`). */
  theme?: ThemeMode;
  accent?: string;
}

export interface StoredSettings {
  settings: Settings;
  revision: number;
}

/** A save (its kind and revision), or a `domotwin.show` request (D-029). */
export type UpdateEvent =
  | { kind: "plan" | "bindings" | "settings"; revision: number }
  | { kind: "show"; show: ShowRequest };

type Listener = (event: UpdateEvent) => void;

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
  private readonly listeners = new Set<Listener>();
  private unsubscribe?: Promise<() => Promise<void>>;

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
  async saveBindings(bindings: Bindings, expectedRevision?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/bindings/save", bindings };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.bindings = undefined;
    return result.revision;
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
      }
    };
  }
}
