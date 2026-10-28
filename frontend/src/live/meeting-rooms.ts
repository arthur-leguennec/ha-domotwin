/**
 * A workplace's meeting rooms (`docs/DECISIONS.md`, D-089): rooms of the plans an administrator
 * marked so, each free, taken (its presence sensors see someone) or booked (an event of its
 * calendar is under way), with its next booking today; booked from DomoTwin in its calendar, when
 * the calendar takes new events.
 */
import { domainOf, nowOf, type HomeAssistant } from "../ha/types";
import { areaEntities, roomArea, type BindingsJson } from "./bindings";
import type { PlanRoom } from "./layers";
import { zonedTime } from "./peaks";
import { seen, type Unseen } from "./privacy";

/** What says someone is in a room, as the presence layer reads it. */
const PRESENCE_CLASSES = new Set(["occupancy", "motion", "presence"]);
/** Home Assistant's calendars that take new events (`CalendarEntityFeature.CREATE_EVENT`). */
const CREATE_EVENT = 1;
/** The lengths a meeting room is booked for from DomoTwin (minutes). */
export const BOOKINGS = [30, 60] as const;

/** A meeting room as the settings keep it (`settings.workplace.meeting_rooms`). */
export interface MeetingRoomSetting {
  calendar?: string;
}

/** A meeting room now. */
export interface MeetingRoom {
  room: string;
  name: string;
  calendar?: string;
  state: "free" | "taken" | "booked";
  /** Booked: when the booking under way ends (ms). */
  until?: number;
  /** Not booked now: when it is booked next, later today (ms). */
  next?: number;
  /** Its calendar takes new events: it can be booked from DomoTwin. */
  bookable: boolean;
}

/**
 * When a calendar's attribute says (ms), if it says: Home Assistant writes the wall clock
 * ("2026-10-28 14:00:00") in its own time zone.
 */
function when(hass: HomeAssistant, value: unknown): number | undefined {
  const zoned = zonedTime(value, hass.config?.time_zone);
  if (zoned !== undefined) return zoned;
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
}

/** The end of the day `at` is in, on this device (ms). */
function endOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(24, 0, 0, 0);
  return day.getTime();
}

/** Whether a room's presence sensors see someone now. */
function occupied(hass: HomeAssistant, area: string | undefined): boolean {
  if (!area) return false;
  return areaEntities(hass, area).some((id) => {
    if (domainOf(id) !== "binary_sensor") return false;
    const entity = hass.states[id];
    const kind = entity?.attributes.device_class;
    return entity?.state === "on" && typeof kind === "string" && PRESENCE_CLASSES.has(kind);
  });
}

/**
 * The meeting rooms now, in the plans' order: those of the plans' rooms the settings mark, but
 * not one the viewer may not see (D-039) nor whose calendar they may not see (D-071).
 */
export function meetingRoomsOf(
  hass: HomeAssistant,
  rooms: readonly PlanRoom[],
  bindings: BindingsJson,
  marked: Readonly<Record<string, MeetingRoomSetting>> | undefined,
  unseen: Unseen,
  closed: ReadonlySet<string>,
): MeetingRoom[] {
  if (!marked) return [];
  const now = nowOf(hass);
  const found: MeetingRoom[] = [];
  for (const room of rooms) {
    const setting = marked[room.id];
    if (!setting || closed.has(room.id)) continue;
    const area = roomArea(hass, bindings, room.id, room.name);
    if (area !== undefined && unseen.areas.has(area)) continue;
    const calendar =
      setting.calendar && seen(unseen, setting.calendar, undefined) ? setting.calendar : undefined;
    const entity = calendar ? hass.states[calendar] : undefined;
    const meeting: MeetingRoom = {
      room: room.id,
      name: room.name,
      state: "free",
      bookable:
        entity !== undefined &&
        (Number(entity.attributes.supported_features ?? 0) & CREATE_EVENT) !== 0,
    };
    if (calendar) meeting.calendar = calendar;
    const start = when(hass, entity?.attributes.start_time);
    const end = when(hass, entity?.attributes.end_time);
    if (entity?.state === "on" && end !== undefined && end > now) {
      meeting.state = "booked";
      meeting.until = end;
    } else if (occupied(hass, area)) {
      meeting.state = "taken";
    }
    // Its next booking later today, as the calendar says it (its next event, when not under way).
    if (meeting.state !== "booked" && start !== undefined && start > now && start < endOfDay(now)) {
      meeting.next = start;
    }
    found.push(meeting);
  }
  return found;
}

/**
 * Books a meeting room now, for `minutes`, in its calendar (`calendar.create_event`): named as
 * `summary`, nobody's name in it (D-086). Never over its next booking.
 */
export function bookingOf(
  meeting: MeetingRoom,
  minutes: number,
  now: number,
): { start: number; end: number } | undefined {
  if (!meeting.bookable || meeting.state === "booked") return undefined;
  // From the minute under way, to the minutes asked, or until the next booking.
  const start = Math.floor(now / 60_000) * 60_000;
  const end = Math.min(start + minutes * 60_000, meeting.next ?? Number.POSITIVE_INFINITY);
  return end > start ? { start, end } : undefined;
}

/**
 * A moment as Home Assistant's `calendar.create_event` takes it: with its offset (UTC), so that
 * the device's time zone and Home Assistant's may differ.
 */
export function serviceTime(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}+00:00`;
}
