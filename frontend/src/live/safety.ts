/**
 * The Safety tab (`docs/DECISIONS.md`, D-068): the home's alarms, its cameras side by side (its
 * doorbells' first), its doorbells and, where Home Assistant has no Security page, its locks; and
 * what a doorbell's full screen shows, its camera and its lock. Read from Home Assistant's states
 * and registries; what a private room the viewer may not see holds is left out (D-039).
 */
import { domainOf, type HomeAssistant } from "../ha/types";
import { areaOf, entityName, shownEntity } from "./bindings";
import { isDoorbell, rangAt } from "./doorbell";
import { NOTHING_UNSEEN, seen, type Unseen } from "./privacy";

/** A doorbell, when it rang last and what goes with it. */
export interface Doorbell {
  entity: string;
  /** When it rang last (ms), when Home Assistant says. */
  rang?: number;
  /** Its camera: the doorbell's own, else the only one in its area. */
  camera?: string;
  /** The lock that opens to it: its own, else the only one in its area. */
  lock?: string;
}

/** What the Safety tab shows. */
export interface SafetyHome {
  alarms: string[];
  doorbells: Doorbell[];
  /** The doorbells' cameras first (the one rung last first), then the others by name. */
  cameras: string[];
  locks: string[];
}

/** The domains the Safety tab shows, as found in one pass over the states. */
const DOMAINS = ["camera", "lock", "alarm_control_panel", "event"] as const;
type SafetyDomain = (typeof DOMAINS)[number];

/**
 * The entities of the Safety tab's domains the viewer may see, by entity id: shown in Home
 * Assistant (not hidden, nor a configuration or diagnostic one); of the events, the doorbells.
 */
function shownOf(hass: HomeAssistant, unseen: Unseen): Record<SafetyDomain, string[]> {
  const found: Record<SafetyDomain, string[]> = {
    camera: [],
    lock: [],
    alarm_control_panel: [],
    event: [],
  };
  for (const id of Object.keys(hass.states)) {
    const domain = domainOf(id);
    if (!(DOMAINS as readonly string[]).includes(domain)) continue;
    const kept = domain === "event" ? isDoorbell(hass, id) : shownEntity(hass, id);
    if (kept && seen(unseen, id, areaOf(hass, id))) found[domain as SafetyDomain].push(id);
  }
  for (const ids of Object.values(found)) ids.sort();
  return found;
}

/** The one of `ids` that goes with `entity`: of its device, else the only one in its area. */
function companion(
  hass: HomeAssistant,
  entity: string,
  ids: readonly string[],
): string | undefined {
  const device = hass.entities?.[entity]?.device_id;
  if (device) {
    const own = ids.find((id) => hass.entities?.[id]?.device_id === device);
    if (own) return own;
  }
  const area = areaOf(hass, entity);
  if (area === undefined) return undefined;
  const there = ids.filter((id) => areaOf(hass, id) === area);
  return there.length === 1 ? there[0] : undefined;
}

/** A doorbell, with its camera and lock among `cameras` and `locks`. */
function withCompanions(
  hass: HomeAssistant,
  entity: string,
  cameras: readonly string[],
  locks: readonly string[],
): Doorbell {
  const doorbell: Doorbell = { entity };
  const rang = rangAt(hass, entity);
  if (rang !== undefined) doorbell.rang = rang;
  const camera = companion(hass, entity, cameras);
  if (camera) doorbell.camera = camera;
  const lock = companion(hass, entity, locks);
  if (lock) doorbell.lock = lock;
  return doorbell;
}

/** A doorbell with its camera and lock, among those the viewer may see. */
export function doorbellOf(
  hass: HomeAssistant,
  entity: string,
  unseen: Unseen = NOTHING_UNSEEN,
): Doorbell {
  const { camera, lock } = shownOf(hass, unseen);
  return withCompanions(hass, entity, camera, lock);
}

/** What the Safety tab shows now. */
export function safetyOf(
  hass: HomeAssistant,
  unseen: Unseen = NOTHING_UNSEEN,
  language = "en",
): SafetyHome {
  const {
    camera: cameras,
    lock: locks,
    alarm_control_panel: alarms,
    event,
  } = shownOf(hass, unseen);
  const doorbells = event
    .map((entity) => withCompanions(hass, entity, cameras, locks))
    .sort((a, b) => (b.rang ?? 0) - (a.rang ?? 0));
  const collator = new Intl.Collator(language);
  const first = [...new Set(doorbells.flatMap((doorbell) => doorbell.camera ?? []))];
  const others = cameras
    .filter((id) => !first.includes(id))
    .sort((a, b) => collator.compare(entityName(hass, a), entityName(hass, b)));
  return {
    alarms,
    doorbells,
    cameras: [...first, ...others],
    locks,
  };
}
