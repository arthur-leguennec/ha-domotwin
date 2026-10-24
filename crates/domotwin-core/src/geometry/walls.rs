//! Implicit room walls, as described in `docs/plan-format.md`. Every closed side of a room polygon
//! gets a wall:
//!
//! - the parts of a side that face another room (probed up to ≈ 53 cm away) are **interior**
//!   partitions, `wallSettings.interior` thick, centred on the limit shared with the neighbour (or
//!   on the middle of a gap narrower than the wall);
//! - the rest of the side is **façade**, `wallSettings.exterior` thick, entirely outside the room;
//! - `edgeThickness[i]` overrides both for side `i`; sides listed in `openEdges` have no wall.
//!
//! A wall band is a quadrilateral along a side, between the offsets `o0` and `o1` measured along
//! the side's outward normal (`o0 < 0` reaches into the room). The 2D plan and the 3D scene draw
//! the same bands.

use crate::geometry::polygon::{P2, line_inside, outward_normal, point_in_polygon, signed_area2};
use crate::plan::{Element, FreeWall, Opening, Plan, Room, WallSettings};

/// Offsets (cm) of the lines parallel to a side probed for a neighbouring room.
const PROBES: [f64; 5] = [1.3, 6.1, 12.7, 25.3, 52.9];
/// Gaps wider than this (cm) are not bridged by an interior partition.
const MAX_GAP: f64 = 59.0;
/// Openings and room sides closer than this (cm) to a line are on it.
pub(crate) const ON_LINE: f64 = 6.0;

/// A portion `[t0, t1]` (0–1) of a side and what it faces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EdgeSegment {
    /// Start, 0–1 along the side.
    pub t0: f64,
    /// End, 0–1 along the side.
    pub t1: f64,
    /// Faces another room.
    pub inner: bool,
    /// Gap (cm) between the side and that room.
    pub gap: f64,
}

/// A wall band along a portion `[t0, t1]` of a side, between the offsets `o0` and `o1` (cm).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EdgeBand {
    /// Start, 0–1 along the side.
    pub t0: f64,
    /// End, 0–1 along the side.
    pub t1: f64,
    /// Interior partition (true) or façade wall (false).
    pub inner: bool,
    /// Offset of the face towards the room, along the outward normal (`< 0` reaches into it).
    pub o0: f64,
    /// Offset of the other face.
    pub o1: f64,
    /// Corners: side start and end at `o0`, then side end and start at `o1`.
    pub quad: [P2; 4],
}

impl EdgeBand {
    /// Wall thickness drawn, `o1 − o0`.
    pub fn depth(&self) -> f64 {
        self.o1 - self.o0
    }

    /// Whether the band reaches the start of its side, or (`at_end`) its end.
    pub fn reaches(&self, at_end: bool) -> bool {
        if at_end {
            self.t1 >= 1.0 - 1e-9
        } else {
            self.t0 <= 1e-9
        }
    }
}

/// The filled outer corner at a convex vertex between two façade bands.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Corner {
    /// Index of the vertex (the side that starts there).
    pub vertex: usize,
    /// Vertex, end of the first band, mitre point, start of the second band.
    pub quad: [P2; 4],
}

/// The walls of one room.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomWalls {
    /// Index of the room in `Plan::elements`.
    pub element: usize,
    /// The room polygon (cm).
    pub points: Vec<P2>,
    /// Bands of each side; `None` for an open side.
    pub sides: Vec<Option<Vec<EdgeBand>>>,
    /// Filled outer corners.
    pub corners: Vec<Corner>,
}

impl RoomWalls {
    /// Outward normal of side `i`.
    pub fn normal(&self, side: usize) -> P2 {
        outward_normal(&self.points, side)
    }

    /// Ends of side `i`.
    pub fn side(&self, side: usize) -> (P2, P2) {
        let n = self.points.len();
        (self.points[side % n], self.points[(side + 1) % n])
    }
}

/// The walls of every room of a plan, computed once.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WallLayout {
    /// One entry per room, in plan order.
    pub rooms: Vec<RoomWalls>,
    /// Default thicknesses.
    pub settings: WallSettings,
}

impl WallLayout {
    /// Computes the walls of every room.
    pub fn new(plan: &Plan) -> Self {
        let shapes: Vec<(usize, &Room, Vec<P2>)> = plan
            .elements
            .iter()
            .enumerate()
            .filter_map(|(index, e)| match e {
                Element::Room(room) => Some((index, room, room.points())),
                _ => None,
            })
            .collect();
        let settings = plan.wall_settings;
        let rooms = shapes
            .iter()
            .enumerate()
            .map(|(k, (element, room, points))| {
                let others: Vec<&[P2]> = shapes
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != k)
                    .map(|(_, (_, _, p))| p.as_slice())
                    .collect();
                let sides = (0..points.len())
                    .map(|i| {
                        (!room.is_open(i)).then(|| edge_bands(room, points, i, &others, &settings))
                    })
                    .collect::<Vec<_>>();
                let corners = corners(points, &sides);
                RoomWalls {
                    element: *element,
                    points: points.clone(),
                    sides,
                    corners,
                }
            })
            .collect();
        Self { rooms, settings }
    }

    /// Extent of the walls an opening sits in, as offsets `[lo, hi]` along the opening normal
    /// `n = (−sin a, cos a)` with a 0.8 cm margin, or `None` when no closed side lies within 6 cm
    /// of the opening line. Door and window frames take this depth.
    pub fn opening_wall_range(&self, opening: &Opening) -> Option<[f64; 2]> {
        let (u, n) = opening_axes(opening.angle);
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for room in &self.rooms {
            for (i, bands) in room.sides.iter().enumerate() {
                let Some(bands) = bands else { continue };
                let (p, q) = room.side(i);
                let da = (p[0] - opening.x) * n[0] + (p[1] - opening.y) * n[1];
                let db = (q[0] - opening.x) * n[0] + (q[1] - opening.y) * n[1];
                if da.abs() > ON_LINE || db.abs() > ON_LINE {
                    continue;
                }
                let ta = (p[0] - opening.x) * u[0] + (p[1] - opening.y) * u[1];
                let tb = (q[0] - opening.x) * u[0] + (q[1] - opening.y) * u[1];
                if ta.min(tb) > opening.w - 1.0 || ta.max(tb) < 1.0 {
                    continue;
                }
                let normal = room.normal(i);
                let s = normal[0] * n[0] + normal[1] * n[1];
                let offset = (da + db) / 2.0;
                for band in bands {
                    let s0 = ta + (tb - ta) * band.t0;
                    let s1 = ta + (tb - ta) * band.t1;
                    if s0.max(s1) > 1.0 && s0.min(s1) < opening.w - 1.0 {
                        let (u0, u1) = (offset + s * band.o0, offset + s * band.o1);
                        lo = lo.min(u0.min(u1));
                        hi = hi.max(u0.max(u1));
                    }
                }
            }
        }
        lo.is_finite().then_some([lo - 0.8, hi + 0.8])
    }

    /// Thickness of an opening with no wall band around it: the thickest side of the rooms whose
    /// contour carries it, at least the interior thickness.
    pub fn opening_thickness(&self, opening: &Opening) -> f64 {
        let mut thickness = self.settings.interior;
        for room in &self.rooms {
            if on_contour(opening, &room.points) {
                for bands in room.sides.iter().flatten() {
                    for band in bands {
                        thickness = thickness.max(band.depth());
                    }
                }
            }
        }
        thickness
    }
}

/// The footprint of a free partition: a quadrilateral along it as thick as it is, and its unit
/// normal; none when it has no length.
pub fn free_wall_quad(wall: &FreeWall) -> Option<([P2; 4], P2)> {
    let (dx, dy) = (wall.x2 - wall.x, wall.y2 - wall.y);
    let len = dx.hypot(dy);
    if len < 0.5 {
        return None;
    }
    let n = [-dy / len, dx / len];
    let t = wall.thickness / 2.0;
    let side = |x: f64, y: f64, k: f64| [x + n[0] * k, y + n[1] * k];
    Some((
        [
            side(wall.x, wall.y, t),
            side(wall.x2, wall.y2, t),
            side(wall.x2, wall.y2, -t),
            side(wall.x, wall.y, -t),
        ],
        n,
    ))
}

/// Unit vector `u` along an opening of direction `angle` (degrees) and `n` = `u` turned +90°.
pub fn opening_axes(angle: f64) -> (P2, P2) {
    let (s, c) = angle.to_radians().sin_cos();
    ([c, s], [-s, c])
}

/// Far end of an opening.
pub fn opening_end(opening: &Opening) -> P2 {
    let (u, _) = opening_axes(opening.angle);
    [opening.x + u[0] * opening.w, opening.y + u[1] * opening.w]
}

/// Distance from the point at `t` of side AB to the nearest other room along the normal `n` (0
/// when the point is already inside one or none is within 59 cm).
fn edge_gap(a: P2, b: P2, n: P2, t: f64, polygons: &[&[P2]]) -> f64 {
    let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let mut best: f64 = 60.0;
    for polygon in polygons {
        if point_in_polygon([p[0] + n[0] * 0.2, p[1] + n[1] * 0.2], polygon, true) {
            return 0.0;
        }
        let m = polygon.len();
        for i in 0..m {
            let q = polygon[i];
            let r = polygon[(i + 1) % m];
            let (ex, ey) = (r[0] - q[0], r[1] - q[1]);
            let den = n[0] * ey - n[1] * ex;
            if den.abs() < 1e-9 {
                continue;
            }
            let (wx, wy) = (q[0] - p[0], q[1] - p[1]);
            let s = (wx * ey - wy * ex) / den;
            let u = (wx * n[1] - wy * n[0]) / den;
            if s >= -0.01 && (0.0..=1.0).contains(&u) && s < best {
                best = s.max(0.0);
            }
        }
    }
    if best < MAX_GAP { best } else { 0.0 }
}

/// Splits side `i` into façade and interior portions by probing lines parallel to the side;
/// portions shorter than 2 cm are merged.
pub fn edge_segments(points: &[P2], i: usize, others: &[&[P2]]) -> Vec<EdgeSegment> {
    let n = points.len();
    let (a, b) = (points[i % n], points[(i + 1) % n]);
    let normal = outward_normal(points, i);
    let mut intervals: Vec<[f64; 2]> = Vec::new();
    for polygon in others {
        for d in PROBES {
            let off = [normal[0] * d, normal[1] * d];
            intervals.extend(line_inside(
                polygon,
                [a[0] + off[0], a[1] + off[1]],
                [b[0] + off[0], b[1] + off[1]],
            ));
        }
    }
    intervals.sort_by(|x, y| x[0].total_cmp(&y[0]));
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for s in intervals {
        match merged.last_mut() {
            Some(last) if s[0] <= last[1] + 1e-6 => last[1] = last[1].max(s[1]),
            _ => merged.push(s),
        }
    }
    let len = (b[0] - a[0]).hypot(b[1] - a[1]);
    let tol = 2.0 / if len > 0.0 { len } else { 1.0 };
    let mut out: Vec<EdgeSegment> = Vec::new();
    let mut cur = 0.0;
    for [s0, s1] in merged {
        if s1 - s0 < tol {
            continue;
        }
        let mut start = s0;
        if s0 - cur > tol {
            out.push(EdgeSegment {
                t0: cur,
                t1: s0,
                inner: false,
                gap: 0.0,
            });
        } else {
            start = cur;
        }
        out.push(EdgeSegment {
            t0: start,
            t1: s1,
            inner: true,
            gap: edge_gap(a, b, normal, (start + s1) / 2.0, others),
        });
        cur = s1;
    }
    if 1.0 - cur > tol {
        out.push(EdgeSegment {
            t0: cur,
            t1: 1.0,
            inner: false,
            gap: 0.0,
        });
    } else if let Some(last) = out.last_mut() {
        last.t1 = 1.0;
    }
    if out.is_empty() {
        out.push(EdgeSegment {
            t0: 0.0,
            t1: 1.0,
            inner: false,
            gap: 0.0,
        });
    }
    out
}

/// Wall bands of side `i`: a façade band runs from the side outwards (`o0 = 0`, `o1 = t`); an
/// interior band is this room's half of the partition: with `g = min(gap, t)`, `o0 = g/2 − t/2`
/// and `o1 = g/2`, the neighbour drawing the other half.
fn edge_bands(
    room: &Room,
    points: &[P2],
    i: usize,
    others: &[&[P2]],
    settings: &WallSettings,
) -> Vec<EdgeBand> {
    let n = points.len();
    let (a, b) = (points[i], points[(i + 1) % n]);
    let normal = outward_normal(points, i);
    let forced = room
        .edge_thickness
        .get(i)
        .copied()
        .flatten()
        .filter(|t| t.is_finite() && *t >= 1.0);
    edge_segments(points, i, others)
        .into_iter()
        .map(|segment| {
            let t = forced.unwrap_or(if segment.inner {
                settings.interior
            } else {
                settings.exterior
            });
            let (o0, o1) = if segment.inner {
                let g = segment.gap.min(t);
                (g / 2.0 - t / 2.0, g / 2.0)
            } else {
                (0.0, t)
            };
            let at = |s: f64| [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
            let off = |p: P2, k: f64| [p[0] + normal[0] * k, p[1] + normal[1] * k];
            let (p0, p1) = (at(segment.t0), at(segment.t1));
            EdgeBand {
                t0: segment.t0,
                t1: segment.t1,
                inner: segment.inner,
                o0,
                o1,
                quad: [off(p0, o0), off(p1, o0), off(p1, o1), off(p0, o1)],
            }
        })
        .collect()
}

/// A corner piece at each convex vertex between two façade bands, filling the outer corner up to
/// the mitre point (skipped when that point is more than 4 thicknesses away).
fn corners(points: &[P2], sides: &[Option<Vec<EdgeBand>>]) -> Vec<Corner> {
    let n = points.len();
    let sign = if signed_area2(points) >= 0.0 {
        1.0
    } else {
        -1.0
    };
    let mut out = Vec::new();
    for i in 0..n {
        let prev = (i + n - 1) % n;
        let (Some(Some(before)), Some(Some(after))) = (sides.get(prev), sides.get(i)) else {
            continue;
        };
        let (Some(bp), Some(bn)) = (before.last(), after.first()) else {
            continue;
        };
        if bp.o0 < -0.01 || bn.o0 < -0.01 {
            continue;
        }
        let (v, a, c) = (points[i], points[prev], points[(i + 1) % n]);
        let turn = ((v[0] - a[0]) * (c[1] - v[1]) - (v[1] - a[1]) * (c[0] - v[0])) * sign;
        if turn <= 1e-6 {
            continue;
        }
        let (n1, n2) = (outward_normal(points, prev), outward_normal(points, i));
        let (d1, d2) = (bp.o1, bn.o1);
        let u1 = [v[0] - a[0], v[1] - a[1]];
        let u2 = [c[0] - v[0], c[1] - v[1]];
        let p1 = [v[0] + n1[0] * d1, v[1] + n1[1] * d1];
        let p2 = [v[0] + n2[0] * d2, v[1] + n2[1] * d2];
        let den = u1[0] * u2[1] - u1[1] * u2[0];
        if den.abs() < 1e-6 {
            continue;
        }
        let t = ((p2[0] - p1[0]) * u2[1] - (p2[1] - p1[1]) * u2[0]) / den;
        let mitre = [p1[0] + u1[0] * t, p1[1] + u1[1] * t];
        if (mitre[0] - v[0]).hypot(mitre[1] - v[1]) > 4.0 * d1.max(d2) {
            continue;
        }
        out.push(Corner {
            vertex: i,
            quad: [v, p1, mitre, p2],
        });
    }
    out
}

/// Whether an opening lies on a room contour: the sides within 6 cm of the opening line cover its
/// whole width (gaps up to 6 cm allowed).
pub fn on_contour(opening: &Opening, points: &[P2]) -> bool {
    let (u, _) = opening_axes(opening.angle);
    let m = points.len();
    let mut intervals: Vec<[f64; 2]> = Vec::new();
    for i in 0..m {
        let (a, b) = (points[i], points[(i + 1) % m]);
        let da = ((a[0] - opening.x) * u[1] - (a[1] - opening.y) * u[0]).abs();
        let db = ((b[0] - opening.x) * u[1] - (b[1] - opening.y) * u[0]).abs();
        if da > ON_LINE || db > ON_LINE {
            continue;
        }
        let ta = (a[0] - opening.x) * u[0] + (a[1] - opening.y) * u[1];
        let tb = (b[0] - opening.x) * u[0] + (b[1] - opening.y) * u[1];
        intervals.push([ta.min(tb), ta.max(tb)]);
    }
    intervals.sort_by(|x, y| x[0].total_cmp(&y[0]));
    let mut covered = 0.0;
    for [a, b] in intervals {
        if a > covered + ON_LINE {
            break;
        }
        if b > covered {
            covered = b;
        }
        if covered >= opening.w - ON_LINE {
            return true;
        }
    }
    false
}

/// The openings cut in room walls: every window and every door except sealed ones, which are
/// drawn closed in a full wall. `true` marks doors.
pub fn wall_openings(plan: &Plan) -> Vec<(&Opening, bool)> {
    plan.openings()
        .filter(|(o, door)| !door || o.style.cuts_wall())
        .collect()
}

/// An opening along a side, from `s0` to `s1` cm from the side's start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SideOpening<'a> {
    /// The opening.
    pub opening: &'a Opening,
    /// `true` for a door.
    pub door: bool,
    /// Start along the side (cm).
    pub s0: f64,
    /// End along the side (cm), `s0 ≤ s1`.
    pub s1: f64,
}

/// The openings lying on side AB: both ends within 6 cm of its line and more than 1 cm of the
/// opening within the side, sorted by `s0`.
pub fn openings_on_side<'a>(a: P2, b: P2, list: &[(&'a Opening, bool)]) -> Vec<SideOpening<'a>> {
    let len = (b[0] - a[0]).hypot(b[1] - a[1]);
    if len <= 1e-9 {
        return Vec::new();
    }
    let (ux, uy) = ((b[0] - a[0]) / len, (b[1] - a[1]) / len);
    let mut out: Vec<SideOpening<'a>> = list
        .iter()
        .filter_map(|&(opening, door)| {
            let end = opening_end(opening);
            let d1 = ((opening.x - a[0]) * uy - (opening.y - a[1]) * ux).abs();
            let d2 = ((end[0] - a[0]) * uy - (end[1] - a[1]) * ux).abs();
            if d1 > ON_LINE || d2 > ON_LINE {
                return None;
            }
            let s0 = (opening.x - a[0]) * ux + (opening.y - a[1]) * uy;
            let s1 = (end[0] - a[0]) * ux + (end[1] - a[1]) * uy;
            let (lo, hi) = (s0.min(s1), s0.max(s1));
            (hi >= 1.0 && lo <= len - 1.0).then_some(SideOpening {
                opening,
                door,
                s0: lo,
                s1: hi,
            })
        })
        .collect();
    out.sort_by(|p, q| p.s0.total_cmp(&q.s0));
    out
}

/// A piece of a side portion: plain wall (`None`) or an opening.
pub type SidePiece<'a> = (f64, f64, Option<SideOpening<'a>>);

/// Splits the portion `[s0, s1]` of a side into wall and opening pieces, in order; where two
/// openings overlap the later one starts where the earlier ends, so no length is cut twice.
pub fn side_segments<'a>(s0: f64, s1: f64, openings: &[SideOpening<'a>]) -> Vec<SidePiece<'a>> {
    let mut pieces = Vec::new();
    let mut s = s0;
    for op in openings {
        let (lo, hi) = (s0.max(op.s0), s1.min(op.s1));
        if hi <= lo {
            continue;
        }
        if lo > s {
            pieces.push((s, lo, None));
        }
        pieces.push((s.max(lo), hi, Some(*op)));
        s = s.max(hi);
    }
    if s < s1 {
        pieces.push((s, s1, None));
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::read_plan;

    fn plan(json: &str) -> Plan {
        match read_plan(json.as_bytes()) {
            Ok(plan) => plan,
            Err(err) => panic!("{err}"),
        }
    }

    /// Two 300 × 300 rooms side by side, sharing the limit x = 300.
    const TWO_ROOMS: &str = r#"{"format":"domotwin-plan","version":1,"rooms":[
        {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]]},
        {"id":"b","name":"B","outline":[[300,0],[600,0],[600,300],[300,300]]}
    ],"doors":[
        {"id":"d","name":"D","from":[300,100],"to":[300,180],"room":"a"}
    ],"windows":[
        {"id":"w","name":"W","from":[100,0],"to":[200,0],"room":"a"}
    ]}"#;

    #[test]
    fn interior_and_facade_bands() {
        let layout = WallLayout::new(&plan(TWO_ROOMS));
        let a = &layout.rooms[0];
        // Side 1 of A (x = 300) faces B: a 10 cm partition centred on the limit.
        let shared = a.sides[1].as_ref().map(|b| b[0]);
        let Some(shared) = shared else {
            panic!("side 1 has a wall")
        };
        assert!(shared.inner);
        assert_eq!((shared.o0, shared.o1), (-5.0, 0.0));
        // Side 0 (y = 0) is a façade 20 cm thick outside the room.
        let Some(Some(facade)) = a.sides.first().map(|s| s.as_ref().map(|b| b[0])) else {
            panic!("side 0 has a wall")
        };
        assert!(!facade.inner);
        assert_eq!((facade.o0, facade.o1), (0.0, 20.0));
        assert_eq!(facade.quad[3], [0.0, -20.0]);
        // The two convex façade corners of A (top-left and bottom-left) are filled.
        let vertices: Vec<usize> = a.corners.iter().map(|c| c.vertex).collect();
        assert_eq!(vertices, vec![0, 3]);
        assert_eq!(a.corners[0].quad[2], [-20.0, -20.0]);
    }

    #[test]
    fn partly_shared_side_is_split() {
        let layout = WallLayout::new(&plan(
            r#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,400],[0,400]]},
                {"id":"b","name":"B","outline":[[300,100],[500,100],[500,300],[300,300]]}
            ]}"#,
        ));
        let Some(Some(bands)) = layout.rooms[0].sides.get(1) else {
            panic!("side 1 has walls")
        };
        let kinds: Vec<(bool, f64, f64)> = bands.iter().map(|b| (b.inner, b.t0, b.t1)).collect();
        assert_eq!(kinds.len(), 3);
        assert!(!kinds[0].0 && kinds[1].0 && !kinds[2].0);
        assert!((kinds[1].1 - 0.25).abs() < 0.01 && (kinds[1].2 - 0.75).abs() < 0.01);
    }

    #[test]
    fn gap_between_rooms_centres_the_partition() {
        let layout = WallLayout::new(&plan(
            r#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]]},
                {"id":"b","name":"B","outline":[[306,0],[606,0],[606,300],[306,300]]}
            ]}"#,
        ));
        let Some(Some(bands)) = layout.rooms[0].sides.get(1) else {
            panic!("side 1 has walls")
        };
        assert!(bands[0].inner);
        assert!((bands[0].o0 - -2.0).abs() < 1e-6 && (bands[0].o1 - 3.0).abs() < 1e-6);
    }

    #[test]
    fn overrides_and_open_sides() {
        let layout = WallLayout::new(&plan(
            r#"{"format":"domotwin-plan","version":1,"rooms":[
                {"id":"a","name":"A","outline":[[0,0],[300,0],[300,300],[0,300]],"sides":[{"thickness":35},null,{"open":true},null]}
            ]}"#,
        ));
        let room = &layout.rooms[0];
        assert!(room.sides[2].is_none());
        assert_eq!(room.sides[0].as_ref().map(|b| b[0].depth()), Some(35.0));
        // Corners next to the open side are not filled.
        let vertices: Vec<usize> = room.corners.iter().map(|c| c.vertex).collect();
        assert_eq!(vertices, vec![0, 1]);
    }

    #[test]
    fn openings_on_sides_and_wall_range() {
        let plan = plan(TWO_ROOMS);
        let layout = WallLayout::new(&plan);
        let openings = wall_openings(&plan);
        assert_eq!(openings.len(), 2);
        let a = &layout.rooms[0];
        let (p, q) = a.side(1);
        let on_side = openings_on_side(p, q, &openings);
        assert_eq!(on_side.len(), 1);
        assert!(on_side[0].door);
        assert!((on_side[0].s0 - 100.0).abs() < 1e-6 && (on_side[0].s1 - 180.0).abs() < 1e-6);
        let pieces = side_segments(0.0, 300.0, &on_side);
        let spans: Vec<(f64, f64, bool)> = pieces
            .iter()
            .map(|(s0, s1, o)| (s0.round(), s1.round(), o.is_some()))
            .collect();
        assert_eq!(
            spans,
            vec![
                (0.0, 100.0, false),
                (100.0, 180.0, true),
                (180.0, 300.0, false)
            ]
        );
        // The door sits in the 10 cm partition: ±5 cm plus the margin.
        let Some(Element::Door(door)) = plan.element("d") else {
            panic!("door d")
        };
        let Some([lo, hi]) = layout.opening_wall_range(door) else {
            panic!("door d is in a wall")
        };
        assert!((lo - -5.8).abs() < 1e-6 && (hi - 5.8).abs() < 1e-6);
        // The window sits in the 20 cm façade, outside room A (towards −y = −n here).
        let Some(Element::Window(window)) = plan.element("w") else {
            panic!("window w")
        };
        let Some([lo, hi]) = layout.opening_wall_range(window) else {
            panic!("window w is in a wall")
        };
        assert!((lo - -20.8).abs() < 1e-6 && (hi - 0.8).abs() < 1e-6);
        assert_eq!(layout.opening_thickness(window), 20.0);
        assert!(on_contour(window, &a.points));
    }

    #[test]
    fn overlapping_openings_cut_once() {
        let o = Opening {
            id: String::new(),
            name: String::new(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            angle: 0.0,
            swing: 1,
            parent: String::new(),
            style: crate::plan::DoorStyle::Hinged,
            open: None,
        };
        let first = SideOpening {
            opening: &o,
            door: true,
            s0: 10.0,
            s1: 60.0,
        };
        let second = SideOpening {
            s0: 40.0,
            s1: 90.0,
            ..first
        };
        let pieces = side_segments(0.0, 100.0, &[first, second]);
        let spans: Vec<(f64, f64)> = pieces.iter().map(|(a, b, _)| (*a, *b)).collect();
        assert_eq!(
            spans,
            vec![(0.0, 10.0), (10.0, 60.0), (60.0, 90.0), (90.0, 100.0)]
        );
    }
}
