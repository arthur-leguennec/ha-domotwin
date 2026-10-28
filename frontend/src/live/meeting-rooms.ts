/**
 * A workplace's meeting rooms (`docs/DECISIONS.md`, D-089): rooms of the plans an administrator
 * marked so, each free, taken (its presence sensors see someone) or booked (an event of its
 * calendar is under way), with its next booking; booked from DomoTwin in its calendar, when the
 * calendar takes new events.
 */
import { domainOf, nowOf, type HomeAssistant } from "../ha/types";
import { areaOf, type BindingsJson } from "./bindings";
import { roomAreaOf, roomEntities, type PlanRoom } from "./layers";
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

/** A booking made from here, until its calendar says it (ms). */
export interface Held {
  start: number;
  end: number;
}

/** A meeting room now. */
export interface MeetingRoom {
  room: string;
  name: string;
  calendar?: string;
  state: "free" | "taken" | "booked";
  /** Booked: when the booking under way ends (ms). */
  until?: number;
  /** Booked by an event of the whole day. */
  allDay?: boolean;
  /** Not booked now: when its calendar's next booking starts (ms). */
  next?: number;
  /** Its calendar takes new events, and the viewer may use it: booked from DomoTwin. */
  bookable: boolean;
}

/** The times read from calendars' attributes, by time zone and text: read once each. */
const times = new Map<string, number | undefined>();

/**
 * When a calendar's attribute says (ms), if it says: Home Assistant writes the wall clock
 * ("2026-10-28 14:00:00") in its own time zone.
 */
function when(hass: HomeAssistant, value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const zone = hass.config?.time_zone;
  const key = `${zone ?? ""}|${value}`;
  if (times.has(key)) return times.get(key);
  let at = zonedTime(value, zone);
  if (at === undefined) {
    const parsed = Date.parse(value);
    at = Number.isFinite(parsed) ? parsed : undefined;
  }
  // A few calendars, a few events a day: kept small.
  if (times.size > 256) times.clear();
  times.set(key, at);
  return at;
}

/** Whether the presence sensors of a room the viewer may see say someone is in now. */
function occupied(
  hass: HomeAssistant,
  bindings: BindingsJson,
  room: PlanRoom,
  area: string | undefined,
  unseen: Unseen,
): boolean {
  return roomEntities(hass, bindings, room).some(({ id, hidden }) => {
    if (hidden || domainOf(id) !== "binary_sensor" || !seen(unseen, id, area)) return false;
    const entity = hass.states[id];
    const kind = entity?.attributes.device_class;
    return entity?.state === "on" && typeof kind === "string" && PRESENCE_CLASSES.has(kind);
  });
}

/**
 * The meeting rooms now, in the plans' order: those of the plans' rooms the settings mark, but
 * not one the viewer may not see (D-039) nor a calendar they may not see (D-071). `held`: the
 * bookings made from here that their calendars do not say yet (one that reads its server now and
 * then), by room.
 */
export function meetingRoomsOf(
  hass: HomeAssistant,
  rooms: readonly PlanRoom[],
  bindings: BindingsJson,
  marked: Readonly<Record<string, MeetingRoomSetting>> | undefined,
  unseen: Unseen,
  closed: ReadonlySet<string>,
  held: Readonly<Record<string, Held>> = {},
): MeetingRoom[] {
  if (!marked) return [];
  const now = nowOf(hass);
  const found: MeetingRoom[] = [];
  for (const room of rooms) {
    const setting = marked[room.id];
    if (!setting || closed.has(room.id)) continue;
    const area = roomAreaOf(hass, bindings, room);
    if (area !== undefined && unseen.areas.has(area)) continue;
    const calendar =
      setting.calendar && seen(unseen, setting.calendar, areaOf(hass, setting.calendar))
        ? setting.calendar
        : undefined;
    const entity = calendar ? hass.states[calendar] : undefined;
    // A calendar that cannot be read now (its server down) says nothing.
    const said = entity !== undefined && (entity.state === "on" || entity.state === "off");
    const meeting: MeetingRoom = {
      room: room.id,
      name: room.name,
      state: "free",
      bookable:
        said &&
        calendar !== undefined &&
        (Number(entity.attributes.supported_features ?? 0) & CREATE_EVENT) !== 0 &&
        hass.canAct?.(calendar) !== false,
    };
    if (calendar) meeting.calendar = calendar;
    const start = said ? when(hass, entity.attributes.start_time) : undefined;
    const end = said ? when(hass, entity.attributes.end_time) : undefined;
    const hold = held[room.id];
    // Under way: as the calendar says it, or as its times say it a moment before it does.
    if (
      end !== undefined &&
      end > now &&
      (entity?.state === "on" || (start !== undefined && start <= now))
    ) {
      meeting.state = "booked";
      meeting.until = end;
      if (entity?.attributes.all_day === true) meeting.allDay = true;
    } else if (hold && hold.start <= now && now < hold.end) {
      meeting.state = "booked";
      meeting.until = hold.end;
    } else if (occupied(hass, bindings, room, area, unseen)) {
      meeting.state = "taken";
    }
    // Its next booking, as the calendar says it (its next event, when none is under way).
    if (meeting.state !== "booked" && start !== undefined && start > now) meeting.next = start;
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
