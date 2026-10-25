/**
 * Private rooms (D-039): which rooms the viewer may not see. The same rule as the integration's
 * (`privacy.py`): a private room is kept for the people chosen (none: for nobody), always or only
 * while an entity is on; a viewer is one of them through the Home Assistant user of their
 * `person`. A shared screen's user is nobody's, so the room stays private there.
 */

import type { PrivateRoom } from "../ha/client";
import type { HomeAssistant } from "../ha/types";

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
