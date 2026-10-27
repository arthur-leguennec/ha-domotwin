/**
 * Home Assistant's services, as the demo house answers them (D-050): what a tap, a sheet or a
 * scheduled action asks of a lamp, a curtain, a TV, a thermostat, a lock or the robot vacuum
 * changes its simulated state, and nothing else.
 */
import type { HassContext, HassEntity } from "../ha/types";

type States = Record<string, HassEntity | undefined>;

/** The entities a call targets: by id, or every entity of its domain in the areas named. */
function targets(
  domain: string,
  data: Record<string, unknown>,
  target: Record<string, unknown>,
  areaOf: (id: string) => string | undefined,
  states: States,
): string[] {
  const list = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(
      (v): v is string => typeof v === "string",
    );
  const ids = [...list(target.entity_id), ...list(data.entity_id)];
  const areas = [...list(target.area_id), ...list(data.area_id)];
  if (areas.length > 0) {
    for (const id of Object.keys(states)) {
      const inArea = areas.includes(areaOf(id) ?? "");
      if (inArea && (domain === "homeassistant" || id.startsWith(`${domain}.`))) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

/** A number of the call's data, if it is one. */
function numberIn(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** What `service` does to one entity of `domain`: its new state and attributes, or nothing. */
export function serviceEffect(
  entity: HassEntity,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): { state: string; attributes: Record<string, unknown> } | undefined {
  const attributes = { ...entity.attributes };
  const state = entity.state;
  const onOff = (on: boolean): { state: string; attributes: Record<string, unknown> } => {
    // A fan says its speed while on, none while off.
    if (domain === "fan") {
      if (!on) attributes.percentage = 0;
      else if (!Number(attributes.percentage)) attributes.percentage = 50;
    }
    return { state: on ? "on" : "off", attributes };
  };
  switch (domain) {
    case "light":
    case "switch":
    case "fan":
    case "input_boolean": {
      if (service === "turn_off") return onOff(false);
      if (service === "toggle") return onOff(state !== "on");
      if (domain === "fan" && service === "set_percentage") {
        const percentage = clamp(numberIn(data, "percentage") ?? 0, 0, 100);
        attributes.percentage = percentage;
        return onOff(percentage > 0);
      }
      if (domain === "fan" && (service === "increase_speed" || service === "decrease_speed")) {
        const step = Number(attributes.percentage_step ?? 25);
        const now = Number(attributes.percentage ?? 0);
        const percentage = clamp(now + (service === "increase_speed" ? step : -step), 0, 100);
        attributes.percentage = percentage;
        return onOff(percentage > 0);
      }
      if (service !== "turn_on") return undefined;
      const brightness = numberIn(data, "brightness");
      const percent = numberIn(data, "brightness_pct");
      const step = numberIn(data, "brightness_step_pct");
      if (brightness !== undefined) attributes.brightness = clamp(brightness, 0, 255);
      if (percent !== undefined) attributes.brightness = Math.round(clamp(percent, 0, 100) * 2.55);
      if (step !== undefined) {
        const now = Number(attributes.brightness ?? 255);
        attributes.brightness = Math.round(clamp(now + step * 2.55, 1, 255));
      }
      // A colour or a white replaces the one before (the view reads a colour first).
      const kelvin = numberIn(data, "color_temp_kelvin");
      if (kelvin !== undefined) {
        attributes.color_temp_kelvin = kelvin;
        attributes.color_mode = "color_temp";
        delete attributes.rgb_color;
        delete attributes.hs_color;
      }
      if (Array.isArray(data.rgb_color)) {
        attributes.rgb_color = data.rgb_color;
        attributes.color_mode = "rgb";
        delete attributes.hs_color;
        delete attributes.color_temp_kelvin;
      }
      if (domain === "light" && attributes.brightness === undefined) attributes.brightness = 255;
      return onOff(true);
    }
    case "cover": {
      const at = (position: number) => ({
        state: position > 0 ? "open" : "closed",
        attributes: { ...attributes, current_position: position },
      });
      if (service === "open_cover") return at(100);
      if (service === "close_cover") return at(0);
      if (service === "toggle") return at(state === "closed" ? 100 : 0);
      if (service === "set_cover_position") {
        return at(clamp(numberIn(data, "position") ?? 0, 0, 100));
      }
      if (service === "stop_cover") return { state, attributes };
      return undefined;
    }
    case "lock":
      if (service === "lock") return { state: "locked", attributes };
      if (service === "unlock" || service === "open") return { state: "unlocked", attributes };
      return undefined;
    case "media_player": {
      const volume = Number(attributes.volume_level ?? 0.3);
      switch (service) {
        case "turn_on":
          return { state: "on", attributes };
        case "turn_off":
          return { state: "off", attributes };
        case "toggle":
          return { state: state === "off" ? "on" : "off", attributes };
        case "media_play":
          return { state: "playing", attributes };
        case "media_pause":
        case "media_stop":
          return { state: "paused", attributes };
        case "media_play_pause":
          return { state: state === "playing" ? "paused" : "playing", attributes };
        case "volume_set":
          attributes.volume_level = clamp(numberIn(data, "volume_level") ?? volume, 0, 1);
          return { state, attributes };
        case "volume_up":
        case "volume_down":
          attributes.volume_level =
            Math.round(clamp(volume + (service === "volume_up" ? 0.05 : -0.05), 0, 1) * 100) / 100;
          return { state, attributes };
        case "volume_mute":
          attributes.is_volume_muted = data.is_volume_muted === true;
          return { state, attributes };
        case "select_source":
          if (typeof data.source === "string") attributes.source = data.source;
          return { state: state === "off" ? "on" : state, attributes };
        case "media_next_track":
        case "media_previous_track":
          return { state, attributes };
        default:
          return undefined;
      }
    }
    case "climate": {
      if (service === "set_temperature") {
        const temperature = numberIn(data, "temperature");
        if (temperature !== undefined) attributes.temperature = clamp(temperature, 7, 30);
        return { state: state === "off" ? "heat" : state, attributes };
      }
      if (service === "set_hvac_mode" && typeof data.hvac_mode === "string") {
        return { state: data.hvac_mode, attributes };
      }
      if (service === "turn_off") return { state: "off", attributes };
      if (service === "turn_on") return { state: "heat", attributes };
      return undefined;
    }
    case "vacuum":
      if (service === "start") return { state: "cleaning", attributes };
      if (service === "pause" || service === "stop") return { state: "paused", attributes };
      if (service === "return_to_base") return { state: "returning", attributes };
      if (service === "start_pause") {
        return { state: state === "cleaning" ? "paused" : "cleaning", attributes };
      }
      if (service === "locate" || service === "clean_spot") return { state, attributes };
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Applies `domain.service` to the demo's `states` (a new state object for each entity changed,
 * written in `context` when given); `homeassistant.*` acts on any domain. Returns the entities
 * changed.
 */
export function callService(
  states: States,
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  target: Record<string, unknown> = {},
  areaOf: (id: string) => string | undefined = () => undefined,
  now = new Date().toISOString(),
  context?: HassContext,
): string[] {
  const changed: string[] = [];
  for (const id of targets(domain, data, target, areaOf, states)) {
    const entity = states[id];
    if (!entity || entity.state === "unavailable") continue;
    const own = id.slice(0, id.indexOf("."));
    const result = serviceEffect(entity, domain === "homeassistant" ? own : domain, service, data);
    if (!result) continue;
    const moved = result.state !== entity.state;
    states[id] = {
      ...entity,
      state: result.state,
      attributes: result.attributes,
      last_changed: moved ? now : entity.last_changed,
      last_updated: now,
      ...(context ? { context } : {}),
    };
    changed.push(id);
  }
  return changed;
}
