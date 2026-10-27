/**
 * The configuration history (D-062): each change of an automation, a script, a scene or a
 * dashboard, kept by the integration; what changed between two versions, in words where it can;
 * one item put back through Home Assistant's own configuration commands.
 */
import type { HomeAssistant } from "../ha/types";
import { isEntityId } from "../ha/types";
import type { MessageKey, Translator } from "../i18n";
import { unaccented } from "./text";

export type ConfigKind = "automation" | "script" | "scene" | "dashboard";
export const CONFIG_KINDS: readonly ConfigKind[] = ["automation", "script", "scene", "dashboard"];

/** An item kept, as `domotwin/config_history/list` gives it. */
export interface ConfigItem {
  /** `<kind>:<key>`. */
  id: string;
  kind: ConfigKind;
  /** Its id (an automation's, a scene's), its key (a script's), its URL path (a dashboard's,
   * empty for the default one). */
  key: string;
  name: string | null;
  /** `editor`: written by Home Assistant's editors; `yaml`: in one's own YAML files. */
  source: "editor" | "yaml";
  /** Its newest version says it is no longer there. */
  removed: boolean;
  versions: number;
  /** When its newest version was kept (ISO). */
  changed: string;
}

/** A version of an item, as `domotwin/config_history/item` gives it. */
export interface ConfigVersion {
  id: number;
  at: string;
  removed: boolean;
  /** Its configuration is kept (not when removed, nor when too large to keep). */
  kept: boolean;
  /** The id of an earlier version it is the same as (put back, or changed back). */
  same_as?: number;
}

export interface ConfigList {
  items: ConfigItem[];
  /** The room the versions take, and the most they may (bytes). */
  bytes: number;
  max_bytes: number;
}

export interface ConfigDetail {
  item: ConfigItem;
  /** Newest first. */
  versions: ConfigVersion[];
}

export function configHistoryList(hass: HomeAssistant): Promise<ConfigList> {
  return hass.connection.sendMessagePromise<ConfigList>({ type: "domotwin/config_history/list" });
}

export function configHistoryItem(hass: HomeAssistant, item: string): Promise<ConfigDetail> {
  return hass.connection.sendMessagePromise<ConfigDetail>({
    type: "domotwin/config_history/item",
    item,
  });
}

/** A version's configuration; null when it was removed or too large to keep. */
export async function configHistoryVersion(
  hass: HomeAssistant,
  item: string,
  version: number,
): Promise<unknown> {
  const result = await hass.connection.sendMessagePromise<{ config: unknown }>({
    type: "domotwin/config_history/version",
    item,
    version,
  });
  return result.config;
}

/**
 * Puts a configuration back with the commands Home Assistant's editors use: its configuration
 * API (which checks it, writes the file and reloads) or `lovelace/config/save`.
 */
export async function putBack(
  hass: HomeAssistant,
  item: ConfigItem,
  config: unknown,
): Promise<void> {
  if (item.kind === "dashboard") {
    await hass.connection.sendMessagePromise({
      type: "lovelace/config/save",
      config,
      ...(item.key ? { url_path: item.key } : {}),
    });
  } else {
    if (!hass.callApi) throw new Error("callApi");
    await hass.callApi(
      "POST",
      `config/${item.kind}/config/${encodeURIComponent(item.key)}`,
      config as Record<string, unknown>,
    );
  }
}

/** Has the integration read a kind again now (after an item was put back): the versions kept. */
export async function refreshConfigHistory(hass: HomeAssistant, kind: ConfigKind): Promise<number> {
  const result = await hass.connection.sendMessagePromise<{ changed: number }>({
    type: "domotwin/config_history/refresh",
    kind,
  });
  return result.changed;
}

/**
 * What Home Assistant answered when it refused: its configuration API's message (`{ body }`), or
 * its websocket's (`{ code, message }`).
 */
export function refusal(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || error instanceof Error) return undefined;
  const { body, message } = error as { body?: unknown; message?: unknown };
  if (typeof body === "object" && body !== null) {
    const said = (body as { message?: unknown }).message;
    if (typeof said === "string" && said) return said;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return typeof message === "string" && message ? message : undefined;
}

/** Whether a version can be put back: not the current one, nor what Home Assistant cannot take. */
export function canPutBack(
  item: ConfigItem,
  version: ConfigVersion,
  newest: ConfigVersion | undefined,
): boolean {
  if (item.source !== "editor" || !version.kept || version.removed) return false;
  if (newest?.id === version.id) return false;
  // A removed dashboard: Home Assistant has no dashboard to save it in.
  return !(item.kind === "dashboard" && item.removed);
}

/** The page of Home Assistant for the item: its editor, or the dashboard. */
export function editorPath(item: ConfigItem): string | undefined {
  if (item.removed) return undefined;
  if (item.kind === "dashboard") return `/${item.key || "lovelace"}`;
  if (item.source !== "editor") return undefined;
  return `/config/${item.kind}/edit/${encodeURIComponent(item.key)}`;
}

/** The items of a kind (every kind without one) whose name or key holds every word searched. */
export function filterItems(
  items: readonly ConfigItem[],
  kind: ConfigKind | undefined,
  search: string,
): ConfigItem[] {
  const words = unaccented(search).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    const text = unaccented(`${item.name ?? ""} ${item.key}`);
    return words.every((word) => text.includes(word));
  });
}

// What changed between two versions.

export type Path = readonly (string | number)[];

/**
 * A change: something added, removed or changed at a place of the configuration. `element`: a
 * value added to or removed from a list of plain values (the entities of an action), at the list.
 */
export interface Change {
  op: "add" | "remove" | "change";
  path: Path;
  before?: unknown;
  after?: unknown;
  element?: boolean;
}

/** At most this many changes are said; the rest are counted. */
export const MAX_CHANGES = 200;
/** Lists longer than this together are compared item by item rather than matched. */
const MAX_MATCHED = 40_000;
/** The keys that say what sort a trigger, a condition, an action or a card is. */
const SORT_KEYS = ["trigger", "platform", "condition", "action", "service", "type"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlain(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** The JSON of a value with its keys sorted: two values are the same when theirs are. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => same(value, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
    );
  }
  return false;
}

/** What sort a list item is (`state`, `light.turn_on`, `tile`…): two of a sort are compared. */
function sortOf(value: unknown): string | undefined {
  if (!isObject(value)) return typeof value;
  for (const key of SORT_KEYS) {
    if (typeof value[key] === "string") return `${key}:${value[key]}`;
  }
  return undefined;
}

/** The changes from `before` to `after`, at most `MAX_CHANGES`, and how many more there were. */
export function changesBetween(
  before: unknown,
  after: unknown,
): { changes: Change[]; more: number } {
  const changes: Change[] = [];
  walk(before, after, [], changes);
  return {
    changes: changes.slice(0, MAX_CHANGES),
    more: Math.max(0, changes.length - MAX_CHANGES),
  };
}

function walk(before: unknown, after: unknown, path: Path, out: Change[]): void {
  if (same(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    walkList(before, after, path, out);
  } else if (isObject(before) && isObject(after)) {
    const keys = [
      ...Object.keys(after),
      ...Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
    ];
    for (const key of keys) {
      if (!Object.hasOwn(before, key)) {
        out.push({ op: "add", path: [...path, key], after: after[key] });
      } else if (!Object.hasOwn(after, key)) {
        out.push({ op: "remove", path: [...path, key], before: before[key] });
      } else walk(before[key], after[key], [...path, key], out);
    }
  } else {
    out.push({ op: "change", path, before, after });
  }
}

function walkList(before: unknown[], after: unknown[], path: Path, out: Change[]): void {
  // A list of plain values (entities, days): what was added and what was taken away.
  if (before.every(isPlain) && after.every(isPlain)) {
    const notMatched = before.map(canonical);
    const added = after.filter((value) => !takeOne(notMatched, canonical(value)));
    const pool = after.map(canonical);
    const removed = before.filter((value) => !takeOne(pool, canonical(value)));
    for (const value of removed) out.push({ op: "remove", path, before: value, element: true });
    for (const value of added) out.push({ op: "add", path, after: value, element: true });
    if (added.length === 0 && removed.length === 0) out.push({ op: "change", path, before, after });
    return;
  }
  const pairs = match(before.map(canonical), after.map(canonical));
  let b = 0;
  let a = 0;
  for (const [nextB, nextA] of [...pairs, [before.length, after.length] as const]) {
    gap(before.slice(b, nextB), b, after.slice(a, nextA), a, path, out);
    b = nextB + 1;
    a = nextA + 1;
  }
}

/** Takes one value equal to `value` out of `values`; whether there was one. */
function takeOne(values: string[], value: string): boolean {
  const index = values.indexOf(value);
  if (index < 0) return false;
  values.splice(index, 1);
  return true;
}

/** The items the same in both lists, in order (their indexes), the most of them. */
function match(left: string[], right: string[]): [number, number][] {
  const n = left.length;
  const m = right.length;
  if (n * m > MAX_MATCHED) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < Math.min(n, m); i++) if (left[i] === right[i]) pairs.push([i, i]);
    return pairs;
  }
  // The longest common subsequence, from the end.
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i] as number[];
    const below = table[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        left[i] === right[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

/**
 * Two items alike: of a sort, and, when both say more, the same in one thing at least (a view's
 * title, a card's entity). An item edited in place is compared with what it was, rather than a
 * neighbour removed beside it.
 */
function akin(a: unknown, b: unknown): boolean {
  if (sortOf(a) !== sortOf(b)) return false;
  if (!isObject(a) || !isObject(b)) return true;
  const shared = Object.keys(a).filter((key) => !SORT_KEYS.includes(key) && Object.hasOwn(b, key));
  return shared.length === 0 || shared.some((key) => same(a[key], b[key]));
}

/**
 * Items between two matched ones: those of a sort compared with each other, in order, unless one
 * of them is akin to an item further on; the others removed or added. Their places are the
 * after's, but for what was removed.
 */
function gap(
  before: unknown[],
  beforeAt: number,
  after: unknown[],
  afterAt: number,
  path: Path,
  out: Change[],
): void {
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const left = before[i];
    const right = after[j];
    const both = i < before.length && j < after.length;
    if (both && sortOf(left) === sortOf(right) && !akin(left, right)) {
      // A neighbour removed or added beside an item edited: the item goes with its like.
      if (before.slice(i + 1).some((item) => akin(item, right))) {
        out.push({ op: "remove", path: [...path, beforeAt + i], before: left });
        i++;
        continue;
      }
      if (after.slice(j + 1).some((item) => akin(left, item))) {
        out.push({ op: "add", path: [...path, afterAt + j], after: right });
        j++;
        continue;
      }
    }
    if (both && sortOf(left) === sortOf(right)) {
      walk(left, right, [...path, afterAt + j], out);
      i++;
      j++;
    } else if (
      i < before.length &&
      (j >= after.length || !after.slice(j).some((item) => sortOf(item) === sortOf(before[i])))
    ) {
      out.push({ op: "remove", path: [...path, beforeAt + i], before: before[i] });
      i++;
    } else {
      out.push({ op: "add", path: [...path, afterAt + j], after: after[j] });
      j++;
    }
  }
}

// In words.

/** A change said: what was done, where, and the values. */
export interface ChangeWords {
  op: Change["op"];
  place: string;
  text: string;
}

/** The lists whose items are numbered, by their key, and the word of an item. */
const LISTS = new Map<string, MessageKey>(
  Object.entries({
    triggers: "config_history.place.trigger",
    trigger: "config_history.place.trigger",
    conditions: "config_history.place.condition",
    condition: "config_history.place.condition",
    actions: "config_history.place.action",
    action: "config_history.place.action",
    sequence: "config_history.place.step",
    then: "config_history.place.action",
    else: "config_history.place.action",
    default: "config_history.place.action",
    choose: "config_history.place.choice",
    options: "config_history.place.option",
    views: "config_history.place.view",
    cards: "config_history.place.card",
    sections: "config_history.place.section",
    badges: "config_history.place.badge",
  } as const),
);

/** The fields said in words, by their key. */
const FIELDS = new Map<string, MessageKey>(
  Object.entries({
    alias: "config_history.field.name",
    name: "config_history.field.name",
    title: "config_history.field.title",
    description: "config_history.field.description",
    mode: "config_history.field.mode",
    max: "config_history.field.max",
    icon: "config_history.field.icon",
    variables: "config_history.field.variables",
    fields: "config_history.field.fields",
    use_blueprint: "config_history.field.blueprint",
    entities: "config_history.field.entities",
    path: "config_history.field.path",
    triggers: "config_history.field.triggers",
    trigger: "config_history.field.triggers",
    conditions: "config_history.field.conditions",
    condition: "config_history.field.conditions",
    actions: "config_history.field.actions",
    action: "config_history.field.actions",
    sequence: "config_history.field.sequence",
    views: "config_history.field.views",
    cards: "config_history.field.cards",
  } as const),
);

/** The name Home Assistant gives an entity, else its id. */
function entityName(hass: HomeAssistant | undefined, id: string): string {
  const name = hass?.states[id]?.attributes.friendly_name;
  return typeof name === "string" && name ? name : id;
}

function at(root: unknown, path: Path): unknown {
  let node = root;
  for (const part of path) {
    if (Array.isArray(node) && typeof part === "number") node = node[part];
    else if (isObject(node) && typeof part === "string") node = node[part];
    else return undefined;
  }
  return node;
}

/** Where a change is, in words: "Action 2 › data › brightness", "View “Kitchen” › Card 3". */
export function placeOf(
  t: Translator,
  kind: ConfigKind,
  change: Change,
  before: unknown,
  after: unknown,
  hass?: HomeAssistant,
): string {
  const parts: string[] = [];
  change.path.forEach((part, index) => {
    const parent = change.path[index - 1];
    if (typeof part === "number") {
      // Items compared are at their places in the after; an item removed, at its place before.
      const root = change.op === "remove" && index === change.path.length - 1 ? before : after;
      // An item of a list: "Action 2" rather than "Actions › 2".
      const list = typeof parent === "string" ? LISTS.get(parent) : undefined;
      const last = parts.pop() ?? "";
      let label = list ? t.t(list, { n: part + 1 }) : `${last} ${part + 1}`.trim();
      const title = (at(root, change.path.slice(0, index + 1)) as { title?: unknown } | undefined)
        ?.title;
      if (parent === "views" && typeof title === "string" && title) {
        label = t.t("config_history.place.view_named", { title });
      }
      parts.push(label);
    } else if (kind === "scene" && index === 1 && parent === "entities") {
      // A scene's entity, by its name.
      parts[parts.length - 1] = entityName(hass, part);
    } else {
      const field = FIELDS.get(part);
      parts.push(field ? t.t(field) : part);
    }
  });
  return parts.length ? parts.join(" › ") : t.t("config_history.place.all");
}

/** A value in short: “a text”, a number, yes or no, an entity's name, a list, what an item is. */
export function sayValue(t: Translator, value: unknown, hass?: HomeAssistant): string {
  if (value === undefined || value === null) return t.t("config_history.value.none");
  if (typeof value === "boolean")
    return t.t(value ? "config_history.value.yes" : "config_history.value.no");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (isEntityId(value)) return entityName(hass, value);
    return `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return t.t("config_history.value.empty");
    const said = value.slice(0, 3).map((item) => sayValue(t, item, hass));
    return value.length > 3
      ? t.t("config_history.value.more", { items: said.join(", "), count: value.length - 3 })
      : said.join(", ");
  }
  if (!isObject(value)) return t.t("config_history.value.none");
  return sayItem(t, value, hass);
}

/** What a trigger, an action, a card or a scene's entity is: its sort, entities and settings. */
function sayItem(t: Translator, item: Record<string, unknown>, hass?: HomeAssistant): string {
  const parts: string[] = [];
  const named = item.alias ?? item.title ?? item.name;
  if (typeof named === "string" && named) parts.push(`“${named}”`);
  const sort = SORT_KEYS.map((key) => item[key]).find((value) => typeof value === "string");
  if (typeof sort === "string") parts.push(sort);
  if (typeof item.state === "string" && !sort) parts.push(item.state);
  const target = isObject(item.target) ? item.target : {};
  const entities = [item.entity_id, item.entity, target.entity_id]
    .flatMap((value) => (Array.isArray(value) ? (value as unknown[]) : [value]))
    .filter((value): value is string => typeof value === "string");
  if (entities.length) parts.push(sayValue(t, entities, hass));
  const shown = new Set([
    ...SORT_KEYS,
    "alias",
    "title",
    "name",
    "state",
    "entity_id",
    "entity",
    "target",
    "id",
  ]);
  const settings = Object.entries(item)
    .filter(([key, value]) => !shown.has(key) && isPlain(value) && value !== null)
    .slice(0, 3)
    .map(([key, value]) => `${key} ${sayValue(t, value, hass)}`);
  const said = parts.join(" · ");
  if (settings.length) return said ? `${said} (${settings.join(", ")})` : settings.join(", ");
  return said || t.tp("config_history.value.settings", Object.keys(item).length);
}

/** A change in words. */
export function sayChange(
  t: Translator,
  kind: ConfigKind,
  change: Change,
  before: unknown,
  after: unknown,
  hass?: HomeAssistant,
): ChangeWords {
  const place = placeOf(t, kind, change, before, after, hass);
  const text =
    change.op === "change"
      ? t.t("config_history.value.from_to", {
          before: sayValue(t, change.before, hass),
          after: sayValue(t, change.after, hass),
        })
      : sayValue(t, change.op === "add" ? change.after : change.before, hass);
  return { op: change.op, place, text };
}

/** The name of an item: its own, else what it is (the default dashboard), else its key. */
export function itemName(t: Translator, item: ConfigItem): string {
  if (item.name) return item.name;
  if (item.kind === "dashboard" && !item.key) return t.t("config_history.default_dashboard");
  return item.key;
}
