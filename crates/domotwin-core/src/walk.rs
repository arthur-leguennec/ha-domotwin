//! Walking through a storey at eye level (`DECISIONS.md`, D-029): where a walker can stand,
//! without going through a wall or a window, through the doors from one room to the next, and the
//! way from one room to another.
//!
//! The walls are the bands the scene draws (`geometry::walls`), cut where a door is, and the free
//! partitions; a walker is a circle of [`RADIUS`] on the floor. Doors and the open sides between
//! two rooms are the ways through. Furniture is not in the way.

use std::collections::BTreeSet;

use crate::edit::Footprint;
use crate::geometry::polygon::{
    P2, label_point, point_in_polygon, segment_distance, segments_meet,
};
use crate::geometry::walls::{
    WallLayout, free_wall_quad, opening_axes, openings_on_side, segment_quad, side_segments,
    wall_openings,
};
use crate::plan::{Element, Plan};

/// How far from the walls a walker keeps (cm): about half a body.
pub const RADIUS: f64 = 20.0;
/// Height of the eyes above the floor (cm).
pub const EYE_HEIGHT: f64 = 160.0;
/// The length of the steps a move is checked by (cm).
const STEP: f64 = 4.0;
/// How far into a room the way through a door goes (cm).
const THROUGH: f64 = 45.0;
/// How far a look is followed to find the widest view (cm), by steps of [`VIEW_STEP`].
const VIEW_RANGE: f64 = 1500.0;
const VIEW_STEP: f64 = 16.0;

/// A way between two rooms (a door, or an open side): its middle, the unit normal to its wall,
/// and the room on each side (along the normal, then against it).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Door {
    middle: P2,
    normal: P2,
    rooms: [Option<usize>; 2],
}

/// How thick the wall along the sides of a closed room is (cm).
const CLOSED_WAY: f64 = 12.0;

/// Where a walker can go on a storey.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Floor {
    /// The pieces of wall, each a convex quadrilateral, with its bounds.
    walls: Vec<([P2; 4], [P2; 2])>,
    /// The rooms' outlines, and their ids.
    rooms: Vec<Vec<P2>>,
    room_ids: Vec<String>,
    doors: Vec<Door>,
    /// The pieces standing on the floor: not in a walker's way (D-029), but where nobody is
    /// drawn standing (D-034).
    pieces: Vec<Footprint>,
    /// The rooms drawn closed (D-039), by index: no way in, nowhere to go or stand.
    closed: BTreeSet<usize>,
}

/// Pieces whose underside is lower than this stand in the way of someone standing (cm)…
const PIECE_BELOW: f64 = 120.0;
/// …unless thinner than this (a rug).
const PIECE_THICKER: f64 = 8.0;

impl Floor {
    /// The walls and doors of a plan, from its wall layout.
    pub fn new(plan: &Plan, layout: &WallLayout) -> Self {
        let openings = wall_openings(plan);
        let mut walls = Vec::new();
        let mut add = |quad: [P2; 4]| add_wall(&mut walls, quad);
        for room in &layout.rooms {
            for (i, bands) in room.sides.iter().enumerate() {
                let Some(bands) = bands else { continue };
                let (a, b) = room.side(i);
                let len = (b[0] - a[0]).hypot(b[1] - a[1]);
                if len <= 1e-9 {
                    continue;
                }
                let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
                let n = room.normal(i);
                let on_side = openings_on_side(a, b, &openings);
                for band in bands {
                    for (s0, s1, opening) in side_segments(band.t0 * len, band.t1 * len, &on_side) {
                        // A door is the way through; a window is a wall to a walker.
                        if opening.is_some_and(|o| o.door) {
                            continue;
                        }
                        let at = |s: f64, o: f64| {
                            [a[0] + u[0] * s + n[0] * o, a[1] + u[1] * s + n[1] * o]
                        };
                        add([
                            at(s0, band.o0),
                            at(s1, band.o0),
                            at(s1, band.o1),
                            at(s0, band.o1),
                        ]);
                    }
                }
            }
            for corner in &room.corners {
                add(corner.quad);
            }
        }
        for element in &plan.elements {
            if let Element::Wall(wall) = element
                && let Some((quad, _)) = free_wall_quad(wall)
            {
                add(quad);
            }
        }
        let rooms: Vec<Vec<P2>> = layout.rooms.iter().map(|r| r.points.clone()).collect();
        let room_ids = layout
            .rooms
            .iter()
            .map(|r| {
                plan.elements
                    .get(r.element)
                    .map_or("", |e| e.id())
                    .to_owned()
            })
            .collect();
        let room_at = |p: P2| rooms.iter().position(|r| point_in_polygon(p, r, false));
        let doors = openings
            .iter()
            .filter(|(_, door)| *door)
            .map(|(o, _)| {
                let (u, n) = opening_axes(o.angle);
                let middle = [o.x + u[0] * o.w / 2.0, o.y + u[1] * o.w / 2.0];
                let side = |k: f64| room_at([middle[0] + n[0] * k, middle[1] + n[1] * k]);
                Door {
                    middle,
                    normal: n,
                    rooms: [side(THROUGH), side(-THROUGH)],
                }
            })
            .collect();
        let pieces = plan
            .elements
            .iter()
            .filter_map(|e| match e {
                Element::Furniture(f) if f.elevation < PIECE_BELOW && f.z >= PIECE_THICKER => {
                    Some(Footprint::of(f))
                }
                _ => None,
            })
            .collect();
        let mut floor = Self {
            walls,
            rooms,
            room_ids,
            doors,
            pieces,
            closed: BTreeSet::new(),
        };
        // An open side between two rooms is a way through, where a walker fits.
        let mut open = Vec::new();
        for room in &layout.rooms {
            for (i, bands) in room.sides.iter().enumerate() {
                if bands.is_some() {
                    continue;
                }
                let (a, b) = room.side(i);
                let middle = [f64::midpoint(a[0], b[0]), f64::midpoint(a[1], b[1])];
                let n = room.normal(i);
                let side = |k: f64| floor.room_at([middle[0] + n[0] * k, middle[1] + n[1] * k]);
                if let rooms @ [Some(x), Some(y)] = [side(THROUGH), side(-THROUGH)]
                    && x != y
                    && floor.free(middle)
                {
                    open.push(Door {
                        middle,
                        normal: n,
                        rooms,
                    });
                }
            }
        }
        floor.doors.extend(open);
        floor
    }

    /// Closes the rooms `ids` (D-039): a wall along all their sides (across their doors and
    /// open sides, whatever is near them), and nowhere to go or stand in them.
    pub fn close(&mut self, ids: &BTreeSet<String>) {
        let rooms: Vec<usize> = self
            .room_ids
            .iter()
            .enumerate()
            .filter(|(k, id)| ids.contains(*id) && !self.closed.contains(k))
            .map(|(k, _)| k)
            .collect();
        for &k in &rooms {
            let outline = &self.rooms[k];
            for i in 0..outline.len() {
                let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
                if let Some((quad, _)) = segment_quad(a, b, CLOSED_WAY) {
                    add_wall(&mut self.walls, quad);
                }
            }
            self.closed.insert(k);
        }
        let closed = &self.closed;
        self.doors
            .retain(|d| !d.rooms.iter().flatten().any(|r| closed.contains(r)));
    }

    /// Whether `to` is in sight from `from` on the floor: no wall between them.
    pub fn seen(&self, from: P2, to: P2) -> bool {
        let lo = [from[0].min(to[0]), from[1].min(to[1])];
        let hi = [from[0].max(to[0]), from[1].max(to[1])];
        !self.walls.iter().any(|(quad, [qlo, qhi])| {
            qlo[0] <= hi[0]
                && qhi[0] >= lo[0]
                && qlo[1] <= hi[1]
                && qhi[1] >= lo[1]
                && (point_in_polygon(to, quad, false)
                    || (0..4).any(|k| segments_meet(from, to, quad[k], quad[(k + 1) % 4], true)))
        })
    }

    /// Whether a walker can stand at `p`: no wall within [`RADIUS`].
    pub fn free(&self, p: P2) -> bool {
        self.clearance(p) >= RADIUS
    }

    /// How far `p` is from the nearest wall (cm; 0 inside one, infinite without walls).
    fn clearance(&self, p: P2) -> f64 {
        let mut best = f64::INFINITY;
        for (quad, [lo, hi]) in &self.walls {
            // Walls farther than the walker's reach by their bounds are not looked at closely.
            let dx = (lo[0] - p[0]).max(p[0] - hi[0]).max(0.0);
            let dy = (lo[1] - p[1]).max(p[1] - hi[1]).max(0.0);
            if dx.hypot(dy) >= best.min(RADIUS * 2.0) {
                continue;
            }
            let d = if point_in_polygon(p, quad, false) {
                0.0
            } else {
                (0..4)
                    .map(|k| segment_distance(p, quad[k], quad[(k + 1) % 4]))
                    .fold(f64::INFINITY, f64::min)
            };
            best = best.min(d);
        }
        best
    }

    /// How far a look from `at` goes along `d` before a wall comes within a walker's reach (cm,
    /// up to [`VIEW_RANGE`]); from close to a wall, as long as it does not get closer.
    fn sight(&self, at: P2, d: P2) -> f64 {
        let (mut far, mut room) = (0.0, self.clearance(at));
        while far < VIEW_RANGE {
            let next = (far + VIEW_STEP).min(VIEW_RANGE);
            let c = self.clearance([at[0] + d[0] * next, at[1] + d[1] * next]);
            if c < RADIUS && c < room {
                break;
            }
            (far, room) = (next, c);
        }
        far
    }

    /// The farthest point a walker gets to from `from` towards `to` in a straight line. A walker
    /// already too close to a wall may move as long as it does not get closer.
    pub fn reach(&self, from: P2, to: P2) -> P2 {
        let len = (to[0] - from[0]).hypot(to[1] - from[1]);
        if !len.is_finite() {
            return from;
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let steps = ((len / STEP).ceil() as usize).max(1);
        let mut last = from;
        let mut room = self.clearance(from);
        #[allow(clippy::cast_precision_loss)]
        for k in 1..=steps {
            let t = k as f64 / steps as f64;
            let p = [
                from[0] + (to[0] - from[0]) * t,
                from[1] + (to[1] - from[1]) * t,
            ];
            let c = self.clearance(p);
            if c < RADIUS && c < room {
                return last;
            }
            (last, room) = (p, c);
        }
        to
    }

    /// A step from `from` by `delta`, sliding along a wall in the way: the whole step, else along
    /// x then y, or y then x, whichever goes farther.
    pub fn slide(&self, from: P2, delta: P2) -> P2 {
        let whole = [from[0] + delta[0], from[1] + delta[1]];
        if self.reach(from, whole) == whole {
            return whole;
        }
        let x_first = {
            let p = self.reach(from, [whole[0], from[1]]);
            self.reach(p, [p[0], whole[1]])
        };
        let y_first = {
            let p = self.reach(from, [from[0], whole[1]]);
            self.reach(p, [whole[0], p[1]])
        };
        let gained = |p: P2| (p[0] - from[0]).hypot(p[1] - from[1]);
        if gained(y_first) > gained(x_first) {
            y_first
        } else {
            x_first
        }
    }

    /// The room `p` is in.
    pub fn room_at(&self, p: P2) -> Option<usize> {
        self.rooms
            .iter()
            .position(|r| point_in_polygon(p, r, false))
    }

    /// The way from `from` to `to`: through the doors between their rooms (the fewest), then
    /// straight to `to`; just `to` when they are in the same room, outside or not linked.
    pub fn path(&self, from: P2, to: P2) -> Vec<P2> {
        let (Some(start), Some(end)) = (self.room_at(from), self.room_at(to)) else {
            return vec![to];
        };
        if start == end {
            return vec![to];
        }
        // Breadth first over the rooms, through the doors.
        let mut came: Vec<Option<(usize, usize)>> = vec![None; self.rooms.len()];
        let mut seen = vec![false; self.rooms.len()];
        seen[start] = true;
        let mut queue = std::collections::VecDeque::from([start]);
        while let Some(room) = queue.pop_front() {
            if room == end {
                break;
            }
            for (d, door) in self.doors.iter().enumerate() {
                let [Some(a), Some(b)] = door.rooms else {
                    continue;
                };
                let next = if a == room {
                    b
                } else if b == room {
                    a
                } else {
                    continue;
                };
                if !seen[next] {
                    seen[next] = true;
                    came[next] = Some((room, d));
                    queue.push_back(next);
                }
            }
        }
        if !seen[end] {
            return vec![to];
        }
        let mut doors = Vec::new();
        let mut room = end;
        while let Some((before, door)) = came[room] {
            doors.push((before, door));
            room = before;
        }
        doors.reverse();
        let mut path = Vec::with_capacity(doors.len() * 2 + 1);
        for (before, d) in doors {
            let door = self.doors[d];
            // The side of the door the walker comes from, then the other.
            let k = if door.rooms[0] == Some(before) {
                THROUGH
            } else {
                -THROUGH
            };
            let [x, y] = door.middle;
            let [nx, ny] = door.normal;
            path.push([x + nx * k, y + ny * k]);
            path.push([x - nx * k, y - ny * k]);
        }
        path.push(to);
        path
    }

    /// The way to look from `at` that sees the most (among 16): the farthest on average across
    /// a third of a turn around it, so an open side of the room wins over a long diagonal into a
    /// corner; the nearest to `towards` (a direction on the floor) when several see about as much.
    pub fn widest_view(&self, at: P2, towards: P2) -> P2 {
        const RAYS: usize = 16;
        let seen: Vec<f64> = (0..RAYS).map(|k| self.sight(at, ray(k, RAYS))).collect();
        let mut best = (towards, f64::NEG_INFINITY);
        for k in 0..RAYS {
            let d = ray(k, RAYS);
            // This way and its two neighbours on each side (a field of view of about 110°).
            let open: f64 = (0..5).map(|j| seen[(k + RAYS + j - 2) % RAYS]).sum::<f64>() / 5.0;
            // A little preference for the way the camera looked, so that walking in keeps it.
            let score = open + (d[0] * towards[0] + d[1] * towards[1]) * 60.0;
            if score > best.1 {
                best = (d, score);
            }
        }
        best.0
    }

    /// A point well inside the room `id`, where a walker going there stops; none for a room
    /// closed.
    pub fn room_spot(&self, id: &str) -> Option<P2> {
        let k = self.room_ids.iter().position(|r| r == id)?;
        (!self.closed.contains(&k)).then(|| label_point(&self.rooms[k]))
    }

    /// Whether `p` is in the room `id`.
    pub fn in_room(&self, id: &str, p: P2) -> bool {
        self.room_ids
            .iter()
            .position(|r| r == id)
            .is_some_and(|k| point_in_polygon(p, &self.rooms[k], false))
    }

    /// Whether someone can be drawn standing at `p` in the room `id`: in it, clear of its walls,
    /// and at least `margin` cm from every piece standing on the floor.
    pub fn standing_room(&self, id: &str, p: P2, margin: f64) -> bool {
        let clear = |f: &Footprint| {
            !Footprint {
                half: [f.half[0] + margin, f.half[1] + margin],
                ..*f
            }
            .contains(p)
        };
        self.room_ids.iter().position(|r| r == id).is_some_and(|k| {
            point_in_polygon(p, &self.rooms[k], false)
                && self.clearance(p) >= RADIUS + margin / 2.0
                && self.pieces.iter().all(clear)
        })
    }

    /// Where to stand when walking starts near `near`: there when it is free in a room, else in
    /// the middle of the room it is in, or of the room nearest it.
    pub fn start(&self, near: P2) -> P2 {
        let open = self.room_at(near).filter(|r| !self.closed.contains(r));
        if open.is_some() && self.free(near) {
            return near;
        }
        let distance = |p: P2| (p[0] - near[0]).hypot(p[1] - near[1]);
        let room = open.or_else(|| {
            (0..self.rooms.len())
                .filter(|r| !self.closed.contains(r))
                .min_by(|a, b| {
                    let da = distance(label_point(&self.rooms[*a]));
                    let db = distance(label_point(&self.rooms[*b]));
                    da.total_cmp(&db)
                })
        });
        room.map_or(near, |r| label_point(&self.rooms[r]))
    }
}

/// Adds a piece of wall (a convex quadrilateral) with its bounds, when its corners are finite.
fn add_wall(walls: &mut Vec<([P2; 4], [P2; 2])>, quad: [P2; 4]) {
    let mut bounds = [[f64::INFINITY; 2], [f64::NEG_INFINITY; 2]];
    for p in quad {
        for k in 0..2 {
            bounds[0][k] = bounds[0][k].min(p[k]);
            bounds[1][k] = bounds[1][k].max(p[k]);
        }
    }
    if bounds[0].iter().chain(&bounds[1]).all(|v| v.is_finite()) {
        walls.push((quad, bounds));
    }
}

/// Direction `k` of `n` around a turn.
fn ray(k: usize, n: usize) -> P2 {
    #[allow(clippy::cast_precision_loss)]
    let angle = k as f64 * std::f64::consts::TAU / n as f64;
    [angle.cos(), angle.sin()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::read_plan;

    /// Three rooms in a row, 300 × 300: a door from A to B, none from B to C; a window in A.
    fn floor() -> Floor {
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]]},
                {"id":"b","name":"B","outline":[[300,0],[600,0],[600,300],[300,300]]},
                {"id":"c","name":"C","outline":[[600,0],[900,0],[900,300],[600,300]]}
            ],"doors":[
                {"id":"d","name":"D","from":[300,100],"to":[300,190]}
            ],"windows":[
                {"id":"w","name":"W","from":[100,0],"to":[200,0]}
            ]}"#,
        )
        .unwrap();
        Floor::new(&plan, &WallLayout::new(&plan))
    }

    #[test]
    fn walls_stop_a_walker_and_doors_let_it_through() {
        let floor = floor();
        assert!(floor.free([150.0, 150.0]));
        assert!(!floor.free([300.0, 250.0]));
        // Through the door from A to B.
        let to = [450.0, 145.0];
        assert_eq!(floor.reach([150.0, 145.0], to), to);
        // Not through the partition below the door: stopped a body's width before it.
        let stop = floor.reach([150.0, 250.0], [450.0, 250.0]);
        assert!(stop[0] < 300.0 - RADIUS && stop[0] > 250.0, "{stop:?}");
        // Not through the window either.
        let out = floor.reach([150.0, 150.0], [150.0, -100.0]);
        assert!(out[1] > 0.0, "{out:?}");
        // Sliding along the partition.
        let slid = floor.slide([260.0, 250.0], [20.0, 20.0]);
        assert!(
            (slid[1] - 270.0).abs() < 1e-9 && slid[0] <= 280.0,
            "{slid:?}"
        );
    }

    #[test]
    fn partitions_stop_walkers_open_sides_let_them_through_and_walls_hide_the_floor() {
        // A and B open onto each other; a door from B to C; a partition across A.
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]],"sides":[null,{"open":true},null,null]},
                {"id":"b","name":"B","outline":[[300,0],[600,0],[600,300],[300,300]],"sides":[null,null,null,{"open":true}]},
                {"id":"c","name":"C","outline":[[600,0],[900,0],[900,300],[600,300]]}
            ],"partitions":[
                {"id":"p","name":"P","from":[100,0],"to":[100,200],"thickness":10}
            ],"doors":[
                {"id":"d","name":"D","from":[600,100],"to":[600,190]}
            ]}"#,
        )
        .unwrap();
        let floor = Floor::new(&plan, &WallLayout::new(&plan));
        // The partition stops a walker a body's width before it; below its end, the way is free.
        let stop = floor.reach([50.0, 100.0], [250.0, 100.0]);
        assert!(stop[0] < 95.0 - RADIUS + 1.0 && stop[0] > 50.0, "{stop:?}");
        assert_eq!(floor.reach([50.0, 260.0], [250.0, 260.0]), [250.0, 260.0]);
        // From A to C: across the open side into B, then through the door.
        let path = floor.path([200.0, 150.0], [750.0, 150.0]);
        assert_eq!(path.len(), 5, "{path:?}");
        let mut at = [200.0, 150.0];
        for p in &path {
            at = floor.reach(at, *p);
        }
        assert_eq!(at, [750.0, 150.0]);
        // The floor beyond a wall is not in sight; through the door it is.
        assert!(!floor.seen([450.0, 250.0], [750.0, 250.0]));
        assert!(floor.seen([450.0, 145.0], [750.0, 145.0]));
        assert!(!floor.seen([50.0, 100.0], [250.0, 100.0]));
    }

    #[test]
    fn a_closed_room_has_no_way_in_and_nowhere_to_go() {
        // A and B open onto each other, a door from B to C; C closed, then B.
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]],"sides":[null,{"open":true},null,null]},
                {"id":"b","name":"B","outline":[[300,0],[600,0],[600,300],[300,300]],"sides":[null,null,null,{"open":true}]},
                {"id":"c","name":"C","outline":[[600,0],[900,0],[900,300],[600,300]]}
            ],"doors":[
                {"id":"d","name":"D","from":[600,100],"to":[600,190]}
            ]}"#,
        )
        .unwrap();
        let mut floor = Floor::new(&plan, &WallLayout::new(&plan));
        assert_eq!(floor.reach([450.0, 145.0], [750.0, 145.0]), [750.0, 145.0]);
        floor.close(&BTreeSet::from(["c".to_owned()]));
        // The door is a wall now: stopped before it, no way found, no spot to go to.
        let stop = floor.reach([450.0, 145.0], [750.0, 145.0]);
        assert!(stop[0] < 600.0 - RADIUS, "{stop:?}");
        assert_eq!(
            floor.path([450.0, 145.0], [750.0, 145.0]),
            vec![[750.0, 145.0]]
        );
        assert!(floor.room_spot("c").is_none());
        assert!(floor.room_spot("b").is_some());
        // Starting inside it: the middle of the nearest open room.
        let start = floor.start([750.0, 150.0]);
        assert_eq!(floor.room_at(start), Some(1), "{start:?}");
        // An open side closes too.
        floor.close(&BTreeSet::from(["b".to_owned()]));
        let stop = floor.reach([150.0, 150.0], [450.0, 150.0]);
        assert!(stop[0] < 300.0, "{stop:?}");
        assert_eq!(floor.room_at(floor.start([450.0, 150.0])), Some(0));
    }

    #[test]
    fn closing_a_room_closes_only_its_own_sides() {
        // A long room A open along its bottom side onto B and C, side by side; C closed.
        let plan = read_plan(
            br#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[600,0],[600,300],[0,300]],"sides":[null,null,{"open":true},null]},
                {"id":"b","name":"B","outline":[[0,300],[300,300],[300,600],[0,600]],"sides":[{"open":true},null,null,null]},
                {"id":"c","name":"C","outline":[[300,300],[600,300],[600,600],[300,600]],"sides":[{"open":true},null,null,null]}
            ]}"#,
        )
        .unwrap();
        let mut floor = Floor::new(&plan, &WallLayout::new(&plan));
        floor.close(&BTreeSet::from(["c".to_owned()]));
        // From A into B, still; not into C.
        assert_eq!(floor.reach([150.0, 150.0], [150.0, 450.0]), [150.0, 450.0]);
        let stop = floor.reach([450.0, 150.0], [450.0, 450.0]);
        assert!(stop[1] < 300.0, "{stop:?}");
        // Closing again changes nothing.
        let walls = floor.walls.len();
        floor.close(&BTreeSet::from(["c".to_owned()]));
        assert_eq!(floor.walls.len(), walls);
    }

    #[test]
    fn a_room_s_spot_is_inside_it() {
        let floor = floor();
        let spot = floor.room_spot("b").unwrap();
        assert_eq!(floor.room_at(spot), Some(1));
        assert!(floor.room_spot("nowhere").is_none());
    }

    #[test]
    fn the_way_goes_through_the_doors() {
        let floor = floor();
        assert_eq!(floor.room_at([450.0, 50.0]), Some(1));
        // From A to the far corner of B: through the door, then there.
        let path = floor.path([50.0, 250.0], [550.0, 250.0]);
        assert_eq!(path.len(), 3);
        assert!(path[0][0] < 300.0 && path[1][0] > 300.0, "{path:?}");
        assert!((path[0][1] - 145.0).abs() < 1.0);
        // Each leg is free.
        let mut at = [50.0, 250.0];
        for p in &path {
            at = floor.reach(at, *p);
        }
        assert_eq!(at, [550.0, 250.0]);
        // C has no door: straight, and the wall stops the walker.
        assert_eq!(
            floor.path([450.0, 150.0], [750.0, 150.0]),
            vec![[750.0, 150.0]]
        );
        // From the middle of A, the widest view is towards the door to B (east).
        let east = floor.widest_view([150.0, 145.0], [0.0, -1.0]);
        assert!(east[0] > 0.6, "{east:?}");
        // Starting in a wall: the middle of the nearest room.
        let start = floor.start([300.0, 250.0]);
        assert!(floor.free(start) && floor.room_at(start).is_some());
        assert_eq!(floor.start([150.0, 150.0]), [150.0, 150.0]);
    }
}
