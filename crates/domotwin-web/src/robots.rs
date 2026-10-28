//! Robot vacuums for JavaScript (`DECISIONS.md`, D-049): every robot-vacuum piece of the plans
//! shown has its robot, on its dock; what its vacuum does (cleaning, going home, paused) moves
//! it on the floor. Robot mowers likewise (D-077), on the lawns: a robot-mower piece is its dock,
//! its lawn mower's state (mowing, returning, paused) moves it, and it keeps out of the home.

use domotwin_core::geometry::polygon::{P2, label_point};
use domotwin_core::plan::{self, Element, Furniture, Kind, Plan};
use domotwin_core::robots::{Body, MOWER, Robots, Task, VACUUM, Wanted};
use domotwin_core::walk::Floor;
use domotwin_render::{Figure, FigureShape};
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::engine::Engine;

/// What the frontend says a robot does.
#[derive(Debug, Clone, PartialEq)]
struct RobotState {
    /// Its dock's piece.
    id: String,
    task: Task,
}

/// The robots of `setRobots`'s JSON: `[{"id", "state", "rooms"?}]`; those without an id are left
/// out.
fn read_robots(json: &str) -> Vec<RobotState> {
    let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    value
        .as_array()
        .map(|robots| {
            robots
                .iter()
                .filter_map(|r| {
                    let id = r.get("id").and_then(Value::as_str)?.to_owned();
                    let rooms: Vec<String> = r
                        .get("rooms")
                        .and_then(Value::as_array)
                        .map(|rooms| {
                            rooms
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default();
                    let state = r.get("state").and_then(Value::as_str).unwrap_or("docked");
                    Some(RobotState {
                        id,
                        task: Task::of_state(state, rooms),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Where the robots of a kind go on each storey shown (D-077): a vacuum in the home, a mower
/// outdoors; and the docks (by storey) it was worked out for.
#[derive(Debug)]
struct DockFloors {
    docks: Vec<(usize, P2)>,
    floors: Vec<Option<Floor>>,
}

impl DockFloors {
    /// The floors of the plans shown, `floors`, for the robots of a kind docked at `docks`.
    fn new(floors: &[Option<Floor>], docks: Vec<(usize, P2)>, mower: bool) -> Self {
        let floors = floors
            .iter()
            .enumerate()
            .map(|(storey, floor)| {
                let here: Vec<P2> = docks
                    .iter()
                    .filter(|(s, _)| *s == storey)
                    .map(|(_, p)| *p)
                    .collect();
                floor.as_ref().map(|f| {
                    if mower {
                        f.outdoors(&here)
                    } else {
                        f.indoors(&here)
                    }
                })
            })
            .collect();
        Self { docks, floors }
    }
}

/// The floors of `known`, or none.
fn floors_of(known: Option<&DockFloors>) -> &[Option<Floor>] {
    known.map_or(&[][..], |known| known.floors.as_slice())
}

/// The robots the engine draws.
#[derive(Debug)]
pub(crate) struct RobotsShown {
    states: Vec<RobotState>,
    robots: Robots,
    mowers: Robots,
    /// Where the vacuums and the mowers go, worked out when one leaves its dock.
    vacuum_floors: Option<DockFloors>,
    mower_floors: Option<DockFloors>,
    /// Each robot's colour (linear RGB), its dock's, and the ground its dock stands on (cm).
    docks: Vec<(String, [f32; 3], f64)>,
}

impl Default for RobotsShown {
    fn default() -> Self {
        Self {
            states: Vec::new(),
            robots: Robots::new(VACUUM),
            mowers: Robots::new(MOWER),
            vacuum_floors: None,
            mower_floors: None,
            docks: Vec::new(),
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// What the robot vacuums and mowers do: JSON `[{"id": "<robot-vacuum or robot-mower
    /// piece>", "state": "docked" | "cleaning" | "mowing" | "returning" | "paused" | "idle" |
    /// "error", "rooms": ["<room>"]}]`, `rooms` the rooms a vacuum cleans in that order (absent:
    /// every room its dock leads to); a mower mows the lawns of its storey. A piece not named
    /// stays on its dock.
    #[wasm_bindgen(js_name = setRobots)]
    pub fn set_robots(&mut self, json: &str) {
        self.robots.states = read_robots(json);
        self.place_robots(false);
    }
}

/// Where a robot rests on its dock `f` (plan cm), at the front of it, and which way it faces
/// there (the piece's front is its +y).
fn dock_of(f: &Furniture, body: Body) -> (P2, f64) {
    let (s, c) = f.angle.to_radians().sin_cos();
    let front = [-s, c];
    let reach = (f.h / 2.0 - body.radius - 1.5).max(0.0);
    let centre = f.center();
    let dock = [centre[0] + front[0] * reach, centre[1] + front[1] * reach];
    (dock, front[1].atan2(front[0]))
}

/// The lawns of a storey's plan (D-077): its places outside whose ground is a lawn, the nearest
/// to `from` first.
fn lawns_of(plan: &Plan, from: P2) -> Vec<String> {
    let mut lawns: Vec<(f64, String)> = plan
        .rooms()
        .filter(|r| r.outside && r.floor == plan::Floor::Lawn)
        .map(|r| {
            let [x, y] = label_point(&r.points());
            ((x - from[0]).hypot(y - from[1]), r.id.clone())
        })
        .collect();
    lawns.sort_by(|a, b| a.0.total_cmp(&b.0));
    lawns.into_iter().map(|(_, id)| id).collect()
}

#[wasm_bindgen]
impl Engine {
    /// The lawns each robot mower mows (D-077): JSON `{"<robot-mower piece>": ["<room>"]}`, the
    /// lawns of its storey it can get to from its dock, as its robot goes.
    #[wasm_bindgen(js_name = mowerLawns)]
    pub fn mower_lawns(&mut self) -> String {
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            return "{}".into();
        };
        let mut docks = Vec::new();
        for (storey, p) in scene.storey_plans(plan).into_iter().enumerate() {
            for e in &p.elements {
                if let Element::Furniture(f) = e
                    && f.kind == Kind::RobotMower
                {
                    let dock = dock_of(f, MOWER).0;
                    docks.push((f.id.clone(), storey, dock, lawns_of(p, dock)));
                }
            }
        }
        if docks.is_empty() {
            return "{}".into();
        }
        self.walk_floors();
        // The robots' own floors, worked out once for these docks.
        self.dock_floors(true, docks.iter().map(|(_, s, p, _)| (*s, *p)).collect());
        let floors = floors_of(self.robots.mower_floors.as_ref());
        let mowed: serde_json::Map<String, Value> = docks
            .into_iter()
            .map(|(id, storey, dock, lawns)| {
                let reach = floors
                    .get(storey)
                    .and_then(Option::as_ref)
                    .map(|f| f.reachable_ids(dock))
                    .unwrap_or_default();
                let lawns: Vec<Value> = lawns
                    .into_iter()
                    .filter(|room| reach.contains(room))
                    .map(Value::from)
                    .collect();
                (id, Value::Array(lawns))
            })
            .collect();
        Value::Object(mowed).to_string()
    }
}

/// Whether one of `wanted` leaves its dock, or is away from it (`robots` where they are).
fn away(wanted: &[Wanted], robots: &Robots) -> bool {
    wanted.iter().any(|w| match w.task {
        Task::Dock => false,
        // Stopped on its dock (idle there, often): nowhere to go.
        Task::Stay => robots.robots().iter().any(|r| r.id == w.id && !r.home()),
        Task::Clean(_) | Task::Return => true,
    })
}

impl Engine {
    /// Places a robot on the floor for each robot-vacuum and robot-mower piece of the plans
    /// shown, doing what its vacuum or lawn mower does; a piece in a room drawn closed (left out
    /// of the scene) has none. `fresh`: the plans shown changed. The floors are worked out only
    /// for a robot away from its dock or leaving it.
    pub(crate) fn place_robots(&mut self, fresh: bool) {
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            if !self.robots.robots.robots().is_empty() || !self.robots.mowers.robots().is_empty() {
                self.robots.robots = Robots::new(VACUUM);
                self.robots.mowers = Robots::new(MOWER);
                self.robots.vacuum_floors = None;
                self.robots.mower_floors = None;
                self.show_figures();
            }
            return;
        };
        let mut vacuums = Vec::new();
        let mut mowers = Vec::new();
        let mut docks = Vec::new();
        for (storey, p) in scene.storey_plans(plan).into_iter().enumerate() {
            for e in &p.elements {
                let Element::Furniture(f) = e else {
                    continue;
                };
                let (body, wanted): (Body, &mut Vec<Wanted>) = match f.kind {
                    Kind::RobotVacuum => (VACUUM, &mut vacuums),
                    Kind::RobotMower => (MOWER, &mut mowers),
                    _ => continue,
                };
                // At the front of its dock, facing out.
                let (dock, dock_heading) = dock_of(f, body);
                // Its room as the scene reckons it, which leaves the piece out when it is closed.
                let room = self
                    .elements
                    .iter()
                    .find(|info| info.id == f.id)
                    .and_then(|info| self.room_of(info));
                if room.is_some_and(|room| scene.closed.contains(room)) {
                    continue;
                }
                let ground = room
                    .and_then(|id| p.rooms().find(|r| r.id == *id))
                    .map_or(0.0, plan::Room::level);
                let mut task = self
                    .robots
                    .states
                    .iter()
                    .find(|r| r.id == f.id)
                    .map_or(Task::Dock, |r| r.task.clone());
                if f.kind == Kind::RobotMower && task == Task::Clean(Vec::new()) {
                    // The lawns of its storey, the nearest first; none: it stays where it is.
                    let lawns = lawns_of(p, dock);
                    task = if lawns.is_empty() {
                        Task::Stay
                    } else {
                        Task::Clean(lawns)
                    };
                }
                wanted.push(Wanted {
                    id: f.id.clone(),
                    storey,
                    dock,
                    dock_heading,
                    task,
                });
                docks.push((f.id.clone(), f.color.to_linear(), ground));
            }
        }
        // A home without a dock works nothing out.
        if vacuums.is_empty()
            && mowers.is_empty()
            && self.robots.robots.robots().is_empty()
            && self.robots.mowers.robots().is_empty()
        {
            return;
        }
        let motion = self.renderer.motion();
        self.robots.docks = docks;
        let vacuums_away = away(&vacuums, &self.robots.robots);
        let mowers_away = away(&mowers, &self.robots.mowers);
        if vacuums_away || mowers_away {
            self.walk_floors();
        }
        if fresh {
            self.robots.vacuum_floors = None;
            self.robots.mower_floors = None;
        }
        let docks = |wanted: &[Wanted]| wanted.iter().map(|w| (w.storey, w.dock)).collect();
        if vacuums_away {
            self.dock_floors(false, docks(&vacuums));
        }
        if mowers_away {
            self.dock_floors(true, docks(&mowers));
        }
        let floors = floors_of(self.robots.vacuum_floors.as_ref().filter(|_| vacuums_away));
        self.robots.robots.set(&vacuums, floors, motion, fresh);
        let floors = floors_of(self.robots.mower_floors.as_ref().filter(|_| mowers_away));
        self.robots.mowers.set(&mowers, floors, motion, fresh);
        self.show_figures();
    }

    /// Works out where the vacuums (`mower` false) or the mowers go, when their docks changed:
    /// the floors of the plans shown (worked out), the places outside closed for a vacuum, the
    /// home's rooms for a mower, but those a dock is in.
    fn dock_floors(&mut self, mower: bool, docks: Vec<(usize, P2)>) {
        let known = if mower {
            &mut self.robots.mower_floors
        } else {
            &mut self.robots.vacuum_floors
        };
        if known.as_ref().is_some_and(|known| known.docks == docks) {
            return;
        }
        let floors = self.floors.as_deref().unwrap_or_default();
        *known = Some(DockFloors::new(floors, docks, mower));
    }

    /// Moves the robots on by `dt` ms (at most a tenth of a second a frame). Returns whether one
    /// still moves (never under *reduce motion*: they are drawn at rest). The figures are shown
    /// by the frame.
    pub(crate) fn step_robots(&mut self, dt: f64) -> bool {
        if !self.robots_moving() {
            return false;
        }
        let dt = dt.clamp(0.0, 100.0) / 1000.0;
        let floors = floors_of(self.robots.vacuum_floors.as_ref());
        let vacuums = self.robots.robots.moving() && self.robots.robots.step(dt, floors, true);
        let floors = floors_of(self.robots.mower_floors.as_ref());
        let mowers = self.robots.mowers.moving() && self.robots.mowers.step(dt, floors, true);
        vacuums || mowers
    }

    /// The robots as the stats show them: `[{"id", "at": [x, y], "cleaning"}]` (plan cm).
    pub(crate) fn robots_shown(&self) -> Value {
        self.robots
            .robots
            .robots()
            .iter()
            .chain(self.robots.mowers.robots())
            .map(|r| {
                serde_json::json!({
                    "id": r.id,
                    "at": [r.at[0].round(), r.at[1].round()],
                    "cleaning": r.cleaning(),
                })
            })
            .collect()
    }

    /// Whether a robot moves (never under *reduce motion*: it is drawn at rest).
    pub(crate) fn robots_moving(&self) -> bool {
        self.renderer.motion() && (self.robots.robots.moving() || self.robots.mowers.moving())
    }

    /// The robots as figures, on the ground where they are (a lawn is a little under the floors).
    pub(crate) fn robot_figures(&self) -> impl Iterator<Item = Figure> + '_ {
        let floors = floors_of(self.robots.vacuum_floors.as_ref());
        let mower_floors = floors_of(self.robots.mower_floors.as_ref());
        let vacuums = self
            .robots
            .robots
            .robots()
            .iter()
            .map(move |r| (r, FigureShape::Robot, floors));
        let mowers = self
            .robots
            .mowers
            .robots()
            .iter()
            .map(move |r| (r, FigureShape::Mower, mower_floors));
        #[allow(clippy::cast_possible_truncation)]
        vacuums.chain(mowers).map(|(r, shape, floors)| {
            let (color, dock_ground) = self
                .robots
                .docks
                .iter()
                .find(|(id, ..)| *id == r.id)
                .map_or(([0.8; 3], 0.0), |(_, color, ground)| (*color, *ground));
            // On its dock, on the dock's ground (its floors are worked out only once it leaves).
            let level = match floors.get(r.storey).and_then(Option::as_ref) {
                Some(floor) if !r.home() => floor.level_at(r.at),
                _ => dock_ground,
            };
            Figure {
                storey: r.storey,
                at: [r.at[0] as f32, level as f32, r.at[1] as f32],
                ground: level as f32,
                heading: r.heading as f32,
                color,
                opacity: 1.0,
                shape,
            }
        })
    }
}
