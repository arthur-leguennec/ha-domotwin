/**
 * Robot vacuums on the floor (D-049): each robot-vacuum piece linked to a `vacuum` entity, with
 * what that vacuum does now. The engine draws the robot: on its dock, cleaning room by room, on
 * its way home, or stopped where it was.
 */
import type { HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";

/** A robot as the engine reads it (`setRobots`). */
export interface RobotShown {
  /** Its dock's piece. */
  id: string;
  /** Its vacuum's state: `docked`, `cleaning`, `returning`, `paused`, `idle`, `error`… */
  state: string;
}

/** A dock and the vacuum linked to it. */
export interface RobotDock {
  /** The robot-vacuum piece. */
  id: string;
  vacuum: string;
}

/**
 * The docks: the robot-vacuum pieces (by `kinds`, piece id → kind) linked to a vacuum, by id.
 * They change with the links and the pieces only.
 */
export function robotDocks(
  bindings: BindingsJson | undefined,
  kinds: Readonly<Record<string, string>>,
): RobotDock[] {
  if (!bindings) return [];
  const docks: RobotDock[] = [];
  for (const [id, binding] of Object.entries(bindings.elements)) {
    if (kinds[id] !== "robot-vacuum") continue;
    const vacuum = binding.entities.find((e) => e.entity_id.startsWith("vacuum."));
    if (vacuum) docks.push({ id, vacuum: vacuum.entity_id });
  }
  return docks.sort((a, b) => a.id.localeCompare(b.id));
}

/** The robots to draw: the docks whose vacuum Home Assistant knows, each with its state. */
export function robotsShown(
  hass: HomeAssistant | undefined,
  docks: readonly RobotDock[],
): RobotShown[] {
  if (!hass) return [];
  const robots: RobotShown[] = [];
  for (const { id, vacuum } of docks) {
    const state = hass.states[vacuum]?.state;
    if (state) robots.push({ id, state });
  }
  return robots;
}
