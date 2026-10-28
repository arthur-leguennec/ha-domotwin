/**
 * Robot vacuums on the floor (D-049): each robot-vacuum piece linked to a `vacuum` entity, with
 * what that vacuum does now. The engine draws the robot: on its dock, cleaning room by room, on
 * its way home, or stopped where it was. Robot mowers likewise (D-077): each robot-mower piece
 * linked to a `lawn_mower` entity, mowing the lawns.
 */
import type { HomeAssistant } from "../ha/types";
import type { BindingsJson } from "./bindings";

/** A robot as the engine reads it (`setRobots`). */
export interface RobotShown {
  /** Its dock's piece. */
  id: string;
  /**
   * Its vacuum's state (`docked`, `cleaning`, `returning`, `paused`, `idle`, `error`…) or its
   * lawn mower's (`docked`, `mowing`, `returning`, `paused`, `error`).
   */
  state: string;
}

/** A dock and the vacuum or lawn mower linked to it. */
export interface RobotDock {
  /** The robot-vacuum or robot-mower piece. */
  id: string;
  /** Its vacuum or lawn mower. */
  entity: string;
}

/** The domain of each kind of dock's entity. */
const DOCKS: Readonly<Record<string, string>> = {
  "robot-vacuum": "vacuum.",
  "robot-mower": "lawn_mower.",
};

/**
 * The docks: the robot-vacuum pieces (by `kinds`, piece id → kind) linked to a vacuum, and the
 * robot-mower pieces linked to a lawn mower, by id. They change with the links and the pieces
 * only.
 */
export function robotDocks(
  bindings: BindingsJson | undefined,
  kinds: Readonly<Record<string, string>>,
): RobotDock[] {
  if (!bindings) return [];
  const docks: RobotDock[] = [];
  for (const [id, binding] of Object.entries(bindings.elements)) {
    const domain = DOCKS[kinds[id] ?? ""];
    if (!domain) continue;
    const entity = binding.entities.find((e) => e.entity_id.startsWith(domain));
    if (entity) docks.push({ id, entity: entity.entity_id });
  }
  return docks.sort((a, b) => a.id.localeCompare(b.id));
}

/** The robots to draw: the docks whose vacuum or mower Home Assistant knows, with its state. */
export function robotsShown(
  hass: HomeAssistant | undefined,
  docks: readonly RobotDock[],
): RobotShown[] {
  if (!hass) return [];
  const robots: RobotShown[] = [];
  for (const { id, entity } of docks) {
    const state = hass.states[entity]?.state;
    if (state) robots.push({ id, state });
  }
  return robots;
}
