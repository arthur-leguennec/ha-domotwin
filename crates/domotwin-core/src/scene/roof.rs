//! The roof over the top storey of a home (D-028): a gable roof over the smallest rectangle around
//! the storey's walls, its ridge along the longer side, its eaves a little out from the walls, and
//! its outlines (eaves, ridge, gable edges).

use super::lines::{LineKind, Lines};
use super::mesh::{Material, Mesh, NO_GROUP, Painter, Surface, Tag, V3};
use super::{Roof, RoofShape, StoreyPart};
use crate::geometry::polygon::P2;
use crate::plan::Rgb8;

/// How far the eaves stand out from the walls (cm).
const OVERHANG: f64 = 30.0;
/// Pitch of the slopes (degrees), and the highest a ridge goes above the eaves (cm).
const PITCH: f64 = 30.0;
const MAX_RISE: f64 = 320.0;
/// Thickness of the roof (cm).
const THICKNESS: f64 = 14.0;
/// The tiles, the underside and edges, the gable walls.
const TILES: Material = Material::new(Rgb8::from_u32(0x6b5a52), 0.85, Surface::Matte);
const UNDERSIDE: Material = Material::satin(Rgb8::from_u32(0xe9e6de));
const GABLE: Material = Material::new(Rgb8::from_u32(0xe9e6de), 0.95, Surface::Matte);

/// The roof over the highest storey of `parts`; `None` without walls to cover.
pub(crate) fn build(parts: &[StoreyPart], wall_height: f64) -> Option<Roof> {
    let (storey, top) = parts
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.elevation.total_cmp(&b.1.elevation))?;
    // The rooms and the outer faces of their walls.
    let mut points: Vec<P2> = Vec::new();
    for room in &top.layout.rooms {
        points.extend(&room.points);
        for band in room.sides.iter().flatten().flatten() {
            points.extend(band.quad);
        }
    }
    let rectangle = smallest_rectangle(&convex_hull(points))?;
    let mut mesh = Mesh::default();
    let mut lines = Lines::default();
    let shape = gable_roof(&mut mesh, &mut lines, &rectangle, wall_height);
    (mesh.vertex_count() > 0).then_some(Roof {
        elevation: top.elevation,
        storey,
        mesh,
        lines: lines.list,
        shape,
    })
}

/// A rectangle on the plan: its centre, its unit axes (`u` along the longer side) and half its
/// length and width.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rectangle {
    centre: P2,
    u: P2,
    v: P2,
    half_length: f64,
    half_width: f64,
}

/// Draws a gable roof over `r` (grown by the overhang), its eaves at height `eaves` (the walls'
/// tops: the shaders darken what stands near its floor, which a roof is not); returns its shape.
fn gable_roof(mesh: &mut Mesh, lines: &mut Lines, r: &Rectangle, eaves: f64) -> RoofShape {
    let (hl, hw) = (r.half_length + OVERHANG, r.half_width + OVERHANG);
    let rise = (hw * PITCH.to_radians().tan()).min(MAX_RISE);
    let shape = RoofShape {
        centre: r.centre,
        ridge: r.u,
        half_length: hl,
        half_width: hw,
        eaves,
        rise,
    };
    let at = |s: f64, t: f64| -> P2 {
        [
            r.centre[0] + r.u[0] * s + r.v[0] * t,
            r.centre[1] + r.u[1] * s + r.v[1] * t,
        ]
    };
    let p = |q: P2, y: f64| -> V3 { [q[0], eaves + y, q[1]] };
    let (c0, c1, c2, c3) = (at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw));
    let (r0, r1) = (at(-hl, 0.0), at(hl, 0.0));
    let out = |k: f64| -> V3 { [r.v[0] * k, 1.0, r.v[1] * k] };
    let end = |k: f64| -> V3 { [r.u[0] * k, 0.0, r.u[1] * k] };
    let down = |k: f64| -> V3 { [-r.v[0] * k, -1.0, -r.v[1] * k] };
    let tag = Tag {
        group: NO_GROUP,
        ..Tag::default()
    };
    let none = [[0.0; 2]; 4];
    let mut painter = Painter::new(mesh, TILES, tag);
    // The slopes, their undersides and edges.
    for (side, (a, b)) in [(-1.0, (c0, c1)), (1.0, (c3, c2))] {
        painter.material = TILES;
        painter.quad(
            [p(a, 0.0), p(b, 0.0), p(r1, rise), p(r0, rise)],
            none,
            Some(out(side)),
            0.0,
        );
        painter.material = UNDERSIDE;
        painter.quad(
            [
                p(a, -THICKNESS),
                p(b, -THICKNESS),
                p(r1, rise - THICKNESS),
                p(r0, rise - THICKNESS),
            ],
            none,
            Some(down(side)),
            0.0,
        );
        // The eave's edge.
        painter.quad(
            [p(a, 0.0), p(b, 0.0), p(b, -THICKNESS), p(a, -THICKNESS)],
            none,
            Some([r.v[0] * side, 0.0, r.v[1] * side]),
            0.0,
        );
        // The rakes at both ends.
        for (corner, ridge, k) in [(a, r0, -1.0), (b, r1, 1.0)] {
            painter.quad(
                [
                    p(corner, 0.0),
                    p(ridge, rise),
                    p(ridge, rise - THICKNESS),
                    p(corner, -THICKNESS),
                ],
                none,
                Some(end(k)),
                0.0,
            );
        }
    }
    // The gable walls, at the walls' line, up to the underside.
    painter.material = GABLE;
    let (gl, gw) = (r.half_length, r.half_width);
    let under = |t: f64| rise * (1.0 - t.abs() / hw) - THICKNESS;
    for k in [-1.0, 1.0] {
        let s = gl * k;
        let (a, b, top) = (at(s, -gw), at(s, gw), at(s, 0.0));
        let eave = under(gw).max(0.0);
        painter.quad(
            [p(a, 0.0), p(b, 0.0), p(b, eave), p(a, eave)],
            none,
            Some(end(k)),
            0.0,
        );
        painter.quad(
            [
                p(a, eave),
                p(b, eave),
                p(top, under(0.0)),
                p(top, under(0.0)),
            ],
            none,
            Some(end(k)),
            0.0,
        );
    }
    // Its outlines: the eaves, the ridge, the edges of the gables.
    let kind = LineKind::Wall;
    let top = eaves + rise;
    lines.push(c0, eaves, c1, eaves, NO_GROUP, kind);
    lines.push(c3, eaves, c2, eaves, NO_GROUP, kind);
    lines.push(r0, top, r1, top, NO_GROUP, kind);
    for (corner, ridge) in [(c0, r0), (c3, r0), (c1, r1), (c2, r1)] {
        lines.push(corner, eaves, ridge, top, NO_GROUP, kind);
    }
    shape
}

/// The convex hull of points, counter-clockwise in the plan's axes (empty under three points).
fn convex_hull(mut points: Vec<P2>) -> Vec<P2> {
    points.retain(|p| p[0].is_finite() && p[1].is_finite());
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    points.dedup();
    if points.len() < 3 {
        return Vec::new();
    }
    let cross = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut hull: Vec<P2> = Vec::with_capacity(points.len() * 2);
    for pass in 0..2 {
        let start = hull.len();
        let ordered: Box<dyn Iterator<Item = &P2>> = if pass == 0 {
            Box::new(points.iter())
        } else {
            Box::new(points.iter().rev())
        };
        for &p in ordered {
            while hull.len() >= start + 2
                && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0
            {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    if hull.len() < 3 { Vec::new() } else { hull }
}

/// The rectangle of least area around a convex polygon (one of its sides lies on a side of the
/// polygon); `None` for a polygon without area.
fn smallest_rectangle(hull: &[P2]) -> Option<Rectangle> {
    let n = hull.len();
    let mut best: Option<(f64, Rectangle)> = None;
    for i in 0..n {
        let (a, b) = (hull[i], hull[(i + 1) % n]);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len < 1e-6 {
            continue;
        }
        let d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let e = [-d[1], d[0]];
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for p in hull {
            let (s, t) = (p[0] * d[0] + p[1] * d[1], p[0] * e[0] + p[1] * e[1]);
            lo = [lo[0].min(s), lo[1].min(t)];
            hi = [hi[0].max(s), hi[1].max(t)];
        }
        let (along, across) = (hi[0] - lo[0], hi[1] - lo[1]);
        let area = along * across;
        if area <= 1e-6 || best.as_ref().is_some_and(|(a, _)| *a <= area) {
            continue;
        }
        let (ms, mt) = (f64::midpoint(lo[0], hi[0]), f64::midpoint(lo[1], hi[1]));
        let centre = [d[0] * ms + e[0] * mt, d[1] * ms + e[1] * mt];
        let rectangle = if along >= across {
            Rectangle {
                centre,
                u: d,
                v: e,
                half_length: along / 2.0,
                half_width: across / 2.0,
            }
        } else {
            Rectangle {
                centre,
                u: e,
                v: d,
                half_length: across / 2.0,
                half_width: along / 2.0,
            }
        };
        best = Some((area, rectangle));
    }
    best.map(|(_, r)| r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_smallest_rectangle_follows_a_turned_home() {
        // A 1000 × 600 rectangle turned by 30°, with a point inside.
        let (s, c) = 30.0_f64.to_radians().sin_cos();
        let turn = |p: P2| [p[0] * c - p[1] * s + 50.0, p[0] * s + p[1] * c - 20.0];
        let points = vec![
            turn([-500.0, -300.0]),
            turn([500.0, -300.0]),
            turn([500.0, 300.0]),
            turn([-500.0, 300.0]),
            turn([10.0, 20.0]),
        ];
        let hull = convex_hull(points);
        assert_eq!(hull.len(), 4);
        let r = smallest_rectangle(&hull).unwrap();
        assert!((r.half_length - 500.0).abs() < 1e-6, "{r:?}");
        assert!((r.half_width - 300.0).abs() < 1e-6, "{r:?}");
        assert!((r.centre[0] - 50.0).abs() < 1e-6 && (r.centre[1] + 20.0).abs() < 1e-6);
        // The ridge runs along the longer side.
        assert!((r.u[0].abs() - c).abs() < 1e-6, "{r:?}");
        // Too few points: no rectangle.
        assert!(convex_hull(vec![[0.0, 0.0], [1.0, 1.0]]).is_empty());
        assert!(smallest_rectangle(&[]).is_none());
    }

    #[test]
    fn a_gable_roof_has_two_slopes_and_its_outlines() {
        let r = Rectangle {
            centre: [500.0, 300.0],
            u: [1.0, 0.0],
            v: [0.0, 1.0],
            half_length: 500.0,
            half_width: 300.0,
        };
        let mut mesh = Mesh::default();
        let mut lines = Lines::default();
        let shape = gable_roof(&mut mesh, &mut lines, &r, 250.0);
        let [lo, hi] = mesh.bounds();
        // The eaves stand out from the walls, on their tops; the ridge rises at the pitch.
        assert!((f64::from(lo[0]) + OVERHANG).abs() < 1e-3);
        assert!((f64::from(hi[2]) - 600.0 - OVERHANG).abs() < 1e-3);
        let rise = (330.0 * PITCH.to_radians().tan()).min(MAX_RISE);
        assert!((f64::from(hi[1]) - 250.0 - rise).abs() < 1e-3);
        assert!((f64::from(lo[1]) - 250.0 + THICKNESS).abs() < 1e-3);
        // Two eaves, the ridge and four gable edges.
        assert_eq!(lines.list.len(), 7);
        // What falls on it meets the ridge in the middle and the eaves at its edges (D-072).
        let at = |p: [f64; 2]| shape.height_at(p).unwrap();
        assert!((at([500.0, 300.0]) - 250.0 - rise).abs() < 1e-9);
        assert!((at([0.0, 300.0 + 330.0]) - 250.0).abs() < 1e-9);
        assert!((at([500.0, 300.0 - 165.0]) - 250.0 - rise / 2.0).abs() < 1e-9);
        assert!(shape.height_at([500.0, 1000.0]).is_none());
        assert!(shape.height_at([-31.0, 300.0]).is_none());
    }
}
