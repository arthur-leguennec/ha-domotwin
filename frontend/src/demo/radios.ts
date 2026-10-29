/**
 * The demo house's radios (D-050, D-093): its Wi-Fi access points, its Zigbee mesh and its
 * Bluetooth receivers, placed on its plan, so that each radio's coverage (D-066) and the Zigbee
 * network map (D-031) have something to show. As made up as the rest of the house: fictional
 * addresses, the house's own lamps and sensors.
 */
import type { LocatingSettings } from "../live/locating";
import type { AccessPoint } from "../live/placement";
import { AREAS, STOREYS, THINGS, say, type Words } from "./house";

/** The Zigbee coordinator's device, linked to the internet box it stands beside. */
export const COORDINATOR_DEVICE = "demo-zigbee-coordinator";
/** The piece of the plan the internet box is. */
export const INTERNET_BOX = "internet-box";

/** The Wi-Fi: the internet box in the hall, an access point on the landing's ceiling. */
const ACCESS_POINTS: readonly { storey: string; at: [number, number]; name: Words }[] = [
  { storey: "ground", at: [627.5, 700], name: ["Internet box", "Box internet"] },
  { storey: "upper", at: [520, 560], name: ["Wi-Fi access point", "Borne Wi-Fi"] },
];

/** The Wi-Fi access points, as the settings keep them. */
export function demoAccessPoints(language: string): AccessPoint[] {
  return ACCESS_POINTS.map((point) => ({
    storey: point.storey,
    at: [...point.at],
    name: say(point.name, language),
  }));
}

/** Devices that say how well they hear the Wi-Fi (dBm), in their areas. */
export const WIFI_SIGNALS: readonly { id: string; area: string; names: Words; state: string }[] = [
  {
    id: "sensor.tv_wifi_signal",
    area: "living_room",
    names: ["TV Wi-Fi signal", "Signal Wi-Fi de la télé"],
    state: "-54",
  },
  {
    id: "sensor.printer_wifi_signal",
    area: "office",
    names: ["Printer Wi-Fi signal", "Signal Wi-Fi de l’imprimante"],
    state: "-63",
  },
  {
    id: "sensor.playroom_tv_wifi_signal",
    area: "playroom",
    names: ["Playroom TV Wi-Fi signal", "Signal Wi-Fi de la télé de la salle de jeux"],
    state: "-71",
  },
];

type Role = "Coordinator" | "Router" | "EndDevice";

/**
 * The Zigbee mesh: each device, the entity of the house it is (the coordinator has none), and
 * whom it hears, how well (LQI, 0–255) and as what. The guest room's window sensor hears the
 * children's night light badly through the landing: a room a router would help.
 */
const MESH: readonly {
  n: number;
  role: Role;
  thing?: string;
  names?: Words;
  hears: readonly [n: number, lqi: number, relationship: "Parent" | "Child" | "Sibling"][];
  lqi?: number;
  /** Seconds since it was last heard. */
  seen: number;
}[] = [
  {
    n: 1,
    role: "Coordinator",
    names: ["Zigbee coordinator", "Coordinateur Zigbee"],
    hears: [
      [2, 205, "Child"],
      [3, 190, "Child"],
      [4, 200, "Child"],
      [7, 220, "Child"],
    ],
    seen: 5,
  },
  {
    n: 2,
    role: "Router",
    thing: "light.living_floor_lamp",
    hears: [
      [1, 200, "Parent"],
      [3, 150, "Sibling"],
      [8, 160, "Child"],
    ],
    lqi: 200,
    seen: 30,
  },
  {
    n: 3,
    role: "Router",
    thing: "light.kitchen_spots",
    hears: [
      [1, 185, "Parent"],
      [2, 145, "Sibling"],
      [5, 120, "Sibling"],
    ],
    lqi: 185,
    seen: 45,
  },
  {
    n: 4,
    role: "Router",
    thing: "light.laundry",
    hears: [[1, 195, "Parent"]],
    lqi: 195,
    seen: 60,
  },
  {
    n: 5,
    role: "Router",
    thing: "light.bedside_left",
    hears: [
      [3, 115, "Parent"],
      [6, 170, "Sibling"],
    ],
    lqi: 115,
    seen: 50,
  },
  {
    n: 6,
    role: "Router",
    thing: "light.children_night_light",
    hears: [
      [5, 165, "Parent"],
      [9, 55, "Child"],
    ],
    lqi: 165,
    seen: 40,
  },
  {
    n: 7,
    role: "EndDevice",
    thing: "binary_sensor.front_door",
    hears: [[1, 215, "Parent"]],
    lqi: 215,
    seen: 600,
  },
  {
    n: 8,
    role: "EndDevice",
    thing: "binary_sensor.garden_door",
    hears: [[2, 160, "Parent"]],
    lqi: 160,
    seen: 900,
  },
  {
    n: 9,
    role: "EndDevice",
    thing: "binary_sensor.guest_window",
    hears: [[6, 55, "Parent"]],
    lqi: 55,
    seen: 1200,
  },
];

/** A fictional IEEE address of the mesh's `n`th device. */
function ieee(n: number): string {
  return `00:12:4b:00:de:00:00:${n.toString(16).padStart(2, "0")}`;
}

/** `ms` as ZHA writes `last_seen`: the local time, without a zone. */
function localTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** The mesh as ZHA's `zha/devices` describes it, at the demo's time `now` (ms). */
export function demoZigbee(now: number, language: string): unknown[] {
  const role = new Map(MESH.map((device) => [device.n, device.role]));
  return MESH.map((device) => {
    const thing = THINGS.find((t) => t.id === device.thing);
    const names = device.names ?? thing?.names;
    const name = names ? say(names, language) : ieee(device.n);
    const coordinator = device.role === "Coordinator";
    return {
      ieee: ieee(device.n),
      nwk: coordinator ? 0 : 0x1000 + device.n,
      name,
      user_given_name: name,
      manufacturer: "Demo",
      model: coordinator ? "Z-C1" : device.role === "Router" ? "Z-R1" : "Z-S1",
      device_type: device.role,
      power_source: device.role === "EndDevice" ? "Battery or Unknown" : "Mains",
      available: true,
      // ZHA reports no quality of its own for the coordinator.
      lqi: coordinator ? null : (device.lqi ?? null),
      rssi: coordinator || device.lqi === undefined ? null : Math.round(device.lqi / 4 - 95),
      last_seen: localTime(now - device.seen * 1000),
      entities: thing ? [{ entity_id: thing.id, name }] : [],
      neighbors: device.hears.map(([n, lqi, relationship]) => ({
        ieee: ieee(n),
        nwk: n === 1 ? "0x0000" : `0x${(0x1000 + n).toString(16)}`,
        lqi: String(lqi),
        depth: n === 1 ? "0" : "1",
        relationship,
        device_type: role.get(n) ?? "Router",
        rx_on_when_idle: role.get(n) === "EndDevice" ? "Off" : "On",
        permit_joining: "Unknown",
        extended_pan_id: "de:de:de:de:de:de:de:de",
      })),
      routes: [],
      ...(coordinator ? { device_reg_id: COORDINATOR_DEVICE } : {}),
    };
  });
}

/**
 * The Bluetooth receivers: two on the ground floor, one on the landing, each placed by the room
 * it was put in; and what each learned in a few rooms (D-035, D-066). No device is followed.
 */
const RECEIVERS: readonly {
  source: string;
  name: string;
  room: string;
  storey: string;
  at: [number, number];
  height: number;
}[] = [
  {
    source: "D0:00:00:00:00:01",
    name: "living-room-proxy",
    room: "living",
    storey: "ground",
    at: [300, 470],
    height: 120,
  },
  {
    source: "D0:00:00:00:00:02",
    name: "kitchen-proxy",
    room: "kitchen",
    storey: "ground",
    at: [980, 260],
    height: 140,
  },
  {
    source: "D0:00:00:00:00:03",
    name: "landing-proxy",
    room: "u-landing",
    storey: "upper",
    at: [380, 600],
    height: 120,
  },
];

/** The Bluetooth locating as `domotwin/locating/get` gives it, its receivers placed. */
export function demoLocating(language: string): LocatingSettings {
  const elevation = new Map(STOREYS.map((s) => [s.info.id, s.info.elevation]));
  return {
    revision: 1,
    status: "ready",
    learn: true,
    receivers: RECEIVERS.map((r, k) => ({
      source: r.source,
      name: r.name,
      idle: k + 1,
      room: r.room,
      placed_by: "room",
      place: {
        storey: r.storey,
        at: [...r.at],
        z: (elevation.get(r.storey) ?? 0) + r.height,
      },
    })),
    devices: {},
    learned: { living: 36, kitchen: 30, "u-landing": 24 },
    heard: {
      office: { "D0:00:00:00:00:01": { signal: -74, readings: 28 } },
      "u-bedroom": { "D0:00:00:00:00:03": { signal: -72, readings: 22 } },
    },
    rooms: AREAS.map((area) => ({
      id: area.room,
      name: say(area.names, language),
      storey: area.storey,
    })),
    bermuda: [],
  };
}
