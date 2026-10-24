//! Small 3D math: rigid placements (with scale for mapped items) and 2D polygon helpers.

/// A 3D point or vector.
pub type V3 = [f64; 3];
/// A 2D point.
pub type P2 = [f64; 2];

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// `a` of unit length, or `None` when it is too short.
pub fn normalize(a: V3) -> Option<V3> {
    let len = dot(a, a).sqrt();
    (len > 1e-12 && len.is_finite()).then(|| scale(a, 1.0 / len))
}

/// An affine transform: `p ↦ origin + x·p.x + y·p.y + z·p.z`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform {
    pub x: V3,
    pub y: V3,
    pub z: V3,
    pub origin: V3,
}

impl Default for Transform {
    fn default() -> Self {
        Transform::IDENTITY
    }
}

impl Transform {
    pub const IDENTITY: Transform = Transform {
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0],
        origin: [0.0, 0.0, 0.0],
    };

    /// A right-handed frame from a location, an axis (Z) and a reference direction (X), as IFC
    /// placements define them; missing or degenerate directions take their defaults.
    pub fn frame(origin: V3, axis: Option<V3>, reference: Option<V3>) -> Transform {
        let z = axis.and_then(normalize).unwrap_or([0.0, 0.0, 1.0]);
        let r = reference
            .and_then(normalize)
            .unwrap_or(if z[0].abs() < 0.9 {
                [1.0, 0.0, 0.0]
            } else {
                [0.0, 1.0, 0.0]
            });
        let x = normalize(sub(r, scale(z, dot(r, z))))
            .or_else(|| normalize(cross([0.0, 1.0, 0.0], z)))
            .unwrap_or([1.0, 0.0, 0.0]);
        let y = cross(z, x);
        Transform { x, y, z, origin }
    }

    pub fn point(&self, p: V3) -> V3 {
        add(
            self.origin,
            add(
                add(scale(self.x, p[0]), scale(self.y, p[1])),
                scale(self.z, p[2]),
            ),
        )
    }

    pub fn vector(&self, v: V3) -> V3 {
        add(
            add(scale(self.x, v[0]), scale(self.y, v[1])),
            scale(self.z, v[2]),
        )
    }

    /// `self ∘ inner`: first `inner`, then `self`.
    pub fn then(&self, inner: &Transform) -> Transform {
        Transform {
            x: self.vector(inner.x),
            y: self.vector(inner.y),
            z: self.vector(inner.z),
            origin: self.point(inner.origin),
        }
    }

    /// The inverse of a rigid frame (orthonormal axes).
    pub fn inverse_rigid(&self) -> Transform {
        let t = Transform {
            x: [self.x[0], self.y[0], self.z[0]],
            y: [self.x[1], self.y[1], self.z[1]],
            z: [self.x[2], self.y[2], self.z[2]],
            origin: [0.0; 3],
        };
        Transform {
            origin: scale(t.vector(self.origin), -1.0),
            ..t
        }
    }
}

/// Twice the signed area of a polygon (positive counter-clockwise in a y-up frame).
pub fn signed_area2(points: &[P2]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum()
}

/// Whether `p` is inside the polygon (even-odd rule).
pub fn point_in_polygon(p: P2, polygon: &[P2]) -> bool {
    let n = polygon.len();
    let mut inside = false;
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[j]);
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0];
            if p[0] < x {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

fn orient(a: P2, b: P2, c: P2) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// Whether `p` lies on segment AB within `eps` (as the core's plan reader tests it).
fn on_segment(p: P2, a: P2, b: P2, eps: f64) -> bool {
    orient(a, b, p).abs() <= eps * (b[0] - a[0]).hypot(b[1] - a[1]).max(1.0)
        && p[0] >= a[0].min(b[0]) - eps
        && p[0] <= a[0].max(b[0]) + eps
        && p[1] >= a[1].min(b[1]) - eps
        && p[1] <= a[1].max(b[1]) + eps
}

/// Whether segments AB and CD cross or touch.
fn segments_meet(a: P2, b: P2, c: P2, d: P2) -> bool {
    let (ab1, ab2) = (orient(a, b, c), orient(a, b, d));
    let (cd1, cd2) = (orient(c, d, a), orient(c, d, b));
    if ab1 * ab2 < -1e-9 && cd1 * cd2 < -1e-9 {
        return true;
    }
    on_segment(a, c, d, 1e-7)
        || on_segment(b, c, d, 1e-7)
        || on_segment(c, a, b, 1e-7)
        || on_segment(d, a, b, 1e-7)
}

/// Whether two non-adjacent sides of the polygon cross or touch: the plan reader's own test, so a
/// polygon that passes here is never refused there.
pub fn self_intersects(points: &[P2]) -> bool {
    let n = points.len();
    for i in 0..n {
        for j in i + 1..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            if segments_meet(
                points[i],
                points[(i + 1) % n],
                points[j],
                points[(j + 1) % n],
            ) {
                return true;
            }
        }
    }
    false
}

/// Distance from `p` to the line through `a` and `b` (or to `a` when they are equal).
fn line_distance(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = dx.hypot(dy);
    if len < 1e-12 {
        return (p[0] - a[0]).hypot(p[1] - a[1]);
    }
    ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx).abs() / len
}

/// Removes repeated points and points on a straight line (within `tolerance`).
pub fn clean_polygon(points: &[P2], tolerance: f64) -> Vec<P2> {
    let mut out: Vec<P2> = Vec::with_capacity(points.len());
    for &p in points {
        if out
            .last()
            .is_none_or(|q: &P2| (q[0] - p[0]).hypot(q[1] - p[1]) > tolerance)
        {
            out.push(p);
        }
    }
    while out.len() > 1 {
        let (first, last) = (out[0], out[out.len() - 1]);
        if (first[0] - last[0]).hypot(first[1] - last[1]) <= tolerance {
            out.pop();
        } else {
            break;
        }
    }
    let mut changed = true;
    while changed && out.len() > 3 {
        changed = false;
        let n = out.len();
        for i in 0..n {
            let (a, b, c) = (out[(i + n - 1) % n], out[i], out[(i + 1) % n]);
            if line_distance(b, a, c) <= tolerance {
                out.remove(i);
                changed = true;
                break;
            }
        }
    }
    out
}

/// Douglas–Peucker on a closed polygon, with the tolerance raised until it has at most `max`
/// points.
pub fn simplify_polygon(points: &[P2], max: usize) -> Vec<P2> {
    let mut tolerance = 1.0;
    let mut out = clean_polygon(points, 0.5);
    while out.len() > max && tolerance < 1e6 {
        out = clean_polygon(&out, tolerance);
        tolerance *= 1.6;
    }
    out
}

/// The convex hull (counter-clockwise in a y-up frame).
pub fn convex_hull(points: &[P2]) -> Vec<P2> {
    let mut pts: Vec<P2> = points
        .iter()
        .copied()
        .filter(|p| p.iter().all(|v| v.is_finite()))
        .collect();
    pts.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let mut lower: Vec<P2> = Vec::new();
    for &p in &pts {
        while lower.len() >= 2 && orient(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<P2> = Vec::new();
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && orient(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_compose_and_invert() {
        let a = Transform::frame([10.0, 0.0, 0.0], None, Some([0.0, 1.0, 0.0]));
        assert!(dot(sub(a.point([1.0, 0.0, 0.0]), [10.0, 1.0, 0.0]), [1.0; 3]).abs() < 1e-9);
        let b = Transform::frame([0.0, 5.0, 2.0], None, None);
        let ab = a.then(&b);
        let p = ab.point([1.0, 2.0, 3.0]);
        let back = ab.inverse_rigid().point(p);
        assert!((back[0] - 1.0).abs() < 1e-9 && (back[1] - 2.0).abs() < 1e-9);
    }

    #[test]
    fn polygons() {
        let square = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 5.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 10.0],
        ];
        let clean = clean_polygon(&square, 0.1);
        assert_eq!(clean.len(), 4);
        assert!(point_in_polygon([5.0, 5.0], &clean));
        assert!(!self_intersects(&clean));
        let bow = [[0.0, 0.0], [10.0, 10.0], [10.0, 0.0], [0.0, 10.0]];
        assert!(self_intersects(&bow));
        // Touching counts, as for the plan reader: a corner on a side that is not its neighbour.
        let touching = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [5.0, 0.0],
            [0.0, 10.0],
        ];
        assert!(self_intersects(&touching));
        assert_eq!(convex_hull(&bow).len(), 4);
        let circle: Vec<P2> = (0..200)
            .map(|i| {
                let a = f64::from(i) / 200.0 * std::f64::consts::TAU;
                [100.0 * a.cos(), 100.0 * a.sin()]
            })
            .collect();
        assert!(simplify_polygon(&circle, 64).len() <= 64);
    }
}
