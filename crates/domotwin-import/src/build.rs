//! A plan from what a file holds (`docs/plan-format.md`), whatever the file. Each import gives the
//! builder a [`Draft`] in plan coordinates (centimetres, y down): its rooms' outlines inside their
//! walls, its walls' thicknesses, its doors and windows, its pieces. The builder closes the gaps
//! between rooms that face each other across a wall (each moves to the middle of the wall, where
//! the plan format draws partitions), puts the openings on the room sides they sit in, moves the
//! plan next to the origin and keeps what the plan reader takes.

use std::collections::HashSet;

use serde_json::{Map, Value as Json, json};

use crate::math::{
    P2, V3, clean_polygon, convex_hull, interior_point, point_in_polygon, self_intersects,
    signed_area2, simplify_polygon,
};

/// Most elements of a plan.
const MAX_ELEMENTS: usize = 500;
/// Most vertices of a room.
const MAX_VERTICES: usize = 64;
/// Widest gap (cm) between two rooms that is a wall between them.
const MAX_WALL_GAP: f64 = 59.0;
/// How far (cm) from a room side an opening may be to be put on it.
const SNAP_DISTANCE: f64 = 45.0;
/// Gaps narrower than this (cm) between two rooms are closed but are not walls.
const MIN_WALL: f64 = 2.0;
/// Largest room side and farthest coordinate the plan format allows (cm).
const MAX_ROOM: f64 = 10_000.0;
const MAX_COORDINATE: f64 = 50_000.0;
/// Pieces farther than this (cm) from every room are left out.
const MAX_STRAY: f64 = 1_000.0;

/// What an import kept and left out, for the user.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub rooms: usize,
    pub doors: usize,
    pub windows: usize,
    pub furniture: usize,
    /// Spaces without a usable outline, outside spaces and gross areas left out.
    pub skipped_spaces: usize,
    /// Doors and windows not on any room side.
    pub unplaced_openings: usize,
    /// Pieces without geometry or of an unknown kind.
    pub skipped_furniture: usize,
    /// Elements left out past the plan's 500.
    pub over_limit: usize,
}

/// What an import found, in plan coordinates (centimetres, y down), before it is a plan.
#[derive(Debug, Clone, Default)]
pub struct Draft {
    /// The plan's name.
    pub name: String,
    pub rooms: Vec<DraftRoom>,
    /// The thicknesses of the file's walls and whether each is a façade, when it says: the plan's
    /// default thicknesses where no gap between two rooms measures them.
    pub walls: Vec<WallHint>,
    pub openings: Vec<DraftOpening>,
    pub pieces: Vec<DraftPiece>,
    /// What the import left out itself (spaces, openings and pieces it could not read).
    pub report: Report,
}

/// A room: its outline, inside its walls.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftRoom {
    pub id: String,
    pub name: String,
    pub points: Vec<P2>,
}

/// A wall of the file: how thick (cm), and whether it is a façade when the file says.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallHint {
    pub thickness: f64,
    pub external: Option<bool>,
}

/// A door or a window.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftOpening {
    pub id: String,
    pub name: String,
    pub door: bool,
    /// Its centre, its direction along its wall, and the side its leaf opens to (unit vectors).
    pub centre: P2,
    pub along: P2,
    pub opens: P2,
    /// Its width (cm).
    pub width: f64,
    /// A door whose leaf hangs at the far end of `along`.
    pub right: bool,
    /// A door's style other than `hinged` (`docs/plan-format.md`).
    pub style: Option<&'static str>,
}

/// A piece of furniture, an appliance or a lamp.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftPiece {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    /// The centre of its footprint, its width, depth and height (cm).
    pub centre: P2,
    pub size: V3,
    /// Its rotation (degrees, clockwise on the plan, 0–360).
    pub angle: f64,
    /// The height of its underside above the floor (cm).
    pub elevation: f64,
    /// Its upkeep card (`DECISIONS.md`, D-033), when the file says how to look after it.
    pub card: Option<Json>,
}

/// The direction (radians) the sides of `polygons` mostly run along, modulo a quarter turn; `None`
/// when they have no length.
pub(crate) fn dominant_angle<'a>(polygons: impl IntoIterator<Item = &'a [P2]>) -> Option<f64> {
    let (mut sx, mut sy) = (0.0, 0.0);
    for polygon in polygons {
        let n = polygon.len();
        for i in 0..n {
            let (a, b) = (polygon[i], polygon[(i + 1) % n]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len = dx.hypot(dy);
            let quad = 4.0 * dy.atan2(dx);
            sx += len * quad.cos();
            sy += len * quad.sin();
        }
    }
    (sx.hypot(sy) >= 1e-9).then(|| sy.atan2(sx) / 4.0)
}

/// Turns a draft about the origin so that its rooms' sides run along the axes: a scan follows
/// where the phone pointed.
pub fn align(draft: &mut Draft) {
    let Some(dominant) = dominant_angle(draft.rooms.iter().map(|r| r.points.as_slice())) else {
        return;
    };
    if dominant.abs() < 1e-4 {
        return;
    }
    let (s, c) = (-dominant).sin_cos();
    let turn = |p: P2| [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
    for room in &mut draft.rooms {
        for p in &mut room.points {
            *p = turn(*p);
        }
    }
    for o in &mut draft.openings {
        o.centre = turn(o.centre);
        o.along = turn(o.along);
        o.opens = turn(o.opens);
    }
    for piece in &mut draft.pieces {
        piece.centre = turn(piece.centre);
        let (sa, ca) = piece.angle.to_radians().sin_cos();
        piece.angle = degrees(turn([ca, sa]));
    }
}

/// The plan of a draft, what was left out, and the upkeep cards of its pieces by piece id.
///
/// # Errors
///
/// `no_spaces` when no room is left.
#[allow(clippy::too_many_lines)]
pub fn build(draft: Draft) -> Result<(Json, Report, Map<String, Json>), &'static str> {
    let Draft {
        name,
        rooms: drafted,
        walls,
        openings: drafted_openings,
        pieces: drafted_pieces,
        mut report,
    } = draft;
    let mut ids: HashSet<String> = HashSet::new();
    let mut unique = |id: String| -> String {
        let mut candidate = id.clone();
        let mut k = 2;
        while !ids.insert(candidate.clone()) {
            candidate = format!("{id}-{k}");
            k += 1;
        }
        candidate
    };
    let mut rooms: Vec<RoomOut> = Vec::new();
    for room in drafted {
        let points = clean_polygon(&room.points, 0.5);
        if points.len() < 3 || signed_area2(&points).abs() / 2.0 < 2500.0 {
            report.skipped_spaces += 1;
            continue;
        }
        // Larger than a room of the plan format can be (100 m): not a room.
        let [lo_x, lo_y, hi_x, hi_y] = bounds(&points);
        if hi_x - lo_x > MAX_ROOM || hi_y - lo_y > MAX_ROOM {
            report.skipped_spaces += 1;
            continue;
        }
        rooms.push(RoomOut {
            id: unique(room.id),
            name: room.name,
            points,
            thickness: Vec::new(),
            frame: None,
        });
    }
    // Overlapping spaces (gross areas, zones drawn over rooms): where one holds the centre of
    // another, the larger one goes.
    let centres: Vec<P2> = rooms.iter().map(|r| interior_point(&r.points)).collect();
    let areas: Vec<f64> = rooms
        .iter()
        .map(|r| signed_area2(&r.points).abs())
        .collect();
    let boxes: Vec<[f64; 4]> = rooms.iter().map(|r| bounds(&r.points)).collect();
    let mut overlapping = vec![false; rooms.len()];
    for k in 0..rooms.len() {
        let [lo_x, lo_y, hi_x, hi_y] = boxes[k];
        for j in 0..rooms.len() {
            let c = centres[j];
            let inside = c[0] >= lo_x && c[0] <= hi_x && c[1] >= lo_y && c[1] <= hi_y;
            if j != k && inside && point_in_polygon(c, &rooms[k].points) {
                let larger = if areas[k] > areas[j] || (areas[k] == areas[j] && k > j) {
                    k
                } else {
                    j
                };
                overlapping[larger] = true;
            }
        }
    }
    let before = rooms.len();
    let mut k = 0;
    rooms.retain(|_| {
        let keep = !overlapping[k];
        k += 1;
        keep
    });
    report.skipped_spaces += before - rooms.len();
    if rooms.is_empty() {
        return Err("no_spaces");
    }
    // The 500-element limit for rooms, before their gaps are measured two by two.
    if rooms.len() > MAX_ELEMENTS {
        report.over_limit += rooms.len() - MAX_ELEMENTS;
        rooms.truncate(MAX_ELEMENTS);
    }

    // Close the gaps between rooms that face each other: each moves to the middle of the wall.
    let polygons: Vec<Vec<P2>> = rooms.iter().map(|r| r.points.clone()).collect();
    let split: Vec<Vec<Side>> = (0..polygons.len())
        .map(|k| split_sides(&polygons, k))
        .collect();
    let mut measured: Vec<f64> = split
        .iter()
        .flatten()
        .filter_map(|s| s.gap)
        .filter(|g| *g >= MIN_WALL)
        .collect();
    let mut internal: Vec<f64> = walls
        .iter()
        .filter(|w| w.external != Some(true))
        .map(|w| w.thickness)
        .collect();
    let mut external: Vec<f64> = walls
        .iter()
        .filter(|w| w.external == Some(true))
        .map(|w| w.thickness)
        .collect();
    let interior = median(&mut measured)
        .or_else(|| median(&mut internal))
        .unwrap_or(10.0)
        .clamp(1.0, 100.0);
    let exterior = median(&mut external)
        .or_else(|| walls.iter().map(|w| w.thickness).reduce(f64::max))
        .unwrap_or(20.0)
        .clamp(1.0, 100.0);
    for (room, sides) in rooms.iter_mut().zip(&split) {
        let moved = offset_sides(sides);
        let points: Vec<P2> = moved.iter().map(|(p, _)| *p).collect();
        let same_turn = signed_area2(&points).signum() == signed_area2(&room.points).signum();
        if same_turn && !self_intersects(&points) {
            room.points = points;
            room.thickness = moved
                .iter()
                .map(|(_, g)| {
                    g.filter(|g| *g >= MIN_WALL && (g - interior).abs() > 3.0)
                        .map(|g| round1(g).clamp(1.0, 100.0))
                })
                .collect();
        }
    }
    for room in &mut rooms {
        let simple = simplify_polygon(&room.points, MAX_VERTICES);
        let points = if simple.len() >= 3 && !self_intersects(&simple) {
            simple
        } else {
            convex_hull(&room.points)
        };
        room.thickness = remap_thickness(&room.points, &room.thickness, &points);
        room.points = points;
    }

    // Next to the origin; every room checked as the plan reader will check it (its hull when its
    // own outline fails, left out when that fails too).
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    for p in rooms.iter().flat_map(|r| &r.points) {
        min_x = min_x.min(p[0]);
        min_y = min_y.min(p[1]);
    }
    let shift = |p: P2| [round1(p[0] - min_x), round1(p[1] - min_y)];
    for room in &mut rooms {
        room.frame = room_frame(&room.points, shift);
        if room.frame.is_none() {
            let hull = convex_hull(&room.points);
            room.thickness = remap_thickness(&room.points, &room.thickness, &hull);
            room.frame = room_frame(&hull, shift);
            room.points = hull;
        }
    }
    let before = rooms.len();
    rooms.retain(|r| r.frame.is_some());
    report.skipped_spaces += before - rooms.len();
    if rooms.is_empty() {
        return Err("no_spaces");
    }

    // Openings, on the room sides they sit in.
    struct Opening {
        id: String,
        name: String,
        door: bool,
        room: usize,
        p0: P2,
        u: P2,
        w: f64,
        swing: f64,
        style: Option<&'static str>,
    }
    let mut openings: Vec<Opening> = Vec::new();
    for o in drafted_openings {
        if o.width < 1.0 {
            report.unplaced_openings += 1;
            continue;
        }
        let Some(placed) = snap(&rooms, o.centre, o.along, o.width) else {
            report.unplaced_openings += 1;
            continue;
        };
        let max = if o.door { 300.0 } else { 1000.0 };
        let w = o.width.clamp(20.0, max);
        let u = if o.right {
            [-placed.u[0], -placed.u[1]]
        } else {
            placed.u
        };
        let p0 = [
            placed.centre[0] - u[0] * w / 2.0,
            placed.centre[1] - u[1] * w / 2.0,
        ];
        let n = [-u[1], u[0]];
        let swing = if o.opens[0] * n[0] + o.opens[1] * n[1] < 0.0 {
            -1.0
        } else {
            1.0
        };
        openings.push(Opening {
            id: unique(o.id),
            name: o.name,
            door: o.door,
            room: placed.room,
            p0,
            u,
            w,
            swing,
            style: if o.door { o.style } else { None },
        });
    }

    // Pieces: those far from every room (a stray piece at the project origin) are left out.
    let mut pieces: Vec<DraftPiece> = Vec::new();
    for mut piece in drafted_pieces {
        let centre = piece.centre;
        let near = rooms.iter().any(|r| {
            let [lo_x, lo_y, hi_x, hi_y] = bounds(&r.points);
            centre[0] > lo_x - MAX_STRAY
                && centre[0] < hi_x + MAX_STRAY
                && centre[1] > lo_y - MAX_STRAY
                && centre[1] < hi_y + MAX_STRAY
        });
        let shifted = shift(centre);
        let size = piece.size;
        // Wider or deeper than the plan format takes (100 m): not a piece.
        if !near
            || !(size[0].is_finite() && size[1].is_finite())
            || size[0].max(size[1]) > MAX_ROOM
            || shifted
                .iter()
                .any(|v| v.abs() + size[0].max(size[1]) > MAX_COORDINATE)
        {
            report.skipped_furniture += 1;
            continue;
        }
        piece.id = unique(piece.id);
        pieces.push(piece);
    }

    // The 500-element limit: rooms, then doors and windows, then the largest pieces.
    let mut budget = MAX_ELEMENTS - rooms.len();
    if openings.len() > budget {
        report.over_limit += openings.len() - budget;
        openings.truncate(budget);
    }
    budget -= openings.len();
    if pieces.len() > budget {
        pieces.sort_by(|a, b| {
            let v = |p: &DraftPiece| p.size[0] * p.size[1] * p.size[2];
            v(b).total_cmp(&v(a))
        });
        report.over_limit += pieces.len() - budget;
        pieces.truncate(budget);
    }

    let mut out_rooms: Vec<Json> = Vec::new();
    for room in &rooms {
        let Some(outline) = &room.frame else { continue };
        let mut e = Map::new();
        e.insert("id".into(), json!(room.id));
        e.insert("name".into(), json!(room.name));
        e.insert("outline".into(), json!(outline));
        if room.thickness.len() == room.points.len() && room.thickness.iter().any(Option::is_some) {
            let sides: Vec<Json> = room
                .thickness
                .iter()
                .map(|t| t.map_or(Json::Null, |t| json!({ "thickness": t })))
                .collect();
            e.insert("sides".into(), Json::Array(sides));
        }
        if let Some(floor) = floor_for(&room.name) {
            e.insert("floor".into(), json!({ "material": floor }));
        }
        out_rooms.push(Json::Object(e));
    }
    report.rooms = rooms.len();
    let (mut doors, mut windows) = (Vec::new(), Vec::new());
    for o in &openings {
        let p0 = shift(o.p0);
        let w = round1(o.w);
        let mut e = Map::new();
        e.insert("id".into(), json!(o.id));
        e.insert("name".into(), json!(o.name));
        e.insert("from".into(), json!([p0[0], p0[1]]));
        // The far end to the hundredth, so that the width read back is `w` on a slanted wall.
        let hundredth = |v: f64| (v * 100.0).round() / 100.0;
        e.insert(
            "to".into(),
            json!([hundredth(p0[0] + o.u[0] * w), hundredth(p0[1] + o.u[1] * w)]),
        );
        if o.door && o.swing < 0.0 {
            e.insert("opensTo".into(), json!("left"));
        }
        if let Some(style) = o.style.filter(|s| *s != "hinged") {
            e.insert("style".into(), json!(style));
        }
        e.insert("room".into(), json!(rooms[o.room].id));
        if o.door {
            doors.push(Json::Object(e));
            report.doors += 1;
        } else {
            windows.push(Json::Object(e));
            report.windows += 1;
        }
    }
    let mut items = Vec::new();
    let mut cards = Map::new();
    for p in pieces {
        let c = shift(p.centre);
        let room = rooms
            .iter()
            .find(|r| point_in_polygon(p.centre, &r.points))
            .map(|r| r.id.clone());
        let mut e = Map::new();
        e.insert("id".into(), json!(p.id));
        e.insert("name".into(), json!(p.name));
        e.insert("kind".into(), json!(p.kind));
        e.insert("at".into(), json!([round1(c[0]), round1(c[1])]));
        e.insert(
            "size".into(),
            json!([
                round1(p.size[0]).max(1.0),
                round1(p.size[1]).max(1.0),
                round1(p.size[2]).clamp(1.0, 300.0)
            ]),
        );
        e.insert("rotation".into(), json!(p.angle));
        if p.elevation >= 0.5 {
            e.insert("lift".into(), json!(round1(p.elevation).min(300.0)));
        }
        if let Some(room) = room {
            e.insert("room".into(), json!(room));
        }
        items.push(Json::Object(e));
        report.furniture += 1;
        // What the file says about looking after each piece (D-033), by the piece's id.
        if let Some(card) = p.card {
            cards.insert(p.id, card);
        }
    }

    let plan = json!({
        "format": "domotwin-plan",
        "version": 1,
        "name": name,
        "wallThickness": { "interior": round1(interior), "exterior": round1(exterior) },
        "rooms": out_rooms,
        "doors": doors,
        "windows": windows,
        "items": items,
    });
    Ok((plan, report, cards))
}

fn outward_normal(points: &[P2], i: usize) -> P2 {
    let n = points.len();
    let (a, b) = (points[i], points[(i + 1) % n]);
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = dx.hypot(dy).max(1e-12);
    // Counter-clockwise (positive area, y up): outward is to the right of the direction.
    if signed_area2(points) > 0.0 {
        [dy / len, -dx / len]
    } else {
        [-dy / len, dx / len]
    }
}

/// The portions `(t0, t1, gap)` of side `i` of room `k` that face a side of another room across a
/// gap of at most `MAX_WALL_GAP` cm, the nearest room winning where two overlap.
fn facing(rooms: &[Vec<P2>], k: usize, i: usize) -> Vec<(f64, f64, f64)> {
    let points = &rooms[k];
    let n = points.len();
    let (a, b) = (points[i], points[(i + 1) % n]);
    let len = (b[0] - a[0]).hypot(b[1] - a[1]);
    if len < 1.0 {
        return Vec::new();
    }
    let d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let normal = outward_normal(points, i);
    let mut found: Vec<(f64, f64, f64)> = Vec::new();
    for (j, other) in rooms.iter().enumerate() {
        if j == k {
            continue;
        }
        let m = other.len();
        for s in 0..m {
            let (c, e) = (other[s], other[(s + 1) % m]);
            let elen = (e[0] - c[0]).hypot(e[1] - c[1]);
            if elen < 1.0 || ((d[0] * (e[1] - c[1]) - d[1] * (e[0] - c[0])) / elen).abs() > 0.02 {
                continue;
            }
            let on = outward_normal(other, s);
            if on[0] * normal[0] + on[1] * normal[1] > -0.98 {
                continue;
            }
            let gap = (c[0] - a[0]) * normal[0] + (c[1] - a[1]) * normal[1];
            if gap <= 0.3 || gap > MAX_WALL_GAP {
                continue;
            }
            let tc = ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1]) / len;
            let te = ((e[0] - a[0]) * d[0] + (e[1] - a[1]) * d[1]) / len;
            let (lo, hi) = (tc.min(te).max(0.0), tc.max(te).min(1.0));
            if (hi - lo) * len >= 5.0 {
                found.push((lo, hi, gap));
            }
        }
    }
    // The nearest first; farther ones keep only what is not covered yet.
    found.sort_by(|x, y| x.2.total_cmp(&y.2));
    let mut taken: Vec<(f64, f64, f64)> = Vec::new();
    for (lo, hi, gap) in found {
        let mut pieces = vec![(lo, hi)];
        for &(t0, t1, _) in &taken {
            pieces = pieces
                .into_iter()
                .flat_map(|(p0, p1)| {
                    let mut out = Vec::new();
                    if t0 > p0 {
                        out.push((p0, t0.min(p1)));
                    }
                    if t1 < p1 {
                        out.push((t1.max(p0), p1));
                    }
                    out
                })
                .filter(|(p0, p1)| (p1 - p0) * len >= 5.0)
                .collect();
        }
        taken.extend(pieces.into_iter().map(|(p0, p1)| (p0, p1, gap)));
    }
    taken.sort_by(|x, y| x.0.total_cmp(&y.0));
    // Portions at the same distance are one, across the end of a partition meeting the wall.
    let mut merged: Vec<(f64, f64, f64)> = Vec::new();
    for (lo, hi, gap) in taken {
        match merged.last_mut() {
            Some(last) if (lo - last.1) * len < 30.0 && (gap - last.2).abs() < 2.0 => last.1 = hi,
            _ => merged.push((lo, hi, gap)),
        }
    }
    // Snap to the corners when within 2 cm.
    for piece in &mut merged {
        if piece.0 * len < 2.0 {
            piece.0 = 0.0;
        }
        if (1.0 - piece.1) * len < 2.0 {
            piece.1 = 1.0;
        }
    }
    merged
}

/// A side of a room after splitting: where it starts, how far it moves out, and the gap it
/// closes (`None` for a side facing no room).
#[derive(Debug, Clone, Copy)]
struct Side {
    start: P2,
    offset: f64,
    gap: Option<f64>,
}

/// Room `k`'s sides, split where a facing room starts or ends.
fn split_sides(rooms: &[Vec<P2>], k: usize) -> Vec<Side> {
    let points = &rooms[k];
    let n = points.len();
    let mut sides = Vec::new();
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let at = |t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let mut cur = 0.0;
        for (t0, t1, gap) in facing(rooms, k, i) {
            if t0 > cur {
                sides.push(Side {
                    start: at(cur),
                    offset: 0.0,
                    gap: None,
                });
            }
            sides.push(Side {
                start: at(t0.max(cur)),
                offset: gap / 2.0,
                gap: Some(gap),
            });
            cur = t1;
        }
        if cur < 1.0 {
            sides.push(Side {
                start: at(cur),
                offset: 0.0,
                gap: None,
            });
        }
    }
    sides
}

/// Moves every side out by its offset; collinear sides moving by different amounts are joined by
/// a short step. Returns the new corners with the gap closed by the side starting there.
fn offset_sides(sides: &[Side]) -> Vec<(P2, Option<f64>)> {
    let n = sides.len();
    let points: Vec<P2> = sides.iter().map(|s| s.start).collect();
    let normals: Vec<P2> = (0..n).map(|i| outward_normal(&points, i)).collect();
    let line = |i: usize| -> (P2, P2) {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let o = sides[i].offset;
        (
            [a[0] + normals[i][0] * o, a[1] + normals[i][1] * o],
            [b[0] - a[0], b[1] - a[1]],
        )
    };
    let mut out = Vec::with_capacity(n + 4);
    for k in 0..n {
        let prev = (k + n - 1) % n;
        let (p1, d1) = line(prev);
        let (p2, d2) = line(k);
        let moved = |i: usize| {
            [
                points[k][0] + normals[i][0] * sides[i].offset,
                points[k][1] + normals[i][1] * sides[i].offset,
            ]
        };
        let den = d1[0] * d2[1] - d1[1] * d2[0];
        let scale = d1[0].hypot(d1[1]) * d2[0].hypot(d2[1]);
        if den.abs() <= 1e-6 * scale.max(1e-12) {
            if (sides[prev].offset - sides[k].offset).abs() > 1e-6 {
                // A step between collinear sides.
                out.push((moved(prev), None));
            }
            out.push((moved(k), sides[k].gap));
            continue;
        }
        let t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
        let q = [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
        let corner = if (q[0] - points[k][0]).hypot(q[1] - points[k][1]) > MAX_WALL_GAP {
            moved(k)
        } else {
            q
        };
        out.push((corner, sides[k].gap));
    }
    out
}

/// A room before it is written.
struct RoomOut {
    id: String,
    name: String,
    points: Vec<P2>,
    /// Partition thickness of each side when it differs from the plan's interior thickness.
    thickness: Vec<Option<f64>>,
    /// The outline written, once checked.
    frame: Option<Vec<P2>>,
}

fn bounds(points: &[P2]) -> [f64; 4] {
    points.iter().fold(
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
}

/// The outline of a room once shifted and rounded to the millimetre, or `None` when the plan
/// reader would refuse it: the same tests (size, position, corners, crossing or touching sides,
/// area).
fn room_frame(points: &[P2], shift: impl Fn(P2) -> P2) -> Option<Vec<P2>> {
    let points: Vec<P2> = points.iter().map(|&p| shift(p).map(round1)).collect();
    let [lo_x, lo_y, hi_x, hi_y] = bounds(&points);
    if hi_x - lo_x > MAX_ROOM || hi_y - lo_y > MAX_ROOM {
        return None;
    }
    if [lo_x, lo_y, hi_x, hi_y]
        .iter()
        .any(|v| v.abs() > MAX_COORDINATE)
    {
        return None;
    }
    let valid = (3..=MAX_VERTICES).contains(&points.len())
        && !self_intersects(&points)
        && signed_area2(&points).abs() / 2.0 >= 25.0;
    valid.then_some(points)
}

/// The thickness of each side of `points` from the side of `old` it lies on (after removing
/// corners, most sides keep theirs).
fn remap_thickness(old: &[P2], thickness: &[Option<f64>], points: &[P2]) -> Vec<Option<f64>> {
    if thickness.len() != old.len() || thickness.iter().all(Option::is_none) {
        return Vec::new();
    }
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            let m_old = old.len();
            (0..m_old)
                .find(|&k| {
                    let (p, q) = (old[k], old[(k + 1) % m_old]);
                    segment_distance(m, p, q) < 1.0
                })
                .and_then(|k| thickness[k])
        })
        .collect()
}

fn segment_distance(m: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 < 1e-12 {
        0.0
    } else {
        (((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    };
    (m[0] - a[0] - dx * t).hypot(m[1] - a[1] - dy * t)
}

fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    Some(values[values.len() / 2])
}

pub(crate) fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Floor material from a room name (a guess the user can change).
fn floor_for(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    let any = |words: &[&str]| words.iter().any(|w| lower.contains(w));
    if any(&[
        "bath",
        "salle de bain",
        "sdb",
        "wc",
        "toilet",
        "shower",
        "douche",
        "bad",
    ]) {
        Some("white-tiles")
    } else if any(&[
        "kitchen",
        "cuisine",
        "küche",
        "kuche",
        "laundry",
        "buanderie",
    ]) {
        Some("beige-tiles")
    } else if any(&[
        "living", "séjour", "sejour", "salon", "bedroom", "chambre", "office", "bureau", "wohn",
        "schlaf", "dining",
    ]) {
        Some("oak")
    } else {
        None
    }
}

/// An opening on a room side.
struct Placed {
    room: usize,
    /// Centre on the side line, unit direction along the side (same sense as the element's x).
    centre: P2,
    u: P2,
}

/// The room side an opening of width `w` centred at `c`, along `u`, sits in.
fn snap(rooms: &[RoomOut], c: P2, u: P2, w: f64) -> Option<Placed> {
    let mut best: Option<(f64, Placed)> = None;
    for (k, room) in rooms.iter().enumerate() {
        let n = room.points.len();
        for i in 0..n {
            let (a, b) = (room.points[i], room.points[(i + 1) % n]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len = dx.hypot(dy);
            if len < 1.0 {
                continue;
            }
            let d = [dx / len, dy / len];
            let along = u[0] * d[0] + u[1] * d[1];
            if along.abs() < 0.97 {
                continue;
            }
            let distance = ((c[0] - a[0]) * d[1] - (c[1] - a[1]) * d[0]).abs();
            if distance > SNAP_DISTANCE {
                continue;
            }
            let s = (c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1];
            let overlap = (s + w / 2.0).min(len) - (s - w / 2.0).max(0.0);
            if overlap < w.min(len) * 0.6 {
                continue;
            }
            if best.as_ref().is_none_or(|(bd, _)| distance < *bd) {
                let sign = along.signum();
                best = Some((
                    distance,
                    Placed {
                        room: k,
                        centre: [a[0] + d[0] * s, a[1] + d[1] * s],
                        u: [d[0] * sign, d[1] * sign],
                    },
                ));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// The direction of `v` in degrees (0–360, clockwise on the plan), to the tenth.
pub(crate) fn degrees(v: P2) -> f64 {
    let a = v[1].atan2(v[0]).to_degrees();
    let a = if a < 0.0 { a + 360.0 } else { a };
    // Never −0.
    round1(a) % 360.0 + 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_l_shaped_room_beside_another_is_kept() {
        // A 3 × 3 m bedroom and a hall wrapping two of its sides: the corners' mean of the hall
        // falls in the bedroom, which is not drawn over it.
        let room = |id: &str, points: &[P2]| DraftRoom {
            id: id.to_owned(),
            name: id.to_owned(),
            points: points.to_vec(),
        };
        let draft = Draft {
            rooms: vec![
                room(
                    "bedroom",
                    &[[0.0, 0.0], [300.0, 0.0], [300.0, 300.0], [0.0, 300.0]],
                ),
                room(
                    "hall",
                    &[
                        [310.0, 0.0],
                        [420.0, 0.0],
                        [420.0, 420.0],
                        [0.0, 420.0],
                        [0.0, 310.0],
                        [310.0, 310.0],
                    ],
                ),
            ],
            ..Draft::default()
        };
        let (_, report, _) = build(draft).unwrap();
        assert_eq!((report.rooms, report.skipped_spaces), (2, 0));
    }

    #[test]
    fn a_piece_wider_than_a_plan_takes_is_left_out() {
        let draft = Draft {
            rooms: vec![DraftRoom {
                id: "room".to_owned(),
                name: String::new(),
                points: vec![[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]],
            }],
            pieces: vec![DraftPiece {
                id: "piece".to_owned(),
                name: String::new(),
                kind: "dresser",
                centre: [200.0, 150.0],
                size: [15_000.0, 100.0, 50.0],
                angle: 0.0,
                elevation: 0.0,
                card: None,
            }],
            ..Draft::default()
        };
        let (plan, report, _) = build(draft).unwrap();
        assert_eq!((report.furniture, report.skipped_furniture), (0, 1));
        domotwin_core::plan::read_plan_value(&plan).unwrap();
    }

    #[test]
    fn thicknesses_follow_their_sides_when_corners_go() {
        // A side split in two (a corner in the middle of it) carries 20 cm.
        let old = [
            [0.0, 0.0],
            [5.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
        ];
        let thickness = [Some(20.0), Some(20.0), None, None, None];
        let simple = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert_eq!(
            remap_thickness(&old, &thickness, &simple),
            [Some(20.0), None, None, None]
        );
        assert!(remap_thickness(&old, &[None; 5], &simple).is_empty());
    }

    #[test]
    fn frames_are_checked_like_the_plan_reader() {
        let square = [[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]];
        let outline = room_frame(&square, |p| p).unwrap();
        assert_eq!(outline[2], [400.0, 300.0]);
        let touching = [
            [0.0, 0.0],
            [400.0, 0.0],
            [400.0, 300.0],
            [200.0, 0.0],
            [0.0, 300.0],
        ];
        assert!(room_frame(&touching, |p| p).is_none());
        let far = [[60_000.0, 0.0], [60_400.0, 0.0], [60_400.0, 300.0]];
        assert!(room_frame(&far, |p| p).is_none());
    }
}
