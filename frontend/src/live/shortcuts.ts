/**
 * Shortcuts (`DECISIONS.md`, D-084): big buttons on the Home tab, each the user's own, that act on
 * a group of devices in one press (every lamp of the home off, the shutters closed, the heating in
 * eco) or show what one says (a car's battery), and show their state. Suggested from the home's
 * devices, then adjusted: where (the home, a floor, a room, devices chosen), what is left out, a
 * brightness, a position, a temperature, several steps (good night), a question first. Kept by the
 * integration with the user's choices (D-055); they act as the user, on what the user's rights let
 * them use (D-071), and leave alone what they may not see (D-039).
 */
import { domainOf, type HomeAssistant } from "../ha/types";
import type { MessageKey, PluralKey, Translator } from "../i18n";
import { areaOf, entityName, shownEntity } from "./bindings";
import { NOTHING_UNSEEN, seen, type Unseen } from "./privacy";
import { NOT_BLINDS, OPEN_CLOSE, TURN_OFF } from "./room-actions";
import { clipName, type Shortcut, type Step, type StepKind } from "./shortcut-model";

export {
  changeShortcuts,
  clipName,
  MAX_LISTED,
  MAX_NAME,
  MAX_SHORTCUTS,
  MAX_STEPS,
  SHORTCUT_ICONS,
  STEP_DOES,
  STEP_KINDS,
  needsValue,
  readShortcut,
  readShortcuts,
  STEP_VALUES,
  takesValue,
  valueRange,
  type Shortcut,
  type ShortcutChange,
  type ShortcutIcon,
  type Step,
  type StepKind,
} from "./shortcut-model";

/** A new shortcut's id, none of `taken`. */
export function newId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    const id = Math.floor(random() * 36 ** 8)
      .toString(36)
      .padStart(8, "0");
    if (!used.has(id)) return id;
  }
}

// What a step acts on.

/** `CoverEntityFeature.SET_POSITION`; `MediaPlayerEntityFeature.PAUSE`. */
const SET_POSITION = 4;
const MEDIA_PAUSE = 1;
/** `ClimateEntityFeature`: one target temperature, presets. */
const TARGET_TEMPERATURE = 1;
const PRESET_MODE = 16;
/** `VacuumEntityFeature`: back to its dock, start. */
const RETURN_HOME = 16;
const START = 8192;
/** `AlarmControlPanelEntityFeature`, by what a step arms. */
const ARM: Readonly<Record<string, number>> = { arm_home: 1, arm_away: 2, arm_night: 4 };

/** What a step of each kind may run. */
const RUNNABLE = new Set(["scene", "script", "button", "input_button"]);

const DOMAINS: Readonly<Record<StepKind, readonly string[]>> = {
  lights: ["light"],
  covers: ["cover"],
  locks: ["lock"],
  climate: ["climate"],
  media: ["media_player"],
  vacuum: ["vacuum"],
  alarm: ["alarm_control_panel"],
  run: [...RUNNABLE],
};

/** Covers that are not shutters nor blinds: a garage door, a gate, a door, a window, a skylight. */
const NOT_SHUTTERS: ReadonlySet<string> = new Set([...NOT_BLINDS, "window"]);

/** A light that groups others (a light group, a Hue room): its lamps count, not it. */
function groupsLights(hass: HomeAssistant, id: string): boolean {
  const members = hass.states[id]?.attributes.entity_id;
  return Array.isArray(members) && members.length > 0;
}

function features(hass: HomeAssistant, id: string): number {
  return Number(hass.states[id]?.attributes.supported_features ?? 0);
}

/** Whether an entity is one a step of this kind acts on (a blind, not a garage door). */
export function fits(hass: HomeAssistant, kind: StepKind, id: string): boolean {
  const state = hass.states[id];
  if (!state || !DOMAINS[kind].includes(domainOf(id))) return false;
  switch (kind) {
    case "lights":
      return !groupsLights(hass, id);
    case "covers": {
      const deviceClass = state.attributes.device_class;
      return (
        !(typeof deviceClass === "string" && NOT_SHUTTERS.has(deviceClass)) &&
        (features(hass, id) & OPEN_CLOSE) === OPEN_CLOSE
      );
    }
    default:
      return true;
  }
}

/** The floor of an entity, by its area. */
function floorOf(hass: HomeAssistant, id: string): string | undefined {
  const area = areaOf(hass, id);
  return area ? (hass.areas?.[area]?.floor_id ?? undefined) : undefined;
}

/** The candidates of each kind, worked out once for each of Home Assistant's states. */
const CANDIDATES = new WeakMap<
  object,
  { entities: unknown; kinds: Map<StepKind, readonly string[]> }
>();

/**
 * Every entity of the home a step of this kind may act on, sorted: those Home Assistant has,
 * neither hidden nor a configuration or diagnostic one. Worked out once for each of Home
 * Assistant's states (each button of the Home tab asks at each of them).
 */
export function candidates(hass: HomeAssistant, kind: StepKind): readonly string[] {
  let known = CANDIDATES.get(hass.states);
  if (known === undefined || known.entities !== hass.entities) {
    known = { entities: hass.entities, kinds: new Map() };
    CANDIDATES.set(hass.states, known);
  }
  let ids = known.kinds.get(kind);
  if (!ids) {
    ids = Object.keys(hass.states)
      .filter((id) => shownEntity(hass, id) && fits(hass, kind, id))
      .sort();
    known.kinds.set(kind, ids);
  }
  return ids;
}

/** Whether the viewer may see an entity (D-039) and use it (D-071). */
export function usable(hass: HomeAssistant, id: string, unseen: Unseen): boolean {
  return seen(unseen, id, areaOf(hass, id)) && (!hass.canAct || hass.canAct(id));
}

/** A usual temperature for heating, in the home's unit. */
export function usualTemperature(hass: HomeAssistant): number {
  return hass.config?.unit_system?.temperature === "°F" ? 66 : 19;
}

/** Whether an entity is in a step's place: its floor, its room, or among those chosen. */
export function inPlace(hass: HomeAssistant, step: Step, id: string): boolean {
  if (step.entities) return step.entities.includes(id);
  if (step.area) return areaOf(hass, id) === step.area;
  if (step.floor) return floorOf(hass, id) === step.floor;
  return true;
}

/**
 * Whether a step does something to this entity now: what Home Assistant would refuse for it is
 * not asked (eco of a thermostat without it, a night arming the alarm cannot do), as a call that
 * names one entity that cannot is refused whole.
 */
function capable(hass: HomeAssistant, step: Step, id: string): boolean {
  const attributes = hass.states[id]?.attributes ?? {};
  const has = (flag: number): boolean => (features(hass, id) & flag) === flag;
  switch (`${step.kind}:${step.do}`) {
    case "covers:position":
      return has(SET_POSITION);
    case "climate:eco":
      return (
        has(PRESET_MODE) &&
        Array.isArray(attributes.preset_modes) &&
        attributes.preset_modes.includes("eco")
      );
    case "climate:temperature":
      return has(TARGET_TEMPERATURE);
    case "vacuum:start":
      return has(START);
    case "vacuum:dock":
      return has(RETURN_HOME);
    case "alarm:arm_away":
    case "alarm:arm_home":
    case "alarm:arm_night":
      // One that wants a code is armed from its own keypad (the Safety tab).
      return has(ARM[step.do] ?? 0) && attributes.code_arm_required !== true;
    case "locks:lock":
    case "locks:unlock":
      // Nor is a lock that asks for a code: a call without it is refused.
      return typeof attributes.code_format !== "string" || attributes.code_format === "";
    case "climate:heat":
    case "climate:off": {
      const modes = attributes.hvac_modes;
      return !Array.isArray(modes) || modes.includes(step.do);
    }
    case "media:off":
      return has(TURN_OFF);
    case "media:pause":
      return has(MEDIA_PAUSE);
    default:
      return true;
  }
}

/**
 * What a step acts on now: the entities of its kind in its place (those chosen, else those of
 * its room, its floor or the home), but those left out, those the viewer may not use or not see,
 * and those it can do nothing to.
 */
export function targets(
  hass: HomeAssistant,
  step: Step,
  unseen: Unseen = NOTHING_UNSEEN,
): string[] {
  return scoped(hass, step, unseen).filter((id) => capable(hass, step, id));
}

/** What a step is about, whatever it does: its kind in its place, as the viewer may use it. */
function scoped(hass: HomeAssistant, step: Step, unseen: Unseen): string[] {
  const left = new Set(step.except ?? []);
  const pool = step.entities
    ? step.entities.filter((id) => fits(hass, step.kind, id))
    : candidates(hass, step.kind);
  return pool.filter((id) => !left.has(id) && inPlace(hass, step, id) && usable(hass, id, unseen));
}

/** A call to Home Assistant: domain, service, data, the entities. */
export type Call = [string, string, Record<string, unknown>, string[]];

const LIGHT_ON = new Set(["on"]);
const PLAYING = new Set(["playing"]);

/** The calls that do a step on `ids`. */
export function stepCalls(hass: HomeAssistant, step: Step, ids: string[]): Call[] {
  if (ids.length === 0) return [];
  const value = step.value;
  switch (step.kind) {
    case "lights": {
      const on =
        step.do === "on" ||
        (step.do === "toggle" && !ids.some((id) => LIGHT_ON.has(hass.states[id]?.state ?? "")));
      if (!on) return [["light", "turn_off", {}, ids]];
      const data = value !== undefined ? { brightness_pct: clamp(value, 1, 100) } : {};
      return [["light", "turn_on", data, ids]];
    }
    case "covers":
      if (step.do === "position") {
        return [["cover", "set_cover_position", { position: clamp(value ?? 50, 0, 100) }, ids]];
      }
      return [["cover", step.do === "open" ? "open_cover" : "close_cover", {}, ids]];
    case "locks":
      return [["lock", step.do === "unlock" ? "unlock" : "lock", {}, ids]];
    case "climate":
      if (step.do === "eco") return [["climate", "set_preset_mode", { preset_mode: "eco" }, ids]];
      if (step.do === "temperature") {
        return value === undefined
          ? []
          : [["climate", "set_temperature", { temperature: value }, ids]];
      }
      return [["climate", "set_hvac_mode", { hvac_mode: step.do }, ids]];
    case "media": {
      if (step.do === "off") return [["media_player", "turn_off", {}, ids]];
      // Those that play: pausing one that does not may be refused.
      const playing = ids.filter((id) => PLAYING.has(hass.states[id]?.state ?? ""));
      return playing.length > 0 ? [["media_player", "media_pause", {}, playing]] : [];
    }
    case "vacuum":
      return [["vacuum", step.do === "dock" ? "return_to_base" : "start", {}, ids]];
    case "alarm":
      return [["alarm_control_panel", `alarm_${step.do}`, {}, ids]];
    case "run": {
      const calls: Call[] = [];
      for (const domain of RUNNABLE) {
        const mine = ids.filter((id) => domainOf(id) === domain);
        if (mine.length === 0) continue;
        const service = domain === "button" || domain === "input_button" ? "press" : "turn_on";
        calls.push([domain, service, {}, mine]);
      }
      return calls;
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

/** Every call a shortcut makes now, step by step. */
export function shortcutCalls(
  hass: HomeAssistant,
  shortcut: Shortcut,
  unseen: Unseen = NOTHING_UNSEEN,
): Call[] {
  return shortcut.steps.flatMap((step) => stepCalls(hass, step, targets(hass, step, unseen)));
}

/** The calls that put `ids` back as they are now, for a step of this kind. */
function undoStep(hass: HomeAssistant, step: Step, ids: readonly string[]): Call[] {
  const calls: Call[] = [];
  const add = (
    domain: string,
    service: string,
    data: Record<string, unknown>,
    id: string,
  ): void => {
    const same = calls.find(
      (call) =>
        call[0] === domain &&
        call[1] === service &&
        JSON.stringify(call[2]) === JSON.stringify(data),
    );
    if (same) same[3].push(id);
    else calls.push([domain, service, data, [id]]);
  };
  for (const id of ids) {
    const state = hass.states[id];
    if (!state || UNKNOWN.has(state.state)) continue;
    const attributes = state.attributes;
    switch (step.kind) {
      case "lights": {
        if (state.state === "off") {
          if (step.do !== "off") add("light", "turn_off", {}, id);
        } else if (state.state === "on") {
          const brightness = Number(attributes.brightness);
          add(
            "light",
            "turn_on",
            Number.isFinite(brightness) && brightness > 0 ? { brightness } : {},
            id,
          );
        }
        break;
      }
      case "covers": {
        const position = Number(attributes.current_position);
        if (Number.isFinite(position) && (features(hass, id) & SET_POSITION) === SET_POSITION) {
          add("cover", "set_cover_position", { position }, id);
        } else if (state.state === "open" || state.state === "closed") {
          add("cover", state.state === "open" ? "open_cover" : "close_cover", {}, id);
        }
        break;
      }
      case "climate": {
        if (step.do === "eco") {
          const preset = attributes.preset_mode;
          const modes = attributes.preset_modes;
          if (typeof preset === "string" && preset !== "eco" && Array.isArray(modes)) {
            if (modes.includes(preset))
              add("climate", "set_preset_mode", { preset_mode: preset }, id);
          }
        } else if (step.do === "temperature") {
          const temperature = Number(attributes.temperature);
          if (Number.isFinite(temperature)) add("climate", "set_temperature", { temperature }, id);
        } else {
          add("climate", "set_hvac_mode", { hvac_mode: state.state }, id);
        }
        break;
      }
      case "media":
        if (step.do === "off") {
          if (state.state !== "off" && state.state !== "standby") {
            add("media_player", "turn_on", {}, id);
          }
        } else if (state.state === "playing") {
          add("media_player", "media_play", {}, id);
        }
        break;
      // A lock, the alarm, a robot, a scene or a script: not undone by a tap (a door unlocked or
      // the alarm off by mistake is not wanted; what a script did is not known).
      default:
        break;
    }
  }
  return calls;
}

/**
 * The calls that put back what a shortcut is about to change, from the states before it runs:
 * the lamps lit as they were, the shutters where they were, the heating and what played as it
 * was. Not a lock, the alarm, a robot, a scene nor a script. Each entity once, as it is now.
 */
export function undoCalls(
  hass: HomeAssistant,
  shortcut: Shortcut,
  unseen: Unseen = NOTHING_UNSEEN,
): Call[] {
  const done = new Set<string>();
  const calls: Call[] = [];
  for (const step of shortcut.steps) {
    const ids = targets(hass, step, unseen).filter((id) => !done.has(id));
    const undo = undoStep(hass, step, ids);
    if (undo.length === 0) continue;
    for (const call of undo) for (const id of call[3]) done.add(id);
    calls.push(...undo);
  }
  return calls;
}

/** Makes calls one after the other; one refused does not stop the others. */
export async function makeCalls(hass: HomeAssistant, calls: readonly Call[]): Promise<Ran> {
  const ran: Ran = { done: 0, failures: [] };
  for (const [domain, service, data, ids] of calls) {
    try {
      await hass.callService(domain, service, data, { entity_id: ids });
      ran.done += 1;
    } catch (error) {
      ran.failures.push(error);
    }
  }
  return ran;
}

/** What a shortcut did: how many calls Home Assistant took, and why the others were refused. */
export interface Ran {
  done: number;
  failures: unknown[];
}

/** Runs a shortcut, its calls one after the other; one refused does not stop the others. */
export async function runShortcut(
  hass: HomeAssistant,
  shortcut: Shortcut,
  unseen: Unseen = NOTHING_UNSEEN,
): Promise<Ran> {
  return makeCalls(hass, shortcutCalls(hass, shortcut, unseen));
}

// What a shortcut shows.

/** The state a shortcut's button shows. */
export type ShownState =
  | { count: PluralKey; n: number; active: boolean }
  | { key: MessageKey; active: boolean }
  | { text: string; active: boolean };

const UNKNOWN = new Set(["unavailable", "unknown"]);

/** An entity's state as Home Assistant says it, with its unit. */
export function stateText(hass: HomeAssistant, id: string): string | undefined {
  const state = hass.states[id];
  if (!state || UNKNOWN.has(state.state)) return undefined;
  if (hass.formatEntityState) return hass.formatEntityState(state);
  const unit = state.attributes.unit_of_measurement;
  return typeof unit === "string" && unit !== "" ? `${state.state} ${unit}` : state.state;
}

/** How many are on (open, unlocked…), lit up; or none of them. */
function counted(count: PluralKey, none: MessageKey, n: number): ShownState {
  return n > 0 ? { count, n, active: true } : { key: none, active: false };
}

/**
 * What a shortcut's button shows now: what `show` says, else how many of what its first step
 * acts on are on, open, unlocked or playing; nothing when quiet, or when nothing can be told.
 */
export function shownState(
  hass: HomeAssistant,
  shortcut: Shortcut,
  unseen: Unseen = NOTHING_UNSEEN,
): ShownState | undefined {
  if (shortcut.quiet) return undefined;
  if (shortcut.show) {
    const text = seen(unseen, shortcut.show, areaOf(hass, shortcut.show))
      ? stateText(hass, shortcut.show)
      : undefined;
    return text === undefined ? undefined : { text, active: false };
  }
  const step = shortcut.steps[0];
  if (!step) return undefined;
  // What it is about whatever it does (eco or not), as the viewer may see and use it.
  const ids = scoped(hass, step, unseen);
  if (ids.length === 0) return undefined;
  const states = ids.map((id) => hass.states[id]?.state ?? "");
  const many = (predicate: (state: string) => boolean): number => states.filter(predicate).length;
  switch (step.kind) {
    case "lights":
      return counted(
        "shortcuts.state.lights",
        "shortcuts.state.lights_none",
        many((s) => s === "on"),
      );
    case "covers":
      return counted(
        "shortcuts.state.covers",
        "shortcuts.state.covers_none",
        many((s) => s === "open" || s === "opening"),
      );
    case "locks":
      return counted(
        "shortcuts.state.locks",
        "shortcuts.state.locks_none",
        many((s) => s !== "locked" && !UNKNOWN.has(s)),
      );
    case "climate": {
      // How warm it is where they are; how many heat when none says.
      const temperatures = ids
        .map((id) => Number(hass.states[id]?.attributes.current_temperature))
        .filter((value) => Number.isFinite(value));
      if (temperatures.length > 0) {
        const mean = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
        const unit = hass.config?.unit_system?.temperature ?? "°C";
        return { text: `${(Math.round(mean * 2) / 2).toString()} ${unit}`, active: false };
      }
      return counted(
        "shortcuts.state.climate",
        "shortcuts.state.climate_none",
        many((s) => s !== "off" && !UNKNOWN.has(s)),
      );
    }
    case "media":
      return counted(
        "shortcuts.state.media",
        "shortcuts.state.media_none",
        many((s) => s === "playing"),
      );
    case "vacuum":
    case "alarm": {
      const first = ids[0];
      const text = first ? stateText(hass, first) : undefined;
      if (text === undefined) return undefined;
      const state = hass.states[first ?? ""]?.state ?? "";
      const active = step.kind === "vacuum" ? state === "cleaning" : state.startsWith("armed");
      return { text, active };
    }
    case "run":
      return undefined;
  }
}

// Suggestions.

/** What a suggestion is about: how the dialog groups them. */
export type SuggestionGroup =
  "lights" | "routines" | "covers" | "security" | "climate" | "car" | "media" | "robot" | "scenes";

export const SUGGESTION_GROUPS: readonly SuggestionGroup[] = [
  "lights",
  "routines",
  "covers",
  "security",
  "climate",
  "car",
  "media",
  "robot",
  "scenes",
];

/** A shortcut DomoTwin suggests from the home's devices. */
export interface Suggestion {
  /** Stable while the home is the same: `lights_off`, `lights_off:<floor>`, `run:<entity>`… */
  key: string;
  group: SuggestionGroup;
  shortcut: Omit<Shortcut, "id">;
  /** How many devices it acts on (or shows). */
  count: number;
}

/** Integrations that read a car; a battery of theirs is the car's. */
const CAR_PLATFORMS = new Set([
  "audiconnect",
  "bmw_connected_drive",
  "fordpass",
  "hyundai_kia_connect",
  "jlrincontrol",
  "kia_uvo",
  "mbapi2020",
  "mazda",
  "myskoda",
  "nissan_leaf",
  "polestar_api",
  "psa_car_controller",
  "renault",
  "smartcar",
  "stellantis_vehicles",
  "subaru",
  "tesla_custom",
  "tesla_fleet",
  "teslemetry",
  "tessie",
  "toyota",
  "volkswagen_we_connect_id",
  "volkswagencarnet",
  "volvo",
  "volvooncall",
]);

/**
 * Words that say a device is a car, in the languages DomoTwin speaks: never a model's name that is
 * also a person's (Zoe), nor a character that is in a bicycle's or a garage's name too (車).
 */
const CAR_WORDS =
  /\b(car|ev|vehicle|voiture|véhicule|auto|coche|carro|wagen|fahrzeug|tesla|model [3sxy])\b|自動車|汽车|汽車|자동차|سيارة/iu;

function deviceName(hass: HomeAssistant, id: string): string | undefined {
  const device = hass.entities?.[id]?.device_id;
  const entry = device ? hass.devices?.[device] : undefined;
  const name = entry?.name_by_user ?? entry?.name;
  return typeof name === "string" && name.trim() !== "" ? name : undefined;
}

/** The cars' batteries (%): one per car, its device's name. */
export function carBatteries(hass: HomeAssistant): { entity: string; name: string }[] {
  const found = new Map<string, { entity: string; name: string }>();
  for (const id of Object.keys(hass.states).sort()) {
    if (domainOf(id) !== "sensor") continue;
    const state = hass.states[id];
    const entry = hass.entities?.[id];
    if (!state || entry?.hidden === true) continue;
    if (
      state.attributes.device_class !== "battery" ||
      state.attributes.unit_of_measurement !== "%"
    ) {
      continue;
    }
    const device = deviceName(hass, id);
    const platform = entry?.platform;
    // A phone's own battery, whatever the phone is called.
    if (platform === "mobile_app") continue;
    const car =
      (platform !== undefined && CAR_PLATFORMS.has(platform)) ||
      CAR_WORDS.test(device ?? "") ||
      CAR_WORDS.test(entityName(hass, id));
    if (!car) continue;
    const key = entry?.device_id ?? id;
    if (!found.has(key)) found.set(key, { entity: id, name: device ?? entityName(hass, id) });
  }
  return [...found.values()];
}

/** The steps of a shortcut, compared: a suggestion already added is not suggested again. */
export function sameShortcut(a: Omit<Shortcut, "id">, b: Omit<Shortcut, "id">): boolean {
  const key = (s: Omit<Shortcut, "id">): string => JSON.stringify([s.steps, s.show ?? null]);
  return key(a) === key(b);
}

/**
 * The shortcuts DomoTwin suggests for the home, those already added left out: the lamps off in
 * the whole home and on each floor, a good night and a leaving home (in a workplace, closing up,
 * D-086), the shutters, the locks, the alarm, the heating, a car's battery, the music, the robots,
 * the scenes and scripts. Each on what the viewer may use and see; named in the viewer's language.
 */
export function suggestions(
  hass: HomeAssistant,
  t: Translator,
  existing: readonly Shortcut[] = [],
  unseen: Unseen = NOTHING_UNSEEN,
  workplace = false,
): Suggestion[] {
  const found: Suggestion[] = [];
  const count = (step: Step): number => targets(hass, step, unseen).length;
  const add = (
    key: string,
    group: SuggestionGroup,
    shortcut: Omit<Shortcut, "id">,
    n: number,
  ): void => {
    if (n === 0 || existing.some((s) => sameShortcut(s, shortcut))) return;
    // A device's or a floor's name may make it long: cut as the integration keeps it.
    found.push({ key, group, shortcut: { ...shortcut, name: clipName(shortcut.name) }, count: n });
  };
  const has = (kind: StepKind, does: string): Step | undefined => {
    const step: Step = { kind, do: does };
    return count(step) > 0 ? step : undefined;
  };

  // The lamps, of the home and of each floor.
  const lightsOff: Step = { kind: "lights", do: "off" };
  const lamps = count(lightsOff);
  add(
    "lights_off",
    "lights",
    { name: t.t("shortcuts.suggest.lights_off"), icon: "lights_off", steps: [lightsOff] },
    lamps,
  );
  const floors = Object.values(hass.floors ?? {})
    .filter((floor) => floor !== undefined)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
  if (floors.length > 1) {
    for (const floor of floors) {
      const step: Step = { kind: "lights", do: "off", floor: floor.floor_id };
      const n = count(step);
      // Not when the floor holds every lamp of the home: the whole home's says it.
      if (n === lamps) continue;
      add(
        `lights_off:${floor.floor_id}`,
        "lights",
        {
          name: t.t("shortcuts.suggest.lights_off_floor", { floor: floor.name }),
          icon: "lights_off",
          steps: [step],
        },
        n,
      );
    }
  }

  // Good night, and leaving home: what the home has of each.
  const close = has("covers", "close");
  const lock = has("locks", "lock");
  const night = has("alarm", "arm_night");
  const away = has("alarm", "arm_away");
  const eco = has("climate", "eco");
  const mediaOff = has("media", "off");
  if (lamps > 0 && workplace) {
    // A workplace closes (D-086): everything off, the shutters down, locked, the alarm on.
    const closeSteps = [lightsOff, mediaOff, close, lock, away, eco].filter(
      (s): s is Step => s !== undefined,
    );
    if (closeSteps.length > 1) {
      add(
        "close_up",
        "routines",
        {
          name: t.t("shortcuts.suggest.close_up"),
          icon: "lock",
          steps: closeSteps,
          quiet: true,
          confirm: true,
        },
        closeSteps.reduce((sum, step) => sum + count(step), 0),
      );
    }
  } else if (lamps > 0) {
    const nightSteps = [lightsOff, close, lock, night].filter((s): s is Step => s !== undefined);
    if (nightSteps.length > 1) {
      add(
        "good_night",
        "routines",
        {
          name: t.t("shortcuts.suggest.good_night"),
          icon: "moon",
          steps: nightSteps,
          quiet: true,
          confirm: true,
        },
        nightSteps.reduce((sum, step) => sum + count(step), 0),
      );
    }
    const leaveSteps = [lightsOff, mediaOff, lock, away, eco].filter(
      (s): s is Step => s !== undefined,
    );
    if (leaveSteps.length > 1) {
      add(
        "leaving",
        "routines",
        {
          name: t.t("shortcuts.suggest.leaving"),
          icon: "leave",
          steps: leaveSteps,
          quiet: true,
          confirm: true,
        },
        leaveSteps.reduce((sum, step) => sum + count(step), 0),
      );
    }
  }

  // The shutters and blinds.
  if (close) {
    const n = count(close);
    add(
      "covers_close",
      "covers",
      { name: t.t("shortcuts.suggest.covers_close"), icon: "blinds_closed", steps: [close] },
      n,
    );
    add(
      "covers_open",
      "covers",
      {
        name: t.t("shortcuts.suggest.covers_open"),
        icon: "blinds_open",
        steps: [{ kind: "covers", do: "open" }],
      },
      n,
    );
  }

  // The locks and the alarm.
  if (lock) {
    add(
      "locks_lock",
      "security",
      { name: t.t("shortcuts.suggest.locks_lock"), icon: "lock", steps: [lock] },
      count(lock),
    );
  }
  if (away) {
    add(
      "alarm_away",
      "security",
      { name: t.t("shortcuts.suggest.alarm_away"), icon: "alarm", steps: [away], confirm: true },
      count(away),
    );
  }
  if (night) {
    add(
      "alarm_night",
      "security",
      { name: t.t("shortcuts.suggest.alarm_night"), icon: "alarm", steps: [night], confirm: true },
      count(night),
    );
  }

  // The heating: in eco where the thermostats have it, else at a usual temperature.
  if (eco) {
    add(
      "climate_eco",
      "climate",
      { name: t.t("shortcuts.suggest.climate_eco"), icon: "thermostat", steps: [eco] },
      count(eco),
    );
  }
  const warm: Step = { kind: "climate", do: "temperature", value: usualTemperature(hass) };
  const unit = hass.config?.unit_system?.temperature ?? "°C";
  add(
    "climate_temperature",
    "climate",
    {
      name: t.t("shortcuts.suggest.climate_temperature", {
        temperature: `${warm.value ?? ""} ${unit}`,
      }),
      icon: "thermostat",
      steps: [warm],
    },
    count(warm),
  );

  // A car's battery.
  for (const car of carBatteries(hass)) {
    if (!seen(unseen, car.entity, areaOf(hass, car.entity))) continue;
    add(
      `battery:${car.entity}`,
      "car",
      {
        name: t.t("shortcuts.suggest.car_battery", { name: car.name }),
        icon: "car",
        steps: [],
        show: car.entity,
      },
      1,
    );
  }

  // The music, the robots.
  const pause = has("media", "pause");
  if (pause || mediaOff) {
    const step = pause ?? mediaOff;
    if (step) {
      add(
        `media_${step.do}`,
        "media",
        {
          name: t.t(
            step.do === "pause" ? "shortcuts.suggest.media_pause" : "shortcuts.suggest.media_off",
          ),
          icon: "music_off",
          steps: [step],
        },
        count(step),
      );
    }
  }
  const robots = targets(hass, { kind: "vacuum", do: "start" }, unseen);
  if (robots.length === 1 && robots[0]) {
    const id = robots[0];
    add(
      "vacuum_start",
      "robot",
      {
        name: t.t("shortcuts.suggest.vacuum_one", { name: entityName(hass, id) }),
        icon: "robot",
        steps: [{ kind: "vacuum", do: "start", entities: [id] }],
      },
      1,
    );
  } else if (robots.length > 1) {
    add(
      "vacuum_start",
      "robot",
      {
        name: t.t("shortcuts.suggest.vacuum_all"),
        icon: "robot",
        steps: [{ kind: "vacuum", do: "start" }],
      },
      robots.length,
    );
  }

  // The scenes and scripts, a few.
  const runnable = candidates(hass, "run")
    .filter((id) => domainOf(id) === "scene" || domainOf(id) === "script")
    .filter((id) => usable(hass, id, unseen))
    .sort((a, b) => entityName(hass, a).localeCompare(entityName(hass, b)))
    .slice(0, 8);
  for (const id of runnable) {
    add(
      `run:${id}`,
      "scenes",
      {
        name: entityName(hass, id),
        icon: "play",
        steps: [{ kind: "run", do: "run", entities: [id] }],
      },
      1,
    );
  }
  return found;
}

/** The suggestions shown on a Home tab without shortcuts: one of each of the first groups. */
export function firstSuggestions(all: readonly Suggestion[], many = 3): Suggestion[] {
  const groups = new Set<SuggestionGroup>();
  const picked: Suggestion[] = [];
  for (const suggestion of all) {
    if (groups.has(suggestion.group)) continue;
    groups.add(suggestion.group);
    picked.push(suggestion);
    if (picked.length === many) break;
  }
  return picked;
}
