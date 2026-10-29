//! The roofs of a home (D-028, D-077): over each storey where no storey above covers it, a roof of
//! the shape the home's settings say (gable, hip, shed or flat), made of wings: the rectangles its
//! footprint is made of (an L-shaped home has two, their roofs meeting in valleys), found on a
//! grid along the home's own axes; a home whose walls are not square to each other has one, over
//! the smallest rectangle around it.

use super::lines::{LineKind, Lines};
use super::mesh::{Material, Mesh, NO_GROUP, Painter, Surface, Tag, V3};
use super::{Roof, RoofShape, StoreyPart};
use crate::geometry::polygon::{P2, point_in_polygon};
use crate::plan::Rgb8;

/// How far the eaves stand out from the walls (cm); a flat roof's edge, less.
const OVERHANG: f64 = 30.0;
const FLAT_OVERHANG: f64 = 10.0;
/// The highest a ridge goes above the eaves (cm).
const MAX_RISE: f64 = 320.0;
/// Thickness of a pitched roof, and of a flat one (cm).
const THICKNESS: f64 = 14.0;
const FLAT_THICKNESS: f64 = 22.0;
/// The tiles, the underside and edges, the gable walls, a flat roof's membrane.
const TILES: Rgb8 = Rgb8::from_u32(0x6b5a52);
const UNDERSIDE: Material = Material::satin(Rgb8::from_u32(0xe9e6de));
const GABLE: Material = Material::new(Rgb8::from_u32(0xe9e6de), 0.95, Surface::Matte);
const MEMBRANE: Rgb8 = Rgb8::from_u32(0x5d6062);
/// Most wings a roof has, and the narrowest one (cm).
pub const MAX_WINGS: usize = 4;
const NARROWEST: f64 = 150.0;
/// Most cells along the longer side of the grid a footprint is read on, and the smallest (cm).
const CELLS: f64 = 120.0;
const SMALLEST_CELL: f64 = 12.0;
/// The share of a footprint its wings may leave uncovered before it is roofed whole, as a home
/// whose walls are not square to each other.
const LEFT_OVER: f64 = 0.12;
/// Most solar panels on a roof; a panel's size across the slope and up it, the gap between two,
/// the room kept from the roof's edges and ridge (cm), and how far above the tiles it lies.
const MAX_PANELS: u32 = 60;
const PANEL_ACROSS: f64 = 105.0;
const PANEL_UP: f64 = 170.0;
const PANEL_GAP: f64 = 4.0;
const PANEL_MARGIN: f64 = 35.0;
const PANEL_LIFT: f64 = 5.0;
/// A panel's aluminium frame, and its cells (dark glass).
const PANEL_FRAME: Material = Material::new(Rgb8::from_u32(0xb9bec4), 0.35, Surface::Metal);
const PANEL_CELLS: Material = Material::new(Rgb8::from_u32(0x1c2a46), 0.2, Surface::Screen);

/// The shape of a home's roofs (D-077).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RoofKind {
    /// Two slopes meeting at a ridge, a gable at each end.
    #[default]
    Gable,
    /// Four slopes: the ends slope too.
    Hip,
    /// One slope (a lean-to).
    Shed,
    /// Flat.
    Flat,
}

impl RoofKind {
    /// Every shape, as the settings name them.
    pub const ALL: [RoofKind; 4] = [
        RoofKind::Gable,
        RoofKind::Hip,
        RoofKind::Shed,
        RoofKind::Flat,
    ];

    /// The name in the settings.
    pub const fn name(self) -> &'static str {
        match self {
            RoofKind::Gable => "gable",
            RoofKind::Hip => "hip",
            RoofKind::Shed => "shed",
            RoofKind::Flat => "flat",
        }
    }

    /// Reads a name; an unknown one is a gable roof.
    pub fn from_name(name: &str) -> RoofKind {
        RoofKind::ALL
            .into_iter()
            .find(|kind| kind.name() == name)
            .unwrap_or_default()
    }
}

/// How the home's roofs are drawn (its settings, D-077).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoofStyle {
    pub kind: RoofKind,
    /// The pitch of its slopes (degrees, 5–60).
    pub pitch: f64,
    /// The colour of its tiles (a flat roof's membrane), else the usual one.
    pub color: Option<Rgb8>,
    /// How many solar panels lie on the top roof's main wing (0: none), as many as fit.
    pub solar: u32,
    /// Where they face: degrees clockwise from the top of the plan (the sun's side where the home
    /// is); the slope facing it most takes them. None: the main wing's `+v` slope.
    pub solar_toward: Option<f64>,
}

/// The pitch a roof has unless its settings say otherwise, and the range they may say (degrees).
pub const PITCH: f64 = 30.0;
pub const PITCH_RANGE: (f64, f64) = (5.0, 60.0);

impl Default for RoofStyle {
    fn default() -> Self {
        Self {
            kind: RoofKind::Gable,
            pitch: PITCH,
            color: None,
            solar: 0,
            solar_toward: None,
        }
    }
}

impl RoofStyle {
    /// Reads the settings' `roof` leniently: `{"shape": "hip", "pitch": 35, "color": "#7a4a3a"}`.
    pub fn read(value: &serde_json::Value) -> RoofStyle {
        let defaults = RoofStyle::default();
        RoofStyle {
            kind: value
                .get("shape")
                .and_then(serde_json::Value::as_str)
                .map_or(defaults.kind, RoofKind::from_name),
            pitch: value
                .get("pitch")
                .and_then(serde_json::Value::as_f64)
                .filter(|p| p.is_finite())
                .map_or(defaults.pitch, |p| p.clamp(PITCH_RANGE.0, PITCH_RANGE.1)),
            color: value
                .get("color")
                .and_then(serde_json::Value::as_str)
                .and_then(Rgb8::from_hex),
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            solar: value
                .get("solar")
                .and_then(serde_json::Value::as_f64)
                .filter(|n| n.is_finite())
                .map_or(0, |n| n.clamp(0.0, f64::from(MAX_PANELS)).round() as u32),
            solar_toward: value
                .get("solar_toward")
                .and_then(serde_json::Value::as_f64)
                .filter(|a| a.is_finite()),
        }
    }
}

/// The roofs over every storey of `parts` where no storey above covers it, each on its storey's
/// walls (`wall_height`); none over a storey without rooms.
pub(crate) fn build(parts: &[StoreyPart], wall_height: f64, style: &RoofStyle) -> Vec<Roof> {
    let mut roofs = Vec::new();
    // Each roof's main wing, for the solar panels of the top one.
    let mut mains: Vec<(Rectangle, RoofShape, Vec<RoofShape>)> = Vec::new();
    for (storey, part) in parts.iter().enumerate() {
        // The rooms with their walls, not the places outside.
        let footprint = outlines(part, false);
        // What the storeys above stand on: their rooms with their walls, and places outside.
        let above: Vec<Vec<P2>> = parts
            .iter()
            .filter(|other| other.elevation > part.elevation + 1.0)
            .flat_map(|other| outlines(other, true))
            .collect();
        let above: Vec<&[P2]> = above.iter().map(Vec::as_slice).collect();
        let wings = wings(&footprint, &above);
        if wings.is_empty() {
            continue;
        }
        let mut mesh = Mesh::default();
        let mut lines = Lines::default();
        let main = wings[0].centre;
        let shapes: Vec<RoofShape> = wings
            .iter()
            .enumerate()
            .map(|(k, wing)| {
                // A lean-to's high side is towards the main wing; the main wing's to +v.
                let high = if k == 0 {
                    1.0
                } else {
                    let d = [main[0] - wing.centre[0], main[1] - wing.centre[1]];
                    if d[0] * wing.v[0] + d[1] * wing.v[1] >= 0.0 {
                        1.0
                    } else {
                        -1.0
                    }
                };
                draw_wing(&mut mesh, &mut lines, wing, wall_height, style, high)
            })
            .collect();
        if mesh.vertex_count() > 0 {
            if let Some(shape) = shapes.first() {
                mains.push((wings[0], *shape, shapes[1..].to_vec()));
            }
            roofs.push(Roof {
                elevation: part.elevation,
                storey,
                mesh,
                lines: lines.list,
                wings: shapes,
            });
        }
    }
    // The solar panels, on the highest roof's main wing.
    let top = roofs
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.elevation.total_cmp(&b.1.elevation))
        .map(|(k, _)| k);
    if let (Some(k), true) = (top, style.solar > 0)
        && let (Some(roof), Some((wing, shape, others))) = (roofs.get_mut(k), mains.get(k))
    {
        draw_panels(&mut roof.mesh, wing, shape, others, style);
    }
    roofs
}

/// Lays `style.solar` panels on a wing's roof, as many as fit: in rows up the slope facing
/// `style.solar_toward` most (on a flat roof, in rows across it), from the eaves, a margin kept
/// from the eaves, the ridge and the ends (a hipped end's slope too). None where another wing's
/// roof (`others`) rises over the slope, at a valley.
fn draw_panels(
    mesh: &mut Mesh,
    r: &Rectangle,
    shape: &RoofShape,
    others: &[RoofShape],
    style: &RoofStyle,
) {
    let (hl, hw, rise, eaves) = (shape.half_length, shape.half_width, shape.rise, shape.eaves);
    let toward = style.solar_toward.map(|a| {
        let a = a.to_radians();
        [a.sin(), -a.cos()]
    });
    // How much a side faces where the panels should: along ±v.
    let facing = |side: f64| toward.map_or(side, |d| side * (r.v[0] * d[0] + r.v[1] * d[1]));
    // The slope: where its eaves are across the wing (`t` along v), which way it climbs, its run.
    let (low, up, run, lift) = match shape.kind {
        RoofKind::Flat => (-hw, 1.0, 2.0 * hw, rise),
        RoofKind::Shed => (-shape.high * hw, shape.high, 2.0 * hw, 0.0),
        RoofKind::Gable | RoofKind::Hip => {
            let side = if facing(1.0) >= facing(-1.0) {
                1.0
            } else {
                -1.0
            };
            (side * hw, -side, hw, 0.0)
        }
    };
    let flat = shape.kind == RoofKind::Flat;
    // Up the slope, the plan's run of a panel and of a gap.
    let length = if flat { run } else { run.hypot(rise) };
    let (panel_run, gap_run) = (PANEL_UP * run / length, PANEL_GAP * run / length);
    let usable = run - 2.0 * PANEL_MARGIN;
    if usable < panel_run {
        return;
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let rows = ((usable + gap_run) / (panel_run + gap_run)).floor() as u32;
    // The panels each row holds (a hip's ends narrow its slope towards the ridge).
    let fits = |d_top: f64| -> u32 {
        let half = if shape.kind == RoofKind::Hip {
            hl - d_top
        } else {
            hl
        } - PANEL_MARGIN;
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let n = ((2.0 * half + PANEL_GAP) / (PANEL_ACROSS + PANEL_GAP))
            .floor()
            .max(0.0) as u32;
        n
    };
    let mut counts = Vec::new();
    let mut left = style.solar;
    for row in 0..rows {
        if left == 0 {
            break;
        }
        let d_top = PANEL_MARGIN + f64::from(row + 1) * panel_run + f64::from(row) * gap_run;
        let n = fits(d_top).min(left);
        if n == 0 {
            break;
        }
        counts.push(n);
        left -= n;
    }
    // From the eaves up, each row where it was counted: a hip's ends narrow the higher rows.
    let start = PANEL_MARGIN;
    let point = |s: f64, d: f64, above: f64| -> V3 {
        let t = low + up * d;
        let y = if flat { lift } else { rise * d / run };
        [
            r.centre[0] + r.u[0] * s + r.v[0] * t,
            eaves + y + above,
            r.centre[1] + r.u[1] * s + r.v[1] * t,
        ]
    };
    let tag = Tag {
        group: NO_GROUP,
        ..Tag::default()
    };
    let mut painter = Painter::new(mesh, PANEL_FRAME, tag);
    let none = [[0.0; 2]; 4];
    for (row, &n) in counts.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let d0 = start + row as f64 * (panel_run + gap_run);
        let d1 = d0 + panel_run;
        let width = f64::from(n) * (PANEL_ACROSS + PANEL_GAP) - PANEL_GAP;
        for k in 0..n {
            let s0 = -width / 2.0 + f64::from(k) * (PANEL_ACROSS + PANEL_GAP);
            let s1 = s0 + PANEL_ACROSS;
            let frame = [
                point(s0, d0, PANEL_LIFT),
                point(s1, d0, PANEL_LIFT),
                point(s1, d1, PANEL_LIFT),
                point(s0, d1, PANEL_LIFT),
            ];
            // Not under another wing's roof, where it meets this one.
            let covered = frame.iter().any(|corner| {
                others.iter().any(|other| {
                    other
                        .height_at([corner[0], corner[2]])
                        .is_some_and(|h| h > corner[1] - PANEL_LIFT - 1.0)
                })
            });
            if covered {
                continue;
            }
            let up_n = up_normal(&frame);
            painter.material = PANEL_FRAME;
            painter.quad(frame, none, Some(up_n), 0.0);
            // The cells inside the frame, a hair above it.
            let (inset, inset_run) = (3.0, 3.0 * run / length);
            let cells = [
                point(s0 + inset, d0 + inset_run, PANEL_LIFT + 0.6),
                point(s1 - inset, d0 + inset_run, PANEL_LIFT + 0.6),
                point(s1 - inset, d1 - inset_run, PANEL_LIFT + 0.6),
                point(s0 + inset, d1 - inset_run, PANEL_LIFT + 0.6),
            ];
            painter.material = PANEL_CELLS;
            painter.quad(cells, none, Some(up_n), 0.0);
        }
    }
}

/// The outlines of a storey's rooms, their walls and corners, and of its places outside when
/// `outside`.
fn outlines(part: &StoreyPart, outside: bool) -> Vec<Vec<P2>> {
    let mut found = Vec::new();
    for room in part
        .layout
        .rooms
        .iter()
        .filter(|room| outside || !room.outside)
    {
        found.push(room.points.clone());
        for band in room.sides.iter().flatten().flatten() {
            found.push(band.quad.to_vec());
        }
        for corner in &room.corners {
            found.push(corner.quad.to_vec());
        }
    }
    found
}

/// A rectangle on the plan: its centre, its unit axes (`u` along the longer side, `v` = `u` turned
/// a quarter clockwise on the plan, as `RoofShape` reads across) and half its length and width.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rectangle {
    centre: P2,
    u: P2,
    v: P2,
    half_length: f64,
    half_width: f64,
}

impl Rectangle {
    /// The rectangle of centre `centre` and half sizes `half` along the unit `axis` and across it,
    /// its ridge along the longer.
    fn new(centre: P2, axis: P2, half: [f64; 2]) -> Rectangle {
        let across = [-axis[1], axis[0]];
        let (u, half_length, half_width) = if half[0] >= half[1] {
            (axis, half[0], half[1])
        } else {
            (across, half[1], half[0])
        };
        Rectangle {
            centre,
            u,
            v: [-u[1], u[0]],
            half_length,
            half_width,
        }
    }
}

/// The wings of a footprint (polygons whose union it is) where `above` does not cover it, the
/// largest first.
fn wings(footprint: &[Vec<P2>], above: &[&[P2]]) -> Vec<Rectangle> {
    let points: Vec<P2> = footprint.iter().flatten().copied().collect();
    let Some(frame) = smallest_rectangle(&convex_hull(points)) else {
        return Vec::new();
    };
    // A grid along the home's axes, over the rectangle around it.
    let (hl, hw) = (frame.half_length, frame.half_width);
    let cell = (2.0 * hl / CELLS).max(SMALLEST_CELL);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let (nx, ny) = (
        ((2.0 * hl / cell).ceil() as usize).max(1),
        ((2.0 * hw / cell).ceil() as usize).max(1),
    );
    #[allow(clippy::cast_precision_loss)]
    let at = |i: f64, j: f64| -> P2 {
        let (s, t) = (-hl + i * cell, -hw + j * cell);
        [
            frame.centre[0] + frame.u[0] * s + frame.v[0] * t,
            frame.centre[1] + frame.u[1] * s + frame.v[1] * t,
        ]
    };
    let boxed = |poly: &[P2]| {
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for p in poly {
            for k in 0..2 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        (lo, hi)
    };
    let within = |polys: &[(&[P2], (P2, P2))], p: P2, edge: bool| {
        polys.iter().any(|(poly, (lo, hi))| {
            p[0] >= lo[0]
                && p[0] <= hi[0]
                && p[1] >= lo[1]
                && p[1] <= hi[1]
                && point_in_polygon(p, poly, edge)
        })
    };
    let footprint: Vec<(&[P2], (P2, P2))> =
        footprint.iter().map(|p| (p.as_slice(), boxed(p))).collect();
    let above: Vec<(&[P2], (P2, P2))> = above.iter().map(|p| (*p, boxed(p))).collect();
    let mut roofed = vec![false; nx * ny];
    #[allow(clippy::cast_precision_loss)]
    for j in 0..ny {
        for i in 0..nx {
            let p = at(i as f64 + 0.5, j as f64 + 0.5);
            roofed[j * nx + i] = within(&footprint, p, true) && !within(&above, p, false);
        }
    }
    let total = roofed.iter().filter(|c| **c).count();
    if total == 0 {
        return Vec::new();
    }
    let mut covered = vec![false; nx * ny];
    let mut found: Vec<[usize; 4]> = Vec::new();
    // Each wing the largest rectangle of what is left, grown over what is roofed; slivers set
    // aside.
    for _ in 0..MAX_WINGS * 4 {
        if found.len() >= MAX_WINGS {
            break;
        }
        let left: Vec<bool> = roofed
            .iter()
            .zip(&covered)
            .map(|(r, c)| *r && !*c)
            .collect();
        #[allow(clippy::cast_precision_loss)]
        if (left.iter().filter(|c| **c).count() as f64) < total as f64 * 0.03 {
            break;
        }
        let Some(rect) = largest_rectangle(&left, nx, ny) else {
            break;
        };
        let rect = grow(&roofed, nx, ny, rect);
        let [i0, j0, i1, j1] = rect;
        for j in j0..j1 {
            for i in i0..i1 {
                covered[j * nx + i] = true;
            }
        }
        #[allow(clippy::cast_precision_loss)]
        if ((i1 - i0) as f64 * cell).min((j1 - j0) as f64 * cell) >= NARROWEST {
            found.push(rect);
        }
    }
    let wing = |[i0, j0, i1, j1]: [usize; 4]| {
        #[allow(clippy::cast_precision_loss)]
        let (a, b) = (at(i0 as f64, j0 as f64), at(i1 as f64, j1 as f64));
        #[allow(clippy::cast_precision_loss)]
        let half = [(i1 - i0) as f64 * cell / 2.0, (j1 - j0) as f64 * cell / 2.0];
        Rectangle::new(
            [f64::midpoint(a[0], b[0]), f64::midpoint(a[1], b[1])],
            frame.u,
            half,
        )
    };
    let wings_area: usize = {
        let mut union = vec![false; nx * ny];
        for &[i0, j0, i1, j1] in &found {
            for j in j0..j1 {
                for i in i0..i1 {
                    union[j * nx + i] = roofed[j * nx + i];
                }
            }
        }
        union.iter().filter(|c| **c).count()
    };
    if found.is_empty() {
        // Slivers alone (the rim of walls a storey above leaves out): no roof.
        return Vec::new();
    }
    #[allow(clippy::cast_precision_loss)]
    let left_over = 1.0 - wings_area as f64 / total as f64;
    if left_over > LEFT_OVER {
        // Walls not square to each other: one wing over the smallest rectangle around what is
        // roofed, unless it would run over a storey above (what is left over is a rim round it).
        #[allow(clippy::cast_precision_loss)]
        let cells: Vec<P2> = (0..nx * ny)
            .filter(|k| roofed[*k])
            .flat_map(|k| {
                let (i, j) = ((k % nx) as f64, (k / nx) as f64);
                [
                    at(i, j),
                    at(i + 1.0, j),
                    at(i + 1.0, j + 1.0),
                    at(i, j + 1.0),
                ]
            })
            .collect();
        #[allow(clippy::cast_precision_loss)]
        let over_above = |r: &Rectangle| {
            (0..nx * ny).any(|k| {
                let p = at((k % nx) as f64 + 0.5, (k / nx) as f64 + 0.5);
                let d = [p[0] - r.centre[0], p[1] - r.centre[1]];
                let (s, t) = (d[0] * r.u[0] + d[1] * r.u[1], d[0] * r.v[0] + d[1] * r.v[1]);
                s.abs() < r.half_length
                    && t.abs() < r.half_width
                    && within(&above, p, false)
                    && within(&footprint, p, true)
            })
        };
        if let Some(whole) = smallest_rectangle(&convex_hull(cells))
            .map(|r| Rectangle::new(r.centre, r.u, [r.half_length, r.half_width]))
            .filter(|r| !over_above(r))
        {
            return vec![whole];
        }
    }
    found.into_iter().map(wing).collect()
}

/// The largest rectangle of `true` cells of a grid `nx` wide, as `[i0, j0, i1, j1]` (ends
/// excluded).
fn largest_rectangle(cells: &[bool], nx: usize, ny: usize) -> Option<[usize; 4]> {
    let mut heights = vec![0usize; nx];
    let mut best: Option<(usize, [usize; 4])> = None;
    for j in 0..ny {
        for i in 0..nx {
            heights[i] = if cells[j * nx + i] { heights[i] + 1 } else { 0 };
        }
        // The largest rectangle under the histogram of the rows up to this one.
        let mut stack: Vec<usize> = Vec::new();
        for i in 0..=nx {
            let h = if i < nx { heights[i] } else { 0 };
            while let Some(&top) = stack.last() {
                if heights[top] < h {
                    break;
                }
                stack.pop();
                let height = heights[top];
                let start = stack.last().map_or(0, |s| s + 1);
                let area = height * (i - start);
                if height > 0 && best.is_none_or(|(a, _)| area > a) {
                    best = Some((area, [start, j + 1 - height, i, j + 1]));
                }
            }
            stack.push(i);
        }
    }
    best.map(|(_, rect)| rect)
}

/// `rect` grown row by row and column by column while what it takes in is all `true`.
fn grow(cells: &[bool], nx: usize, ny: usize, rect: [usize; 4]) -> [usize; 4] {
    let [mut i0, mut j0, mut i1, mut j1] = rect;
    let column = |i: usize, j0: usize, j1: usize| (j0..j1).all(|j| cells[j * nx + i]);
    let row = |j: usize, i0: usize, i1: usize| (i0..i1).all(|i| cells[j * nx + i]);
    loop {
        let mut grew = false;
        if i0 > 0 && column(i0 - 1, j0, j1) {
            i0 -= 1;
            grew = true;
        }
        if i1 < nx && column(i1, j0, j1) {
            i1 += 1;
            grew = true;
        }
        if j0 > 0 && row(j0 - 1, i0, i1) {
            j0 -= 1;
            grew = true;
        }
        if j1 < ny && row(j1, i0, i1) {
            j1 += 1;
            grew = true;
        }
        if !grew {
            return [i0, j0, i1, j1];
        }
    }
}

/// The normal of a flat face (its first three corners), turned up.
fn up_normal(face: &[V3]) -> V3 {
    let (a, b, c) = (face[0], face[1], face[2]);
    let (e, f) = (
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    );
    let n = [
        e[1] * f[2] - e[2] * f[1],
        e[2] * f[0] - e[0] * f[2],
        e[0] * f[1] - e[1] * f[0],
    ];
    if n[1] < 0.0 { [-n[0], -n[1], -n[2]] } else { n }
}

/// A slope of a roof: `top` its corners (3 or 4), tiles over it, its underside `thickness` below,
/// the edges flagged in `edges` (`k`: from corner `k` to the next) closed, and its outlines.
fn slope(
    painter: &mut Painter<'_>,
    lines: &mut Lines,
    tiles: Material,
    top: &[V3],
    edges: &[bool],
    thickness: f64,
) {
    let n = top.len();
    let quad = |pts: &[V3]| -> [V3; 4] {
        if pts.len() == 3 {
            [pts[0], pts[1], pts[2], pts[2]]
        } else {
            [pts[0], pts[1], pts[2], pts[3]]
        }
    };
    let none = [[0.0; 2]; 4];
    let up = up_normal(top);
    painter.material = tiles;
    painter.quad(quad(top), none, Some(up), 0.0);
    let below: Vec<V3> = top.iter().map(|v| [v[0], v[1] - thickness, v[2]]).collect();
    painter.material = UNDERSIDE;
    painter.quad(quad(&below), none, Some([-up[0], -up[1], -up[2]]), 0.0);
    #[allow(clippy::cast_precision_loss)]
    let centre = [
        top.iter().map(|v| v[0]).sum::<f64>() / n as f64,
        top.iter().map(|v| v[2]).sum::<f64>() / n as f64,
    ];
    for k in 0..n {
        let (a, b) = (top[k], top[(k + 1) % n]);
        if (a[0] - b[0]).hypot(a[2] - b[2]) + (a[1] - b[1]).abs() < 0.01 {
            continue;
        }
        lines.push(
            [a[0], a[2]],
            a[1],
            [b[0], b[2]],
            b[1],
            NO_GROUP,
            LineKind::Wall,
        );
        if !edges[k] {
            continue;
        }
        let out = [
            f64::midpoint(a[0], b[0]) - centre[0],
            0.0,
            f64::midpoint(a[2], b[2]) - centre[1],
        ];
        painter.quad([a, b, below[(k + 1) % n], below[k]], none, Some(out), 0.0);
    }
}

/// Draws a wing's roof over `r` (the walls' rectangle), its eaves on the walls' tops at `eaves`
/// (the shaders darken what stands near a floor, which a roof is not); a lean-to's high side
/// towards `high` (±1 along `v`); returns its shape.
fn draw_wing(
    mesh: &mut Mesh,
    lines: &mut Lines,
    r: &Rectangle,
    eaves: f64,
    style: &RoofStyle,
    high: f64,
) -> RoofShape {
    let flat = style.kind == RoofKind::Flat;
    let over = if flat { FLAT_OVERHANG } else { OVERHANG };
    let (hl, hw) = (r.half_length + over, r.half_width + over);
    let tan = style
        .pitch
        .clamp(PITCH_RANGE.0, PITCH_RANGE.1)
        .to_radians()
        .tan();
    let rise = match style.kind {
        RoofKind::Flat => FLAT_THICKNESS,
        RoofKind::Shed => (2.0 * hw * tan).min(MAX_RISE),
        RoofKind::Gable | RoofKind::Hip => (hw * tan).min(MAX_RISE),
    };
    let shape = RoofShape {
        kind: style.kind,
        centre: r.centre,
        ridge: r.u,
        half_length: hl,
        half_width: hw,
        eaves,
        rise,
        high,
    };
    let at = |s: f64, t: f64| -> P2 {
        [
            r.centre[0] + r.u[0] * s + r.v[0] * t,
            r.centre[1] + r.u[1] * s + r.v[1] * t,
        ]
    };
    let p = |s: f64, t: f64, y: f64| -> V3 {
        let q = at(s, t);
        [q[0], eaves + y, q[1]]
    };
    let tag = Tag {
        group: NO_GROUP,
        ..Tag::default()
    };
    let colour = style.color.unwrap_or(if flat { MEMBRANE } else { TILES });
    let tiles = Material::new(colour, 0.85, Surface::Matte);
    let mut painter = Painter::new(mesh, tiles, tag);
    let none = [[0.0; 2]; 4];
    // The walls' line under it, for the gables.
    let (gl, gw) = (r.half_length, r.half_width);
    match style.kind {
        RoofKind::Flat => {
            let corners = [
                p(-hl, -hw, rise),
                p(hl, -hw, rise),
                p(hl, hw, rise),
                p(-hl, hw, rise),
            ];
            slope(&mut painter, lines, tiles, &corners, &[true; 4], rise);
        }
        RoofKind::Gable => {
            for side in [-1.0, 1.0] {
                let face = [
                    p(-hl, side * hw, 0.0),
                    p(hl, side * hw, 0.0),
                    p(hl, 0.0, rise),
                    p(-hl, 0.0, rise),
                ];
                slope(
                    &mut painter,
                    lines,
                    tiles,
                    &face,
                    &[true, true, false, true],
                    THICKNESS,
                );
            }
            // The gable walls, up to the underside.
            painter.material = GABLE;
            let under = |t: f64| rise * (1.0 - t.abs() / hw) - THICKNESS;
            for k in [-1.0, 1.0] {
                let s = gl * k;
                let eave = under(gw).max(0.0);
                painter.quad(
                    [
                        p(s, -gw, 0.0),
                        p(s, gw, 0.0),
                        p(s, gw, eave),
                        p(s, -gw, eave),
                    ],
                    none,
                    Some([r.u[0] * k, 0.0, r.u[1] * k]),
                    0.0,
                );
                painter.quad(
                    [
                        p(s, -gw, eave),
                        p(s, gw, eave),
                        p(s, 0.0, under(0.0)),
                        p(s, 0.0, under(0.0)),
                    ],
                    none,
                    Some([r.u[0] * k, 0.0, r.u[1] * k]),
                    0.0,
                );
            }
        }
        RoofKind::Hip => {
            let ridge = (hl - hw).max(0.0);
            let (r0, r1) = (p(-ridge, 0.0, rise), p(ridge, 0.0, rise));
            for side in [-1.0, 1.0] {
                let face = [p(-hl, side * hw, 0.0), p(hl, side * hw, 0.0), r1, r0];
                slope(
                    &mut painter,
                    lines,
                    tiles,
                    &face,
                    &[true, false, false, false],
                    THICKNESS,
                );
            }
            for (k, ridge_end) in [(-1.0, r0), (1.0, r1)] {
                let face = [p(k * hl, -hw, 0.0), p(k * hl, hw, 0.0), ridge_end];
                slope(
                    &mut painter,
                    lines,
                    tiles,
                    &face,
                    &[true, false, false],
                    THICKNESS,
                );
            }
        }
        RoofKind::Shed => {
            // Low along −high, high along +high.
            let face = [
                p(-hl, -high * hw, 0.0),
                p(hl, -high * hw, 0.0),
                p(hl, high * hw, rise),
                p(-hl, high * hw, rise),
            ];
            slope(&mut painter, lines, tiles, &face, &[true; 4], THICKNESS);
            // Its walls: the high one and the two sides, up to the underside.
            painter.material = GABLE;
            let under = |t: f64| (rise * (t * high + hw) / (2.0 * hw) - THICKNESS).max(0.0);
            let top = under(gw * high);
            painter.quad(
                [
                    p(-gl, high * gw, 0.0),
                    p(gl, high * gw, 0.0),
                    p(gl, high * gw, top),
                    p(-gl, high * gw, top),
                ],
                none,
                Some([r.v[0] * high, 0.0, r.v[1] * high]),
                0.0,
            );
            for k in [-1.0, 1.0] {
                let s = gl * k;
                painter.quad(
                    [
                        p(s, -gw, 0.0),
                        p(s, gw, 0.0),
                        p(s, gw, under(gw)),
                        p(s, -gw, under(-gw)),
                    ],
                    none,
                    Some([r.u[0] * k, 0.0, r.u[1] * k]),
                    0.0,
                );
            }
        }
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
        best = Some((area, Rectangle::new(centre, d, [along / 2.0, across / 2.0])));
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
        // The ridge runs along the longer side; `v` is `u` turned a quarter.
        assert!((r.u[0].abs() - c).abs() < 1e-6, "{r:?}");
        assert!((r.v[0] + r.u[1]).abs() < 1e-9 && (r.v[1] - r.u[0]).abs() < 1e-9);
        // Too few points: no rectangle.
        assert!(convex_hull(vec![[0.0, 0.0], [1.0, 1.0]]).is_empty());
        assert!(smallest_rectangle(&[]).is_none());
    }

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<P2> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    #[test]
    fn an_l_shaped_home_has_two_wings_and_a_storey_above_leaves_what_it_covers() {
        // An L: a 1000 × 500 body and a 400 × 400 wing south of its west end.
        let footprint = vec![
            square(0.0, 0.0, 1000.0, 500.0),
            square(0.0, 500.0, 400.0, 900.0),
        ];
        let found = wings(&footprint, &[]);
        assert_eq!(found.len(), 2, "{found:?}");
        let main = found[0];
        assert!((main.half_length - 500.0).abs() < 10.0 && (main.half_width - 250.0).abs() < 10.0);
        // The second wing reaches over the L's other arm, into the body (their roofs meet).
        let other = found[1];
        assert!((other.u[0].abs() < 1e-9) && (other.half_length * 2.0 - 900.0).abs() < 15.0);
        // A storey above over the east half: the wings keep to the rest.
        let above = square(500.0, 0.0, 1000.0, 500.0);
        let left = wings_of(&footprint, &[&above]);
        assert!(
            left.iter().all(|w| w.centre[0]
                + w.u[0].abs() * w.half_length
                + w.v[0].abs() * w.half_width
                <= 510.0),
            "{left:?}"
        );
        // Covered whole: no roof; covered but for a rim of walls 25 cm wide: none either.
        let all = square(-10.0, -10.0, 1010.0, 910.0);
        assert!(wings_of(&footprint, &[&all]).is_empty());
        let body = vec![square(-25.0, -25.0, 1025.0, 525.0)];
        let inner = square(0.0, 0.0, 1000.0, 500.0);
        assert!(wings_of(&body, &[&inner]).is_empty());
        // A storey above set in a little on three sides: the rim round it is no roof, the strip it
        // leaves on the fourth one is, never over it.
        let ground = vec![square(0.0, 0.0, 1000.0, 800.0)];
        for inset in [15.0, 30.0] {
            let upper = square(inset, inset, 1000.0 - inset, 600.0);
            let found = wings_of(&ground, &[&upper]);
            assert!(!found.is_empty());
            for w in &found {
                let low = w.centre[1] - w.u[1].abs() * w.half_length - w.v[1].abs() * w.half_width;
                assert!(low >= 590.0, "{inset}: {w:?}");
            }
        }
        // Narrow slivers are no wings.
        let bay = vec![
            square(0.0, 0.0, 1000.0, 500.0),
            square(400.0, 500.0, 480.0, 560.0),
        ];
        assert_eq!(wings(&bay, &[]).len(), 1);
    }

    fn wings_of(footprint: &[Vec<P2>], above: &[&Vec<P2>]) -> Vec<Rectangle> {
        let above: Vec<&[P2]> = above.iter().map(|p| p.as_slice()).collect();
        wings(footprint, &above)
    }

    #[test]
    fn a_home_turned_off_square_gets_one_wing_round_it() {
        // A triangle-ish footprint: walls not square to each other.
        let footprint = vec![vec![[0.0, 0.0], [1000.0, 0.0], [500.0, 800.0]]];
        assert_eq!(wings(&footprint, &[]).len(), 1);
    }

    #[test]
    fn every_shape_lands_rain_on_its_mesh() {
        let r = Rectangle::new([500.0, 300.0], [1.0, 0.0], [500.0, 300.0]);
        for kind in RoofKind::ALL {
            let style = RoofStyle {
                kind,
                ..RoofStyle::default()
            };
            let mut mesh = Mesh::default();
            let mut lines = Lines::default();
            let shape = draw_wing(&mut mesh, &mut lines, &r, 250.0, &style, 1.0);
            let [lo, hi] = mesh.bounds();
            assert!(
                mesh.triangle_count() > 4 && !lines.list.is_empty(),
                "{kind:?}"
            );
            // The eaves stand out from the walls; the top is as high as the shape says.
            let over = if kind == RoofKind::Flat {
                FLAT_OVERHANG
            } else {
                OVERHANG
            };
            assert!((f64::from(lo[0]) + over).abs() < 1e-3, "{kind:?}");
            assert!(
                (f64::from(hi[1]) - 250.0 - shape.rise).abs() < 1e-3,
                "{kind:?}"
            );
            // What falls on it meets its top: at the middle, at an eave.
            let at = |p: P2| shape.height_at(p).unwrap();
            match kind {
                RoofKind::Gable | RoofKind::Hip => {
                    assert!((at([500.0, 300.0]) - 250.0 - shape.rise).abs() < 1e-9);
                    assert!((at([500.0, 300.0 + 330.0]) - 250.0).abs() < 1e-9);
                }
                RoofKind::Shed => {
                    assert!((at([500.0, 300.0 + 330.0]) - 250.0 - shape.rise).abs() < 1e-9);
                    assert!((at([500.0, -30.0]) - 250.0).abs() < 1e-9);
                }
                RoofKind::Flat => assert!((at([700.0, 100.0]) - 250.0 - shape.rise).abs() < 1e-9),
            }
            assert!(shape.height_at([500.0, 1000.0]).is_none());
        }
        // A hip roof slopes at its ends too.
        let style = RoofStyle {
            kind: RoofKind::Hip,
            ..RoofStyle::default()
        };
        let mut mesh = Mesh::default();
        let shape = draw_wing(&mut mesh, &mut Lines::default(), &r, 250.0, &style, 1.0);
        assert!((shape.height_at([-30.0, 300.0]).unwrap() - 250.0).abs() < 1e-9);
    }

    #[test]
    fn the_settings_say_the_shape_its_pitch_and_colour() {
        let style = RoofStyle::read(
            &serde_json::json!({ "shape": "hip", "pitch": 80, "color": "#7a4a3a" }),
        );
        assert_eq!(style.kind, RoofKind::Hip);
        assert_eq!(style.pitch, PITCH_RANGE.1);
        assert_eq!(style.color, Some(Rgb8::from_u32(0x7a4a3a)));
        assert_eq!(
            RoofStyle::read(&serde_json::json!({ "shape": "dome" })),
            RoofStyle::default()
        );
        let solar = RoofStyle::read(&serde_json::json!({ "solar": 500, "solar_toward": 90 }));
        assert_eq!((solar.solar, solar.solar_toward), (MAX_PANELS, Some(90.0)));
        assert_eq!(
            RoofStyle::read(&serde_json::json!({ "solar": -3 })).solar,
            0
        );
    }

    #[test]
    fn solar_panels_lie_on_the_slope_facing_the_sun() {
        // A wing 1000 × 800 along x: its slopes face ±y on the plan.
        let r = Rectangle::new([500.0, 400.0], [1.0, 0.0], [500.0, 400.0]);
        let panels = |toward: Option<f64>, count: u32, kind: RoofKind| -> Mesh {
            let style = RoofStyle {
                kind,
                solar: count,
                solar_toward: toward,
                ..RoofStyle::default()
            };
            let shape = draw_wing(
                &mut Mesh::default(),
                &mut Lines::default(),
                &r,
                250.0,
                &style,
                1.0,
            );
            let mut mesh = Mesh::default();
            draw_panels(&mut mesh, &r, &shape, &[], &style);
            mesh
        };
        // Facing the top of the plan (−y): every panel on the −y slope, above the eaves.
        let mesh = panels(Some(0.0), 6, RoofKind::Gable);
        assert_eq!(mesh.vertex_count(), 6 * 2 * 4);
        let vertices = &mesh.positions;
        assert!(
            vertices.iter().all(|v| v[2] < 400.0 && v[1] > 250.0),
            "{vertices:?}"
        );
        // Facing the bottom: the other slope.
        let mesh = panels(Some(180.0), 6, RoofKind::Gable);
        assert!(mesh.positions.iter().all(|v| v[2] > 400.0));
        // No more than fit; none asked, none drawn.
        let many = panels(Some(0.0), MAX_PANELS, RoofKind::Hip).vertex_count();
        assert!(many > 0 && many < MAX_PANELS as usize * 8, "{many}");
        assert_eq!(panels(None, 0, RoofKind::Gable).vertex_count(), 0);
        assert!(panels(None, 4, RoofKind::Flat).vertex_count() == 4 * 8);
    }

    #[test]
    fn solar_panels_keep_to_their_slope_on_hips_and_by_other_wings() {
        let r = Rectangle::new([525.0, 475.0], [1.0, 0.0], [525.0, 475.0]);
        let style = |kind: RoofKind, solar: u32| RoofStyle {
            kind,
            solar,
            solar_toward: Some(180.0),
            ..RoofStyle::default()
        };
        // A hip roof: every panel just above its slope, none past the hip lines towards the ends.
        for solar in [5, 16, MAX_PANELS] {
            let hip = style(RoofKind::Hip, solar);
            let shape = draw_wing(
                &mut Mesh::default(),
                &mut Lines::default(),
                &r,
                250.0,
                &hip,
                1.0,
            );
            let mut mesh = Mesh::default();
            draw_panels(&mut mesh, &r, &shape, &[], &hip);
            assert!(mesh.vertex_count() > 0);
            for v in &mesh.positions {
                let [x, y, z, _] = v.map(f64::from);
                let roof = shape.height_at([x, z]).expect("on the roof");
                let above = y - roof;
                assert!(
                    (PANEL_LIFT - 0.01..=PANEL_LIFT + 0.61).contains(&above),
                    "{solar} panels: {above} above the roof at {v:?}"
                );
            }
        }
        // Another wing meeting this one across its south slope: no panel under its roof.
        let gable = style(RoofKind::Gable, MAX_PANELS);
        let shape = draw_wing(
            &mut Mesh::default(),
            &mut Lines::default(),
            &r,
            250.0,
            &gable,
            1.0,
        );
        let cross = Rectangle::new([525.0, 850.0], [0.0, 1.0], [200.0, 400.0]);
        let other = draw_wing(
            &mut Mesh::default(),
            &mut Lines::default(),
            &cross,
            250.0,
            &gable,
            1.0,
        );
        let (mut alone, mut beside) = (Mesh::default(), Mesh::default());
        draw_panels(&mut alone, &r, &shape, &[], &gable);
        draw_panels(&mut beside, &r, &shape, &[other], &gable);
        assert!(beside.vertex_count() > 0 && beside.vertex_count() < alone.vertex_count());
        for v in &beside.positions {
            let [x, y, z, _] = v.map(f64::from);
            if let Some(h) = other.height_at([x, z]) {
                assert!(h <= y - PANEL_LIFT + 1.0, "under the other wing at {v:?}");
            }
        }
    }
}
