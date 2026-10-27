/**
 * The demo house (D-050): a fictional family home of two storeys, and what its Home Assistant
 * holds: the areas, the entities and what they are linked to on the plan, the automations, the
 * upkeep cards, the people and the settings. In English and in French; nothing of it is real.
 */
import groundPlan from "../../../examples/demo-house.domotwin.json";
import upperPlan from "../../../examples/demo-house-upper.domotwin.json";

import type { Bindings, PlanJson, Settings, StoreyInfo } from "../ha/client";
import type { PeopleSettings } from "../live/people";
import type { Upkeep, UpkeepTask, UpkeepUnit } from "../live/upkeep";

/** A text in English and in French. */
export type Words = readonly [en: string, fr: string];

/** The words for the language (French for `fr…`, else English). */
export function say(words: Words, language: string): string {
  return language.toLowerCase().startsWith("fr") ? words[1] : words[0];
}

/** The storeys: their id, names and height, and their plan. */
export const STOREYS: readonly { info: StoreyInfo; names: Words; plan: PlanJson }[] = [
  {
    info: { id: "ground", name: "", elevation: 0 },
    names: ["Ground floor", "Rez-de-chaussée"],
    plan: groundPlan,
  },
  {
    info: { id: "upper", name: "", elevation: 280 },
    names: ["Upper floor", "Étage"],
    plan: upperPlan,
  },
];

/** The areas: their id, names and the plan's room they are. */
export const AREAS: readonly { id: string; names: Words; room: string; storey: string }[] = [
  { id: "living_room", names: ["Living room", "Salon"], room: "living", storey: "ground" },
  { id: "kitchen", names: ["Kitchen", "Cuisine"], room: "kitchen", storey: "ground" },
  { id: "office", names: ["Office", "Bureau"], room: "office", storey: "ground" },
  { id: "hall", names: ["Hall", "Entrée"], room: "hall", storey: "ground" },
  { id: "wc", names: ["WC", "WC"], room: "wc", storey: "ground" },
  { id: "cloakroom", names: ["Cloakroom", "Vestiaire"], room: "cloakroom", storey: "ground" },
  { id: "laundry", names: ["Laundry", "Buanderie"], room: "laundry", storey: "ground" },
  {
    id: "bedroom",
    names: ["Main bedroom", "Chambre parentale"],
    room: "u-bedroom",
    storey: "upper",
  },
  { id: "bathroom", names: ["Bathroom", "Salle de bain"], room: "u-bathroom", storey: "upper" },
  {
    id: "children",
    names: ["Children's room", "Chambre d’enfant"],
    room: "u-children",
    storey: "upper",
  },
  { id: "landing", names: ["Landing", "Palier"], room: "u-landing", storey: "upper" },
  { id: "playroom", names: ["Playroom", "Salle de jeux"], room: "u-playroom", storey: "upper" },
  { id: "guest_room", names: ["Guest room", "Chambre d’amis"], room: "u-guest", storey: "upper" },
];

/** The French names of the plans' pieces, doors and windows, by their English name. */
const FRENCH: Readonly<Record<string, string>> = {
  "Demo house": "Maison de démo",
  "Demo house, upper floor": "Maison de démo, étage",
  // Its saved views.
  Overview: "Vue d’ensemble",
  "Living room": "Salon",
  TV: "Télé",
  Sofa: "Canapé",
  "Coffee table": "Table basse",
  Armchair: "Fauteuil",
  "Side table": "Guéridon",
  "Table lamp": "Lampe à poser",
  "Floor lamp": "Lampadaire",
  Pendant: "Suspension",
  Bookcase: "Bibliothèque",
  Curtains: "Rideaux",
  Radiator: "Radiateur",
  Worktop: "Plan de travail",
  Dishwasher: "Lave-vaisselle",
  Sink: "Évier",
  "Oven and hob": "Four et plaques",
  Hood: "Hotte",
  "Wall cabinet": "Placard mural",
  Fridge: "Réfrigérateur",
  "Dining table": "Table à manger",
  Chair: "Chaise",
  Desk: "Bureau",
  "Office chair": "Fauteuil de bureau",
  "Desk lamp": "Lampe de bureau",
  Printer: "Imprimante",
  "Ceiling light": "Plafonnier",
  Stairs: "Escalier",
  "Shoe cabinet": "Meuble à chaussures",
  Toilet: "Toilettes",
  "Coat cupboard": "Penderie",
  "Washing machine": "Lave-linge",
  Dryer: "Sèche-linge",
  Cupboard: "Placard",
  "Robot vacuum": "Aspirateur robot",
  Bed: "Lit",
  Nightstand: "Table de chevet",
  "Ceiling fan": "Ventilateur de plafond",
  Wardrobe: "Armoire",
  "Chest of drawers": "Commode",
  Bathtub: "Baignoire",
  Vanity: "Meuble vasque",
  Mirror: "Miroir",
  "Towel rail": "Sèche-serviettes",
  Shelves: "Étagères",
  "Toy chest": "Coffre à jouets",
  "Play table": "Table de jeux",
  "Front door": "Porte d’entrée",
  "Garden door": "Baie vitrée",
  "Living room door": "Porte du salon",
  "Office door": "Porte du bureau",
  "WC door": "Porte des WC",
  "Cloakroom door": "Porte du vestiaire",
  "Laundry door": "Porte de la buanderie",
  "Bedroom door": "Porte de la chambre",
  "Bathroom door": "Porte de la salle de bain",
  "Children's room door": "Porte de la chambre d’enfant",
  "Playroom door": "Porte de la salle de jeux",
  "Guest room door": "Porte de la chambre d’amis",
  "Living room window": "Fenêtre du salon",
  "Kitchen window": "Fenêtre de la cuisine",
  "Kitchen side window": "Fenêtre latérale de la cuisine",
  "Office window": "Fenêtre du bureau",
  "Laundry window": "Fenêtre de la buanderie",
  "Bedroom window": "Fenêtre de la chambre",
  "Bathroom window": "Fenêtre de la salle de bain",
  "Children's room window": "Fenêtre de la chambre d’enfant",
  "Landing window": "Fenêtre du palier",
  "Playroom window": "Fenêtre de la salle de jeux",
  "Guest room window": "Fenêtre de la chambre d’amis",
};

/** A storey's plan in the language: its rooms named as their areas, its pieces translated. */
export function localPlan(plan: PlanJson, language: string): PlanJson {
  const copy = structuredClone<Record<string, unknown>>(plan);
  if (!language.toLowerCase().startsWith("fr")) return copy;
  // A room is named as its area; anything else by its English name.
  const rename = (named: { name?: string; id?: string }, room: boolean): void => {
    const area = room ? AREAS.find((a) => a.room === named.id) : undefined;
    if (area) named.name = area.names[1];
    else if (named.name && FRENCH[named.name]) named.name = FRENCH[named.name];
  };
  if (typeof copy.name === "string") copy.name = FRENCH[copy.name] ?? copy.name;
  for (const key of ["rooms", "doors", "windows", "items", "views"]) {
    const list = copy[key];
    if (Array.isArray(list))
      for (const named of list as { name?: string }[]) rename(named, key === "rooms");
  }
  return copy;
}

/** An entity of the demo house: its id, area, names, the pieces it is linked to, its state. */
export interface Thing {
  id: string;
  area?: string;
  names: Words;
  pieces?: readonly string[];
  state: string;
  attributes?: Record<string, unknown>;
}

const warm = {
  color_mode: "color_temp",
  supported_color_modes: ["color_temp"],
  min_color_temp_kelvin: 2200,
  max_color_temp_kelvin: 6500,
  color_temp_kelvin: 2700,
  brightness: 210,
};
const colour = {
  color_mode: "hs",
  supported_color_modes: ["hs", "color_temp"],
  hs_color: [30, 60],
  rgb_color: [255, 177, 102],
  brightness: 180,
};
const power = { device_class: "power", unit_of_measurement: "W", state_class: "measurement" };
const celsius = { device_class: "temperature", unit_of_measurement: "°C" };
const percent = { device_class: "humidity", unit_of_measurement: "%" };
const co2 = { device_class: "carbon_dioxide", unit_of_measurement: "ppm" };
const curtain = { device_class: "curtain", supported_features: 15, current_position: 0 };
const thermostat = {
  hvac_modes: ["off", "heat"],
  min_temp: 7,
  max_temp: 30,
  target_temp_step: 0.5,
  supported_features: 385,
};
/** Plays, pauses, sets and steps its volume, mutes, switches on and off. */
const tv = { supported_features: 17805, volume_level: 0.25, source_list: ["TV", "Streaming"] };

/** Every entity, with how it is when the demo starts (the day then sets the time's). */
export const THINGS: readonly Thing[] = [
  // Ground floor: the living room.
  {
    id: "light.living_pendant",
    area: "living_room",
    names: ["Living room pendant", "Suspension du salon"],
    pieces: ["pendant-living"],
    state: "off",
    attributes: warm,
  },
  {
    id: "light.living_floor_lamp",
    area: "living_room",
    names: ["Floor lamp", "Lampadaire"],
    pieces: ["floor-lamp"],
    state: "off",
    attributes: colour,
  },
  {
    id: "light.living_table_lamp",
    area: "living_room",
    names: ["Table lamp", "Lampe à poser"],
    pieces: ["table-lamp"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 2400, brightness: 150 },
  },
  {
    id: "media_player.living_tv",
    area: "living_room",
    names: ["Living room TV", "Télé du salon"],
    pieces: ["tv"],
    state: "off",
    attributes: tv,
  },
  {
    id: "sensor.tv_power",
    area: "living_room",
    names: ["TV power", "Consommation de la télé"],
    pieces: ["tv"],
    state: "0.8",
    attributes: power,
  },
  {
    id: "cover.living_curtains",
    area: "living_room",
    names: ["Living room curtains", "Rideaux du salon"],
    pieces: ["curtain-living"],
    state: "open",
    attributes: { ...curtain, current_position: 100 },
  },
  {
    id: "binary_sensor.garden_door",
    area: "living_room",
    names: ["Garden door", "Baie vitrée"],
    pieces: ["door-garden"],
    state: "off",
    attributes: { device_class: "door" },
  },
  {
    id: "climate.living_room",
    area: "living_room",
    names: ["Living room heating", "Chauffage du salon"],
    pieces: ["radiator-living"],
    state: "heat",
    attributes: { ...thermostat, temperature: 20.5, current_temperature: 20.1 },
  },
  {
    id: "sensor.living_temperature",
    area: "living_room",
    names: ["Living room temperature", "Température du salon"],
    state: "20.1",
    attributes: celsius,
  },
  {
    id: "sensor.living_humidity",
    area: "living_room",
    names: ["Living room humidity", "Humidité du salon"],
    state: "48",
    attributes: percent,
  },
  {
    id: "sensor.living_co2",
    area: "living_room",
    names: ["Living room CO₂", "CO₂ du salon"],
    state: "520",
    attributes: co2,
  },
  {
    id: "binary_sensor.living_motion",
    area: "living_room",
    names: ["Living room motion", "Mouvement au salon"],
    state: "off",
    attributes: { device_class: "occupancy" },
  },
  // The kitchen.
  {
    id: "light.dining_pendants",
    area: "kitchen",
    names: ["Dining pendants", "Suspensions de la table"],
    pieces: ["pendant-dining-1", "pendant-dining-2"],
    state: "off",
    attributes: warm,
  },
  {
    id: "light.kitchen_spots",
    area: "kitchen",
    names: ["Kitchen spots", "Spots de la cuisine"],
    pieces: ["spot-kitchen-1", "spot-kitchen-2"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500, brightness: 255 },
  },
  {
    id: "sensor.fridge_power",
    area: "kitchen",
    names: ["Fridge power", "Consommation du réfrigérateur"],
    pieces: ["fridge"],
    state: "45",
    attributes: power,
  },
  {
    id: "switch.dishwasher",
    area: "kitchen",
    names: ["Dishwasher", "Lave-vaisselle"],
    pieces: ["dishwasher"],
    state: "off",
  },
  {
    id: "sensor.dishwasher_power",
    area: "kitchen",
    names: ["Dishwasher power", "Consommation du lave-vaisselle"],
    pieces: ["dishwasher"],
    state: "0",
    attributes: power,
  },
  {
    id: "sensor.oven_power",
    area: "kitchen",
    names: ["Oven power", "Consommation du four"],
    pieces: ["stove"],
    state: "0",
    attributes: power,
  },
  {
    id: "binary_sensor.kitchen_smoke",
    area: "kitchen",
    names: ["Kitchen smoke", "Fumée dans la cuisine"],
    state: "off",
    attributes: { device_class: "smoke" },
  },
  {
    id: "sensor.kitchen_temperature",
    area: "kitchen",
    names: ["Kitchen temperature", "Température de la cuisine"],
    state: "20.4",
    attributes: celsius,
  },
  {
    id: "sensor.kitchen_humidity",
    area: "kitchen",
    names: ["Kitchen humidity", "Humidité de la cuisine"],
    state: "52",
    attributes: percent,
  },
  // The office.
  {
    id: "light.office_ceiling",
    area: "office",
    names: ["Office ceiling light", "Plafonnier du bureau"],
    pieces: ["ceiling-office"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 4000, brightness: 230 },
  },
  {
    id: "light.office_desk_lamp",
    area: "office",
    names: ["Desk lamp", "Lampe de bureau"],
    pieces: ["desk-lamp"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  {
    id: "switch.office_printer",
    area: "office",
    names: ["Printer", "Imprimante"],
    pieces: ["printer"],
    state: "off",
  },
  {
    id: "climate.office",
    area: "office",
    names: ["Office heating", "Chauffage du bureau"],
    pieces: ["radiator-office"],
    state: "heat",
    attributes: { ...thermostat, temperature: 20, current_temperature: 19.6 },
  },
  {
    id: "sensor.office_temperature",
    area: "office",
    names: ["Office temperature", "Température du bureau"],
    state: "19.6",
    attributes: celsius,
  },
  {
    id: "sensor.office_co2",
    area: "office",
    names: ["Office CO₂", "CO₂ du bureau"],
    state: "480",
    attributes: co2,
  },
  // The hall, the WC, the cloakroom.
  {
    id: "light.hall_spots",
    area: "hall",
    names: ["Hall spots", "Spots de l’entrée"],
    pieces: ["spot-hall-1", "spot-hall-2"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3000 },
  },
  {
    id: "lock.front_door",
    area: "hall",
    names: ["Front door lock", "Serrure de la porte d’entrée"],
    pieces: ["door-entrance"],
    state: "locked",
  },
  {
    id: "binary_sensor.front_door",
    area: "hall",
    names: ["Front door", "Porte d’entrée"],
    pieces: ["door-entrance"],
    state: "off",
    attributes: { device_class: "door" },
  },
  {
    id: "sensor.front_door_lock_battery",
    area: "hall",
    names: ["Front door lock battery", "Pile de la serrure"],
    pieces: ["door-entrance"],
    state: "71",
    attributes: { device_class: "battery", unit_of_measurement: "%" },
  },
  {
    id: "binary_sensor.hall_motion",
    area: "hall",
    names: ["Hall motion", "Mouvement dans l’entrée"],
    state: "off",
    attributes: { device_class: "motion" },
  },
  {
    id: "light.wc",
    area: "wc",
    names: ["WC light", "Lumière des WC"],
    pieces: ["ceiling-wc"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  {
    id: "light.cloakroom",
    area: "cloakroom",
    names: ["Cloakroom light", "Lumière du vestiaire"],
    pieces: ["ceiling-cloakroom"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  // The laundry.
  {
    id: "light.laundry",
    area: "laundry",
    names: ["Laundry light", "Lumière de la buanderie"],
    pieces: ["ceiling-laundry"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 4000 },
  },
  {
    id: "sensor.washer_power",
    area: "laundry",
    names: ["Washing machine power", "Consommation du lave-linge"],
    pieces: ["washer"],
    state: "0",
    attributes: power,
  },
  {
    id: "sensor.dryer_power",
    area: "laundry",
    names: ["Dryer power", "Consommation du sèche-linge"],
    pieces: ["dryer"],
    state: "0",
    attributes: power,
  },
  {
    id: "binary_sensor.laundry_leak",
    area: "laundry",
    names: ["Laundry leak", "Fuite dans la buanderie"],
    state: "off",
    attributes: { device_class: "moisture" },
  },
  // The robot vacuum, its dock by the living room's TV.
  {
    id: "vacuum.robot",
    area: "living_room",
    names: ["Robot vacuum", "Aspirateur robot"],
    pieces: ["robot-dock"],
    state: "docked",
    // Starts, pauses, goes home, reports its state.
    attributes: { supported_features: 12_820, fan_speed: "standard" },
  },
  {
    id: "sensor.robot_battery",
    area: "living_room",
    names: ["Robot vacuum battery", "Batterie de l’aspirateur"],
    pieces: ["robot-dock"],
    state: "100",
    attributes: { device_class: "battery", unit_of_measurement: "%" },
  },
  // Upper floor: the main bedroom.
  {
    id: "light.bedside_left",
    area: "bedroom",
    names: ["Bedside lamp left", "Lampe de chevet gauche"],
    pieces: ["u-nightstand-left"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 2400, brightness: 120 },
  },
  {
    id: "light.bedside_right",
    area: "bedroom",
    names: ["Bedside lamp right", "Lampe de chevet droite"],
    pieces: ["u-nightstand-right"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 2400, brightness: 120 },
  },
  {
    id: "fan.bedroom",
    area: "bedroom",
    names: ["Bedroom fan", "Ventilateur de la chambre"],
    pieces: ["u-fan"],
    state: "off",
    attributes: { percentage: 0, percentage_step: 25, supported_features: 49 },
  },
  {
    id: "cover.bedroom_curtains",
    area: "bedroom",
    names: ["Bedroom curtains", "Rideaux de la chambre"],
    pieces: ["u-curtain-bedroom"],
    state: "closed",
    attributes: curtain,
  },
  {
    id: "climate.bedroom",
    area: "bedroom",
    names: ["Bedroom heating", "Chauffage de la chambre"],
    pieces: ["u-radiator-bedroom"],
    state: "heat",
    attributes: { ...thermostat, temperature: 18, current_temperature: 18.2 },
  },
  {
    id: "sensor.bedroom_temperature",
    area: "bedroom",
    names: ["Bedroom temperature", "Température de la chambre"],
    state: "18.2",
    attributes: celsius,
  },
  {
    id: "sensor.bedroom_co2",
    area: "bedroom",
    names: ["Bedroom CO₂", "CO₂ de la chambre"],
    state: "760",
    attributes: co2,
  },
  // The bathroom.
  {
    id: "light.bathroom",
    area: "bathroom",
    names: ["Bathroom light", "Lumière de la salle de bain"],
    pieces: ["u-ceiling-bathroom"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 4000, brightness: 255 },
  },
  {
    id: "switch.towel_rail",
    area: "bathroom",
    names: ["Towel rail", "Sèche-serviettes"],
    pieces: ["u-towel-rail"],
    state: "off",
  },
  {
    id: "sensor.bathroom_humidity",
    area: "bathroom",
    names: ["Bathroom humidity", "Humidité de la salle de bain"],
    state: "55",
    attributes: percent,
  },
  {
    id: "sensor.bathroom_temperature",
    area: "bathroom",
    names: ["Bathroom temperature", "Température de la salle de bain"],
    state: "21",
    attributes: celsius,
  },
  // The children's room.
  {
    id: "light.children_ceiling",
    area: "children",
    names: ["Children's room light", "Plafonnier de la chambre d’enfant"],
    pieces: ["u-ceiling-children"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  {
    id: "light.children_night_light",
    area: "children",
    names: ["Night light", "Veilleuse"],
    pieces: ["u-nightstand-children"],
    state: "off",
    attributes: { ...colour, hs_color: [35, 70], rgb_color: [255, 170, 77], brightness: 60 },
  },
  {
    id: "light.children_desk_lamp",
    area: "children",
    names: ["Children's desk lamp", "Lampe du bureau d’enfant"],
    pieces: ["u-lamp-children"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  {
    id: "cover.children_curtains",
    area: "children",
    names: ["Children's room curtains", "Rideaux de la chambre d’enfant"],
    pieces: ["u-curtain-children"],
    state: "closed",
    attributes: curtain,
  },
  {
    id: "sensor.children_temperature",
    area: "children",
    names: ["Children's room temperature", "Température de la chambre d’enfant"],
    state: "18.6",
    attributes: celsius,
  },
  // The landing, the playroom, the guest room.
  {
    id: "light.landing",
    area: "landing",
    names: ["Landing lights", "Lumières du palier"],
    pieces: ["u-ceiling-landing-1", "u-ceiling-landing-2"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3000, brightness: 160 },
  },
  {
    id: "binary_sensor.landing_motion",
    area: "landing",
    names: ["Landing motion", "Mouvement sur le palier"],
    state: "off",
    attributes: { device_class: "motion" },
  },
  {
    id: "binary_sensor.landing_smoke",
    area: "landing",
    names: ["Landing smoke", "Fumée sur le palier"],
    state: "off",
    attributes: { device_class: "smoke" },
  },
  {
    id: "light.playroom",
    area: "playroom",
    names: ["Playroom light", "Lumière de la salle de jeux"],
    pieces: ["u-ceiling-playroom"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3500 },
  },
  {
    id: "media_player.playroom_tv",
    area: "playroom",
    names: ["Playroom TV", "Télé de la salle de jeux"],
    pieces: ["u-play-tv"],
    state: "off",
    attributes: tv,
  },
  {
    id: "sensor.playroom_temperature",
    area: "playroom",
    names: ["Playroom temperature", "Température de la salle de jeux"],
    state: "19.4",
    attributes: celsius,
  },
  {
    id: "light.guest_ceiling",
    area: "guest_room",
    names: ["Guest room light", "Plafonnier de la chambre d’amis"],
    pieces: ["u-ceiling-guest"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 3000 },
  },
  {
    id: "light.guest_bedside",
    area: "guest_room",
    names: ["Guest bedside lamp", "Lampe de chevet d’amis"],
    pieces: ["u-nightstand-guest-1"],
    state: "off",
    attributes: { ...warm, color_temp_kelvin: 2700, brightness: 120 },
  },
  {
    id: "binary_sensor.guest_window",
    area: "guest_room",
    names: ["Guest room window", "Fenêtre de la chambre d’amis"],
    pieces: ["u-win-guest"],
    state: "off",
    attributes: { device_class: "window" },
  },
  // The home's energy (D-049), and the sun.
  {
    id: "sensor.solar_power",
    names: ["Solar panels", "Panneaux solaires"],
    state: "0",
    attributes: power,
  },
  {
    id: "sensor.grid_power",
    names: ["Grid meter", "Compteur électrique"],
    state: "300",
    attributes: power,
  },
  {
    id: "sensor.battery_power",
    names: ["Home battery power", "Puissance de la batterie"],
    state: "0",
    attributes: power,
  },
  {
    id: "sensor.battery_level",
    names: ["Home battery", "Batterie de la maison"],
    state: "60",
    attributes: { device_class: "battery", unit_of_measurement: "%" },
  },
  {
    id: "sun.sun",
    names: ["Sun", "Soleil"],
    state: "below_horizon",
    attributes: { elevation: -20, azimuth: 0, rising: true },
  },
  {
    id: "weather.home",
    names: ["Forecast", "Prévisions"],
    state: "clear-night",
    attributes: { temperature: 9, temperature_unit: "°C" },
  },
];

/** The people of the house: fictional. */
export const PEOPLE: readonly { id: string; name: string; color: string }[] = [
  { id: "person.alex", name: "Alex", color: "#e8508a" },
  { id: "person.sam", name: "Sam", color: "#2f9fd8" },
  { id: "person.robin", name: "Robin", color: "#3fae5a" },
];

/** A person's room sensor, as the integration names it. */
export function roomSensorOf(person: string): string {
  return `sensor.domotwin_${person.slice(person.indexOf(".") + 1)}_room`;
}

/** The links between the plan and the entities (D-018): pieces, and rooms to their areas. */
export function demoBindings(): Bindings {
  const elements: Record<string, { entities: { entity_id: string }[] }> = {};
  for (const thing of THINGS) {
    for (const piece of thing.pieces ?? []) {
      elements[piece] ??= { entities: [] };
      elements[piece].entities.push({ entity_id: thing.id });
    }
  }
  return {
    version: 1,
    rooms: Object.fromEntries(AREAS.map((a) => [a.room, { area: a.id }])),
    elements,
  };
}

/** The settings: north (the garden faces south), the home's energy (D-049). */
export function demoSettings(): Settings {
  return {
    north: 180,
    energy: {
      solar: "sensor.solar_power",
      grid: "sensor.grid_power",
      battery: "sensor.battery_power",
      battery_level: "sensor.battery_level",
    },
  };
}

/** Who is placed in their rooms (D-034), and how. */
export function demoPeople(): PeopleSettings {
  return {
    revision: 1,
    shown: "everyone",
    look: "figure",
    hidden: [],
    people: Object.fromEntries(
      PEOPLE.map((p) => [
        p.id,
        {
          sources: [`sensor.${p.id.slice(7)}_phone_area`],
          color: p.color,
          sensor: roomSensorOf(p.id),
        },
      ]),
    ),
  };
}

/** The upkeep cards (D-033), dated from `today` (YYYY-MM-DD). */
export function demoUpkeep(today: string, language: string): Upkeep {
  const back = (days: number): string => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const task = (
    id: string,
    names: Words,
    every: number,
    unit: UpkeepUnit,
    ago: number,
  ): UpkeepTask => ({
    id,
    name: say(names, language),
    every,
    unit,
    last_done: back(ago),
  });
  return {
    version: 1,
    lead_days: 14,
    pieces: {
      washer: {
        make: "Fictional Appliances",
        model: "W-200",
        installed: back(900),
        warranty_end: back(-200),
        service_life: 12,
        tasks: [
          task("filter", ["Clean the filter", "Nettoyer le filtre"], 3, "months", 85),
          task("descale", ["Descale the drum", "Détartrer le tambour"], 6, "months", 60),
        ],
      },
      "robot-dock": {
        make: "Fictional Robotics",
        model: "R-1",
        tasks: [
          task("brushes", ["Clean the brushes", "Nettoyer les brosses"], 1, "months", 3),
          task("bin", ["Empty the dock's bag", "Vider le sac de la station"], 2, "months", 20),
        ],
      },
      "u-fan": {
        tasks: [task("dust", ["Dust the blades", "Dépoussiérer les pales"], 2, "months", 20)],
      },
      fridge: {
        make: "Cold & Co",
        model: "FR-9",
        installed: back(1400),
        tasks: [task("coils", ["Clean the coils", "Nettoyer la grille"], 6, "months", 120)],
      },
    },
  };
}

/** The automations (as `automation/config` gives them) and their names. */
export const AUTOMATIONS: readonly { id: string; names: Words; config: Record<string, unknown> }[] =
  [
    {
      id: "automation.evening_lights",
      names: ["Evening lights", "Lumières du soir"],
      config: {
        triggers: [{ trigger: "sun", event: "sunset", offset: "-00:20:00" }],
        actions: [
          {
            action: "light.turn_on",
            target: { entity_id: ["light.living_floor_lamp", "light.living_table_lamp"] },
          },
          { action: "cover.close_cover", target: { entity_id: "cover.living_curtains" } },
        ],
      },
    },
    {
      id: "automation.lights_follow_people",
      names: ["Lights follow people after dark", "Les lumières suivent la famille la nuit"],
      config: {
        triggers: [
          { trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" },
          { trigger: "state", entity_id: "binary_sensor.landing_motion", to: "on" },
          { trigger: "state", entity_id: "binary_sensor.living_motion", to: "on" },
        ],
        conditions: [{ condition: "state", entity_id: "sun.sun", state: "below_horizon" }],
        actions: [
          {
            action: "light.turn_on",
            target: { entity_id: ["light.hall_spots", "light.landing", "light.living_pendant"] },
          },
        ],
      },
    },
    {
      id: "automation.morning_curtains",
      names: ["Curtains open in the morning", "Les rideaux s’ouvrent le matin"],
      config: {
        triggers: [{ trigger: "time", at: "07:30:00" }],
        actions: [
          {
            action: "cover.open_cover",
            target: {
              entity_id: [
                "cover.living_curtains",
                "cover.bedroom_curtains",
                "cover.children_curtains",
              ],
            },
          },
        ],
      },
    },
    {
      id: "automation.clean_when_quiet",
      names: ["Clean when the house is quiet", "Ménage quand la maison est calme"],
      config: {
        triggers: [{ trigger: "time", at: "09:00:00" }],
        conditions: [
          { condition: "state", entity_id: "person.alex", state: "not_home" },
          { condition: "state", entity_id: "person.robin", state: "not_home" },
        ],
        actions: [{ action: "vacuum.start", target: { entity_id: "vacuum.robot" } }],
      },
    },
    {
      id: "automation.lock_when_away",
      names: ["Lock the door when leaving", "Verrouiller en partant"],
      config: {
        triggers: [
          { trigger: "state", entity_id: "binary_sensor.front_door", to: "off", for: "00:01:00" },
        ],
        actions: [{ action: "lock.lock", target: { entity_id: "lock.front_door" } }],
      },
    },
    {
      id: "automation.dishwasher_on_sun",
      names: ["Dishwasher on sunshine", "Lave-vaisselle au soleil"],
      config: {
        triggers: [{ trigger: "numeric_state", entity_id: "sensor.solar_power", above: 2500 }],
        conditions: [{ condition: "time", after: "12:30:00", before: "15:00:00" }],
        actions: [{ action: "switch.turn_on", target: { entity_id: "switch.dishwasher" } }],
      },
    },
    {
      id: "automation.bathroom_humidity",
      names: ["Towel rail after a shower", "Sèche-serviettes après la douche"],
      config: {
        triggers: [{ trigger: "numeric_state", entity_id: "sensor.bathroom_humidity", above: 70 }],
        actions: [{ action: "switch.turn_on", target: { entity_id: "switch.towel_rail" } }],
      },
    },
    {
      id: "automation.good_night",
      names: ["Good night", "Bonne nuit"],
      config: {
        triggers: [{ trigger: "time", at: "22:45:00" }],
        actions: [
          { action: "light.turn_off", target: { area_id: ["living_room", "kitchen", "hall"] } },
          { action: "lock.lock", target: { entity_id: "lock.front_door" } },
          {
            action: "climate.set_temperature",
            target: { entity_id: ["climate.living_room", "climate.bedroom"] },
            data: { temperature: 18 },
          },
        ],
      },
    },
  ];
