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

/** What a step does that takes a number: a brightness or a position (%), a temperature. */
export function takesValue(step: Pick<Step, "kind" | "do">): boolean {
  return (
    (step.kind === "lights" && step.do === "on") ||
    (step.kind === "covers" && step.do === "position") ||
    (step.kind === "climate" && step.do === "temperature")
  );
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
 * A name cut to `MAX_NAME` characters, as the integration counts them (code points): an emoji is
 * never cut in two.
 */
export function clipName(name: string): string {
  return Array.from(name).slice(0, MAX_NAME).join("");
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
  if (typeof value.value === "number" && Number.isFinite(value.value)) step.value = value.value;
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
