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

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  user?: HassUser;
  language: string;
  locale?: { language: string };
  themes?: { darkMode?: boolean };
  connection: HassConnection;
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
