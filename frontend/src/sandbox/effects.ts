/**
 * What Home Assistant's services do to the sandbox's copy of the home (D-057): the demo house's
 * effects (lamps, curtains, locks, thermostats, media, robots), and the helpers, counters, alarms
 * and the rest an automation sets. A service whose effect cannot be known is said to be so.
 */
import { serviceEffect } from "../demo/services";
import type { HassEntity } from "../ha/types";
import { Unplayable, pythonText } from "./templates";
import { isoIn, moment, parseClock, parseDate, parseDuration, parseMoment } from "./time";

export interface Effect {
  state: string;
  attributes: Record<string, unknown>;
}

/** Services that only say something (a notification, a voice): no entity changes. */
export const SAYING_DOMAINS = new Set([
  "notify",
  "tts",
  "persistent_notification",
  "logbook",
  "system_log",
  "conversation",
  "assist_satellite",
]);

/** Services that change nothing the sandbox shows, and need not be named. */
export const QUIET_SERVICES = new Set([
  "homeassistant.update_entity",
  "homeassistant.check_config",
  "homeassistant.reload_core_config",
  "homeassistant.reload_all",
  "homeassistant.save_persistent_states",
  "recorder.purge",
  "recorder.purge_entities",
  "frontend.set_theme",
  "browser_mod.refresh",
]);

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

function numberIn(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** An option of a select, the next or the previous one, as Home Assistant's selects do. */
function option(
  entity: HassEntity,
  service: string,
  data: Record<string, unknown>,
): string | undefined {
  const options = Array.isArray(entity.attributes.options)
    ? entity.attributes.options.map(String)
    : [];
  if (service === "select_option") {
    const wanted = typeof data.option === "string" ? data.option : undefined;
    return wanted !== undefined && (options.length === 0 || options.includes(wanted))
      ? wanted
      : undefined;
  }
  if (options.length === 0) return undefined;
  const at = options.indexOf(entity.state);
  const cycle = data.cycle !== false;
  if (service === "select_first") return options[0];
  if (service === "select_last") return options.at(-1);
  if (service === "select_next") {
    return at + 1 < options.length ? options[at + 1] : cycle ? options[0] : entity.state;
  }
  if (service === "select_previous") {
    return at > 0 ? options[at - 1] : cycle ? options.at(-1) : entity.state;
  }
  return undefined;
}

/**
 * What `domain.service` does to `entity`: its state and attributes after, or `undefined` when
 * the service does nothing the sandbox knows to it.
 */
export function effectOn(
  entity: HassEntity,
  domain: string,
  service: string,
  data: Record<string, unknown>,
  now: number,
  zone: string,
): Effect | undefined {
  const attributes = { ...entity.attributes };
  const state = entity.state;
  const same = (): Effect => ({ state, attributes });
  switch (domain) {
    case "input_number":
    case "number": {
      if (service !== "set_value" && service !== "increment" && service !== "decrement") {
        return undefined;
      }
      const min = numberIn(attributes, "min") ?? -Infinity;
      const max = numberIn(attributes, "max") ?? Infinity;
      const step = numberIn(attributes, "step") ?? 1;
      const current = Number(state);
      const value =
        service === "set_value"
          ? numberIn(data, "value")
          : (Number.isFinite(current) ? current : 0) + (service === "increment" ? step : -step);
      if (value === undefined) return undefined;
      return { state: String(clamp(value, min, max)), attributes };
    }
    case "input_select":
    case "select": {
      const chosen = option(entity, service, data);
      return chosen === undefined ? undefined : { state: chosen, attributes };
    }
    case "input_text":
    case "text":
      if (service !== "set_value" || data.value === undefined) return undefined;
      return { state: pythonText(data.value), attributes };
    case "input_datetime":
      return service === "set_datetime" ? dateTimeSet(entity, data, zone) : undefined;
    case "input_button":
    case "button":
      // A button's state is when it was last pressed.
      return service === "press" ? { state: isoIn(now, zone), attributes } : undefined;
    case "counter": {
      const current = Number(state) || 0;
      const step = numberIn(attributes, "step") ?? 1;
      const min = numberIn(attributes, "minimum") ?? -Infinity;
      const max = numberIn(attributes, "maximum") ?? Infinity;
      const set = (value: number): Effect => ({
        state: String(clamp(value, min, max)),
        attributes,
      });
      if (service === "increment") return set(current + step);
      if (service === "decrement") return set(current - step);
      if (service === "reset") return set(numberIn(attributes, "initial") ?? 0);
      if (service === "set_value") {
        const value = numberIn(data, "value");
        return value === undefined ? undefined : set(value);
      }
      return undefined;
    }
    case "timer": {
      if (service === "start") {
        const duration = parseDuration(data.duration) ?? parseDuration(attributes.duration) ?? 0;
        attributes.finishes_at = isoIn(now + duration, zone);
        attributes.remaining = data.duration ?? attributes.duration ?? "0:00:00";
        return { state: "active", attributes };
      }
      if (service === "pause") return state === "active" ? { state: "paused", attributes } : same();
      if (service === "cancel" || service === "finish") {
        delete attributes.finishes_at;
        return { state: "idle", attributes };
      }
      return undefined;
    }
    case "alarm_control_panel": {
      const arms: Record<string, string> = {
        alarm_arm_away: "armed_away",
        alarm_arm_home: "armed_home",
        alarm_arm_night: "armed_night",
        alarm_arm_vacation: "armed_vacation",
        alarm_arm_custom_bypass: "armed_custom_bypass",
        alarm_disarm: "disarmed",
        alarm_trigger: "triggered",
      };
      const next = arms[service];
      return next ? { state: next, attributes } : undefined;
    }
    case "siren":
    case "remote":
    case "humidifier":
    case "water_heater":
    case "automation":
    case "script":
    case "input_boolean": {
      if (domain === "humidifier" && service === "set_humidity") {
        const humidity = numberIn(data, "humidity");
        if (humidity === undefined) return undefined;
        attributes.humidity = humidity;
        return same();
      }
      if (domain === "water_heater" && service === "set_temperature") {
        const temperature = numberIn(data, "temperature");
        if (temperature === undefined) return undefined;
        attributes.temperature = temperature;
        return same();
      }
      const on = state !== "off";
      if (service === "turn_on")
        return { state: domain === "water_heater" ? "eco" : "on", attributes };
      if (service === "turn_off") return { state: "off", attributes };
      if (service === "toggle") return { state: on ? "off" : "on", attributes };
      return undefined;
    }
    case "valve": {
      const at = (position: number): Effect => ({
        state: position > 0 ? "open" : "closed",
        attributes: { ...attributes, current_position: position },
      });
      if (service === "open_valve") return at(100);
      if (service === "close_valve") return at(0);
      if (service === "toggle") return at(state === "closed" ? 100 : 0);
      if (service === "set_valve_position") {
        const position = numberIn(data, "position");
        return position === undefined ? undefined : at(clamp(position, 0, 100));
      }
      if (service === "stop_valve") return same();
      return undefined;
    }
    case "lawn_mower":
      if (service === "start_mowing") return { state: "mowing", attributes };
      if (service === "pause") return { state: "paused", attributes };
      if (service === "dock") return { state: "returning", attributes };
      return undefined;
    case "climate":
      if (service === "set_preset_mode" && typeof data.preset_mode === "string") {
        attributes.preset_mode = data.preset_mode;
        return same();
      }
      if (service === "set_fan_mode" && typeof data.fan_mode === "string") {
        attributes.fan_mode = data.fan_mode;
        return same();
      }
      if (service === "set_temperature") {
        // Within the thermostat's own range, in the home's unit; Home Assistant refuses others.
        const min = numberIn(attributes, "min_temp") ?? -Infinity;
        const max = numberIn(attributes, "max_temp") ?? Infinity;
        let given = false;
        for (const key of ["temperature", "target_temp_low", "target_temp_high"]) {
          const value = numberIn(data, key);
          if (value === undefined) continue;
          if (value < min || value > max) {
            throw new Unplayable("refused", `${entity.entity_id} ${key} ${value} (${min}–${max})`);
          }
          attributes[key] = value;
          given = true;
        }
        if (!given) return undefined;
        return { state: typeof data.hvac_mode === "string" ? data.hvac_mode : state, attributes };
      }
      break;
    case "cover":
      if (service.endsWith("_cover_tilt") || service === "set_cover_tilt_position") {
        const tilt =
          service === "open_cover_tilt"
            ? 100
            : service === "close_cover_tilt"
              ? 0
              : numberIn(data, "tilt_position");
        if (tilt === undefined) return service === "stop_cover_tilt" ? same() : undefined;
        attributes.current_tilt_position = clamp(tilt, 0, 100);
        return same();
      }
      break;
    case "fan":
      if (service === "oscillate") {
        attributes.oscillating = data.oscillating === true;
        return same();
      }
      if (service === "set_preset_mode" && typeof data.preset_mode === "string") {
        attributes.preset_mode = data.preset_mode;
        return { state: "on", attributes };
      }
      if (service === "set_direction" && typeof data.direction === "string") {
        attributes.direction = data.direction;
        return same();
      }
      break;
    case "media_player":
      if (service === "play_media") return { state: "playing", attributes };
      break;
    case "vacuum":
      if (service === "turn_on") return { state: "cleaning", attributes };
      if (service === "turn_off") return { state: "returning", attributes };
      break;
    case "light":
      // A light given a colour as Home Assistant also takes it is still lit.
      if (service === "turn_on" && Array.isArray(data.hs_color)) {
        const after = serviceEffect(entity, domain, service, data);
        if (!after) return undefined;
        after.attributes.hs_color = data.hs_color;
        after.attributes.color_mode = "hs";
        delete after.attributes.rgb_color;
        delete after.attributes.color_temp_kelvin;
        return after;
      }
      break;
  }
  return serviceEffect(entity, domain, service, data);
}

/**
 * An input datetime set (`set_datetime`): its state and the attributes Home Assistant gives it
 * (the date's year, month and day, the time's hour, minute and second, the timestamp).
 */
function dateTimeSet(
  entity: HassEntity,
  data: Record<string, unknown>,
  zone: string,
): Effect | undefined {
  const attributes = { ...entity.attributes };
  const hasDate = attributes.has_date !== false;
  const hasTime = attributes.has_time !== false;
  let date = /^\d{4}-\d{2}-\d{2}/.exec(entity.state)?.[0];
  let time = /\d{1,2}:\d{2}(:\d{2})?$/.exec(entity.state)?.[0];
  const at =
    typeof data.timestamp === "number"
      ? data.timestamp * 1000
      : typeof data.datetime === "string"
        ? parseMoment(data.datetime, zone)
        : undefined;
  if (at !== undefined) {
    const iso = isoIn(at, zone);
    date = iso.slice(0, 10);
    time = iso.slice(11, 19);
  } else if (typeof data.datetime === "string") return undefined;
  if (typeof data.date === "string") date = data.date;
  if (typeof data.time === "string") time = data.time;
  if (at === undefined && typeof data.date !== "string" && typeof data.time !== "string") {
    return undefined;
  }
  const day = date ? parseDate(date) : undefined;
  const seconds = time ? parseClock(time) : 0;
  if ((hasDate && !day) || seconds === undefined) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [hour, minute, second] = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ];
  const clock = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  if (day)
    Object.assign(attributes, hasDate ? { year: day.year, month: day.month, day: day.day } : {});
  if (hasTime) Object.assign(attributes, { hour, minute, second });
  attributes.timestamp =
    hasDate && day
      ? moment(
          zone,
          day.year,
          day.month,
          day.day,
          hasTime ? hour : 0,
          hasTime ? minute : 0,
          hasTime ? second : 0,
        ) / 1000
      : seconds;
  const state = hasDate && hasTime ? `${date ?? ""} ${clock}` : hasDate ? (date ?? "") : clock;
  return { state, attributes };
}
