//! 2D polygon helpers in plan coordinates (cm, x right, y down).

/// A point of the plan.
pub type P2 = [f64; 2];

/// Cross product of AB × AC (twice the signed area of ABC).
pub fn cross(a: P2, b: P2, c: P2) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// Twice the signed area: positive when the vertices turn clockwise on screen (y down).
pub fn signed_area2(points: &[P2]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let a = points[i];
            let b = points[(i + 1) % n];
            a[0] * b[1] - b[0] * a[1]
        })
        .sum()
}

/// Unsigned area.
pub fn area(points: &[P2]) -> f64 {
    signed_area2(points).abs() / 2.0
}

/// Whether `p` lies on segment AB (within `eps`).
pub fn on_segment(p: P2, a: P2, b: P2, eps: f64) -> bool {
    cross(a, b, p).abs() <= eps * (b[0] - a[0]).hypot(b[1] - a[1]).max(1.0)
        && p[0] >= a[0].min(b[0]) - eps
        && p[0] <= a[0].max(b[0]) + eps
        && p[1] >= a[1].min(b[1]) - eps
        && p[1] <= a[1].max(b[1]) + eps
}

/// Whether segments AB and CD meet (touching counts when `inclusive`).
pub fn segments_meet(a: P2, b: P2, c: P2, d: P2, inclusive: bool) -> bool {
    let ab1 = cross(a, b, c);
    let ab2 = cross(a, b, d);
    let cd1 = cross(c, d, a);
    let cd2 = cross(c, d, b);
    if ab1 * ab2 < -1e-9 && cd1 * cd2 < -1e-9 {
        return true;
    }
    inclusive
        && (on_segment(a, c, d, 1e-7)
            || on_segment(b, c, d, 1e-7)
            || on_segment(c, a, b, 1e-7)
            || on_segment(d, a, b, 1e-7))
}

/// Whether a closed polygon crosses itself (adjacent sides may share their vertex).
pub fn self_intersects(points: &[P2]) -> bool {
    let n = points.len();
    for i in 0..n {
        for j in (i + 1)..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            if segments_meet(
                points[i],
                points[(i + 1) % n],
                points[j],
                points[(j + 1) % n],
                true,
            ) {
                return true;
            }
        }
    }
    false
}

/// Even-odd point in polygon; a point on the boundary is inside unless `strict`.
pub fn point_in_polygon(p: P2, points: &[P2], strict: bool) -> bool {
    let n = points.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let a = points[j];
        let b = points[i];
        if on_segment(p, a, b, 1e-7) {
            return !strict;
        }
        if (b[1] > p[1]) != (a[1] > p[1])
            && p[0] < (a[0] - b[0]) * (p[1] - b[1]) / (a[1] - b[1]) + b[0]
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Distance from `p` to segment AB.
pub(crate) fn segment_distance(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p[0] - a[0] - dx * t).hypot(p[1] - a[1] - dy * t)
}

/// A point well inside a polygon, where its label goes: the centre of its area when that lies
/// well inside, else about the point farthest from its sides (an L-shaped room's wider arm).
pub fn label_point(points: &[P2]) -> P2 {
    label_point_around(points, &[])
}

/// A point well inside a polygon and out of `holes` (a garden around the home, D-077), where its
/// label goes: as [`label_point`], the holes' sides counted as the polygon's.
pub fn label_point_around(points: &[P2], holes: &[&[P2]]) -> P2 {
    let n = points.len();
    #[allow(clippy::cast_precision_loss)]
    let count = n.max(1) as f64;
    let mean = [
        points.iter().map(|p| p[0]).sum::<f64>() / count,
        points.iter().map(|p| p[1]).sum::<f64>() / count,
    ];
    if n < 3 || points.iter().flatten().any(|v| !v.is_finite()) {
        return mean;
    }
    // How deep a point is inside (negative outside, or in a hole).
    let depth = |p: P2| {
        if !point_in_polygon(p, points, true)
            || holes.iter().any(|hole| point_in_polygon(p, hole, false))
        {
            return -1.0;
        }
        let sides = |poly: &[P2]| {
            let m = poly.len();
            (0..m)
                .map(|i| segment_distance(p, poly[i], poly[(i + 1) % m]))
                .fold(f64::INFINITY, f64::min)
        };
        holes
            .iter()
            .map(|hole| sides(hole))
            .fold(sides(points), f64::min)
    };
    let a2 = signed_area2(points);
    let centre = if a2.abs() > 1e-9 {
        let (mut cx, mut cy) = (0.0, 0.0);
        for i in 0..n {
            let (p, q) = (points[i], points[(i + 1) % n]);
            let k = p[0] * q[1] - q[0] * p[1];
            cx += (p[0] + q[0]) * k;
            cy += (p[1] + q[1]) * k;
        }
        [cx / (3.0 * a2), cy / (3.0 * a2)]
    } else {
        mean
    };
    // The deepest point on a grid over the polygon, refined around the best one found.
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in points {
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let mut best = (centre, depth(centre));
    const STEPS: u32 = 10;
    for _ in 0..4 {
        let step = [
            (hi[0] - lo[0]) / f64::from(STEPS),
            (hi[1] - lo[1]) / f64::from(STEPS),
        ];
        for i in 0..=STEPS {
            for j in 0..=STEPS {
                let p = [
                    lo[0] + step[0] * f64::from(i),
                    lo[1] + step[1] * f64::from(j),
                ];
                let d = depth(p);
                if d > best.1 {
                    best = (p, d);
                }
            }
        }
        let p = best.0;
        lo = [p[0] - step[0], p[1] - step[1]];
        hi = [p[0] + step[0], p[1] + step[1]];
    }
    if best.1 <= 0.0 {
        return mean;
    }
    if depth(centre) >= best.1 * 0.5 {
        centre
    } else {
        best.0
    }
}

/// Unit normal of side `i` (vertex i → i + 1) pointing out of the polygon, whatever the winding.
pub fn outward_normal(points: &[P2], i: usize) -> P2 {
    let n = points.len();
    if n < 2 {
        return [0.0, 0.0];
    }
    let a = points[i % n];
    let b = points[(i + 1) % n];
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = dx.hypot(dy).max(f64::MIN_POSITIVE);
    let sign = if signed_area2(points) >= 0.0 {
        1.0
    } else {
        -1.0
    };
    [sign * dy / len, -sign * dx / len]
}

/// Parameter intervals `[t0, t1]` (0–1) of segment AB inside polygon P (even-odd rule).
pub fn line_inside(polygon: &[P2], a: P2, b: P2) -> Vec<[f64; 2]> {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let n = polygon.len();
    let mut ts = Vec::new();
    for i in 0..n {
        let p = polygon[i];
        let q = polygon[(i + 1) % n];
        let (ex, ey) = (q[0] - p[0], q[1] - p[1]);
        let den = dx * ey - dy * ex;
        if den.abs() < 1e-9 {
            continue;
        }
        let (wx, wy) = (p[0] - a[0], p[1] - a[1]);
        let t = (wx * ey - wy * ex) / den;
        let u = (wx * dy - wy * dx) / den;
        if (0.0..1.0).contains(&u) {
            ts.push(t);
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.chunks_exact(2)
        .filter_map(|pair| {
            let (t0, t1) = (pair[0].max(0.0), pair[1].min(1.0));
            (t1 > t0).then_some([t0, t1])
        })
        .collect()
}

/// Triangulates a simple polygon (ear clipping). Returns index triples into `points`, wound like
/// the polygon. Degenerate input gives fewer triangles, never a panic.
pub fn triangulate(points: &[P2]) -> Vec<[usize; 3]> {
    let n = points.len();
    if n < 3 {
        return Vec::new();
    }
    let clockwise = signed_area2(points) >= 0.0;
    let mut remaining: Vec<usize> = (0..n).collect();
    let mut triangles = Vec::with_capacity(n - 2);
    let convex = |a: P2, b: P2, c: P2| {
        let turn = cross(a, b, c);
        if clockwise {
            turn > 1e-12
        } else {
            turn < -1e-12
        }
    };
    let mut guard = 0;
    while remaining.len() > 3 && guard < n * n {
        guard += 1;
        let m = remaining.len();
        let mut clipped = false;
        for k in 0..m {
            let (ia, ib, ic) = (
                remaining[(k + m - 1) % m],
                remaining[k],
                remaining[(k + 1) % m],
            );
            let (a, b, c) = (points[ia], points[ib], points[ic]);
            if !convex(a, b, c) {
                continue;
            }
            let ear = remaining.iter().all(|&ip| {
                ip == ia || ip == ib || ip == ic || !point_in_triangle(points[ip], a, b, c)
            });
            if ear {
                triangles.push([ia, ib, ic]);
                remaining.remove(k);
                clipped = true;
                break;
            }
        }
        if !clipped {
            // Degenerate (collinear or touching) polygon: drop the flattest vertex and go on.
            let m = remaining.len();
            let flattest = (0..m)
                .min_by(|&x, &y| {
                    let turn = |k: usize| {
                        cross(
                            points[remaining[(k + m - 1) % m]],
                            points[remaining[k]],
                            points[remaining[(k + 1) % m]],
                        )
                        .abs()
                    };
                    turn(x).total_cmp(&turn(y))
                })
                .unwrap_or(0);
            remaining.remove(flattest);
        }
    }
    if remaining.len() == 3 {
        triangles.push([remaining[0], remaining[1], remaining[2]]);
    }
    triangles
}

fn point_in_triangle(p: P2, a: P2, b: P2, c: P2) -> bool {
    let d1 = cross(a, b, p);
    let d2 = cross(b, c, p);
    let d3 = cross(c, a, p);
    let negative = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    let positive = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    !(negative && positive)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [P2; 4] = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];

    #[test]
    fn labels_go_well_inside() {
        // A square: its centre.
        assert_eq!(label_point(&SQUARE), [50.0, 50.0]);
        // An L: the centre of its area is near the inner corner; the label goes in an arm.
        let l = [
            [0.0, 0.0],
            [400.0, 0.0],
            [400.0, 100.0],
            [100.0, 100.0],
            [100.0, 400.0],
            [0.0, 400.0],
        ];
        let p = label_point(&l);
        assert!(point_in_polygon(p, &l, true));
        let depth = [p[0], p[1], 400.0 - p[0], 100.0 - p[1]]
            .into_iter()
            .fold(f64::INFINITY, f64::min);
        let in_top_arm = p[1] < 100.0 && depth > 40.0;
        let in_left_arm = p[0] < 100.0 && p[1].min(400.0 - p[1]).min(p[0]).min(100.0 - p[0]) > 40.0;
        assert!(in_top_arm || in_left_arm, "{p:?}");
        // Degenerate: the mean of the points.
        assert_eq!(label_point(&[[0.0, 0.0], [10.0, 0.0]]), [5.0, 0.0]);
    }

    #[test]
    fn areas_and_normals() {
        assert_eq!(area(&SQUARE), 10_000.0);
        // Clockwise on screen (y down): the top side's outward normal points up (−y).
        assert_eq!(outward_normal(&SQUARE, 0), [0.0, -1.0]);
        assert_eq!(outward_normal(&SQUARE, 1), [1.0, 0.0]);
        let reversed: Vec<P2> = SQUARE.iter().rev().copied().collect();
        // Reversed winding: side 0 is now the bottom side, whose outward normal points down.
        assert_eq!(outward_normal(&reversed, 0), [0.0, 1.0]);
    }

    #[test]
    fn point_in_polygon_and_boundary() {
        assert!(point_in_polygon([50.0, 50.0], &SQUARE, false));
        assert!(!point_in_polygon([150.0, 50.0], &SQUARE, false));
        assert!(point_in_polygon([0.0, 50.0], &SQUARE, false));
        assert!(!point_in_polygon([0.0, 50.0], &SQUARE, true));
    }

    #[test]
    fn self_intersection() {
        assert!(!self_intersects(&SQUARE));
        let bow_tie = [[0.0, 0.0], [100.0, 100.0], [100.0, 0.0], [0.0, 100.0]];
        assert!(self_intersects(&bow_tie));
    }

    #[test]
    fn line_inside_square() {
        let parts = line_inside(&SQUARE, [-50.0, 50.0], [150.0, 50.0]);
        assert_eq!(parts.len(), 1);
        assert!((parts[0][0] - 0.25).abs() < 1e-9 && (parts[0][1] - 0.75).abs() < 1e-9);
    }

    #[test]
    fn triangulates_concave_polygons() {
        let l_shape = [
            [0.0, 0.0],
            [200.0, 0.0],
            [200.0, 100.0],
            [100.0, 100.0],
            [100.0, 200.0],
            [0.0, 200.0],
        ];
        let triangles = triangulate(&l_shape);
        assert_eq!(triangles.len(), 4);
        let total: f64 = triangles
            .iter()
            .map(|t| area(&[l_shape[t[0]], l_shape[t[1]], l_shape[t[2]]]))
            .sum();
        assert!((total - area(&l_shape)).abs() < 1e-6);
        assert!(triangulate(&[[0.0, 0.0], [1.0, 1.0]]).is_empty());
        let collinear = [
            [0.0, 0.0],
            [50.0, 0.0],
            [100.0, 0.0],
            [100.0, 100.0],
            [0.0, 100.0],
        ];
        let total: f64 = triangulate(&collinear)
            .iter()
            .map(|t| area(&[collinear[t[0]], collinear[t[1]], collinear[t[2]]]))
            .sum();
        assert!((total - 10_000.0).abs() < 1e-6);
    }
}
