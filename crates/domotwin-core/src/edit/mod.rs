//! Edit mode without a GPU: the footprints of pieces, snapping while moving (onto wall faces, onto
//! the edges of other pieces, onto a grid) with the guides to draw, distances to the nearest walls,
//! rotation in steps, stacking on top surfaces with the pieces carried along, collision hints, and
//! the history of edits. Plan coordinates: cm, y down, angles clockwise in degrees.

mod session;

pub use session::{Session, indices};

use crate::geometry::polygon::P2;
use crate::geometry::walls::WallLayout;
use crate::plan::{Furniture, Kind};

/// Rotation step (degrees).
pub const ROTATION_STEP: f64 = 15.0;
/// Grid (cm) for pieces square to the plan that snap onto nothing else.
pub const GRID: f64 = 5.0;
/// Edits kept for undo.
pub const HISTORY: usize = 100;
/// Farthest wall a distance guide reaches (cm).
const MAX_DISTANCE: f64 = 1000.0;
/// Pieces resting on another within this height (cm) are carried with it.
const RESTING: f64 = 1.5;

/// A piece seen from above, with the heights of its underside and top.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Footprint {
    pub centre: P2,
    /// Half width (local x) and half depth (local y).
    pub half: [f64; 2],
    /// Degrees, clockwise on the plan.
    pub angle: f64,
    pub bottom: f64,
    pub top: f64,
}

fn dot(a: P2, b: P2) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn add(a: P2, b: P2, k: f64) -> P2 {
    [a[0] + b[0] * k, a[1] + b[1] * k]
}

impl Footprint {
    pub fn of(f: &Furniture) -> Self {
        Footprint {
            centre: [f.x + f.w / 2.0, f.y + f.h / 2.0],
            half: [f.w / 2.0, f.h / 2.0],
            angle: f.angle,
            bottom: f.elevation,
            top: f.elevation + f.z,
        }
    }

    /// Local x and y on the plan.
    pub fn axes(&self) -> (P2, P2) {
        let (s, c) = self.angle.to_radians().sin_cos();
        ([c, s], [-s, c])
    }

    pub fn corners(&self) -> [P2; 4] {
        let (u, v) = self.axes();
        let [hx, hy] = self.half;
        let at = |a: f64, b: f64| add(add(self.centre, u, a), v, b);
        [at(-hx, -hy), at(hx, -hy), at(hx, hy), at(-hx, hy)]
    }

    pub fn contains(&self, p: P2) -> bool {
        let (u, v) = self.axes();
        let d = [p[0] - self.centre[0], p[1] - self.centre[1]];
        dot(d, u).abs() <= self.half[0] + 1e-6 && dot(d, v).abs() <= self.half[1] + 1e-6
    }

    pub fn area(&self) -> f64 {
        4.0 * self.half[0] * self.half[1]
    }

    /// The same box, smaller by `d` on every side (touching is not overlapping).
    fn shrunk(&self, d: f64) -> Footprint {
        Footprint {
            half: [(self.half[0] - d).max(0.0), (self.half[1] - d).max(0.0)],
            ..*self
        }
    }

    /// Whether `other` rests on this one's top surface.
    fn carries(&self, other: &Footprint) -> bool {
        (other.bottom - self.top).abs() < RESTING && self.contains(other.centre)
    }
}

/// Whether two convex polygons overlap (separating axis test).
fn overlap(a: &[P2], b: &[P2]) -> bool {
    for polygon in [a, b] {
        let n = polygon.len();
        for i in 0..n {
            let (p, q) = (polygon[i], polygon[(i + 1) % n]);
            let axis = [q[1] - p[1], p[0] - q[0]];
            let project = |points: &[P2]| {
                points
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
                        let d = dot(*x, axis);
                        (lo.min(d), hi.max(d))
                    })
            };
            let (a0, a1) = project(a);
            let (b0, b1) = project(b);
            if a1 <= b0 || b1 <= a0 {
                return false;
            }
        }
    }
    true
}

/// The faces of the walls turned towards the rooms: what pieces snap onto.
pub fn wall_faces(walls: &WallLayout) -> Vec<(P2, P2)> {
    walls
        .rooms
        .iter()
        .flat_map(|room| room.sides.iter().flatten().flatten())
        .map(|band| (band.quad[0], band.quad[1]))
        .collect()
}

/// The walls as quadrilaterals (bands and filled corners): what pieces collide with.
pub fn wall_blocks(walls: &WallLayout) -> Vec<[P2; 4]> {
    walls
        .rooms
        .iter()
        .flat_map(|room| {
            let bands = room.sides.iter().flatten().flatten().map(|band| band.quad);
            bands.chain(room.corners.iter().map(|corner| corner.quad))
        })
        .collect()
}

/// What the view draws while a piece moves.
#[derive(Debug, Clone, PartialEq)]
pub enum Guide {
    /// A face or an edge the piece snapped onto.
    Line { a: P2, b: P2 },
    /// The free distance from a side of the piece to the wall it faces.
    Distance { a: P2, b: P2, cm: f64 },
}

/// Where a moving piece goes and what to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapped {
    pub centre: P2,
    pub guides: Vec<Guide>,
}

/// Moves a footprint to `centre`, then pulls it onto the wall faces and piece edges within
/// `reach` cm, separately along its two axes; along an axis with nothing to snap onto, a piece
/// square to the plan snaps onto the grid. Returns the centre and the guides (snapped lines,
/// distances to the walls on its four sides).
pub fn snap(
    fp: &Footprint,
    centre: P2,
    faces: &[(P2, P2)],
    others: &[Footprint],
    reach: f64,
) -> Snapped {
    let mut fp = Footprint { centre, ..*fp };
    let (u, v) = fp.axes();
    let mut lines: Vec<(P2, P2)> = faces.to_vec();
    for other in others {
        let c = other.corners();
        lines.extend((0..4).map(|i| (c[i], c[(i + 1) % 4])));
    }
    let mut guides = Vec::new();
    for k in 0..2 {
        let (dir, across) = if k == 0 { (u, v) } else { (v, u) };
        let (half, half_across) = (fp.half[k], fp.half[1 - k]);
        let mut best: Option<(f64, (P2, P2), f64)> = None;
        for &(a, b) in &lines {
            let d = [b[0] - a[0], b[1] - a[1]];
            let len = d[0].hypot(d[1]);
            if len < 1.0 || (dot(d, dir) / len).abs() > 0.0175 {
                continue;
            }
            // The segment must come near the piece along the other axis.
            let rel = |p: P2| dot([p[0] - fp.centre[0], p[1] - fp.centre[1]], across);
            let (s0, s1) = (rel(a).min(rel(b)), rel(a).max(rel(b)));
            if s1 < -half_across - 50.0 || s0 > half_across + 50.0 {
                continue;
            }
            let at = dot([a[0] - fp.centre[0], a[1] - fp.centre[1]], dir);
            for correction in [at - half, at + half] {
                if correction.abs() <= reach
                    && best.is_none_or(|(c, ..)| correction.abs() < c.abs())
                {
                    best = Some((correction, (a, b), at));
                }
            }
        }
        if let Some((correction, (a, b), _)) = best {
            fp.centre = add(fp.centre, dir, correction);
            guides.push(Guide::Line { a, b });
            continue;
        }
        // The grid, for a piece square to the plan.
        let square = (fp.angle / 90.0 - (fp.angle / 90.0).round()).abs() < 0.005;
        if square {
            let world = if dir[0].abs() > 0.5 { 0 } else { 1 };
            let extent = half * dir[world].abs() + half_across * across[world].abs();
            let low = fp.centre[world] - extent;
            fp.centre[world] = (low / GRID).round() * GRID + extent;
        }
    }
    // Distances to the walls on the four sides.
    for (dir, half) in [(u, fp.half[0]), (v, fp.half[1])] {
        for sign in [1.0, -1.0] {
            let d = [dir[0] * sign, dir[1] * sign];
            let from = add(fp.centre, d, half);
            if let Some(t) = ray(from, d, faces) {
                guides.push(Guide::Distance {
                    a: from,
                    b: add(from, d, t),
                    cm: t,
                });
            }
        }
    }
    Snapped {
        centre: fp.centre,
        guides,
    }
}

/// Distance from `from` along `d` to the nearest segment, if within `MAX_DISTANCE`.
fn ray(from: P2, d: P2, segments: &[(P2, P2)]) -> Option<f64> {
    let mut best: Option<f64> = None;
    for &(a, b) in segments {
        let e = [b[0] - a[0], b[1] - a[1]];
        let den = d[0] * e[1] - d[1] * e[0];
        if den.abs() < 1e-9 {
            continue;
        }
        let w = [a[0] - from[0], a[1] - from[1]];
        let t = (w[0] * e[1] - w[1] * e[0]) / den;
        let s = (w[0] * d[1] - w[1] * d[0]) / den;
        if t > 0.05 && (0.0..=1.0).contains(&s) && t <= MAX_DISTANCE && best.is_none_or(|b| t < b) {
            best = Some(t);
        }
    }
    best
}

/// An angle on the rotation step, 0–360.
pub fn snap_angle(angle: f64) -> f64 {
    ((angle / ROTATION_STEP).round() * ROTATION_STEP).rem_euclid(360.0)
}

/// Whether a kind has a top surface other pieces stand on.
pub fn can_support(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::CoffeeTable
            | Kind::DiningTable
            | Kind::RoundTable
            | Kind::Desk
            | Kind::Dresser
            | Kind::Nightstand
            | Kind::Counter
            | Kind::Console
            | Kind::Bookcase
            | Kind::OpenShelving
            | Kind::Shelf
            | Kind::GlazedBookcase
            | Kind::Chest
            | Kind::SideTable
            | Kind::Trolley
            | Kind::Vanity
            | Kind::ShoeCabinet
            | Kind::TallCabinet
            | Kind::Washer
            | Kind::Dryer
            | Kind::Fridge
    )
}

/// Whether a piece of `kind`, drawn from one of the user's models or not (`model`), is set on top
/// of a piece it is dropped over: small objects (lamps, plants, screens, printers), a dryer on a
/// washer, and the user's own models. A plain box, or a kind this version does not know, is not.
pub fn can_stack(kind: Kind, model: bool) -> bool {
    model
        || matches!(
            kind,
            Kind::Tv
                | Kind::Plant
                | Kind::TableLamp
                | Kind::Lantern
                | Kind::DeskLamp
                | Kind::Printer
                | Kind::Printer3d
                | Kind::Dryer
        )
}

/// The piece a moving one that stacks (see [`can_stack`]) would stand on: the highest supporting
/// piece (not `moving`) under its centre, at least half its area and below 2 m. Returns its index
/// and the height of its top; none for a piece that does not stack.
pub fn support_under(
    moving: &Footprint,
    stacks: bool,
    pieces: &[(Footprint, Kind)],
    skip: &[usize],
) -> Option<(usize, f64)> {
    if !stacks {
        return None;
    }
    pieces
        .iter()
        .enumerate()
        .filter(|(i, (fp, k))| {
            !skip.contains(i)
                && can_support(*k)
                && fp.contains(moving.centre)
                && fp.area() >= moving.area() * 0.5
                && fp.top <= 200.0
        })
        .max_by(|a, b| a.1.0.top.total_cmp(&b.1.0.top))
        .map(|(i, (fp, _))| (i, fp.top))
}

/// The pieces resting on `base`, and on those, and so on: they move with it.
pub fn carried(base: usize, pieces: &[Footprint]) -> Vec<usize> {
    let mut out = vec![base];
    let mut i = 0;
    while i < out.len() {
        let below = pieces[out[i]];
        for (j, fp) in pieces.iter().enumerate() {
            if !out.contains(&j) && below.carries(fp) {
                out.push(j);
            }
        }
        i += 1;
    }
    out.remove(0);
    out
}

/// The pieces in conflict: each of `moving` that overlaps another piece (at overlapping heights,
/// neither resting on the other) or a wall, and the pieces it overlaps. Soft pieces (hung, flat or
/// on the ceiling) never conflict; wall decorations do not conflict with walls.
pub fn collisions(pieces: &[(Footprint, Kind)], moving: &[usize], walls: &[[P2; 4]]) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    let flag = |i: usize, out: &mut Vec<usize>| {
        if !out.contains(&i) {
            out.push(i);
        }
    };
    for &i in moving {
        let Some((fi, ki)) = pieces.get(i) else {
            continue;
        };
        let info = ki.info();
        if info.flags.soft {
            continue;
        }
        let ci = fi.shrunk(1.0).corners();
        for (j, (fj, kj)) in pieces.iter().enumerate() {
            if j == i || kj.info().flags.soft {
                continue;
            }
            let heights = fi.bottom < fj.top - 1.0 && fj.bottom < fi.top - 1.0;
            let resting = fi.carries(fj) || fj.carries(fi);
            if heights && !resting && overlap(&ci, &fj.shrunk(1.0).corners()) {
                flag(i, &mut out);
                flag(j, &mut out);
            }
        }
        if !info.flags.wall_decor && walls.iter().any(|w| overlap(&ci, w)) {
            flag(i, &mut out);
        }
    }
    out.sort_unstable();
    out
}

/// Undo and redo over states of the edit (at most `HISTORY` back).
#[derive(Debug, Clone, PartialEq)]
pub struct History<T> {
    states: Vec<T>,
    cursor: usize,
}

impl<T: Clone + PartialEq> History<T> {
    pub fn new(initial: T) -> Self {
        History {
            states: vec![initial],
            cursor: 0,
        }
    }

    /// The state now.
    pub fn current(&self) -> &T {
        &self.states[self.cursor]
    }

    /// Records a new state (forgets what could be redone); a state equal to the current one is
    /// not recorded.
    pub fn push(&mut self, state: T) {
        if *self.current() == state {
            return;
        }
        self.states.truncate(self.cursor + 1);
        self.states.push(state);
        if self.states.len() > HISTORY + 1 {
            self.states.remove(0);
        }
        self.cursor = self.states.len() - 1;
    }

    pub fn can_undo(&self) -> bool {
        self.cursor > 0
    }

    pub fn can_redo(&self) -> bool {
        self.cursor + 1 < self.states.len()
    }

    pub fn undo(&mut self) -> Option<&T> {
        self.can_undo().then(|| {
            self.cursor -= 1;
            &self.states[self.cursor]
        })
    }

    pub fn redo(&mut self) -> Option<&T> {
        self.can_redo().then(|| {
            self.cursor += 1;
            &self.states[self.cursor]
        })
    }

    /// Forgets the current state (and what could be redone): back to the one before.
    pub fn drop_current(&mut self) {
        if self.cursor > 0 {
            self.states.truncate(self.cursor);
            self.cursor -= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(cx: f64, cy: f64, w: f64, h: f64, bottom: f64, z: f64) -> Footprint {
        Footprint {
            centre: [cx, cy],
            half: [w / 2.0, h / 2.0],
            angle: 0.0,
            bottom,
            top: bottom + z,
        }
    }

    // A 400 × 300 room: its four faces.
    const FACES: [(P2, P2); 4] = [
        ([0.0, 0.0], [400.0, 0.0]),
        ([400.0, 0.0], [400.0, 300.0]),
        ([400.0, 300.0], [0.0, 300.0]),
        ([0.0, 300.0], [0.0, 0.0]),
    ];

    #[test]
    fn snaps_onto_walls_then_the_grid() {
        let sofa = fp(0.0, 0.0, 200.0, 90.0, 0.0, 85.0);
        // 3 cm from the left wall, mid-height in the room.
        let snapped = snap(&sofa, [103.0, 151.0], &FACES, &[], 8.0);
        assert_eq!(snapped.centre[0], 100.0);
        // Nothing within reach vertically: the grid (top edge at 106 → 105).
        assert!(
            (snapped.centre[1] - 150.0).abs() < 1e-9,
            "{:?}",
            snapped.centre
        );
        let lines = snapped
            .guides
            .iter()
            .filter(|g| matches!(g, Guide::Line { .. }))
            .count();
        assert_eq!(lines, 1);
        // Distances: 0 to the left wall is not drawn (touching), right 200, top 105, bottom 105.
        let mut cm: Vec<f64> = snapped
            .guides
            .iter()
            .filter_map(|g| match g {
                Guide::Distance { cm, .. } => Some(*cm),
                Guide::Line { .. } => None,
            })
            .collect();
        cm.sort_by(f64::total_cmp);
        assert_eq!(cm, [105.0, 105.0, 200.0]);
    }

    #[test]
    fn snaps_onto_the_edges_of_pieces() {
        let table = fp(200.0, 150.0, 120.0, 80.0, 0.0, 75.0);
        let chair = fp(0.0, 0.0, 45.0, 45.0, 0.0, 85.0);
        // Its left edge 4 cm right of the table's right edge (260): pulled to touch it.
        let snapped = snap(&chair, [286.5, 152.0], &[], &[table], 6.0);
        assert!(
            (snapped.centre[0] - 282.5).abs() < 1e-9,
            "{:?}",
            snapped.centre
        );
    }

    #[test]
    fn turns_by_steps() {
        assert_eq!(snap_angle(7.0), 0.0);
        assert_eq!(snap_angle(8.0), 15.0);
        assert_eq!(snap_angle(-20.0), 345.0);
        assert_eq!(snap_angle(359.0), 0.0);
    }

    #[test]
    fn stacks_and_carries() {
        let table = (fp(200.0, 150.0, 120.0, 80.0, 0.0, 75.0), Kind::CoffeeTable);
        let lamp = (fp(210.0, 150.0, 30.0, 30.0, 75.0, 48.0), Kind::TableLamp);
        let bed = (fp(100.0, 100.0, 160.0, 200.0, 0.0, 55.0), Kind::Bed);
        let pieces = [table, lamp, bed];
        let moving = fp(195.0, 140.0, 30.0, 30.0, 0.0, 48.0);
        let lamp_stacks = can_stack(Kind::TableLamp, false);
        assert_eq!(
            support_under(&moving, lamp_stacks, &pieces, &[]),
            Some((0, 75.0))
        );
        // A bed is no support; a curtain never stands on anything.
        let over_bed = fp(100.0, 100.0, 30.0, 30.0, 0.0, 48.0);
        assert_eq!(support_under(&over_bed, lamp_stacks, &pieces, &[]), None);
        let curtain_stacks = can_stack(Kind::Curtain, false);
        assert_eq!(support_under(&moving, curtain_stacks, &pieces, &[]), None);
        // A user's model stands on a table; a plain box, or a kind this version does not know,
        // stays on the floor.
        assert!(can_stack(Kind::Box, true) && !can_stack(Kind::Box, false));
        let footprints: Vec<Footprint> = pieces.iter().map(|p| p.0).collect();
        assert_eq!(carried(0, &footprints), [1]);
        assert!(carried(2, &footprints).is_empty());
    }

    #[test]
    fn collides_with_pieces_and_walls() {
        let table = (fp(200.0, 150.0, 120.0, 80.0, 0.0, 75.0), Kind::CoffeeTable);
        let chair = (fp(250.0, 150.0, 45.0, 45.0, 0.0, 85.0), Kind::Chair);
        let lamp = (fp(210.0, 150.0, 30.0, 30.0, 75.0, 48.0), Kind::TableLamp);
        let pendant = (fp(200.0, 150.0, 47.0, 47.0, 150.0, 45.0), Kind::Pendant);
        let pieces = [table, chair, lamp, pendant];
        assert_eq!(collisions(&pieces, &[1], &[]), [0, 1]);
        // Resting on the table is no conflict; the pendant hangs above.
        assert!(collisions(&pieces, &[2], &[]).is_empty());
        assert!(collisions(&pieces, &[3], &[]).is_empty());
        let wall = [[255.0, 0.0], [265.0, 0.0], [265.0, 300.0], [255.0, 300.0]];
        assert_eq!(collisions(&pieces, &[1], &[wall]), [0, 1]);
        let alone = [(fp(250.0, 150.0, 45.0, 45.0, 0.0, 85.0), Kind::Chair)];
        assert_eq!(collisions(&alone, &[0], &[wall]), [0]);
    }

    #[test]
    fn undo_and_redo() {
        let mut history = History::new(0);
        history.push(1);
        history.push(1);
        history.push(2);
        assert_eq!(history.undo(), Some(&1));
        assert_eq!(history.undo(), Some(&0));
        assert_eq!(history.undo(), None);
        assert_eq!(history.redo(), Some(&1));
        history.push(5);
        assert!(!history.can_redo());
        for i in 0..200 {
            history.push(10 + i);
        }
        let mut back = 0;
        while history.undo().is_some() {
            back += 1;
        }
        assert_eq!(back, HISTORY);
    }
}
