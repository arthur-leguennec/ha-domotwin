//! The home as the radios see it (`DECISIONS.md`, D-066): where the rooms are, how many walls stand
//! between two places, where each piece stands. The plans are read as the integration's locating
//! reads them (`custom_components/domotwin/locating/geometry.py`, D-035), from the storeys as
//! stored, so that the two count the same walls between the same places. Lengths are in cm, points
//! on a storey's plan as in the plan format.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

/// A point of a storey's plan.
pub type Point = [f64; 2];

/// Where a device is held (a phone in a hand, a sensor on a shelf), cm above its floor.
pub const HELD_AT: f64 = 110.0;
/// Where a radio stands when only its point is known, cm above its floor.
pub const RADIO_AT: f64 = 120.0;
/// A room is looked at from this many points at most, kept this far from its sides.
pub const MAX_POINTS: usize = 12;
const POINT_MARGIN: f64 = 25.0;
/// A gap between two rooms narrower than this is the wall between them.
const WALL_GAP: f64 = 60.0;
/// A door at the crossing: the wall is mostly not there.
const DOOR_NEAR: f64 = 25.0;
/// What a door in the way counts for, in walls.
pub const DOOR_WALL: f64 = 0.4;
/// How far across a side the room beyond is looked for.
const ACROSS: f64 = 25.0;
/// Most storeys, rooms, doors and pieces read.
const MAX_STOREYS: usize = 64;
const MAX_ITEMS: usize = 5_000;
/// The plan of a storey that has none.
static EMPTY: Value = Value::Null;

/// A place in the home: a storey (lowest first), a point on its plan and a height (cm, from the
/// lowest storey's floor).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spot {
    pub storey: usize,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Spot {
    /// The distance to another place, in metres.
    pub fn metres(&self, other: &Spot) -> f64 {
        let (dx, dy, dz) = (self.x - other.x, self.y - other.y, self.z - other.z);
        (dx * dx + dy * dy + dz * dz).sqrt() / 100.0
    }
}

/// A room of a storey, with the box around it.
#[derive(Debug, Clone, PartialEq)]
pub struct Room {
    pub id: String,
    pub storey: usize,
    pub outline: Vec<Point>,
    low: Point,
    high: Point,
}

impl Room {
    fn new(id: String, storey: usize, outline: Vec<Point>) -> Self {
        let mut low = [f64::INFINITY; 2];
        let mut high = [f64::NEG_INFINITY; 2];
        for p in &outline {
            for k in 0..2 {
                low[k] = low[k].min(p[k]);
                high[k] = high[k].max(p[k]);
            }
        }
        Room {
            id,
            storey,
            outline,
            low,
            high,
        }
    }

    /// Its floor area (m²).
    pub fn area(&self) -> f64 {
        twice_area(&self.outline).abs() / 2.0 / 10_000.0
    }

    /// Whether a point may be inside: in the box around the room.
    fn may_hold(&self, p: Point) -> bool {
        p[0] >= self.low[0] && p[0] <= self.high[0] && p[1] >= self.low[1] && p[1] <= self.high[1]
    }

    /// Whether the segment a-b may cross the room's sides: their boxes meet.
    fn may_cross(&self, a: Point, b: Point) -> bool {
        a[0].max(b[0]) >= self.low[0]
            && a[0].min(b[0]) <= self.high[0]
            && a[1].max(b[1]) >= self.low[1]
            && a[1].min(b[1]) <= self.high[1]
    }
}

/// A piece of a storey: where its centre stands, and its kind.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub spot: Spot,
    pub kind: Option<String>,
}

/// The rooms, doors, sides left open and pieces of every storey.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Home {
    pub rooms: Vec<Room>,
    pub elevations: Vec<f64>,
    pub storey_ids: Vec<String>,
    pub pieces: HashMap<String, Piece>,
    doors: Vec<Vec<(Point, Point)>>,
    /// The rooms joined by a side left open, by index, the smaller first.
    open: BTreeSet<(usize, usize)>,
}

/// A finite number, else nothing (a boolean is not one).
pub(crate) fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite())
}

/// A point `[x, y]` of finite numbers, else nothing.
pub(crate) fn point(value: Option<&Value>) -> Option<Point> {
    let list = value?.as_array()?;
    if list.len() != 2 {
        return None;
    }
    Some([number(list.first())?, number(list.get(1))?])
}

/// The objects of a plan's list (`rooms`, `doors`, `items`).
fn listed<'a>(plan: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    plan.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|v| v.is_object())
        .take(MAX_ITEMS)
}

/// Whether `p` is inside a polygon (on a side counts either way), as the integration finds it.
pub fn inside(outline: &[Point], p: Point) -> bool {
    let [x, y] = p;
    let mut found = false;
    let Some(mut j) = outline.len().checked_sub(1) else {
        return false;
    };
    for (i, &[xi, yi]) in outline.iter().enumerate() {
        let [xj, yj] = outline[j];
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            found = !found;
        }
        j = i;
    }
    found
}

/// Distance from `p` to the segment a-b.
pub fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx * dx + dy * dy;
    let along = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (along / length).clamp(0.0, 1.0)
    };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}

/// Where along a-b (0 to 1) it crosses the side p-q, if it does.
fn crossing(a: Point, b: Point, p: Point, q: Point) -> Option<f64> {
    let (rx, ry) = (b[0] - a[0], b[1] - a[1]);
    let (sx, sy) = (q[0] - p[0], q[1] - p[1]);
    let denominator = rx * sy - ry * sx;
    if denominator.abs() < 1e-12 {
        return None;
    }
    let t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / denominator;
    let u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / denominator;
    (t > 0.0 && t < 1.0 && (0.0..=1.0).contains(&u)).then_some(t)
}

fn edge_distance(outline: &[Point], p: Point) -> f64 {
    let n = outline.len();
    (0..n)
        .map(|i| segment_distance(p, outline[(i + n - 1) % n], outline[i]))
        .fold(f64::INFINITY, f64::min)
}

/// The points either side of the middle of a-b, [`ACROSS`] away from it.
fn across(a: Point, b: Point) -> [Point; 2] {
    let (mx, my) = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0);
    let mut length = (b[0] - a[0]).hypot(b[1] - a[1]);
    if length == 0.0 {
        length = 1.0;
    }
    let (nx, ny) = (
        -(b[1] - a[1]) / length * ACROSS,
        (b[0] - a[0]) / length * ACROSS,
    );
    [[mx + nx, my + ny], [mx - nx, my - ny]]
}

/// Twice an outline's signed area (cm²).
fn twice_area(outline: &[Point]) -> f64 {
    let n = outline.len();
    (0..n)
        .map(|k| {
            let (a, b) = (outline[(k + n - 1) % n], outline[k]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum()
}

/// Whether an outline has no room in it (its corners on one line or one point).
fn flat(outline: &[Point]) -> bool {
    twice_area(outline).abs() < 2.0
}

/// `t` rounded to nine decimals, as the integration keeps the crossings.
fn rounded(t: f64) -> f64 {
    (t * 1e9).round() / 1e9
}

/// `a // b` as Python divides floats (the floor of the exact quotient), for `a`, `b` > 0: the
/// grid of a room's points is the integration's.
fn floor_div(a: f64, b: f64) -> f64 {
    let div = (a - a % b) / b;
    let floor = div.floor();
    if div - floor > 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

impl Home {
    /// Reads the storeys (lowest first, as stored: `[{"id", "elevation", "plan", "layout"}]`):
    /// their rooms, doors, sides left open and pieces. What is malformed is left out.
    pub fn read(storeys: &Value) -> Self {
        let mut home = Home::default();
        let mut open_sides: Vec<(usize, usize, Point, Point)> = Vec::new();
        let mut by_id: HashMap<String, usize> = HashMap::new();
        let storeys = storeys.as_array().map(Vec::as_slice).unwrap_or_default();
        for (index, storey) in storeys.iter().take(MAX_STOREYS).enumerate() {
            home.storey_ids.push(match storey.get("id") {
                Some(Value::String(id)) => id.clone(),
                Some(other) if !other.is_null() => other.to_string(),
                _ => String::new(),
            });
            home.elevations
                .push(number(storey.get("elevation")).unwrap_or(0.0));
            let plan = storey.get("plan").filter(|p| p.is_object());
            let layout = storey.get("layout").filter(|l| l.is_object());
            let mut doors = Vec::new();
            // A storey without a plan still counts as a floor, and its overlay may add pieces.
            home.read_pieces(index, plan.unwrap_or(&EMPTY), layout);
            if let Some(plan) = plan {
                for room in listed(plan, "rooms") {
                    let outline: Vec<Point> = room
                        .get("outline")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|p| point(Some(p)))
                        .collect();
                    let Some(id) = room.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    if outline.len() < 3 || flat(&outline) {
                        continue;
                    }
                    // A room id read again replaces the first, where it was (as a dict does).
                    let slot = by_id.get(id).copied().unwrap_or(home.rooms.len());
                    let n = outline.len();
                    let sides = room.get("sides").and_then(Value::as_array);
                    for (k, side) in sides.into_iter().flatten().enumerate() {
                        if side.get("open") == Some(&Value::Bool(true)) && k < n {
                            open_sides.push((index, slot, outline[k], outline[(k + 1) % n]));
                        }
                    }
                    let read = Room::new(id.to_owned(), index, outline);
                    if slot < home.rooms.len() {
                        home.rooms[slot] = read;
                    } else {
                        by_id.insert(id.to_owned(), slot);
                        home.rooms.push(read);
                    }
                }
                for door in listed(plan, "doors") {
                    if let (Some(a), Some(b)) = (point(door.get("from")), point(door.get("to")))
                        && door.get("style").and_then(Value::as_str) != Some("sealed")
                    {
                        doors.push((a, b));
                    }
                }
            }
            home.doors.push(doors);
        }
        for (storey, room, a, b) in open_sides {
            for p in across(a, b) {
                if let Some(other) = home.room_at(storey, p)
                    && other != room
                {
                    home.open.insert((room.min(other), room.max(other)));
                }
            }
        }
        home
    }

    /// The pieces' centres, moved, lifted, removed or added by the overlay.
    fn read_pieces(&mut self, storey: usize, plan: &Value, layout: Option<&Value>) {
        let floor = self.elevations.get(storey).copied().unwrap_or(0.0);
        let mut items: Vec<(String, Value)> = listed(plan, "items")
            .filter_map(|item| Some((item.get("id")?.as_str()?.to_owned(), item.clone())))
            .collect();
        let entries = layout.and_then(Value::as_object);
        let known: BTreeSet<String> = items.iter().map(|(id, _)| id.clone()).collect();
        for (key, entry) in entries.into_iter().flatten().take(MAX_ITEMS) {
            if known.contains(key) {
                continue;
            }
            let (Some(entry), Some(add)) = (
                entry.as_object(),
                entry.get("add").and_then(Value::as_object),
            ) else {
                continue;
            };
            // What the overlay says of it wins over what it added.
            let mut merged = add.clone();
            merged.extend(entry.iter().map(|(k, v)| (k.clone(), v.clone())));
            items.push((key.clone(), Value::Object(merged)));
        }
        for (key, item) in items {
            let moved = entries.and_then(|e| e.get(&key)).filter(|m| m.is_object());
            if moved.and_then(|m| m.get("removed")) == Some(&Value::Bool(true)) {
                continue;
            }
            let Some(at) = point(moved.and_then(|m| m.get("at"))).or_else(|| point(item.get("at")))
            else {
                continue;
            };
            let height = item
                .get("size")
                .and_then(Value::as_array)
                .filter(|size| size.len() == 3)
                .and_then(|size| number(size.get(2)))
                .unwrap_or(0.0);
            let lift = number(moved.and_then(|m| m.get("lift")))
                .or_else(|| number(item.get("lift")))
                .unwrap_or(0.0);
            let spot = Spot {
                storey,
                x: at[0],
                y: at[1],
                z: floor + lift + height / 2.0,
            };
            let kind = item.get("kind").and_then(Value::as_str).map(str::to_owned);
            self.pieces.insert(key, Piece { spot, kind });
        }
    }

    /// The room a point of a storey is in (by index).
    pub fn room_at(&self, storey: usize, p: Point) -> Option<usize> {
        self.rooms
            .iter()
            .position(|room| room.storey == storey && room.may_hold(p) && inside(&room.outline, p))
    }

    /// The index of a room by its id.
    pub fn room_index(&self, id: &str) -> Option<usize> {
        self.rooms.iter().position(|room| room.id == id)
    }

    /// Places a device may be held in a room: a grid inside it, clear of its sides.
    pub fn points(&self, room: usize) -> Vec<Spot> {
        let Some(room) = self.rooms.get(room) else {
            return Vec::new();
        };
        let (low, high) = (room.low, room.high);
        let (width, depth) = (high[0] - low[0], high[1] - low[1]);
        let z = self.elevations.get(room.storey).copied().unwrap_or(0.0) + HELD_AT;
        let mut found: Vec<Point> = Vec::new();
        for k in [3.0, 4.0, 6.0, 8.0, 12.0] {
            let step = width.max(depth) / k;
            found.clear();
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let (columns, rows) = (
                floor_div(width, step) as usize + 1,
                floor_div(depth, step) as usize + 1,
            );
            for i in 0..columns.min(64) {
                for j in 0..rows.min(64) {
                    #[allow(clippy::cast_precision_loss)]
                    let p = [
                        low[0] + step / 2.0 + i as f64 * step,
                        low[1] + step / 2.0 + j as f64 * step,
                    ];
                    if inside(&room.outline, p) && edge_distance(&room.outline, p) >= POINT_MARGIN {
                        found.push(p);
                    }
                }
            }
            if found.len() >= MAX_POINTS / 2 || step < 2.0 * POINT_MARGIN {
                break;
            }
        }
        if found.is_empty() {
            // A narrow room: the middle of its corners, or a corner.
            #[allow(clippy::cast_precision_loss)]
            let n = room.outline.len() as f64;
            let centre = [
                room.outline.iter().map(|p| p[0]).sum::<f64>() / n,
                room.outline.iter().map(|p| p[1]).sum::<f64>() / n,
            ];
            found.push(if inside(&room.outline, centre) {
                centre
            } else {
                room.outline[0]
            });
        }
        let stride = found.len().div_ceil(MAX_POINTS).max(1);
        found
            .into_iter()
            .step_by(stride)
            .map(|[x, y]| Spot {
                storey: room.storey,
                x,
                y,
                z,
            })
            .collect()
    }

    /// Where a radio stands when only its room is known: the room's point nearest its middle,
    /// at [`RADIO_AT`].
    pub fn middle(&self, room: usize) -> Option<Spot> {
        self.middle_of(&self.points(room))
    }

    /// Of a room's points (`points`), the one nearest their middle, at [`RADIO_AT`].
    pub fn middle_of(&self, points: &[Spot]) -> Option<Spot> {
        #[allow(clippy::cast_precision_loss)]
        let n = points.len().max(1) as f64;
        let cx = points.iter().map(|p| p.x).sum::<f64>() / n;
        let cy = points.iter().map(|p| p.y).sum::<f64>() / n;
        let mut best: Option<&Spot> = None;
        for p in points {
            if best.is_none_or(|b| (p.x - cx).hypot(p.y - cy) < (b.x - cx).hypot(b.y - cy)) {
                best = Some(p);
            }
        }
        let best = best?;
        Some(Spot {
            z: self.elevations.get(best.storey).copied().unwrap_or(0.0) + RADIO_AT,
            ..*best
        })
    }

    /// The walls between two places, counted on the plan of `a`'s storey.
    ///
    /// Each change of room along the line is a wall; a side left open is none, a door in the way
    /// less than one. A line out of the home and back in crosses two façades; a gap between two
    /// rooms no wider than a wall is the wall between them.
    pub fn walls(&self, a: &Spot, b: &Spot) -> f64 {
        let storey = a.storey;
        let (pa, pb) = ([a.x, a.y], [b.x, b.y]);
        let length = (b.x - a.x).hypot(b.y - a.y);
        if length < 1e-6 {
            return 0.0;
        }
        // Where the line crosses a side of a room: the room changes there, nowhere else.
        let mut cuts = vec![0.0, 1.0];
        for room in &self.rooms {
            if room.storey != storey || !room.may_cross(pa, pb) {
                continue;
            }
            let n = room.outline.len();
            for k in 0..n {
                if let Some(t) = crossing(pa, pb, room.outline[(k + n - 1) % n], room.outline[k]) {
                    cuts.push(rounded(t));
                }
            }
        }
        cuts.sort_by(f64::total_cmp);
        cuts.dedup();
        let at = |t: f64| [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
        let mut runs: Vec<(Option<usize>, f64, f64)> = Vec::new();
        for pair in cuts.windows(2) {
            let (t0, t1) = (pair[0], pair[1]);
            let room = self.room_at(storey, at((t0 + t1) / 2.0));
            match runs.last_mut() {
                Some(last) if last.0 == room => last.2 = t1,
                _ => runs.push((room, t0, t1)),
            }
        }
        let mut total = 0.0;
        let mut i = 0;
        while i + 1 < runs.len() {
            let (here, _, end) = runs[i];
            let (there, start, gap_end) = runs[i + 1];
            if there.is_none()
                && here.is_some()
                && i + 2 < runs.len()
                && (gap_end - start) * length <= WALL_GAP
            {
                let beyond = runs[i + 2].0;
                total += self.wall(storey, here, beyond, at((start + gap_end) / 2.0));
                i += 2;
                continue;
            }
            total += if here.is_none() || there.is_none() {
                1.0
            } else {
                self.wall(storey, here, there, at(end))
            };
            i += 1;
        }
        total
    }

    fn wall(&self, storey: usize, a: Option<usize>, b: Option<usize>, at: Point) -> f64 {
        if let (Some(a), Some(b)) = (a, b)
            && a != b
            && self.open.contains(&(a.min(b), a.max(b)))
        {
            return 0.0;
        }
        let near_door = self
            .doors
            .get(storey)
            .into_iter()
            .flatten()
            .any(|&(p, q)| segment_distance(at, p, q) <= DOOR_NEAR);
        if near_door { DOOR_WALL } else { 1.0 }
    }

    /// The floors between two places' storeys.
    pub fn floors(&self, a: &Spot, b: &Spot) -> usize {
        a.storey.abs_diff(b.storey)
    }

    /// The index of a storey by its id.
    pub fn storey_index(&self, id: &str) -> Option<usize> {
        self.storey_ids.iter().position(|s| s == id)
    }
}
