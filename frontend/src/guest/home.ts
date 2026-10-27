/**
 * The home as a guest pass shows it (D-067), for DomoTwin's own page outside Home Assistant's
 * sign-in: what the integration answers through the pass (`…/home`), read leniently; a connection
 * that answers DomoTwin's commands from it, as the demo house's answers from memory (D-050); and a
 * `hass` of the guest's, whose actions go through the pass (`…/call`) and whose states follow it
 * (`…/events`). Nothing else of Home Assistant is reachable from here: the integration checks each
 * request against the pass.
 */
import type {
  Bindings,
  PlanJson,
  Settings,
  StoreyInfo,
  StoredPlan,
  UpdateEvent,
} from "../ha/client";
import type {
  HassAreaEntry,
  HassConnection,
  HassEntity,
  HassEntityEntry,
  HassMessage,
  HomeAssistant,
} from "../ha/types";
import type { PeopleSettings } from "../live/people";
import { readWifi, type Wifi } from "../live/wifi";

/** A storey as the pass shows it. */
export interface GuestStorey {
  info: StoreyInfo;
  plan: PlanJson;
  layout: Record<string, unknown>;
}

/** What the pass says of itself. */
export interface GuestPassInfo {
  name: string;
  starts: string;
  ends: string;
  /** The guests may use the devices (else only look). */
  act: boolean;
  /** The devices it gives. */
  entities: string[];
}

/** The home as the pass shows it. */
export interface GuestSnapshot {
  pass: GuestPassInfo;
  /** Home Assistant's name of the home. */
  home: string;
  storeys: GuestStorey[];
  bindings: Bindings;
  settings: Settings;
  states: Record<string, HassEntity>;
  entities: Record<string, HassEntityEntry>;
  areas: Record<string, HassAreaEntry>;
  /** The home's Wi-Fi, with its password, when the pass shows it. */
  wifi: Wifi | null;
  timeZone?: string;
  temperatureUnit?: string;
}

/** Why the pass opens nothing now: the integration's code, and when it opens or ended. */
export interface GuestRefusal {
  code: string;
  starts?: string;
  ends?: string;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Reads what `…/home` answers; what cannot be read is left out. */
export function readSnapshot(raw: unknown): GuestSnapshot {
  const value = record(raw);
  const pass = record(value.pass);
  const storeys: GuestStorey[] = [];
  for (const each of Array.isArray(value.storeys) ? (value.storeys as unknown[]) : []) {
    const storey = record(each);
    const info = record(storey.info);
    if (typeof info.id !== "string" || typeof storey.plan !== "object" || !storey.plan) continue;
    storeys.push({
      info: {
        id: info.id,
        name: text(info.name),
        elevation: typeof info.elevation === "number" ? info.elevation : 0,
      },
      plan: storey.plan as PlanJson,
      layout: record(storey.layout),
    });
  }
  const bindings = record(value.bindings);
  const config = record(value.config);
  const states: Record<string, HassEntity> = {};
  for (const [id, state] of Object.entries(record(value.states))) {
    const entity = record(state);
    if (entity.entity_id === id && typeof entity.state === "string") {
      states[id] = entity as unknown as HassEntity;
    }
  }
  return {
    pass: {
      name: text(pass.name),
      starts: text(pass.starts),
      ends: text(pass.ends),
      act: pass.act !== false,
      entities: Array.isArray(pass.entities)
        ? pass.entities.filter((id): id is string => typeof id === "string")
        : [],
    },
    home: text(value.home),
    storeys,
    bindings: {
      version: 1,
      rooms: record(bindings.rooms) as Bindings["rooms"],
      elements: record(bindings.elements),
    },
    settings: record(value.settings),
    states,
    entities: record(value.entities) as Record<string, HassEntityEntry>,
    areas: record(value.areas) as Record<string, HassAreaEntry>,
    wifi: value.wifi ? readWifi({ ...record(value.wifi), set: true, shown: true }) : null,
    timeZone: typeof config.time_zone === "string" ? config.time_zone : undefined,
    temperatureUnit: text(record(config.unit_system).temperature) || undefined,
  };
}

/** Reads a refusal (`{"code", "starts"?, "ends"?}`); what cannot be read is `unknown`. */
export function readRefusal(raw: unknown): GuestRefusal {
  const value = record(raw);
  const refusal: GuestRefusal = { code: text(value.code) || "unknown" };
  if (typeof value.starts === "string") refusal.starts = value.starts;
  if (typeof value.ends === "string") refusal.ends = value.ends;
  return refusal;
}

/** A refusal, as Home Assistant's websocket gives one: a code, and words to show. */
export class PassError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/**
 * A request to the pass's own address, on this page's origin only: a guest's page has no Home
 * Assistant connection (D-067), and asks nothing of anywhere else.
 */
export function askPass(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) {
    return Promise.reject(new PassError("offline", "not this page's origin"));
  }
  // eslint-disable-next-line no-restricted-globals -- the pass's own address, this origin (D-067).
  return fetch(url, { cache: "no-store", credentials: "omit", ...init });
}

/** No one is placed: a guest sees nobody (D-034). */
const NOBODY: PeopleSettings = {
  revision: 0,
  shown: "admins",
  look: "figure",
  hidden: [],
  people: {},
};

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The guest's connection: DomoTwin's commands the card asks answered from the snapshot, never
 * written anywhere; the others refused. Told when the home is read again, as a save would tell it.
 */
export class GuestConnection implements HassConnection {
  private readonly listeners = new Set<(event: UpdateEvent) => void>();
  private revision = 1;

  constructor(private snapshot: GuestSnapshot) {}

  /** The home read again: every screen listening reads it anew. */
  replace(snapshot: GuestSnapshot): void {
    this.snapshot = snapshot;
    this.revision += 1;
    for (const kind of ["plan", "bindings", "settings", "wifi"] as const) {
      for (const listener of this.listeners) listener({ kind, revision: this.revision });
    }
  }

  sendMessagePromise<T>(message: HassMessage): Promise<T> {
    try {
      return Promise.resolve(this.answer(message) as T);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new PassError("unknown_command"));
    }
  }

  sendMessage(): void {
    // Nothing is sent from a guest's page.
  }

  // Mirrors home-assistant-js-websocket: the caller states the event type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  subscribeMessage<T>(
    callback: (message: T) => void,
    message: HassMessage,
  ): Promise<() => Promise<void>> {
    if (message.type !== "domotwin/subscribe") {
      return Promise.reject(new PassError("unknown_command"));
    }
    const listener = callback as unknown as (event: UpdateEvent) => void;
    this.listeners.add(listener);
    return Promise.resolve(() => {
      this.listeners.delete(listener);
      return Promise.resolve();
    });
  }

  private answer(message: HassMessage): unknown {
    const snapshot = this.snapshot;
    switch (message.type) {
      case "domotwin/info":
        return {
          revision: this.revision,
          has_plan: snapshot.storeys.length > 0,
          storeys: snapshot.storeys.length,
        };
      case "domotwin/plan/get":
        return this.plan(message.storey);
      case "domotwin/bindings/get":
        return { bindings: structuredClone(snapshot.bindings), revision: this.revision };
      case "domotwin/settings/get":
        return { settings: structuredClone(snapshot.settings), revision: this.revision };
      case "domotwin/upkeep/get": {
        const now = new Date();
        return {
          upkeep: { version: 1, lead_days: 14, pieces: {} },
          revision: this.revision,
          today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        };
      }
      case "domotwin/people/get":
        return structuredClone(NOBODY);
      case "domotwin/wifi/get": {
        const wifi = snapshot.wifi;
        if (!wifi) return { set: false, shown: false };
        const shown = { ...wifi };
        if (message.password !== true) delete shown.password;
        return shown;
      }
      default:
        throw new PassError("unknown_command");
    }
  }

  /** A storey's plan (the ground floor's by default: the nearest elevation 0). */
  private plan(storey: unknown): StoredPlan {
    const storeys = this.snapshot.storeys;
    const found =
      typeof storey === "string"
        ? storeys.find((s) => s.info.id === storey)
        : [...storeys].sort((a, b) => Math.abs(a.info.elevation) - Math.abs(b.info.elevation))[0];
    if (typeof storey === "string" && !found) throw new PassError("unknown_storey");
    return structuredClone({
      plan: found?.plan ?? null,
      layout: found?.layout ?? {},
      storey: found?.info.id ?? null,
      storeys: [...storeys].sort((a, b) => a.info.elevation - b.info.elevation).map((s) => s.info),
      revision: this.revision,
    });
  }
}

/** What a guest's action came to: done, or refused with words to show. */
export type Caller = (
  domain: string,
  service: string,
  data?: Record<string, unknown>,
  target?: Record<string, unknown>,
) => Promise<unknown>;

/** The 3D files the card asks Home Assistant for (`/api/domotwin/models/<file>`, D-021). */
const MODEL_FILE = /^\/api\/domotwin\/models\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;

/**
 * The guest's `hass`: the states, areas and registry entries the pass shows; nobody's user. Its
 * actions go to the pass (`call`); the 3D files of the pieces it shows are read through the pass
 * (`base`: the link's address), and nothing else of Home Assistant.
 */
export function guestHass(
  snapshot: GuestSnapshot,
  connection: GuestConnection,
  call: Caller,
  base: string,
  look: { language: string; dark: boolean },
): HomeAssistant {
  return {
    states: snapshot.states,
    entities: snapshot.entities,
    devices: {},
    areas: snapshot.areas,
    floors: {},
    user: { id: "guest", name: snapshot.pass.name, is_admin: false },
    language: look.language,
    locale: { language: look.language },
    themes: { darkMode: look.dark },
    config: {
      components: [],
      ...(snapshot.timeZone ? { time_zone: snapshot.timeZone } : {}),
      ...(snapshot.temperatureUnit
        ? { unit_system: { temperature: snapshot.temperatureUnit } }
        : {}),
    },
    panels: {},
    connection,
    guest: true,
    callService: call,
    fetchWithAuth: (path: string, init?: RequestInit): Promise<Response> => {
      const file = MODEL_FILE.exec(path)?.[1];
      if (!file || (init?.method ?? "GET") !== "GET") {
        return Promise.reject(new PassError("not_allowed"));
      }
      return askPass(`${base}/models/${file}`);
    },
  };
}
