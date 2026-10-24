import type { HassConnection, HassMessage, HomeAssistant } from "./types";

export type PlanJson = Record<string, unknown> & { title?: unknown; elements?: unknown };

export interface StoredPlan {
  plan: PlanJson | null;
  layout: Record<string, unknown>;
  revision: number;
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
}

export interface StoredSettings {
  settings: Settings;
  revision: number;
}

export interface UpdateEvent {
  kind: "plan" | "bindings" | "settings";
  revision: number;
}

type Listener = (event: UpdateEvent) => void;

const clients = new WeakMap<HassConnection, DomoTwinClient>();

/**
 * The DomoTwin websocket API of one Home Assistant connection. Cards and the panel share one
 * client, one cached plan and one subscription.
 */
export class DomoTwinClient {
  private plan?: Promise<StoredPlan>;
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

  getPlan(): Promise<StoredPlan> {
    this.plan ??= this.connection.sendMessagePromise<StoredPlan>({ type: "domotwin/plan/get" });
    this.plan.catch(() => (this.plan = undefined));
    return this.plan;
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

  /** Stores a plan (admins only). `expectedRevision` refuses the save if another device saved. */
  async savePlan(plan: PlanJson | null, expectedRevision?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/plan/save", plan };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.plan = undefined;
    return result.revision;
  }

  /** Stores the edit overlay of edit mode (admins only). `expectedRevision` as for `savePlan`. */
  async saveLayout(layout: Record<string, unknown>, expectedRevision?: number): Promise<number> {
    const message: HassMessage = { type: "domotwin/plan/save", layout };
    if (expectedRevision !== undefined) message.expected_revision = expectedRevision;
    const result = await this.connection.sendMessagePromise<{ revision: number }>(message);
    this.plan = undefined;
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
        // One revision counts every save: any save makes the cached revisions stale.
        this.plan = undefined;
        this.bindings = undefined;
        this.settings = undefined;
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
