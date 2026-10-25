//! People in their rooms (`DECISIONS.md`, D-034): where each person's figure stands, and how it
//! walks from room to room.
//!
//! A person is wanted in a room of a storey. A figure new to the home fades in where it stands; one
//! that changes rooms walks there through the doors (the way [`Floor::path`] finds, the one a
//! walker takes); one that changes storeys fades out and in again upstairs; one no longer wanted
//! fades out. Held still (*reduce motion*), figures go at once. People in one room stand around
//! its middle, each keeping their place while others come and go.

use std::collections::{HashMap, VecDeque};
use std::f64::consts::TAU;

use crate::geometry::polygon::P2;
use crate::walk::Floor;

/// Walking speed (cm/s): a calm walk, so that a move across a flat takes a few seconds.
pub const SPEED: f64 = 130.0;
/// How long a figure takes to fade in or out (s).
pub const FADE: f64 = 0.45;
/// How far apart people in one room stand (cm).
const SPACING: f64 = 60.0;
/// People stand around a room's middle, where its name is drawn: this far from it at least (cm),
/// on rings this far apart, with this many places each.
const AWAY_FROM_NAME: f64 = 75.0;
const RING_STEP: f64 = 35.0;
const RINGS: usize = 8;
const AROUND: usize = 12;
/// How far from the furniture people stand (cm).
const MARGIN: f64 = 12.0;

/// A person wanted somewhere.
#[derive(Debug, Clone, PartialEq)]
pub struct Wanted {
    /// Their id (`person.…`).
    pub id: String,
    /// The storey (index of the storeys shown) and the room they are in.
    pub storey: usize,
    pub room: String,
    /// Their colour (linear RGB 0…1).
    pub color: [f32; 3],
    /// Drawn as a pin rather than a figure.
    pub pin: bool,
}

/// A figure: where it stands or walks, and how much it shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Walker {
    pub id: String,
    pub color: [f32; 3],
    pub pin: bool,
    pub storey: usize,
    /// Where it is on its storey's floor (plan cm).
    pub at: P2,
    /// Which way it faces (radians on the plan, from +x towards +y).
    pub heading: f64,
    /// How much it shows (0 gone … 1).
    pub opacity: f64,
    /// How far it has walked (cm), for its gait.
    pub stride: f64,
    room: String,
    slot: usize,
    path: VecDeque<P2>,
    /// Fading out: then gone, or to appear in another room of another storey.
    leaving: bool,
    next: Option<(usize, String)>,
}

impl Walker {
    /// Whether it is walking now.
    pub fn walking(&self) -> bool {
        !self.path.is_empty() && !self.leaving
    }

    /// The room it stands in or walks to.
    pub fn room(&self) -> &str {
        &self.room
    }
}

/// Every figure.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct People {
    walkers: Vec<Walker>,
}

/// The places people stand in a room, best first, `count` of them at most: around its middle (not
/// on its name), clear of its walls and its furniture, apart from each other; in a room too small
/// for that, closer to the furniture, then its middle.
fn places(floor: &Floor, room: &str, count: usize) -> Vec<P2> {
    let Some(middle) = floor.room_spot(room) else {
        return Vec::new();
    };
    let mut chosen: Vec<P2> = Vec::new();
    for (margin, spacing) in [(MARGIN, SPACING), (0.0, SPACING / 2.0)] {
        for ring in 0..RINGS {
            #[allow(clippy::cast_precision_loss)]
            let radius = AWAY_FROM_NAME + RING_STEP * ring as f64;
            for k in 0..AROUND {
                #[allow(clippy::cast_precision_loss)]
                let angle = (k as f64 + 0.5 * (ring % 2) as f64) * TAU / AROUND as f64;
                let p = [
                    middle[0] + radius * angle.cos(),
                    middle[1] + radius * angle.sin(),
                ];
                let apart = chosen
                    .iter()
                    .all(|q| (p[0] - q[0]).hypot(p[1] - q[1]) >= spacing);
                if apart && floor.standing_room(room, p, margin) {
                    chosen.push(p);
                    if chosen.len() >= count {
                        return chosen;
                    }
                }
            }
        }
    }
    while chosen.len() < count {
        chosen.push(middle);
    }
    chosen
}

/// The places of the rooms, worked out once for each room a change looks at.
struct Places<'a> {
    floors: &'a [Option<Floor>],
    known: HashMap<(usize, String), Vec<P2>>,
}

impl<'a> Places<'a> {
    fn new(floors: &'a [Option<Floor>]) -> Self {
        Self {
            floors,
            known: HashMap::new(),
        }
    }

    /// The place `slot` in room `room` of storey `storey`.
    fn get(&mut self, storey: usize, room: &str, slot: usize) -> Option<P2> {
        let floor = self.floors.get(storey).and_then(Option::as_ref)?;
        let list = self.known.entry((storey, room.to_owned())).or_default();
        if list.len() <= slot {
            *list = places(floor, room, (slot + 1).max(RING_PLACES));
        }
        list.get(slot).copied()
    }
}

/// Places worked out at once for a room (more when more people are in it).
const RING_PLACES: usize = 6;

impl People {
    /// The figures.
    pub fn walkers(&self) -> &[Walker] {
        &self.walkers
    }

    /// Whether a figure walks or fades: frames are needed.
    pub fn moving(&self) -> bool {
        self.walkers
            .iter()
            .any(|w| w.leaving || w.opacity < 1.0 || !w.path.is_empty())
    }

    /// The lowest place free in a room (taken by those staying or walking there).
    fn free_slot(&self, storey: usize, room: &str, id: &str) -> usize {
        (0..)
            .find(|slot| {
                !self.walkers.iter().any(|w| {
                    w.id != id
                        && !w.leaving
                        && w.storey == storey
                        && w.room == room
                        && w.slot == *slot
                })
            })
            .unwrap_or(0)
    }

    /// Forgets the figures whose room their floor no longer has (the plans shown changed:
    /// another storey, a room gone); the others stay where they are, walking or not.
    pub fn retain_on(&mut self, floors: &[Option<Floor>]) {
        self.walkers.retain(|w| {
            floors
                .get(w.storey)
                .and_then(Option::as_ref)
                .is_some_and(|f| f.room_spot(&w.room).is_some())
        });
    }

    /// Who is wanted where. `floors` are the storeys' floors (by index); `motion` false places
    /// everyone at once. People wanted in a room no floor has are not drawn.
    pub fn set(&mut self, wanted: &[Wanted], floors: &[Option<Floor>], motion: bool) {
        let floor_of = |storey: usize| floors.get(storey).and_then(Option::as_ref);
        let wanted: Vec<&Wanted> = wanted
            .iter()
            .filter(|p| floor_of(p.storey).is_some_and(|f| f.room_spot(&p.room).is_some()))
            .collect();
        for w in &mut self.walkers {
            if !wanted.iter().any(|p| p.id == w.id) {
                w.leaving = true;
                w.next = None;
            }
        }
        let mut places = Places::new(floors);
        for person in wanted {
            let Some(floor) = floor_of(person.storey) else {
                continue;
            };
            let slot = self.free_slot(person.storey, &person.room, &person.id);
            match self.walkers.iter().position(|w| w.id == person.id) {
                None => {
                    let Some(at) = places.get(person.storey, &person.room, slot) else {
                        continue;
                    };
                    self.walkers.push(Walker {
                        id: person.id.clone(),
                        color: person.color,
                        pin: person.pin,
                        storey: person.storey,
                        at,
                        heading: TAU / 4.0,
                        opacity: if motion { 0.0 } else { 1.0 },
                        stride: 0.0,
                        room: person.room.clone(),
                        slot,
                        path: VecDeque::new(),
                        leaving: false,
                        next: None,
                    });
                }
                Some(k) => {
                    let w = &mut self.walkers[k];
                    w.color = person.color;
                    w.pin = person.pin;
                    let same = w.storey == person.storey && w.room == person.room;
                    if same && !w.leaving {
                        continue;
                    }
                    if w.storey == person.storey && (!w.leaving || w.next.is_none()) {
                        // Another room of the same storey: walk there through the doors.
                        let Some(to) = places.get(person.storey, &person.room, slot) else {
                            continue;
                        };
                        w.path = floor.path(w.at, to).into();
                        w.room.clone_from(&person.room);
                        w.slot = slot;
                        w.leaving = false;
                        w.next = None;
                    } else {
                        // Another storey: out here, in there.
                        w.leaving = true;
                        w.path.clear();
                        w.next = Some((person.storey, person.room.clone()));
                    }
                }
            }
        }
        if !motion {
            self.step(0.0, floors, false);
        }
    }

    /// Moves the figures on by `dt` seconds. Returns whether one still walks or fades.
    pub fn step(&mut self, dt: f64, floors: &[Option<Floor>], motion: bool) -> bool {
        let fade = if motion { dt / FADE } else { 1.0 };
        let mut arrivals = Vec::new();
        for (k, w) in self.walkers.iter_mut().enumerate() {
            if w.leaving {
                w.opacity = (w.opacity - fade).max(0.0);
                if w.opacity <= 0.0 {
                    arrivals.push(k);
                }
                continue;
            }
            w.opacity = (w.opacity + fade).clamp(0.0, 1.0);
            let mut budget = if motion { SPEED * dt } else { f64::INFINITY };
            while let Some(&next) = w.path.front() {
                let (dx, dy) = (next[0] - w.at[0], next[1] - w.at[1]);
                let left = dx.hypot(dy);
                if left > 1e-6 {
                    w.heading = dy.atan2(dx);
                }
                if left <= budget {
                    budget -= left;
                    w.stride += left.min(1e4);
                    w.at = next;
                    w.path.pop_front();
                } else {
                    w.at = [w.at[0] + dx / left * budget, w.at[1] + dy / left * budget];
                    w.stride += budget;
                    break;
                }
            }
        }
        // Gone, or to another storey: placed there now, to fade in.
        let mut places = Places::new(floors);
        for k in arrivals.into_iter().rev() {
            let Some((storey, room)) = self.walkers[k].next.take() else {
                self.walkers.remove(k);
                continue;
            };
            let id = self.walkers[k].id.clone();
            let slot = self.free_slot(storey, &room, &id);
            let Some(at) = places.get(storey, &room, slot) else {
                self.walkers.remove(k);
                continue;
            };
            let w = &mut self.walkers[k];
            w.storey = storey;
            w.room = room;
            w.slot = slot;
            w.at = at;
            w.leaving = false;
            w.opacity = if motion { 0.0 } else { 1.0 };
        }
        self.moving()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::walls::WallLayout;
    use crate::plan::read_plan;

    /// Three rooms in a row, 300 × 300: a door from A to B, one from B to C.
    fn floor() -> Floor {
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]]},
                {"id":"b","name":"B","outline":[[300,0],[600,0],[600,300],[300,300]]},
                {"id":"c","name":"C","outline":[[600,0],[900,0],[900,300],[600,300]]}
            ],"doors":[
                {"id":"d1","name":"D1","from":[300,100],"to":[300,190]},
                {"id":"d2","name":"D2","from":[600,100],"to":[600,190]}
            ]}"#,
        )
        .unwrap();
        Floor::new(&plan, &WallLayout::new(&plan))
    }

    fn wanted(id: &str, storey: usize, room: &str) -> Wanted {
        Wanted {
            id: id.into(),
            storey,
            room: room.into(),
            color: [1.0, 0.0, 0.5],
            pin: false,
        }
    }

    fn run(people: &mut People, floors: &[Option<Floor>], seconds: f64) {
        let mut t = 0.0;
        while t < seconds {
            people.step(0.05, floors, true);
            t += 0.05;
        }
    }

    #[test]
    fn a_figure_fades_in_then_walks_through_the_doors() {
        let floors = [Some(floor())];
        let mut people = People::default();
        people.set(&[wanted("person.alex", 0, "a")], &floors, true);
        assert_eq!(people.walkers()[0].opacity, 0.0);
        assert!(people.moving());
        run(&mut people, &floors, 1.0);
        let alex = &people.walkers()[0];
        assert_eq!(alex.opacity, 1.0);
        let start = alex.at;
        assert!(!people.moving());

        // To C: through both doors, never through a wall.
        people.set(&[wanted("person.alex", 0, "c")], &floors, true);
        let mut crossed = Vec::new();
        for _ in 0..400 {
            people.step(0.05, &floors, true);
            crossed.push(people.walkers()[0].at);
        }
        let alex = &people.walkers()[0];
        assert!(!alex.walking());
        assert_eq!(alex.room(), "c");
        assert!(alex.at[0] > 600.0 && alex.at[0] < 900.0);
        for p in &crossed {
            // Crossing x = 300 or 600 only where the doors are.
            for wall in [300.0, 600.0] {
                if (p[0] - wall).abs() < 5.0 {
                    assert!(p[1] > 100.0 && p[1] < 190.0, "{p:?}");
                }
            }
        }
        let walked = (alex.at[0] - start[0]).hypot(alex.at[1] - start[1]);
        assert!(alex.stride >= walked);
    }

    #[test]
    fn people_stand_clear_of_the_furniture_and_of_the_room_name() {
        // A room 4 m square with a table in its middle and a rug (people stand on rugs).
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[400,0],[400,400],[0,400]]}
            ],"items":[
                {"id":"t","name":"Table","kind":"dining-table","at":[200,200],"size":[120,120,75]},
                {"id":"r","name":"Rug","at":[200,200],"size":[320,320,1]}
            ]}"#,
        )
        .unwrap();
        let floor = Floor::new(&plan, &WallLayout::new(&plan));
        let middle = floor.room_spot("a").unwrap();
        let spots = places(&floor, "a", 4);
        assert_eq!(spots.len(), 4);
        for (k, p) in spots.iter().enumerate() {
            let inside = (128.0..=272.0).contains(&p[0]) && (128.0..=272.0).contains(&p[1]);
            assert!(!inside, "{p:?} is at the table");
            assert!((p[0] - middle[0]).hypot(p[1] - middle[1]) >= AWAY_FROM_NAME - 1e-6);
            for q in &spots[..k] {
                assert!((p[0] - q[0]).hypot(p[1] - q[1]) >= SPACING - 1e-6);
            }
        }
    }

    #[test]
    fn people_in_one_room_keep_their_places() {
        let floors = [Some(floor())];
        let mut people = People::default();
        people.set(
            &[wanted("person.alex", 0, "b"), wanted("person.sam", 0, "b")],
            &floors,
            false,
        );
        let [alex, sam] = [&people.walkers()[0], &people.walkers()[1]];
        assert!((alex.at[0] - sam.at[0]).hypot(alex.at[1] - sam.at[1]) >= SPACING - 1.0);
        let alex_at = alex.at;
        // Kim comes in; Sam leaves: Alex stays where they stand.
        people.set(
            &[wanted("person.alex", 0, "b"), wanted("person.kim", 0, "b")],
            &floors,
            false,
        );
        let alex = people
            .walkers()
            .iter()
            .find(|w| w.id == "person.alex")
            .unwrap();
        assert_eq!(alex.at, alex_at);
        assert!(people.walkers().iter().all(|w| w.id != "person.sam"));
        assert_eq!(people.walkers().len(), 2);
    }

    #[test]
    fn storeys_are_changed_by_fading_and_motion_held_still_goes_at_once() {
        let floors = [Some(floor()), Some(floor())];
        let mut people = People::default();
        people.set(&[wanted("person.alex", 0, "a")], &floors, true);
        run(&mut people, &floors, 1.0);
        people.set(&[wanted("person.alex", 1, "c")], &floors, true);
        run(&mut people, &floors, 0.2);
        let alex = &people.walkers()[0];
        assert_eq!(alex.storey, 0);
        assert!(alex.opacity < 1.0);
        run(&mut people, &floors, 2.0);
        let alex = &people.walkers()[0];
        assert_eq!((alex.storey, alex.room(), alex.opacity), (1, "c", 1.0));

        // Held still: there at once, gone at once.
        people.set(&[wanted("person.alex", 1, "a")], &floors, false);
        let alex = &people.walkers()[0];
        assert!(!alex.walking());
        assert!(alex.at[0] < 300.0);
        people.set(&[], &floors, false);
        assert!(people.walkers().is_empty());
        // A room no floor has: nobody (someone standing elsewhere goes).
        people.set(&[wanted("person.alex", 0, "a")], &floors, false);
        assert_eq!(people.walkers().len(), 1);
        people.set(
            &[wanted("person.alex", 0, "z"), wanted("person.sam", 5, "a")],
            &floors,
            false,
        );
        assert!(people.walkers().is_empty());
        // The plans change: a figure whose room is gone from its floor is forgotten.
        people.set(&[wanted("person.alex", 1, "b")], &floors, false);
        people.retain_on(&[Some(floor()), None]);
        assert!(people.walkers().is_empty());
        people.set(&[wanted("person.alex", 0, "b")], &floors, false);
        people.retain_on(&floors);
        assert_eq!(people.walkers().len(), 1);
        // On its way to another room, it stays too.
        people.set(&[wanted("person.alex", 0, "c")], &floors, true);
        people.step(0.5, &floors, true);
        assert!(people.walkers()[0].walking());
        people.retain_on(&floors);
        assert!(people.walkers()[0].walking());
    }
}
