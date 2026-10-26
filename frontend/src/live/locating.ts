/**
 * DomoTwin's own Bluetooth locating (`docs/DECISIONS.md`, D-035): the receivers, the devices
 * followed (a phone, a watch, a tag) and the room each is in. The settings come from
 * `domotwin/locating/get` (administrators); the views read the devices' room sensors
 * (`sensor.domotwin_<device>_bluetooth`), which everyone has.
 */
import type { HomeAssistant } from "../ha/types";
import { unaccented } from "./text";

export type LocatedKind = "phone" | "watch" | "thing";

/** How a followed device is known: a fixed address (a tag), a Private BLE Device entry's key (by
 * the entry; its title shown, never the key), or the iBeacon it sends. */
export type LocatedMatch =
  | { address: string }
  | { key: string; title?: string | null }
  | { beacon: { uuid: string; major: number; minor: number } };

/** A followed device as the settings keep it. */
export interface LocatedSettings {
  name: string;
  kind: LocatedKind;
  person?: string;
  match: LocatedMatch;
}

/** A followed device as `locating/get` gives it: where it is now, too. */
export interface LocatedDevice extends LocatedSettings {
  sensor: string;
  room: string | null;
  confidence: number;
  last_seen: string | null;
  left_behind: boolean;
  /** Known by a key whose Private BLE Device entry is gone. */
  missing_key: boolean;
}

/** A receiver: Home Assistant's adapter, an ESPHome proxy, a Shelly device. */
export interface ReceiverInfo {
  source: string;
  /** Its name, when Home Assistant has it now (else it is only placed). */
  name: string | null;
  /** Seconds since it last heard anything. */
  idle: number | null;
  room?: string;
  piece?: string;
  /** What placed it: by hand (`room`, `piece`), from its device (`device_area`, `device_piece`),
   * or nothing. */
  placed_by: "room" | "piece" | "device_area" | "device_piece" | null;
  /** Where it stands (D-059): its storey, its point (cm) and its height (cm, from the lowest
   * floor); none when nothing places it. */
  place?: { storey: string; at: [number, number]; z: number } | null;
}

/** The locating's settings and state, as `domotwin/locating/get` gives them. */
export interface LocatingSettings {
  revision: number;
  status: "no_bluetooth" | "no_receivers" | "ready";
  learn: boolean;
  receivers: ReceiverInfo[];
  devices: Record<string, LocatedDevice>;
  /** How much was learned in each room (readings). */
  learned: Record<string, number>;
  /** What each receiver learned in each room (D-059): the mean signal, a phone's as the model
   * has it, and of how many readings. */
  heard?: Record<string, Record<string, { signal: number; readings: number }>>;
  rooms: { id: string; name: string; storey: string }[];
}

/** A device that may be followed, heard now or known to Home Assistant. */
export interface LocatedCandidate {
  match: LocatedMatch;
  name: string;
  rssi?: number;
}

/** A device's id from its name: lowercase letters, digits and `_`, not one of `taken`. */
export function deviceId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    unaccented(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "device";
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}_${String(n)}`;
  return id;
}

/** The same device known the same way. */
export function sameMatch(a: LocatedMatch, b: LocatedMatch): boolean {
  if ("address" in a && "address" in b) return a.address.toUpperCase() === b.address.toUpperCase();
  if ("key" in a && "key" in b) return a.key === b.key;
  if ("beacon" in a && "beacon" in b) {
    return (
      a.beacon.uuid.toLowerCase() === b.beacon.uuid.toLowerCase() &&
      a.beacon.major === b.beacon.major &&
      a.beacon.minor === b.beacon.minor
    );
  }
  return false;
}

/** What a followed device is saved as (without what `get` adds). */
export function settingsOf(device: LocatedSettings): LocatedSettings {
  const match: LocatedMatch = "key" in device.match ? { key: device.match.key } : device.match;
  const saved: LocatedSettings = { name: device.name, kind: device.kind, match };
  if (device.person) saved.person = device.person;
  return saved;
}

/** The kind a device is first given: a key or a beacon is a phone's, an address a tag's. */
export function kindOf(match: LocatedMatch): LocatedKind {
  return "address" in match ? "thing" : "phone";
}

/** A followed device as the views show it, from its room sensor. */
export interface LocatedShown {
  sensor: string;
  name: string;
  kind: LocatedKind;
  person?: string;
  /** Its room in the plans and that room's name; undefined when not heard. */
  room?: string;
  roomName?: string;
  leftBehind: boolean;
  /** Heard in a private room the user viewing may not see (D-039): which one is not told. */
  private?: true;
}

const KINDS: readonly LocatedKind[] = ["phone", "watch", "thing"];

/** The room sensors of the devices DomoTwin follows by Bluetooth (its sensors of the `located`
 * kind), from Home Assistant's registry. */
export function locatedSensors(hass: HomeAssistant): string[] {
  return Object.values(hass.entities ?? {}).flatMap((entry) =>
    entry?.platform === "domotwin" && entry.translation_key === "located" ? [entry.entity_id] : [],
  );
}

/**
 * The devices DomoTwin follows by Bluetooth, from their room sensors (`sensors`, else looked up).
 * Those of a person not to be told about here (`told` false: hidden, or the people shown to
 * administrators only) are left out.
 */
export function locatedShown(
  hass: HomeAssistant,
  told: (person: string) => boolean,
  sensors: string[] = locatedSensors(hass),
): LocatedShown[] {
  const found: LocatedShown[] = [];
  for (const sensor of sensors) {
    const state = hass.states[sensor];
    if (!state) continue;
    const a = state.attributes;
    const kind = KINDS.find((k) => k === a.kind) ?? "thing";
    const person = typeof a.person === "string" ? a.person : undefined;
    if (person && !told(person)) continue;
    const name = typeof a.device_name === "string" ? a.device_name : sensor;
    const shown: LocatedShown = {
      sensor,
      name,
      kind,
      leftBehind: a.left_behind === true,
    };
    if (person) shown.person = person;
    if (typeof a.room_id === "string") {
      shown.room = a.room_id;
      shown.roomName = state.state;
    }
    found.push(shown);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
