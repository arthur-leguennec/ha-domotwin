/**
 * A first launch in five minutes (D-083): a plan of the home drawn from Home Assistant's floors and
 * areas, a room for each area on its floor, and the devices of each placed in it and linked; on a
 * plan of one's own (imported, drawn), the devices of the areas its rooms are linked to.
 *
 * A first plan to shape, not the home's: each room takes a usual size for what it is (a kitchen, a
 * bedroom), the rooms of a floor are laid out side by side in rows, and the pieces stand along the
 * walls, clear of the doors.
 */
import type { HomeAssistant } from "../ha/types";
import {
  MAX_ENTITIES,
  areaOf,
  roomArea,
  shownEntity,
  type BindingsJson,
  type ElementBinding,
} from "./bindings";
import { planElements } from "./plan";
import { storeyIds } from "./storeys";
import { roomKind, type RoomKind } from "./room-labels";
import { fit } from "./suggest";

/** A point of the plan (cm). */
type P = [number, number];

/** An area of Home Assistant to draw as a room. */
export interface HomeArea {
  id: string;
  name: string;
  /** Its icon in Home Assistant (`mdi:sofa`): what the room is, when its name does not say. */
  icon?: string;
}

/** A floor of Home Assistant to draw as a storey, with the areas on it. */
export interface HomeStorey {
  name: string;
  /** Its level (0 the ground floor): the storey's elevation. */
  level: number;
  areas: HomeArea[];
}

/** A device to place: the kind of piece it is drawn as, its name and the entities it links. */
export interface DevicePiece {
  kind: string;
  style?: string;
  name: string;
  entities: string[];
}

/** A storey drawn: its plan, ready to be saved. */
export interface BuiltStorey {
  name: string;
  /** cm above the ground floor. */
  elevation: number;
  plan: Record<string, unknown>;
}

/** What `buildHome` and `placeDevices` made. */
export interface Built {
  storeys: BuiltStorey[];
  bindings: BindingsJson;
  rooms: number;
  /** Devices placed and linked. */
  devices: number;
  /** Pieces of furniture placed. */
  furniture: number;
  /** Devices not placed: no room for them, or too many for a plan (500 elements). */
  left: number;
}

/** How high a storey is above the one below it (cm): its walls, its floor. */
export const STOREY_HEIGHT = 280;
/** The most elements a plan holds (`docs/plan-format.md`), a few kept for the user's own. */
const MAX_ELEMENTS = 480;
/** The most rooms a storey is drawn with: with a door and a window each, well within its plan. */
const MAX_ROOMS = 150;
/** The longest id the integration keeps. */
const MAX_ID = 100;

/** Where a piece goes: on the floor, on a wall above the furniture, or on the ceiling. */
type Layer = "floor" | "wall" | "ceiling";

/**
 * The pieces DomoTwin places, with their usual size (cm) and lift as the catalogue has them
 * (`crates/domotwin-core/src/plan/catalogue.rs`; a test checks they agree), and where they go:
 * `against` a wall (their back to it), else free in the room.
 */
interface Shape {
  size: [number, number, number];
  lift?: number;
  layer: Layer;
  against: boolean;
}

export const SHAPES: Readonly<Record<string, Shape>> = {
  // Devices.
  "robot-vacuum": { size: [40, 50, 12], layer: "floor", against: true },
  // On its stand.
  tv: { size: [140, 35, 55], lift: 50, layer: "floor", against: true },
  "tv-stand": { size: [160, 40, 50], layer: "floor", against: true },
  speaker: { size: [12, 12, 17], layer: "floor", against: true },
  radiator: { size: [120, 8, 18], layer: "floor", against: true },
  "heat-pump": { size: [90, 22, 30], lift: 210, layer: "wall", against: true },
  "water-heater": { size: [56, 56, 150], layer: "floor", against: true },
  fan: { size: [40, 40, 125], layer: "floor", against: true },
  "ceiling-fan": { size: [105, 105, 30], lift: 215, layer: "ceiling", against: false },
  humidifier: { size: [22, 22, 30], layer: "floor", against: true },
  dehumidifier: { size: [36, 26, 56], layer: "floor", against: true },
  "air-purifier": { size: [30, 30, 60], layer: "floor", against: true },
  "camera:wall": { size: [8, 15, 9], lift: 220, layer: "wall", against: true },
  curtain: { size: [200, 6, 235], layer: "wall", against: true },
  "smoke-detector": { size: [12, 12, 4], lift: 261, layer: "ceiling", against: false },
  sensor: { size: [6, 3, 6], lift: 150, layer: "wall", against: true },
  "sensor:motion": { size: [8, 6, 8], lift: 210, layer: "wall", against: true },
  "ceiling-light": { size: [36, 36, 14], lift: 250, layer: "ceiling", against: false },
  "floor-lamp": { size: [35, 35, 160], layer: "floor", against: true },
  "garden-light:post": { size: [25, 25, 200], layer: "floor", against: false },
  // Furniture.
  sofa: { size: [210, 90, 85], layer: "floor", against: true },
  armchair: { size: [80, 80, 85], layer: "floor", against: true },
  "coffee-table": { size: [110, 65, 42], layer: "floor", against: false },
  bed: { size: [160, 200, 55], layer: "floor", against: true },
  nightstand: { size: [40, 40, 48], layer: "floor", against: true },
  "tall-cabinet": { size: [60, 65, 190], layer: "floor", against: true },
  counter: { size: [180, 60, 90], layer: "floor", against: true },
  stove: { size: [60, 60, 90], layer: "floor", against: true },
  fridge: { size: [70, 70, 185], layer: "floor", against: true },
  "dining-table": { size: [140, 75, 75], layer: "floor", against: false },
  chair: { size: [50, 50, 80], layer: "floor", against: false },
  sideboard: { size: [160, 45, 80], layer: "floor", against: true },
  bathtub: { size: [170, 75, 60], layer: "floor", against: true },
  shower: { size: [90, 90, 205], layer: "floor", against: true },
  vanity: { size: [75, 50, 85], layer: "floor", against: true },
  toilet: { size: [40, 70, 75], layer: "floor", against: true },
  desk: { size: [150, 70, 75], layer: "floor", against: true },
  "office-chair": { size: [60, 60, 110], layer: "floor", against: false },
  bookcase: { size: [110, 35, 180], layer: "floor", against: true },
  washer: { size: [65, 65, 90], layer: "floor", against: true },
  dryer: { size: [65, 65, 90], layer: "floor", against: true },
  "shoe-cabinet": { size: [80, 25, 100], layer: "floor", against: true },
  "coat-rack": { size: [45, 45, 180], layer: "floor", against: true },
  car: { size: [180, 445, 148], layer: "floor", against: false },
  plant: { size: [35, 35, 80], layer: "floor", against: true },
};

/** A room's usual size (cm, width and depth) for what it is. */
const ROOM_SIZES: Readonly<Record<RoomKind, [number, number]>> = {
  kitchen: [360, 300],
  living: [520, 420],
  dining: [380, 330],
  bedroom: [360, 340],
  bathroom: [260, 220],
  toilet: [160, 130],
  office: [300, 280],
  laundry: [240, 200],
  hall: [320, 180],
  closet: [180, 150],
  garage: [620, 340],
  stairs: [260, 180],
  outdoor: [500, 400],
  room: [320, 300],
};

/**
 * What a room is from its area's icon, when its name does not say (`mdi:sofa`: a living room): the
 * icon's first words, whole (`mdi:car-side` is a car, `mdi:cart` is not).
 */
const ICONS: readonly (readonly [RoomKind, readonly string[]])[] = [
  ["bedroom", ["bed", "bunk-bed", "baby", "crib", "human-child"]],
  ["living", ["sofa", "television", "seat", "couch", "fireplace"]],
  ["kitchen", ["stove", "fridge", "chef-hat", "silverware", "countertop", "pot", "microwave"]],
  ["dining", ["table-chair", "food", "glass-wine"]],
  ["bathroom", ["shower", "bathtub", "bath", "scale-bathroom"]],
  ["toilet", ["toilet", "human-male-female"]],
  ["office", ["desk", "laptop", "monitor", "briefcase", "chair-rolling", "bookshelf"]],
  ["laundry", ["washing-machine", "tumble-dryer", "iron", "hanger"]],
  ["hall", ["door", "coat-rack", "shoe-formal"]],
  ["garage", ["garage", "car"]],
  ["stairs", ["stairs"]],
  [
    "outdoor",
    [
      "tree",
      "flower",
      "grass",
      "pool",
      "umbrella-beach",
      "balcony",
      "nature",
      "pine-tree",
      "sprout",
    ],
  ],
];

/** What an area is: from its name, else its icon. */
export function areaKind(area: HomeArea): RoomKind {
  const named = roomKind(area.name);
  if (named !== "room") return named;
  const icon = area.icon?.startsWith("mdi:") ? area.icon.slice(4) : "";
  const found = ICONS.find(([, words]) =>
    words.some((word) => icon === word || icon.startsWith(`${word}-`)),
  );
  return found?.[0] ?? "room";
}

/** The furniture of a room of each kind, the largest first; a bathroom's bath fits a large one. */
function furnitureOf(kind: RoomKind, width: number, depth: number): string[] {
  switch (kind) {
    case "living":
      return ["sofa", "coffee-table", "armchair", "plant"];
    case "bedroom":
      return ["bed", "tall-cabinet", "nightstand"];
    case "kitchen":
      return ["counter", "fridge", "stove"];
    case "dining":
      return ["dining-table", "sideboard", "chair", "chair"];
    case "bathroom":
      return [width * depth >= 50_000 ? "bathtub" : "shower", "vanity", "toilet"];
    case "toilet":
      return ["toilet"];
    case "office":
      return ["desk", "office-chair", "bookcase"];
    case "laundry":
      return ["washer", "dryer"];
    case "hall":
      return ["shoe-cabinet", "coat-rack"];
    case "closet":
      return ["tall-cabinet"];
    case "garage":
      return ["car"];
    default:
      return [];
  }
}

// ---- Devices ---------------------------------------------------------------------------------

/** The kind a device is drawn as, from one of its entities, and how much that one says (higher first). */
function kindOf(hass: HomeAssistant, entityId: string): [string, number, string?] | undefined {
  const domain = entityId.split(".")[0] ?? "";
  const attributes = hass.states[entityId]?.attributes ?? {};
  const raw = attributes.device_class;
  const deviceClass = typeof raw === "string" ? raw : "";
  switch (domain) {
    case "vacuum":
      return ["robot-vacuum", 100];
    case "media_player":
      return deviceClass === "tv" ? ["tv", 90] : ["speaker", 80];
    case "climate": {
      const modes = Array.isArray(attributes.hvac_modes)
        ? (attributes.hvac_modes as unknown[])
        : [];
      return modes.includes("cool") || modes.includes("heat_cool")
        ? ["heat-pump", 70]
        : ["radiator", 70];
    }
    case "water_heater":
      return ["water-heater", 70];
    case "fan":
      return ["fan", 60];
    case "humidifier":
      return deviceClass === "dehumidifier" ? ["dehumidifier", 60] : ["humidifier", 60];
    case "camera":
      return ["camera", 55, "wall"];
    case "cover":
      return deviceClass === "curtain" ? ["curtain", 50] : undefined;
    case "binary_sensor":
      if (["smoke", "gas", "carbon_monoxide"].includes(deviceClass)) return ["smoke-detector", 45];
      if (["motion", "occupancy", "presence"].includes(deviceClass))
        return ["sensor", 30, "motion"];
      return undefined;
    case "light":
      // A light grouping others is not a lamp of its own.
      return Array.isArray(attributes.entity_id) ? undefined : ["ceiling-light", 40];
    case "sensor":
      return ["temperature", "humidity"].includes(deviceClass) ? ["sensor", 20] : undefined;
    default:
      return undefined;
  }
}

/** The name of a device, or of an entity on its own. */
function deviceName(hass: HomeAssistant, device: string | undefined, entityId: string): string {
  const entry = device ? hass.devices?.[device] : undefined;
  const named = entry?.name_by_user ?? entry?.name;
  if (named) return named;
  const friendly = hass.states[entityId]?.attributes.friendly_name;
  return typeof friendly === "string" ? friendly : entityId;
}

/**
 * The devices of some areas to place, each once, by area: an entity's device, or the entity when it
 * has none; drawn as the kind its most telling entity says (a vacuum, a television, a
 * thermostat…), in that entity's area, and linked to its entities that fit that kind. What is in
 * `linked` (from `linkedEntities`: an entity, or a device by any of its entities) and hidden
 * entities are left out; a device whose entities say nothing DomoTwin draws (a switch, a door's
 * contact) too. What is given is added to `linked`, so it is given once.
 */
export function devicesByArea(
  hass: HomeAssistant,
  areas: Iterable<string>,
  linked: Set<string>,
): Map<string, DevicePiece[]> {
  const wanted = new Set(areas);
  // One pass over the registry: the entities of the areas wanted, by device.
  const groups = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry || linked.has(entry.entity_id) || !shownEntity(hass, entry.entity_id)) continue;
    const area = areaOf(hass, entry.entity_id);
    if (!area || !wanted.has(area)) continue;
    const key = entry.device_id ? `device:${entry.device_id}` : `entity:${entry.entity_id}`;
    if (linked.has(key)) continue;
    const list = groups.get(key);
    if (list) list.push(entry.entity_id);
    else groups.set(key, [entry.entity_id]);
  }
  const byArea = new Map<string, DevicePiece[]>([...wanted].map((area) => [area, []]));
  for (const [key, entities] of groups) {
    entities.sort();
    let best: [string, number, string?] | undefined;
    let main = "";
    for (const id of entities) {
      const kind = kindOf(hass, id);
      if (kind && (!best || kind[1] > best[1])) [best, main] = [kind, id];
    }
    if (!best) continue;
    let [kind] = best;
    // A fan with a light is a ceiling fan.
    if (kind === "fan" && entities.some((id) => id.startsWith("light."))) kind = "ceiling-fan";
    const element = { id: "", type: "furniture" as const, name: "", kind };
    const fitting = entities
      .filter((id) => id !== main && fit(element, id, hass) > 0)
      .sort((a, b) => fit(element, b, hass) - fit(element, a, hass) || a.localeCompare(b));
    const piece: DevicePiece = {
      kind,
      name: deviceName(hass, key.startsWith("device:") ? key.slice(7) : undefined, main),
      entities: [main, ...fitting].slice(0, MAX_ENTITIES),
    };
    if (best[2]) piece.style = best[2];
    byArea.get(areaOf(hass, main) ?? "")?.push(piece);
    linked.add(key);
    for (const id of piece.entities) linked.add(id);
  }
  // The larger first, so they find their wall before the small ones.
  for (const pieces of byArea.values()) {
    pieces.sort((a, b) => area2(shapeOf(b)) - area2(shapeOf(a)) || a.name.localeCompare(b.name));
  }
  return byArea;
}

/** The devices of one area to place (`devicesByArea`), what is in `linked` left out. */
export function devicePieces(
  hass: HomeAssistant,
  area: string,
  linked: ReadonlySet<string> = new Set(),
): DevicePiece[] {
  return devicesByArea(hass, [area], new Set(linked)).get(area) ?? [];
}

function shapeOf(piece: { kind: string; style?: string }): Shape {
  return (
    SHAPES[`${piece.kind}:${piece.style ?? ""}`] ??
    SHAPES[piece.kind] ?? {
      size: [50, 50, 50],
      layer: "floor",
      against: true,
    }
  );
}

function area2(shape: Shape): number {
  return shape.size[0] * shape.size[1];
}

// ---- Geometry --------------------------------------------------------------------------------

/** A box seen from above: its centre, half width and depth, and its angle (degrees, clockwise). */
interface Box {
  c: P;
  hw: number;
  hd: number;
  angle: number;
}

function axes(angle: number): [P, P] {
  const r = (angle * Math.PI) / 180;
  const [s, c] = [Math.sin(r), Math.cos(r)];
  return [
    [c, s],
    [-s, c],
  ];
}

function corners(box: Box): P[] {
  const [u, v] = axes(box.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a = 0, b = 0]) => [
    box.c[0] + u[0] * a * box.hw + v[0] * b * box.hd,
    box.c[1] + u[1] * a * box.hw + v[1] * b * box.hd,
  ]);
}

/** Whether two boxes overlap (by more than touching), by their separating axes. */
function overlap(a: Box, b: Box): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const axis of [...axes(a.angle), ...axes(b.angle)]) {
    const project = (points: P[]): [number, number] => {
      const d = points.map((p) => p[0] * axis[0] + p[1] * axis[1]);
      return [Math.min(...d), Math.max(...d)];
    };
    const [a0, a1] = project(ca);
    const [b0, b1] = project(cb);
    if (a1 <= b0 + 0.5 || b1 <= a0 + 0.5) return false;
  }
  return true;
}

function inside(polygon: readonly P[], p: P): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] ?? [0, 0];
    const [xj, yj] = polygon[j] ?? [0, 0];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      within = !within;
  }
  return within;
}

function distanceToSegment(p: P, a: P, b: P): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Whether a point is in a box grown by `grow` cm on every side. */
function holds(box: Box, p: P, grow: number): boolean {
  const [u, v] = axes(box.angle);
  const d: P = [p[0] - box.c[0], p[1] - box.c[1]];
  return (
    Math.abs(d[0] * u[0] + d[1] * u[1]) < box.hw + grow &&
    Math.abs(d[0] * v[0] + d[1] * v[1]) < box.hd + grow
  );
}

/** Whether two segments cross (touching is not crossing). */
function cross(a: P, b: P, c: P, d: P): boolean {
  const side = (p: P, q: P, r: P): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Whether a box stands inside the room, `margin` cm from its sides: its corners inside, and in a
 * room that is not convex (an L), no corner of the room in it and no side through it.
 */
function within(polygon: readonly P[], box: Box, margin: number): boolean {
  const own = corners(box);
  const sides = polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length] ?? a] as const);
  return (
    own.every(
      (corner) =>
        inside(polygon, corner) &&
        sides.every(([a, b]) => distanceToSegment(corner, a, b) >= margin),
    ) &&
    polygon.every((vertex) => !holds(box, vertex, margin)) &&
    sides.every(([a, b]) => own.every((c, i) => !cross(a, b, c, own[(i + 1) % own.length] ?? c)))
  );
}

/** The point of a room to start from: its centre, or the nearest point inside it to its centre. */
function middle(polygon: readonly P[]): P {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const centre: P = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  if (inside(polygon, centre)) return centre;
  let best = polygon[0] ?? centre;
  let far = Infinity;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 10) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 10) {
      const d = Math.hypot(x - centre[0], y - centre[1]);
      if (d < far && inside(polygon, [x, y])) [best, far] = [[x, y], d];
    }
  }
  return best;
}

// ---- Placing ---------------------------------------------------------------------------------

/** An opening on a room's side: kept clear in front (a door) or under (a window, for tall pieces). */
interface Gap {
  a: P;
  b: P;
  door: boolean;
}

/** A room to furnish: its outline, its openings, and what already stands in it. */
interface Room {
  outline: P[];
  /** A place outside (D-077): no walls, no ceiling. */
  outside: boolean;
  gaps: Gap[];
  taken: { box: Box; layer: Layer }[];
}

/** A piece placed: its box, its rotation and its lift. */
interface Spot {
  at: P;
  rotation: number;
}

/** Half an interior wall: the pieces keep this far from a room's outline (cm). */
const WALL = 6;

/**
 * A spot for a piece in a room: against a wall (its back to it, facing in) or free, not over
 * another piece of its layer, not in a door's way, a tall piece not before a window. The walls
 * are tried longest first; a large piece the middle of a wall, a small one its ends. None when
 * nothing fits.
 */
function findSpot(room: Room, shape: Shape, layer: Layer): Spot | undefined {
  const [w, d, h] = shape.size;
  const clear = (box: Box): boolean => {
    if (!within(room.outline, box, layer === "ceiling" ? 2 : WALL - 1)) return false;
    for (const placed of room.taken) {
      if (placed.layer === layer && overlap(placed.box, box)) return false;
    }
    if (layer === "ceiling") return true;
    for (const gap of room.gaps) {
      // A door's leaf and passage, 75 cm into the room; under a window, 30 cm.
      if (!gap.door && (layer === "wall" ? false : h < 100)) continue;
      const along: P = [gap.b[0] - gap.a[0], gap.b[1] - gap.a[1]];
      const length = Math.hypot(along[0], along[1]) || 1;
      const reach = gap.door ? 75 : 30;
      const zone: Box = {
        c: [(gap.a[0] + gap.b[0]) / 2, (gap.a[1] + gap.b[1]) / 2],
        hw: length / 2 + (gap.door ? 10 : 0),
        hd: reach,
        angle: (Math.atan2(along[1], along[0]) * 180) / Math.PI,
      };
      if (overlap(zone, box)) return false;
    }
    return true;
  };
  if (shape.against) {
    const sides = room.outline
      .map((a, i) => [a, room.outline[(i + 1) % room.outline.length] ?? a] as const)
      .map(([a, b]) => ({ a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) }))
      .filter((side) => side.length >= w + 2 * WALL)
      .sort((x, y) => y.length - x.length);
    for (const { a, b, length } of sides) {
      const t: P = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      // The normal into the room.
      let n: P = [-t[1], t[0]];
      const probe: P = [
        (a[0] + b[0]) / 2 + n[0] * (WALL + 1),
        (a[1] + b[1]) / 2 + n[1] * (WALL + 1),
      ];
      if (!inside(room.outline, probe)) n = [t[1], -t[0]];
      // Its front (+y before turning) faces into the room.
      const rotation = ((((Math.atan2(-n[0], n[1]) * 180) / Math.PI) % 360) + 360) % 360;
      // A large piece from the middle of the wall out, a small one from its ends in.
      const [first, last] = [w / 2 + WALL, length - w / 2 - WALL];
      const offsets: number[] = [];
      for (let k = 0; k <= (last - first) / 2 + 5; k += 5) {
        if (w >= 100) offsets.push(length / 2 - k, length / 2 + k);
        else offsets.push(first + k, last - k);
      }
      offsets.splice(0, offsets.length, ...offsets.filter((o) => o >= first && o <= last));
      for (const s of offsets) {
        const c: P = [
          a[0] + t[0] * s + n[0] * (WALL + d / 2),
          a[1] + t[1] * s + n[1] * (WALL + d / 2),
        ];
        const box = { c, hw: w / 2, hd: d / 2, angle: rotation };
        if (clear(box)) return { at: c, rotation: Math.round(rotation) };
      }
    }
    return undefined;
  }
  // Free: from the middle out, the first spot clear; a ceiling piece the farthest from the others.
  const start = middle(room.outline);
  const xs = room.outline.map((p) => p[0]);
  const ys = room.outline.map((p) => p[1]);
  const others = room.taken.filter((t) => t.layer === layer).map((t) => t.box.c);
  const score = (p: P): number =>
    layer === "ceiling" && others.length > 0
      ? -Math.min(...others.map((o) => Math.hypot(p[0] - o[0], p[1] - o[1])))
      : Math.hypot(p[0] - start[0], p[1] - start[1]);
  // Every 10 cm, coarser in a large place (a garden): some 4 000 spots at most.
  const step = Math.max(
    10,
    Math.ceil(
      Math.sqrt(((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 4000),
    ),
  );
  // As it comes, else a quarter turned (a car along a garage's length).
  for (const angle of w === d ? [0] : [0, 90]) {
    const [across, along] = angle === 0 ? [w, d] : [d, w];
    const spots: { c: P; score: number }[] = [];
    for (let x = Math.min(...xs) + across / 2; x <= Math.max(...xs) - across / 2; x += step) {
      for (let y = Math.min(...ys) + along / 2; y <= Math.max(...ys) - along / 2; y += step) {
        spots.push({ c: [x, y], score: score([x, y]) });
      }
    }
    spots.sort((p, q) => p.score - q.score);
    for (const { c } of spots) {
      if (clear({ c, hw: w / 2, hd: d / 2, angle })) return { at: c, rotation: angle };
    }
  }
  return undefined;
}

/**
 * A curtain before a window of the room no curtain hangs at yet: as wide as the window and a
 * little more, on its inner side, facing in. None when the room has no window free.
 */
function curtainSpot(room: Room, shape: Shape): [Spot, Shape] | undefined {
  for (const gap of room.gaps) {
    if (gap.door) continue;
    const along: P = [gap.b[0] - gap.a[0], gap.b[1] - gap.a[1]];
    const length = Math.hypot(along[0], along[1]);
    if (length < 20) continue;
    const t: P = [along[0] / length, along[1] / length];
    const middle: P = [(gap.a[0] + gap.b[0]) / 2, (gap.a[1] + gap.b[1]) / 2];
    let n: P = [-t[1], t[0]];
    if (!inside(room.outline, [middle[0] + n[0] * (WALL + 1), middle[1] + n[1] * (WALL + 1)]))
      n = [t[1], -t[0]];
    const size: Shape["size"] = [cm(length + 40), shape.size[1], shape.size[2]];
    const at: P = [
      middle[0] + n[0] * (WALL + size[1] / 2),
      middle[1] + n[1] * (WALL + size[1] / 2),
    ];
    const rotation = Math.round(((((Math.atan2(-n[0], n[1]) * 180) / Math.PI) % 360) + 360) % 360);
    const box: Box = { c: at, hw: size[0] / 2, hd: size[1] / 2, angle: rotation };
    if (room.taken.some((placed) => placed.layer === "wall" && overlap(placed.box, box))) continue;
    return [
      { at, rotation },
      { ...shape, size },
    ];
  }
  return undefined;
}

/** Rounds to the centimetre, as plans are written. */
function cm(value: number): number {
  return Math.round(value);
}

/** Ids made unique: the home's, and those given here. */
class Ids {
  private readonly taken: Set<string>;
  private readonly counts = new Map<string, number>();
  constructor(taken: Iterable<string>) {
    this.taken = new Set(taken);
  }
  next(prefix: string): string {
    const base = prefix.slice(0, MAX_ID - 6);
    let n = this.counts.get(base) ?? 0;
    let id: string;
    do id = `${base}-${++n}`;
    while (this.taken.has(id));
    this.counts.set(base, n);
    this.taken.add(id);
    return id;
  }
  claim(wanted: string): string {
    const id = wanted.slice(0, MAX_ID);
    if (!this.taken.has(id)) {
      this.taken.add(id);
      return id;
    }
    return this.next(id);
  }
}

/** An item of the plan for a piece placed in a room. */
function item(
  id: string,
  room: string,
  kind: string,
  spot: Spot,
  shape: Shape,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    id,
    kind,
    at: [cm(spot.at[0]), cm(spot.at[1])],
    size: shape.size,
    rotation: spot.rotation,
    room,
    ...extra,
  };
  if (shape.lift) fields.lift = shape.lift;
  return fields;
}

/** A piece of a plan as it stands: its item moved by the overlay, or added in it. */
interface Standing {
  room?: string;
  box: Box;
  layer: Layer;
}

/**
 * The pieces of a plan where they stand: its items, moved, turned or taken out by the overlay
 * (`layout`, D-005), and the pieces the overlay adds.
 */
function piecesStanding(plan: unknown, layout: Record<string, unknown> = {}): Standing[] {
  const read = (fields: Record<string, unknown>, entry: Record<string, unknown>): Standing[] => {
    const at = (entry.at ?? fields.at) as P | undefined;
    const size = fields.size as number[] | undefined;
    if (!Array.isArray(at) || !Array.isArray(size)) return [];
    const kind = typeof fields.kind === "string" ? fields.kind : "box";
    const style = typeof fields.style === "string" ? fields.style : undefined;
    const rotation = entry.rotation ?? fields.rotation;
    const room = entry.room ?? fields.room;
    const piece: Standing = {
      box: {
        c: at,
        hw: (size[0] ?? 0) / 2,
        hd: (size[1] ?? 0) / 2,
        angle: typeof rotation === "number" ? rotation : 0,
      },
      layer: shapeOf({ kind, style }).layer,
    };
    if (typeof room === "string" && room !== "") piece.room = room;
    return [piece];
  };
  const entryOf = (id: string): Record<string, unknown> => {
    const entry = layout[id];
    return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
  };
  const pieces = planElements(plan)
    .filter((e) => e.type === "furniture" && entryOf(e.id).removed !== true)
    .flatMap((e) => read(e.fields, entryOf(e.id)));
  for (const id of Object.keys(layout)) {
    const entry = entryOf(id);
    const added = entry.add;
    if (typeof added === "object" && added !== null && entry.removed !== true) {
      pieces.push(...read(added as Record<string, unknown>, entry));
    }
  }
  return pieces;
}

/**
 * A room of a plan file: its outline, its openings on its sides, and the pieces standing in it
 * (said to be in it, or in no room with their centre inside it).
 */
function roomOf(
  plan: Record<string, unknown>,
  id: string,
  pieces: readonly Standing[],
): Room | undefined {
  const elements = planElements(plan);
  const found = elements.find((e) => e.type === "room" && e.id === id);
  const raw = found?.fields.outline;
  const outline = Array.isArray(raw)
    ? (raw as unknown[]).filter(
        (p): p is P => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"),
      )
    : undefined;
  if (!outline || outline.length < 3) return undefined;
  const gaps: Gap[] = [];
  for (const e of elements) {
    if (e.type !== "door" && e.type !== "window") continue;
    const a = e.fields.from as P | undefined;
    const b = e.fields.to as P | undefined;
    if (!a || !b) continue;
    const middlePoint: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const onSide = outline.some(
      (p, i) => distanceToSegment(middlePoint, p, outline[(i + 1) % outline.length] ?? p) < 15,
    );
    if (onSide) gaps.push({ a, b, door: e.type === "door" });
  }
  const taken = pieces
    .filter((piece) => (piece.room ? piece.room === id : inside(outline, piece.box.c)))
    .map(({ box, layer }) => ({ box, layer }));
  return { outline, outside: found?.fields.outside === true, gaps, taken };
}

/** How many more elements a plan may take (its 500, a few kept for the user's own). */
interface Budget {
  left: number;
}

/**
 * Places pieces in a room of a plan: each where `findSpot` finds room for it, added to the plan's
 * items and linked when it is a device. Returns how many were placed and how many devices found no
 * spot (or no room in the plan's elements).
 */
function furnish(
  plan: Record<string, unknown>,
  roomId: string,
  pieces: readonly (DevicePiece | { kind: string; style?: string })[],
  ids: Ids,
  elements: Record<string, ElementBinding>,
  room: Room | undefined,
  budget: Budget,
): { devices: number; furniture: number; left: number } {
  const counts = { devices: 0, furniture: 0, left: 0 };
  if (!room) return counts;
  const items = (plan.items as Record<string, unknown>[] | undefined) ?? [];
  plan.items = items;
  for (const given of pieces) {
    const device = "entities" in given;
    let piece = given;
    // Outside, nothing hangs from a ceiling or a wall: a light is a garden light on its post, what
    // hangs is left for one to place.
    if (room.outside) {
      if (piece.kind === "ceiling-light") piece = { ...piece, kind: "garden-light", style: "post" };
      else if (shapeOf(piece).layer !== "floor") {
        if (device) counts.left++;
        continue;
      }
    }
    // A television stands on its stand; a curtain hangs before a window, as wide as it.
    const standing = piece.kind === "tv";
    if (budget.left < (standing ? 2 : 1)) {
      if (device) counts.left++;
      continue;
    }
    let shape = shapeOf(standing ? { kind: "tv-stand" } : piece);
    let spot: Spot | undefined;
    if (piece.kind === "curtain") {
      const hung = curtainSpot(room, shape);
      if (hung) [spot, shape] = hung;
    }
    spot ??= findSpot(room, shape, shape.layer);
    if (!spot) {
      if (device) counts.left++;
      continue;
    }
    const box: Box = {
      c: spot.at,
      hw: shape.size[0] / 2,
      hd: shape.size[1] / 2,
      angle: spot.rotation,
    };
    room.taken.push({ box, layer: shape.layer });
    if (standing) {
      items.push(item(ids.next("tv-stand"), roomId, "tv-stand", spot, shape));
      budget.left--;
    }
    const own = standing ? shapeOf(piece) : shape;
    const id = ids.next(piece.kind);
    const extra: Record<string, unknown> = {};
    if (piece.style) extra.style = piece.style;
    if ("entities" in piece) extra.name = piece.name;
    items.push(item(id, roomId, piece.kind, spot, own, extra));
    budget.left--;
    if ("entities" in piece) {
      elements[id] = { entities: piece.entities.map((entity_id) => ({ entity_id })) };
      counts.devices++;
    } else counts.furniture++;
  }
  return counts;
}

// ---- A home from the areas -------------------------------------------------------------------

/** A room laid out: its area, its kind and its rectangle (cm). */
interface Laid {
  area: HomeArea;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  d: number;
}

/**
 * Lays a floor's rooms out in rows, the deepest first, each row as wide as the floor; a row a
 * little narrower or wider is stretched to it, so the floor is a rectangle but for its last row.
 */
function layOut(areas: readonly HomeArea[]): Laid[][] {
  const rooms = areas.map((area) => {
    const kind = areaKind(area);
    const [w, d] = ROOM_SIZES[kind];
    return { area, kind, w, d };
  });
  const total = rooms.reduce((sum, r) => sum + r.w * r.d, 0);
  const width = Math.max(...rooms.map((r) => r.w), Math.sqrt(total * 1.6));
  const sorted = [...rooms].sort((a, b) => b.d - a.d || b.w - a.w);
  const rows: (typeof rooms)[] = [];
  let row: typeof rooms = [];
  let used = 0;
  for (const room of sorted) {
    if (row.length > 0 && used + room.w > width * 1.15) {
      rows.push(row);
      [row, used] = [[], 0];
    }
    row.push(room);
    used += room.w;
  }
  if (row.length > 0) rows.push(row);
  const laid: Laid[][] = [];
  let y = 0;
  for (const [index, list] of rows.entries()) {
    const natural = list.reduce((sum, r) => sum + r.w, 0);
    const last = index === rows.length - 1;
    const scale = !last || natural >= width * 0.75 ? width / natural : 1;
    const depth = Math.max(...list.map((r) => r.d));
    let x = 0;
    const placed: Laid[] = [];
    for (const r of list) {
      const w = cm(r.w * scale);
      placed.push({ area: r.area, kind: r.kind, x, y, w, d: depth });
      x += w;
    }
    // The last room closes the row exactly.
    const end = placed.at(-1);
    if (end && scale !== 1) end.w = cm(width) - end.x;
    laid.push(placed);
    y += depth;
  }
  return laid;
}

/** The parts of a room's side (from `a` to `b`, along x or y) no other room's side covers. */
function freeParts(a: P, b: P, others: readonly Laid[]): [number, number][] {
  const horizontal = a[1] === b[1];
  const [lo, hi] = horizontal
    ? [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
    : [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const line = horizontal ? a[1] : a[0];
  const covered: [number, number][] = [];
  for (const o of others) {
    if (horizontal && (o.y === line || o.y + o.d === line)) covered.push([o.x, o.x + o.w]);
    if (!horizontal && (o.x === line || o.x + o.w === line)) covered.push([o.y, o.y + o.d]);
  }
  let parts: [number, number][] = [[lo, hi]];
  for (const [c0, c1] of covered) {
    parts = parts.flatMap(([p0, p1]): [number, number][] => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      const kept: [number, number][] = [];
      if (c0 > p0) kept.push([p0, c0]);
      if (c1 < p1) kept.push([c1, p1]);
      return kept;
    });
  }
  return parts;
}

/** Input of `buildHome`. */
export interface HomeChoice {
  storeys: readonly HomeStorey[];
  /** The devices of each area to place, by area id; none to place none. */
  devices?: ReadonlyMap<string, readonly DevicePiece[]>;
  /** Whether to furnish the rooms (a bed in a bedroom, a sofa in a living room…). */
  furnish: boolean;
  /** Ids already in the home, kept free. */
  taken?: Iterable<string>;
}

/**
 * The home drawn from Home Assistant's floors and areas: a storey per floor, a room per area
 * linked to it, doors between them (each room reached from the one before it, an entrance on
 * the first), a window on each room's longest outer wall, and the devices and furniture placed.
 */
export function buildHome(choice: HomeChoice): Built {
  const ids = new Ids(choice.taken ?? []);
  const bindings: BindingsJson = { version: 1, rooms: {}, elements: {} };
  const built: Built = { storeys: [], bindings, rooms: 0, devices: 0, furniture: 0, left: 0 };
  const levels = choice.storeys.filter((s) => s.areas.length > 0).map((s) => s.level);
  const ground = levels.includes(0) ? 0 : Math.min(...levels);
  for (const storey of choice.storeys) {
    if (storey.areas.length === 0) continue;
    // A room, a door and a window each, within a plan's 500 elements.
    const laid = layOut(storey.areas.slice(0, MAX_ROOMS));
    const flat = laid.flat();
    const roomIds = new Map<Laid, string>();
    const rooms: Record<string, unknown>[] = [];
    for (const r of flat) {
      const id = ids.claim(`area-${r.area.id}`);
      roomIds.set(r, id);
      const room: Record<string, unknown> = {
        id,
        name: r.area.name,
        outline: [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x + r.w, r.y + r.d],
          [r.x, r.y + r.d],
        ],
      };
      if (r.kind === "outdoor") room.outside = true;
      rooms.push(room);
      bindings.rooms[id] = { area: r.area.id };
    }
    const doors: Record<string, unknown>[] = [];
    const door = (room: Laid, from: P, to: P): void => {
      doors.push({ id: ids.next("door"), from, to, room: roomIds.get(room) });
    };
    // Each room reached from the one before it in its row, the first of a row from the row above.
    for (const [r, row] of laid.entries()) {
      for (const [i, room] of row.entries()) {
        const before = row[i - 1];
        if (before && i > 0) {
          const y = room.y + room.d / 2;
          door(room, [room.x, cm(y - 40)], [room.x, cm(y + 40)]);
          continue;
        }
        const above = laid[r - 1];
        if (!above) continue;
        let best: [Laid, number, number] | undefined;
        for (const other of above) {
          const lo = Math.max(other.x, room.x);
          const hi = Math.min(other.x + other.w, room.x + room.w);
          if (hi - lo >= 100 && (!best || hi - lo > best[2] - best[1])) best = [other, lo, hi];
        }
        if (best) {
          const x = (best[1] + best[2]) / 2;
          door(room, [cm(x - 40), room.y], [cm(x + 40), room.y]);
        }
      }
    }
    // The outer stretches of each room's sides: where no other room is behind them; for a
    // window, a garden or a terrace behind is outside too.
    const indoors = flat.filter((r) => r.kind !== "outdoor");
    const outer = (
      room: Laid,
      behind: readonly Laid[],
    ): { a: P; b: P; lo: number; hi: number }[] => {
      const corners: P[] = [
        [room.x, room.y],
        [room.x + room.w, room.y],
        [room.x + room.w, room.y + room.d],
        [room.x, room.y + room.d],
      ];
      return corners.flatMap((a, i) => {
        const b = corners[(i + 1) % 4] ?? a;
        return freeParts(
          a,
          b,
          behind.filter((o) => o !== room),
        ).map(([lo, hi]) => ({ a, b, lo, hi }));
      });
    };
    // An opening across a stretch of a side, from `lo` to `hi` along it.
    const across = (a: P, b: P, lo: number, hi: number): [P, P] =>
      a[1] === b[1]
        ? [
            [cm(lo), a[1]],
            [cm(hi), a[1]],
          ]
        : [
            [a[0], cm(lo)],
            [a[0], cm(hi)],
          ];
    // The entrance, on the ground floor: into the hall, else the living room…, never a garage.
    const ENTRANCES: readonly RoomKind[] = [
      "hall",
      "living",
      "dining",
      "kitchen",
      "room",
      "office",
    ];
    const entrance =
      storey.level === ground
        ? (ENTRANCES.map((kind) => indoors.find((r) => r.kind === kind)).find(Boolean) ??
          indoors.find((r) => r.kind !== "garage") ??
          indoors[0])
        : undefined;
    if (entrance) {
      // Into the street rather than the garden, when it can.
      const stretch = [outer(entrance, flat), outer(entrance, indoors)]
        .map((stretches) =>
          stretches
            .filter(({ lo, hi }) => hi - lo >= 130)
            .sort((x, y) => y.hi - y.lo - (x.hi - x.lo)),
        )
        .find((stretches) => stretches.length > 0)?.[0];
      if (stretch) {
        const mid = (stretch.lo + stretch.hi) / 2;
        const [from, to] = across(stretch.a, stretch.b, mid - 45, mid + 45);
        doors.push({ id: ids.next("door"), from, to, room: roomIds.get(entrance) });
      }
    }
    // A window on each room's longest outer stretch, clear of the doors on it.
    const windows: Record<string, unknown>[] = [];
    for (const room of indoors) {
      if (["closet", "stairs", "hall"].includes(room.kind)) continue;
      let best: { a: P; b: P; lo: number; hi: number } | undefined;
      for (const stretch of outer(room, indoors)) {
        const horizontal = stretch.a[1] === stretch.b[1];
        const line = horizontal ? stretch.a[1] : stretch.a[0];
        let parts: [number, number][] = [[stretch.lo, stretch.hi]];
        for (const d of doors) {
          const [from, to] = [d.from as P, d.to as P];
          if (horizontal ? from[1] !== line || to[1] !== line : from[0] !== line || to[0] !== line)
            continue;
          const [d0, d1] = horizontal
            ? [Math.min(from[0], to[0]) - 20, Math.max(from[0], to[0]) + 20]
            : [Math.min(from[1], to[1]) - 20, Math.max(from[1], to[1]) + 20];
          parts = parts.flatMap(([p0, p1]): [number, number][] =>
            d1 <= p0 || d0 >= p1
              ? [[p0, p1]]
              : (
                  [
                    [p0, d0],
                    [d1, p1],
                  ] as [number, number][]
                ).filter(([q0, q1]) => q1 - q0 > 0),
          );
        }
        for (const [lo, hi] of parts) {
          if (hi - lo >= 120 && (!best || hi - lo > best.hi - best.lo)) {
            best = { a: stretch.a, b: stretch.b, lo, hi };
          }
        }
      }
      if (best) {
        const mid = (best.lo + best.hi) / 2;
        const half = Math.min(70, (best.hi - best.lo - 40) / 2);
        const [from, to] = across(best.a, best.b, mid - half, mid + half);
        windows.push({ id: ids.next("window"), from, to, room: roomIds.get(room) });
      }
    }
    const plan: Record<string, unknown> = {
      format: "domotwin-plan",
      version: 1,
      name: storey.name,
      rooms,
      doors,
      windows,
      items: [],
    };
    const budget: Budget = { left: MAX_ELEMENTS - rooms.length - doors.length - windows.length };
    for (const room of flat) {
      const id = roomIds.get(room) ?? "";
      const pieces = [
        ...(choice.devices?.get(room.area.id) ?? []),
        ...(choice.furnish ? furnitureOf(room.kind, room.w, room.d).map((kind) => ({ kind })) : []),
      ];
      const counts = furnish(
        plan,
        id,
        pieces,
        ids,
        bindings.elements,
        roomOf(plan, id, []),
        budget,
      );
      built.devices += counts.devices;
      built.furniture += counts.furniture;
      built.left += counts.left;
    }
    built.rooms += flat.length;
    // Above the ground floor (level 0, else the lowest).
    built.storeys.push({
      name: storey.name,
      elevation: (storey.level - ground) * STOREY_HEIGHT,
      plan,
    });
  }
  return built;
}

/**
 * The floors of Home Assistant as storeys to draw, by level, each with its areas; the areas on no
 * floor go on the ground floor (the one at level 0, else the lowest), or are the only storey,
 * named `home`, when Home Assistant has no floors.
 */
export function homeStoreys(hass: HomeAssistant, home: string): HomeStorey[] {
  // By level, those without one above the others; two at one level one above the other.
  const sorted = Object.values(hass.floors ?? {})
    .filter((floor) => floor !== undefined)
    .sort(
      (a, b) =>
        (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
  const used = new Set<number>();
  const floors = sorted.map((floor) => {
    let level = floor.level ?? (used.size > 0 ? Math.max(...used) + 1 : 0);
    while (used.has(level)) level++;
    used.add(level);
    return { floor, level };
  });
  const storeys = new Map<string, HomeStorey>(
    floors.map(({ floor, level }) => [floor.floor_id, { name: floor.name, level, areas: [] }]),
  );
  const ground =
    floors.find((f) => f.level === 0)?.floor.floor_id ?? floors[0]?.floor.floor_id ?? "";
  if (!storeys.has(ground)) storeys.set(ground, { name: home, level: 0, areas: [] });
  const areas = Object.values(hass.areas ?? {})
    .filter((area) => area !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const area of areas) {
    const floor = area.floor_id && storeys.has(area.floor_id) ? area.floor_id : ground;
    const entry: HomeArea = { id: area.area_id, name: area.name };
    if (area.icon) entry.icon = area.icon;
    storeys.get(floor)?.areas.push(entry);
  }
  return [...storeys.values()].filter((storey) => storey.areas.length > 0);
}

/**
 * What is linked to a piece already, home-wide: its entities, and their devices as
 * `device:<id>` (`devicesByArea` leaves a device out once one of its entities is linked). With
 * `present`, the home's ids, only the links of pieces still there count.
 */
export function linkedEntities(
  hass: HomeAssistant,
  bindings: BindingsJson,
  present?: ReadonlySet<string>,
): Set<string> {
  const linked = new Set<string>();
  for (const [element, binding] of Object.entries(bindings.elements)) {
    // A link whose piece is gone (an earlier plan's) places nothing.
    if (present && !present.has(element)) continue;
    // A piece standing for a device (the network map's, D-031) links all of it.
    if (binding.device) linked.add(`device:${binding.device}`);
    for (const { entity_id } of binding.entities) {
      linked.add(entity_id);
      // A device is placed once one of its entities is linked: its others are not offered.
      const device = hass.entities?.[entity_id]?.device_id;
      if (device) linked.add(`device:${device}`);
    }
  }
  return linked;
}

/**
 * On a plan of one's own, the devices of the areas its rooms are linked to (or named as), each
 * in its room where there is space, linked; those linked already are left as they are. Returns
 * the plan with them (a copy), and the links to add.
 */
export function placeDevices(
  hass: HomeAssistant,
  plan: Record<string, unknown>,
  bindings: BindingsJson,
  taken: Iterable<string>,
  layout: Record<string, unknown> = {},
  present?: ReadonlySet<string>,
): {
  plan: Record<string, unknown>;
  elements: Record<string, ElementBinding>;
  devices: number;
  left: number;
} {
  const copy = structuredClone(plan);
  // Not an id of the plan, its overlay or a link already (a link's piece may be gone).
  const ids = new Ids([
    ...taken,
    ...Object.keys(layout),
    ...Object.keys(bindings.elements),
    ...Object.keys(bindings.rooms),
  ]);
  const linked = linkedEntities(hass, bindings, present);
  const pieces = piecesStanding(copy, layout);
  const budget: Budget = { left: MAX_ELEMENTS - storeyIds(copy, layout).length };
  const elements: Record<string, ElementBinding> = {};
  let placed = 0;
  let left = 0;
  for (const room of planElements(copy).filter((e) => e.type === "room")) {
    const name = typeof room.fields.name === "string" ? room.fields.name : "";
    const area = roomArea(hass, bindings, room.id, name);
    if (!area) continue;
    // Given once, to the first room of its area (`linked` takes them).
    const found = devicesByArea(hass, [area], linked).get(area) ?? [];
    if (found.length === 0) continue;
    const counts = furnish(
      copy,
      room.id,
      found,
      ids,
      elements,
      roomOf(copy, room.id, pieces),
      budget,
    );
    placed += counts.devices;
    left += counts.left;
  }
  return { plan: copy, elements, devices: placed, left };
}

/** A step of getting started (D-083): whether it is done, and how much is left of it. */
export interface StartStep {
  id: "plan" | "shape" | "areas" | "devices" | "arrange" | "people" | "energy";
  /** Done, not done, or a step one does without it being known (shaping, arranging). */
  done?: boolean;
  left?: number;
}

/**
 * The steps of getting started on the plan shown: a plan, its rooms shaped, each linked to its
 * area, their devices placed, the pieces arranged, people placed, the energy chosen.
 */
export function startSteps(
  hass: HomeAssistant,
  plan: unknown,
  bindings: BindingsJson,
  done: { people: boolean; energy: boolean },
  present?: ReadonlySet<string>,
): StartStep[] {
  const rooms = planElements(plan).filter((e) => e.type === "room");
  const areas = new Set<string>();
  let unlinked = 0;
  for (const room of rooms) {
    const name = typeof room.fields.name === "string" ? room.fields.name : "";
    const area = roomArea(hass, bindings, room.id, name);
    if (area) areas.add(area);
    else unlinked++;
  }
  let devices = 0;
  for (const pieces of devicesByArea(hass, areas, linkedEntities(hass, bindings, present)).values())
    devices += pieces.length;
  const any = rooms.length > 0;
  return [
    { id: "plan", done: any },
    { id: "shape" },
    { id: "areas", done: any && unlinked === 0, left: unlinked },
    { id: "devices", done: any && devices === 0, left: devices },
    { id: "arrange" },
    { id: "people", done: done.people },
    { id: "energy", done: done.energy },
  ];
}
