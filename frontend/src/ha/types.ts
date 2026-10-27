/** The small part of Home Assistant's frontend API that DomoTwin uses. */

/** What a state was written in (`homeassistant.core.Context`): who asked for it, and what set it
 * off (the context of an automation's trigger, for an automation's run). */
export interface HassContext {
  id: string;
  parent_id?: string | null;
  user_id?: string | null;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context?: HassContext;
}

export interface HassUser {
  id: string;
  name: string;
  is_admin: boolean;
}

export interface HassMessage {
  type: string;
  [key: string]: unknown;
}

export interface HassConnection {
  sendMessagePromise<T>(message: HassMessage): Promise<T>;
  /** Sends a command whose answer is not awaited (one that never answers, too). */
  sendMessage(message: HassMessage): void;
  // Mirrors home-assistant-js-websocket: the caller states the event type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  subscribeMessage<T>(
    callback: (message: T) => void,
    message: HassMessage,
  ): Promise<() => Promise<void>>;
}

/** An entry of Home Assistant's entity registry, as the frontend gets it. */
export interface HassEntityEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
  hidden?: boolean;
  entity_category?: string | null;
  /** The labels given in Home Assistant (their ids). */
  labels?: string[];
  /** The integration it comes from, and what kind of its entities it is. */
  platform?: string;
  translation_key?: string | null;
  /** The decimals its numbers are shown with, when set in Home Assistant. */
  display_precision?: number;
}

/** An entry of the device registry. */
export interface HassDeviceEntry {
  id: string;
  area_id?: string | null;
  name?: string | null;
  /** The name given in Home Assistant, before the device's own. */
  name_by_user?: string | null;
}

/** An entry of the area registry. */
export interface HassAreaEntry {
  area_id: string;
  name: string;
  floor_id?: string | null;
  /** Its icon (`mdi:sofa`), when one was chosen. */
  icon?: string | null;
}

/** An entry of the floor registry. */
export interface HassFloorEntry {
  floor_id: string;
  name: string;
  /** Its level (0 the ground floor), which orders the floors. */
  level?: number | null;
  icon?: string | null;
}

/** What Home Assistant's frontend keeps of a user's choices (`core`), since after 2025.1. */
export interface FrontendCoreData {
  /** The dashboard or panel opened first (its URL path). */
  default_panel?: string;
  [key: string]: unknown;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  entities?: Record<string, HassEntityEntry | undefined>;
  devices?: Record<string, HassDeviceEntry | undefined>;
  areas?: Record<string, HassAreaEntry | undefined>;
  floors?: Record<string, HassFloorEntry | undefined>;
  user?: HassUser;
  language: string;
  locale?: { language: string };
  themes?: { darkMode?: boolean };
  /** Home Assistant's sidebar: docked (`docked`), always hidden (`always_hidden`) or `auto`. */
  dockedSidebar?: string;
  /** Home Assistant's configuration: the units of climate entities, the integrations loaded. */
  config?: {
    unit_system?: { temperature?: string };
    components?: string[];
    /** Home Assistant's time zone (an IANA name). */
    time_zone?: string;
    /** Where the home is: for the sun of the sandbox's day (D-057). */
    latitude?: number;
    longitude?: number;
    /** Home Assistant's version (`2026.2.0`): what its frontend has (D-061). */
    version?: string;
  };
  /** The panels Home Assistant has, by URL path: its Overview's is `home` (D-061). */
  panels?: Record<string, { url_path?: string } | undefined>;
  connection: HassConnection;
  /**
   * The demo house's own (D-050): nothing hands over to Home Assistant's pages or dialogs, which
   * would show the home's entities, not the demo's.
   */
  demo?: boolean;
  /** The sandbox's copy of the home (D-057): a home kept in the page as the demo house is. */
  sandbox?: boolean;
  /**
   * A guest's, through a guest pass (D-067): DomoTwin's own page outside Home Assistant's sign-in,
   * which reads and acts through the pass only; nothing hands over to Home Assistant's pages,
   * dialogs or history.
   */
  guest?: boolean;
  /** The time it is for this Home Assistant (ms): the demo house's own clock (D-050). */
  now?(): number;
  /** The page Home Assistant opens first on this device (2025.1: its `hass-default-panel`). */
  defaultPanel?: string;
  /** The user's own choices in Home Assistant's frontend, and everyone's (after 2025.1). */
  userData?: FrontendCoreData | null;
  systemData?: FrontendCoreData | null;
  /** A request to Home Assistant with the user's session (the frontend's `fetchWithAuth`). */
  fetchWithAuth?(path: string, init?: RequestInit): Promise<Response>;
  /**
   * A request to Home Assistant's REST API with the user's session (`/api/<path>`): what its
   * configuration editors use. Its refusal is `{ error, status_code, body }`.
   */
  callApi?<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    parameters?: Record<string, unknown>,
  ): Promise<T>;
  /** A state as Home Assistant shows it, in the user's language with its unit (2025.1 and since). */
  formatEntityState?(entity: HassEntity, state?: string): string;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** The time it is for `hass` (ms): this device's, or the demo house's own (D-050). */
export function nowOf(hass: HomeAssistant | undefined): number {
  return hass?.now?.() ?? Date.now();
}

/** An error returned by the websocket API: `{ code, message }`. */
export interface HassError {
  code: string;
  message: string;
}

export function isHassError(value: unknown): value is HassError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/** Home Assistant's own rule for an entity id (`homeassistant.core.valid_entity_id`). */
const ENTITY_ID = /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/;

/** The domain of an entity id (`light` of `light.kitchen`). */
export function domainOf(id: string): string {
  return id.slice(0, id.indexOf("."));
}

/** Whether `id` is an entity id Home Assistant (and the integration) takes. */
export function isEntityId(id: string): boolean {
  return ENTITY_ID.test(id);
}
