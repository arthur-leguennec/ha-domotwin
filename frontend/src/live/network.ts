/**
 * The network map's data (`DECISIONS.md`, D-031): the devices of the home's radio mesh, from a
 * source behind a small interface (ZHA only for now; Zigbee2MQTT or Thread can come later), placed
 * at the pieces their entities or their Home Assistant device are linked to, and handed to the
 * analysis module as a snapshot (`domotwin_core::network`, D-043). Loaded with the network map,
 * not before.
 */
import type { HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";

/** What a device is in the mesh. */
export type NetworkRole = "coordinator" | "router" | "end" | "unknown";

/** A device as every source describes it. */
export interface NetworkDevice {
  /** Its address in the mesh (an IEEE address for Zigbee). */
  id: string;
  name: string;
  role: NetworkRole;
  /** Quality (0–255) and strength (dBm) of the last message heard from it. */
  lqi?: number;
  rssi?: number;
  /** How long ago it was last heard from (seconds). */
  seen?: number;
  available: boolean;
  /** Its Home Assistant device and entities. */
  deviceId?: string;
  entities: string[];
  manufacturer?: string;
  model?: string;
  neighbours: { id: string; lqi?: number; relation: string }[];
}

/** Where the devices of a mesh come from. */
export interface NetworkSource {
  readonly kind: "zha";
  /** The devices, with their neighbour tables. */
  devices(): Promise<NetworkDevice[]>;
  /** Asks for a new scan of the neighbour tables: it takes minutes and answers nothing. */
  rescan(): void;
}

/** What the analysis module works out (`NetworkAnalysis.report`, D-043). */
export interface NetworkAnalysis {
  devices: {
    id: string;
    role: NetworkRole;
    quality: Quality;
    stale: boolean;
    hops?: number;
    bottleneck?: number;
    via?: string;
    room?: string;
  }[];
  links: { a: string; b: string; lqi: number | null; quality: Quality }[];
  coordinator: string | null;
  health: { weakLinks: number; stale: string[]; weakRooms: { room: string; links: number }[] };
}

export type Quality = "good" | "fair" | "weak" | "unknown";

const ROLES: Record<string, NetworkRole> = {
  Coordinator: "coordinator",
  Router: "router",
  EndDevice: "end",
};

const RELATIONS: Record<string, string> = {
  Parent: "parent",
  Child: "child",
  Sibling: "sibling",
  PreviousChild: "previous",
};

/** A number from ZHA, which gives some as decimal strings (a neighbour's LQI). */
function numberOf(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The instant (ms) of a wall-clock time written without its zone (`YYYY-MM-DDTHH:MM:SS`) in the
 * time zone `zone` (an IANA name); in the browser's own without one, or with one it does not
 * know.
 */
export function zonedTime(text: string, zone: string | undefined): number {
  const local = Date.parse(text);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!zone || !parts || !Number.isFinite(local)) return local;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return local;
  }
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // How far the zone's clock is ahead of UTC at an instant.
  const offset = (at: number): number => {
    const read: Record<string, number> = {};
    for (const part of format.formatToParts(at)) read[part.type] = Number(part.value);
    const shown = Date.UTC(
      read.year ?? 0,
      (read.month ?? 1) - 1,
      read.day ?? 1,
      read.hour ?? 0,
      read.minute ?? 0,
      read.second ?? 0,
    );
    return shown - at;
  };
  // Twice: the second time with the offset at the instant itself (near a change of offset).
  const first = wall - offset(wall);
  return wall - offset(first);
}

/**
 * How long ago (seconds) a ZHA `last_seen` was, at `now` (ms). ZHA gives the server's local time
 * without its zone: it is read in Home Assistant's time zone (`zone`), else the browser's.
 */
export function secondsSince(lastSeen: unknown, now: number, zone?: string): number | undefined {
  const text = textOf(lastSeen);
  if (!text) return undefined;
  const at = zonedTime(text, zone);
  return Number.isFinite(at) ? Math.max(0, (now - at) / 1000) : undefined;
}

/**
 * A device of ZHA's `zha/devices` answer, as the map takes it; `undefined` without an address.
 * `zone`: Home Assistant's time zone, which its times are written in.
 */
export function zhaDevice(raw: unknown, now: number, zone?: string): NetworkDevice | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const d = raw as Record<string, unknown>;
  const id = textOf(d.ieee)?.toLowerCase();
  if (!id) return undefined;
  const entities = Array.isArray(d.entities)
    ? d.entities.flatMap((e) => {
        const entityId = textOf((e as { entity_id?: unknown } | null)?.entity_id);
        return entityId ? [entityId] : [];
      })
    : [];
  const neighbours = Array.isArray(d.neighbors)
    ? d.neighbors.flatMap((n) => {
        const entry = (n ?? {}) as Record<string, unknown>;
        const other = textOf(entry.ieee)?.toLowerCase();
        if (!other) return [];
        const lqi = numberOf(entry.lqi);
        const relation = RELATIONS[String(entry.relationship)] ?? "other";
        return [lqi === undefined ? { id: other, relation } : { id: other, lqi, relation }];
      })
    : [];
  const device: NetworkDevice = {
    id,
    name: textOf(d.user_given_name) ?? textOf(d.name) ?? id,
    role: ROLES[String(d.device_type)] ?? "unknown",
    available: d.available !== false,
    entities,
    neighbours,
  };
  const optional: [keyof NetworkDevice, unknown][] = [
    ["lqi", numberOf(d.lqi)],
    ["rssi", numberOf(d.rssi)],
    ["seen", secondsSince(d.last_seen, now, zone)],
    ["deviceId", textOf(d.device_reg_id)],
    ["manufacturer", textOf(d.manufacturer)],
    ["model", textOf(d.model)],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined) (device as unknown as Record<string, unknown>)[key] = value;
  }
  return device;
}

/** ZHA as a source: administrators only, as Home Assistant's ZHA commands are. */
export function zhaSource(hass: HomeAssistant, now: () => number = Date.now): NetworkSource {
  return {
    kind: "zha",
    async devices() {
      const list = await hass.connection.sendMessagePromise<unknown>({ type: "zha/devices" });
      const time = now();
      const zone = hass.config?.time_zone;
      return Array.isArray(list)
        ? list.flatMap((raw) => {
            const device = zhaDevice(raw, time, zone);
            return device ? [device] : [];
          })
        : [];
    },
    rescan() {
      // ZHA never answers this command (it starts the scan; the devices are read again later):
      // nothing waits for an answer, so nothing is left pending on the connection.
      hass.connection.sendMessage({ type: "zha/topology/update" });
    },
  };
}

/**
 * The piece linked to each Home Assistant device and to each entity (the first one), among the
 * elements `known`: what places a device (D-031) or a sensor (D-057).
 */
export function pieceIndex(
  bindings: BindingsJson,
  known: (element: string) => boolean,
): { byDevice: Map<string, string>; byEntity: Map<string, string> } {
  const byDevice = new Map<string, string>();
  const byEntity = new Map<string, string>();
  for (const [element, binding] of Object.entries(bindings.elements)) {
    if (!known(element)) continue;
    if (binding.device && !byDevice.has(binding.device)) byDevice.set(binding.device, element);
    for (const entity of binding.entities) {
      if (!byEntity.has(entity.entity_id)) byEntity.set(entity.entity_id, element);
    }
  }
  return { byDevice, byEntity };
}

/**
 * The piece each device is placed at: the element linked to its Home Assistant device, else the
 * first element one of its entities is linked to. Elements the plan shown does not have (`known`)
 * are left out.
 */
export function placeDevices(
  devices: readonly NetworkDevice[],
  bindings: BindingsJson,
  known: (element: string) => boolean,
): Map<string, string> {
  const { byDevice, byEntity } = pieceIndex(bindings, known);
  const placed = new Map<string, string>();
  for (const device of devices) {
    const element =
      (device.deviceId ? byDevice.get(device.deviceId) : undefined) ??
      device.entities.map((e) => byEntity.get(e)).find((e) => e !== undefined);
    if (element) placed.set(device.id, element);
  }
  return placed;
}

/** The snapshot the analysis module reads (`NetworkAnalysis`, D-043). */
export function snapshot(
  devices: readonly NetworkDevice[],
  placed: ReadonlyMap<string, string>,
): string {
  return JSON.stringify({
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
      lqi: d.lqi,
      rssi: d.rssi,
      seen: d.seen,
      available: d.available,
      element: placed.get(d.id),
      neighbours: d.neighbours,
    })),
  });
}

/** A device's neighbours, best link first: the links of the analysis it is an end of. */
export function neighboursOf(
  analysis: NetworkAnalysis,
  id: string,
): { id: string; lqi: number | null; quality: Quality }[] {
  return analysis.links
    .filter((l) => l.a === id || l.b === id)
    .map((l) => ({ id: l.a === id ? l.b : l.a, lqi: l.lqi, quality: l.quality }))
    .sort((x, y) => (y.lqi ?? -1) - (x.lqi ?? -1));
}
