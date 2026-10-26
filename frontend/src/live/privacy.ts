/**
 * Private rooms (D-039): which rooms the viewer may not see. The same rule as the integration's
 * (`privacy.py`): a private room is kept for the people chosen (none: for nobody), always or only
 * while an entity is on; a viewer is one of them through the Home Assistant user of their
 * `person`. A shared screen's user is nobody's, so the room stays private there.
 */

import type { PrivateRoom } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { roomArea, type BindingsJson } from "./bindings";
import type { PlanRoom } from "./layers";
import { planElements } from "./plan";

/** People or things in a room the viewer may not see: there, but not where (D-039). */
export function outOfSight<
  T extends {
    room?: string;
    roomName?: string;
    storey?: string;
    since?: string;
    source?: string;
    private?: true;
  },
>(items: T[], closed: Set<string>): T[] {
  if (closed.size === 0) return items;
  return items.map((item) => {
    if (item.room === undefined || !closed.has(item.room)) return item;
    const hidden = { ...item, private: true as const };
    delete hidden.room;
    delete hidden.roomName;
    delete hidden.storey;
    delete hidden.since;
    // The sensor that said so tells the room too (a motion sensor of the bedroom).
    delete hidden.source;
    return hidden;
  });
}

/** The rooms the user viewing may not see now (room ids). */
export function privateRooms(
  rooms: Record<string, PrivateRoom> | undefined,
  hass: HomeAssistant | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (!rooms) return hidden;
  const user = hass?.user?.id;
  for (const [room, rule] of Object.entries(rooms)) {
    // Open while its entity is off; unavailable or unknown, it stays private.
    if (rule.while !== undefined && hass?.states[rule.while]?.state === "off") continue;
    if (
      user !== undefined &&
      rule.people.some((person) => hass?.states[person]?.attributes.user_id === user)
    ) {
      continue;
    }
    hidden.add(room);
  }
  return hidden;
}

/** The areas of the private rooms the viewer may not see (`closed`: their room ids). */
export function closedAreas(
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: readonly PlanRoom[],
  closed: ReadonlySet<string>,
): Set<string> {
  const areas = new Set<string>();
  for (const room of rooms) {
    if (!closed.has(room.id)) continue;
    const area = roomArea(hass, bindings, room.id, room.name);
    if (area !== undefined) areas.add(area);
  }
  return areas;
}

/** What the viewer may not see of the home (D-039), for the Home and Rooms tabs (D-055). */
export interface Unseen {
  /** The areas of the private rooms they may not see. */
  areas: ReadonlySet<string>;
  /** The entities linked to what those rooms hold, whatever their area. */
  entities: ReadonlySet<string>;
}

export const NOTHING_UNSEEN: Unseen = { areas: new Set(), entities: new Set() };

/** Whether the viewer may see an entity, by its area (`area`) and its links. */
export function seen(unseen: Unseen, entity: string, area: string | undefined): boolean {
  return !unseen.entities.has(entity) && (area === undefined || !unseen.areas.has(area));
}

/**
 * The entities linked to the private rooms the viewer may not see (`closed`), and to the pieces
 * in them on any storey (where its overlay moved or added them), whatever their area.
 */
export function closedEntities(
  bindings: BindingsJson,
  storeys: readonly { plan?: unknown; layout?: Record<string, unknown> }[],
  closed: ReadonlySet<string>,
): Set<string> {
  const entities = new Set<string>();
  if (closed.size === 0) return entities;
  const add = (id: string): void => {
    for (const entity of bindings.elements[id]?.entities ?? []) entities.add(entity.entity_id);
  };
  for (const room of closed) add(room);
  for (const { plan, layout = {} } of storeys) {
    const edited = (id: string): Record<string, unknown> | undefined => {
      const entry = layout[id];
      return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
    };
    // Its pieces, doors and windows.
    for (const { id, type, fields } of planElements(plan)) {
      if (type === "room") continue;
      const room = edited(id)?.room ?? fields.room;
      if (typeof room === "string" && closed.has(room)) add(id);
    }
    for (const id of Object.keys(layout)) {
      const entry = edited(id);
      if (entry && "add" in entry && typeof entry.room === "string" && closed.has(entry.room)) {
        add(id);
      }
    }
  }
  return entities;
}
