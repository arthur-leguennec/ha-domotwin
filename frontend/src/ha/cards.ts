/**
 * Home Assistant's own cards (D-055): the tile card of an entity, the button card of a scene, the
 * weather, an agenda, a list, a camera, an alarm (D-068), made by Home Assistant's card helpers.
 * Those helpers are set by the dashboards' own module only (`window.loadCardHelpers`, in 2025.1
 * and since): DomoTwin opened before any dashboard loads that module first, the way Home
 * Assistant's panel resolver does, and shows its own plain rows when it cannot.
 */

/** A card's configuration, as Home Assistant takes it. */
export interface CardConfig {
  type: string;
  [key: string]: unknown;
}

/** What Home Assistant's card helpers give. */
export interface CardHelpers {
  createCardElement(config: CardConfig): Promise<HTMLElement> | HTMLElement;
}

/** The routes of Home Assistant's panel resolver: each panel's module and how to load it. */
interface PanelRoutes {
  routes?: Record<string, { load?: () => Promise<unknown> } | undefined>;
}

type Resolver = HTMLElement & {
  _getRoutes?: (panels: Record<string, unknown>) => PanelRoutes;
  getRoutes?: (panels: Record<string, unknown>) => PanelRoutes;
};

let helpers: Promise<CardHelpers | undefined> | undefined;
/** None were found: tried again once Home Assistant has them (a dashboard opened since). */
let missing = false;

/** Loads the dashboards' module, which sets `window.loadCardHelpers`. */
async function loadDashboards(): Promise<void> {
  const Element = customElements.get("partial-panel-resolver");
  if (!Element) return;
  try {
    const resolver = new Element() as Resolver;
    const routesOf = resolver._getRoutes ?? resolver.getRoutes;
    const panels = { domotwin_cards: { component_name: "lovelace", url_path: "domotwin_cards" } };
    await routesOf?.call(resolver, panels).routes?.domotwin_cards?.load?.();
  } catch {
    // Home Assistant changed how it loads its panels: plain rows.
  }
}

async function load(): Promise<CardHelpers | undefined> {
  if (!window.loadCardHelpers) await loadDashboards();
  try {
    return await window.loadCardHelpers?.();
  } catch {
    return undefined;
  }
}

/** Home Assistant's card helpers, loaded once; `undefined` where there are none. */
export function cardHelpers(): Promise<CardHelpers | undefined> {
  if (!helpers || (missing && window.loadCardHelpers)) {
    missing = false;
    helpers = load().then((found) => {
      // Helpers there but failing are not tried again.
      missing = !found && !window.loadCardHelpers;
      return found;
    });
  }
  return helpers;
}

/** The configurations made, the same object for the same card: a card is made once. */
const made = new Map<string, CardConfig>();

function once(key: string, config: () => CardConfig): CardConfig {
  let found = made.get(key);
  if (!found) made.set(key, (found = config()));
  return found;
}

/** The tile card of an entity. */
export function tileCard(entity: string): CardConfig {
  return once(`tile:${entity}`, () => ({ type: "tile", entity }));
}

/**
 * A big button that runs a scene or a script: `turn_on` (a toggle would stop a script running),
 * its more-info on a hold. `perform-action` is in 2025.1's cards.
 */
export function pressCard(entity: string): CardConfig {
  return once(`press:${entity}`, () => ({
    type: "button",
    entity,
    show_state: false,
    tap_action: {
      action: "perform-action",
      perform_action: `${entity.slice(0, entity.indexOf("."))}.turn_on`,
      target: { entity_id: entity },
    },
    hold_action: { action: "more-info" },
  }));
}

/**
 * A camera's picture (D-068): a still Home Assistant refreshes, live in its dialog on a tap; live
 * itself on a doorbell's full screen, where a tap does nothing. `camera_view` is in 2025.1's
 * picture-entity card.
 */
export function cameraCard(entity: string, live = false): CardConfig {
  return once(`camera:${entity}:${live ? "live" : "auto"}`, () =>
    live
      ? {
          type: "picture-entity",
          entity,
          camera_view: "live",
          show_name: false,
          show_state: false,
          tap_action: { action: "none" },
        }
      : { type: "picture-entity", entity, camera_view: "auto", show_state: false },
  );
}

/** An alarm's keypad and modes: the alarm-panel card. */
export function alarmCard(entity: string): CardConfig {
  return once(`alarm:${entity}`, () => ({ type: "alarm-panel", entity }));
}

/** A lock's tile with its buttons (the `lock-commands` feature, in 2025.1's tile card). */
export function lockTile(entity: string): CardConfig {
  return once(`lock:${entity}`, () => ({
    type: "tile",
    entity,
    features: [{ type: "lock-commands" }],
  }));
}

/** Another card of Home Assistant's, the same object for the same configuration. */
export function card(config: CardConfig): CardConfig {
  return once(JSON.stringify(config), () => config);
}
