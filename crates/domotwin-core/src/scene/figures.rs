//! The shapes people are drawn with (`DECISIONS.md`, D-034): a figure, a pin, and the soft
//! shadow under them.
//!
//! Each is built once, around its own origin: on the floor, under its middle, facing +x, in cm.
//! The renderer moves, turns and colours it for each person.

use std::f32::consts::{PI, TAU};

/// A shape: positions, unit normals and triangles.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shape {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// Height of a figure's head top (cm): a little under a grown-up's, so that it reads as a
/// person without hiding the room.
pub const FIGURE_HEIGHT: f32 = 158.0;
/// Height of a pin's top (cm).
pub const PIN_HEIGHT: f32 = 170.0;

/// Sides around a turned shape.
const AROUND: usize = 20;

impl Shape {
    fn base(&self) -> u32 {
        u32::try_from(self.positions.len()).unwrap_or(u32::MAX)
    }

    /// A shape turned about the vertical axis from a profile of `(radius, height)` points, bottom
    /// to top, flattened front to back by `depth`, around `center` (x, z).
    fn lathe(&mut self, profile: &[[f32; 2]], depth: f32, center: [f32; 2]) {
        let start = self.base();
        for (k, &[r, y]) in profile.iter().enumerate() {
            // The profile's normal: across its slope, from the points around this one.
            let before = profile[k.saturating_sub(1)];
            let after = profile[(k + 1).min(profile.len() - 1)];
            let (dr, dy) = (after[0] - before[0], after[1] - before[1]);
            let len = dr.hypot(dy).max(1e-6);
            let (nr, ny) = (dy / len, -dr / len);
            for i in 0..=AROUND {
                #[allow(clippy::cast_precision_loss)]
                let a = i as f32 / AROUND as f32 * TAU;
                let (c, s) = (a.cos(), a.sin());
                self.positions
                    .push([center[0] + r * c * depth, y, center[1] + r * s]);
                let n = [nr * c / depth, ny, nr * s];
                self.normals.push(normalised(n));
            }
        }
        let ring = u32::try_from(AROUND + 1).unwrap_or(0);
        for k in 0..u32::try_from(profile.len() - 1).unwrap_or(0) {
            for i in 0..u32::try_from(AROUND).unwrap_or(0) {
                let a = start + k * ring + i;
                let b = a + ring;
                self.indices
                    .extend_from_slice(&[a, b, a + 1, a + 1, b, b + 1]);
            }
        }
    }

    /// A ball of radius `r` at `center`.
    fn ball(&mut self, center: [f32; 3], r: f32) {
        let profile: Vec<[f32; 2]> = (0..=10)
            .map(|k| {
                #[allow(clippy::cast_precision_loss)]
                let a = -PI / 2.0 + k as f32 / 10.0 * PI;
                [r * a.cos(), center[1] + r * a.sin()]
            })
            .collect();
        self.lathe(&profile, 1.0, [center[0], center[2]]);
    }

    /// A rod with rounded ends from `a` to `b` (in a vertical plane), of radius `r`.
    fn limb(&mut self, a: [f32; 3], b: [f32; 3], r: f32) {
        let start = self.base();
        // Built upright, then leaned from `a` towards `b`.
        let length = (b[1] - a[1]).hypot(b[2] - a[2]).hypot(b[0] - a[0]);
        let mut upright = Self::default();
        let mut profile = Vec::new();
        for k in 0..=4 {
            #[allow(clippy::cast_precision_loss)]
            let t = -PI / 2.0 + k as f32 / 8.0 * PI;
            profile.push([r * t.cos(), r * t.sin()]);
        }
        for k in 4..=8 {
            #[allow(clippy::cast_precision_loss)]
            let t = -PI / 2.0 + k as f32 / 8.0 * PI;
            profile.push([r * t.cos(), length + r * t.sin()]);
        }
        upright.lathe(&profile, 1.0, [0.0, 0.0]);
        let axis = normalised([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        let turn = |p: [f32; 3]| rotate_up_to(p, axis);
        for (p, n) in upright.positions.iter().zip(&upright.normals) {
            let q = turn(*p);
            self.positions.push([a[0] + q[0], a[1] + q[1], a[2] + q[2]]);
            self.normals.push(turn(*n));
        }
        self.indices
            .extend(upright.indices.iter().map(|i| i + start));
    }
}

fn normalised(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-6);
    [v[0] / len, v[1] / len, v[2] / len]
}

/// `p` turned so that +y points along the unit vector `axis` (the shortest turn).
fn rotate_up_to(p: [f32; 3], axis: [f32; 3]) -> [f32; 3] {
    // Rodrigues: about up × axis, by the angle between them.
    let k = normalised([axis[2], 0.0, -axis[0]]);
    let cos = axis[1];
    let sin = (1.0 - cos * cos).max(0.0).sqrt();
    if sin < 1e-5 {
        return if cos > 0.0 { p } else { [p[0], -p[1], -p[2]] };
    }
    let dot = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
    let cross = [
        k[1] * p[2] - k[2] * p[1],
        k[2] * p[0] - k[0] * p[2],
        k[0] * p[1] - k[1] * p[0],
    ];
    std::array::from_fn(|i| p[i] * cos + cross[i] * sin + k[i] * dot * (1.0 - cos))
}

/// A person: a body tapering to the floor, shoulders, arms at its sides and a head. Facing +x, so
/// narrower front to back than across.
pub fn figure() -> Shape {
    let mut shape = Shape::default();
    let body = [
        [0.0, 0.0],
        [11.0, 0.0],
        [12.5, 3.0],
        [11.5, 40.0],
        [13.5, 78.0],
        [15.5, 100.0],
        [17.5, 114.0],
        [16.0, 122.0],
        [11.0, 127.0],
        [5.5, 129.0],
        [5.0, 134.0],
        [0.0, 135.0],
    ];
    shape.lathe(&body, 0.68, [0.0, 0.0]);
    shape.ball([0.0, 146.0, 0.0], 12.0);
    for side in [-1.0, 1.0] {
        shape.limb([0.0, 116.0, side * 19.5], [1.5, 76.0, side * 22.0], 4.2);
    }
    shape
}

/// A map pin floating above the floor: a ball on a point.
pub fn pin() -> Shape {
    let mut shape = Shape::default();
    let point = [
        [0.0, 112.0],
        [3.0, 118.0],
        [9.0, 132.0],
        [13.5, 146.0],
        [15.0, 155.0],
        [13.5, 163.0],
        [9.0, 168.0],
        [0.0, PIN_HEIGHT],
    ];
    shape.lathe(&point, 1.0, [0.0, 0.0]);
    shape
}

/// The shadow on the floor: a disc of radius 1, its rim in the normals' y (0 at the middle, 1
/// at the rim) for the shader to soften.
pub fn shadow() -> Shape {
    let mut shape = Shape {
        positions: vec![[0.0, 0.0, 0.0]],
        normals: vec![[0.0, 0.0, 0.0]],
        indices: Vec::new(),
    };
    for i in 0..AROUND {
        #[allow(clippy::cast_precision_loss)]
        let a = i as f32 / AROUND as f32 * TAU;
        shape.positions.push([a.cos(), 0.0, a.sin()]);
        shape.normals.push([0.0, 1.0, 0.0]);
        let n = u32::try_from(AROUND).unwrap_or(1);
        let k = u32::try_from(i).unwrap_or(0);
        shape
            .indices
            .extend_from_slice(&[0, 1 + (k + 1) % n, 1 + k]);
    }
    shape
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(shape: &Shape) -> ([f32; 3], [f32; 3]) {
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for p in &shape.positions {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        (lo, hi)
    }

    #[test]
    fn shapes_stand_on_the_floor_and_are_whole() {
        for (shape, top) in [(figure(), FIGURE_HEIGHT), (pin(), PIN_HEIGHT)] {
            let (lo, hi) = bounds(&shape);
            assert!(lo[1] >= -0.01, "{lo:?}");
            assert!((hi[1] - top).abs() < 0.5, "{hi:?}");
            assert_eq!(shape.positions.len(), shape.normals.len());
            assert!(
                shape
                    .indices
                    .iter()
                    .all(|&i| (i as usize) < shape.positions.len())
            );
            for n in &shape.normals {
                let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
                assert!((len - 1.0).abs() < 1e-3, "{n:?}");
            }
        }
        // A figure is wider across (z) than front to back (x), its arms at its sides.
        let (lo, hi) = bounds(&figure());
        assert!(hi[2] - lo[2] > (hi[0] - lo[0]) * 1.2);
        assert!(hi[2] > 22.0);
        let disc = shadow();
        assert_eq!(disc.indices.len(), AROUND * 3);
    }

    #[test]
    fn limbs_lean_from_one_end_to_the_other() {
        let up = rotate_up_to([0.0, 10.0, 0.0], normalised([0.0, -1.0, 1.0]));
        assert!(
            (up[1] + 7.071).abs() < 1e-3 && (up[2] - 7.071).abs() < 1e-3,
            "{up:?}"
        );
        let down = rotate_up_to([1.0, 2.0, 3.0], [0.0, -1.0, 0.0]);
        assert_eq!(down, [1.0, -2.0, -3.0]);
    }
}
