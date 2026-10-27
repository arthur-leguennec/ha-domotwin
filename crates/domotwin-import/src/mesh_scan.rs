//! Mesh scans as plans (`DECISIONS.md`, D-062, amending D-040). A mesh is triangles without walls
//! or rooms, and telling walls from furniture in it is guesswork: so the plan is read where
//! furniture is not.
//!
//! The mesh is stood up (its axis up and its unit from its floors and ceilings), its storeys are
//! its floors, and it is turned so that its walls run along the axes. Each storey is cut into
//! cells: its floor and ceiling seen from above, and its walls cut by planes at heights between
//! the doors' tops and the ceiling (where walls are whole and no furniture reaches), at 1.5 m,
//! 1.0 m and 0.4 m. The rooms are the spaces the high cuts enclose under the ceiling (or over the
//! floor), at least 60 cm wide; a door is a gap of the lower cuts between two rooms or to the
//! outside, a window a gap at 1 m and 1.5 m over a wall at 0.4 m.

use std::collections::{BTreeSet, VecDeque};

use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftRoom, Report};
use crate::convert::Storey;
use crate::grid::{self, Mask};
use crate::math::P2;
use crate::meshes::{self, MeshFormat};

/// The size of a cell (m), unless the storey is too large for it.
const CELL: f64 = 0.05;
/// Most cells along a side of a storey's grid.
const MAX_SIDE: f64 = 1_600.0;
/// Floors more than this apart (m) are two storeys.
const STOREY: f64 = 1.8;
/// The top of the doors (m above the floor): the walls are whole above it.
const LINTEL: f64 = 2.1;
/// A space narrower than twice this (m) is not a room.
const HALF_ROOM: f64 = 0.30;
/// How far (m) a door's reveal goes from the room it opens into.
const REVEAL: f64 = 0.35;
/// The narrowest door and window (m), and the widest door before it is an opening.
const MIN_DOOR: f64 = 0.55;
const MIN_WINDOW: f64 = 0.30;
const WIDEST_DOOR: f64 = 1.6;
/// Most cells and points looked at to draw a storey: a mesh of huge triangles runs out of it.
const MAX_WORK: usize = 100_000_000;

/// A floor of the scan, its ceiling when one was scanned, and the top of what belongs to it (m).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Level {
    floor: f64,
    ceiling: Option<f64>,
    top: f64,
}

/// A mesh scan, read and cut: each storey with its plan's draft.
#[derive(Debug, Clone)]
pub struct MeshScan {
    format: MeshFormat,
    storeys: Vec<(Storey, Draft)>,
}

/// Twice a triangle's area and its unit normal.
fn normal(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> Option<(f64, [f64; 3])> {
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    (len > 1e-12 && len.is_finite()).then(|| (len, n.map(|v| v / len)))
}

fn corners(points: &[[f32; 3]], t: [u32; 3]) -> Option<[[f64; 3]; 3]> {
    let p = |i: u32| points.get(i as usize).map(|p| p.map(f64::from));
    Some([p(t[0])?, p(t[1])?, p(t[2])?])
}

/// Where most of the mesh is along axis `k`: from its `q` to its `1 − q` quantile (of its
/// vertices, a hundred thousand at most looked at), so that strays far away do not count.
fn spread(points: &[[f32; 3]], k: usize, q: f64) -> (f64, f64) {
    let step = points.len() / 100_000 + 1;
    let mut values: Vec<f64> = points
        .iter()
        .step_by(step)
        .map(|p| f64::from(p[k]))
        .collect();
    values.sort_by(f64::total_cmp);
    let at = |q: f64| {
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss
        )]
        let i = (values.len().saturating_sub(1) as f64 * q) as usize;
        values.get(i).copied().unwrap_or(0.0)
    };
    (at(q), at(1.0 - q))
}

/// The axis most of the horizontal surface lies across at one height (a floor): the format's
/// own unless another holds twice as much (the walls of storeys over one another are in one
/// plane, their floors are not).
fn up_axis(points: &[[f32; 3]], triangles: &[[u32; 3]], usual: usize) -> usize {
    const BINS: usize = 400;
    // The extent of most of the mesh along each axis: a stray far away does not widen the bins.
    let mut lo = [0.0; 3];
    let mut hi = [0.0; 3];
    for k in 0..3 {
        (lo[k], hi[k]) = spread(points, k, 0.005);
    }
    let mut histograms = vec![vec![0.0_f64; BINS + 1]; 3];
    for &t in triangles {
        let Some([a, b, c]) = corners(points, t) else {
            continue;
        };
        let Some((area, n)) = normal(a, b, c) else {
            continue;
        };
        for k in 0..3 {
            let extent = hi[k] - lo[k];
            let at = ((a[k] + b[k] + c[k]) / 3.0 - lo[k]) / extent;
            // What lies past most of the mesh is not counted.
            if n[k].abs() > 0.95 && extent > 0.0 && (0.0..=1.0).contains(&at) {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let bin = ((at * BINS as f64) as usize).min(BINS);
                histograms[k][bin] += area;
            }
        }
    }
    let score = |k: usize| {
        histograms[k]
            .windows(5)
            .map(|w| w.iter().sum::<f64>())
            .fold(0.0, f64::max)
    };
    let scores = [score(0), score(1), score(2)];
    let best = (0..3)
        .max_by(|&i, &j| scores[i].total_cmp(&scores[j]))
        .unwrap_or(usual);
    if scores[best] > 2.0 * scores[usual] {
        best
    } else {
        usual
    }
}

/// The positions stood up: `[x on the plan, height, y on the plan]`, not mirrored.
fn stand(points: &mut [[f32; 3]], up: usize) {
    for p in points {
        let [x, y, z] = *p;
        *p = match up {
            0 => [y, x, -z],
            2 => [x, z, -y],
            _ => [x, y, z],
        };
    }
}

/// Peaks of a histogram of `bin` m from `base`: their heights and sizes, highest first.
fn peaks(histogram: &[f64], base: f64, bin: f64, least: f64) -> Vec<(f64, f64)> {
    let n = histogram.len();
    let smooth: Vec<f64> = (0..n)
        .map(|i| histogram[i.saturating_sub(2)..(i + 3).min(n)].iter().sum())
        .collect();
    let mut found = Vec::new();
    for i in 0..n {
        let v = smooth[i];
        let left = i.checked_sub(1).map_or(0.0, |j| smooth[j]);
        let right = smooth.get(i + 1).copied().unwrap_or(0.0);
        if v >= least && v > left && v >= right {
            // Where the surface is, weighed over the peak.
            let (lo, hi) = (i.saturating_sub(2), (i + 3).min(n));
            let total: f64 = histogram[lo..hi].iter().sum();
            #[allow(clippy::cast_precision_loss)]
            let mid = if total > 0.0 {
                (lo..hi)
                    .map(|k| histogram[k] * (k as f64 + 0.5))
                    .sum::<f64>()
                    / total
            } else {
                i as f64 + 0.5
            };
            found.push((base + mid * bin, v));
        }
    }
    found.sort_by(|a, b| b.1.total_cmp(&a.1));
    found
}

/// The area facing up and facing down at each height from `lo` to `hi`, in bins of `bin` (in
/// the mesh's unit); what is out of that range is not counted.
fn horizontal(
    points: &[[f32; 3]],
    triangles: &[[u32; 3]],
    (lo, hi): (f64, f64),
    bin: f64,
) -> (f64, Vec<f64>, Vec<f64>) {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = (((hi - lo) / bin).ceil().max(0.0) as usize).min(100_000) + 1;
    let (mut up, mut down) = (vec![0.0; n], vec![0.0; n]);
    for &t in triangles {
        let Some([a, b, c]) = corners(points, t) else {
            continue;
        };
        let Some((area, normal)) = normal(a, b, c) else {
            continue;
        };
        let at = ((a[1] + b[1] + c[1]) / 3.0 - lo) / bin;
        #[allow(clippy::cast_precision_loss)]
        if !(0.0..n as f64).contains(&at) {
            continue;
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let k = (at as usize).min(n - 1);
        if normal[1] > 0.9 {
            up[k] += area / 2.0;
        } else if normal[1] < -0.9 {
            down[k] += area / 2.0;
        }
    }
    (lo, up, down)
}

/// What one unit of the mesh is in metres: the one that makes its first storey a storey's
/// height, else the one that makes it a home's size.
fn unit(points: &[[f32; 3]], triangles: &[[u32; 3]]) -> f64 {
    let (lo, hi) = spread(points, 1, 0.001);
    let height = hi - lo;
    if height.is_nan() || height <= 0.0 {
        return 1.0;
    }
    let bin = height / 200.0;
    let (base, up, down) = horizontal(points, triangles, (lo - 2.0 * bin, hi + 2.0 * bin), bin);
    let floors = peaks(&up, base, bin, 0.0);
    let ceilings = peaks(&down, base, bin, 0.0);
    let floor = floors
        .iter()
        .filter(|f| f.1 >= 0.25 * floors.first().map_or(0.0, |f| f.1))
        .map(|f| f.0)
        .reduce(f64::min);
    let strongest = ceilings.first().map_or(0.0, |c| c.1);
    let storey = floor.and_then(|f| {
        ceilings
            .iter()
            .filter(|c| c.0 > f && c.1 >= 0.3 * strongest)
            .map(|c| c.0 - f)
            .reduce(f64::min)
    });
    let units = [1.0, 0.01, 0.001, 0.0254, 0.3048];
    if let Some(u) =
        storey.and_then(|storey| units.iter().find(|u| (1.9..=4.5).contains(&(storey * **u))))
    {
        return *u;
    }
    if let Some(u) = units[..3]
        .iter()
        .find(|u| (1.8..=12.0).contains(&(height * **u)))
    {
        return *u;
    }
    1.0
}

/// The floors of the scan, lowest first, with their ceilings (m).
fn levels(points: &[[f32; 3]], triangles: &[[u32; 3]]) -> Vec<Level> {
    const BIN: f64 = 0.02;
    let (lo, hi) = spread(points, 1, 0.001);
    let (base, up, down) = horizontal(points, triangles, (lo - 0.5, hi + 0.5), BIN);
    let floors_found = peaks(&up, base, BIN, 0.5);
    let strongest = floors_found.first().map_or(0.0, |f| f.1);
    let mut floors: Vec<f64> = floors_found
        .iter()
        .filter(|f| f.1 >= 0.15 * strongest)
        .map(|f| f.0)
        .collect();
    floors.sort_by(f64::total_cmp);
    let mut kept: Vec<f64> = Vec::new();
    for f in floors {
        if kept.last().is_none_or(|last| f - last >= STOREY) {
            kept.push(f);
        }
    }
    let ceilings = peaks(&down, base, BIN, 0.5);
    let n = kept.len();
    (0..n)
        .map(|i| {
            let floor = kept[i];
            let next = kept.get(i + 1).copied();
            let below = next.map_or(floor + 6.0, |n| n - 0.05);
            let ceiling = ceilings
                .iter()
                .find(|c| c.0 > floor + 1.9 && c.0 < below)
                .map(|c| c.0);
            let top = ceiling.map_or(below.min(floor + 3.0), |c| (c + 0.1).min(below));
            Level {
                floor,
                ceiling,
                top,
            }
        })
        .collect()
}

/// The direction the walls run along (radians, modulo a quarter turn), from the vertical faces.
fn wall_angle(points: &[[f32; 3]], triangles: &[[u32; 3]]) -> f64 {
    let (mut sx, mut sy) = (0.0, 0.0);
    for &t in triangles {
        let Some([a, b, c]) = corners(points, t) else {
            continue;
        };
        let Some((area, n)) = normal(a, b, c) else {
            continue;
        };
        if n[1].abs() > 0.3 {
            continue;
        }
        let quad = 4.0 * n[2].atan2(n[0]);
        sx += area * quad.cos();
        sy += area * quad.sin();
    }
    if sx.hypot(sy) < 1e-12 {
        0.0
    } else {
        sy.atan2(sx) / 4.0
    }
}

impl MeshScan {
    /// Reads a mesh scan and cuts each of its storeys; `title` names its plans.
    ///
    /// # Errors
    ///
    /// The mesh readers' codes (`not_plan`, `mesh_too_large`, `mesh_points`,
    /// `external_reference`, `unsupported`), `no_spaces` for a mesh without a floor.
    pub fn read(bytes: &[u8], format: MeshFormat, title: &str) -> Result<Self, &'static str> {
        let mesh = meshes::read(bytes, format)?;
        let mut points = mesh.positions;
        let triangles = mesh.triangles;
        let up = up_axis(&points, &triangles, format.up());
        stand(&mut points, up);
        let scale = if mesh.metres {
            1.0
        } else {
            unit(&points, &triangles)
        };
        // Turned so that the walls run along the axes, in metres.
        let angle = wall_angle(&points, &triangles);
        let (s, c) = (-angle).sin_cos();
        for p in &mut points {
            let (x, y) = (f64::from(p[0]), f64::from(p[2]));
            #[allow(clippy::cast_possible_truncation)]
            {
                *p = [
                    ((x * c - y * s) * scale) as f32,
                    (f64::from(p[1]) * scale) as f32,
                    ((x * s + y * c) * scale) as f32,
                ];
            }
        }
        let levels = levels(&points, &triangles);
        if levels.is_empty() {
            return Err("no_spaces");
        }
        let ground = levels[0].floor;
        let title: String = title.chars().take(100).collect();
        let storeys = levels
            .iter()
            .enumerate()
            .map(|(i, level)| {
                let mut draft = cut(&points, &triangles, *level)?;
                draft.name.clone_from(&title);
                let doors = draft.openings.iter().filter(|o| o.door).count();
                let storey = Storey {
                    id: u32::try_from(i).unwrap_or(u32::MAX),
                    // Named by its place (ground floor, floor 1…) where it is shown.
                    name: String::new(),
                    elevation: ((level.floor - ground) * 1000.0).round() / 10.0,
                    spaces: draft.rooms.len(),
                    doors,
                    windows: draft.openings.len() - doors,
                    furniture: 0,
                };
                Ok((storey, draft))
            })
            .collect::<Result<Vec<_>, &'static str>>()?;
        Ok(MeshScan { format, storeys })
    }

    /// The format the mesh came in.
    pub fn format(&self) -> MeshFormat {
        self.format
    }

    /// The storeys, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        self.storeys.iter().map(|(s, _)| s.clone()).collect()
    }

    /// The plan of storey `id`, what was left out, and no upkeep card.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no room.
    pub fn convert(&self, id: u32) -> Result<(Json, Report, Map<String, Json>), &'static str> {
        let (_, draft) = self.storeys.get(id as usize).ok_or("no_storeys")?;
        build::build(draft.clone())
    }
}

/// A storey's cells: their size (m), the grid's first corner (m) and size.
#[derive(Debug, Clone, Copy)]
struct Frame {
    cell: f64,
    x0: f64,
    y0: f64,
    w: usize,
    h: usize,
}

impl Frame {
    fn at(&self, p: [f64; 3]) -> P2 {
        [(p[0] - self.x0) / self.cell, (p[2] - self.y0) / self.cell]
    }

    /// A cell's centre on the plan (cm).
    #[allow(clippy::cast_precision_loss)]
    fn centre(&self, i: usize) -> P2 {
        let (x, y) = ((i % self.w) as f64 + 0.5, (i / self.w) as f64 + 0.5);
        [
            (self.x0 + x * self.cell) * 100.0,
            (self.y0 + y * self.cell) * 100.0,
        ]
    }
}

/// Where a triangle crosses the height `h`, when it does.
fn crossing(t: &[[f64; 3]; 3], h: f64) -> Option<([f64; 3], [f64; 3])> {
    let mut ends = Vec::with_capacity(2);
    for k in 0..3 {
        let (a, b) = (t[k], t[(k + 1) % 3]);
        if (a[1] - h) * (b[1] - h) < 0.0 {
            let s = (h - a[1]) / (b[1] - a[1]);
            ends.push([a[0] + (b[0] - a[0]) * s, h, a[2] + (b[2] - a[2]) * s]);
        }
    }
    match ends.as_slice() {
        [a, b] => Some((*a, *b)),
        _ => None,
    }
}

/// The draft of one storey.
///
/// # Errors
///
/// `mesh_too_large` past the work a storey may take.
#[allow(clippy::too_many_lines)]
fn cut(points: &[[f32; 3]], triangles: &[[u32; 3]], level: Level) -> Result<Draft, &'static str> {
    let mut draft = Draft::default();
    let Level {
        floor,
        ceiling,
        top,
    } = level;
    let within = |t: &[[f64; 3]; 3]| {
        let (lo, hi) = t
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                (lo.min(p[1]), hi.max(p[1]))
            });
        hi >= floor - 0.15 && lo <= top
    };
    // The storey's extent on the plan: its floor's and ceiling's, but for the farthest
    // thousandth of them each way (a scan's strays), and a metre around.
    let mut spread: [Vec<(f64, f64)>; 2] = [Vec::new(), Vec::new()];
    for &t in triangles {
        let Some(c) = corners(points, t) else {
            continue;
        };
        let Some((area, n)) = normal(c[0], c[1], c[2]) else {
            continue;
        };
        let at = |level: f64| c.iter().all(|p| (p[1] - level).abs() <= 0.12);
        if n[1].abs() > 0.85 && (at(floor) || ceiling.is_some_and(at)) {
            // Its own ends along each axis, each with half its area.
            for (k, axis) in [(0, 0), (1, 2)] {
                let (lo, hi) = c
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                        (lo.min(p[axis]), hi.max(p[axis]))
                    });
                spread[k].push((lo, area / 2.0));
                spread[k].push((hi, area / 2.0));
            }
        }
    }
    let bounds = spread.map(|mut list| {
        list.sort_by(|a, b| a.0.total_cmp(&b.0));
        let total: f64 = list.iter().map(|e| e.1).sum();
        let (mut sum, mut lo, mut hi) = (0.0, f64::NAN, f64::NAN);
        for &(v, a) in &list {
            sum += a;
            if lo.is_nan() && sum >= total * 0.001 {
                lo = v;
            }
            if hi.is_nan() && sum >= total * 0.999 {
                hi = v;
            }
        }
        (lo - 1.0, hi + 1.0)
    });
    let (lo, hi) = ([bounds[0].0, bounds[1].0], [bounds[0].1, bounds[1].1]);
    if !(lo[0].is_finite() && hi[0].is_finite() && lo[1].is_finite() && hi[1].is_finite()) {
        return Ok(draft);
    }
    let extent = (hi[0] - lo[0]).max(hi[1] - lo[1]);
    let cell = CELL.max(extent / MAX_SIDE);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let size = |span: f64| ((span / cell).ceil() as usize) + 24;
    let frame = Frame {
        cell,
        x0: lo[0] - 12.0 * cell,
        y0: lo[1] - 12.0 * cell,
        w: size(hi[0] - lo[0]),
        h: size(hi[1] - lo[1]),
    };
    let (w, h) = (frame.w, frame.h);
    // The heights cut: between the doors' tops and the ceiling, then the doors' and windows'.
    let high: Vec<f64> = match ceiling {
        Some(c) if c - floor > LINTEL + 0.1 => {
            let (from, to) = (floor + LINTEL, c - 0.06);
            (0..4)
                .map(|k| from + (to - from) * f64::from(k) / 3.0)
                .collect()
        }
        Some(c) => vec![c - 0.1],
        None => vec![floor + LINTEL, floor + LINTEL + 0.1],
    };
    let low = [floor + 0.4, floor + 1.0, floor + 1.5];
    let mut floors = Mask::new(w, h);
    let mut ceilings = Mask::new(w, h);
    let mut walls = Mask::new(w, h);
    let mut cuts = [Mask::new(w, h), Mask::new(w, h), Mask::new(w, h)];
    let mut work = 0_usize;
    for &t in triangles {
        if work > MAX_WORK {
            return Err("mesh_too_large");
        }
        let Some(c) = corners(points, t) else {
            continue;
        };
        if !within(&c) {
            continue;
        }
        let Some((_, n)) = normal(c[0], c[1], c[2]) else {
            continue;
        };
        let on = |level: f64, by: f64| c.iter().all(|p| (p[1] - level).abs() <= by);
        if n[1] > 0.85 && on(floor, 0.08) {
            work += floors.fill_triangle(frame.at(c[0]), frame.at(c[1]), frame.at(c[2]));
        }
        if let Some(height) = ceiling
            && n[1] < -0.85
            && on(height, 0.12)
        {
            work += ceilings.fill_triangle(frame.at(c[0]), frame.at(c[1]), frame.at(c[2]));
        }
        for &height in &high {
            if let Some((a, b)) = crossing(&c, height) {
                work += walls.draw_segment(frame.at(a), frame.at(b));
            }
        }
        for (mask, &height) in cuts.iter_mut().zip(&low) {
            if let Some((a, b)) = crossing(&c, height) {
                work += mask.draw_segment(frame.at(a), frame.at(b));
            }
        }
    }
    let footprint = floors.or(&ceilings).close(0.15 / cell);
    let free = footprint.minus(&walls);

    // Rooms: the spaces wider than a room, grown back to their walls.
    let (_, seeds) = grid::parts(&free.erode(HALF_ROOM / cell));
    let least = (0.2 / (cell * cell)).ceil();
    let mut label = vec![0_u32; w * h];
    let mut queue: VecDeque<(usize, u32)> = VecDeque::new();
    let mut count = 0_u32;
    for part in seeds {
        #[allow(clippy::cast_precision_loss)]
        if (part.len() as f64) < least {
            continue;
        }
        count += 1;
        for i in part {
            label[i] = count;
            queue.push_back((i, 0));
        }
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let depth = (HALF_ROOM / cell).ceil() as u32 + 2;
    while let Some((i, d)) = queue.pop_front() {
        if d >= depth {
            continue;
        }
        // Diagonally only past a free corner: a wall's cut touching by corners stays shut.
        for j in around(i, w, h) {
            let corner_free = free.cells[(i / w) * w + j % w] || free.cells[(j / w) * w + i % w];
            if free.cells[j] && label[j] == 0 && corner_free {
                label[j] = label[i];
                queue.push_back((j, d + 1));
            }
        }
    }
    // What is left of the free space walled in beside one room alone (under a tall cupboard, a
    // wall cabinet) is that room's.
    let left = Mask {
        w,
        h,
        cells: (0..w * h).map(|i| free.cells[i] && label[i] == 0).collect(),
    };
    let (_, pockets) = grid::parts(&left);
    for pocket in pockets {
        #[allow(clippy::cast_precision_loss)]
        if (pocket.len() as f64) < 0.05 / (cell * cell) {
            continue;
        }
        let mut near: BTreeSet<u32> = BTreeSet::new();
        let mut border = false;
        for &i in &pocket {
            let (x, y) = (i % w, i / w);
            border |= x < 2 || y < 2 || x + 2 >= w || y + 2 >= h;
            // Reaching what the scan saw no floor or ceiling of: outside.
            border |= beside(i, w, h).any(|j| !footprint.cells[j] && !walls.cells[j]);
            for dy in -3_i64..=3 {
                for dx in -3_i64..=3 {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                        let l = label[ny as usize * w + nx as usize];
                        if l != 0 {
                            near.insert(l);
                        }
                    }
                }
            }
        }
        if let (false, 1, Some(&room)) = (border, near.len(), near.first()) {
            for i in pocket {
                label[i] = room;
            }
        }
    }

    // Each room's outline, in cm, drawn on a grid of its own around it (counted in the work).
    let mut boxes = vec![(usize::MAX, usize::MAX, 0_usize, 0_usize); count as usize];
    for (i, &l) in label.iter().enumerate() {
        if let Some(b) = l.checked_sub(1).and_then(|k| boxes.get_mut(k as usize)) {
            let (x, y) = (i % w, i / w);
            *b = (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y));
        }
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let margin = (0.10 / cell).ceil() as usize + 2;
    let mut rooms: Vec<(u32, Vec<P2>)> = Vec::new();
    for (room, &(x0, y0, x1, y1)) in (1..=count).zip(&boxes) {
        if x0 > x1 {
            continue;
        }
        let (bw, bh) = (x1 - x0 + 1 + 2 * margin, y1 - y0 + 1 + 2 * margin);
        work += bw * bh;
        if work > MAX_WORK {
            return Err("mesh_too_large");
        }
        let mut mask = Mask::new(bw, bh);
        for y in y0..=y1 {
            for x in x0..=x1 {
                if label[y * w + x] == room {
                    mask.cells[(y - y0 + margin) * bw + x - x0 + margin] = true;
                }
            }
        }
        let shape = mask.close(0.10 / cell).fill_holes();
        let outline = grid::outline(&shape);
        if outline.len() < 4 {
            continue;
        }
        #[allow(clippy::cast_precision_loss)]
        let (ox, oy) = (x0 as f64 - margin as f64, y0 as f64 - margin as f64);
        let points: Vec<P2> = outline
            .iter()
            .map(|p| {
                [
                    (frame.x0 + (p[0] + ox) * cell) * 100.0,
                    (frame.y0 + (p[1] + oy) * cell) * 100.0,
                ]
            })
            .collect();
        let simple = grid::simplify(&points, 1.5 * cell * 100.0);
        // The cut of a wall is a cell wide: its face is half a cell farther, on average.
        let squared = grid::square(&simple, 12.0, &[]);
        rooms.push((room, grid::grow(&squared, cell * 50.0)));
    }
    rooms.sort_by(|a, b| {
        let first = |p: &[P2]| {
            p.iter()
                .fold([f64::INFINITY; 2], |m, q| [m[0].min(q[0]), m[1].min(q[1])])
        };
        let (fa, fb) = (first(&a.1), first(&b.1));
        fa[1].total_cmp(&fb[1]).then(fa[0].total_cmp(&fb[0]))
    });
    let mut outlines: Vec<Vec<P2>> = rooms.into_iter().map(|(_, points)| points).collect();
    grid::snap_lines(&mut outlines, 3.5);
    for (k, points) in outlines.into_iter().enumerate() {
        draft.rooms.push(DraftRoom {
            id: format!("room-{}", k + 1),
            name: String::new(),
            points,
            floor: None,
        });
    }

    // Doors and windows: the gaps of the lower cuts next to the rooms.
    let in_room = Mask {
        w,
        h,
        cells: label.iter().map(|l| *l != 0).collect(),
    };
    let reach = grid::distances(&in_room);
    let [low, door_height, window_top] = cuts;
    let deep = (REVEAL / cell).ceil() as i64 + 1;
    let open = Mask {
        w,
        h,
        cells: (0..w * h)
            .map(|i| {
                label[i] == 0
                    && f64::from(reach[i]) <= REVEAL / cell
                    && !door_height.cells[i]
                    && !window_top.cells[i]
            })
            .collect(),
    };
    // Whether most of an opening's cells meet the wall at 0.4 m going through it from its room
    // (`way`, a step): a window's sill, not a door.
    let sill = |cells: &[usize], way: (i64, i64)| {
        let hits = cells
            .iter()
            .filter(|&&i| {
                let (x, y) = ((i % w) as i64, (i / w) as i64);
                (0..=deep).any(|k| low.get(x + way.0 * k, y + way.1 * k))
            })
            .count();
        2 * hits > cells.len()
    };
    let (_, gaps) = grid::parts(&open);
    let mut found: Vec<Gap> = Vec::new();
    for gap in gaps {
        let outside = gap.iter().any(|&i| !footprint.cells[i]);
        // The rooms the gap touches, each by its runs of cells along its walls (one an
        // opening), with the way from the room into the gap.
        let mut touching: Vec<(u32, Vec<usize>, [f64; 2])> = Vec::new();
        for &i in &gap {
            for j in beside(i, w, h) {
                let l = label[j];
                if l == 0 {
                    continue;
                }
                #[allow(clippy::cast_precision_loss)]
                let step = [
                    (i % w) as f64 - (j % w) as f64,
                    (i / w) as f64 - (j / w) as f64,
                ];
                match touching.iter_mut().find(|(r, _, _)| *r == l) {
                    Some((_, cells, way)) => {
                        if cells.last() != Some(&i) {
                            cells.push(i);
                        }
                        *way = [way[0] + step[0], way[1] + step[1]];
                    }
                    None => touching.push((l, vec![i], step)),
                }
            }
        }
        if outside {
            for (room, cells, way) in &touching {
                for run in cell_runs(cells, w) {
                    let step = axis_step(*way);
                    let door = !sill(&run, step);
                    if let Some(g) = opening(&frame, &run, None, step, door, vec![*room]) {
                        found.push(g);
                    }
                }
            }
        } else if let [(a, first, way), (b, second, _)] = touching.as_slice() {
            let step = axis_step(*way);
            // A wall at 0.4 m between them: a pass-through, not a door.
            if !sill(first, step)
                && let Some(g) = opening(&frame, first, Some(second), step, true, vec![*a, *b])
            {
                found.push(g);
            }
        }
    }
    // A door opens into the room with fewer doors (a bedroom off the hall), an outside door
    // into its room.
    let doors_of = |room: u32| {
        found
            .iter()
            .filter(|g| g.door && g.rooms.contains(&room))
            .count()
    };
    let (mut doors, mut windows) = (0, 0);
    let mut openings = Vec::new();
    for g in &found {
        // `across` points from the first room to the other side.
        let into_first = g.rooms.len() == 1 || doors_of(g.rooms[0]) <= doors_of(g.rooms[1]);
        let opens = if into_first {
            [-g.across[0], -g.across[1]]
        } else {
            g.across
        };
        let id = if g.door {
            doors += 1;
            format!("door-{doors}")
        } else {
            windows += 1;
            format!("window-{windows}")
        };
        openings.push(DraftOpening {
            id,
            name: String::new(),
            door: g.door,
            centre: g.centre,
            along: g.along,
            opens,
            width: g.width,
            right: false,
            style: (g.door && g.width > WIDEST_DOOR * 100.0).then_some("opening"),
        });
    }
    draft.openings = openings;
    Ok(draft)
}

/// A door or a window found, in cm on the plan.
#[derive(Debug, Clone, PartialEq)]
struct Gap {
    door: bool,
    rooms: Vec<u32>,
    centre: P2,
    along: P2,
    /// From the first room to the other side.
    across: P2,
    width: f64,
}

/// The axis a sum of steps mostly goes along, as one step.
fn axis_step(way: [f64; 2]) -> (i64, i64) {
    if way[0].abs() >= way[1].abs() {
        (if way[0] < 0.0 { -1 } else { 1 }, 0)
    } else {
        (0, if way[1] < 0.0 { -1 } else { 1 })
    }
}

/// The runs of cells joined by a side or a corner (each an opening along a wall).
fn cell_runs(cells: &[usize], w: usize) -> Vec<Vec<usize>> {
    let set: BTreeSet<usize> = cells.iter().copied().collect();
    let mut seen: BTreeSet<usize> = BTreeSet::new();
    let mut runs = Vec::new();
    for &start in &set {
        if !seen.insert(start) {
            continue;
        }
        let mut run = vec![start];
        let mut k = 0;
        while k < run.len() {
            let (x, y) = ((run[k] % w) as i64, (run[k] / w) as i64);
            k += 1;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx as usize >= w {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if set.contains(&j) && seen.insert(j) {
                        run.push(j);
                    }
                }
            }
        }
        runs.push(run);
    }
    runs
}

/// An opening from the cells it touches its room by (and, between two rooms, the other's),
/// `step` going through it from the first room; `None` when narrower than a door or a window.
fn opening(
    frame: &Frame,
    first: &[usize],
    second: Option<&Vec<usize>>,
    step: (i64, i64),
    door: bool,
    rooms: Vec<u32>,
) -> Option<Gap> {
    let across = usize::from(step.0 == 0);
    let along = 1 - across;
    let mean = |cells: &[usize]| {
        #[allow(clippy::cast_precision_loss)]
        let n = cells.len().max(1) as f64;
        cells.iter().fold([0.0, 0.0], |m, &i| {
            let c = frame.centre(i);
            [m[0] + c[0] / n, m[1] + c[1] / n]
        })
    };
    let span = |cells: &[usize]| {
        cells
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &i| {
                let c = frame.centre(i)[along];
                (lo.min(c), hi.max(c))
            })
    };
    let from = mean(first);
    let (mut lo, mut hi) = span(first);
    let mut middle = from[across];
    if let Some(second) = second {
        let (l2, h2) = span(second);
        lo = lo.max(l2);
        hi = hi.min(h2);
        middle = (middle + mean(second)[across]) / 2.0;
    }
    // A cell for the cells' own width, and one for the cuts of the jambs, a cell wide each.
    let width = hi - lo + 2.0 * frame.cell * 100.0;
    if width < (if door { MIN_DOOR } else { MIN_WINDOW }) * 100.0 {
        return None;
    }
    let mut centre = [0.0, 0.0];
    centre[along] = (lo + hi) / 2.0;
    centre[across] = middle;
    let mut along_v = [0.0, 0.0];
    along_v[along] = 1.0;
    let mut across_v = [0.0, 0.0];
    #[allow(clippy::cast_precision_loss)]
    {
        across_v[across] = (step.0 + step.1) as f64;
    }
    Some(Gap {
        door,
        rooms,
        centre,
        along: along_v,
        across: across_v,
        width,
    })
}

/// The 4 neighbours of a cell inside the grid.
fn beside(i: usize, w: usize, h: usize) -> impl Iterator<Item = usize> {
    let (x, y) = (i % w, i / w);
    [
        (x > 0).then(|| i - 1),
        (x + 1 < w).then(|| i + 1),
        (y > 0).then(|| i - w),
        (y + 1 < h).then(|| i + w),
    ]
    .into_iter()
    .flatten()
}

/// The 8 neighbours of a cell inside the grid.
fn around(i: usize, w: usize, h: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((i % w) as i64, (i / w) as i64);
    (-1_i64..=1).flat_map(move |dy| {
        (-1_i64..=1).filter_map(move |dx| {
            let (nx, ny) = (x + dx, y + dy);
            ((dx, dy) != (0, 0) && nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h)
                .then(|| ny as usize * w + nx as usize)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fictional mesh, `y` up, in metres: boxes of their six faces, normals outward.
    #[derive(Default)]
    struct Builder {
        points: Vec<[f32; 3]>,
        triangles: Vec<[u32; 3]>,
    }

    impl Builder {
        fn quad(&mut self, q: [[f64; 3]; 4]) {
            let base = self.points.len() as u32;
            for p in q {
                self.points.push(p.map(|v| v as f32));
            }
            self.triangles.push([base, base + 1, base + 2]);
            self.triangles.push([base, base + 2, base + 3]);
        }

        /// A box from `lo` to `hi`, its faces looking out, but for those a scan cannot see
        /// (`skip`: its top, its bottom, the outside of an outer wall).
        fn cube_without(&mut self, lo: [f64; 3], hi: [f64; 3], skip: &[Face]) {
            let [x0, y0, z0] = lo;
            let [x1, y1, z1] = hi;
            let faces = [
                (
                    Face::Top,
                    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
                ),
                (
                    Face::Bottom,
                    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
                ),
                (
                    Face::Left,
                    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
                ),
                (
                    Face::Right,
                    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
                ),
                (
                    Face::Back,
                    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
                ),
                (
                    Face::Front,
                    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
                ),
            ];
            for (face, quad) in faces {
                if !skip.contains(&face) {
                    self.quad(quad);
                }
            }
        }

        /// A piece of wall: its top and bottom hidden in the ceiling and the floor.
        fn wall(&mut self, lo: [f64; 3], hi: [f64; 3], outside: Option<Face>) {
            let mut skip = vec![Face::Bottom];
            if hi[1] >= 2.5 {
                skip.push(Face::Top);
            }
            skip.extend(outside);
            self.cube_without(lo, hi, &skip);
        }

        fn obj(&self) -> Vec<u8> {
            let mut out = String::new();
            for p in &self.points {
                out += &format!("v {} {} {}\n", p[0], p[1], p[2]);
            }
            for t in &self.triangles {
                out += &format!("f {} {} {}\n", t[0] + 1, t[1] + 1, t[2] + 1);
            }
            out.into_bytes()
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Face {
        Top,
        Bottom,
        Left,
        Right,
        Back,
        Front,
    }

    /// Two rooms, 4 × 3 m and 3 × 3 m, a 10 cm wall between them with a 90 cm door under a
    /// lintel at 2.05 m, 20 cm outer walls, a 1.2 m window in the first room, a sofa there and a
    /// tall wardrobe against the second room's back wall; the floor and the ceiling, seen from
    /// inside.
    fn flat() -> Builder {
        let mut b = Builder::default();
        let (h, t) = (2.5, 0.2);
        b.quad([
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 3.0],
            [7.1, 0.0, 3.0],
            [7.1, 0.0, 0.0],
        ]);
        b.quad([[0.0, h, 0.0], [7.1, h, 0.0], [7.1, h, 3.0], [0.0, h, 3.0]]);
        // The front wall (z = -t..0), a window from x = 1.5 to 2.7, 0.9 to 2.1 m.
        b.wall([-t, 0.0, -t], [1.5, h, 0.0], Some(Face::Back));
        b.wall([2.7, 0.0, -t], [7.1 + t, h, 0.0], Some(Face::Back));
        b.wall([1.5, 0.0, -t], [2.7, 0.9, 0.0], Some(Face::Back));
        b.wall([1.5, 2.1, -t], [2.7, h, 0.0], Some(Face::Back));
        b.wall([-t, 0.0, 3.0], [7.1 + t, h, 3.0 + t], Some(Face::Front));
        b.wall([-t, 0.0, 0.0], [0.0, h, 3.0], Some(Face::Left));
        b.wall([7.1, 0.0, 0.0], [7.1 + t, h, 3.0], Some(Face::Right));
        // The partition at x = 4.0–4.1, a door from z = 1.0 to 1.9.
        b.wall([4.0, 0.0, 0.0], [4.1, h, 1.0], None);
        b.wall([4.0, 0.0, 1.9], [4.1, h, 3.0], None);
        b.wall([4.0, 2.05, 1.0], [4.1, h, 1.9], None);
        b.cube_without(
            [5.0, 0.0, 2.4],
            [6.2, 2.3, 3.0],
            &[Face::Bottom, Face::Front],
        );
        b.cube_without([1.0, 0.0, 2.0], [3.0, 0.85, 2.9], &[Face::Bottom]);
        b
    }

    #[test]
    fn a_flat_scanned_as_a_mesh() {
        // Off the cells' corners, as a scan is.
        let mut b = flat();
        for p in &mut b.points {
            p[0] += 0.013;
            p[2] += 0.021;
        }
        let mesh = b.obj();
        let scan = MeshScan::read(&mesh, MeshFormat::Obj, "Scan").unwrap();
        let storeys = scan.storeys();
        assert_eq!(storeys.len(), 1);
        assert_eq!(
            (storeys[0].spaces, storeys[0].doors, storeys[0].windows),
            (2, 1, 1)
        );
        let (plan, report, _) = scan.convert(0).unwrap();
        domotwin_core::plan::read_plan_value(&plan).unwrap();
        assert_eq!(
            (
                report.rooms,
                report.doors,
                report.windows,
                report.unplaced_openings
            ),
            (2, 1, 1, 0),
            "{plan:#}"
        );
        // Square rooms, the second whole under its wardrobe; the partition measured.
        for room in plan["rooms"].as_array().unwrap() {
            let outline: Vec<P2> = serde_json::from_value(room["outline"].clone()).unwrap();
            assert_eq!(outline.len(), 4, "{outline:?}");
        }
        let area = |k: usize| {
            let o: Vec<P2> = serde_json::from_value(plan["rooms"][k]["outline"].clone()).unwrap();
            crate::math::signed_area2(&o).abs() / 2.0
        };
        assert!((area(0) - 405.0 * 300.0).abs() < 4_000.0, "{}", area(0));
        assert!((area(1) - 305.0 * 300.0).abs() < 4_000.0, "{}", area(1));
        // Within a cell of the 10 cm partition.
        let interior = plan["wallThickness"]["interior"].as_f64().unwrap();
        assert!((interior - 10.0).abs() <= 5.0, "{interior}");
        let width = |e: &Json| {
            let (a, b): (P2, P2) = (
                serde_json::from_value(e["from"].clone()).unwrap(),
                serde_json::from_value(e["to"].clone()).unwrap(),
            );
            (b[0] - a[0]).hypot(b[1] - a[1])
        };
        assert!(
            (width(&plan["doors"][0]) - 90.0).abs() < 11.0,
            "{}",
            plan["doors"]
        );
        assert!(
            (width(&plan["windows"][0]) - 120.0).abs() < 11.0,
            "{}",
            plan["windows"]
        );
        assert!(plan["items"].as_array().unwrap().is_empty());
    }

    #[test]
    fn turned_in_centimetres_with_z_up() {
        // The same flat in centimetres, `z` up, turned by 25°.
        let b = flat();
        let (s, c) = 25_f64.to_radians().sin_cos();
        let mut out = String::from("solid scan\n");
        for t in &b.triangles {
            out += "facet normal 0 0 0\nouter loop\n";
            for &i in t {
                let p = b.points[i as usize].map(f64::from);
                let (x, y) = (p[0] * c - p[2] * s, -(p[0] * s + p[2] * c));
                out += &format!("vertex {} {} {}\n", x * 100.0, y * 100.0, p[1] * 100.0);
            }
            out += "endloop\nendfacet\n";
        }
        out += "endsolid\n";
        let scan = MeshScan::read(out.as_bytes(), MeshFormat::Stl, "Scan").unwrap();
        let (plan, report, _) = scan.convert(0).unwrap();
        assert_eq!(
            (report.rooms, report.doors, report.windows),
            (2, 1, 1),
            "{plan:#}"
        );
        let o: Vec<P2> = serde_json::from_value(plan["rooms"][0]["outline"].clone()).unwrap();
        assert_eq!(o.len(), 4, "{o:?}");
        assert!(
            o.iter()
                .zip(o.iter().cycle().skip(1))
                .all(|(a, b)| (a[0] - b[0]).abs() < 0.5 || (a[1] - b[1]).abs() < 0.5),
            "{o:?}"
        );
    }

    #[test]
    fn two_storeys_and_nothing_to_read() {
        let mut b = flat();
        let upper = flat();
        let base = b.points.len() as u32;
        b.points
            .extend(upper.points.iter().map(|p| [p[0], p[1] + 2.7, p[2]]));
        b.triangles
            .extend(upper.triangles.iter().map(|t| t.map(|i| i + base)));
        let scan = MeshScan::read(&b.obj(), MeshFormat::Obj, "Scan").unwrap();
        let storeys = scan.storeys();
        assert_eq!(storeys.len(), 2);
        assert_eq!(storeys[1].elevation, 270.0);
        assert_eq!(storeys[1].spaces, 2);
        assert_eq!(scan.convert(2).err(), Some("no_storeys"));
        // A single triangle: no floor worth a storey.
        let lone = b"v 0 0 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n";
        assert!(matches!(
            MeshScan::read(lone, MeshFormat::Obj, "x").map(|s| s.storeys()[0].spaces),
            Err("no_spaces") | Ok(0)
        ));
    }
}
