/**
 * The plain actions of a device (`DECISIONS.md`, D-047): what the link editor offers for a tap, a
 * long press or a room's action before its advanced mode. A lamp switches on, off or dims, a TV
 * switches on or off and turns its volume up, a blind opens, a robot vacuum starts cleaning or goes
 * back to its base. Each is an ordinary Home Assistant action, stored as written.
 */
import type { MessageKey } from "../i18n";
import type { Action } from "./bindings";

/** One plain action of an entity. */
export interface Preset {
  /** The entity it acts on. */
  entity: string;
  /** Its key among the entity's (`toggle`, `volume_up`…). */
  key: string;
  label: MessageKey;
  action: Action;
}

/** A plain action: its key, its words, the service (`toggle`: DomoTwin's toggle) and its data. */
type Spec = readonly [
  key: string,
  label: MessageKey,
  service: string,
  data?: Record<string, unknown>,
];

const TOGGLE: Spec = ["toggle", "presets.toggle", "toggle"];
const ON: Spec = ["on", "presets.on", "turn_on"];
const OFF: Spec = ["off", "presets.off", "turn_off"];
const ON_OFF: readonly Spec[] = [TOGGLE, ON, OFF];
const OPENS: readonly Spec[] = [["toggle", "presets.toggle_open", "toggle"]];

const BY_DOMAIN: Readonly<Record<string, readonly Spec[]>> = {
  light: [
    ...ON_OFF,
    ["brighter", "presets.brighter", "turn_on", { brightness_step_pct: 20 }],
    ["dimmer", "presets.dimmer", "turn_on", { brightness_step_pct: -20 }],
  ],
  switch: ON_OFF,
  input_boolean: ON_OFF,
  humidifier: ON_OFF,
  siren: ON_OFF,
  fan: [
    ...ON_OFF,
    ["faster", "presets.faster", "increase_speed"],
    ["slower", "presets.slower", "decrease_speed"],
  ],
  cover: [
    ...OPENS,
    ["open", "presets.open", "open_cover"],
    ["close", "presets.close", "close_cover"],
    ["stop", "presets.stop", "stop_cover"],
  ],
  valve: [
    ...OPENS,
    ["open", "presets.open", "open_valve"],
    ["close", "presets.close", "close_valve"],
  ],
  // A TV or a speaker: its power is its own toggle (DomoTwin's plays or pauses).
  media_player: [
    ["power", "presets.toggle", "media_player.toggle"],
    ON,
    OFF,
    ["play_pause", "presets.play_pause", "media_play_pause"],
    ["volume_up", "presets.volume_up", "volume_up"],
    ["volume_down", "presets.volume_down", "volume_down"],
    ["mute", "presets.mute", "volume_mute", { is_volume_muted: true }],
    ["unmute", "presets.unmute", "volume_mute", { is_volume_muted: false }],
    ["next", "presets.next", "media_next_track"],
  ],
  lock: [
    ["toggle", "presets.toggle_lock", "toggle"],
    ["lock", "presets.lock", "lock"],
    ["unlock", "presets.unlock", "unlock"],
  ],
  climate: [ON, OFF],
  water_heater: [ON, OFF],
  vacuum: [
    ["start", "presets.start", "start"],
    ["pause", "presets.pause", "pause"],
    ["home", "presets.home", "return_to_base"],
    ["locate", "presets.locate", "locate"],
  ],
  lawn_mower: [
    ["start", "presets.mow", "start_mowing"],
    ["pause", "presets.pause", "pause"],
    ["home", "presets.home", "dock"],
  ],
  scene: [["on", "presets.activate", "turn_on"]],
  script: [["on", "presets.run", "turn_on"]],
  button: [["press", "presets.press", "press"]],
  input_button: [["press", "presets.press", "press"]],
};

/** The plain actions of an entity, in the order offered (none for a sensor or a camera). */
export function presets(entity: string): Preset[] {
  const domain = entity.split(".")[0] ?? "";
  return (BY_DOMAIN[domain] ?? []).map(([key, label, service, data]) => {
    let action: Action;
    if (service === "toggle") action = { action: "toggle", entity_id: entity };
    else {
      const name = service.includes(".") ? service : `${domain}.${service}`;
      action = { action: "perform-action", perform_action: name, target: { entity_id: entity } };
      if (data) action.data = { ...data };
    }
    return { entity, key, label, action };
  });
}

/** A value with its keys sorted, to compare actions written in any order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The entity an action is aimed at, if a single one (a bare toggle: `primary`). */
function aimedAt(action: Action, primary?: string): string | undefined {
  if (action.action === "toggle") return action.entity_id ?? primary;
  const target = action.target;
  if (!target) return undefined;
  const keys = Object.keys(target);
  return keys.length === 1 && typeof target.entity_id === "string" ? target.entity_id : undefined;
}

/**
 * The plain action `action` is, among those of `entities` (a bare toggle acts on `primary`, the
 * piece's main device); none when it is anything else.
 */
export function presetOf(
  action: Action,
  entities: readonly string[],
  primary?: string,
): Preset | undefined {
  const entity = aimedAt(action, primary);
  if (!entity || !entities.includes(entity)) return undefined;
  const name = action.perform_action ?? action.service;
  const data = action.data && Object.keys(action.data).length > 0 ? action.data : undefined;
  return presets(entity).find((preset) => {
    const wanted = preset.action;
    if (wanted.action === "toggle") return action.action === "toggle";
    if (action.action !== "perform-action" && action.action !== "call-service") return false;
    return wanted.perform_action === name && same(wanted.data, data);
  });
}

/** The key of a preset in a choice list: its entity and its own key. */
export function presetKey(preset: Pick<Preset, "entity" | "key">): string {
  return `${preset.entity} ${preset.key}`;
}

/** The preset named by `presetKey`. */
export function presetByKey(key: string): Preset | undefined {
  const [entity, own] = key.split(" ");
  if (!entity || !own) return undefined;
  return presets(entity).find((preset) => preset.key === own);
}
