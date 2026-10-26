//! Robot vacuums for JavaScript (`DECISIONS.md`, D-049): every robot-vacuum piece of the plans
//! shown has its robot, on its dock; what its vacuum does (cleaning, going home, paused) moves
//! it on the floor.

use domotwin_core::plan::{Element, Kind};
use domotwin_core::robots::{RADIUS, Robots, Task, Wanted};
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
                        task: Task::of_vacuum(state, rooms),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The robots the engine draws.
#[derive(Debug, Default)]
pub(crate) struct RobotsShown {
    states: Vec<RobotState>,
    robots: Robots,
    /// Each robot's colour (linear RGB), its dock's.
    colors: Vec<(String, [f32; 3])>,
}

#[wasm_bindgen]
impl Engine {
    /// What the robot vacuums do: JSON `[{"id": "<robot-vacuum piece>", "state": "docked" |
    /// "cleaning" | "returning" | "paused" | "idle" | "error", "rooms": ["<room>"]}]`, `rooms`
    /// the rooms it cleans in that order (absent: every room its dock leads to). A robot-vacuum
    /// piece not named stays on its dock.
    #[wasm_bindgen(js_name = setRobots)]
    pub fn set_robots(&mut self, json: &str) {
        self.robots.states = read_robots(json);
        self.place_robots(false);
    }
}

impl Engine {
    /// Places a robot on the floor for each robot-vacuum piece of the plans shown, doing what its
    /// vacuum does; a piece in a room drawn closed (left out of the scene) has none. `fresh`: the
    /// plans shown changed. The floors are worked out only for a robot away from its dock or
    /// leaving it.
    pub(crate) fn place_robots(&mut self, fresh: bool) {
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            if !self.robots.robots.robots().is_empty() {
                self.robots.robots = Robots::default();
                self.show_figures();
            }
            return;
        };
        let mut wanted = Vec::new();
        let mut colors = Vec::new();
        for (storey, p) in scene.storey_plans(plan).into_iter().enumerate() {
            for e in &p.elements {
                let Element::Furniture(f) = e else {
                    continue;
                };
                if f.kind != Kind::RobotVacuum {
                    continue;
                }
                // At the front of its dock, facing out (the piece's front is its +y).
                let (s, c) = f.angle.to_radians().sin_cos();
                let front = [-s, c];
                let reach = (f.h / 2.0 - RADIUS - 1.5).max(0.0);
                let centre = f.center();
                let dock = [centre[0] + front[0] * reach, centre[1] + front[1] * reach];
                // Its room as the scene reckons it, which leaves the piece out when it is closed.
                if self
                    .elements
                    .iter()
                    .find(|info| info.id == f.id)
                    .and_then(|info| self.room_of(info))
                    .is_some_and(|room| scene.closed.contains(room))
                {
                    continue;
                }
                let task = self
                    .robots
                    .states
                    .iter()
                    .find(|r| r.id == f.id)
                    .map_or(Task::Dock, |r| r.task.clone());
                wanted.push(Wanted {
                    id: f.id.clone(),
                    storey,
                    dock,
                    dock_heading: front[1].atan2(front[0]),
                    task,
                });
                colors.push((f.id.clone(), f.color.to_linear()));
            }
        }
        // A home without a dock works nothing out.
        if wanted.is_empty() && self.robots.robots.robots().is_empty() {
            return;
        }
        let robots = self.robots.robots.robots();
        let away = wanted.iter().any(|w| match w.task {
            Task::Dock => false,
            // Stopped on its dock (idle there, often): nowhere to go.
            Task::Stay => robots.iter().any(|r| r.id == w.id && !r.home()),
            Task::Clean(_) | Task::Return => true,
        });
        if away {
            self.walk_floors();
        }
        let floors = if away {
            self.floors.as_deref().unwrap_or_default()
        } else {
            &[]
        };
        self.robots.colors = colors;
        self.robots
            .robots
            .set(&wanted, floors, self.renderer.motion(), fresh);
        self.show_figures();
    }

    /// Moves the robots on by `dt` ms (at most a tenth of a second a frame). Returns whether one
    /// still moves (never under *reduce motion*: they are drawn at rest). The figures are shown
    /// by the frame.
    pub(crate) fn step_robots(&mut self, dt: f64) -> bool {
        if !self.robots_moving() {
            return false;
        }
        let dt = dt.clamp(0.0, 100.0);
        let floors = self.floors.as_deref().unwrap_or_default();
        self.robots.robots.step(dt / 1000.0, floors, true)
    }

    /// Whether a robot moves (never under *reduce motion*: it is drawn at rest).
    pub(crate) fn robots_moving(&self) -> bool {
        self.renderer.motion() && self.robots.robots.moving()
    }

    /// The robots as figures.
    pub(crate) fn robot_figures(&self) -> impl Iterator<Item = Figure> + '_ {
        #[allow(clippy::cast_possible_truncation)]
        self.robots.robots.robots().iter().map(|r| Figure {
            storey: r.storey,
            at: [r.at[0] as f32, 0.0, r.at[1] as f32],
            heading: r.heading as f32,
            color: self
                .robots
                .colors
                .iter()
                .find(|(id, _)| *id == r.id)
                .map_or([0.8; 3], |(_, c)| *c),
            opacity: 1.0,
            shape: FigureShape::Robot,
        })
    }
}
