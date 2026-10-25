/** The small part of Home Assistant's frontend API that DomoTwin uses. */

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
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
}

/** An entry of the floor registry. */
export interface HassFloorEntry {
  floor_id: string;
  name: string;
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
  /** Home Assistant's configuration: the units of climate entities, the integrations loaded. */
  config?: {
    unit_system?: { temperature?: string };
    components?: string[];
    /** Home Assistant's time zone (an IANA name). */
    time_zone?: string;
  };
  connection: HassConnection;
  /** A request to Home Assistant with the user's session (the frontend's `fetchWithAuth`). */
  fetchWithAuth?(path: string, init?: RequestInit): Promise<Response>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
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
