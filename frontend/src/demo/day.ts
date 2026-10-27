/**
 * A day in the demo house (D-050): what the sun, the family, the appliances, the robot vacuum and
 * the automations do at each minute of a spring day. Pure functions of the time of day, so that
 * any moment can be shown at once; the home keeps what the visitor changes until the day changes
 * it again.
 */
import type { HomeAssistant } from "../ha/types";

/** Minutes in a day. */
export const DAY = 24 * 60;

/** `h:m` as minutes of the day. */
export function at(hours: number, minutes = 0): number {
  return hours * 60 + minutes;
}

/** The minute of the day `minute` falls on (any number of days later or earlier). */
export function ofDay(minute: number): number {
  return ((minute % DAY) + DAY) % DAY;
}

const SUNRISE = at(6, 50);
const SUNSET = at(19, 50);
const NOON = (SUNRISE + SUNSET) / 2;
/** How high the sun gets (°). */
const HIGHEST = 48;

/** The sun at `minute`: how high (° above the horizon) and where (° from north), rising or not. */
export function sunAt(minute: number): { elevation: number; azimuth: number; rising: boolean } {
  const m = ofDay(minute);
  const daylight = SUNSET - SUNRISE;
  let elevation: number;
  let azimuth: number;
  if (m >= SUNRISE && m <= SUNSET) {
    const t = (m - SUNRISE) / daylight;
    elevation = HIGHEST * Math.sin(Math.PI * t);
    azimuth = 90 + 180 * t;
  } else {
    const t = ofDay(m - SUNSET) / (DAY - daylight);
    elevation = -30 * Math.sin(Math.PI * t);
    azimuth = (270 + 180 * t) % 360;
  }
  // Rising from the middle of the night to noon.
  const rising = m >= ofDay(NOON + DAY / 2) && m < NOON;
  return { elevation, azimuth, rising };
}

/** Dark enough for lamps inside (the sun under 5°). */
export function dark(minute: number): boolean {
  return sunAt(minute).elevation < 5;
}

/** What the solar panels give at `minute` (W): 5 kWp, a few clouds passing. */
export function solarAt(minute: number): number {
  const { elevation } = sunAt(minute);
  if (elevation <= 0) return 0;
  const m = ofDay(minute);
  const clouds = 0.3 * Math.max(0, Math.sin(m / 23) * Math.sin(m / 61));
  const shade = SHADE[weatherAt(m).condition] ?? 1;
  return Math.round(5000 * 0.86 * Math.sin((elevation * Math.PI) / 180) * (1 - clouds) * shade);
}

/** The day's weather (D-071): fine, clouding over after lunch, a shower and a storm at three. */
const WEATHER: readonly (readonly [number, string])[] = [
  [at(11, 30), "partlycloudy"],
  [at(14, 30), "cloudy"],
  [at(15, 0), "rainy"],
  [at(15, 30), "lightning-rainy"],
  [at(15, 50), "pouring"],
  [at(16, 10), "rainy"],
  [at(16, 30), "cloudy"],
  [at(17, 0), "partlycloudy"],
  [at(18, 0), "sunny"],
];

/** How much of the sun the clouds let through, by condition. */
const SHADE: Readonly<Record<string, number>> = {
  cloudy: 0.5,
  rainy: 0.25,
  pouring: 0.15,
  "lightning-rainy": 0.15,
};

/** The weather at `minute`: its condition, and the wind (km/h, from degrees clockwise from north). */
export function weatherAt(minute: number): { condition: string; wind: number; bearing: number } {
  const m = ofDay(minute);
  let condition = "sunny";
  for (const [from, then] of WEATHER) if (m >= from) condition = then;
  if (condition === "sunny" && sunAt(m).elevation <= 0) condition = "clear-night";
  const stormy = m >= at(15, 0) && m < at(16, 30);
  return { condition, wind: stormy ? 32 : 11, bearing: stormy ? 225 : 270 };
}

/** Where each person is, from when: a room of the plans, or away (`null`). */
export const ROUTINES: Readonly<Record<string, readonly (readonly [number, string | null])[]>> = {
  "person.alex": [
    [0, "u-bedroom"],
    [at(6, 40), "u-bathroom"],
    [at(7, 5), "kitchen"],
    [at(7, 50), "hall"],
    [at(7, 55), null],
    [at(18, 5), "hall"],
    [at(18, 8), "laundry"],
    [at(18, 20), "kitchen"],
    [at(20, 0), "living"],
    [at(22, 30), "u-bathroom"],
    [at(22, 42), "u-bedroom"],
  ],
  "person.sam": [
    [0, "u-bedroom"],
    [at(7, 0), "kitchen"],
    [at(7, 40), "u-bathroom"],
    [at(8, 5), "office"],
    [at(12, 15), "kitchen"],
    [at(13, 0), "office"],
    [at(16, 33), "hall"],
    [at(16, 38), "kitchen"],
    [at(17, 0), "office"],
    [at(18, 30), "kitchen"],
    [at(20, 0), "living"],
    [at(22, 35), "u-bedroom"],
  ],
  "person.robin": [
    [0, "u-children"],
    [at(7, 10), "kitchen"],
    [at(7, 42), "u-bathroom"],
    [at(7, 50), "hall"],
    [at(7, 55), null],
    [at(16, 33), "hall"],
    [at(16, 38), "kitchen"],
    [at(17, 0), "u-playroom"],
    [at(18, 45), "kitchen"],
    [at(19, 45), "u-bathroom"],
    [at(20, 10), "u-children"],
  ],
};

/** Where `person` is at `minute`, and since when (minute of the day). */
export function whereAt(person: string, minute: number): { room: string | null; since: number } {
  const m = ofDay(minute);
  const routine = ROUTINES[person] ?? [];
  let current: readonly [number, string | null] = routine[0] ?? [0, null];
  for (const step of routine) {
    if (step[0] <= m) current = step;
  }
  return { room: current[1], since: current[0] };
}

/** The people in `room` at `minute`. */
export function peopleIn(room: string, minute: number): string[] {
  return Object.keys(ROUTINES).filter((person) => whereAt(person, minute).room === room);
}

/** Whether someone came into `room` within the last `minutes` (a motion sensor's hold). */
function cameIn(room: string, minute: number, minutes: number): boolean {
  for (let k = 0; k <= minutes; k += 1) {
    if (peopleIn(room, minute - k).length > 0) return true;
  }
  return false;
}

/** When the dishwasher starts: the first minute after 12:30 the sun gives more than 2.5 kW. */
const DISHWASHER_START = (() => {
  for (let m = at(12, 30); m < at(15, 0); m += 1) {
    if (solarAt(m) > 2500) return m;
  }
  return at(15, 0);
})();
const DISHWASHER_LENGTH = 100;

/** Whether `minute` is in `[from, to)`. */
function within(minute: number, from: number, to: number): boolean {
  const m = ofDay(minute);
  return m >= from && m < to;
}

/** What each appliance draws at `minute` (W): its programme, at the time of day it runs. */
export function appliancesAt(minute: number): {
  washer: number;
  dryer: number;
  dishwasher: number;
  oven: number;
  fridge: number;
} {
  const m = ofDay(minute);
  let washer = 0.8;
  if (within(m, at(8, 15), at(8, 35))) washer = 2050;
  else if (within(m, at(8, 35), at(9, 30))) washer = 260 + (m % 4) * 15;
  else if (within(m, at(9, 30), at(9, 45))) washer = 480;
  const dryer = within(m, at(10, 0), at(11, 30)) ? 880 + (m % 3) * 20 : 0.5;
  let dishwasher = 0.6;
  const into = m - DISHWASHER_START;
  if (into >= 0 && into < DISHWASHER_LENGTH) {
    dishwasher = into < 18 || (into >= 70 && into < 82) ? 1850 : 140;
  }
  // The oven heats then holds its heat, on and off.
  const oven = within(m, at(18, 55), at(19, 45)) ? (m % 6 < 4 ? 2200 : 300) : 0;
  const fridge = m % 30 < 12 ? 95 : 3;
  return { washer, dryer, dishwasher, oven, fridge };
}

/** What the robot vacuum does at `minute`: out cleaning while the house is quiet. */
export function vacuumAt(minute: number): "docked" | "cleaning" | "returning" {
  if (within(minute, at(9, 0), at(10, 20))) return "cleaning";
  if (within(minute, at(10, 20), at(10, 26))) return "returning";
  return "docked";
}

/** A change the day makes, and the automation that makes it, if one does. */
export interface Change {
  state: string;
  attributes?: Record<string, unknown>;
  automation?: string;
}

/** The temperature to heat to (°C): day, and night from the good night on. */
function setpoint(minute: number): number {
  return within(minute, at(6, 30), at(22, 45)) ? 20.5 : 18;
}

/**
 * What the day sets at `minute`, entity by entity: lamps, curtains, the lock, the TVs, the robot,
 * the heating. The home applies a change when it differs from the minute before, so that what
 * the visitor sets stays until the day sets it again.
 */
export function wantedAt(minute: number): Map<string, Change> {
  const m = ofDay(minute);
  const night = dark(m);
  const wanted = new Map<string, Change>();
  // The automation that switches a lamp on, and the one that switches it off, if one does.
  const light = (id: string, on: boolean, onBy?: string, offBy?: string): void => {
    const automation = on ? onBy : offBy;
    wanted.set(id, { state: on ? "on" : "off", ...(automation ? { automation } : {}) });
  };
  const here = (room: string): boolean => peopleIn(room, m).length > 0;
  // From 20 minutes before sunset (`automation.evening_lights`) to the good night.
  const evening = within(m, at(19, 30), at(22, 45));
  const goodNight = m >= at(22, 45) ? "automation.good_night" : undefined;
  // The living room: the evening scene, and its pendant where people are after dark.
  for (const id of ["light.living_floor_lamp", "light.living_table_lamp"]) {
    light(id, evening, "automation.evening_lights", goodNight);
  }
  light(
    "light.living_pendant",
    here("living") && night && !within(m, at(22, 45), DAY),
    "automation.lights_follow_people",
    goodNight,
  );
  const livingOpen = within(m, at(7, 30), at(19, 30));
  wanted.set("cover.living_curtains", {
    state: livingOpen ? "open" : "closed",
    attributes: { current_position: livingOpen ? 100 : 0 },
    automation: livingOpen ? "automation.morning_curtains" : "automation.evening_lights",
  });
  // The kitchen: lit at meals and when cooking, where people are.
  const meal = within(m, at(7, 0), at(7, 55)) || within(m, at(18, 50), at(20, 0));
  light("light.dining_pendants", here("kitchen") && (night || meal));
  light("light.kitchen_spots", here("kitchen") && (night || within(m, at(18, 20), at(19, 45))));
  // The office: the desk lamp while someone works, the ceiling light after dark.
  light("light.office_desk_lamp", here("office"));
  light("light.office_ceiling", here("office") && night);
  wanted.set("switch.office_printer", { state: within(m, at(9, 30), at(9, 50)) ? "on" : "off" });
  // The hall and the landing: on with their motion after dark.
  light(
    "light.hall_spots",
    night && cameIn("hall", m, 2),
    "automation.lights_follow_people",
    goodNight,
  );
  light(
    "light.landing",
    night && (cameIn("u-landing", m, 2) || within(m, at(22, 30), at(22, 45))),
    "automation.lights_follow_people",
  );
  light("light.laundry", here("laundry"));
  light("light.wc", false);
  light("light.cloakroom", false);
  // Upstairs: reading in bed, the bathroom when used, the children's bedtime.
  light("light.bedside_left", within(m, at(22, 42), at(23, 15)));
  light("light.bedside_right", within(m, at(22, 35), at(23, 5)));
  light("light.bathroom", here("u-bathroom"));
  light("light.children_ceiling", here("u-children") && night && within(m, at(20, 10), at(20, 45)));
  light("light.children_night_light", within(m, at(20, 45), at(21, 20)));
  light("light.children_desk_lamp", false);
  light("light.playroom", here("u-playroom") && night);
  light("light.guest_ceiling", false);
  light("light.guest_bedside", false);
  // Opened by the morning's automation, closed by hand at bedtime.
  const curtainsClosed = (open: number, close: number): Change => {
    const closed = m < open || m >= close;
    return {
      state: closed ? "closed" : "open",
      attributes: { current_position: closed ? 0 : 100 },
      ...(closed ? {} : { automation: "automation.morning_curtains" }),
    };
  };
  wanted.set("cover.bedroom_curtains", curtainsClosed(at(7, 30), at(22, 30)));
  wanted.set("cover.children_curtains", curtainsClosed(at(7, 30), at(20, 15)));
  // The front door: open when someone goes or comes, locked once they are gone.
  const doorOpen = [at(7, 52), at(16, 33), at(18, 5)].some((t) => within(m, t, t + 2));
  wanted.set("binary_sensor.front_door", { state: doorOpen ? "on" : "off" });
  const unlocked =
    within(m, at(7, 0), at(7, 56)) ||
    within(m, at(16, 32), at(16, 36)) ||
    within(m, at(18, 4), at(18, 8));
  // Unlocked by hand, locked once the door has stayed shut a minute.
  wanted.set("lock.front_door", {
    state: unlocked ? "unlocked" : "locked",
    ...(unlocked ? {} : { automation: "automation.lock_when_away" }),
  });
  // The TVs.
  const tvOn = within(m, at(20, 5), at(22, 25));
  wanted.set("media_player.living_tv", {
    state: tvOn ? "playing" : "off",
    attributes: tvOn ? { media_title: "Nature documentary", app_name: "TV" } : {},
  });
  const cartoons = within(m, at(17, 30), at(18, 30));
  wanted.set("media_player.playroom_tv", {
    state: cartoons ? "playing" : "off",
    attributes: cartoons ? { media_title: "Cartoons", app_name: "Streaming" } : {},
  });
  // The robot vacuum, the dishwasher on sunshine, the towel rail after the showers.
  const vacuum = vacuumAt(m);
  wanted.set("vacuum.robot", {
    state: vacuum,
    ...(vacuum === "cleaning" ? { automation: "automation.clean_when_quiet" } : {}),
  });
  const washing = m >= DISHWASHER_START && m < DISHWASHER_START + DISHWASHER_LENGTH;
  wanted.set("switch.dishwasher", {
    state: washing ? "on" : "off",
    ...(washing ? { automation: "automation.dishwasher_on_sun" } : {}),
  });
  const towels = within(m, at(6, 50), at(8, 30)) || within(m, at(19, 55), at(20, 40));
  wanted.set("switch.towel_rail", {
    state: towels ? "on" : "off",
    ...(towels ? { automation: "automation.bathroom_humidity" } : {}),
  });
  // The heating, lower at night: the good night's in the living room and the bedroom.
  for (const id of ["climate.living_room", "climate.bedroom", "climate.office"]) {
    wanted.set(id, {
      state: "heat",
      attributes: { temperature: setpoint(m) },
      ...(goodNight && id !== "climate.office" ? { automation: goodNight } : {}),
    });
  }
  return wanted;
}

/** The temperature outside (°C): cool at dawn, mild in the afternoon. */
function outside(minute: number): number {
  const m = ofDay(minute);
  return 12.5 - 4.5 * Math.cos((2 * Math.PI * (m - at(4, 30))) / DAY);
}

/** A rise from 0 to 1 between `from` and `to`, and back to 0 over `fall` minutes after. */
function bump(minute: number, from: number, to: number, fall: number): number {
  const m = ofDay(minute);
  if (m < from) return 0;
  if (m < to) return (m - from) / Math.max(1, to - from);
  return Math.max(0, 1 - (m - to) / fall);
}

/** How much a room's air is lived in (0–1+): people in it, filling it since they came. */
function occupancy(room: string, minute: number): number {
  let total = 0;
  for (const person of Object.keys(ROUTINES)) {
    const { room: there, since } = whereAt(person, minute);
    if (there === room) total += Math.min(1, ofDay(minute - since) / 90);
  }
  return total;
}

/**
 * The sensors at `minute` (which the day always sets): the sun, the weather, temperatures,
 * humidity, CO₂, motion, the appliances' power, the robot's battery.
 */
export function sensorsAt(minute: number): Map<string, Change> {
  const m = ofDay(minute);
  const sensors = new Map<string, Change>();
  const sun = sunAt(m);
  sensors.set("sun.sun", {
    state: sun.elevation > 0 ? "above_horizon" : "below_horizon",
    attributes: {
      elevation: Math.round(sun.elevation * 100) / 100,
      azimuth: Math.round(sun.azimuth * 100) / 100,
      rising: sun.rising,
    },
  });
  const value = (id: string, n: number, digits = 1): void => {
    const k = 10 ** digits;
    sensors.set(id, { state: String(Math.round(n * k) / k) });
  };
  const heat = setpoint(m);
  const sunIn = Math.max(0, sunAt(m).elevation) / HIGHEST;
  const temperature = (id: string, extra: number): void => {
    value(id, heat - 0.4 + extra + (outside(m) - 12) * 0.08);
  };
  temperature("sensor.living_temperature", sunIn * 1.2 + occupancy("living", m) * 0.3);
  temperature(
    "sensor.kitchen_temperature",
    sunIn * 0.6 + bump(m, at(18, 55), at(19, 45), 90) * 1.6,
  );
  temperature("sensor.office_temperature", -0.3 + occupancy("office", m) * 0.4);
  temperature("sensor.bedroom_temperature", -0.2 + occupancy("u-bedroom", m) * 0.3);
  temperature("sensor.children_temperature", 0.1 + occupancy("u-children", m) * 0.3);
  temperature("sensor.playroom_temperature", -0.1 + sunIn * 0.4);
  const shower = Math.max(bump(m, at(6, 40), at(7, 0), 70), bump(m, at(19, 45), at(20, 5), 70));
  temperature("sensor.bathroom_temperature", 0.5 + shower * 1.4);
  value("sensor.bathroom_humidity", 54 + shower * 30, 0);
  value("sensor.living_humidity", 46 + occupancy("living", m) * 3, 0);
  value("sensor.kitchen_humidity", 50 + bump(m, at(18, 55), at(19, 45), 60) * 12, 0);
  value("sensor.living_co2", 430 + occupancy("living", m) * 260, 0);
  value("sensor.office_co2", 430 + occupancy("office", m) * 380, 0);
  value("sensor.bedroom_co2", 430 + occupancy("u-bedroom", m) * 290, 0);
  const motion = (id: string, room: string): void => {
    sensors.set(id, { state: cameIn(room, m, 2) ? "on" : "off" });
  };
  motion("binary_sensor.hall_motion", "hall");
  motion("binary_sensor.landing_motion", "u-landing");
  sensors.set("binary_sensor.living_motion", {
    state: peopleIn("living", m).length > 0 ? "on" : "off",
  });
  const weather = weatherAt(m);
  sensors.set("weather.home", {
    state: weather.condition,
    attributes: {
      temperature: Math.round(outside(m) * 10) / 10,
      temperature_unit: "°C",
      wind_speed: weather.wind,
      wind_speed_unit: "km/h",
      wind_bearing: weather.bearing,
    },
  });
  const power = appliancesAt(m);
  value("sensor.washer_power", power.washer);
  value("sensor.dryer_power", power.dryer);
  value("sensor.dishwasher_power", power.dishwasher);
  value("sensor.oven_power", power.oven, 0);
  value("sensor.fridge_power", power.fridge, 0);
  return sensors;
}

/** The robot vacuum's battery (%) at `minute` of the day: down while it cleans, charged after. */
export function robotBatteryAt(minute: number): number {
  const m = ofDay(minute);
  if (vacuumAt(m) !== "docked") return 100 - Math.min(48, ofDay(m - at(9, 0)) * 0.55);
  return m >= at(10, 26) && m < at(13, 0) ? Math.min(100, 52 + (m - at(10, 26)) * 0.5) : 100;
}

/** The robot vacuum's battery (%) after `minutes` in `state`: down while out, charged docked. */
export function robotBatteryAfter(
  level: number,
  state: string | undefined,
  minutes: number,
): number {
  const out = state === "cleaning" || state === "returning";
  return Math.min(100, Math.max(5, level + (out ? -0.55 : state === "docked" ? 0.5 : 0) * minutes));
}

/** What the living room's TV draws (W): playing, on and still, or on standby. */
export function tvPower(state: string | undefined): number {
  if (state === "playing") return TV_PLAYING;
  if (state === "on" || state === "paused" || state === "idle") return TV_ON;
  return 0.8;
}

/** What one lamp, a TV, the towel rail and the printer draw (W). */
const LAMP = 8;
const TV_PLAYING = 92;
const TV_ON = 70;
const SMALL_TV = 55;
const TOWEL_RAIL = 300;
const PRINTER = 25;
/** What the home always draws (W): the box, the fridge's friends, standby. */
const BASE = 165;

/** What the home draws now (W), from its states and its appliances' programmes. */
export function homePower(states: HomeAssistant["states"], minute: number): number {
  const on = (id: string, state = "on"): boolean => states[id]?.state === state;
  let total = BASE;
  for (const [id, entity] of Object.entries(states)) {
    if (id.startsWith("light.") && entity?.state === "on") total += LAMP;
  }
  total += tvPower(states["media_player.living_tv"]?.state);
  if (on("media_player.playroom_tv", "playing")) total += SMALL_TV;
  if (on("switch.towel_rail")) total += TOWEL_RAIL;
  if (on("switch.office_printer")) total += PRINTER;
  const power = appliancesAt(minute);
  return total + power.washer + power.dryer + power.dishwasher + power.oven + power.fridge;
}

/** The home battery: 13.5 kWh, charged and drawn at 3 kW at most, kept above 10 %. */
const CAPACITY = 13_500;
const MOST = 3000;
const RESERVE = 10;

/** Where the power goes: the battery charged (negative) or drawn (positive), the grid drawn
 * from (positive) or sent to (negative); `level` the battery's charge (%). */
export function flowsAt(
  solar: number,
  home: number,
  level: number,
): { battery: number; grid: number } {
  const surplus = solar - home;
  let battery = 0;
  if (surplus > 0 && level < 100) battery = -Math.min(surplus, MOST);
  else if (surplus < 0 && level > RESERVE) battery = Math.min(-surplus, MOST);
  return { battery: Math.round(battery), grid: Math.round(home - solar - battery) };
}

/** The battery's charge after `battery` W for `minutes` (positive drawn). */
export function chargeAfter(level: number, battery: number, minutes: number): number {
  const next = level - (battery * minutes) / 60 / (CAPACITY / 100);
  return Math.min(100, Math.max(0, next));
}

/** The battery's planned day is worked out in steps of this many minutes. */
const STEP = 5;
/** Its charge at the start of each step, and what it gives then, worked out once. */
let planned: { level: number; battery: number }[] | undefined;

/** The day as planned, from 30 % at midnight: the lamps and the TV as the day sets them. */
function plannedDay(): { level: number; battery: number }[] {
  if (planned) return planned;
  const steps: { level: number; battery: number }[] = [];
  let level = 30;
  for (let t = 0; t < DAY; t += STEP) {
    let home = homePower({}, t);
    for (const [id, change] of wantedAt(t)) {
      if (id.startsWith("light.") && change.state === "on") home += LAMP;
      if (id === "media_player.living_tv") home += tvPower(change.state) - tvPower(undefined);
    }
    const { battery } = flowsAt(solarAt(t), home, level);
    steps.push({ level, battery });
    level = chargeAfter(level, battery, STEP);
  }
  planned = steps;
  return steps;
}

/** The battery's charge at `minute` of the day, the day as planned (from 30 % at midnight). */
export function batteryAt(minute: number): number {
  const m = ofDay(minute);
  const k = Math.floor(m / STEP);
  const step = plannedDay()[k] ?? { level: 30, battery: 0 };
  return chargeAfter(step.level, step.battery, m - k * STEP);
}
