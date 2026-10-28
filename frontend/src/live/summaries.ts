/**
 * What DomoTwin's summaries say (`docs/DECISIONS.md`, D-061), worked out from Home Assistant's
 * states: the people at home, the upkeep due, the automations and the robots. Loaded with the
 * summary cards.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import { numberOf } from "./layers";
import { todayIn } from "./upkeep";

/** DomoTwin's own entities of a kind (their registry's `translation_key`). */
function domotwinEntities(hass: HomeAssistant, key: string): HassEntity[] {
  return Object.values(hass.entities ?? {}).flatMap((entry) => {
    if (entry?.platform !== "domotwin" || entry.translation_key !== key) return [];
    const state = hass.states[entry.entity_id];
    return state ? [state] : [];
  });
}

/**
 * The people at home (Home Assistant's `person` entities), and the rooms DomoTwin says they are in:
 * only those of the people this viewer may see (`shown`: not hidden, and none at all for someone
 * who is not an administrator when only administrators see them, D-034), none before they are
 * known.
 */
export function peopleSummary(
  hass: HomeAssistant,
  shown: ReadonlySet<string> | undefined,
): { home: number; rooms: string[] } {
  const home = Object.values(hass.states).filter(
    (state) => state?.entity_id.startsWith("person.") && state.state === "home",
  ).length;
  // A private room says nothing of who is in it (its sensor is unknown, D-039).
  const rooms = domotwinEntities(hass, "room_people")
    .filter((state) => {
      const people: unknown = state.attributes.people;
      return (
        shown !== undefined &&
        Array.isArray(people) &&
        people.some((person) => typeof person === "string" && shown.has(person))
      );
    })
    .map((state) => {
      const name = state.attributes.room;
      return typeof name === "string" ? name : state.entity_id;
    })
    .sort((a, b) => a.localeCompare(b));
  return { home, rooms };
}

/**
 * The upkeep due (DomoTwin's sensor, whatever its entity is called now), and the soonest task:
 * `undefined` without the sensor, `unavailable` while it says nothing (DomoTwin starting).
 */
export function upkeepSummary(
  hass: HomeAssistant,
):
  | { due: number; next?: { task: string; piece: string; state: string } }
  | "unavailable"
  | undefined {
  const state =
    domotwinEntities(hass, "upkeep_due")[0] ?? hass.states["sensor.domotwin_upkeep_due"];
  if (!state) return undefined;
  const due = numberOf(state.state);
  if (due === undefined) return "unavailable";
  const tasks = state.attributes.tasks;
  const first: unknown = Array.isArray(tasks) ? tasks[0] : undefined;
  if (typeof first !== "object" || first === null) return { due };
  const task = first as Record<string, unknown>;
  if (typeof task.task !== "string" || typeof task.piece_name !== "string") return { due };
  return {
    due,
    next: { task: task.task, piece: task.piece_name, state: String(task.state) },
  };
}

/** The automations: how many, how many are on, how many ran today where the home is. */
export function automationsSummary(
  hass: HomeAssistant,
  now: number,
): { total: number; on: number; today: number } {
  const automations = Object.values(hass.states).filter((state): state is HassEntity =>
    Boolean(state?.entity_id.startsWith("automation.")),
  );
  const zone = hass.config?.time_zone;
  const today = todayIn(zone, new Date(now));
  let ranToday = 0;
  for (const state of automations) {
    const last = state.attributes.last_triggered;
    const time = typeof last === "string" ? Date.parse(last) : NaN;
    if (Number.isFinite(time) && todayIn(zone, new Date(time)) === today) ranToday += 1;
  }
  return {
    total: automations.length,
    on: automations.filter((state) => state.state === "on").length,
    today: ranToday,
  };
}

/** The robot vacuums: how many, and how many of them are at each state. */
export function robotsSummary(hass: HomeAssistant): { total: number; states: Map<string, number> } {
  const states = new Map<string, number>();
  let total = 0;
  for (const state of Object.values(hass.states)) {
    if (!state?.entity_id.startsWith("vacuum.")) continue;
    total += 1;
    states.set(state.state, (states.get(state.state) ?? 0) + 1);
  }
  return { total, states };
}
