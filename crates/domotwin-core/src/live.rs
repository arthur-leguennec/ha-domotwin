//! Live state: Home Assistant entity states turned into what each element looks like (a lamp's
//! light, a screen's glow, a door or a curtain's opening, a blind's position, unavailable
//! entities greyed out), and the fades from one look to the next.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::bindings::{Bindings, Role};
use crate::plan::light::{kelvin_to_rgb, light_color, light_power};
use crate::plan::{Element, Plan, Rgb8};
use crate::scene::{LightSpot, Overrides};

/// The part of a Home Assistant state DomoTwin uses.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EntityState {
    /// `on`, `off`, `open`, `playing`, `unavailable`…
    pub state: String,
    /// Light brightness, 0–255.
    pub brightness: Option<f64>,
    /// Light colour.
    pub rgb: Option<Rgb8>,
    /// Light colour temperature (K).
    pub kelvin: Option<f64>,
    /// Cover position, 0 (closed) – 100 (open).
    pub position: Option<f64>,
    /// Device class (binary sensors).
    pub device_class: Option<String>,
    /// Unit of a sensor's value (`unit_of_measurement`).
    pub unit: Option<String>,
}

impl EntityState {
    /// Whether the entity cannot be used.
    pub fn unavailable(&self) -> bool {
        self.state == "unavailable" || self.state == "unknown"
    }

    /// A power sensor's value in watts (`W`, `kW` or `MW`; a sensor without a unit counts as
    /// watts), when its state is a number.
    pub fn watts(&self) -> Option<f64> {
        let value = self
            .state
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())?;
        let factor = match self.unit.as_deref() {
            Some("kW") => 1_000.0,
            Some("MW") => 1_000_000.0,
            Some("W") | None => 1.0,
            Some(_) => return None,
        };
        Some(value * factor)
    }
}

/// Reads `{ "entity_id": { "state": …, "attributes": { … } }, … }`; `null` removes an entity.
pub fn read_states(value: &Value) -> BTreeMap<String, Option<EntityState>> {
    let Some(map) = value.as_object() else {
        return BTreeMap::new();
    };
    map.iter()
        .map(|(id, entry)| {
            let state = entry.as_object().map(|object| {
                let attributes = object.get("attributes");
                let attr = |name: &str| attributes.and_then(|a| a.get(name));
                let number =
                    |name: &str| attr(name).and_then(Value::as_f64).filter(|n| n.is_finite());
                EntityState {
                    state: object
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_owned(),
                    brightness: number("brightness"),
                    rgb: attr("rgb_color").and_then(Value::as_array).and_then(|c| {
                        let channel = |i: usize| {
                            c.get(i)
                                .and_then(Value::as_f64)
                                .filter(|v| v.is_finite())
                                .map(|v| v.clamp(0.0, 255.0).round() as u8)
                        };
                        Some(Rgb8 {
                            r: channel(0)?,
                            g: channel(1)?,
                            b: channel(2)?,
                        })
                    }),
                    kelvin: number("color_temp_kelvin"),
                    position: number("current_position"),
                    device_class: attr("device_class")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    unit: attr("unit_of_measurement")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                }
            });
            (id.clone(), state)
        })
        .collect()
}

/// How an element looks: its own light and whether its entities are unavailable.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Look {
    /// Colour of its light (linear RGB).
    pub glow: [f32; 3],
    /// Strength of its light: 0 off, 1 the default, up to 2.
    pub strength: f32,
    /// Its entities are unavailable: drawn greyed out.
    pub unavailable: f32,
    /// Tap feedback, 1 just tapped, fading to 0.
    pub highlight: f32,
    /// Its light is a screen's (a linked media player), not a lamp's.
    pub screen: bool,
    /// What its linked power sensors read (W), for the power layer.
    pub power: f32,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            glow: [1.0, 0.8, 0.55],
            strength: 0.0,
            unavailable: 0.0,
            highlight: 0.0,
            screen: false,
            power: 0.0,
        }
    }
}

/// What every element should look like.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Targets {
    /// One look per plan element.
    pub looks: Vec<Look>,
    /// Openings of doors, windows and curtains, and blinds.
    pub overrides: Overrides,
}

/// The screen colour of a TV that plays.
const SCREEN: Rgb8 = Rgb8::from_u32(0xa9c4ff);
/// The colour of a fire that burns (D-072).
pub const FIRE: Rgb8 = Rgb8::from_u32(0xff8a3d);

/// What every element should look like, from the plan, the bindings and the entity states.
pub fn targets(
    plan: &Plan,
    lights: &[LightSpot],
    bindings: &Bindings,
    states: &BTreeMap<String, EntityState>,
) -> Targets {
    let mut looks = vec![Look::default(); plan.elements.len()];
    // The plan's own lamps, as drawn without Home Assistant.
    for light in lights.iter().filter(|l| !l.screen) {
        if let Some(look) = looks.get_mut(light.element) {
            look.glow = light.color.to_linear();
            #[allow(clippy::cast_possible_truncation)]
            let power = light.power as f32;
            look.strength = if light.on { power } else { 0.0 };
        }
    }
    let mut overrides = Overrides::default();
    for (index, element) in plan.elements.iter().enumerate() {
        let Some(entities) = bindings.elements.get(element.id()) else {
            continue;
        };
        let resolved: Vec<(Role, Option<&EntityState>)> = entities
            .iter()
            .map(|e| {
                let state = states.get(&e.entity_id);
                let class = state.and_then(|s| s.device_class.as_deref());
                (
                    e.role.unwrap_or_else(|| Role::derive(&e.entity_id, class)),
                    state,
                )
            })
            .collect();
        let visual = |role: Role| {
            matches!(
                role,
                Role::Light
                    | Role::Switch
                    | Role::Fan
                    | Role::Cover
                    | Role::Media
                    | Role::Contact
                    | Role::Lock
                    | Role::Camera
            )
        };
        let shown: Vec<&(Role, Option<&EntityState>)> =
            resolved.iter().filter(|(role, _)| visual(*role)).collect();
        let look = &mut looks[index];
        if !shown.is_empty()
            && shown
                .iter()
                .all(|(_, state)| state.is_none_or(EntityState::unavailable))
        {
            look.unavailable = 1.0;
        }
        let on = |role: Role| {
            resolved
                .iter()
                .filter(|(r, _)| *r == role)
                .filter_map(|(_, s)| *s)
                .filter(|s| !s.unavailable())
                .collect::<Vec<_>>()
        };
        match element {
            Element::Furniture(item) => {
                let lights = on(Role::Light);
                let switches = on(Role::Switch);
                if !lights.is_empty() {
                    // The brightest bound light decides.
                    let lit = lights
                        .iter()
                        .filter(|s| s.state == "on")
                        .map(|s| {
                            let level = s.brightness.map_or(1.0, |b| (b / 255.0).clamp(0.02, 1.0));
                            let color = s
                                .rgb
                                .or_else(|| s.kelvin.map(kelvin_to_rgb))
                                .unwrap_or_else(|| light_color(item));
                            (level, color)
                        })
                        .max_by(|a, b| a.0.total_cmp(&b.0));
                    #[allow(clippy::cast_possible_truncation)]
                    match lit {
                        Some((level, color)) => {
                            look.strength = (level * light_power(item)) as f32;
                            look.glow = color.to_linear();
                        }
                        None => look.strength = 0.0,
                    }
                } else if item.kind.is_light() && !switches.is_empty() {
                    #[allow(clippy::cast_possible_truncation)]
                    let power = light_power(item) as f32;
                    look.strength = if switches.iter().any(|s| s.state == "on") {
                        power
                    } else {
                        0.0
                    };
                } else if item.kind.burns() {
                    // A fireplace burns while its switch is on, or its climate entity heats.
                    let climates = on(Role::Climate);
                    if !switches.is_empty() || !climates.is_empty() {
                        let lit = switches.iter().any(|s| s.state == "on")
                            || climates.iter().any(|s| s.state != "off");
                        look.glow = FIRE.to_linear();
                        look.strength = if lit { 1.0 } else { 0.0 };
                    }
                }
                let watts: f64 = on(Role::Power).iter().filter_map(|s| s.watts()).sum();
                #[allow(clippy::cast_possible_truncation)]
                {
                    look.power = watts.max(0.0) as f32;
                }
                if let Some(media) = on(Role::Media).first() {
                    look.screen = true;
                    look.glow = SCREEN.to_linear();
                    look.strength = match media.state.as_str() {
                        "playing" => 0.8,
                        "paused" | "on" | "idle" | "buffering" => 0.35,
                        _ => 0.0,
                    };
                }
                if let Some(open) = on(Role::Cover).first().and_then(|c| cover_open(c)) {
                    overrides.open.insert(index, open);
                }
            }
            Element::Door(door) | Element::Window(door) => {
                let is_door = matches!(element, Element::Door(_));
                if let Some(contact) = on(Role::Contact).first() {
                    let open = if contact.state == "on" {
                        if is_door {
                            door.open_fraction().max(0.85)
                        } else {
                            0.75
                        }
                    } else {
                        0.0
                    };
                    overrides.open.insert(index, open);
                }
                if let Some(up) = on(Role::Cover).first().and_then(|c| cover_open(c)) {
                    if is_door {
                        overrides.open.insert(index, up);
                    } else {
                        overrides.blind.insert(index, up);
                    }
                }
            }
            Element::Room(_) | Element::Wall(_) => {}
        }
    }
    Targets { looks, overrides }
}

/// The opening of a cover (0 closed, 1 open), from its position or its state.
fn cover_open(state: &EntityState) -> Option<f64> {
    state
        .position
        .map(|p| (p / 100.0).clamp(0.0, 1.0))
        .or(match state.state.as_str() {
            "open" | "opening" => Some(1.0),
            "closed" | "closing" => Some(0.0),
            _ => None,
        })
}

/// Fade speed of lights (strength per ms).
const LIGHT_SPEED: f32 = 1.0 / 350.0;
/// Speed of doors, windows, curtains and blinds (opening per ms).
const MOVE_SPEED: f64 = 1.0 / 700.0;
/// Fade of the tap highlight (per ms).
const HIGHLIGHT_SPEED: f32 = 1.0 / 450.0;

/// The looks being shown, moving towards their targets.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LiveState {
    /// Current looks.
    pub looks: Vec<Look>,
    /// Current openings.
    pub overrides: Overrides,
    target: Targets,
}

/// What changed in a step.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Step {
    /// Looks changed (lights, greyed out, highlight).
    pub looks: bool,
    /// Openings changed: rebuild the moving parts.
    pub moving: bool,
    /// More steps are needed.
    pub animating: bool,
}

fn approach(current: f64, target: f64, step: f64) -> f64 {
    current + (target - current).clamp(-step, step)
}

impl LiveState {
    /// Starts at `targets`, without fading.
    pub fn new(targets: Targets) -> Self {
        Self {
            looks: targets.looks.clone(),
            overrides: targets.overrides.clone(),
            target: targets,
        }
    }

    /// New targets: the looks fade towards them.
    pub fn set_targets(&mut self, targets: Targets) {
        if targets.looks.len() != self.looks.len() {
            *self = Self::new(targets);
            return;
        }
        self.target = targets;
    }

    /// New targets after the plan was edited: `old[i]` is the index element `i` had before (`None`
    /// for a new one). Looks and openings follow their elements, whatever their new index, and
    /// fade from there; new elements start at their targets.
    pub fn retarget_moved(&mut self, targets: Targets, old: &[Option<usize>]) {
        let unchanged =
            old.len() == self.looks.len() && old.iter().enumerate().all(|(i, o)| *o == Some(i));
        if unchanged {
            self.set_targets(targets);
            return;
        }
        let mut next = Self::new(targets);
        for (i, o) in old.iter().enumerate() {
            let Some(o) = *o else { continue };
            if let (Some(look), Some(previous)) = (next.looks.get_mut(i), self.looks.get(o)) {
                *look = *previous;
            }
            for (current, previous) in [
                (&mut next.overrides.open, &self.overrides.open),
                (&mut next.overrides.blind, &self.overrides.blind),
            ] {
                if let Some(v) = previous.get(&o) {
                    current.insert(i, *v);
                }
            }
        }
        *self = next;
    }

    /// Whether every look and opening has reached its target (no frame needed).
    pub fn is_settled(&self) -> bool {
        let close = |a: f32, b: f32| (a - b).abs() < 1e-4;
        let looks = self.looks.iter().zip(&self.target.looks).all(|(a, b)| {
            close(a.strength, b.strength)
                && close(a.unavailable, b.unavailable)
                && a.highlight <= 0.0
                && (0..3).all(|k| close(a.glow[k], b.glow[k]))
        });
        let moving = [
            (&self.overrides.open, &self.target.overrides.open),
            (&self.overrides.blind, &self.target.overrides.blind),
        ]
        .into_iter()
        .all(|(current, target)| {
            target
                .iter()
                .all(|(k, v)| current.get(k).is_some_and(|c| (c - v).abs() < 1e-9))
        });
        looks && moving
    }

    /// Flashes an element (tap feedback).
    pub fn highlight(&mut self, element: usize) {
        if let Some(look) = self.looks.get_mut(element) {
            look.highlight = 1.0;
        }
    }

    /// Advances the fades by `dt` milliseconds.
    #[allow(clippy::cast_possible_truncation)]
    pub fn step(&mut self, dt: f64) -> Step {
        let dt = dt.clamp(0.0, 100.0);
        let mut step = Step::default();
        let light = LIGHT_SPEED * dt as f32;
        for (look, target) in self.looks.iter_mut().zip(&self.target.looks) {
            let before = *look;
            look.strength = approach(
                f64::from(look.strength),
                f64::from(target.strength),
                f64::from(light) * 2.0,
            ) as f32;
            look.unavailable = approach(
                f64::from(look.unavailable),
                f64::from(target.unavailable),
                f64::from(light),
            ) as f32;
            for k in 0..3 {
                look.glow[k] = approach(
                    f64::from(look.glow[k]),
                    f64::from(target.glow[k]),
                    f64::from(light),
                ) as f32;
            }
            look.highlight = (look.highlight - HIGHLIGHT_SPEED * dt as f32).max(0.0);
            look.screen = target.screen;
            look.power = target.power;
            if *look != before {
                step.looks = true;
            }
        }
        let moved = MOVE_SPEED * dt;
        for (current, target) in [
            (&mut self.overrides.open, &self.target.overrides.open),
            (&mut self.overrides.blind, &self.target.overrides.blind),
        ] {
            for (index, goal) in target {
                match current.get_mut(index) {
                    Some(value) => {
                        let next = approach(*value, *goal, moved);
                        if (next - *value).abs() > 1e-9 {
                            *value = next;
                            step.moving = true;
                        }
                    }
                    // A part that starts following an entity: drawn there at once.
                    None => {
                        current.insert(*index, *goal);
                        step.moving = true;
                    }
                }
            }
            // A part that stops following an entity goes back to the plan.
            let before = current.len();
            current.retain(|index, _| target.contains_key(index));
            step.moving |= current.len() != before;
        }
        step.animating = step.looks || step.moving;
        step
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bindings::read_bindings;
    use crate::plan::read_plan;
    use crate::scene::{SceneOptions, build_scene};

    const DEMO: &[u8] = include_bytes!("../../../examples/demo-apartment.domotwin.json");
    const BINDINGS: &str = include_str!("../../../examples/demo-apartment.bindings.json");

    fn setup() -> (Plan, Vec<LightSpot>, Bindings) {
        let plan = read_plan(DEMO).unwrap();
        let scene = build_scene(&plan, &SceneOptions::default());
        let value: Value = serde_json::from_str(BINDINGS).unwrap();
        (plan, scene.lights, read_bindings(&value))
    }

    fn index(plan: &Plan, id: &str) -> usize {
        plan.elements.iter().position(|e| e.id() == id).unwrap()
    }

    fn states(value: Value) -> BTreeMap<String, EntityState> {
        read_states(&value)
            .into_iter()
            .filter_map(|(k, v)| Some((k, v?)))
            .collect()
    }

    #[test]
    fn looks_follow_their_elements_when_indices_move() {
        let (plan, lights, bindings) = setup();
        let lit = states(serde_json::json!({
            "light.living_room_pendant": { "state": "on", "attributes": {} },
        }));
        let pendant = index(&plan, "pendant-living");
        let mut live = LiveState::new(targets(&plan, &lights, &bindings, &lit));
        let strength = live.looks[pendant].strength;
        assert!(strength > 0.5);
        let next = live.looks[pendant + 1];
        // The element before the pendant was removed and one added at the end: the pendant is
        // one index lower, the count is the same.
        let n = live.looks.len();
        let old: Vec<Option<usize>> = (0..n)
            .map(|i| match i {
                _ if i + 1 == n => None,
                _ if i + 1 >= pendant => Some(i + 1),
                _ => Some(i),
            })
            .collect();
        let mut shifted = targets(&plan, &lights, &bindings, &lit);
        shifted.looks.remove(pendant - 1);
        shifted.looks.push(Look::default());
        live.retarget_moved(shifted, &old);
        // Each look moved with its element (by index it would have stayed with the neighbour).
        assert_eq!(live.looks[pendant - 1].strength, strength);
        assert_eq!(live.looks[pendant], next);
    }

    #[test]
    fn a_fireplace_burns_while_its_switch_is_on_or_its_climate_heats() {
        // D-072: three fireplaces, one on a switch, one on a climate entity, one linked to
        // nothing.
        let plan = read_plan(
            serde_json::json!({
                "format": "domotwin-plan", "version": 1, "items": [
                    { "id": "fire", "kind": "fireplace", "at": [100, 100], "size": [150, 40, 115] },
                    { "id": "stove", "kind": "fireplace", "style": "stove", "at": [300, 100], "size": [60, 50, 100] },
                    { "id": "cold", "kind": "fireplace", "at": [500, 100], "size": [150, 40, 115] },
                ]
            })
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        let bindings = read_bindings(&serde_json::json!({
            "version": 1,
            "elements": {
                "fire": { "entities": [{ "entity_id": "switch.fireplace" }] },
                "stove": { "entities": [{ "entity_id": "climate.pellet_stove" }] },
            }
        }));
        let looks = |fire: &str, stove: &str| {
            let states = states(serde_json::json!({
                "switch.fireplace": { "state": fire, "attributes": {} },
                "climate.pellet_stove": { "state": stove, "attributes": {} },
            }));
            targets(&plan, &[], &bindings, &states).looks
        };
        let on = looks("on", "heat");
        assert_eq!(
            (on[0].strength, on[1].strength, on[2].strength),
            (1.0, 1.0, 0.0)
        );
        assert_eq!(on[0].glow, FIRE.to_linear());
        let off = looks("off", "off");
        assert_eq!((off[0].strength, off[1].strength), (0.0, 0.0));
        // Unavailable: as cold, and greyed out.
        let lost = looks("unavailable", "unavailable");
        assert_eq!((lost[0].strength, lost[1].strength), (0.0, 0.0));
    }

    #[test]
    fn lamps_follow_their_lights() {
        let (plan, lights, bindings) = setup();
        let states = states(serde_json::json!({
            "light.living_room_pendant": { "state": "on", "attributes": { "brightness": 128, "rgb_color": [255, 0, 0] } },
            "light.living_room_floor_lamp": { "state": "off", "attributes": {} },
            "light.sideboard_lamp": { "state": "unavailable", "attributes": {} },
            "media_player.living_room_tv": { "state": "playing", "attributes": {} },
        }));
        let t = targets(&plan, &lights, &bindings, &states);
        let pendant = t.looks[index(&plan, "pendant-living")];
        assert!((pendant.strength - 0.5).abs() < 0.02, "{pendant:?}");
        assert!(pendant.glow[0] > 0.9 && pendant.glow[1] < 0.01);
        assert_eq!(t.looks[index(&plan, "floor-lamp")].strength, 0.0);
        let sideboard = t.looks[index(&plan, "table-lamp")];
        assert_eq!(sideboard.unavailable, 1.0);
        assert!(t.looks[index(&plan, "tv")].strength > 0.5);
        // A bound lamp whose entity is missing is greyed out too.
        assert_eq!(t.looks[index(&plan, "ceiling-kitchen")].unavailable, 1.0);
    }

    #[test]
    fn openings_follow_contacts_and_covers() {
        let (plan, lights, bindings) = setup();
        let states = states(serde_json::json!({
            "binary_sensor.entrance_door_contact": { "state": "on", "attributes": { "device_class": "door" } },
            "binary_sensor.living_room_window_contact": { "state": "off", "attributes": {} },
            "cover.living_room_curtains": { "state": "open", "attributes": { "current_position": 40 } },
            "cover.bedroom_curtains": { "state": "closed", "attributes": {} },
        }));
        let t = targets(&plan, &lights, &bindings, &states);
        assert!(t.overrides.open[&index(&plan, "door-entrance")] >= 0.85);
        assert_eq!(t.overrides.open[&index(&plan, "win-living-1")], 0.0);
        assert!((t.overrides.open[&index(&plan, "curtain-living")] - 0.4).abs() < 1e-9);
        assert_eq!(t.overrides.open[&index(&plan, "curtain-bedroom")], 0.0);
    }

    #[test]
    fn power_sensors_add_up_in_watts() {
        let watts = |state: &str, unit: Option<&str>| {
            EntityState {
                state: state.to_owned(),
                unit: unit.map(str::to_owned),
                ..EntityState::default()
            }
            .watts()
        };
        assert_eq!(watts("12.5", Some("W")), Some(12.5));
        assert_eq!(watts("1.2", Some("kW")), Some(1_200.0));
        assert_eq!(watts("40", None), Some(40.0));
        assert_eq!(watts("40", Some("kWh")), None);
        assert_eq!(watts("unavailable", Some("W")), None);
        assert_eq!(watts("NaN", Some("W")), None);
        let (plan, lights, bindings) = setup();
        let states = states(serde_json::json!({
            "sensor.fridge_power": { "state": "0.09", "attributes": { "unit_of_measurement": "kW" } },
            "sensor.tv_power": { "state": "-3", "attributes": { "unit_of_measurement": "W" } },
        }));
        let t = targets(&plan, &lights, &bindings, &states);
        assert!((t.looks[index(&plan, "fridge")].power - 90.0).abs() < 1e-3);
        // A negative reading (a sensor feeding power back) counts as nothing.
        assert_eq!(t.looks[index(&plan, "tv")].power, 0.0);
        let mut live = LiveState::new(Targets::default());
        live.set_targets(t);
        live.step(16.0);
        assert!((live.looks[index(&plan, "fridge")].power - 90.0).abs() < 1e-3);
    }

    #[test]
    fn looks_fade_and_doors_move() {
        let (plan, lights, bindings) = setup();
        let off = targets(&plan, &lights, &bindings, &BTreeMap::new());
        let mut live = LiveState::new(off);
        let lamp = index(&plan, "pendant-living");
        let states = states(serde_json::json!({
            "light.living_room_pendant": { "state": "on", "attributes": {} },
            "binary_sensor.entrance_door_contact": { "state": "on", "attributes": {} },
        }));
        live.set_targets(targets(&plan, &lights, &bindings, &states));
        let door = index(&plan, "door-entrance");
        let first = live.step(16.0);
        assert!(first.looks && first.animating);
        let mut t = 16.0;
        while live.step(16.0).animating {
            t += 16.0;
            assert!(t < 5_000.0);
        }
        assert!((live.looks[lamp].strength - 1.0).abs() < 1e-3);
        assert!(live.overrides.open[&door] >= 0.85);
        // Forgetting the contact puts the door back as the plan has it.
        live.set_targets(targets(&plan, &lights, &bindings, &BTreeMap::new()));
        assert!(live.step(16.0).moving);
        assert!(!live.overrides.open.contains_key(&door));
        live.highlight(lamp);
        assert!(live.step(16.0).looks);
    }

    #[test]
    fn a_step_back_in_time_moves_nothing() {
        // The frontend's `settle()` draws frames ahead of the page's clock: the page's next frame
        // then comes earlier than the last one.
        let (plan, lights, bindings) = setup();
        let open = states(serde_json::json!({
            "binary_sensor.entrance_door_contact": { "state": "on", "attributes": {} },
        }));
        let mut live = LiveState::new(targets(&plan, &lights, &bindings, &open));
        let lit = states(serde_json::json!({
            "light.living_room_pendant": { "state": "on", "attributes": {} },
            "binary_sensor.entrance_door_contact": { "state": "off", "attributes": {} },
        }));
        live.set_targets(targets(&plan, &lights, &bindings, &lit));
        let lamp = index(&plan, "pendant-living");
        let door = index(&plan, "door-entrance");
        let opened = live.overrides.open[&door];
        // On their way: the lamp no longer greyed out (its light came), the door closing.
        assert!(live.step(100.0).animating);
        assert!(live.looks[lamp] != live.target.looks[lamp]);
        assert!(live.overrides.open[&door] > 0.0 && live.overrides.open[&door] < opened);
        let before = live.clone();
        assert!(!live.step(-30_000.0).animating);
        assert!(live == before);
        assert!(live.step(16.0).animating);
    }
}
