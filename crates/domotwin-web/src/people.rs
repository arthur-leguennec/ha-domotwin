//! People in their rooms for JavaScript (`DECISIONS.md`, D-034): who is in which room, drawn as
//! figures that walk from room to room, and where their names go.

use domotwin_core::people::{People, Wanted};
use domotwin_core::plan::Rgb8;
use domotwin_core::scene::figures::{FIGURE_HEIGHT, PIN_HEIGHT};
use domotwin_render::{Figure, FigureShape};
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::engine::Engine;

/// A person as the frontend sends them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PersonShown {
    id: String,
    room: String,
    color: String,
    pin: bool,
    /// Where in the room, when the locating says (plan cm, D-079).
    spot: Option<[f64; 2]>,
}

/// The people of `setPeople`'s JSON; those without an id or a room are left out.
fn read_people(json: &str) -> Vec<PersonShown> {
    let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let text = |p: &Value, key: &str| p.get(key).and_then(Value::as_str).map(str::to_owned);
    value
        .as_array()
        .map(|people| {
            people
                .iter()
                .filter_map(|p| {
                    Some(PersonShown {
                        id: text(p, "id")?,
                        room: text(p, "room")?,
                        color: text(p, "color").unwrap_or_default(),
                        pin: text(p, "look").as_deref() == Some("pin"),
                        spot: p.get("at").and_then(Value::as_array).and_then(|at| {
                            match at.as_slice() {
                                [x, y] => Some([x.as_f64()?, y.as_f64()?])
                                    .filter(|p| p.iter().all(|v| v.is_finite())),
                                _ => None,
                            }
                        }),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The people the engine draws: who is wanted where, and the figures.
#[derive(Debug, Default)]
pub(crate) struct PeopleShown {
    wanted: Vec<PersonShown>,
    people: People,
}

/// Room for the name above a head (cm).
const LABEL_ABOVE: f64 = 24.0;
/// How high a walking figure bobs (cm), and the length of a step (cm).
const BOB: f64 = 2.5;
const STEP: f64 = 38.0;

/// `#rrggbb` (sRGB) as linear RGB; grey for anything else.
fn linear(color: &str) -> [f32; 3] {
    Rgb8::from_hex(color).map_or([0.5; 3], Rgb8::to_linear)
}

#[wasm_bindgen]
impl Engine {
    /// The people to draw: JSON `[{"id", "room", "color": "#rrggbb", "look": "figure" | "pin"}]`,
    /// each in a room of the plans shown (others are left out). A figure new to the home fades
    /// in, one whose room changed walks there through the doors, one gone fades out; at once
    /// under *reduce motion*.
    #[wasm_bindgen(js_name = setPeople)]
    pub fn set_people(&mut self, json: &str) {
        self.people.wanted = read_people(json);
        self.place_people();
    }

    /// Where the names of the people shown go: JSON `[{"id", "x", "y", "opacity"}]` in device
    /// pixels from the top left, above each head; people behind the camera are left out.
    #[wasm_bindgen(js_name = peoplePoints)]
    pub fn people_points(&self) -> String {
        let mut points = Vec::new();
        for w in self.people.people.walkers() {
            let top = f64::from(if w.pin { PIN_HEIGHT } else { FIGURE_HEIGHT }) + LABEL_ABOVE;
            let at = self.renderer.view.place(w.storey, [w.at[0], top, w.at[1]]);
            if w.opacity > 0.0
                && let Some([x, y]) = self.renderer.screen_point(at)
            {
                points.push(serde_json::json!({
                    "id": w.id, "x": x, "y": y, "opacity": w.opacity,
                }));
            }
        }
        serde_json::Value::Array(points).to_string()
    }
}

impl Engine {
    /// The floors of the plans shown, where people walk and robots clean, worked out when first
    /// needed after the plans changed.
    pub(crate) fn walk_floors(&mut self) {
        if self.floors.is_none() {
            self.floors = Some(match (&self.plan, &self.scene) {
                (Some(plan), Some(scene)) => {
                    scene.walk_floors(plan).into_iter().map(Some).collect()
                }
                _ => Vec::new(),
            });
        }
    }

    /// Places the people wanted in the plans shown, as they are now.
    pub(crate) fn place_people(&mut self) {
        self.walk_floors();
        let shown = &mut self.people;
        let floors = self.floors.as_deref().unwrap_or_default();
        let wanted: Vec<Wanted> = shown
            .wanted
            .iter()
            .filter_map(|p| {
                let storey = floors
                    .iter()
                    .position(|f| f.as_ref().is_some_and(|f| f.room_spot(&p.room).is_some()))?;
                Some(Wanted {
                    id: p.id.clone(),
                    storey,
                    room: p.room.clone(),
                    color: linear(&p.color),
                    pin: p.pin,
                    spot: p.spot,
                })
            })
            .collect();
        shown.people.set(&wanted, floors, self.renderer.motion());
        self.show_figures();
    }

    /// The plans shown changed (their floors forgotten): the figures no longer on their floor
    /// forgotten (another storey shown), everyone placed anew.
    pub(crate) fn replace_people(&mut self) {
        if self.plan.is_none() {
            self.people.people = People::default();
            self.show_figures();
        } else if !self.people.wanted.is_empty() || !self.people.people.walkers().is_empty() {
            self.walk_floors();
            let floors = self.floors.as_deref().unwrap_or_default();
            self.people.people.retain_on(floors);
            self.place_people();
        }
    }

    /// Moves the people on by `dt` ms (at most a tenth of a second a frame: after a long rest
    /// without frames, a walk starts from its start). Returns whether one still walks or fades.
    /// The figures are shown by the frame.
    pub(crate) fn step_people(&mut self, dt: f64) -> bool {
        if self.people.people.walkers().is_empty() {
            return false;
        }
        let dt = dt.clamp(0.0, 100.0);
        let floors = self.floors.as_deref().unwrap_or_default();
        self.people
            .people
            .step(dt / 1000.0, floors, self.renderer.motion())
    }

    /// Whether a figure walks or fades.
    pub(crate) fn people_moving(&self) -> bool {
        self.people.people.moving()
    }

    /// The people and the robots, as the renderer draws them.
    pub(crate) fn show_figures(&mut self) {
        let floors = self.floors.as_deref().unwrap_or_default();
        #[allow(clippy::cast_possible_truncation)]
        let people: Vec<Figure> = self
            .people
            .people
            .walkers()
            .iter()
            .map(|w| {
                let bob = if w.walking() {
                    (w.stride / STEP * std::f64::consts::PI).sin().abs() * BOB
                } else {
                    0.0
                };
                // On the ground where they are: a lawn is a little under the floors (D-077).
                let level = floors
                    .get(w.storey)
                    .and_then(Option::as_ref)
                    .map_or(0.0, |f| f.level_at(w.at));
                Figure {
                    storey: w.storey,
                    at: [w.at[0] as f32, (bob + level) as f32, w.at[1] as f32],
                    ground: level as f32,
                    heading: w.heading as f32,
                    color: w.color,
                    opacity: w.opacity as f32,
                    shape: if w.pin {
                        FigureShape::Pin
                    } else {
                        FigureShape::Person
                    },
                }
            })
            .collect();
        let figures = people.into_iter().chain(self.robot_figures()).collect();
        self.renderer.set_figures(figures);
    }
}
