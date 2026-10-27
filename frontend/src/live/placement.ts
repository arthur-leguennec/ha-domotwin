/**
 * The placement advisor's data (`docs/DECISIONS.md`, D-064): for one radio, the home's storeys,
 * the radios placed on them and what was measured, handed to the analysis module, which answers
 * how well each room is covered and where the next radio helps most
 * (`domotwin_core::coverage`). Loaded with the radio coverage, not before.
 */
import type { HomeStorey } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import { roomArea, type BindingsJson } from "./bindings";
import type { LocatingSettings } from "./locating";
import { pieceIndex, type NetworkAnalysis, type NetworkDevice } from "./network";
import { planElements } from "./plan";

export type RadioKind = "bluetooth" | "zigbee" | "wifi";
export const RADIO_KINDS: readonly RadioKind[] = ["bluetooth", "zigbee", "wifi"];

/** How well a room is covered, as the advice says it. */
export type CoverageLevel = "good" | "fair" | "weak" | "out";

/** Each level's rank, as the engine's coverage scale reads it (`HeatKind::Coverage`). */
export const LEVEL_RANK: Record<CoverageLevel, number> = { out: 0, weak: 1, fair: 2, good: 3 };

/** A Wi-Fi access point placed on the plan, in the home's settings. */
export interface AccessPoint {
  storey: string;
  /** Its point on its storey's plan (cm). */
  at: [number, number];
  name?: string;
}

/** Most access points kept (the integration refuses more). */
export const MAX_ACCESS_POINTS = 16;

/** What a room's coverage says. */
export interface RoomCoverage {
  id: string;
  storey: string;
  /** What was measured, else what is predicted. */
  level: CoverageLevel;
  /** What the model predicts (dBm), moved by what was measured; none without a radio. */
  predicted?: number;
  measured?: { level: CoverageLevel; signal?: number; name?: string };
}

/** A spot advised for the next radio. */
export interface AdvisedSpot {
  storey: string;
  at: [number, number];
  room: string;
  /** The piece it stands by. */
  near?: string;
  /** What the radios already there give it (dBm). */
  reach?: number;
  changes: { room: string; from: CoverageLevel; to: CoverageLevel }[];
}

/** The advice for one radio (`domotwin_core::coverage::Advice`). */
export interface PlacementAdvice {
  rooms: RoomCoverage[];
  radios: { id: string; storey: string; at: [number, number]; room?: string }[];
  spots: AdvisedSpot[];
  /** How far off the model is where signals were measured, and what moved it (dB). */
  check?: { measurements: number; offset: number; error: number };
  /** In how many rooms both measured and predicted the two agree (Zigbee). */
  agreement?: { rooms: number; same: number };
}

/**
 * A radio as the advice reads it: at a piece, or at a point of a storey (and a height, cm); its
 * name is the sheet's.
 */
export type RadioPlace = { id: string; name?: string } & (
  { piece: string } | { storey: string; at: [number, number]; z?: number }
);

/** A measurement as the advice reads it: in a room or at a piece, a signal (dBm) or a level. */
export interface Measurement {
  room?: string;
  piece?: string;
  signal?: number;
  level?: CoverageLevel;
  /** The radio that measured it (a receiver's room learned). */
  radio?: string;
  /** How many readings it is made of (fewer than eight: not counted). */
  readings?: number;
  /** What measured it, as the sheet says it. */
  name?: string;
}

/** What one radio's advice is worked out from. */
export interface RadioReadings {
  radios: RadioPlace[];
  measured: Measurement[];
  /** The radios that could not be placed, by name. */
  unplaced: string[];
}

/** What the analysis module reads (`advisePlacement`). */
export function placementInput(
  radio: RadioKind,
  storeys: readonly HomeStorey[],
  readings: RadioReadings,
  spots = 3,
): string {
  return JSON.stringify({
    radio,
    storeys: storeys.map(({ id, elevation, plan, layout }) => ({ id, elevation, plan, layout })),
    radios: readings.radios,
    measured: readings.measured,
    spots,
  });
}

/**
 * The Bluetooth receivers where the locating places them, and what each learned in each room
 * (D-035): a receiver Home Assistant does not have now, nor place, is not counted.
 */
export function bluetoothReadings(locating: LocatingSettings): RadioReadings {
  const names = new Map(locating.receivers.map((r) => [r.source, r.name ?? r.source]));
  const radios: RadioPlace[] = [];
  const unplaced: string[] = [];
  for (const receiver of locating.receivers) {
    const place = receiver.place;
    if (place)
      radios.push({ id: receiver.source, name: receiver.name ?? receiver.source, ...place });
    else if (receiver.name !== null) unplaced.push(receiver.name);
  }
  const measured: Measurement[] = [];
  for (const [room, sources] of Object.entries(locating.heard ?? {})) {
    for (const [source, heard] of Object.entries(sources)) {
      measured.push({
        room,
        radio: source,
        signal: heard.signal,
        readings: heard.readings,
        name: names.get(source) ?? source,
      });
    }
  }
  return { radios, measured, unplaced };
}

/**
 * The Zigbee coordinator and routers at their pieces (D-031), and how well each end device placed
 * is linked: its best link of known quality to the coordinator or a router, as the network map
 * reads it. A relay covers its own room, whatever its links to the others (the network map's); a
 * device not heard from for a day relays for no one and measures nothing.
 */
export function zigbeeReadings(
  devices: readonly NetworkDevice[],
  placed: ReadonlyMap<string, string>,
  analysis: NetworkAnalysis,
): RadioReadings {
  const info = new Map(analysis.devices.map((d) => [d.id, d]));
  const relays = (id: string): boolean => {
    const d = info.get(id);
    return d !== undefined && !d.stale && (d.role === "coordinator" || d.role === "router");
  };
  const radios: RadioPlace[] = [];
  const unplaced: string[] = [];
  const measured: Measurement[] = [];
  const rank = { good: 3, fair: 2, weak: 1 } as const;
  for (const device of devices) {
    const piece = placed.get(device.id);
    if (relays(device.id)) {
      if (piece) radios.push({ id: device.id, name: device.name, piece });
      else unplaced.push(device.name);
    }
    if (!piece || info.get(device.id)?.stale !== false || relays(device.id)) continue;
    let best: keyof typeof rank | undefined;
    for (const link of analysis.links) {
      const other = link.a === device.id ? link.b : link.b === device.id ? link.a : undefined;
      if (other === undefined || other === device.id || !relays(other)) continue;
      if (link.quality === "unknown") continue;
      if (!best || rank[link.quality] > rank[best]) best = link.quality;
    }
    if (best) measured.push({ piece, level: best, name: device.name });
  }
  return { radios, measured, unplaced };
}

/** Integrations whose `signal_strength` sensors in dBm are a Wi-Fi signal, whatever their name. */
const WIFI_PLATFORMS = new Set(["shelly", "tasmota"]);
/** Integrations whose are not: another radio's, or a phone's (it moves). */
const NOT_WIFI = new Set([
  "zha",
  "zwave_js",
  "bluetooth",
  "bthome",
  "xiaomi_ble",
  "ibeacon",
  "private_ble_device",
  "bermuda",
  "mobile_app",
  "matter",
  "thread",
  "unifi",
]);
const WIFI_NAME = /wi-?fi|wlan/i;

/**
 * Whether an entity is a device's Wi-Fi signal: a sensor of the `signal_strength` class in dBm,
 * of a Wi-Fi integration (Shelly, Tasmota), or named after Wi-Fi (ESPHome's `wifi_signal`,
 * WLED's); never one of ZHA's, Z-Wave's, Bluetooth's or a phone's.
 */
export function wifiSignal(hass: HomeAssistant, entityId: string): boolean {
  if (!entityId.startsWith("sensor.")) return false;
  const state = hass.states[entityId];
  if (!state) return false;
  const { device_class: deviceClass, unit_of_measurement: unit } = state.attributes;
  if (deviceClass !== "signal_strength" || unit !== "dBm") return false;
  const platform = hass.entities?.[entityId]?.platform;
  if (platform !== undefined && NOT_WIFI.has(platform)) return false;
  if (platform !== undefined && WIFI_PLATFORMS.has(platform)) return true;
  const name = state.attributes.friendly_name;
  return WIFI_NAME.test(entityId) || (typeof name === "string" && WIFI_NAME.test(name));
}

/** The ids of every piece of the storeys: their plans' and those their overlays add. */
export function pieceIds(storeys: readonly HomeStorey[]): Set<string> {
  const ids = new Set<string>();
  for (const storey of storeys) {
    for (const element of planElements(storey.plan)) {
      if (element.type === "furniture") ids.add(element.id);
    }
    for (const [id, entry] of Object.entries(storey.layout ?? {})) {
      if (entry && typeof entry === "object" && "add" in entry) ids.add(id);
    }
  }
  return ids;
}

/**
 * The Wi-Fi access points placed on the plan, and the Wi-Fi signals of the devices placed in the
 * home: at the piece linked to the sensor, to its device or to another of its device's entities,
 * else in the room of its area (when one room has it).
 */
export function wifiReadings(
  hass: HomeAssistant,
  bindings: BindingsJson,
  storeys: readonly HomeStorey[],
  accessPoints: readonly AccessPoint[],
): RadioReadings {
  const radios: RadioPlace[] = accessPoints.map((ap, k) => ({
    id: `ap-${k + 1}`,
    ...(ap.name ? { name: ap.name } : {}),
    storey: ap.storey,
    at: ap.at,
  }));
  const pieces = pieceIds(storeys);
  const { byDevice, byEntity } = pieceIndex(bindings, (id) => pieces.has(id));
  const entitiesOf = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry?.device_id) continue;
    entitiesOf.set(entry.device_id, [...(entitiesOf.get(entry.device_id) ?? []), entry.entity_id]);
  }
  const roomsOfArea = new Map<string, string[]>();
  for (const storey of storeys) {
    for (const element of planElements(storey.plan)) {
      if (element.type !== "room") continue;
      const name = typeof element.fields.name === "string" ? element.fields.name : element.id;
      const area = roomArea(hass, bindings, element.id, name);
      if (area) roomsOfArea.set(area, [...(roomsOfArea.get(area) ?? []), element.id]);
    }
  }
  const measured: Measurement[] = [];
  for (const id of Object.keys(hass.states).sort()) {
    if (!wifiSignal(hass, id)) continue;
    const state = hass.states[id];
    // To a decibel: what changes less does not work the advice out again.
    const signal = Math.round(Number(state?.state));
    if (!state || state.state.trim() === "" || !Number.isFinite(signal) || signal > 0) continue;
    const entry = hass.entities?.[id];
    const device = entry?.device_id ?? undefined;
    const piece =
      byEntity.get(id) ??
      (device ? byDevice.get(device) : undefined) ??
      (device
        ? entitiesOf
            .get(device)
            ?.map((e) => byEntity.get(e))
            .find(Boolean)
        : undefined);
    const name =
      typeof state.attributes.friendly_name === "string" ? state.attributes.friendly_name : id;
    if (piece) {
      measured.push({ piece, signal, name });
      continue;
    }
    const area = entry?.area_id ?? (device ? hass.devices?.[device]?.area_id : undefined);
    const rooms = area ? roomsOfArea.get(area) : undefined;
    if (rooms?.length === 1) measured.push({ room: rooms[0], signal, name });
  }
  return { radios, measured, unplaced: [] };
}

/** The names of the rooms and pieces of every storey, by id (a piece added by an overlay too). */
export function homeNames(storeys: readonly HomeStorey[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const storey of storeys) {
    for (const { id, fields } of planElements(storey.plan)) {
      names.set(id, typeof fields.name === "string" && fields.name ? fields.name : id);
    }
    for (const [id, entry] of Object.entries(storey.layout ?? {})) {
      const added = (entry as { add?: { name?: unknown } } | null)?.add;
      if (added) names.set(id, typeof added.name === "string" && added.name ? added.name : id);
    }
  }
  return names;
}

/** The rooms worst covered first, then as the plans have them. */
export function worstFirst(rooms: readonly RoomCoverage[]): RoomCoverage[] {
  return rooms
    .map((room, k) => ({ room, k }))
    .sort((a, b) => LEVEL_RANK[a.room.level] - LEVEL_RANK[b.room.level] || a.k - b.k)
    .map(({ room }) => room);
}

/** What the engine's coverage scale draws for the rooms (`HeatKind::Coverage`), by room id. */
export function coverageValues(advice: PlacementAdvice): Record<string, number> {
  return Object.fromEntries(advice.rooms.map((room) => [room.id, LEVEL_RANK[room.level]]));
}
