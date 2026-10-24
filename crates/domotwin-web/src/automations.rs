//! Automation wires for JavaScript (`DECISIONS.md`, D-032): the automations the interface hands
//! over, each with its ends already placed (at a piece, in a room, or as a label above a room or
//! the home), drawn as wires from what sets them off or what they check to what they act on; where
//! each end is on screen; which automations a tap on a wire belongs to; a pulse along an
//! automation's wires when it runs.

use std::collections::{BTreeMap, HashMap};

use domotwin_core::automation::{Automation, Link, PlacedEnd, Role, Spot, Target, links};
use domotwin_core::scene::wires::{self, Flow, Wire, segments};
use domotwin_render::WireSet;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::engine::Engine;
use crate::network::ABOVE;

/// Most automations drawn at once.
const MAX_AUTOMATIONS: usize = 500;
/// The middle of a room an area's end is at, above its floor (cm).
const IN_ROOM: f32 = 90.0;
/// Labels float this high above a room's floor, or above the home's (cm)…
const ABOVE_ROOM: f32 = 230.0;
const ABOVE_HOME: f32 = 320.0;
/// …side by side, this far apart (cm).
const LABEL_GAP: f32 = 80.0;
/// How strongly the wires are drawn when every automation is shown, when one is picked out from
/// them, and for the others then.
const FADED: f32 = 0.55;
const PICKED: f32 = 1.0;
const OTHERS: f32 = 0.2;

/// One automation as the interface hands it over.
#[derive(Debug)]
struct Shown {
    id: String,
    color: [f32; 3],
}

/// The automations shown and their wires.
#[derive(Debug, Default)]
pub(crate) struct AutomationsShown {
    automations: Vec<Shown>,
    ends: Vec<Vec<PlacedEnd>>,
    /// Bundled by room (a home with many automations), and the colour of the bundles.
    grouped: bool,
    bundle: [f32; 3],
    /// Every automation drawn lighter (the layer of them all), and the one picked out.
    faded: bool,
    picked: Option<usize>,
    links: Vec<Link>,
    /// The spots the ends are at, each once, and the roles and automations at each.
    spots: Vec<Spot>,
    /// Each drawn wire, with the index of its link.
    wires: Vec<(usize, Wire)>,
    /// The ends as the spots show them: their rooms when the wires are bundled.
    shown_ends: Vec<Vec<PlacedEnd>>,
    /// The runs of late (automation, frames' clock in ms), to set their pulses off again when
    /// the wires are built again (an automation picked out, the scene changed).
    runs: Vec<(usize, f64)>,
}

/// How long a run's pulse is set off again after the wires are built again (ms).
const RUN_KEPT_MS: f64 = 5_000.0;

fn color_of(value: Option<&Value>) -> Option<[f32; 3]> {
    let list = value?.as_array()?;
    let mut out = [0.0_f32; 3];
    for (i, c) in out.iter_mut().enumerate() {
        #[allow(clippy::cast_possible_truncation)]
        let v = list.get(i)?.as_f64()? as f32;
        *c = v.clamp(0.0, 1.0);
    }
    Some(out)
}

/// An automation's id, whole (up to Home Assistant's 255 characters).
fn id_of(value: Option<&Value>) -> Option<String> {
    let id = value?.as_str()?.trim();
    (!id.is_empty() && id.len() <= 255).then(|| id.to_owned())
}

/// A piece's, a room's id or a label (up to 255 characters, as Home Assistant's ids).
fn text(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| text.chars().take(255).collect())
}

/// An end as the interface writes it: `{"role", "piece" | "room" | "above" (with "room"),
/// "dynamic"}`.
fn read_end(value: &Value) -> Option<PlacedEnd> {
    let role = match value.get("role")?.as_str()? {
        "trigger" => Role::Trigger,
        "condition" => Role::Condition,
        "action" => Role::Action,
        _ => return None,
    };
    let spot = if let Some(piece) = text(value.get("piece")) {
        Spot::Piece(piece)
    } else if let Some(label) = text(value.get("above")) {
        Spot::Above {
            room: text(value.get("room")),
            label,
        }
    } else {
        Spot::Room(text(value.get("room"))?)
    };
    Some(PlacedEnd {
        role,
        spot,
        dynamic: value.get("dynamic").and_then(Value::as_bool) == Some(true),
    })
}

/// What an automation's configuration (JSON, `automation/config`'s `config`) involves: JSON
/// `{"ends": [{"role", "entity" | "device" | "area" | "place" | "dynamic": name}], "skipped"}`.
#[wasm_bindgen(js_name = readAutomation)]
pub fn read_automation(config: &str) -> String {
    let value: Value = serde_json::from_str(config).unwrap_or(Value::Null);
    let automation = Automation::read(&value);
    let ends: Vec<Value> = automation
        .ends
        .iter()
        .map(|end| {
            let (kind, name) = match &end.target {
                Target::Entity(id) => ("entity", id),
                Target::Device(id) => ("device", id),
                Target::Area(id) => ("area", id),
                Target::Floor(id) => ("floor", id),
                Target::Label(id) => ("label", id),
                Target::Place(kind) => ("place", kind),
                Target::Dynamic(label) => ("dynamic", label),
            };
            let mut entry = json!({ "role": end.role.name() });
            entry[kind] = json!(name);
            entry
        })
        .collect();
    json!({ "ends": ends, "skipped": automation.skipped }).to_string()
}

#[wasm_bindgen]
impl Engine {
    /// Shows the wires of automations (JSON `{"automations": [{"id", "color": [r, g, b], "ends":
    /// [...]}], "grouped", "faded", "bundle": [r, g, b]}`, empty to hide them): from every trigger
    /// and condition to every action, in the automation's colour; with `grouped`, bundled by
    /// room. Returns the spots the ends are at, in the order `automationPoints` gives their
    /// places: JSON `[{"piece" | "room" | "above", "room"?, "roles": [...], "automations":
    /// [indices], "dynamic"}]`.
    #[wasm_bindgen(js_name = setAutomations)]
    pub fn set_automations(&mut self, json: &str) -> String {
        let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
        let list = value.get("automations").and_then(Value::as_array);
        let Some(list) = list.filter(|l| !l.is_empty()) else {
            self.automations = None;
            self.renderer.set_wires(WireSet::Automations, &[]);
            return "[]".to_owned();
        };
        let mut shown = AutomationsShown {
            grouped: value.get("grouped").and_then(Value::as_bool) == Some(true),
            faded: value.get("faded").and_then(Value::as_bool) == Some(true),
            bundle: color_of(value.get("bundle")).unwrap_or([0.6, 0.65, 0.75]),
            ..AutomationsShown::default()
        };
        for item in list.iter().take(MAX_AUTOMATIONS) {
            let Some(id) = id_of(item.get("id")) else {
                continue;
            };
            let ends: Vec<PlacedEnd> = item
                .get("ends")
                .and_then(Value::as_array)
                .map(|ends| ends.iter().filter_map(read_end).collect())
                .unwrap_or_default();
            shown.automations.push(Shown {
                id,
                color: color_of(item.get("color")).unwrap_or([0.3, 0.6, 1.0]),
            });
            shown.ends.push(ends);
        }
        // The one picked out and the runs of late (a few) stay with their automations, by id.
        if let Some(old) = self.automations.take() {
            let moved = |i: usize| {
                let id = &old.automations.get(i)?.id;
                shown.automations.iter().position(|a| &a.id == id)
            };
            shown.picked = old.picked.and_then(moved);
            shown.runs = old
                .runs
                .iter()
                .filter_map(|&(i, at)| Some((moved(i)?, at)))
                .collect();
        }
        self.automations = Some(shown);
        self.place_automations();
        self.automation_spots()
    }

    /// Where each spot of the automations shown is drawn now (the order `setAutomations` gave
    /// them): JSON `[[x, y] | null]` in device pixels from the top left.
    #[wasm_bindgen(js_name = automationPoints)]
    pub fn automation_points(&self) -> String {
        let Some(shown) = self.automations.as_ref() else {
            return "[]".to_owned();
        };
        let points = self.spot_points(&shown.spots);
        let out: Vec<Value> = points
            .into_iter()
            .map(|p| {
                p.and_then(|(at, part)| {
                    let offset = self.renderer.view.offset(usize::from(part));
                    let world = std::array::from_fn(|i| f64::from(at[i]) + offset[i]);
                    self.renderer.screen_point(world)
                })
                .map_or(Value::Null, |[x, y]| json!([x, y]))
            })
            .collect();
        Value::Array(out).to_string()
    }

    /// The automations of the wires drawn within a tap's reach of the device pixel (`x`, `y`),
    /// those of the nearest first, each once: JSON `["automation.…"]`, or an empty string.
    #[wasm_bindgen(js_name = automationAt)]
    pub fn automation_at(&self, x: f64, y: f64) -> String {
        let Some(shown) = self.automations.as_ref() else {
            return String::new();
        };
        let mut ids: Vec<&str> = Vec::new();
        for link in self.wires_near(&shown.wires, x, y) {
            for &i in &shown.links[link].automations {
                if let Some(a) = shown.automations.get(i)
                    && !ids.contains(&a.id.as_str())
                {
                    ids.push(&a.id);
                }
            }
        }
        if ids.is_empty() {
            String::new()
        } else {
            json!(ids).to_string()
        }
    }

    /// Picks out one automation (its id; empty: none): its wires drawn fully, the others lighter.
    #[wasm_bindgen(js_name = pickAutomation)]
    pub fn pick_automation(&mut self, id: &str) {
        let Some(shown) = self.automations.as_mut() else {
            return;
        };
        shown.picked = shown.automations.iter().position(|a| a.id == id);
        self.place_automations();
    }

    /// An automation ran (its id) at `time_ms` (the frames' clock): a pulse runs along its wires,
    /// from what set it off to what it acted on. Returns whether it has wires shown.
    #[wasm_bindgen(js_name = pulseAutomation)]
    pub fn pulse_automation(&mut self, id: &str, time_ms: f64) -> bool {
        let Some(shown) = self.automations.as_ref() else {
            return false;
        };
        let Some(index) = shown.automations.iter().position(|a| a.id == id) else {
            return false;
        };
        let wires: Vec<u32> = shown
            .wires
            .iter()
            .enumerate()
            .filter(|(_, (k, _))| shown.links[*k].automations.contains(&index))
            .filter_map(|(w, _)| u32::try_from(w).ok())
            .collect();
        if wires.is_empty() {
            return false;
        }
        self.renderer
            .shoot_wires(WireSet::Automations, &wires, time_ms);
        if let Some(shown) = self.automations.as_mut() {
            shown.runs.retain(|(_, at)| time_ms - at < RUN_KEPT_MS);
            shown.runs.push((index, time_ms));
        }
        true
    }
}

impl Engine {
    /// Works the wires of the automations shown out again, for the scene shown (after it changed,
    /// or another automation was picked out).
    pub(crate) fn place_automations(&mut self) {
        let Some(shown) = self.automations.as_ref() else {
            return;
        };
        let elements = self.elements_by_id();
        // Bundled by room: a piece stands for its room, a label for its room or the home.
        let room_of = |spot: &Spot| -> Spot {
            let home = Spot::Above {
                room: None,
                label: String::new(),
            };
            match spot {
                // A piece the plan shown lacks stays as it is: it is not drawn.
                Spot::Piece(id) => elements.get(id.as_str()).map_or_else(
                    || spot.clone(),
                    |info| {
                        self.room_of(info)
                            .map_or(home, |room| Spot::Room(room.clone()))
                    },
                ),
                Spot::Room(id) => Spot::Room(id.clone()),
                Spot::Above { room: Some(r), .. } => Spot::Room(r.clone()),
                Spot::Above { room: None, .. } => home,
            }
        };
        let by_room: &dyn Fn(&Spot) -> Spot = &room_of;
        let grouped = shown.grouped.then_some(by_room);
        let links = links(&shown.ends, grouped);
        let shown_ends: Vec<Vec<PlacedEnd>> = if shown.grouped {
            shown
                .ends
                .iter()
                .map(|ends| {
                    ends.iter()
                        .map(|e| PlacedEnd {
                            spot: room_of(&e.spot),
                            ..e.clone()
                        })
                        .collect()
                })
                .collect()
        } else {
            shown.ends.clone()
        };
        // The spots, each once: the ends' (not bundled), or the bundles' ends.
        let mut spots: Vec<Spot> = Vec::new();
        let mut index: HashMap<&Spot, usize> = HashMap::new();
        let ends: Vec<&Spot> = if shown.grouped {
            links.iter().flat_map(|l| [&l.from, &l.to]).collect()
        } else {
            shown.ends.iter().flatten().map(|e| &e.spot).collect()
        };
        for spot in ends {
            index.entry(spot).or_insert_with(|| {
                spots.push(spot.clone());
                spots.len() - 1
            });
        }
        let points = self.spot_points(&spots);
        let point_of = |spot: &Spot| index.get(spot).and_then(|&i| points[i]);
        let mut drawn = Vec::new();
        // How many wires already join the same two spots: the next rises higher.
        let mut alike: HashMap<(&Spot, &Spot), u16> = HashMap::new();
        for (k, link) in links.iter().enumerate() {
            let (Some((from, pa)), Some((to, pb))) = (point_of(&link.from), point_of(&link.to))
            else {
                continue;
            };
            let picked = shown.picked.map(|p| link.automations.contains(&p));
            #[allow(clippy::cast_precision_loss)]
            let weight = match picked {
                Some(true) => PICKED,
                Some(false) => OTHERS,
                None if shown.grouped => (0.35 + 0.13 * link.automations.len() as f32).min(1.0),
                None if shown.faded => FADED,
                None => 1.0,
            };
            let color = if shown.grouped {
                shown.bundle
            } else {
                link.automations
                    .first()
                    .and_then(|&i| shown.automations.get(i))
                    .map_or(shown.bundle, |a| a.color)
            };
            let (a, b) = if link.from <= link.to {
                (&link.from, &link.to)
            } else {
                (&link.to, &link.from)
            };
            let before = alike.entry((a, b)).or_insert(0);
            // Up to the highest a wire rises (`wires::Wire::bend`): the rest share it.
            let bend = 1.0 + 0.4 * f32::from((*before).min(7));
            *before += 1;
            let wire = Wire {
                from,
                to,
                parts: [pa, pb],
                color,
                flow: Flow::None,
                dashed: link.dashed,
                weight,
                bend,
            };
            if wires::drawn(&wire) {
                drawn.push((k, wire));
            }
        }
        let pieces: Vec<Wire> = drawn.iter().map(|(_, w)| *w).collect();
        // The wires of the runs of late, to set their pulses off again on the new wires.
        let now = self.renderer.frame_ms();
        let runs: Vec<(usize, f64)> = shown
            .runs
            .iter()
            .copied()
            .filter(|&(_, at)| now - at < RUN_KEPT_MS)
            .collect();
        let again: Vec<(Vec<u32>, f64)> = runs
            .iter()
            .map(|&(index, at)| {
                let wires = drawn
                    .iter()
                    .enumerate()
                    .filter(|(_, (k, _))| links[*k].automations.contains(&index))
                    .filter_map(|(w, _)| u32::try_from(w).ok())
                    .collect();
                (wires, at)
            })
            .filter(|(wires, _): &(Vec<u32>, f64)| !wires.is_empty())
            .collect();
        self.renderer
            .set_wires(WireSet::Automations, &segments(&pieces));
        for (wires, at) in again {
            self.renderer.shoot_wires(WireSet::Automations, &wires, at);
        }
        if let Some(shown) = self.automations.as_mut() {
            shown.links = links;
            shown.spots = spots;
            shown.wires = drawn;
            shown.shown_ends = shown_ends;
            shown.runs = runs;
        }
    }

    /// No plan is shown any more: the automations' wires are neither drawn nor found by a tap.
    pub(crate) fn drop_automation_wires(&mut self) {
        if let Some(shown) = self.automations.as_mut() {
            shown.wires.clear();
        }
        self.renderer.set_wires(WireSet::Automations, &[]);
    }

    /// The spots of the automations shown, as JSON for the interface.
    fn automation_spots(&self) -> String {
        let Some(shown) = self.automations.as_ref() else {
            return "[]".to_owned();
        };
        // The roles, automations and whether a template decides, at each spot.
        let index: HashMap<&Spot, usize> = shown
            .spots
            .iter()
            .enumerate()
            .map(|(i, s)| (s, i))
            .collect();
        let mut at: Vec<(Vec<&str>, Vec<usize>, bool)> =
            vec![(Vec::new(), Vec::new(), false); shown.spots.len()];
        for (i, ends) in shown.shown_ends.iter().enumerate() {
            for end in ends {
                let Some(&k) = index.get(&end.spot) else {
                    continue;
                };
                let (roles, automations, dynamic) = &mut at[k];
                if !roles.contains(&end.role.name()) {
                    roles.push(end.role.name());
                }
                if automations.last() != Some(&i) {
                    automations.push(i);
                }
                *dynamic |= end.dynamic;
            }
        }
        let out: Vec<Value> = shown
            .spots
            .iter()
            .zip(at)
            .map(|(spot, (roles, automations, dynamic))| {
                let mut entry = match spot {
                    Spot::Piece(id) => json!({ "piece": id }),
                    Spot::Room(id) => json!({ "room": id }),
                    Spot::Above { room, label } => json!({ "above": label, "room": room }),
                };
                entry["roles"] = json!(roles);
                entry["automations"] = json!(automations);
                entry["dynamic"] = json!(dynamic);
                entry
            })
            .collect();
        Value::Array(out).to_string()
    }

    /// Where each spot is, on its storey's floor, and that storey: a piece's top, a room's middle,
    /// labels above their room or the home, side by side. None for what the plan shown lacks.
    fn spot_points(&self, spots: &[Spot]) -> Vec<Option<([f32; 3], u8)>> {
        let elements = self.elements_by_id();
        let storey = |s: usize| u8::try_from(s).ok();
        // The labels above each room (or the home), in order, to set them side by side.
        let mut labels: BTreeMap<Option<&str>, Vec<&str>> = BTreeMap::new();
        for spot in spots {
            if let Spot::Above { room, label } = spot {
                let list = labels.entry(room.as_deref()).or_default();
                if !list.contains(&label.as_str()) {
                    list.push(label);
                }
            }
        }
        // The home's middle: of everything on the top storey shown.
        let top = self.elements.iter().map(|e| e.storey).max();
        let home = top.and_then(|top| {
            let mut min = [f32::MAX; 3];
            let mut max = [f32::MIN; 3];
            for info in self.elements.iter().filter(|e| e.storey == top) {
                let [lo, hi] = info.bounds;
                if lo == hi {
                    continue;
                }
                for i in 0..3 {
                    min[i] = min[i].min(lo[i]);
                    max[i] = max[i].max(hi[i]);
                }
            }
            (min[0] <= max[0])
                .then(|| ([(min[0] + max[0]) * 0.5, 0.0, (min[2] + max[2]) * 0.5], top))
        });
        spots
            .iter()
            .map(|spot| match spot {
                Spot::Piece(id) => {
                    let info = elements.get(id.as_str())?;
                    let [x, y, z] = info.top()?;
                    Some(([x, y + ABOVE, z], storey(info.storey)?))
                }
                Spot::Room(id) => {
                    let info = elements.get(id.as_str())?;
                    let [x, _, z] = info.top()?;
                    Some(([x, IN_ROOM, z], storey(info.storey)?))
                }
                Spot::Above { room, label } => {
                    let list = labels.get(&room.as_deref())?;
                    let k = list.iter().position(|l| l == label)?;
                    #[allow(clippy::cast_precision_loss)]
                    let aside = (k as f32 - (list.len() - 1) as f32 / 2.0) * LABEL_GAP;
                    let (centre, height, part) = match room {
                        Some(room) => {
                            let info = elements.get(room.as_str())?;
                            (info.top()?, ABOVE_ROOM, info.storey)
                        }
                        None => {
                            let (centre, part) = home?;
                            (centre, ABOVE_HOME, part)
                        }
                    };
                    Some(([centre[0] + aside, height, centre[2]], storey(part)?))
                }
            })
            .collect()
    }
}
