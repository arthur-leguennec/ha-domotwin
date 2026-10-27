/**
 * People in their rooms (`docs/DECISIONS.md`, D-034): the integration places each person from the
 * entities that say where they are, and keeps their room in a sensor of its own
 * (`sensor.domotwin_<person>_room`). The view reads those sensors: who to draw, where, in which
 * colour, and what their sheet says.
 */
import type { HomeAssistant } from "../ha/types";

/** A person placed: the entities that say where they are, their colour. */
export interface PersonSettings {
  sources: string[];
  color?: string;
}

/** The people's settings, as `domotwin/people/get` gives them. */
export interface PeopleSettings {
  revision: number;
  /** Who sees the people. */
  shown: "everyone" | "admins";
  /** How they are drawn. */
  look: "figure" | "pin";
  /** People who hid themselves. */
  hidden: string[];
  /** Each person placed, with their colour and their room sensor; the room sensors of their
   * devices followed by Bluetooth place them too (`located`, D-035). */
  people: Record<string, PersonSettings & { color: string; sensor: string; located?: string[] }>;
  /** Entities that may say where someone is (administrators only). */
  candidates?: { entity: string; person?: string }[];
}

/** A person as the view shows them. */
export interface PersonShown {
  id: string;
  name: string;
  color: string;
  /** Their room in the plans, its storey; undefined when not known. */
  room?: string;
  storey?: string;
  roomName?: string;
  /** When they came into it (ISO), and the entity that said so. */
  since?: string;
  source?: string;
  /** Where in the room, when the locating says (plan cm, D-079). */
  at?: [number, number];
  /** A picture of them on Home Assistant itself, else their initials. */
  picture?: string;
  initials: string;
  /** At home (false: away). */
  home: boolean;
  /** The user viewing is this person. */
  self: boolean;
  /** In a private room the user viewing may not see (D-039): which one is not told. */
  private?: true;
}

/** The letters of a word as people see them (an accent or an emoji is one, where the browser
 * can tell; else by code point). */
function letters(word: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(word);
  return Array.from(new Intl.Segmenter().segment(word), (part) => part.segment);
}

/** The colours people are given, as the integration gives them (`people.COLORS`). */
const COLORS = [
  "#e8508a",
  "#2f9fd8",
  "#e3912b",
  "#3fae5a",
  "#8a63d2",
  "#d8573c",
  "#1ba39c",
  "#c9a227",
] as const;

/** A person's colour when none was chosen: the same as the integration's (`color_of`). */
export function colorOf(person: string): string {
  let total = 0;
  for (const char of person) total = (total * 31 + (char.codePointAt(0) ?? 0)) % 2_147_483_647;
  return COLORS[total % COLORS.length] ?? COLORS[0];
}

/** The person the user viewing is, when placed and hidden: they may show themselves again. */
export function ownHidden(
  settings: PeopleSettings | undefined,
  hass: HomeAssistant,
): string | undefined {
  if (!settings || !hass.user) return undefined;
  return settings.hidden.find(
    (id) => settings.people[id] && hass.states[id]?.attributes.user_id === hass.user?.id,
  );
}

/** Up to two initials of a name ("Alex Martin" → "AM", "Sam" → "SA"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  if (first === undefined) return "?";
  const chosen = last
    ? [letters(first)[0] ?? "", letters(last)[0] ?? ""]
    : letters(first).slice(0, 2);
  return chosen.join("").toLocaleUpperCase();
}

/**
 * A person's picture, only when Home Assistant itself serves it (a path such as
 * `/api/image/serve/…` or `/local/…`): DomoTwin loads nothing from elsewhere (D-022).
 */
export function homePicture(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return undefined;
  return url;
}

/**
 * The people the view shows: those placed and not hidden, at home; nobody for a user who is not an
 * administrator when they are shown to administrators only.
 */
export function peopleShown(
  settings: PeopleSettings | undefined,
  hass: HomeAssistant,
): PersonShown[] {
  if (!settings) return [];
  const admin = hass.user?.is_admin === true;
  if (settings.shown === "admins" && !admin) return [];
  const shown: PersonShown[] = [];
  for (const [id, person] of Object.entries(settings.people)) {
    if (settings.hidden.includes(id)) continue;
    const state = hass.states[id];
    const sensor = hass.states[person.sensor];
    const name =
      typeof state?.attributes.friendly_name === "string"
        ? state.attributes.friendly_name
        : id.slice(id.indexOf(".") + 1);
    const attributes = sensor?.attributes ?? {};
    const text = (key: string): string | undefined => {
      const value = attributes[key];
      return typeof value === "string" ? value : undefined;
    };
    const home = state?.state === "home";
    const entry: PersonShown = {
      id,
      name,
      color: person.color,
      initials: initials(name),
      home,
      self: state?.attributes.user_id !== undefined && state.attributes.user_id === hass.user?.id,
    };
    const picture = homePicture(state?.attributes.entity_picture);
    if (picture) entry.picture = picture;
    const room = text("room_id");
    if (home && room) {
      entry.room = room;
      entry.roomName = sensor?.state;
      const storey = text("storey_id");
      if (storey) entry.storey = storey;
      const since = text("since");
      if (since) entry.since = since;
      const source = text("source");
      if (source) entry.source = source;
      // Where in the room (D-079): metres on the storey's plan, as the room sensor says.
      const [x, y] = [attributes.x, attributes.y];
      if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) {
        entry.at = [Math.round(x * 100), Math.round(y * 100)];
      }
    }
    shown.push(entry);
  }
  return shown.sort((a, b) => a.name.localeCompare(b.name));
}

/** What the engine draws: those in a room, as `setPeople` takes them. */
export function peopleJson(people: PersonShown[], look: PeopleSettings["look"]): string {
  return JSON.stringify(
    people
      .filter((p) => p.room !== undefined)
      .map((p) => ({
        id: p.id,
        room: p.room,
        color: p.color,
        look,
        ...(p.at ? { at: p.at } : {}),
      })),
  );
}

/** The people in each room. */
export function peopleByRoom(people: PersonShown[]): Map<string, PersonShown[]> {
  const rooms = new Map<string, PersonShown[]>();
  for (const person of people) {
    if (!person.room) continue;
    const list = rooms.get(person.room) ?? [];
    list.push(person);
    rooms.set(person.room, list);
  }
  return rooms;
}

/** How many people are on each storey. */
export function peopleByStorey(people: PersonShown[]): Map<string, number> {
  const storeys = new Map<string, number>();
  for (const person of people) {
    if (person.storey) storeys.set(person.storey, (storeys.get(person.storey) ?? 0) + 1);
  }
  return storeys;
}
