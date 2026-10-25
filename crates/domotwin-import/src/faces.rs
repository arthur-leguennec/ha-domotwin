//! Rooms from lines: the faces of the drawing the lines make once cut where they cross. A file
//! that draws walls (their centre lines) or the outlines of rooms, but no rooms, gets its rooms
//! here: every bounded face, inside the walls around it.

use std::collections::HashMap;

use crate::math::{P2, interior_point, point_in_polygon, signed_area2};

/// Most segments put together; past it, the first ones.
const MAX_SEGMENTS: usize = 20_000;
/// Points nearer than this (cm) are one.
const SNAP: f64 = 1.0;
/// Farthest coordinate read from the drawing's lowest corner (cm): beyond any plan.
const FAR: f64 = 10_000_000.0;

/// A segment and how thick the wall it draws is (cm).
type Segment = (P2, P2, f64);

/// The faces of the drawing the segments make, each with the thickness of the wall along each of
/// its sides: counter-clockwise outlines (positive area, `x` right and `y` up, the plan's `y` down
/// making them clockwise on the page), bounded, without spikes.
pub(crate) fn faces(segments: &[Segment]) -> Vec<(Vec<P2>, Vec<f64>)> {
    // From the lowest corner: a drawing placed on a map, far from its origin, is read as well.
    let origin = segments
        .iter()
        .take(MAX_SEGMENTS)
        .flat_map(|(a, b, _)| [a, b])
        .filter(|p| p.iter().all(|v| v.is_finite()))
        .fold([f64::INFINITY; 2], |o, p| [o[0].min(p[0]), o[1].min(p[1])]);
    let origin = if origin[0].is_finite() {
        origin
    } else {
        [0.0, 0.0]
    };
    let segments: Vec<Segment> = segments
        .iter()
        .take(MAX_SEGMENTS)
        .map(|(a, b, t)| {
            let local = |p: &P2| [p[0] - origin[0], p[1] - origin[1]];
            (local(a), local(b), *t)
        })
        .filter(|(a, b, t)| {
            a.iter().chain(b).all(|v| v.is_finite() && v.abs() < FAR)
                && t.is_finite()
                && (b[0] - a[0]).hypot(b[1] - a[1]) >= SNAP
        })
        .collect();
    // Where each segment is cut: its ends, where others cross it or end on it.
    let mut cuts: Vec<Vec<f64>> = vec![vec![0.0, 1.0]; segments.len()];
    // Pairs that may meet, swept from left to right.
    let left: Vec<f64> = segments.iter().map(|(a, b, _)| a[0].min(b[0])).collect();
    let mut order: Vec<usize> = (0..segments.len()).collect();
    order.sort_by(|&i, &j| left[i].total_cmp(&left[j]));
    for (n, &i) in order.iter().enumerate() {
        let right = segments[i].0[0].max(segments[i].1[0]) + SNAP;
        for &j in &order[n + 1..] {
            if left[j] > right {
                break;
            }
            let ((a, b, _), (c, d, _)) = (segments[i], segments[j]);
            if a[1].max(b[1]) + SNAP < c[1].min(d[1]) || c[1].max(d[1]) + SNAP < a[1].min(b[1]) {
                continue;
            }
            if let Some((t, u)) = crossing(a, b, c, d) {
                cuts[i].push(t);
                cuts[j].push(u);
            }
            for (k, p, (s, e)) in [
                (i, c, (a, b)),
                (i, d, (a, b)),
                (j, a, (c, d)),
                (j, b, (c, d)),
            ] {
                if let Some(t) = on_segment(p, s, e) {
                    cuts[k].push(t);
                }
            }
        }
    }
    // The points, merged within `SNAP`, and the edges between them.
    let mut points: Vec<P2> = Vec::new();
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    let mut point = |p: P2| -> usize {
        #[allow(clippy::cast_possible_truncation)]
        let cell = ((p[0] / SNAP).floor() as i64, (p[1] / SNAP).floor() as i64);
        for dx in -1..=1 {
            for dy in -1..=1 {
                let near = (cell.0.saturating_add(dx), cell.1.saturating_add(dy));
                for &k in grid.get(&near).into_iter().flatten() {
                    if (points[k][0] - p[0]).hypot(points[k][1] - p[1]) < SNAP {
                        return k;
                    }
                }
            }
        }
        points.push(p);
        grid.entry(cell).or_default().push(points.len() - 1);
        points.len() - 1
    };
    let mut edges: HashMap<(usize, usize), f64> = HashMap::new();
    for (k, (a, b, thickness)) in segments.iter().enumerate() {
        let ts = &mut cuts[k];
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
        let at = |t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for w in ts.windows(2) {
            let (u, v) = (point(at(w[0])), point(at(w[1])));
            if u != v {
                let key = (u.min(v), u.max(v));
                let t = edges.entry(key).or_insert(*thickness);
                *t = t.max(*thickness);
            }
        }
    }
    // Each point's edges, by angle; a face goes on with the edge just clockwise of the one it
    // came by, which keeps it on its left.
    let mut around: Vec<Vec<usize>> = vec![Vec::new(); points.len()];
    for &(u, v) in edges.keys() {
        around[u].push(v);
        around[v].push(u);
    }
    for (u, list) in around.iter_mut().enumerate() {
        let p = points[u];
        list.sort_by(|&a, &b| {
            let angle = |q: P2| (q[1] - p[1]).atan2(q[0] - p[0]);
            angle(points[a])
                .total_cmp(&angle(points[b]))
                .then(a.cmp(&b))
        });
    }
    let mut seen: HashMap<(usize, usize), ()> = HashMap::new();
    let mut found = Vec::new();
    for start in 0..points.len() {
        for &first in &around[start] {
            if seen.contains_key(&(start, first)) {
                continue;
            }
            let mut cycle = vec![start];
            let (mut u, mut v) = (start, first);
            let mut steps = 0;
            loop {
                seen.insert((u, v), ());
                let list = &around[v];
                let back = list.iter().position(|&w| w == u).unwrap_or(0);
                let next = list[(back + list.len() - 1) % list.len()];
                (u, v) = (v, next);
                if u == start && v == first {
                    break;
                }
                cycle.push(u);
                steps += 1;
                if steps > edges.len() * 2 {
                    break;
                }
            }
            let cycle = without_spikes(cycle);
            if cycle.len() < 3 {
                continue;
            }
            // From its top left corner, whatever order the lines came in.
            let first = (0..cycle.len())
                .min_by(|&i, &j| {
                    let (p, q) = (points[cycle[i]], points[cycle[j]]);
                    p[1].total_cmp(&q[1]).then(p[0].total_cmp(&q[0]))
                })
                .unwrap_or(0);
            let mut cycle = cycle;
            cycle.rotate_left(first);
            let outline: Vec<P2> = cycle
                .iter()
                .map(|&k| [points[k][0] + origin[0], points[k][1] + origin[1]])
                .collect();
            if signed_area2(&outline) <= 0.0 {
                continue;
            }
            let n = cycle.len();
            let thickness = (0..n)
                .map(|i| {
                    let (a, b) = (cycle[i], cycle[(i + 1) % n]);
                    edges.get(&(a.min(b), a.max(b))).copied().unwrap_or(0.0)
                })
                .collect();
            found.push((outline, thickness));
        }
    }
    // In reading order: top to bottom, then left to right.
    found.sort_by(|(a, _), (b, _)| {
        a[0][1]
            .total_cmp(&b[0][1])
            .then(a[0][0].total_cmp(&b[0][0]))
    });
    found
}

/// The rooms the walls (centre lines and thicknesses) enclose, each inside its walls.
pub(crate) fn rooms_between_walls(walls: &[Segment]) -> Vec<Vec<P2>> {
    // A wall ending at another's face rather than its centre line (as drawn) reaches it: each
    // goes on by the thickest wall at both ends, what goes past is left dangling.
    let reach = walls
        .iter()
        .map(|w| w.2)
        .filter(|t| t.is_finite())
        .fold(0.0, f64::max)
        .min(60.0);
    let walls: Vec<Segment> = walls
        .iter()
        .map(|&(a, b, t)| {
            let d = [b[0] - a[0], b[1] - a[1]];
            let len = d[0].hypot(d[1]);
            if !(len >= SNAP && reach > 0.0) {
                return (a, b, t);
            }
            let u = [d[0] / len * reach, d[1] / len * reach];
            ([a[0] - u[0], a[1] - u[1]], [b[0] + u[0], b[1] + u[1]], t)
        })
        .collect();
    let found = faces(&walls);
    let keep = rooms_only(&found.iter().map(|(o, _)| o.clone()).collect::<Vec<_>>());
    found
        .into_iter()
        .zip(keep)
        .filter(|(_, keep)| *keep)
        .filter_map(|((outline, thickness), _)| {
            let inside = inset(&outline, &thickness);
            (inside.len() >= 3 && signed_area2(&inside) > 0.0).then_some(inside)
        })
        .collect()
}

/// Which faces are rooms, of faces drawn inside others: not the face around most of the others
/// (a building's outline drawn round its rooms), nor a small closed shape inside a room (a table,
/// a stair well, a column drawn with lines).
pub(crate) fn rooms_only(outlines: &[Vec<P2>]) -> Vec<bool> {
    let n = outlines.len();
    let areas: Vec<f64> = outlines
        .iter()
        .map(|o| signed_area2(o).abs() / 2.0)
        .collect();
    let inner_points: Vec<P2> = outlines.iter().map(|o| interior_point(o)).collect();
    let boxes: Vec<[f64; 4]> = outlines
        .iter()
        .map(|o| {
            o.iter().fold(
                [
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                ],
                |b, p| {
                    [
                        b[0].min(p[0]),
                        b[1].min(p[1]),
                        b[2].max(p[0]),
                        b[3].max(p[1]),
                    ]
                },
            )
        })
        .collect();
    let inside: Vec<Vec<usize>> = (0..n)
        .map(|k| {
            let [lo_x, lo_y, hi_x, hi_y] = boxes[k];
            (0..n)
                .filter(|&j| {
                    let p = inner_points[j];
                    j != k
                        && areas[j] < areas[k]
                        && (lo_x..=hi_x).contains(&p[0])
                        && (lo_y..=hi_y).contains(&p[1])
                        && point_in_polygon(p, &outlines[k])
                })
                .collect()
        })
        .collect();
    let mut keep = vec![true; n];
    for k in 0..n {
        let covered: f64 = inside[k].iter().map(|&j| areas[j]).sum();
        if inside[k].is_empty() {
            continue;
        }
        if covered >= areas[k] / 2.0 {
            keep[k] = false;
        } else {
            for &j in &inside[k] {
                keep[j] = false;
            }
        }
    }
    keep
}

/// A counter-clockwise outline moved in by half the thickness of each side.
fn inset(points: &[P2], thickness: &[f64]) -> Vec<P2> {
    let n = points.len();
    let line = |i: usize| -> (P2, P2) {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let d = [b[0] - a[0], b[1] - a[1]];
        let len = d[0].hypot(d[1]).max(1e-12);
        let o = thickness[i] / 2.0;
        // Inside a counter-clockwise outline is on the left.
        ([a[0] - d[1] / len * o, a[1] + d[0] / len * o], d)
    };
    (0..n)
        .map(|k| {
            let (p1, d1) = line((k + n - 1) % n);
            let (p2, d2) = line(k);
            let den = d1[0] * d2[1] - d1[1] * d2[0];
            if den.abs() <= 1e-9 * d1[0].hypot(d1[1]) * d2[0].hypot(d2[1]) {
                return p2;
            }
            let t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
            [p1[0] + d1[0] * t, p1[1] + d1[1] * t]
        })
        .collect()
}

/// Removes the out-and-back steps a dangling line leaves in a face (`a, b, a`).
fn without_spikes(mut cycle: Vec<usize>) -> Vec<usize> {
    let mut changed = true;
    while changed && cycle.len() >= 3 {
        changed = false;
        let n = cycle.len();
        for i in 0..n {
            if cycle[(i + n - 1) % n] == cycle[(i + 1) % n] {
                let (a, b) = (i.max((i + 1) % n), i.min((i + 1) % n));
                cycle.remove(a);
                cycle.remove(b);
                changed = true;
                break;
            }
        }
    }
    cycle
}

/// Where segments `a`–`b` and `c`–`d` cross, as fractions along each, strictly inside both.
fn crossing(a: P2, b: P2, c: P2, d: P2) -> Option<(f64, f64)> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let den = r[0] * s[1] - r[1] * s[0];
    if den.abs() < 1e-9 * r[0].hypot(r[1]) * s[0].hypot(s[1]) {
        return None;
    }
    let q = [c[0] - a[0], c[1] - a[1]];
    let t = (q[0] * s[1] - q[1] * s[0]) / den;
    let u = (q[0] * r[1] - q[1] * r[0]) / den;
    let inside = |v: f64| v > 1e-9 && v < 1.0 - 1e-9;
    (inside(t) && inside(u)).then_some((t, u))
}

/// Where `p` lies on segment `a`–`b` (within `SNAP`), as a fraction strictly inside it.
fn on_segment(p: P2, a: P2, b: P2) -> Option<f64> {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len2 = d[0] * d[0] + d[1] * d[1];
    if len2 < 1e-12 {
        return None;
    }
    let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2;
    let len = len2.sqrt();
    if t * len <= SNAP || (1.0 - t) * len <= SNAP {
        return None;
    }
    let off = ((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]).abs() / len;
    (off < SNAP).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(points: &[P2]) -> f64 {
        signed_area2(points) / 2.0
    }

    #[test]
    fn walls_crossing_and_meeting_make_rooms() {
        // A 6 × 4 m box cut by a partition ending on both façades, and a wall sticking out.
        let walls = [
            ([0.0, 0.0], [600.0, 0.0], 20.0),
            ([600.0, 0.0], [600.0, 400.0], 20.0),
            ([600.0, 400.0], [0.0, 400.0], 20.0),
            ([0.0, 400.0], [0.0, 0.0], 20.0),
            ([350.0, 0.0], [350.0, 400.0], 10.0),
            ([600.0, 200.0], [800.0, 200.0], 10.0),
        ];
        let found = faces(&walls);
        let mut areas: Vec<f64> = found.iter().map(|(p, _)| area(p)).collect();
        areas.sort_by(f64::total_cmp);
        assert_eq!(areas, [100_000.0, 140_000.0]);
        let rooms = rooms_between_walls(&walls);
        let mut inside: Vec<f64> = rooms.iter().map(|p| area(p)).collect();
        inside.sort_by(f64::total_cmp);
        // 235 × 380 and 335 × 380.
        assert!((inside[0] - 89_300.0).abs() < 1e-6, "{inside:?}");
        assert!((inside[1] - 127_300.0).abs() < 1e-6, "{inside:?}");
    }

    #[test]
    fn crossing_lines_and_nothing_closed() {
        // Two lines crossing, and an open corner: no face.
        assert!(
            faces(&[
                ([0.0, 0.0], [100.0, 100.0], 10.0),
                ([0.0, 100.0], [100.0, 0.0], 10.0)
            ])
            .is_empty()
        );
        assert!(
            faces(&[
                ([0.0, 0.0], [100.0, 0.0], 10.0),
                ([100.0, 0.0], [100.0, 100.0], 10.0)
            ])
            .is_empty()
        );
        assert!(faces(&[]).is_empty());
        assert!(faces(&[([f64::NAN, 0.0], [1.0, 0.0], 1.0)]).is_empty());
    }
}
