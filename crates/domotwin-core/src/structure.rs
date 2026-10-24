//! The plan editor (`DECISIONS.md`, D-025): a draft of the plan's JSON in which rooms are drawn
//! and reshaped, partitions drawn, doors and windows placed on the rooms' sides, each change
//! checked by the plan reader before it is kept, with undo and redo. The engine turns screen
//! points into plan points and shows the draft.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

use crate::error::{ErrorCode, ReadError};
use crate::geometry::polygon::P2;
use crate::plan::{Element, Plan, read_plan_value};

/// Grid of the plan editor (cm).
pub const GRID: f64 = 5.0;
/// A point this close to a corner of another room goes onto it (cm).
const SNAP_CORNER: f64 = 12.0;
/// A point this close to the line of another corner lines up with it (cm).
const SNAP_ALIGN: f64 = 8.0;
/// A door or a window is placed on the side of a room this close to the point given (cm).
const SIDE_REACH: f64 = 60.0;
/// A door or a window whose line passes this close to both ends of a side, and whose middle is
/// this close to it, is on it (cm): the walls' rule (`geometry::walls`).
const ON_SIDE: f64 = crate::geometry::walls::ON_LINE;
/// Two sides this close to a point are as near as each other (a wall two rooms share).
const TIE: f64 = 0.5;
/// Room left between an opening and the ends of its side (cm).
const SIDE_MARGIN: f64 = 1.0;
/// Most changes kept for undo.
const MAX_UNDO: usize = 100;
/// Smallest side of a new room (cm).
const MIN_ROOM: f64 = 30.0;

/// A line a point was lined up on, to draw while dragging (plan points).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Guide {
    /// Start.
    pub a: P2,
    /// End.
    pub b: P2,
}

/// A plan being edited.
#[derive(Debug, Clone)]
pub struct Draft {
    plan: Value,
    /// `plan` as the reader reads it (none when it does not), for the rooms' corners.
    read: Option<Plan>,
    undo: Vec<Value>,
    redo: Vec<Value>,
    /// The plan when the drag started, while one runs.
    dragged_from: Option<Value>,
    saved: Value,
    /// Ids a new element must not take: those of the plan when editing started, and those given
    /// by `reserve` (elements removed earlier whose links are still stored).
    taken: BTreeSet<String>,
}

fn elements(plan: &Value) -> &[Value] {
    plan.get("elements")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn elements_mut(plan: &mut Value) -> &mut Vec<Value> {
    if !plan.get("elements").is_some_and(Value::is_array) {
        plan["elements"] = json!([]);
    }
    match &mut plan["elements"] {
        Value::Array(list) => list,
        other => {
            *other = Value::Array(Vec::new());
            match other {
                Value::Array(list) => list,
                _ => unreachable!("just set to an array"),
            }
        }
    }
}

fn id_of(element: &Value) -> Option<&str> {
    element.get("id").and_then(Value::as_str)
}

fn type_of(element: &Value) -> Option<&str> {
    element.get("type").and_then(Value::as_str)
}

fn number(element: &Value, key: &str) -> Option<f64> {
    element.get(key).and_then(Value::as_f64)
}

fn round(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// A room's corner as the reader gives it (`x + u·w`), without the last digits of the sums.
fn tidy(p: P2) -> P2 {
    p.map(|v| (v * 1e6).round() / 1e6)
}

fn distance(a: P2, b: P2) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// The point of segment AB nearest to `p`, and how far along AB it is (0–1).
fn nearest_on(p: P2, a: P2, b: P2) -> (P2, f64) {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len2 = d[0] * d[0] + d[1] * d[1];
    let t = if len2 > 0.0 {
        (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ([a[0] + d[0] * t, a[1] + d[1] * t], t)
}

/// Side `i` of a polygon: its two ends.
fn side(points: &[P2], i: usize) -> (P2, P2) {
    (points[i % points.len()], points[(i + 1) % points.len()])
}

/// A door or a window as placed: its hinge, its direction (a unit vector) and its width.
#[derive(Debug, Clone, Copy)]
struct Opening {
    hinge: P2,
    dir: P2,
    w: f64,
}

impl Opening {
    fn of(element: &Value) -> Self {
        let a = number(element, "angle").unwrap_or_default().to_radians();
        Opening {
            hinge: [
                number(element, "x").unwrap_or_default(),
                number(element, "y").unwrap_or_default(),
            ],
            dir: [a.cos(), a.sin()],
            w: number(element, "w").unwrap_or(80.0),
        }
    }

    fn centre(&self) -> P2 {
        [
            self.hinge[0] + self.dir[0] * self.w / 2.0,
            self.hinge[1] + self.dir[1] * self.w / 2.0,
        ]
    }

    /// The side of `points` it is on (the line of the opening passes within 6 cm of both its
    /// ends and its middle is within 6 cm of it), and whether it runs the same way as that side.
    fn side_on(&self, points: &[P2]) -> Option<(usize, bool)> {
        let centre = self.centre();
        // Distance from the opening's line.
        let off = |p: P2| {
            ((p[0] - self.hinge[0]) * -self.dir[1] + (p[1] - self.hinge[1]) * self.dir[0]).abs()
        };
        (0..points.len())
            .filter_map(|i| {
                let (a, b) = side(points, i);
                if off(a) > ON_SIDE || off(b) > ON_SIDE {
                    return None;
                }
                Some((i, distance(centre, nearest_on(centre, a, b).0), a, b))
            })
            .filter(|(_, gap, _, _)| *gap <= ON_SIDE)
            .min_by(|x, y| x.1.total_cmp(&y.1))
            .map(|(i, _, a, b)| {
                let forward = self.dir[0] * (b[0] - a[0]) + self.dir[1] * (b[1] - a[1]) >= 0.0;
                (i, forward)
            })
    }
}

/// Where an opening `w` wide whose centre is nearest `centre` goes on side AB: kept within the
/// side, running the same way as the side (`forward`) or the other way. Its hinge and angle;
/// `None` when the side is too short.
fn place_on_side(a: P2, b: P2, centre: P2, w: f64, forward: bool) -> Option<(P2, f64)> {
    let len = distance(a, b);
    if len < w + 2.0 * SIDE_MARGIN {
        return None;
    }
    let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let (_, t) = nearest_on(centre, a, b);
    let c = (t * len).clamp(w / 2.0 + SIDE_MARGIN, len - w / 2.0 - SIDE_MARGIN);
    let middle = [a[0] + u[0] * c, a[1] + u[1] * c];
    let s = if forward { 1.0 } else { -1.0 };
    let hinge = [
        middle[0] - s * u[0] * w / 2.0,
        middle[1] - s * u[1] * w / 2.0,
    ];
    Some((hinge, (s * u[1]).atan2(s * u[0]).to_degrees()))
}

fn write_place(element: &mut Value, hinge: P2, angle: f64) {
    element["x"] = json!(round(hinge[0]));
    element["y"] = json!(round(hinge[1]));
    // Within (−180°, 180°]: a side running left is 180°; never −0.
    let angle = round(angle) + 0.0;
    element["angle"] = json!(if angle <= -180.0 {
        angle + 360.0
    } else {
        angle
    });
}

impl Draft {
    /// Starts editing `plan` (a plan JSON, the edit overlay already applied).
    pub fn new(plan: Value) -> Self {
        let taken = elements(&plan)
            .iter()
            .filter_map(id_of)
            .map(str::to_owned)
            .collect();
        Self {
            read: read_plan_value(&plan).ok(),
            saved: plan.clone(),
            plan,
            undo: Vec::new(),
            redo: Vec::new(),
            dragged_from: None,
            taken,
        }
    }

    /// A new plan holding one room of 400 × 300 cm named `room_name`, whose id is none of
    /// `reserved` (see [`Draft::reserve`]).
    pub fn blank(title: &str, room_name: &str, reserved: impl IntoIterator<Item = String>) -> Self {
        let mut draft = Self::new(json!({
            "version": 1, "layoutRevision": crate::plan::PLAN_REVISION, "unit": "cm", "title": title,
            "elements": []
        }));
        draft.reserve(reserved);
        let id = draft.new_id("room");
        draft.plan["elements"] = json!([
            { "id": id, "type": "room", "name": room_name, "x": 0, "y": 0, "w": 400, "h": 300 }
        ]);
        draft.read = read_plan_value(&draft.plan).ok();
        // Nothing saved yet: the blank plan is a change.
        draft.saved = Value::Null;
        draft
    }

    /// Ids new elements must not take (elements removed earlier whose links are still stored),
    /// so that a new element never takes over another's links.
    pub fn reserve(&mut self, ids: impl IntoIterator<Item = String>) {
        self.taken.extend(ids);
    }

    /// The draft's JSON.
    pub fn plan(&self) -> &Value {
        &self.plan
    }

    /// The draft as read by the plan reader.
    ///
    /// # Errors
    ///
    /// Never for a draft built by its changes (each is checked); the error of the reader else.
    pub fn read(&self) -> Result<Plan, ReadError> {
        read_plan_value(&self.plan)
    }

    /// Changes not saved.
    pub fn dirty(&self) -> bool {
        self.plan != self.saved
    }

    /// The draft was saved as it is.
    pub fn mark_saved(&mut self) {
        self.saved = self.plan.clone();
    }

    /// A change to undo (none while a drag runs).
    pub fn can_undo(&self) -> bool {
        self.dragged_from.is_none() && !self.undo.is_empty()
    }

    /// A change to do again (none while a drag runs).
    pub fn can_redo(&self) -> bool {
        self.dragged_from.is_none() && !self.redo.is_empty()
    }

    /// Undoes the last change; not while a drag runs (it is one change, kept when it ends).
    pub fn undo(&mut self) -> bool {
        if self.dragged_from.is_some() {
            return false;
        }
        let Some(previous) = self.undo.pop() else {
            return false;
        };
        let next = std::mem::replace(&mut self.plan, previous);
        self.redo.push(next);
        self.read = read_plan_value(&self.plan).ok();
        true
    }

    /// Does the last undone change again; not while a drag runs.
    pub fn redo(&mut self) -> bool {
        if self.dragged_from.is_some() {
            return false;
        }
        let Some(next) = self.redo.pop() else {
            return false;
        };
        let previous = std::mem::replace(&mut self.plan, next);
        self.push_undo(previous);
        self.read = read_plan_value(&self.plan).ok();
        true
    }

    /// Keeps `previous` to undo to, the oldest dropped past 100.
    fn push_undo(&mut self, previous: Value) {
        self.undo.push(previous);
        if self.undo.len() > MAX_UNDO {
            self.undo.remove(0);
        }
    }

    /// Keeps `next` when the plan reader accepts it.
    fn commit(&mut self, next: Value) -> Result<(), ReadError> {
        let read = read_plan_value(&next)?;
        if next == self.plan {
            return Ok(());
        }
        let previous = std::mem::replace(&mut self.plan, next);
        self.read = Some(read);
        // During a drag, its moves make one change, kept when it ends.
        if self.dragged_from.is_none() {
            self.push_undo(previous);
            self.redo.clear();
        }
        Ok(())
    }

    /// Puts a whole plan in place (a draft kept by the browser), as one change to undo.
    ///
    /// # Errors
    ///
    /// A plan the reader refuses.
    pub fn replace(&mut self, plan: Value) -> Result<(), ReadError> {
        self.commit(plan)
    }

    /// Starts a drag: its changes become one change.
    pub fn begin_drag(&mut self) {
        if self.dragged_from.is_none() {
            self.dragged_from = Some(self.plan.clone());
        }
    }

    /// Ends a drag.
    pub fn end_drag(&mut self) {
        if let Some(start) = self.dragged_from.take()
            && start != self.plan
        {
            self.push_undo(start);
            self.redo.clear();
        }
    }

    fn index(&self, id: &str) -> Option<usize> {
        elements(&self.plan)
            .iter()
            .position(|e| id_of(e) == Some(id))
    }

    /// The element `id` of the draft.
    pub fn element(&self, id: &str) -> Option<&Value> {
        elements(&self.plan).get(self.index(id)?)
    }

    /// An id used by no element and never taken, `<prefix>-<n>` (taken from now on).
    fn new_id(&mut self, prefix: &str) -> String {
        let id = (1..)
            .map(|n| format!("{prefix}-{n}"))
            .find(|id| self.index(id).is_none() && !self.taken.contains(id))
            .unwrap_or_default();
        self.taken.insert(id.clone());
        id
    }

    /// The rooms of the draft with their corners in plan coordinates: the reader turns every way
    /// of giving a room (frame, vertices, bevel) into its corners.
    fn rooms(&self) -> impl Iterator<Item = (&str, Vec<P2>)> {
        self.read
            .iter()
            .flat_map(|plan| plan.elements.iter())
            .filter_map(|e| match e {
                Element::Room(room) => Some((
                    room.id.as_str(),
                    room.points().into_iter().map(tidy).collect(),
                )),
                _ => None,
            })
    }

    /// The corners of room `id` in plan coordinates.
    pub fn room_points(&self, id: &str) -> Option<Vec<P2>> {
        self.rooms()
            .find(|(room, _)| *room == id)
            .map(|(_, points)| points)
    }

    /// The corners of every room but `except`, to snap onto.
    fn corners(&self, except: Option<&str>) -> Vec<P2> {
        self.rooms()
            .filter(|(room, _)| Some(*room) != except)
            .flat_map(|(_, points)| points)
            .collect()
    }

    /// `p` on the grid, onto a corner of another room nearby, or lined up with one; with the
    /// lines it was lined up on.
    pub fn snap(&self, p: P2, except: Option<&str>) -> (P2, Vec<Guide>) {
        let corners = self.corners(except);
        if let Some(corner) = corners
            .iter()
            .filter(|c| distance(**c, p) <= SNAP_CORNER)
            .min_by(|a, b| distance(**a, p).total_cmp(&distance(**b, p)))
        {
            return (*corner, Vec::new());
        }
        let grid = |v: f64| (v / GRID).round() * GRID;
        let mut out = [grid(p[0]), grid(p[1])];
        let mut guides = Vec::new();
        for axis in 0..2 {
            if let Some(corner) = corners
                .iter()
                .filter(|c| (c[axis] - p[axis]).abs() <= SNAP_ALIGN)
                .min_by(|a, b| {
                    (a[axis] - p[axis])
                        .abs()
                        .total_cmp(&(b[axis] - p[axis]).abs())
                })
            {
                out[axis] = corner[axis];
                guides.push(Guide { a: *corner, b: out });
            }
        }
        for guide in &mut guides {
            guide.b = out;
        }
        (out, guides)
    }

    /// Adds a rectangular room from corner `a` to corner `b`. Returns its id.
    ///
    /// # Errors
    ///
    /// A room smaller than 30 cm or that the plan reader refuses (`room_size`…).
    pub fn add_room(&mut self, a: P2, b: P2, name: &str) -> Result<String, ReadError> {
        let (x, y) = (a[0].min(b[0]), a[1].min(b[1]));
        let (w, h) = ((a[0] - b[0]).abs(), (a[1] - b[1]).abs());
        if w < MIN_ROOM || h < MIN_ROOM {
            return Err(ReadError::new(crate::error::ErrorCode::RoomSize));
        }
        let id = self.new_id("room");
        let mut next = self.plan.clone();
        elements_mut(&mut next).push(json!({
            "id": id, "type": "room", "name": name,
            "x": round(x), "y": round(y), "w": round(w), "h": round(h),
        }));
        self.commit(next)?;
        Ok(id)
    }

    /// Gives room `id` the corners `points` (the same number), the doors and windows on its sides
    /// staying where they are along them.
    ///
    /// # Errors
    ///
    /// A shape the plan reader refuses (it crosses itself, is too small…).
    pub fn set_room_points(&mut self, id: &str, points: &[P2]) -> Result<(), ReadError> {
        let old = self.room_points(id).unwrap_or_default();
        let mut next = self.plan.clone();
        write_room(&mut next, id, points);
        let same = old.len() == points.len();
        reattach_openings(&mut next, id, &old, points, |s, _| same.then_some(s))?;
        self.commit(next)
    }

    /// Moves corner `i` of room `id` to `p`.
    ///
    /// # Errors
    ///
    /// As for [`Draft::set_room_points`].
    pub fn move_corner(&mut self, id: &str, i: usize, p: P2) -> Result<(), ReadError> {
        let mut points = self.room_points(id).unwrap_or_default();
        let Some(corner) = points.get_mut(i) else {
            return Ok(());
        };
        *corner = [round(p[0]), round(p[1])];
        self.set_room_points(id, &points)
    }

    /// Adds a corner to side `side` of room `id` at `p` (the side is split in two; its doors and
    /// windows stay on the half they are on).
    ///
    /// # Errors
    ///
    /// As for [`Draft::set_room_points`].
    pub fn insert_corner(&mut self, id: &str, side: usize, p: P2) -> Result<(), ReadError> {
        let old = self.room_points(id).unwrap_or_default();
        if side >= old.len() {
            return Ok(());
        }
        let mut points = old.clone();
        points.insert(side + 1, [round(p[0]), round(p[1])]);
        let mut next = self.plan.clone();
        write_room(&mut next, id, &points);
        shift_sides(&mut next, id, |s| {
            if s > side {
                vec![s + 1]
            } else if s == side {
                vec![s, s + 1]
            } else {
                vec![s]
            }
        });
        reattach_openings(&mut next, id, &old, &points, |s, centre| {
            if s < side {
                Some(s)
            } else if s > side {
                Some(s + 1)
            } else {
                // The half nearer the opening.
                let gap = |i: usize| {
                    let (a, b) = self::side(&points, i);
                    distance(centre, nearest_on(centre, a, b).0)
                };
                Some(if gap(side) <= gap(side + 1) {
                    side
                } else {
                    side + 1
                })
            }
        })?;
        self.commit(next)
    }

    /// Removes corner `i` of room `id` (three are kept at least): its two sides become one, with
    /// their doors and windows.
    ///
    /// # Errors
    ///
    /// As for [`Draft::set_room_points`].
    pub fn remove_corner(&mut self, id: &str, i: usize) -> Result<(), ReadError> {
        let old = self.room_points(id).unwrap_or_default();
        if old.len() <= 3 || i >= old.len() {
            return Ok(());
        }
        let mut points = old.clone();
        points.remove(i);
        let n = old.len();
        // The side before the corner and the side after it become side `merged`.
        let before = (i + n - 1) % n;
        let merged = if i == 0 { n - 2 } else { i - 1 };
        let mut next = self.plan.clone();
        write_room(&mut next, id, &points);
        // The merged side keeps the fields of the side before the corner (renumbered like the
        // others).
        shift_sides(&mut next, id, |s| {
            if s == i {
                Vec::new()
            } else if s > i {
                vec![s - 1]
            } else {
                vec![s]
            }
        });
        reattach_openings(&mut next, id, &old, &points, |s, _| {
            Some(if s == i || s == before {
                merged
            } else if s > i {
                s - 1
            } else {
                s
            })
        })?;
        self.commit(next)
    }

    /// Moves element `id` by `d`: a room with its corners and everything in it, a partition, or a
    /// door or a window along the sides of the rooms (to the side nearest its new place; along its
    /// own side it keeps the way it runs and opens).
    ///
    /// # Errors
    ///
    /// A place the plan reader refuses.
    pub fn move_element(&mut self, id: &str, d: P2) -> Result<(), ReadError> {
        let Some(index) = self.index(id) else {
            return Ok(());
        };
        let element = elements(&self.plan)[index].clone();
        let mut next = self.plan.clone();
        match type_of(&element) {
            Some("room") => {
                for e in elements_mut(&mut next) {
                    let child = e.get("parent").and_then(Value::as_str) == Some(id);
                    if id_of(e) == Some(id) || child {
                        shift(e, d);
                    }
                }
            }
            Some("wall" | "furniture") => shift(&mut elements_mut(&mut next)[index], d),
            Some("door" | "window") => {
                let opening = Opening::of(&element);
                let centre = opening.centre();
                let target = [centre[0] + d[0], centre[1] + d[1]];
                let parent = element.get("parent").and_then(Value::as_str);
                // On a wall two rooms share, it stays in its own room.
                let Some(place) = self.side_place(target, opening.w, parent) else {
                    return Ok(());
                };
                let own = parent
                    .and_then(|room| self.room_points(room))
                    .and_then(|points| opening.side_on(&points));
                let target_element = &mut elements_mut(&mut next)[index];
                match own {
                    Some((side, forward))
                        if parent == Some(place.room.as_str()) && side == place.side =>
                    {
                        let Some((hinge, angle)) =
                            place_on_side(place.a, place.b, target, opening.w, forward)
                        else {
                            return Ok(());
                        };
                        write_place(target_element, hinge, angle);
                    }
                    _ => place.write(target_element),
                }
            }
            _ => return Ok(()),
        }
        self.commit(next)
    }

    /// Adds a free partition from `a` to `b`. Returns its id.
    ///
    /// # Errors
    ///
    /// A partition the plan reader refuses (shorter than 5 cm…).
    pub fn add_wall(&mut self, a: P2, b: P2, name: &str) -> Result<String, ReadError> {
        let id = self.new_id("wall");
        let mut next = self.plan.clone();
        elements_mut(&mut next).push(json!({
            "id": id, "type": "wall", "name": name,
            "x": round(a[0]), "y": round(a[1]), "x2": round(b[0]), "y2": round(b[1]),
            "thickness": 7,
        }));
        self.commit(next)?;
        Ok(id)
    }

    /// Where an opening `w` wide centred near `p` goes: on the nearest side of a room (of room
    /// `prefer` when as near as another's), centred there and running along the side, opening
    /// into the room.
    fn side_place(&self, p: P2, w: f64, prefer: Option<&str>) -> Option<SidePlace> {
        let mut best: Option<(f64, SidePlace)> = None;
        for (room, points) in self.rooms() {
            for i in 0..points.len() {
                let (a, b) = side(&points, i);
                let (q, _) = nearest_on(p, a, b);
                let gap = distance(p, q);
                let better = best.as_ref().is_none_or(|(g, place)| {
                    gap < g - TIE
                        || (gap <= g + TIE && prefer == Some(room) && prefer != Some(&place.room))
                });
                if gap > SIDE_REACH || !better {
                    continue;
                }
                let Some((hinge, angle)) = place_on_side(a, b, p, w, true) else {
                    continue;
                };
                // Opening towards the inside of the room: the side's normal (turned +90°).
                let len = distance(a, b);
                let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
                let probe = [
                    hinge[0] + u[0] * w / 2.0 - u[1] * 5.0,
                    hinge[1] + u[1] * w / 2.0 + u[0] * 5.0,
                ];
                let inside = crate::geometry::polygon::point_in_polygon(probe, &points, false);
                best = Some((
                    gap,
                    SidePlace {
                        room: room.to_owned(),
                        side: i,
                        a,
                        b,
                        hinge,
                        angle,
                        w,
                        swing: if inside { 1 } else { -1 },
                    },
                ));
            }
        }
        best.map(|(_, place)| place)
    }

    /// Adds a door (or a window) centred on the side of a room nearest to `p`. Returns its id;
    /// `None` when no side is near enough.
    ///
    /// # Errors
    ///
    /// A place the plan reader refuses.
    pub fn add_opening(
        &mut self,
        door: bool,
        p: P2,
        name: &str,
    ) -> Result<Option<String>, ReadError> {
        let w = if door { 83.0 } else { 120.0 };
        let Some(place) = self
            .side_place(p, w, None)
            .or_else(|| self.side_place(p, 60.0, None))
        else {
            return Ok(None);
        };
        let id = self.new_id(if door { "door" } else { "window" });
        let mut element = json!({
            "id": id, "type": if door { "door" } else { "window" }, "name": name,
        });
        place.write(&mut element);
        let mut next = self.plan.clone();
        elements_mut(&mut next).push(element);
        self.commit(next)?;
        Ok(Some(id))
    }

    /// Changes fields of element `id`: `name` for all; `floor`, `color` for rooms; `w`, `swing`,
    /// `style` for doors and windows (a new width keeps the opening's middle on its side, within
    /// it); `thickness` for partitions. Others are left alone.
    ///
    /// # Errors
    ///
    /// A value the plan reader refuses; `opening_too_wide` for an opening wider than its side.
    pub fn update(&mut self, id: &str, fields: &Map<String, Value>) -> Result<(), ReadError> {
        let Some(index) = self.index(id) else {
            return Ok(());
        };
        let before = elements(&self.plan)[index].clone();
        let mut next = self.plan.clone();
        let element = &mut elements_mut(&mut next)[index];
        let allowed: &[&str] = match type_of(element) {
            Some("room") => &["name", "floor", "color"],
            Some("door") => &["name", "w", "swing", "style"],
            Some("window") => &["name", "w"],
            Some("wall") => &["name", "thickness"],
            _ => &["name"],
        };
        for (key, value) in fields {
            if allowed.contains(&key.as_str()) {
                element[key] = value.clone();
            }
        }
        // A new width: the opening keeps its middle, within its side.
        if matches!(type_of(element), Some("door" | "window"))
            && let Some(w) = number(element, "w")
            && Some(w) != number(&before, "w")
            && let Some(points) = before
                .get("parent")
                .and_then(Value::as_str)
                .and_then(|room| self.room_points(room))
        {
            let opening = Opening::of(&before);
            if let Some((side, forward)) = opening.side_on(&points) {
                let (a, b) = self::side(&points, side);
                let Some((hinge, angle)) = place_on_side(a, b, opening.centre(), w, forward) else {
                    return Err(ReadError::new(ErrorCode::OpeningTooWide).at(id));
                };
                write_place(element, hinge, angle);
            }
        }
        self.commit(next)
    }

    /// Removes element `id`: a room takes its doors and windows with it; what stood in it stays,
    /// in no room.
    ///
    /// # Errors
    ///
    /// A plan the reader refuses (the last element removed).
    pub fn remove(&mut self, id: &str) -> Result<(), ReadError> {
        if self.index(id).is_none() {
            return Ok(());
        }
        let room = self.element(id).and_then(type_of) == Some("room");
        let mut next = self.plan.clone();
        let list = elements_mut(&mut next);
        list.retain(|e| {
            let child = e.get("parent").and_then(Value::as_str) == Some(id);
            id_of(e) != Some(id)
                && !(room && child && matches!(type_of(e), Some("door" | "window")))
        });
        for e in list.iter_mut() {
            if e.get("parent").and_then(Value::as_str) == Some(id)
                && let Some(object) = e.as_object_mut()
            {
                object.remove("parent");
            }
        }
        self.commit(next)
    }
}

/// A door's or a window's place on a room's side.
#[derive(Debug, Clone, PartialEq)]
struct SidePlace {
    room: String,
    /// The side, and its ends.
    side: usize,
    a: P2,
    b: P2,
    hinge: P2,
    angle: f64,
    w: f64,
    swing: i64,
}

impl SidePlace {
    fn write(&self, element: &mut Value) {
        write_place(element, self.hinge, self.angle);
        element["w"] = json!(round(self.w));
        element["parent"] = json!(self.room);
        if type_of(element) == Some("door") {
            element["swing"] = json!(self.swing);
        }
    }
}

fn shift(element: &mut Value, d: P2) {
    for (key, axis) in [("x", 0), ("y", 1), ("x2", 0), ("y2", 1)] {
        if let Some(v) = element.get(key).and_then(Value::as_f64) {
            element[key] = json!(round(v + d[axis]));
        }
    }
}

/// Writes the corners of room `id` (rounded to 1 mm): its frame and its corners within it.
fn write_room(plan: &mut Value, id: &str, points: &[P2]) {
    let Some(element) = elements_mut(plan).iter_mut().find(|e| id_of(e) == Some(id)) else {
        return;
    };
    // Rounded first, so that the corners not moved come back exactly where they were.
    let points: Vec<P2> = points.iter().map(|p| [round(p[0]), round(p[1])]).collect();
    let min = [0, 1].map(|k| points.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min));
    let max = [0, 1].map(|k| {
        points
            .iter()
            .map(|p| p[k])
            .fold(f64::NEG_INFINITY, f64::max)
    });
    let (w, h) = ((max[0] - min[0]).max(1e-6), (max[1] - min[1]).max(1e-6));
    element["x"] = json!(round(min[0]));
    element["y"] = json!(round(min[1]));
    element["w"] = json!(round(w));
    element["h"] = json!(round(h));
    let vertices: Vec<Value> = points
        .iter()
        .map(|p| {
            let u = ((p[0] - min[0]) / w * 1e9).round() / 1e9;
            let v = ((p[1] - min[1]) / h * 1e9).round() / 1e9;
            json!([u, v])
        })
        .collect();
    element["vertices"] = Value::Array(vertices);
    if let Some(object) = element.as_object_mut() {
        object.remove("bevel");
    }
}

/// Moves the per-side fields of room `id` (`openEdges`, `edgeThickness`, `edgeFinish`) to the
/// sides `map` gives each old side.
fn shift_sides(plan: &mut Value, id: &str, map: impl Fn(usize) -> Vec<usize>) {
    let Some(element) = elements_mut(plan).iter_mut().find(|e| id_of(e) == Some(id)) else {
        return;
    };
    if let Some(open) = element.get("openEdges").and_then(Value::as_array) {
        let mut sides: Vec<u64> = open
            .iter()
            .filter_map(Value::as_u64)
            .flat_map(|s| map(usize::try_from(s).unwrap_or(usize::MAX)))
            .map(|s| s as u64)
            .collect();
        sides.sort_unstable();
        sides.dedup();
        element["openEdges"] = json!(sides);
    }
    for key in ["edgeThickness", "edgeFinish"] {
        if let Some(list) = element.get(key).and_then(Value::as_array).cloned() {
            let mut out: Vec<Value> = Vec::new();
            for (s, value) in list.into_iter().enumerate() {
                for t in map(s) {
                    if out.len() <= t {
                        out.resize(t + 1, Value::Null);
                    }
                    out[t] = value.clone();
                }
            }
            element[key] = Value::Array(out);
        }
    }
}

/// Puts the doors and windows of room `id` back on its sides after its corners changed from
/// `old` to `new`: an opening on old side `s` goes on new side `map(s, its middle)`, as near its
/// middle as it fits, running the same way and opening to the same side.
///
/// # Errors
///
/// `opening_too_wide` when a side becomes too short for an opening on it.
fn reattach_openings(
    plan: &mut Value,
    id: &str,
    old: &[P2],
    new: &[P2],
    map: impl Fn(usize, P2) -> Option<usize>,
) -> Result<(), ReadError> {
    if old.len() < 3 || new.len() < 3 {
        return Ok(());
    }
    for e in elements_mut(plan) {
        if !matches!(type_of(e), Some("door" | "window"))
            || e.get("parent").and_then(Value::as_str) != Some(id)
        {
            continue;
        }
        let opening = Opening::of(e);
        let Some((old_side, forward)) = opening.side_on(old) else {
            continue;
        };
        let Some(new_side) = map(old_side, opening.centre()).filter(|s| *s < new.len()) else {
            continue;
        };
        let (a, b) = side(new, new_side);
        let Some((hinge, angle)) = place_on_side(a, b, opening.centre(), opening.w, forward) else {
            let at = id_of(e).unwrap_or_default().to_owned();
            return Err(ReadError::new(ErrorCode::OpeningTooWide).at(at));
        };
        write_place(e, hinge, angle);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> Draft {
        Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "a", "type": "room", "name": "A", "x": 0, "y": 0, "w": 400, "h": 300 },
                { "id": "sofa", "type": "furniture", "name": "Sofa", "x": 100, "y": 100, "w": 90,
                  "h": 200, "z": 85, "kind": "sofa", "parent": "a" },
                { "id": "d", "type": "door", "name": "Door", "x": 100, "y": 0, "w": 83, "angle": 0,
                  "parent": "a" }
            ]
        }))
    }

    #[test]
    fn rooms_are_drawn_snapped_and_checked() {
        let mut d = draft();
        // Drawn to the right of A, its corner snapped onto A's.
        let (corner, _) = d.snap([403.0, -4.0], None);
        assert_eq!(corner, [400.0, 0.0]);
        let (p, guides) = d.snap([611.0, 302.0], None);
        assert_eq!(p, [610.0, 300.0]);
        assert_eq!(guides.len(), 1, "lined up with A's bottom side");
        let id = d.add_room(corner, p, "B").unwrap();
        assert_eq!(id, "room-1");
        assert_eq!(d.room_points(&id).unwrap()[2], [610.0, 300.0]);
        assert!(d.read().is_ok() && d.dirty() && d.can_undo());
        // Too small.
        assert!(d.add_room([0.0, 0.0], [10.0, 10.0], "C").is_err());
        assert!(d.undo());
        assert!(d.element("room-1").is_none());
        assert!(d.redo());
        assert!(d.element("room-1").is_some());
    }

    #[test]
    fn corners_move_with_the_doors_on_their_sides() {
        let mut d = draft();
        d.begin_drag();
        d.move_corner("a", 0, [0.0, -50.0]).unwrap();
        d.move_corner("a", 0, [0.0, -100.0]).unwrap();
        d.end_drag();
        let points = d.room_points("a").unwrap();
        assert_eq!(points[0], [0.0, -100.0]);
        // The door stays on the top side, at the same distance from its start.
        let door = d.element("d").unwrap();
        let (x, y) = (door["x"].as_f64().unwrap(), door["y"].as_f64().unwrap());
        let (q, _) = nearest_on([x, y], points[0], points[1]);
        assert!(distance([x, y], q) < 0.2, "{x} {y}");
        // One change for the whole drag.
        assert!(d.undo());
        assert!(!d.can_undo());
        assert_eq!(d.room_points("a").unwrap()[0], [0.0, 0.0]);
    }

    #[test]
    fn crossing_shapes_are_refused() {
        let mut d = draft();
        let before = d.plan().clone();
        assert!(d.move_corner("a", 0, [300.0, 400.0]).is_err());
        assert_eq!(d.plan(), &before);
    }

    #[test]
    fn corners_are_added_and_removed_with_the_sides_fields() {
        let mut d = Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "a", "type": "room", "name": "A", "x": 0, "y": 0, "w": 400, "h": 300,
                  "openEdges": [2], "edgeThickness": [null, 30, null, null] }
            ]
        }));
        d.insert_corner("a", 1, [420.0, 150.0]).unwrap();
        let a = d.element("a").unwrap();
        assert_eq!(a["openEdges"], json!([3]));
        assert_eq!(a["edgeThickness"], json!([null, 30, 30, null, null]));
        assert_eq!(d.room_points("a").unwrap().len(), 5);
        d.remove_corner("a", 2).unwrap();
        let a = d.element("a").unwrap();
        assert_eq!(a["openEdges"], json!([2]));
        assert_eq!(d.room_points("a").unwrap().len(), 4);
        // A triangle keeps its three corners.
        let mut t = Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [{ "id": "t", "type": "room", "name": "T", "x": 0, "y": 0, "w": 300,
              "h": 300, "vertices": [[0, 0], [1, 0], [0, 1]] }]
        }));
        t.remove_corner("t", 0).unwrap();
        assert_eq!(t.room_points("t").unwrap().len(), 3);
    }

    #[test]
    fn rooms_move_with_what_is_in_them() {
        let mut d = draft();
        d.move_element("a", [50.0, 20.0]).unwrap();
        assert_eq!(d.element("sofa").unwrap()["x"], json!(150.0));
        assert_eq!(d.element("d").unwrap()["y"], json!(20.0));
        assert_eq!(d.room_points("a").unwrap()[0], [50.0, 20.0]);
    }

    #[test]
    fn openings_go_on_the_nearest_side_opening_inwards() {
        let mut d = draft();
        let id = d
            .add_opening(false, [395.0, 150.0], "Window")
            .unwrap()
            .unwrap();
        let window = d.element(&id).unwrap().clone();
        assert_eq!(window["parent"], "a");
        // The right side runs down (angle 90), the window centred on the point.
        assert_eq!(window["angle"], json!(90.0));
        assert_eq!(window["x"], json!(400.0));
        assert_eq!(window["y"], json!(90.0));
        let door = d
            .add_opening(true, [200.0, 310.0], "Door")
            .unwrap()
            .unwrap();
        let door = d.element(&door).unwrap();
        // The bottom side runs right to left (clockwise): its normal points into the room.
        assert_eq!(door["angle"], json!(180.0));
        assert_eq!(door["swing"], json!(1));
        // Nowhere near a side.
        assert!(
            d.add_opening(true, [2_000.0, 2_000.0], "Door")
                .unwrap()
                .is_none()
        );
        // A door moves along the sides.
        d.move_element("d", [0.0, 300.0]).unwrap();
        assert_eq!(d.element("d").unwrap()["angle"], json!(180.0));
    }

    #[test]
    fn removing_a_room_keeps_its_furniture() {
        let mut d = draft();
        d.add_room([400.0, 0.0], [600.0, 300.0], "B").unwrap();
        d.remove("a").unwrap();
        assert!(d.element("d").is_none());
        let sofa = d.element("sofa").unwrap();
        assert!(sofa.get("parent").is_none());
        // The last element cannot go.
        let mut lone = Draft::blank("Home", "Room 1", []);
        assert!(lone.remove("room-1").is_err());
        assert!(lone.dirty());
    }

    #[test]
    fn fields_are_changed_within_what_each_type_allows() {
        let mut d = draft();
        let mut fields = Map::new();
        fields.insert("name".into(), json!("Living"));
        fields.insert("floor".into(), json!("parquet-chene"));
        fields.insert("x".into(), json!(999));
        d.update("a", &fields).unwrap();
        let a = d.element("a").unwrap();
        assert_eq!(a["name"], "Living");
        assert_eq!(a["x"], json!(0));
        d.add_wall([50.0, 50.0], [50.0, 250.0], "Partition")
            .unwrap();
        assert!(d.add_wall([0.0, 0.0], [1.0, 0.0], "Short").is_err());
    }

    fn opening(d: &Draft, id: &str) -> (f64, f64, f64) {
        let e = d.element(id).unwrap();
        (
            e["x"].as_f64().unwrap(),
            e["y"].as_f64().unwrap(),
            e["angle"].as_f64().unwrap(),
        )
    }

    #[test]
    fn openings_keep_their_way_round_when_another_corner_moves() {
        let mut d = Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "a", "type": "room", "name": "A", "x": 0, "y": 0, "w": 400, "h": 300 },
                // Drawn against the room's winding: from 300 back to 220.
                { "id": "r", "type": "door", "name": "R", "x": 300, "y": 0, "w": 80, "angle": 180,
                  "swing": -1, "parent": "a" }
            ]
        }));
        d.move_corner("a", 2, [420.0, 300.0]).unwrap();
        assert_eq!(opening(&d, "r"), (300.0, 0.0, 180.0));
        assert_eq!(d.element("r").unwrap()["swing"], json!(-1));
        // Untouched corners stay exactly where they were.
        let points = d.room_points("a").unwrap();
        assert_eq!(points[0], [0.0, 0.0]);
        assert_eq!(points[1], [400.0, 0.0]);
        d.move_corner("a", 2, [-50.0, 150.0]).unwrap_err();
        d.move_corner("a", 3, [-50.0, 150.0]).unwrap();
        let points = d.room_points("a").unwrap();
        assert_eq!(points[0], [0.0, 0.0]);
        assert_eq!(points[1], [400.0, 0.0]);
    }

    #[test]
    fn a_corner_added_or_removed_leaves_the_openings_where_they_are() {
        let mut d = draft();
        // The door spans 100–183 on the top side; a corner added at 200 keeps it there.
        d.insert_corner("a", 0, [200.0, 0.0]).unwrap();
        assert_eq!(opening(&d, "d"), (100.0, 0.0, 0.0));
        // One past the corner stays too.
        let mut e = draft();
        let mut fields = Map::new();
        fields.insert("w".into(), json!(80));
        e.update("d", &fields).unwrap();
        e.move_element("d", [200.0, 0.0]).unwrap();
        let (x, _, _) = opening(&e, "d");
        e.insert_corner("a", 0, [200.0, 0.0]).unwrap();
        assert_eq!(opening(&e, "d").0, x);
        // The two sides of a corner removed become one, their openings on it.
        let mut p = Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "p", "type": "room", "name": "P", "x": 0, "y": 0, "w": 400, "h": 300,
                  "vertices": [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]] },
                { "id": "d", "type": "door", "name": "D", "x": 250, "y": 0, "w": 80, "angle": 0,
                  "parent": "p" },
                { "id": "w", "type": "window", "name": "W", "x": 0, "y": 200, "w": 80,
                  "angle": -90, "parent": "p" }
            ]
        }));
        p.remove_corner("p", 1).unwrap();
        assert_eq!(opening(&p, "d"), (250.0, 0.0, 0.0));
        // The last corner: the left side goes, the window onto the side that replaces it.
        p.remove_corner("p", 3).unwrap();
        let points = p.room_points("p").unwrap();
        let o = Opening::of(p.element("w").unwrap());
        assert!(o.side_on(&points).is_some(), "{:?}", p.element("w"));
    }

    #[test]
    fn new_elements_never_take_an_id_with_links() {
        let mut d = draft();
        d.reserve(["door-1".to_owned()]);
        let first = d.add_opening(true, [300.0, 2.0], "Door").unwrap().unwrap();
        assert_eq!(first, "door-2");
        d.remove(&first).unwrap();
        let second = d.add_opening(true, [300.0, 2.0], "Door").unwrap().unwrap();
        assert_eq!(
            second, "door-3",
            "an id removed in the session is not given again"
        );
    }

    #[test]
    fn the_history_keeps_100_changes_and_waits_for_the_drag() {
        let mut d = draft();
        for i in 0..150 {
            d.begin_drag();
            d.move_element("a", [1.0, f64::from(i % 2)]).unwrap();
            d.end_drag();
        }
        let mut undone = 0;
        while d.undo() {
            undone += 1;
        }
        assert_eq!(undone, MAX_UNDO);
        // No undo or redo while a drag runs.
        d.redo();
        d.begin_drag();
        d.move_element("a", [5.0, 0.0]).unwrap();
        assert!(!d.can_undo() && !d.undo() && !d.redo());
        d.end_drag();
        assert!(d.can_undo());
    }

    #[test]
    fn a_door_moved_along_its_side_keeps_the_side_it_opens_to() {
        let mut d = draft();
        let mut fields = Map::new();
        fields.insert("swing".into(), json!(-1));
        d.update("d", &fields).unwrap();
        d.move_element("d", [20.0, 0.0]).unwrap();
        assert_eq!(d.element("d").unwrap()["swing"], json!(-1));
        assert_eq!(opening(&d, "d"), (120.0, 0.0, 0.0));
    }

    #[test]
    fn a_width_must_fit_on_its_side() {
        let mut d = draft();
        let mut fields = Map::new();
        fields.insert("w".into(), json!(500));
        let err = d.update("d", &fields).unwrap_err();
        assert_eq!(err.code, ErrorCode::OpeningTooWide);
        // A wider door keeps its middle (141.5).
        fields.insert("w".into(), json!(103));
        d.update("d", &fields).unwrap();
        assert_eq!(opening(&d, "d"), (90.0, 0.0, 0.0));
    }

    #[test]
    fn a_door_on_a_shared_wall_stays_in_its_room() {
        // B sits under A: the line y = 300 is A's bottom side and B's top side; A comes first.
        let mut d = Draft::new(json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "a", "type": "room", "name": "A", "x": 0, "y": 0, "w": 400, "h": 300 },
                { "id": "b", "type": "room", "name": "B", "x": 0, "y": 300, "w": 400, "h": 300 },
                { "id": "d", "type": "door", "name": "D", "x": 100, "y": 300, "w": 80,
                  "angle": 0, "swing": -1, "parent": "b" }
            ]
        }));
        for _ in 0..3 {
            d.move_element("d", [20.0, 0.0]).unwrap();
        }
        let door = d.element("d").unwrap();
        assert_eq!(door["parent"], "b");
        assert_eq!(door["swing"], json!(-1));
        assert_eq!(opening(&d, "d"), (160.0, 300.0, 0.0));
        // Angles within (−180°, 180°], never −0.
        let mut e = json!({});
        write_place(&mut e, [0.0, 0.0], -0.0);
        assert_eq!(e["angle"].to_string(), "0.0");
        write_place(&mut e, [0.0, 0.0], -180.0);
        assert_eq!(e["angle"], json!(180.0));
    }

    #[test]
    fn a_side_cannot_become_shorter_than_its_door() {
        let mut d = draft();
        let before = d.plan().clone();
        // The door (83 cm) is on the top side: bringing the top right corner to x = 60 is refused.
        let err = d.move_corner("a", 1, [60.0, 0.0]).unwrap_err();
        assert_eq!(err.code, ErrorCode::OpeningTooWide);
        assert_eq!(d.plan(), &before);
    }

    #[test]
    fn a_new_plan_s_room_takes_no_id_with_links() {
        let d = Draft::blank("Home", "Room", ["room-1".to_owned()]);
        assert!(d.element("room-2").is_some() && d.element("room-1").is_none());
        assert!(d.read().is_ok() && d.dirty());
    }
}
