// The fictional Home Assistant of the demo apartment: entity states, areas and the entity
// registry, matching `examples/demo-apartment.bindings.json`. Used by the E2E harness only.

export const areas = {
  living_room: "Living room",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  hallway: "Hallway",
  bedroom: "Bedroom",
};

const warm = { color_mode: "color_temp", supported_color_modes: ["color_temp"] };
const colour = { color_mode: "hs", supported_color_modes: ["hs", "color_temp"] };

// [entity id, area, state, attributes]
const entities = [
  [
    "light.living_room_pendant",
    "living_room",
    "on",
    { ...warm, brightness: 200, color_temp_kelvin: 2700 },
  ],
  [
    "light.living_room_floor_lamp",
    "living_room",
    "on",
    { ...colour, brightness: 140, rgb_color: [255, 170, 110] },
  ],
  [
    "sensor.floor_lamp_power",
    "living_room",
    "9.5",
    { device_class: "power", unit_of_measurement: "W" },
  ],
  ["light.sideboard_lamp", "living_room", "off", { ...warm }],
  [
    "media_player.living_room_tv",
    "living_room",
    "playing",
    { volume_level: 0.3, media_title: "Nature documentary" },
  ],
  ["sensor.tv_power", "living_room", "84", { device_class: "power", unit_of_measurement: "W" }],
  [
    "cover.living_room_curtains",
    "living_room",
    "closed",
    { current_position: 0, device_class: "curtain" },
  ],
  ["binary_sensor.living_room_window_contact", "living_room", "off", { device_class: "window" }],
  ["scene.living_room_evening", "living_room", "2026-01-01T18:00:00+00:00", {}],
  ["binary_sensor.entrance_door_contact", "hallway", "on", { device_class: "door" }],
  ["lock.entrance_door", "hallway", "unlocked", {}],
  ["light.hall_spots", "hallway", "off", { ...warm }],
  ["light.kitchen_ceiling", "kitchen", "off", { ...warm }],
  ["light.kitchen_spots", "kitchen", "on", { ...warm, brightness: 255, color_temp_kelvin: 3500 }],
  ["sensor.fridge_power", "kitchen", "48", { device_class: "power", unit_of_measurement: "W" }],
  ["light.bathroom_ceiling", "bathroom", "unavailable", { ...warm }],
  [
    "sensor.washing_machine_power",
    "bathroom",
    "0",
    { device_class: "power", unit_of_measurement: "W" },
  ],
  ["light.bedside_left", "bedroom", "on", { ...warm, brightness: 90, color_temp_kelvin: 2400 }],
  ["light.bedside_right", "bedroom", "off", { ...warm }],
  ["fan.bedroom_ceiling_fan", "bedroom", "off", { percentage: 0 }],
  ["light.bedroom_fan_light", "bedroom", "off", { ...warm }],
  ["cover.bedroom_curtains", "bedroom", "open", { current_position: 100, device_class: "curtain" }],
  [
    "climate.bedroom",
    "bedroom",
    "heat",
    { temperature: 19, current_temperature: 18.5, min_temp: 7, max_temp: 30 },
  ],
  // The layers: air sensors of each room, presence, safety (all quiet at first), the weather.
  ...[
    ["living_room", 21.4, 46, 720, 8],
    ["kitchen", 23.8, 58, 1080, 21],
    ["bathroom", 24.6, 72, null, null],
    ["hallway", 19.6, null, null, null],
    ["bedroom", 18.2, 49, 940, 6],
  ].flatMap(([area, temperature, humidity, co2, pm25]) =>
    [
      ["temperature", temperature, "°C"],
      ["humidity", humidity, "%"],
      ["carbon_dioxide", co2, "ppm"],
      ["pm25", pm25, "µg/m³"],
    ]
      .filter(([, value]) => value !== null)
      .map(([deviceClass, value, unit]) => [
        `sensor.${area}_${deviceClass}`,
        area,
        String(value),
        { device_class: deviceClass, unit_of_measurement: unit, state_class: "measurement" },
      ]),
  ),
  ["binary_sensor.living_room_motion", "living_room", "off", { device_class: "motion" }],
  ["binary_sensor.bedroom_occupancy", "bedroom", "off", { device_class: "occupancy" }],
  ["binary_sensor.kitchen_smoke", "kitchen", "off", { device_class: "smoke" }],
  ["binary_sensor.hallway_smoke", "hallway", "off", { device_class: "smoke" }],
  ["binary_sensor.bathroom_leak", "bathroom", "off", { device_class: "moisture" }],
  ["weather.home", null, "sunny", { temperature: 16 }],
];

function title(id) {
  const name = id.split(".")[1].replaceAll("_", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Fresh states, the entity registry and the area registry of the demo home. */
export function demoHome() {
  const states = {};
  const registry = {};
  for (const [id, area, state, attributes] of entities) {
    states[id] = { entity_id: id, state, attributes: { friendly_name: title(id), ...attributes } };
    if (area) registry[id] = { entity_id: id, area_id: area };
  }
  const areaRegistry = Object.fromEntries(
    Object.entries(areas).map(([area_id, name]) => [area_id, { area_id, name }]),
  );
  return { states, entities: registry, devices: {}, areas: areaRegistry };
}

const TOGGLES = {
  on: "off",
  off: "on",
  open: "closed",
  closed: "open",
  playing: "paused",
  paused: "playing",
};

/**
 * What a service call does to the demo states (only what the tests use). Returns the entity ids
 * it changed.
 */
export function applyService(home, domain, service, data = {}, target = {}) {
  const ids = [].concat(target?.entity_id ?? data.entity_id ?? []).concat(
    target?.area_id
      ? Object.values(home.entities)
          .filter((e) => e.area_id === target.area_id && e.entity_id.startsWith(`${domain}.`))
          .map((e) => e.entity_id)
      : [],
  );
  const changed = [];
  for (const id of ids) {
    const entity = home.states[id];
    if (!entity || entity.state === "unavailable") continue;
    let state = entity.state;
    const attributes = { ...entity.attributes };
    switch (service) {
      case "toggle":
      case "media_play_pause":
        state = TOGGLES[state] ?? state;
        break;
      case "turn_on":
        state = "on";
        if (data.brightness_pct !== undefined)
          attributes.brightness = Math.round(data.brightness_pct * 2.55);
        if (data.color_temp_kelvin !== undefined)
          attributes.color_temp_kelvin = data.color_temp_kelvin;
        if (data.rgb_color !== undefined) attributes.rgb_color = data.rgb_color;
        break;
      case "turn_off":
        state = "off";
        break;
      case "open_cover":
        state = "open";
        attributes.current_position = 100;
        break;
      case "close_cover":
        state = "closed";
        attributes.current_position = 0;
        break;
      case "set_cover_position":
        attributes.current_position = data.position;
        state = data.position > 0 ? "open" : "closed";
        break;
      case "lock":
        state = "locked";
        break;
      case "unlock":
        state = "unlocked";
        break;
      default:
        continue;
    }
    if (state === "on" && id.startsWith("light.") && attributes.brightness === undefined) {
      attributes.brightness = 255;
    }
    if (id.startsWith("cover.") && service === "toggle") {
      attributes.current_position = state === "open" ? 100 : 0;
    }
    home.states[id] = { ...entity, state, attributes };
    changed.push(id);
  }
  return changed;
}
