//! Rooms from cells (`DECISIONS.md`, D-063): a robot vacuum's map is cells already, and a mesh
//! scan is cut into them. A mask of cells, the distance from its cells, its parts, and a room's
//! outline from its cells: traced, simplified, then squared to the walls.

use std::collections::{HashMap, VecDeque};

use crate::math::{P2, clean_polygon, self_intersects, signed_area2};

/// Larger than any squared distance of a grid: no set cell.
const FAR: f64 = 1e12;
/// Edges this close to an axis (degrees) are squared to it.
const SQUARE_WITHIN: f64 = 20.0;

/// A grid of cells, `w` × `h`, row by row; cell `(x, y)` covers `[x, x + 1] × [y, y + 1]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Mask {
    pub(crate) w: usize,
    pub(crate) h: usize,
    pub(crate) cells: Vec<bool>,
}

impl Mask {
    pub(crate) fn new(w: usize, h: usize) -> Self {
        Mask {
            w,
            h,
            cells: vec![false; w * h],
        }
    }

    /// The index of a cell inside the grid.
    pub(crate) fn index(&self, x: i64, y: i64) -> Option<usize> {
        let (x, y) = (usize::try_from(x).ok()?, usize::try_from(y).ok()?);
        (x < self.w && y < self.h).then(|| y * self.w + x)
    }

    /// Whether a cell is set (outside the grid: not).
    pub(crate) fn get(&self, x: i64, y: i64) -> bool {
        self.index(x, y).is_some_and(|i| self.cells[i])
    }

    /// Sets a cell; outside the grid, nothing.
    pub(crate) fn set(&mut self, x: i64, y: i64) {
        if let Some(i) = self.index(x, y) {
            self.cells[i] = true;
        }
    }

    #[cfg(test)]
    pub(crate) fn count(&self) -> usize {
        self.cells.iter().filter(|c| **c).count()
    }

    /// The cells set in either.
    pub(crate) fn or(&self, other: &Mask) -> Mask {
        let mut out = self.clone();
        for (c, o) in out.cells.iter_mut().zip(&other.cells) {
            *c |= *o;
        }
        out
    }

    /// The cells set here and not in `other`.
    pub(crate) fn minus(&self, other: &Mask) -> Mask {
        let mut out = self.clone();
        for (c, o) in out.cells.iter_mut().zip(&other.cells) {
            *c &= !*o;
        }
        out
    }

    /// The cells within `r` cells of a set cell.
    pub(crate) fn dilate(&self, r: f64) -> Mask {
        let d = distances(self);
        Mask {
            w: self.w,
            h: self.h,
            cells: d.iter().map(|&d| f64::from(d) <= r + 1e-6).collect(),
        }
    }

    /// The set cells farther than `r` cells from every unset one, the outside of the grid
    /// unset.
    pub(crate) fn erode(&self, r: f64) -> Mask {
        // The unset cells, with a border of them around the grid.
        let (w, h) = (self.w + 2, self.h + 2);
        let mut unset = Mask::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let inside = x >= 1 && y >= 1 && x <= self.w && y <= self.h;
                unset.cells[y * w + x] = !inside || !self.cells[(y - 1) * self.w + (x - 1)];
            }
        }
        let d = distances(&unset);
        let mut out = Mask::new(self.w, self.h);
        for y in 0..self.h {
            for x in 0..self.w {
                out.cells[y * self.w + x] = f64::from(d[(y + 1) * w + x + 1]) > r + 1e-6;
            }
        }
        out
    }

    /// Dilated then eroded: gaps and notches narrower than `2 × r` cells are filled.
    pub(crate) fn close(&self, r: f64) -> Mask {
        self.dilate(r).erode(r)
    }

    /// The holes filled: every unset cell the border does not reach through unset cells is set.
    pub(crate) fn fill_holes(&self) -> Mask {
        let (w, h) = (self.w, self.h);
        let mut outside = vec![false; w * h];
        let mut queue = VecDeque::new();
        for y in 0..h {
            for x in 0..w {
                if (x == 0 || y == 0 || x + 1 == w || y + 1 == h) && !self.cells[y * w + x] {
                    outside[y * w + x] = true;
                    queue.push_back((x, y));
                }
            }
        }
        while let Some((x, y)) = queue.pop_front() {
            for (nx, ny) in neighbours(x, y, w, h) {
                let i = ny * w + nx;
                if !outside[i] && !self.cells[i] {
                    outside[i] = true;
                    queue.push_back((nx, ny));
                }
            }
        }
        Mask {
            w,
            h,
            cells: outside.iter().map(|o| !o).collect(),
        }
    }

    /// Marks the cells a triangle covers (coordinates in cells): those whose centre is inside it,
    /// and the one its own centre is in, so that a mesh finer than the cells covers them all
    /// (its corners may be past the edge of what it draws). Returns how many cells it looked at.
    pub(crate) fn fill_triangle(&mut self, a: P2, b: P2, c: P2) -> usize {
        if ![a, b, c].iter().flatten().all(|v| v.is_finite()) {
            return 0;
        }
        self.set(
            cell_of((a[0] + b[0] + c[0]) / 3.0),
            cell_of((a[1] + b[1] + c[1]) / 3.0),
        );
        let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if area.abs() < 1e-12 {
            return 1;
        }
        let lo_x = cell_of(a[0].min(b[0]).min(c[0])).max(0);
        let hi_x = cell_of(a[0].max(b[0]).max(c[0])).min(self.w as i64 - 1);
        let lo_y = cell_of(a[1].min(b[1]).min(c[1])).max(0);
        let hi_y = cell_of(a[1].max(b[1]).max(c[1])).min(self.h as i64 - 1);
        let edge =
            |p: P2, q: P2, r: P2| (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        let mut looked = 1;
        for y in lo_y..=hi_y {
            for x in lo_x..=hi_x {
                looked += 1;
                #[allow(clippy::cast_precision_loss)]
                let p = [x as f64 + 0.5, y as f64 + 0.5];
                let (e0, e1, e2) = (edge(a, b, p), edge(b, c, p), edge(c, a, p));
                if (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0) {
                    self.set(x, y);
                }
            }
        }
        looked
    }

    /// Marks the cells a segment goes through (coordinates in cells). Returns how many points
    /// it looked at.
    pub(crate) fn draw_segment(&mut self, a: P2, b: P2) -> usize {
        if ![a, b].iter().flatten().all(|v| v.is_finite()) {
            return 0;
        }
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        // Every half cell: no cell crossed is missed by more than a corner.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let steps = ((len * 2.0).ceil() as usize).clamp(1, 1_000_000);
        for k in 0..=steps {
            #[allow(clippy::cast_precision_loss)]
            let t = k as f64 / steps as f64;
            self.set(
                cell_of(a[0] + (b[0] - a[0]) * t),
                cell_of(a[1] + (b[1] - a[1]) * t),
            );
        }
        steps + 1
    }
}

/// The cell a coordinate (in cells) falls in.
pub(crate) fn cell_of(v: f64) -> i64 {
    #[allow(clippy::cast_possible_truncation)]
    let c = v.floor().clamp(-1e15, 1e15) as i64;
    c
}

/// The 4 neighbours of a cell inside the grid.
fn neighbours(x: usize, y: usize, w: usize, h: usize) -> impl Iterator<Item = (usize, usize)> {
    let mut out = [(usize::MAX, usize::MAX); 4];
    if x > 0 {
        out[0] = (x - 1, y);
    }
    if x + 1 < w {
        out[1] = (x + 1, y);
    }
    if y > 0 {
        out[2] = (x, y - 1);
    }
    if y + 1 < h {
        out[3] = (x, y + 1);
    }
    out.into_iter().filter(|c| c.0 != usize::MAX)
}

/// The distance (cells) from each cell to the nearest set cell, exact (Felzenszwalb and
/// Huttenlocher's transform, by rows then by columns); very large where none is set.
pub(crate) fn distances(mask: &Mask) -> Vec<f32> {
    let (w, h) = (mask.w, mask.h);
    let mut grid: Vec<f64> = mask
        .cells
        .iter()
        .map(|&c| if c { 0.0 } else { FAR })
        .collect();
    let n = w.max(h);
    let mut f = vec![0.0; n];
    let mut out = vec![0.0; n];
    let mut v = vec![0_usize; n];
    let mut z = vec![0.0; n + 1];
    for x in 0..w {
        for y in 0..h {
            f[y] = grid[y * w + x];
        }
        transform(&f[..h], &mut out[..h], &mut v, &mut z);
        for y in 0..h {
            grid[y * w + x] = out[y];
        }
    }
    for y in 0..h {
        f[..w].copy_from_slice(&grid[y * w..(y + 1) * w]);
        transform(&f[..w], &mut out[..w], &mut v, &mut z);
        grid[y * w..(y + 1) * w].copy_from_slice(&out[..w]);
    }
    #[allow(clippy::cast_possible_truncation)]
    grid.into_iter().map(|d| d.sqrt() as f32).collect()
}

/// The squared distance transform of one line: `out[q]` = min over `p` of `(q − p)² + f[p]`.
#[allow(clippy::cast_precision_loss)]
fn transform(f: &[f64], out: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let mut k = 0;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let qf = q as f64;
        loop {
            let pf = v[k] as f64;
            let s = ((f[q] + qf * qf) - (f[v[k]] + pf * pf)) / (2.0 * (qf - pf));
            if s <= z[k] && k > 0 {
                k -= 1;
                continue;
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
            break;
        }
    }
    k = 0;
    for (q, o) in out.iter_mut().enumerate() {
        let qf = q as f64;
        while z[k + 1] < qf {
            k += 1;
        }
        let d = qf - v[k] as f64;
        *o = d * d + f[v[k]];
    }
}

/// The parts of a mask (cells joined by a side): a label for each cell (0 for an unset one, the
/// parts from 1) and each part's cells, in reading order.
pub(crate) fn parts(mask: &Mask) -> (Vec<u32>, Vec<Vec<usize>>) {
    let (w, h) = (mask.w, mask.h);
    let mut labels = vec![0_u32; w * h];
    let mut found: Vec<Vec<usize>> = Vec::new();
    let mut queue = VecDeque::new();
    for start in 0..w * h {
        if !mask.cells[start] || labels[start] != 0 {
            continue;
        }
        let label = u32::try_from(found.len() + 1).unwrap_or(u32::MAX);
        let mut cells = vec![start];
        labels[start] = label;
        queue.push_back(start);
        while let Some(i) = queue.pop_front() {
            for (nx, ny) in neighbours(i % w, i / w, w, h) {
                let j = ny * w + nx;
                if mask.cells[j] && labels[j] == 0 {
                    labels[j] = label;
                    cells.push(j);
                    queue.push_back(j);
                }
            }
        }
        found.push(cells);
    }
    (labels, found)
}

/// The outline of the set cells, by their corners (cell `(x, y)` has its top left corner at
/// `(x, y)`), clockwise on the plan (positive area in its `y`-down frame): of the loops, the one
/// of the largest area. Cells touching by a corner only are apart.
pub(crate) fn outline(mask: &Mask) -> Vec<P2> {
    let (w, h) = (mask.w, mask.h);
    let set = |x: i64, y: i64| mask.get(x, y);
    // Each cell's sides facing an unset cell, the cell on their right as they go.
    let mut edges: HashMap<(i64, i64), Vec<(i64, i64)>> = HashMap::new();
    let mut count = 0_usize;
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            if !set(x, y) {
                continue;
            }
            let mut add = |a: (i64, i64), b: (i64, i64)| {
                edges.entry(a).or_default().push(b);
                count += 1;
            };
            if !set(x, y - 1) {
                add((x, y), (x + 1, y));
            }
            if !set(x + 1, y) {
                add((x + 1, y), (x + 1, y + 1));
            }
            if !set(x, y + 1) {
                add((x + 1, y + 1), (x, y + 1));
            }
            if !set(x - 1, y) {
                add((x, y + 1), (x, y));
            }
        }
    }
    let mut starts: Vec<(i64, i64)> = edges.keys().copied().collect();
    starts.sort_unstable_by_key(|&(x, y)| (y, x));
    let mut best: Vec<P2> = Vec::new();
    let mut best_area = 0.0;
    for start in starts {
        while let Some(first) = edges.get_mut(&start).and_then(Vec::pop) {
            let mut corners: Vec<P2> = Vec::new();
            let (mut at, mut next) = (start, first);
            let mut steps = 0;
            loop {
                let dir = (next.0 - at.0, next.1 - at.1);
                at = next;
                if at == start {
                    break;
                }
                let Some(out) = edges.get_mut(&at) else { break };
                // A right turn first, then straight on, then left: around the cell on the right.
                let rank = |to: &(i64, i64)| {
                    let d = (to.0 - at.0, to.1 - at.1);
                    if d == (-dir.1, dir.0) {
                        0
                    } else if d == dir {
                        1
                    } else {
                        2
                    }
                };
                let Some(k) = (0..out.len()).min_by_key(|&k| rank(&out[k])) else {
                    break;
                };
                next = out.swap_remove(k);
                let turned = (next.0 - at.0, next.1 - at.1) != dir;
                if turned {
                    #[allow(clippy::cast_precision_loss)]
                    corners.push([at.0 as f64, at.1 as f64]);
                }
                steps += 1;
                if steps > count {
                    break;
                }
            }
            // The start, when the loop turns there.
            if let Some(&last) = corners.last() {
                #[allow(clippy::cast_precision_loss)]
                let (s, after) = (
                    [start.0 as f64, start.1 as f64],
                    [first.0 as f64, first.1 as f64],
                );
                let cross =
                    (s[0] - last[0]) * (after[1] - s[1]) - (s[1] - last[1]) * (after[0] - s[0]);
                if cross.abs() > 1e-9 {
                    corners.insert(0, s);
                }
            }
            let area = signed_area2(&corners);
            if corners.len() >= 4 && area > best_area {
                best_area = area;
                best = corners;
            }
        }
    }
    best
}

/// Douglas and Peucker's simplification of a closed outline: the fewest corners within
/// `tolerance` of it.
pub(crate) fn simplify(points: &[P2], tolerance: f64) -> Vec<P2> {
    let n = points.len();
    if n < 4 {
        return points.to_vec();
    }
    // From the first corner and the one farthest from it, each half on its own.
    let far = (1..n)
        .max_by(|&i, &j| {
            let d = |k: usize| (points[k][0] - points[0][0]).hypot(points[k][1] - points[0][1]);
            d(i).total_cmp(&d(j))
        })
        .unwrap_or(n / 2);
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[far] = true;
    let mut stack = vec![(0, far), (far, n)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (p, q) = (points[a], points[b % n]);
        let (mut worst, mut at) = (0.0, a);
        for (k, point) in points.iter().enumerate().take(b).skip(a + 1) {
            let d = distance_to_segment(*point, p, q);
            if d > worst {
                worst = d;
                at = k;
            }
        }
        if worst > tolerance {
            keep[at] = true;
            stack.push((a, at));
            stack.push((at, b));
        }
    }
    points
        .iter()
        .zip(keep)
        .filter_map(|(p, k)| k.then_some(*p))
        .collect()
}

fn distance_to_segment(m: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 < 1e-12 {
        0.0
    } else {
        (((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    };
    (m[0] - a[0] - dx * t).hypot(m[1] - a[1] - dy * t)
}

/// A side of an outline being squared: along `x` (`y` fixed), along `y` (`x` fixed), or slanted,
/// kept as it is. `weight` is how much it counts where it is put: its length, but nothing for
/// the part of a side lying in a doorway (a robot's room reaches into it).
#[derive(Debug, Clone, Copy, PartialEq)]
enum Run {
    AlongX { y: f64, length: f64, weight: f64 },
    AlongY { x: f64, length: f64, weight: f64 },
    Slanted { from: P2, to: P2 },
}

impl Run {
    fn length(self) -> f64 {
        match self {
            Run::AlongX { length, .. } | Run::AlongY { length, .. } => length,
            Run::Slanted { from, to } => (to[0] - from[0]).hypot(to[1] - from[1]),
        }
    }
}

/// Where two sides along one axis are put: weighed, else by length.
fn mean_of(v1: f64, w1: f64, l1: f64, v2: f64, w2: f64, l2: f64) -> f64 {
    if w1 + w2 > 0.0 {
        (v1 * w1 + v2 * w2) / (w1 + w2)
    } else if l1 + l2 > 0.0 {
        (v1 * l1 + v2 * l2) / (l1 + l2)
    } else {
        v1
    }
}

/// An outline squared to the axes: its sides within 20° of an axis are put on it, each at the
/// mean of its corners weighed by length, and steps shorter than `step` (slanted ones up to
/// twice as long) are flattened. The parts of sides along `doors` (segments) do not count where
/// a side is put. Returns the outline as it was when squaring would make it cross itself or
/// change its area much.
pub(crate) fn square(points: &[P2], step: f64, doors: &[(P2, P2)]) -> Vec<P2> {
    let n = points.len();
    if n < 3 {
        return points.to_vec();
    }
    let slope = SQUARE_WITHIN.to_radians().tan();
    // How much of a side along an axis lies in a doorway.
    let in_doors = |a: P2, b: P2, axis: usize| -> f64 {
        let (lo, hi) = (a[axis].min(b[axis]), a[axis].max(b[axis]));
        let at = (a[1 - axis] + b[1 - axis]) / 2.0;
        doors
            .iter()
            .filter(|(p, q)| {
                (p[1 - axis] - q[1 - axis]).abs() < 1.0
                    && ((p[1 - axis] + q[1 - axis]) / 2.0 - at).abs() <= step
            })
            .map(|(p, q)| {
                let (dlo, dhi) = (p[axis].min(q[axis]), p[axis].max(q[axis]));
                (hi.min(dhi) - lo.max(dlo)).max(0.0)
            })
            .sum::<f64>()
            .min(hi - lo)
    };
    let mut runs: Vec<Run> = Vec::with_capacity(n);
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        // A slanted side shorter than two steps is a step along its nearer axis.
        let short = dx.hypot(dy) < 2.0 * step;
        let run = if dy.abs() <= slope * dx.abs() || (short && dx.abs() >= dy.abs()) {
            Run::AlongX {
                y: (a[1] + b[1]) / 2.0,
                length: dx.abs(),
                weight: dx.abs() - in_doors(a, b, 0),
            }
        } else if dx.abs() <= slope * dy.abs() || short {
            Run::AlongY {
                x: (a[0] + b[0]) / 2.0,
                length: dy.abs(),
                weight: dy.abs() - in_doors(a, b, 1),
            }
        } else {
            Run::Slanted { from: a, to: b }
        };
        runs.push(run);
    }
    let merge = |a: Run, b: Run| -> Option<Run> {
        match (a, b) {
            (
                Run::AlongX {
                    y: y1,
                    length: l1,
                    weight: w1,
                },
                Run::AlongX {
                    y: y2,
                    length: l2,
                    weight: w2,
                },
            ) => Some(Run::AlongX {
                y: mean_of(y1, w1, l1, y2, w2, l2),
                length: l1 + l2,
                weight: w1 + w2,
            }),
            (
                Run::AlongY {
                    x: x1,
                    length: l1,
                    weight: w1,
                },
                Run::AlongY {
                    x: x2,
                    length: l2,
                    weight: w2,
                },
            ) => Some(Run::AlongY {
                x: mean_of(x1, w1, l1, x2, w2, l2),
                length: l1 + l2,
                weight: w1 + w2,
            }),
            _ => None,
        }
    };
    let mut changed = true;
    let mut guard = 0;
    while changed && runs.len() > 3 && guard < 4 * n + 16 {
        changed = false;
        guard += 1;
        let m = runs.len();
        // Neighbours along the same axis are one side.
        for i in 0..m {
            let j = (i + 1) % m;
            if let Some(joined) = merge(runs[i], runs[j]) {
                runs[i] = joined;
                runs.remove(j);
                changed = true;
                break;
            }
        }
        if changed {
            continue;
        }
        // A short step between two sides along the other axis is flattened.
        for i in 0..m {
            let (prev, next) = ((i + m - 1) % m, (i + 1) % m);
            let short = runs[i].length() < step;
            let between = matches!(
                (runs[prev], runs[i], runs[next]),
                (Run::AlongX { .. }, Run::AlongY { .. }, Run::AlongX { .. })
                    | (Run::AlongY { .. }, Run::AlongX { .. }, Run::AlongY { .. })
            );
            if short
                && between
                && let Some(joined) = merge(runs[prev], runs[next])
            {
                runs[prev] = joined;
                // Remove the later index first.
                let (hi, lo) = (i.max(next), i.min(next));
                runs.remove(hi);
                runs.remove(lo);
                changed = true;
                break;
            }
        }
    }
    if runs.len() < 3 {
        return points.to_vec();
    }
    let m = runs.len();
    let mut out: Vec<P2> = Vec::with_capacity(m);
    for i in 0..m {
        let (a, b) = (runs[(i + m - 1) % m], runs[i]);
        let corner = match (a, b) {
            (Run::AlongX { y, .. }, Run::AlongY { x, .. })
            | (Run::AlongY { x, .. }, Run::AlongX { y, .. }) => [x, y],
            (Run::AlongX { y, .. }, Run::Slanted { from, to })
            | (Run::Slanted { from, to }, Run::AlongX { y, .. }) => {
                let t = if (to[1] - from[1]).abs() < 1e-12 {
                    0.0
                } else {
                    (y - from[1]) / (to[1] - from[1])
                };
                [from[0] + (to[0] - from[0]) * t, y]
            }
            (Run::AlongY { x, .. }, Run::Slanted { from, to })
            | (Run::Slanted { from, to }, Run::AlongY { x, .. }) => {
                let t = if (to[0] - from[0]).abs() < 1e-12 {
                    0.0
                } else {
                    (x - from[0]) / (to[0] - from[0])
                };
                [x, from[1] + (to[1] - from[1]) * t]
            }
            // Both kept: the corner they share.
            (Run::Slanted { .. }, Run::Slanted { from, .. }) => from,
            // Two sides along one axis meet only past a merge that failed: keep the outline.
            _ => return points.to_vec(),
        };
        out.push(corner);
    }
    let out = clean_polygon(&out, 0.5);
    let before = signed_area2(points).abs();
    let after = signed_area2(&out).abs();
    let kept = out.len() >= 3
        && !self_intersects(&out)
        && signed_area2(&out).signum() == signed_area2(points).signum()
        && (after - before).abs() <= 0.2 * before;
    if kept { out } else { points.to_vec() }
}

/// The rooms' sides along the axes put on shared lines: the coordinates of sides of the same
/// axis within `tolerance` of each other become their mean, weighed by length, so that walls
/// cut a cell apart in two rooms are one line. A room that would cross itself keeps its own.
pub(crate) fn snap_lines(rooms: &mut [Vec<P2>], tolerance: f64) {
    // Each axis-aligned side: (axis fixed: 0 for x, 1 for y), its coordinate, its length.
    let mut sides: [Vec<(f64, f64)>; 2] = [Vec::new(), Vec::new()];
    let fixed = |a: P2, b: P2| -> Option<usize> {
        if (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() > 1e-9 {
            Some(0)
        } else if (a[1] - b[1]).abs() < 1e-9 && (a[0] - b[0]).abs() > 1e-9 {
            Some(1)
        } else {
            None
        }
    };
    for room in rooms.iter() {
        let n = room.len();
        for i in 0..n {
            let (a, b) = (room[i], room[(i + 1) % n]);
            if let Some(k) = fixed(a, b) {
                sides[k].push((a[k], (b[1 - k] - a[1 - k]).abs()));
            }
        }
    }
    // Lines: runs of coordinates each within `tolerance` of the previous one.
    let lines: Vec<Vec<(f64, f64, f64)>> = sides
        .iter_mut()
        .map(|list| {
            list.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut out: Vec<(f64, f64, f64)> = Vec::new();
            let mut group: Vec<(f64, f64)> = Vec::new();
            let flush = |group: &mut Vec<(f64, f64)>, out: &mut Vec<(f64, f64, f64)>| {
                let total: f64 = group.iter().map(|g| g.1).sum();
                if let (Some(first), Some(last)) = (group.first(), group.last())
                    && total > 0.0
                {
                    let mean = group.iter().map(|g| g.0 * g.1).sum::<f64>() / total;
                    out.push((first.0, last.0, mean));
                }
                group.clear();
            };
            for &side in list.iter() {
                if group.last().is_some_and(|last| side.0 - last.0 > tolerance) {
                    flush(&mut group, &mut out);
                }
                group.push(side);
            }
            flush(&mut group, &mut out);
            out
        })
        .collect();
    let snapped = |k: usize, v: f64| {
        lines[k]
            .iter()
            .find(|(lo, hi, _)| v >= *lo - 1e-9 && v <= *hi + 1e-9)
            .map_or(v, |l| l.2)
    };
    for room in rooms.iter_mut() {
        let n = room.len();
        let mut moved = room.clone();
        for i in 0..n {
            let (prev, next) = (room[(i + n - 1) % n], room[(i + 1) % n]);
            for side in [fixed(prev, room[i]), fixed(room[i], next)]
                .into_iter()
                .flatten()
            {
                moved[i][side] = snapped(side, room[i][side]);
            }
        }
        if !self_intersects(&moved) && signed_area2(&moved).signum() == signed_area2(room).signum()
        {
            *room = clean_polygon(&moved, 0.5);
        }
    }
}

/// An outline with each side moved out by `d` (in its own unit), whichever way it turns.
pub(crate) fn grow(points: &[P2], d: f64) -> Vec<P2> {
    let n = points.len();
    if n < 3 {
        return points.to_vec();
    }
    // Outward is to the left of each side of a positive outline, as its corners are written.
    let out = if signed_area2(points) > 0.0 {
        -1.0
    } else {
        1.0
    };
    let line = |i: usize| -> (P2, P2) {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let v = [b[0] - a[0], b[1] - a[1]];
        let len = v[0].hypot(v[1]).max(1e-12);
        let o = d * out;
        ([a[0] - v[1] / len * o, a[1] + v[0] / len * o], v)
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

/// Points turned by `angle` (radians, clockwise on the plan) about the origin.
pub(crate) fn turn(points: &[P2], angle: f64) -> Vec<P2> {
    let (s, c) = angle.sin_cos();
    points
        .iter()
        .map(|p| [p[0] * c - p[1] * s, p[0] * s + p[1] * c])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask(rows: &[&str]) -> Mask {
        let mut m = Mask::new(rows[0].len(), rows.len());
        for (y, row) in rows.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                if c == '#' {
                    m.set(x as i64, y as i64);
                }
            }
        }
        m
    }

    #[test]
    fn distances_are_exact() {
        let mut m = Mask::new(9, 7);
        m.set(1, 1);
        m.set(7, 5);
        let d = distances(&m);
        assert_eq!(d[9 + 1], 0.0);
        assert!((d[9 + 4] - 3.0).abs() < 1e-6);
        assert!((d[4 * 9 + 4] - (9.0_f32 + 9.0).sqrt().min((9.0_f32 + 1.0).sqrt())).abs() < 1e-5);
        let empty = distances(&Mask::new(3, 3));
        assert!(empty.iter().all(|&v| v > 1e5));
    }

    #[test]
    fn closing_fills_narrow_gaps() {
        let m = mask(&[
            "............",
            ".##########.",
            ".##########.",
            ".####..####.",
            ".####..####.",
            ".##########.",
            "............",
        ]);
        assert_eq!(m.close(1.5).count(), 50);
        let holes = mask(&[".....", ".###.", ".#.#.", ".###.", "....."]).fill_holes();
        assert_eq!(holes.count(), 9);
        assert_eq!(m.erode(1.0).count(), 14);
    }

    #[test]
    fn parts_and_outlines() {
        let m = mask(&["........", ".###..#.", ".###..#.", ".#....#.", "........"]);
        let (labels, found) = parts(&m);
        assert_eq!(found.len(), 2);
        assert_eq!(labels[8 + 1], 1);
        // An L of seven cells: six corners, clockwise on the plan (y down).
        let l = mask(&["......", ".###..", ".#....", ".#....", "......"]);
        let o = outline(&l);
        assert_eq!(o.len(), 6, "{o:?}");
        assert!(signed_area2(&o) > 0.0);
        assert!((signed_area2(&o) / 2.0 - 5.0).abs() < 1e-9);
        // Two cells touching by a corner: the larger loop alone, one cell.
        let diagonal = mask(&["....", ".#..", "..#.", "...."]);
        assert_eq!(outline(&diagonal).len(), 4);
        assert!(outline(&Mask::new(3, 3)).is_empty());
    }

    #[test]
    fn simplified_and_squared() {
        // A staircase of a slightly slanted wall: two corners once simplified.
        let points: Vec<P2> = vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 1.0],
            [20.0, 1.0],
            [20.0, 2.0],
            [30.0, 2.0],
            [30.0, 20.0],
            [0.0, 20.0],
        ];
        let simple = simplify(&points, 1.5);
        assert!(simple.len() <= 5, "{simple:?}");
        let squared = square(&simple, 3.0, &[]);
        assert_eq!(squared.len(), 4, "{squared:?}");
        for i in 0..4 {
            let (a, b) = (squared[i], squared[(i + 1) % 4]);
            assert!(a[0] == b[0] || a[1] == b[1], "{squared:?}");
        }
        // A slanted corner (a bay) is kept.
        let bay = vec![
            [0.0, 0.0],
            [100.0, 0.0],
            [100.0, 60.0],
            [70.0, 100.0],
            [0.0, 100.0],
        ];
        assert_eq!(square(&bay, 10.0, &[]).len(), 5);
    }

    #[test]
    fn walls_a_cell_apart_are_one_line() {
        let mut rooms = vec![
            vec![[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]],
            vec![[410.0, 2.5], [700.0, 2.5], [700.0, 300.0], [410.0, 300.0]],
        ];
        snap_lines(&mut rooms, 3.5);
        assert!((rooms[0][0][1] - rooms[1][0][1]).abs() < 1e-9, "{rooms:?}");
        // The partition between them, 10 cm, stays two lines.
        assert_eq!((rooms[0][1][0], rooms[1][0][0]), (400.0, 410.0));
    }

    #[test]
    fn grown_outward_either_way() {
        let square = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let reversed: Vec<P2> = square.iter().rev().copied().collect();
        for s in [square.to_vec(), reversed] {
            let g = grow(&s, 1.0);
            assert!((signed_area2(&g).abs() / 2.0 - 144.0).abs() < 1e-9, "{g:?}");
        }
    }

    #[test]
    fn rasterises_triangles_and_segments() {
        let mut m = Mask::new(10, 10);
        m.fill_triangle([1.0, 1.0], [9.0, 1.0], [1.0, 9.0]);
        assert!(m.get(2, 2) && !m.get(8, 8));
        let mut s = Mask::new(10, 10);
        s.draw_segment([0.5, 0.5], [9.5, 0.5]);
        assert_eq!(s.count(), 10);
        s.draw_segment([f64::NAN, 0.0], [1.0, 1.0]);
        assert_eq!(s.count(), 10);
        // A tiny triangle still marks its cell.
        let mut t = Mask::new(4, 4);
        t.fill_triangle([2.1, 2.1], [2.2, 2.1], [2.1, 2.2]);
        assert!(t.get(2, 2));
    }
}
