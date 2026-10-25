/**
 * Devices drawn as what they are (`docs/DECISIONS.md`, D-024): a badge over each element for what
 * its linked devices are doing (a lock's state, a camera, what plays, a battery running low, an
 * appliance running). The engine says where the elements are drawn (`elementPoints`).
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import type { KindName } from "../i18n";
import { roleOf, type BindingsJson } from "./bindings";
import { numberOf } from "./layers";

export type BadgeKind =
  | "locked"
  | "unlocked"
  | "jammed"
  | "lock_moving"
  | "lock_open"
  | "camera"
  | "recording"
  | "camera_off"
  | "playing"
  | "battery_low"
  | "running"
  // Upkeep (D-033): a task due soon, overdue, a warranty ending.
  | "upkeep_due"
  | "upkeep_overdue"
  | "warranty_ending";

/** How a badge looks: calm, neutral, to look at, or urgent. */
export type BadgeTone = "ok" | "info" | "warning" | "danger";

/** A badge over an element. */
export interface Badge {
  element: string;
  kind: BadgeKind;
  tone: BadgeTone;
  /** The entity it comes from. */
  entity: string;
  /** A short value shown with it (a battery's level), or what plays. */
  text?: string;
  /** For `running`: the piece's kind (`washer`, `dryer`…), for its icon. */
  appliance?: string;
}

/** Kinds whose running shows (a fridge always runs). */
export const APPLIANCES = new Set<string>([
  "washer",
  "dryer",
  "dishwasher",
  "stove",
  "hood",
  "printer",
  "3d-printer",
] satisfies KindName[]);
/** Above this (W) an appliance is running, not on standby. */
const RUNNING_WATTS = 10;
/** A battery at or under this (%) is low. */
const LOW_BATTERY = 20;
/** Badges shown over one element at most (the most urgent first). */
export const MAX_BADGES = 2;

const TONE_ORDER: Record<BadgeTone, number> = { danger: 0, warning: 1, ok: 2, info: 3 };

function watts(entity: HassEntity): number | undefined {
  const value = numberOf(entity.state);
  if (value === undefined) return undefined;
  const unit = entity.attributes.unit_of_measurement;
  if (unit === "kW") return value * 1000;
  if (unit === "MW") return value * 1_000_000;
  return unit === "W" || unit === undefined ? value : undefined;
}

function lockBadge(state: string): [BadgeKind, BadgeTone] | undefined {
  switch (state) {
    case "locked":
      return ["locked", "ok"];
    case "unlocked":
      return ["unlocked", "info"];
    case "jammed":
      return ["jammed", "danger"];
    case "locking":
    case "unlocking":
      return ["lock_moving", "info"];
    case "open":
    case "opening":
      return ["lock_open", "warning"];
    default:
      return undefined;
  }
}

/**
 * Badges of two sources put together (the devices' and upkeep's), at most `MAX_BADGES` an
 * element, the most urgent first.
 */
export function mergeBadges(
  first: ReadonlyMap<string, Badge[]>,
  second: ReadonlyMap<string, Badge[]>,
): Map<string, Badge[]> {
  if (second.size === 0) return new Map(first);
  const out = new Map(first);
  for (const [element, badges] of second) {
    const all = [...(out.get(element) ?? []), ...badges];
    all.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
    out.set(element, all.slice(0, MAX_BADGES));
  }
  return out;
}

/**
 * The badges of every linked element, by element id (at most `MAX_BADGES` each, the most urgent
 * first). `kinds` gives the furniture kind of each piece, for appliances.
 */
export function deviceBadges(
  hass: HomeAssistant,
  bindings: BindingsJson,
  kinds: Readonly<Record<string, string>>,
): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  for (const [element, binding] of Object.entries(bindings.elements)) {
    const badges: Badge[] = [];
    const add = (badge: Omit<Badge, "element">): void => {
      badges.push({ element, ...badge });
    };
    const kind = kinds[element] ?? "";
    let power = 0;
    let running = false;
    for (const bound of binding.entities) {
      const id = bound.entity_id;
      const entity = hass.states[id];
      if (!entity) continue;
      const role = roleOf(bound, hass);
      const deviceClass = entity.attributes.device_class;
      if (role === "lock") {
        const badge = lockBadge(entity.state);
        if (badge) add({ kind: badge[0], tone: badge[1], entity: id });
      } else if (role === "camera") {
        if (entity.state === "unavailable")
          add({ kind: "camera_off", tone: "warning", entity: id });
        else if (entity.state === "recording")
          add({ kind: "recording", tone: "danger", entity: id });
        else add({ kind: "camera", tone: "info", entity: id });
      } else if (role === "media" && entity.state === "playing") {
        const title = entity.attributes.media_title;
        const badge: Omit<Badge, "element"> = { kind: "playing", tone: "info", entity: id };
        if (typeof title === "string" && title) badge.text = title;
        add(badge);
      } else if (role === "power") {
        power += Math.max(0, watts(entity) ?? 0);
      }
      if (deviceClass === "battery") {
        const level = id.startsWith("sensor.") ? numberOf(entity.state) : undefined;
        if (level !== undefined && level <= LOW_BATTERY) {
          add({ kind: "battery_low", tone: "warning", entity: id, text: `${Math.round(level)} %` });
        } else if (id.startsWith("binary_sensor.") && entity.state === "on") {
          add({ kind: "battery_low", tone: "warning", entity: id });
        }
      }
      if (deviceClass === "running" && id.startsWith("binary_sensor.") && entity.state === "on") {
        running = true;
      }
    }
    if (APPLIANCES.has(kind) && (running || power > RUNNING_WATTS)) {
      const entity =
        binding.entities.find((e) => roleOf(e, hass) === "power")?.entity_id ??
        binding.entities[0]?.entity_id ??
        "";
      add({ kind: "running", tone: "info", entity, appliance: kind });
    }
    if (badges.length > 0) {
      badges.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
      out.set(element, badges.slice(0, MAX_BADGES));
    }
  }
  return out;
}
