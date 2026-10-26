//! Robot vacuums on the floor (`DECISIONS.md`, D-049): a robot leaves its dock to clean, room
//! by room, back and forth along lanes; goes back to its dock; and waits where it stopped when
//! paused or stuck.
//!
//! What a robot does comes from its vacuum's state. Where it is, Home Assistant does not say
//! (most robots keep their map to themselves), so its way is drawn from the plan: the rooms of
//! its storey that its dock's room leads to, the nearest next, each swept in lanes, and the doors
//! between them. Docked, it is on its dock. Under *reduce motion* it is drawn at rest: on its
//! dock, or in the room it cleans.

use std::collections::VecDeque;
use std::f64::consts::{PI, TAU};

use crate::geometry::polygon::P2;
use crate::walk::Floor;

/// How fast a robot goes (cm/s): a real one's pace.
pub const SPEED: f64 = 30.0;
/// How fast it turns on the spot (radians per second).
pub const TURN: f64 = 3.0;
/// How far apart its lanes are (cm): a little under its width, so that they overlap.
pub const LANE: f64 = 30.0;
/// Its radius (cm).
pub const RADIUS: f64 = 17.5;
/// How far from the walls its lanes end (cm).
const MARGIN: f64 = RADIUS + 2.0;
/// Rooms smaller than this are not cleaned (cm²): a closet, a duct.
const SMALLEST: f64 = 15_000.0;

/// What a robot is asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Task {
    /// Be on its dock (docked, charging).
    Dock,
    /// Clean these rooms in this order, then again until told otherwise; every room it can get
    /// to when the list is empty.
    Clean(Vec<String>),
    /// Go back to its dock.
    Return,
    /// Stop where it is (paused, idle, stuck).
    Stay,
}

impl Task {
    /// What a robot does in its vacuum's state (Home Assistant's `vacuum` states), `rooms` the
    /// rooms it was sent to clean (none: every room).
    pub fn of_vacuum(state: &str, rooms: Vec<String>) -> Task {
        match state {
            "cleaning" => Task::Clean(rooms),
            "returning" => Task::Return,
            "paused" | "idle" | "error" => Task::Stay,
            // Docked, and what is unknown or unavailable: on its dock.
            _ => Task::Dock,
        }
    }
}

/// A robot wanted on a storey.
#[derive(Debug, Clone, PartialEq)]
pub struct Wanted {
    /// Its id (its dock's piece).
    pub id: String,
    /// The storey (index of the storeys shown) its dock is on.
    pub storey: usize,
    /// Where it rests on its dock (plan cm), and which way it faces there (radians on the plan,
    /// from +x towards +y).
    pub dock: P2,
    pub dock_heading: f64,
    pub task: Task,
}

/// A robot: where it is and where it goes.
#[derive(Debug, Clone, PartialEq)]
pub struct Robot {
    pub id: String,
    pub storey: usize,
    /// Where it is on its storey's floor (plan cm).
    pub at: P2,
    /// Which way it faces (radians on the plan, from +x towards +y).
    pub heading: f64,
    task: Task,
    dock: P2,
    dock_heading: f64,
    /// The points it goes through next.
    route: VecDeque<P2>,
    /// The rooms it cleans next, and the one it cleans now.
    rooms: VecDeque<String>,
    room: Option<String>,
}

impl Robot {
    /// Whether it is on its way somewhere now, or turning on its dock to face out.
    pub fn moving(&self) -> bool {
        !self.route.is_empty() || self.turning_home()
    }

    /// Whether it is home from a round but not yet facing out.
    fn turning_home(&self) -> bool {
        self.task == Task::Return
            && self.at == self.dock
            && turn_between(self.heading, self.dock_heading).abs() > 1e-9
    }

    /// The room it is cleaning, when it is.
    pub fn cleaning(&self) -> Option<&str> {
        match self.task {
            Task::Clean(_) => self.room.as_deref(),
            _ => None,
        }
    }

    /// Whether it is on its dock.
    pub fn home(&self) -> bool {
        self.at == self.dock
    }
}

/// Every robot.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Robots {
    robots: Vec<Robot>,
}

/// The rooms a robot on `floor` cleans from `from`, in order: those asked for (the ones it can get
/// to), or every room it can get to, big enough to be cleaned; its own first, then the nearest
/// next.
fn rooms_to_clean(floor: &Floor, from: P2, asked: &[String]) -> VecDeque<String> {
    let mut left: Vec<(String, P2)> = floor
        .reachable(from)
        .into_iter()
        .filter(|(id, _, size)| {
            if asked.is_empty() {
                *size >= SMALLEST
            } else {
                asked.contains(id)
            }
        })
        .map(|(id, spot, _)| (id, spot))
        .collect();
    if !asked.is_empty() {
        // In the order asked.
        left.sort_by_key(|(id, _)| asked.iter().position(|a| a == id));
        return left.into_iter().map(|(id, _)| id).collect();
    }
    let mut ordered = VecDeque::new();
    let mut here = from;
    while !left.is_empty() {
        let distance = |p: P2| (p[0] - here[0]).hypot(p[1] - here[1]);
        // Its own room first (the one it is in), then the nearest.
        let k = left
            .iter()
            .position(|(id, _)| floor.in_room(id, here))
            .unwrap_or_else(|| {
                (0..left.len())
                    .min_by(|a, b| distance(left[*a].1).total_cmp(&distance(left[*b].1)))
                    .unwrap_or(0)
            });
        let (id, spot) = left.remove(k);
        here = spot;
        ordered.push_back(id);
    }
    ordered
}

/// The way from `from` to `to` on `floor`, through the doors; none when no door leads there.
fn way(floor: &Floor, from: P2, to: P2) -> Option<VecDeque<P2>> {
    let path = floor.path(from, to);
    let room = floor.room_at(from);
    (path.len() > 1 || room.is_some() && room == floor.room_at(to)).then(|| path.into())
}

/// The way a robot that came to `from` takes through a room's `lanes`: straight from one point to
/// the next where its body clears the walls; else back along the points it went through, cutting
/// corners where it clears them, until the next is clear ahead (from one arm of a room shaped
/// like a U to the other). A point it cannot get to that way is left out.
fn through_lanes(floor: &Floor, from: P2, lanes: &[P2]) -> Vec<P2> {
    let clear = |a: P2, b: P2| floor.clear(a, b, RADIUS);
    let mut gone = vec![from];
    for &p in lanes {
        let here = gone.len() - 1;
        if clear(gone[here], p) {
            gone.push(p);
            continue;
        }
        // The last point gone through with a clear way to `p`, and the way back to it.
        let Some(back_to) = (0..here).rev().find(|&m| clear(gone[m], p)) else {
            continue;
        };
        let mut k = here;
        while k > back_to {
            // The farthest back with a clear way.
            k = (back_to..k)
                .find(|&j| clear(gone[k], gone[j]))
                .unwrap_or(k - 1);
            gone.push(gone[k]);
        }
        gone.push(p);
    }
    gone.remove(0);
    gone
}

/// The difference from heading `a` to heading `b`, in −π … π.
fn turn_between(a: f64, b: f64) -> f64 {
    (b - a + PI).rem_euclid(TAU) - PI
}

impl Robots {
    /// The robots.
    pub fn robots(&self) -> &[Robot] {
        &self.robots
    }

    /// Whether a robot moves (frames are needed): on its way, or cleaning a room it can get to.
    pub fn moving(&self) -> bool {
        self.robots.iter().any(|r| {
            r.moving()
                || matches!(r.task, Task::Clean(_)) && (r.room.is_some() || !r.rooms.is_empty())
        })
    }

    /// The robots wanted, and what each does. `floors` are the storeys' floors (by index), needed
    /// only for a robot that leaves its dock (one without its floor stays on its dock); `fresh`
    /// says they are new (a room closed, walls moved, another storey shown): a robot on its way
    /// finds its way again, from its dock when it is no longer in an open room. `motion` false
    /// draws them at rest. A robot no longer wanted is gone; a new one starts on its dock.
    pub fn set(&mut self, wanted: &[Wanted], floors: &[Option<Floor>], motion: bool, fresh: bool) {
        self.robots.retain(|r| wanted.iter().any(|w| w.id == r.id));
        for w in wanted {
            let k = match self.robots.iter().position(|r| r.id == w.id) {
                Some(k) => k,
                None => {
                    self.robots.push(Robot {
                        id: w.id.clone(),
                        storey: w.storey,
                        at: w.dock,
                        heading: w.dock_heading,
                        task: Task::Dock,
                        dock: w.dock,
                        dock_heading: w.dock_heading,
                        route: VecDeque::new(),
                        rooms: VecDeque::new(),
                        room: None,
                    });
                    self.robots.len() - 1
                }
            };
            let r = &mut self.robots[k];
            // The storey's index changes with what is shown (one storey, the whole home), its
            // floor the same: only a dock moved takes its robot with it.
            let moved = r.dock != w.dock;
            r.storey = w.storey;
            r.dock = w.dock;
            r.dock_heading = w.dock_heading;
            let floor = floors.get(w.storey).and_then(Option::as_ref);
            let shut_out = fresh && floor.is_some_and(|f| !f.open_at(r.at));
            if moved || shut_out {
                r.at = w.dock;
                r.heading = w.dock_heading;
            }
            if r.task == w.task && !moved && !fresh {
                continue;
            }
            // The same task on new floors carries on.
            let carry_on = r.task == w.task && !moved && !shut_out;
            r.task = w.task.clone();
            let Some(floor) = floor.filter(|_| w.task != Task::Dock) else {
                // Docked (or nowhere to go): on its dock.
                r.route.clear();
                r.rooms.clear();
                r.room = None;
                r.at = w.dock;
                r.heading = w.dock_heading;
                continue;
            };
            let reach = if carry_on {
                floor.reachable_ids(r.at)
            } else {
                Vec::new()
            };
            if carry_on {
                // On its way still when no wall stands in it now, with the rooms it can still
                // get to.
                r.rooms.retain(|id| reach.contains(id));
                let points: Vec<P2> = std::iter::once(r.at)
                    .chain(r.route.iter().copied())
                    .collect();
                if r.room.as_ref().is_none_or(|room| reach.contains(room))
                    && points.windows(2).all(|p| floor.seen(p[0], p[1]))
                {
                    continue;
                }
            }
            r.route.clear();
            match &w.task {
                Task::Return => {
                    r.rooms.clear();
                    r.room = None;
                    let home = (r.at[0] - w.dock[0]).hypot(r.at[1] - w.dock[1]) < 0.5;
                    match way(floor, r.at, w.dock).filter(|_| !home) {
                        Some(route) => r.route = route,
                        // Home already, or no door leads there: on its dock.
                        None => {
                            r.at = w.dock;
                            r.heading = w.dock_heading;
                        }
                    }
                }
                Task::Clean(asked) => {
                    if carry_on {
                        // The room it was cleaning again, then the others left.
                        if let Some(room) = r.room.take().filter(|room| reach.contains(room)) {
                            r.rooms.push_front(room);
                        }
                    } else {
                        r.room = None;
                        r.rooms = rooms_to_clean(floor, r.at, asked);
                    }
                }
                Task::Dock | Task::Stay => {}
            }
        }
        if !motion {
            self.step(0.0, floors, false);
        }
    }

    /// Moves the robots on by `dt` seconds. Returns whether one still moves.
    pub fn step(&mut self, dt: f64, floors: &[Option<Floor>], motion: bool) -> bool {
        for r in &mut self.robots {
            let Some(floor) = floors.get(r.storey).and_then(Option::as_ref) else {
                continue;
            };
            if !motion {
                // At rest: on its dock, or where it stops, or in the room it cleans.
                match &r.task {
                    Task::Dock | Task::Return => {
                        r.at = r.dock;
                        r.heading = r.dock_heading;
                    }
                    Task::Clean(_) => {
                        // In the room it cleans, which it starts again when it moves on.
                        if let Some(room) = r.room.take() {
                            r.rooms.push_front(room);
                        }
                        if let Some(spot) = r.rooms.front().and_then(|id| floor.room_spot(id)) {
                            r.at = spot;
                        }
                    }
                    Task::Stay => {}
                }
                r.route.clear();
                continue;
            }
            let mut budget = dt;
            // A few rooms at most a frame: a room with no lane is passed over.
            let mut planned = 0;
            while budget > 0.0 {
                if r.route.is_empty() {
                    if let Task::Clean(asked) = &r.task {
                        if planned >= 3 {
                            break;
                        }
                        planned += 1;
                        if r.rooms.is_empty() {
                            // All clean: around again, the room just cleaned last.
                            r.rooms = rooms_to_clean(floor, r.at, asked);
                            if r.rooms.len() > 1 && r.rooms.front() == r.room.as_ref() {
                                r.rooms.rotate_left(1);
                            }
                        }
                        let Some(room) = r.rooms.pop_front() else {
                            r.room = None;
                            break;
                        };
                        let lanes = floor.sweep(&room, r.at, LANE, MARGIN);
                        let Some(&first) = lanes.first() else {
                            continue;
                        };
                        let Some(mut route) = way(floor, r.at, first) else {
                            continue;
                        };
                        route.extend(through_lanes(floor, first, &lanes[1..]));
                        r.route = route;
                        r.room = Some(room);
                    } else {
                        if r.turning_home() {
                            // Home: it turns on its dock to face out.
                            let turn = turn_between(r.heading, r.dock_heading);
                            r.heading = if turn.abs() <= TURN * budget {
                                r.dock_heading
                            } else {
                                r.heading + turn.signum() * TURN * budget
                            };
                        }
                        break;
                    }
                }
                let Some(&next) = r.route.front() else {
                    break;
                };
                let (dx, dy) = (next[0] - r.at[0], next[1] - r.at[1]);
                let left = dx.hypot(dy);
                if left > 0.5 {
                    // Turns on the spot first, then goes straight.
                    let turn = turn_between(r.heading, dy.atan2(dx));
                    let needed = turn.abs() / TURN;
                    if needed > budget {
                        r.heading += turn.signum() * TURN * budget;
                        break;
                    }
                    r.heading += turn;
                    budget -= needed;
                }
                let reach = SPEED * budget;
                if left <= reach {
                    budget -= left / SPEED;
                    r.at = next;
                    r.route.pop_front();
                } else {
                    r.at = [r.at[0] + dx / left * reach, r.at[1] + dy / left * reach];
                    budget = 0.0;
                }
            }
            r.heading = r.heading.rem_euclid(TAU);
        }
        self.moving()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::walls::WallLayout;
    use crate::plan::read_plan;

    /// Three rooms in a row, 400 × 300, doors from A to B and B to C; a closet D off C, too small
    /// to clean; E behind a wall.
    fn floors() -> Vec<Option<Floor>> {
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[400,0],[400,300],[0,300]]},
                {"id":"b","name":"B","outline":[[400,0],[800,0],[800,300],[400,300]]},
                {"id":"c","name":"C","outline":[[800,0],[1200,0],[1200,300],[800,300]]},
                {"id":"d","name":"D","outline":[[800,300],[900,300],[900,400],[800,400]]},
                {"id":"e","name":"E","outline":[[0,300],[400,300],[400,600],[0,600]]}
            ],"doors":[
                {"id":"ab","name":"AB","from":[400,100],"to":[400,190]},
                {"id":"bc","name":"BC","from":[800,100],"to":[800,190]},
                {"id":"cd","name":"CD","from":[820,300],"to":[880,300]}
            ]}"#,
        )
        .unwrap();
        vec![Some(Floor::new(&plan, &WallLayout::new(&plan)))]
    }

    fn wanted(task: Task) -> Wanted {
        Wanted {
            id: "robot".into(),
            storey: 0,
            dock: [60.0, 150.0],
            dock_heading: 0.0,
            task,
        }
    }

    /// Runs the robots for `seconds`, a frame at a time.
    fn run(robots: &mut Robots, floors: &[Option<Floor>], seconds: f64) {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        for _ in 0..(seconds * 20.0) as usize {
            robots.step(0.05, floors, true);
        }
    }

    #[test]
    fn a_robot_cleans_room_by_room_and_goes_home() {
        let floors = floors();
        let floor = floors[0].as_ref().unwrap();
        let mut robots = Robots::default();
        robots.set(&[wanted(Task::Dock)], &floors, true, false);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
        assert!(!robots.moving());
        // Sent home while home: nothing to do.
        robots.set(&[wanted(Task::Return)], &floors, true, false);
        assert!(!robots.moving());
        // The rooms it cleans: its own, then the next through the doors; not the closet, not E.
        assert_eq!(
            rooms_to_clean(floor, [60.0, 150.0], &[]),
            ["a", "b", "c"].map(String::from)
        );
        robots.set(&[wanted(Task::Clean(Vec::new()))], &floors, true, false);
        // Moving from the start, before its first frame.
        assert!(robots.moving());
        let mut rooms = Vec::new();
        let mut before = (None, 0);
        for _ in 0..4000 {
            robots.step(0.25, &floors, true);
            let r = &robots.robots()[0];
            // Never through a wall: always in a room it can get to.
            assert!(
                ["a", "b", "c"].iter().any(|id| floor.in_room(id, r.at)),
                "{:?}",
                r.at
            );
            if let Some(room) = r.cleaning()
                && rooms.last().is_none_or(|last: &String| last != room)
            {
                rooms.push(room.to_owned());
            }
            // Around again, it does not clean the room it just cleaned once more.
            let now = (r.room.clone(), r.rooms.len());
            assert!(
                !(now.0 == before.0 && before.1 == 0 && now.1 > 0),
                "{now:?}"
            );
            before = now;
        }
        assert_eq!(rooms[..4], ["a", "b", "c", "b"].map(String::from));
        assert!(robots.moving());
        // Back to its dock, turning on it to face out no faster than it turns.
        robots.set(&[wanted(Task::Return)], &floors, true, false);
        let mut heading = robots.robots()[0].heading;
        for _ in 0..2400 {
            robots.step(0.05, &floors, true);
            let r = &robots.robots()[0];
            assert!(turn_between(heading, r.heading).abs() <= TURN * 0.05 + 1e-9);
            heading = r.heading;
        }
        let r = &robots.robots()[0];
        assert_eq!(r.at, [60.0, 150.0]);
        assert!(turn_between(r.heading, 0.0).abs() < 1e-9 && !robots.moving());
    }

    #[test]
    fn a_robot_cleans_the_rooms_asked_and_stops_when_told() {
        let floors = floors();
        let mut robots = Robots::default();
        robots.set(
            &[wanted(Task::Clean(vec!["c".into(), "e".into()]))],
            &floors,
            true,
            false,
        );
        run(&mut robots, &floors, 30.0);
        // C, through A and B; never E, which it cannot get to.
        assert_eq!(robots.robots()[0].cleaning(), Some("c"));
        robots.set(&[wanted(Task::Stay)], &floors, true, false);
        let at = robots.robots()[0].at;
        run(&mut robots, &floors, 5.0);
        assert_eq!(robots.robots()[0].at, at);
        assert!(!robots.moving());
        // Docked: on its dock at once, as its vacuum says.
        robots.set(&[wanted(Task::Dock)], &floors, true, false);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
        assert!(!robots.moving());
        // Gone with its dock.
        robots.set(&[], &floors, true, false);
        assert!(robots.robots().is_empty());
    }

    #[test]
    fn new_floors_send_a_robot_on_its_way_again() {
        let floors = floors();
        let floor = floors[0].as_ref().unwrap();
        let mut robots = Robots::default();
        let clean = || wanted(Task::Clean(Vec::new()));
        robots.set(&[clean()], &floors, true, false);
        while !floor.in_room("b", robots.robots()[0].at) {
            robots.step(0.25, &floors, true);
        }
        run(&mut robots, &floors, 5.0);
        let (at, route) = (robots.robots()[0].at, robots.robots()[0].route.clone());
        assert_eq!(robots.robots()[0].cleaning(), Some("b"));
        // The same floor shown as the second storey (the whole home shown): it carries on, on
        // its way.
        let mut two = vec![None];
        two.push(floors[0].clone());
        robots.set(
            &[Wanted {
                storey: 1,
                ..clean()
            }],
            &two,
            true,
            true,
        );
        let r = &robots.robots()[0];
        assert_eq!((r.storey, r.at, &r.route), (1, at, &route));
        assert_eq!(r.cleaning(), Some("b"));
        // B closed as private: back on its dock, never in B again, A its only room.
        let mut closed = floors.clone();
        closed[0]
            .as_mut()
            .unwrap()
            .close(&std::collections::BTreeSet::from(["b".to_owned()]));
        robots.set(&[clean()], &closed, true, true);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
        for _ in 0..800 {
            robots.step(0.25, &closed, true);
            let r = &robots.robots()[0];
            assert!(floor.in_room("a", r.at), "{:?}", r.at);
            assert!(r.cleaning().is_none_or(|room| room == "a"));
        }
        // Paused in C, then B closed: no door leads home, so sent home it is put on its dock,
        // never through B.
        let mut robots = Robots::default();
        robots.set(
            &[wanted(Task::Clean(vec!["c".into()]))],
            &floors,
            true,
            false,
        );
        while !floor.in_room("c", robots.robots()[0].at) {
            robots.step(0.25, &floors, true);
        }
        robots.set(&[wanted(Task::Stay)], &floors, true, false);
        robots.set(&[wanted(Task::Stay)], &closed, true, true);
        assert!(floor.in_room("c", robots.robots()[0].at));
        robots.set(&[wanted(Task::Return)], &closed, true, false);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
        assert!(!robots.moving());
    }

    #[test]
    fn a_room_shaped_like_a_u_is_swept_arm_by_arm() {
        // A U: its bottom 700 × 200, its arms 200 wide and 300 long, a notch between them.
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"u","name":"U","outline":[[0,0],[700,0],[700,500],[500,500],[500,200],
                    [200,200],[200,500],[0,500]]}
            ]}"#,
        )
        .unwrap();
        let floor = Floor::new(&plan, &WallLayout::new(&plan));
        let lanes = floor.sweep("u", [60.0, 60.0], LANE, MARGIN);
        // Every lane of both arms is there.
        for x in [100.0, 600.0] {
            let arm = lanes
                .iter()
                .filter(|p| (p[0] - x).abs() < 100.0 && p[1] > 230.0)
                .count();
            assert!(arm >= 16, "{x}: {arm}");
        }
        let route = through_lanes(&floor, lanes[0], &lanes[1..]);
        // All of them, in order, each in sight of the one before: never across the notch.
        let mut next = lanes[1..].iter().peekable();
        let mut last = lanes[0];
        for p in &route {
            // Its whole body clear of the walls, corners cut or not.
            assert!(floor.clear(last, *p, RADIUS), "{last:?} {p:?}");
            assert!(floor.in_room("u", *p), "{p:?}");
            if next.peek() == Some(&p) {
                next.next();
            }
            last = *p;
        }
        assert!(next.peek().is_none());
        // And not far out of its way: less than one more way back between the arms.
        let length: f64 = std::iter::once(lanes[0])
            .chain(route.iter().copied())
            .collect::<Vec<_>>()
            .windows(2)
            .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
            .sum();
        let lanes_length: f64 = lanes
            .windows(2)
            .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
            .sum();
        assert!(length < lanes_length + 1000.0, "{length} {lanes_length}");
        // A wall jutting in: round it, clear of it.
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"r","name":"R","outline":[[0,0],[400,0],[400,300],[220,300],[220,265],
                    [180,265],[180,300],[0,300]]}
            ]}"#,
        )
        .unwrap();
        let floor = Floor::new(&plan, &WallLayout::new(&plan));
        let lanes = floor.sweep("r", [10.0, 10.0], LANE, MARGIN);
        let route = through_lanes(&floor, lanes[0], &lanes[1..]);
        assert!(route.len() >= lanes.len() - 1);
        let mut last = lanes[0];
        for p in &route {
            assert!(floor.clear(last, *p, RADIUS), "{last:?} {p:?}");
            last = *p;
        }
    }

    #[test]
    fn at_rest_under_reduce_motion() {
        let floors = floors();
        let floor = floors[0].as_ref().unwrap();
        let mut robots = Robots::default();
        robots.set(&[wanted(Task::Clean(Vec::new()))], &floors, false, false);
        // In the room it cleans, not moving.
        let r = &robots.robots()[0];
        assert_eq!(Some(r.at), floor.room_spot("a"));
        assert!(!r.moving());
        // Moving again, it cleans that room from its start, and again when stopped midway.
        robots.set(&[wanted(Task::Clean(Vec::new()))], &floors, true, false);
        run(&mut robots, &floors, 10.0);
        assert_eq!(robots.robots()[0].cleaning(), Some("a"));
        robots.set(&[wanted(Task::Clean(Vec::new()))], &floors, false, false);
        robots.step(0.0, &floors, false);
        robots.step(0.25, &floors, true);
        assert_eq!(robots.robots()[0].cleaning(), Some("a"));
        robots.set(&[wanted(Task::Return)], &floors, false, false);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
        // A dock moved takes its robot with it, here to another storey.
        let mut two = floors.clone();
        two.push(floors[0].clone());
        robots.set(
            &[Wanted {
                storey: 1,
                dock: [700.0, 150.0],
                ..wanted(Task::Clean(Vec::new()))
            }],
            &two,
            true,
            true,
        );
        let r = &robots.robots()[0];
        assert_eq!((r.storey, r.at), (1, [700.0, 150.0]));
        // Docks only: no floor needed.
        robots.set(&[wanted(Task::Dock)], &[], true, false);
        assert_eq!(robots.robots()[0].at, [60.0, 150.0]);
    }

    #[test]
    fn a_vacuum_state_says_what_its_robot_does() {
        let rooms = vec!["kitchen".to_owned()];
        assert_eq!(
            Task::of_vacuum("cleaning", rooms.clone()),
            Task::Clean(rooms)
        );
        assert_eq!(Task::of_vacuum("returning", Vec::new()), Task::Return);
        for state in ["paused", "idle", "error"] {
            assert_eq!(Task::of_vacuum(state, Vec::new()), Task::Stay);
        }
        for state in ["docked", "unavailable", "unknown", ""] {
            assert_eq!(Task::of_vacuum(state, Vec::new()), Task::Dock);
        }
    }

    #[test]
    fn turns_take_the_short_way() {
        assert!((turn_between(0.1, TAU - 0.1) + 0.2).abs() < 1e-9);
        assert!((turn_between(PI - 0.1, -PI + 0.1) - 0.2).abs() < 1e-9);
    }
}
