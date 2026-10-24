//! The outlines of the home (`docs/DECISIONS.md`, D-027): the tops and corners of the walls, the
//! frames of doors and windows, the outlines of the floors. The line looks draw them over the
//! scene; the lines of a wall follow its cut-away (its group).
//!
//! The tops of the walls run on the room face of a façade and on the middle of a partition (both
//! rooms give it; the renderer draws each pixel once, at the brightest), meeting at the corners.
//! Façades also get their outer face.

use crate::geometry::heights::opening_cut;
use crate::geometry::polygon::P2;
use crate::geometry::walls::{EdgeBand, RoomWalls, SideOpening};

/// What a line outlines, which sets how strongly it is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    /// The top, the corners and the faces of a wall.
    Wall,
    /// The frame of a door or a window.
    Opening,
    /// The outline of a floor.
    Floor,
}

impl LineKind {
    /// How strongly lines of this kind are drawn (0–1).
    pub const fn weight(self) -> f32 {
        match self {
            LineKind::Wall => 1.0,
            LineKind::Opening => 0.7,
            LineKind::Floor => 0.45,
        }
    }
}

/// A straight line of the outlines, in world coordinates (cm, `y` up).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Line {
    pub a: [f32; 3],
    pub b: [f32; 3],
    /// Height of the bottom of what it outlines: like the meshes' pieces, the line disappears
    /// when the cut-away lowers its wall below it, and is lowered with it otherwise.
    pub base: f32,
    /// Wall group whose cut-away lowers it ([`super::mesh::NO_GROUP`]: never).
    pub group: u8,
    pub kind: LineKind,
}

/// Height of the floor outlines above the floor (cm), clear of it.
const FLOOR_LINE: f64 = 0.3;

/// Collects the lines of the home.
#[derive(Debug, Clone, Default)]
pub(crate) struct Lines {
    pub(crate) list: Vec<Line>,
}

impl Lines {
    /// A line from `a` at height `ya` to `b` at `yb` (plan points, cm), outlining something
    /// that stands on the floor.
    pub(crate) fn push(&mut self, a: P2, ya: f64, b: P2, yb: f64, group: u8, kind: LineKind) {
        self.push_from(0.0, (a, ya), (b, yb), group, kind);
    }

    /// A line outlining something whose bottom is at height `base`.
    #[allow(clippy::cast_possible_truncation)]
    fn push_from(
        &mut self,
        base: f64,
        (a, ya): (P2, f64),
        (b, yb): (P2, f64),
        group: u8,
        kind: LineKind,
    ) {
        let (pa, pb) = (
            [a[0] as f32, ya as f32, a[1] as f32],
            [b[0] as f32, yb as f32, b[1] as f32],
        );
        if pa.iter().chain(&pb).all(|v| v.is_finite()) && pa != pb && base.is_finite() {
            self.list.push(Line {
                a: pa,
                b: pb,
                base: base as f32,
                group,
                kind,
            });
        }
    }

    /// A vertical line at `p` from `y0` to `y1`.
    pub(crate) fn vertical(&mut self, p: P2, y0: f64, y1: f64, group: u8, kind: LineKind) {
        self.push(p, y0, p, y1, group, kind);
    }

    /// The outline of a floor polygon.
    pub(crate) fn floor(&mut self, points: &[P2], group: u8) {
        let n = points.len();
        for i in 0..n {
            self.push(
                points[i],
                FLOOR_LINE,
                points[(i + 1) % n],
                FLOOR_LINE,
                group,
                LineKind::Floor,
            );
        }
    }

    /// The frame of an opening along the line from `a` (unit direction `u`), cut in a wall of
    /// `height`. A window's frame disappears when the cut-away lowers its wall below the sill.
    pub(crate) fn opening(&mut self, a: P2, u: P2, op: &SideOpening<'_>, height: f64, group: u8) {
        let [y0, y1] = opening_cut(op.door, height);
        let at = |s: f64| [a[0] + u[0] * s, a[1] + u[1] * s];
        let (p0, p1) = (at(op.s0), at(op.s1));
        let kind = LineKind::Opening;
        self.push_from(y0, (p0, y0), (p0, y1), group, kind);
        self.push_from(y0, (p1, y0), (p1, y1), group, kind);
        self.push_from(y0, (p0, y1), (p1, y1), group, kind);
        if y0 > 0.0 {
            self.push_from(y0, (p0, y0), (p1, y0), group, kind);
        }
    }
}

/// Where the lines at offsets `oa` along side `a0`→`a1` and `ob` along side `b0`→`b1` cross
/// (offsets along each side's outward `na`, `nb`); `None` when they are parallel.
pub(crate) fn offset_corner(
    (a0, a1, na, oa): (P2, P2, P2, f64),
    (b0, b1, nb, ob): (P2, P2, P2, f64),
) -> Option<P2> {
    let p = [a0[0] + na[0] * oa, a0[1] + na[1] * oa];
    let q = [b0[0] + nb[0] * ob, b0[1] + nb[1] * ob];
    let r = [a1[0] - a0[0], a1[1] - a0[1]];
    let s = [b1[0] - b0[0], b1[1] - b0[1]];
    let cross = r[0] * s[1] - r[1] * s[0];
    if cross.abs() < 1e-9 {
        return None;
    }
    let t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross;
    Some([p[0] + r[0] * t, p[1] + r[1] * t])
}

/// The band of side `side` reaching its start (`at_end` false) or its end, if any.
pub(crate) fn band_at(walls: &RoomWalls, side: usize, at_end: bool) -> Option<EdgeBand> {
    let bands = walls.sides.get(side)?.as_ref()?;
    let band = if at_end {
        bands.last()?
    } else {
        bands.first()?
    };
    band.reaches(at_end).then_some(*band)
}

/// Where the top of a band runs, along the side's outward normal: the room face of a façade, the
/// middle of a partition (`o1`: half the gap between the two rooms).
pub(crate) fn top_offset(band: &EdgeBand) -> f64 {
    if band.inner { band.o1 } else { 0.0 }
}

/// How the walls of a room bend at vertex `i`: the sine of the turn from the side ending there to
/// the side starting there, `> 0` at a concave corner, `< 0` at a convex one, about 0 when the
/// sides run on (`None` for a side too short to tell).
pub(crate) fn bend(walls: &RoomWalls, i: usize) -> Option<f64> {
    let n = walls.points.len();
    if n < 3 {
        return None;
    }
    let (a, b) = walls.side(i);
    let len = (b[0] - a[0]).hypot(b[1] - a[1]);
    let (pa, pb) = walls.side((i + n - 1) % n);
    let previous = (pb[0] - pa[0]).hypot(pb[1] - pa[1]);
    if len < 1e-6 || previous < 1e-6 {
        return None;
    }
    let normal = walls.normal((i + n - 1) % n);
    Some(((b[0] - a[0]) * normal[0] + (b[1] - a[1]) * normal[1]) / len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_lines_cross_at_the_corner() {
        // Two sides of a square meeting at (100, 0), each line 20 cm outside.
        let corner = offset_corner(
            ([0.0, 0.0], [100.0, 0.0], [0.0, -1.0], 20.0),
            ([100.0, 0.0], [100.0, 100.0], [1.0, 0.0], 20.0),
        );
        assert_eq!(corner, Some([120.0, -20.0]));
        assert_eq!(
            offset_corner(
                ([0.0, 0.0], [100.0, 0.0], [0.0, -1.0], 0.0),
                ([0.0, 10.0], [100.0, 10.0], [0.0, -1.0], 0.0),
            ),
            None
        );
    }

    #[test]
    fn degenerate_lines_are_left_out() {
        let mut lines = Lines::default();
        lines.push([0.0, 0.0], 0.0, [0.0, 0.0], 0.0, 0, LineKind::Wall);
        lines.push([0.0, 0.0], 0.0, [f64::NAN, 0.0], 0.0, 0, LineKind::Wall);
        assert!(lines.list.is_empty());
        lines.vertical([1.0, 2.0], 0.0, 265.0, 3, LineKind::Wall);
        assert_eq!(lines.list[0].a, [1.0, 0.0, 2.0]);
        assert_eq!(lines.list[0].b, [1.0, 265.0, 2.0]);
        assert_eq!(lines.list[0].base, 0.0);
    }
}
