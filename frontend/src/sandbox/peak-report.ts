/**
 * What the rooms did through Hydro-Québec's announced peak, played in the sandbox (D-058): for
 * each room, when its heating pre-heated, was shed or still heated, read every five minutes from
 * the day played, as the peak's layer reads it.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";
import type { BindingsJson } from "../live/bindings";
import type { PlanRoom } from "../live/layers";
import { peakRooms, type PeakRole } from "../live/peak-rooms";
import { phaseOf, type Peak } from "../live/peaks";
import type { DayPlayed } from "./engine";

/** How often the rooms are read through the pre-heating and the peak (ms). */
const STEP = 5 * 60_000;

/** A room's heating through the peak: what it did, from when to when. */
export interface PeakSpan {
  role: PeakRole;
  from: number;
  to: number;
}

export interface PeakRoomReport {
  room: string;
  name: string;
  spans: PeakSpan[];
}

/**
 * What each room did from the pre-heating to the end of the peak, on the day played (`day`), with
 * `hass` (the sandbox's, its states replaced by the day's at each moment read); the rooms that did
 * nothing are left out. The home's own meters (`exclude`) are no room's; the private rooms the
 * viewer may not see (`closed`, D-039) say nothing.
 */
export function peakReport(
  day: DayPlayed,
  hass: HomeAssistant,
  bindings: BindingsJson,
  rooms: readonly PlanRoom[],
  peak: Peak,
  exclude: ReadonlySet<string> = new Set(),
  closed: ReadonlySet<string> = new Set(),
): PeakRoomReport[] {
  const from = Math.max(peak.preheat, day.start);
  const to = Math.min(peak.end, day.end);
  const states: Record<string, HassEntity | undefined> = { ...day.initial };
  const spans = new Map<string, PeakSpan[]>();
  let applied = 0;
  for (let at = from; at < to; at += STEP) {
    while (applied < day.changes.length && (day.changes[applied]?.at ?? Infinity) <= at) {
      const change = day.changes[applied];
      if (change) states[change.entity.entity_id] = change.entity;
      applied += 1;
    }
    const { phase } = phaseOf(peak, at);
    const now = peakRooms(
      { ...hass, states: { ...states } },
      bindings,
      rooms,
      phase,
      closed,
      exclude,
    );
    const until = Math.min(at + STEP, to);
    for (const [room, role] of Object.entries(now.roles)) {
      const list = spans.get(room) ?? [];
      const last = list[list.length - 1];
      if (last && last.role === role && last.to === at) last.to = until;
      else list.push({ role, from: at, to: until });
      spans.set(room, list);
    }
  }
  return rooms
    .filter((room) => spans.has(room.id))
    .map((room) => ({ room: room.id, name: room.name, spans: spans.get(room.id) ?? [] }));
}
