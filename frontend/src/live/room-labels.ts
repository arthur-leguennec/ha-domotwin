/**
 * The rooms' names over the view (`docs/DECISIONS.md`, D-045): each with an icon for its kind of
 * room, read from its name. Small rooms (closets, rooms under 2.5 m²) are left out unless asked
 * for. Names that would cover one another give way to the bigger rooms: a name that does not fit
 * keeps only its icon, and an icon that does not fit either is left out.
 */

import { nameWords } from "./text";

/** The kinds of room an icon is drawn for. */
export type RoomKind =
  | "kitchen"
  | "living"
  | "dining"
  | "bedroom"
  | "bathroom"
  | "toilet"
  | "office"
  | "laundry"
  | "hall"
  | "closet"
  | "garage"
  | "stairs"
  | "outdoor"
  | "room";

/**
 * Words naming each kind (lower case, without accents; a few of several words), in the languages
 * DomoTwin speaks. The first word of a room's name that names a kind gives it: "Salle de bains /
 * WC" is a bathroom, "Dégagement WC" a hall, "Chambre avec dressing" a bedroom.
 */
const WORDS: readonly (readonly [RoomKind, readonly string[]])[] = [
  ["closet", ["placard", "dressing", "closet", "cupboard", "rangement", "storage", "penderie"]],
  ["toilet", ["wc", "w c", "toilette", "toilettes", "toilet", "toilets", "restroom", "lavatory"]],
  [
    "bathroom",
    [
      "salle de bain",
      "salle de bains",
      "salle d eau",
      "bain",
      "bains",
      "sdb",
      "sde",
      "douche",
      "bathroom",
      "bath",
      "shower",
      "ensuite",
      "en suite",
    ],
  ],
  ["kitchen", ["cuisine", "kitchen", "kitchenette"]],
  ["dining", ["salle a manger", "dining"]],
  ["living", ["salon", "sejour", "piece de vie", "living", "lounge", "family room"]],
  ["bedroom", ["chambre", "bedroom", "nursery", "dortoir"]],
  ["office", ["bureau", "office", "study", "atelier", "workshop"]],
  ["laundry", ["buanderie", "laundry", "cellier", "utility", "lingerie"]],
  [
    "hall",
    ["couloir", "degagement", "dgt", "entree", "hall", "hallway", "corridor", "palier", "landing"],
  ],
  ["garage", ["garage", "carport"]],
  ["stairs", ["escalier", "stairs", "staircase"]],
  ["outdoor", ["jardin", "terrasse", "balcon", "garden", "terrace", "balcony", "patio", "loggia"]],
];

/** The words naming a kind, each as its words, the longest first. */
const PHRASES: readonly (readonly [RoomKind, readonly string[]])[] = WORDS.flatMap(
  ([kind, names]) => names.map((name) => [kind, name.split(" ")] as const),
).sort((a, b) => b[1].length - a[1].length);

/** Below this floor area (m²), a room is small: its name is shown only when asked for. */
export const SMALL_ROOM_M2 = 2.5;

/** The kinds of the names read, a name's kind being read once. */
const KINDS = new Map<string, RoomKind>();

/** The kind of a room, from its name ("room" when nothing in it says). */
export function roomKind(name: string): RoomKind {
  let kind = KINDS.get(name);
  if (kind) return kind;
  // "Chambre2" is "chambre 2".
  const said = nameWords(name)
    .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, "$1$3 $2$4")
    .split(" ");
  kind = "room";
  find: for (let at = 0; at < said.length; at++) {
    for (const [named, phrase] of PHRASES) {
      if (phrase.every((word, i) => said[at + i] === word)) {
        kind = named;
        break find;
      }
    }
  }
  if (KINDS.size > 1000) KINDS.clear();
  KINDS.set(name, kind);
  return kind;
}

/** A room's name where the engine puts it (CSS pixels of the view), and its floor area (m²). */
export interface RoomLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  area?: number;
}

/** A name placed: with its kind, and whether only its icon fits (`compact`). */
export interface PlacedLabel extends RoomLabel {
  kind: RoomKind;
  compact: boolean;
}

/** The widest a name is drawn (CSS pixels), cut with an ellipsis past it (as the view's CSS). */
export const NAME_MAX_PX = 240;

/** About how wide a character is in 12 px semi-bold (the bundled font and the usual ones). */
function charWidth(char: string): number {
  if (char === " ") return 3.4;
  if ("iljtfrI.,'’-".includes(char)) return 4.2;
  if ("mwMW".includes(char)) return 11.2;
  if ((char.codePointAt(0) ?? 0) >= 0x2e80) return 12.5; // Chinese, Japanese, Korean
  return /[\p{Lu}\p{N}]/u.test(char) ? 8.5 : 6.9;
}

/**
 * About how wide a name's text is drawn (CSS pixels), from its letters as the bundled font draws
 * them (measured in Chromium), a little more for fonts a little wider. The view measures its own
 * font instead.
 */
export function textWidth(name: string): number {
  let width = 0;
  for (const char of name) width += charWidth(char);
  return width * 1.05;
}

/**
 * How much room a name takes: its padding and border, its icon and the gap, its text, no wider
 * than `max`. Only the icon: a square.
 */
export function labelSize(
  name: string,
  compact: boolean,
  max = NAME_MAX_PX,
  measure: (name: string) => number = textWidth,
): [number, number] {
  return compact ? [26, 26] : [Math.min(max, 39 + measure(name)), 24];
}

/** The room a name shown keeps from the others and the view's edges (CSS pixels)… */
const KEEP_GAP = 4;
/** …and the room a name needs to be shown, or shown whole: more, so that names do not come and
 * go as the camera moves. */
const NEW_GAP = 12;

/** Where to place the names. */
export interface LabelView {
  width: number;
  height: number;
  /** The small rooms' names too. */
  small: boolean;
  /** How wide a name's text is drawn (CSS pixels); reckoned from its letters without it. */
  measure?: (name: string) => number;
  /** The names shown before: whole (`false`) or their icon alone (`true`). */
  before?: ReadonlyMap<string, boolean>;
}

/**
 * The names to show: small rooms left out unless `small`, the bigger rooms first, each with its
 * name where it covers no other, else its icon alone, else left out. Names outside the view are
 * left out too. A name is no wider than 40 % of the view (as the view's CSS). A name keeps how it
 * was shown while it covers nothing; to be shown, or shown whole, it needs more room around it.
 */
export function placeLabels(labels: readonly RoomLabel[], view: LabelView): PlacedLabel[] {
  const widest = Math.min(NAME_MAX_PX, view.width * 0.4);
  const taken: [number, number, number, number][] = [];
  const free = (
    x: number,
    y: number,
    [w, h]: [number, number],
    gap: number,
  ): [number, number, number, number] | undefined => {
    const box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    const [left, top, right, bottom] = [box[0] - gap, box[1] - gap, box[2] + gap, box[3] + gap];
    if (left < 0 || top < 0 || right > view.width || bottom > view.height) return undefined;
    const covers = taken.some((t) => left < t[2] && t[0] < right && top < t[3] && t[1] < bottom);
    return covers ? undefined : box;
  };
  const placed: PlacedLabel[] = [];
  const ordered = labels
    .map((label) => ({ label, kind: roomKind(label.name), area: label.area ?? 0 }))
    .filter(
      ({ label, kind, area }) =>
        label.name !== "" &&
        (view.small || (kind !== "closet" && (area === 0 || area >= SMALL_ROOM_M2))),
    )
    .sort((a, b) => b.area - a.area);
  for (const { label, kind } of ordered) {
    const before = view.before?.get(label.id);
    const size = labelSize(label.name, false, widest, view.measure);
    const whole = free(label.x, label.y, size, before === false ? KEEP_GAP : NEW_GAP);
    const box =
      whole ??
      free(
        label.x,
        label.y,
        labelSize(label.name, true),
        before === undefined ? NEW_GAP : KEEP_GAP,
      );
    if (!box) continue;
    taken.push(box);
    placed.push({ ...label, kind, compact: !whole });
  }
  return placed;
}
