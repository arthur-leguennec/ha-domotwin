/**
 * What a shortcut of the Home tab is (`DECISIONS.md`, D-084), and how the integration's answer is
 * read: a module of its own, loaded with the user's choices; what shortcuts do is `shortcuts.ts`,
 * loaded with the Home tab.
 */

/** What a step acts on. */
export type StepKind =
  "lights" | "covers" | "locks" | "climate" | "media" | "vacuum" | "alarm" | "run";

export const STEP_KINDS: readonly StepKind[] = [
  "lights",
  "covers",
  "locks",
  "climate",
  "media",
  "vacuum",
  "alarm",
  "run",
];

/** What a step does, by what it acts on: the first is what a new step does. */
export const STEP_DOES: Readonly<Record<StepKind, readonly string[]>> = {
  lights: ["off", "on", "toggle"],
  covers: ["close", "open", "position"],
  locks: ["lock", "unlock"],
  climate: ["eco", "temperature", "heat", "off"],
  media: ["pause", "off"],
  vacuum: ["start", "dock"],
  alarm: ["arm_away", "arm_home", "arm_night"],
  run: ["run"],
};

/**
 * What a step does that takes a number, and the numbers it takes (the integration's
 * `STEP_VALUES`): a brightness, a position (%), a temperature (°C or °F, a spa's too).
 */
export const STEP_VALUES: Readonly<Record<string, readonly [number, number]>> = {
  "lights:on": [1, 100],
  "covers:position": [0, 100],
  "climate:temperature": [-50, 150],
};

/** The numbers a step takes, if it takes one. */
export function valueRange(step: Pick<Step, "kind" | "do">): readonly [number, number] | undefined {
  return STEP_VALUES[`${step.kind}:${step.do}`];
}

/** What a step does that takes a number: a brightness or a position (%), a temperature. */
export function takesValue(step: Pick<Step, "kind" | "do">): boolean {
  return valueRange(step) !== undefined;
}

/** What a step does that needs its number: a position, a temperature (a lamp may keep its own). */
export function needsValue(step: Pick<Step, "kind" | "do">): boolean {
  return takesValue(step) && !(step.kind === "lights" && step.do === "on");
}

/** The icons a shortcut may have, by name (the component draws them). */
export const SHORTCUT_ICONS = [
  "lights_off",
  "lights_on",
  "blinds_closed",
  "blinds_open",
  "lock",
  "thermostat",
  "music_off",
  "robot",
  "alarm",
  "play",
  "moon",
  "leave",
  "car",
  "battery",
  "power",
  "home",
] as const;
export type ShortcutIcon = (typeof SHORTCUT_ICONS)[number];

/** One thing a shortcut does. */
export interface Step {
  kind: StepKind;
  do: string;
  /** Where: a floor, a room (an area), or the devices chosen; the whole home when none. */
  floor?: string;
  area?: string;
  entities?: string[];
  /** Left out. */
  except?: string[];
  /** A brightness or a position (%), a temperature. */
  value?: number;
}

/** A big button of the Home tab. */
export interface Shortcut {
  id: string;
  name: string;
  icon: ShortcutIcon;
  /** What it does, in order; none for a shortcut that only shows a value. */
  steps: Step[];
  /** An entity whose state it shows (a car's battery); else what its first step acts on. */
  show?: string;
  /** No state shown. */
  quiet?: boolean;
  /** Asked before it acts. */
  confirm?: boolean;
}

/** The integration's limits (its `MAX_SHORTCUTS`, `MAX_STEPS`, `MAX_LISTED`, `MAX_NAME`). */
export const MAX_SHORTCUTS = 24;
export const MAX_STEPS = 6;
export const MAX_LISTED = 50;
export const MAX_NAME = 40;

const ID = /^[a-z0-9]{1,12}$/;
const ENTITY = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/**
 * A name cut to `MAX_NAME` characters as the integration counts them (code points), between two
 * of the characters a reader sees: an emoji of several (a family, a flag) is never cut in two.
 */
export function clipName(name: string): string {
  if (Array.from(name).length <= MAX_NAME) return name;
  const parts =
    typeof Intl.Segmenter === "function"
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name),
          (part) => part.segment,
        )
      : Array.from(name);
  let kept = "";
  let length = 0;
  for (const part of parts) {
    length += Array.from(part).length;
    if (length > MAX_NAME) break;
    kept += part;
  }
  return kept;
}

function isIcon(value: unknown): value is ShortcutIcon {
  return typeof value === "string" && (SHORTCUT_ICONS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is StepKind {
  return typeof value === "string" && (STEP_KINDS as readonly string[]).includes(value);
}

function entityList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((id): id is string => typeof id === "string"))]
    .filter((id) => ENTITY.test(id))
    .slice(0, MAX_LISTED);
  return ids.length > 0 ? ids : undefined;
}

function readStep(raw: unknown): Step | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (!isKind(value.kind) || typeof value.do !== "string") return undefined;
  if (!STEP_DOES[value.kind].includes(value.do)) return undefined;
  const step: Step = { kind: value.kind, do: value.do };
  if (typeof value.floor === "string" && value.floor !== "") step.floor = value.floor;
  if (typeof value.area === "string" && value.area !== "") step.area = value.area;
  const entities = entityList(value.entities);
  if (entities) step.entities = entities;
  const except = entityList(value.except);
  if (except) step.except = except;
  // A number where one is taken, in its range; needed for a position or a temperature.
  const range = valueRange(step);
  if (range && typeof value.value === "number" && Number.isFinite(value.value)) {
    if (value.value < range[0] || value.value > range[1]) return undefined;
    step.value = value.value;
  }
  if (needsValue(step) && step.value === undefined) return undefined;
  // A scene or a script to run is chosen; it is never every one of the home.
  if (step.kind === "run" && !step.entities) return undefined;
  return step;
}

/** A shortcut the integration answered, what is not understood left out. */
export function readShortcut(raw: unknown): Shortcut | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !ID.test(value.id)) return undefined;
  if (typeof value.name !== "string" || value.name.trim() === "") return undefined;
  const steps = (Array.isArray(value.steps) ? (value.steps as unknown[]) : [])
    .map(readStep)
    .filter((step): step is Step => step !== undefined)
    .slice(0, MAX_STEPS);
  const show = typeof value.show === "string" && ENTITY.test(value.show) ? value.show : undefined;
  // Something to do, or something to show.
  if (steps.length === 0 && !show) return undefined;
  const shortcut: Shortcut = {
    id: value.id,
    name: clipName(value.name),
    icon: isIcon(value.icon) ? value.icon : "play",
    steps,
  };
  if (show) shortcut.show = show;
  if (value.quiet === true) shortcut.quiet = true;
  if (value.confirm === true) shortcut.confirm = true;
  return shortcut;
}

/** The shortcuts the integration answered, each id once. */
export function readShortcuts(raw: unknown): Shortcut[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const shortcuts: Shortcut[] = [];
  for (const item of raw) {
    const shortcut = readShortcut(item);
    if (!shortcut || ids.has(shortcut.id)) continue;
    ids.add(shortcut.id);
    shortcuts.push(shortcut);
  }
  return shortcuts.slice(0, MAX_SHORTCUTS);
}

/**
 * One change to the shortcuts, as the integration takes it: one at a time, so that two devices do
 * not undo each other's (the integration's `domotwin/choices/shortcut`). `set` replaces the
 * shortcut of its id or adds it last; `move` takes one a place earlier (-1) or later (1).
 */
export type ShortcutChange = { set: Shortcut } | { remove: string } | { move: string; by: -1 | 1 };

/** The shortcuts once a change is made, as the integration makes it. */
export function changeShortcuts(list: readonly Shortcut[], change: ShortcutChange): Shortcut[] {
  if ("set" in change) {
    const at = list.findIndex((s) => s.id === change.set.id);
    if (at >= 0) return list.map((s, i) => (i === at ? change.set : s));
    return list.length < MAX_SHORTCUTS ? [...list, change.set] : [...list];
  }
  if ("remove" in change) return list.filter((s) => s.id !== change.remove);
  const moved = [...list];
  const at = moved.findIndex((s) => s.id === change.move);
  const to = at + change.by;
  const [one, other] = [moved[at], moved[to]];
  if (at < 0 || !one || !other) return moved;
  moved[at] = other;
  moved[to] = one;
  return moved;
}
