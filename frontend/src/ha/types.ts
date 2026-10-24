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
}

/** An entry of the device registry. */
export interface HassDeviceEntry {
  id: string;
  area_id?: string | null;
  name?: string | null;
}

/** An entry of the area registry. */
export interface HassAreaEntry {
  area_id: string;
  name: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  entities?: Record<string, HassEntityEntry | undefined>;
  devices?: Record<string, HassDeviceEntry | undefined>;
  areas?: Record<string, HassAreaEntry | undefined>;
  user?: HassUser;
  language: string;
  locale?: { language: string };
  themes?: { darkMode?: boolean };
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
