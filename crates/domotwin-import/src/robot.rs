//! Robot vacuum maps (`DECISIONS.md`, D-064): what a robot draws as it cleans. Valetudo's map, as
//! its REST API gives it (JSON), as it publishes it over MQTT (deflated) or as Home Assistant's
//! camera receives it (in a PNG); and Roborock's own map (`rr`), as Valetudo RE serves it and the
//! Xiaomi Cloud Map Extractor stores it.
//!
//! A map is cells: floor, walls (what the robot's laser saw) and, on robots that have them, the
//! rooms (segments). Each segment is a room, kept by its id; its cells are closed over what the
//! robot went round, traced, simplified and squared to the map's walls. Two rooms touching
//! without a wall between them have a door there. The dock is a robot vacuum's dock, its back to
//! the nearest wall. A map has one storey, no windows and no furniture.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftPiece, DraftRoom, Report, degrees, round1};
use crate::convert::Storey;
use crate::grid::{self, Mask};
use crate::math::P2;

/// Most pixels read from a map.
const MAX_PIXELS: usize = 4_000_000;
/// Most cells of the grid a map is drawn on, and most rooms (Roborock's ids are 5 bits).
const MAX_CELLS: usize = 4_000_000;
const MAX_ROOMS: usize = 100;
/// Most cells drawn in all: the map's grid, and each room's own around it.
const MAX_WORK: u64 = 16_000_000;
/// Most cells two rooms both reach, in all: the bands along their borders.
const MAX_SHARED: usize = 1_000_000;
/// Farthest pixel coordinate read.
const FAR: i64 = 1_000_000;
/// Cells left around what a map holds.
const MARGIN: i64 = 8;
/// Gaps (cm) a room is closed over: the legs of the chairs and tables the robot went round.
const CLOSE: f64 = 15.0;
/// How far apart (cm) two rooms still touch.
const TOUCH: f64 = 10.0;
/// How far (cells) across a door its rooms are looked for, either way.
const ACROSS: u8 = 6;
/// The narrowest door (cm), and the widest before it is an opening.
const MIN_DOOR: f64 = 50.0;
const WIDEST_DOOR: f64 = 160.0;
/// The farthest wall (cm) a dock stands against.
const DOCK_WALL: f64 = 60.0;
/// A dock's depth (cm): the `robot-vacuum` piece is 40 × 50 × 12.
const DOCK: [f64; 3] = [40.0, 50.0, 12.0];

/// A room of the map: its id, its name and floor, its cells.
#[derive(Debug, Clone, PartialEq)]
struct Segment {
    id: String,
    name: String,
    floor: Option<(&'static str, f64)>,
    cells: Vec<(i64, i64)>,
}

/// A robot vacuum's map, read: its cells in its own grid (`cell` cm each, the cell `(x, y)`
/// covering `[x, x + 1] × [y, y + 1]` cells on the plan, `y` down).
#[derive(Debug, Clone, PartialEq)]
pub struct RobotMap {
    title: String,
    cell: f64,
    segments: Vec<Segment>,
    floor: Vec<(i64, i64)>,
    walls: Vec<(i64, i64)>,
    /// Where the robot docks, on the plan (cm).
    dock: Option<P2>,
    /// The grid the map is drawn on and the doors between its rooms, worked out once.
    layout: OnceCell<Result<Layout, &'static str>>,
}

/// The grid a map is drawn on (its first cell and its size) and the doors found on it.
type Layout = (((i64, i64), usize, usize), Vec<Doorway>);

/// A door found between two rooms (indices of `segments`), in cm on the plan.
#[derive(Debug, Clone, PartialEq)]
struct Doorway {
    rooms: (usize, usize),
    centre: P2,
    along: P2,
    width: f64,
    /// The side of room `rooms.0` (`+1` along the normal of `along`, `-1` against it).
    first_side: f64,
}

/// Whether a JSON object is a Valetudo map.
pub(crate) fn is_valetudo(object: &Map<String, Json>) -> bool {
    object.get("__class").and_then(Json::as_str) == Some("ValetudoMap")
        || (object.get("layers").is_some_and(Json::is_array)
            && object.get("pixelSize").is_some_and(Json::is_number))
}

/// Whether bytes are Roborock's map.
pub(crate) fn is_rrmap(bytes: &[u8]) -> bool {
    bytes.starts_with(b"rr") && u16_at(bytes, 2).is_some_and(|h| (20..=1024).contains(&h))
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    let b = bytes.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([b[0], b[1]]))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let b = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn i32_at(bytes: &[u8], at: usize) -> Option<i64> {
    u32_at(bytes, at).map(|v| i64::from(v.cast_signed()))
}

/// A whole number of a map's JSON, within reach.
fn coordinate(value: &Json) -> Option<i64> {
    let v = value.as_f64()?.round();
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    (v.abs() <= FAR as f64).then_some(v as i64)
}

/// The floor Valetudo says a room has, as the plan's.
fn material(name: &str) -> Option<(&'static str, f64)> {
    match name {
        "tile" => Some(("beige-tiles", 0.0)),
        "wood" | "wood_horizontal" => Some(("oak", 0.0)),
        "wood_vertical" => Some(("oak", 90.0)),
        _ => None,
    }
}

/// The pixels of a Valetudo layer: run-length triples (`compressedPixels`), else pairs.
fn layer_pixels(layer: &Json, budget: &mut usize) -> Result<Vec<(i64, i64)>, &'static str> {
    let numbers = |key: &str| layer[key].as_array().filter(|a| !a.is_empty());
    let mut out = Vec::new();
    if let Some(runs) = numbers("compressedPixels") {
        for run in runs.chunks_exact(3) {
            let (Some(x), Some(y), Some(count)) = (
                coordinate(&run[0]),
                coordinate(&run[1]),
                coordinate(&run[2]),
            ) else {
                continue;
            };
            let count = usize::try_from(count).unwrap_or(0);
            *budget = budget.checked_sub(count).ok_or("too_large")?;
            out.extend((0..count as i64).map(|k| (x + k, y)));
        }
    } else if let Some(pairs) = numbers("pixels") {
        *budget = budget.checked_sub(pairs.len() / 2).ok_or("too_large")?;
        out.extend(
            pairs
                .chunks_exact(2)
                .filter_map(|p| Some((coordinate(&p[0])?, coordinate(&p[1])?))),
        );
    }
    Ok(out)
}

impl RobotMap {
    /// Reads a Valetudo map (`ValetudoMap`, version 2).
    ///
    /// # Errors
    ///
    /// `not_plan` for a map without a pixel size (of 1 to 100 cm), `too_large` past 4 million
    /// pixels.
    pub fn from_valetudo(root: &Json, title: &str) -> Result<Self, &'static str> {
        let cell = root["pixelSize"]
            .as_f64()
            .filter(|s| (1.0..=100.0).contains(s))
            .ok_or("not_plan")?;
        let mut map = RobotMap {
            title: title.chars().take(100).collect(),
            cell,
            segments: Vec::new(),
            floor: Vec::new(),
            walls: Vec::new(),
            dock: None,
            layout: OnceCell::new(),
        };
        let mut budget = MAX_PIXELS;
        for layer in root["layers"].as_array().into_iter().flatten() {
            let pixels = layer_pixels(layer, &mut budget)?;
            let meta = &layer["metaData"];
            match layer["type"].as_str() {
                Some("segment") => {
                    let id = match &meta["segmentId"] {
                        Json::String(s) => s.chars().take(40).collect(),
                        Json::Number(n) => n.to_string(),
                        _ => format!("{}", map.segments.len() + 1),
                    };
                    map.segments.push(Segment {
                        id,
                        name: meta["name"]
                            .as_str()
                            .unwrap_or_default()
                            .trim()
                            .chars()
                            .take(60)
                            .collect(),
                        floor: meta["material"].as_str().and_then(material),
                        cells: pixels,
                    });
                }
                Some("floor") => map.floor.extend(pixels),
                Some("wall") => map.walls.extend(pixels),
                _ => {}
            }
        }
        for entity in root["entities"].as_array().into_iter().flatten() {
            if entity["type"].as_str() != Some("charger_location") {
                continue;
            }
            let point = entity["points"].as_array().and_then(|p| {
                Some([
                    p.first()?.as_f64().filter(|v| v.abs() < 1e7)?,
                    p.get(1)?.as_f64().filter(|v| v.abs() < 1e7)?,
                ])
            });
            if point.is_some() {
                map.dock = point;
                break;
            }
        }
        map.segments.retain(|s| !s.cells.is_empty());
        if map.segments.len() > MAX_ROOMS {
            return Err("too_large");
        }
        Ok(map)
    }

    /// Reads Roborock's map (`rr`): its image block (5 cm a pixel, `y` up) and its dock.
    ///
    /// # Errors
    ///
    /// `not_plan` for a map without an image, `too_large` past 4 million pixels.
    pub fn from_rrmap(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        if !is_rrmap(bytes) {
            return Err("not_plan");
        }
        let mut map = RobotMap {
            title: title.chars().take(100).collect(),
            cell: 5.0,
            segments: Vec::new(),
            floor: Vec::new(),
            walls: Vec::new(),
            dock: None,
            layout: OnceCell::new(),
        };
        let mut at = usize::from(u16_at(bytes, 2).ok_or("not_plan")?);
        let mut image = false;
        let mut rooms: BTreeMap<u8, Vec<(i64, i64)>> = BTreeMap::new();
        for _ in 0..10_000 {
            let (Some(kind), Some(head), Some(length)) = (
                u16_at(bytes, at),
                u16_at(bytes, at + 2),
                u32_at(bytes, at + 4),
            ) else {
                break;
            };
            let (head, length) = (usize::from(head), length as usize);
            match kind {
                // The dock: millimetres, `y` up.
                1 => {
                    if let (Some(x), Some(y)) = (u16_at(bytes, at + 8), u16_at(bytes, at + 12)) {
                        map.dock = Some([f64::from(x) / 10.0, -f64::from(y) / 10.0]);
                    }
                }
                2 if !image => {
                    image = true;
                    // Robots with rooms give their count first.
                    let g = if head > 24 { 4 } else { 0 };
                    let with_rooms = g > 0 && i32_at(bytes, at + 8).is_some_and(|n| n > 0);
                    let (Some(top), Some(left), Some(height), Some(width)) = (
                        i32_at(bytes, at + 8 + g),
                        i32_at(bytes, at + 12 + g),
                        i32_at(bytes, at + 16 + g),
                        i32_at(bytes, at + 20 + g),
                    ) else {
                        break;
                    };
                    if !(1..=4096).contains(&width)
                        || !(1..=4096).contains(&height)
                        || top.abs() > FAR
                        || left.abs() > FAR
                    {
                        return Err("not_plan");
                    }
                    let (w, h) = (width as usize, height as usize);
                    let pixels = at
                        .checked_add(head)
                        .and_then(|start| bytes.get(start..start.checked_add(w * h)?))
                        .ok_or("not_plan")?;
                    if w * h > MAX_PIXELS {
                        return Err("too_large");
                    }
                    for (i, &b) in pixels.iter().enumerate() {
                        let (col, row) = ((i % w) as i64, (i / w) as i64);
                        // Rows go up the plan: mirrored back, not turned.
                        let at = (left + col, -(top + row) - 1);
                        // As the Xiaomi Cloud Map Extractor reads them: outside, a wall,
                        // inside (in no room), what was scanned; then by the lower three bits,
                        // walls (grey or not) and rooms (`7`, the id above), else floor.
                        match (b, b & 7) {
                            (0, _) => {}
                            (0xFF | 0x07, _) => map.floor.push(at),
                            (_, 0 | 1) => map.walls.push(at),
                            (_, 7) if with_rooms => rooms.entry(b >> 3).or_default().push(at),
                            _ => map.floor.push(at),
                        }
                    }
                }
                _ => {}
            }
            let Some(next) = at.checked_add(head).and_then(|a| a.checked_add(length)) else {
                break;
            };
            if next <= at {
                break;
            }
            at = next;
        }
        if !image {
            return Err("not_plan");
        }
        map.segments = rooms
            .into_iter()
            .map(|(id, cells)| Segment {
                id: id.to_string(),
                name: String::new(),
                floor: None,
                cells,
            })
            .collect();
        Ok(map)
    }

    /// The grid the map is drawn on: its first cell and its size; `too_large` when it, with the
    /// grids of the rooms, is past the budget.
    fn frame(&self) -> Result<((i64, i64), usize, usize), &'static str> {
        let all = self
            .segments
            .iter()
            .flat_map(|s| &s.cells)
            .chain(&self.floor)
            .chain(&self.walls);
        let (mut lo, mut hi) = ((i64::MAX, i64::MAX), (i64::MIN, i64::MIN));
        for &(x, y) in all {
            lo = (lo.0.min(x), lo.1.min(y));
            hi = (hi.0.max(x), hi.1.max(y));
        }
        if lo.0 > hi.0 {
            return Err("no_spaces");
        }
        let w = usize::try_from(hi.0 - lo.0 + 1 + 2 * MARGIN).map_err(|_| "too_large")?;
        let h = usize::try_from(hi.1 - lo.1 + 1 + 2 * MARGIN).map_err(|_| "too_large")?;
        if w.checked_mul(h).is_none_or(|n| n > MAX_CELLS) {
            return Err("too_large");
        }
        // Each room is drawn again on a grid of its own, as far around it as it is closed and
        // reaches (`room_outline`, `reach_cells`).
        #[allow(clippy::cast_possible_truncation)]
        let margin = (CLOSE.max(TOUCH) / self.cell).ceil() as i64 + 3;
        let rooms: Vec<&[(i64, i64)]> = if self.segments.is_empty() {
            vec![&self.floor]
        } else {
            self.segments.iter().map(|s| s.cells.as_slice()).collect()
        };
        let mut work = u64::try_from(w * h).unwrap_or(u64::MAX);
        for cells in rooms {
            work = work.saturating_add(box_area(cells, margin));
            if work > MAX_WORK {
                return Err("too_large");
            }
        }
        Ok(((lo.0 - MARGIN, lo.1 - MARGIN), w, h))
    }

    /// The rooms: each segment, else the floor's largest part.
    fn rooms(&self) -> Cow<'_, [Segment]> {
        if !self.segments.is_empty() {
            return Cow::Borrowed(&self.segments);
        }
        if self.floor.is_empty() {
            return Cow::Owned(Vec::new());
        }
        Cow::Owned(vec![Segment {
            id: "room-1".to_owned(),
            name: String::new(),
            floor: None,
            cells: self.floor.clone(),
        }])
    }

    /// The storey of the map.
    pub fn storeys(&self) -> Vec<Storey> {
        let doors = self.layout().map_or(0, |(_, found)| found.len());
        vec![Storey {
            id: 0,
            name: String::new(),
            elevation: 0.0,
            spaces: self.rooms().len(),
            doors,
            windows: 0,
            furniture: usize::from(self.dock.is_some()),
        }]
    }

    /// The grid and the doors, worked out the first time they are asked for.
    fn layout(&self) -> Result<&Layout, &'static str> {
        self.layout
            .get_or_init(|| {
                let frame = self.frame()?;
                Ok((frame, self.doorways(&self.rooms(), frame)?))
            })
            .as_ref()
            .map_err(|code| *code)
    }

    /// The doors between rooms: where they touch with no wall between them; `too_large` when
    /// they share more than bands along their borders (rooms drawn over one another).
    fn doorways(
        &self,
        rooms: &[Segment],
        frame: ((i64, i64), usize, usize),
    ) -> Result<Vec<Doorway>, &'static str> {
        let ((x0, y0), w, h) = frame;
        let index = |(x, y): (i64, i64)| -> Option<usize> {
            let (x, y) = (usize::try_from(x - x0).ok()?, usize::try_from(y - y0).ok()?);
            (x < w && y < h).then(|| y * w + x)
        };
        let mut walls = Mask::new(w, h);
        for &(x, y) in &self.walls {
            walls.set(x - x0, y - y0);
        }
        let near_wall = walls.dilate(1.0);
        let reach = TOUCH / self.cell;
        // The first two rooms reaching each cell, and the cells two rooms reach (each pair of
        // the three where three meet).
        let mut reached = vec![[0_u32; 2]; w * h];
        let mut between: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
        let mut owner = vec![0_u32; w * h];
        let mut shared = 0_usize;
        for (k, room) in rooms.iter().enumerate() {
            let label = u32::try_from(k + 1).unwrap_or(u32::MAX);
            for &c in &room.cells {
                if let Some(i) = index(c) {
                    owner[i] = label;
                }
            }
            for i in reach_cells(&room.cells, frame, reach) {
                if near_wall.cells[i] {
                    continue;
                }
                let [one, two] = reached[i];
                for other in [one, two] {
                    if other == 0 || other == label {
                        continue;
                    }
                    shared += 1;
                    if shared > MAX_SHARED {
                        return Err("too_large");
                    }
                    between.entry((other as usize - 1, k)).or_default().push(i);
                }
                if one == 0 {
                    reached[i][0] = label;
                } else if two == 0 {
                    reached[i][1] = label;
                }
            }
        }
        let mut found = Vec::new();
        for ((a, b), cells) in between {
            for part in cell_parts(&cells, w) {
                let Some(door) = doorway(&part, w, &owner, (a, b), frame, self.cell) else {
                    continue;
                };
                found.push(door);
            }
        }
        Ok(found)
    }

    /// The plan of the map, what was left out, and no upkeep card.
    ///
    /// # Errors
    ///
    /// `no_storeys` for a storey other than 0, `no_spaces` when the map has no room.
    pub fn convert(&self, storey: u32) -> Result<(Json, Report, Map<String, Json>), &'static str> {
        if storey != 0 {
            return Err("no_storeys");
        }
        let (frame, doorways) = self.layout()?;
        let frame = *frame;
        let ((x0, y0), _, _) = frame;
        let rooms = self.rooms();
        let cm = |p: P2| [p[0] * self.cell, p[1] * self.cell];
        // Each room's outline from its largest part, closed and simplified, in cm.
        let mut outlines: Vec<(usize, Vec<P2>)> = Vec::new();
        for (k, room) in rooms.iter().enumerate() {
            let Some(points) = room_outline(&room.cells, frame, CLOSE / self.cell) else {
                continue;
            };
            let points: Vec<P2> = points
                .iter()
                .map(|p| cm([p[0] + x0 as f64, p[1] + y0 as f64]))
                .collect();
            outlines.push((k, grid::simplify(&points, 1.2 * self.cell)));
        }
        let angle =
            build::dominant_angle(outlines.iter().map(|(_, p)| p.as_slice())).unwrap_or(0.0);
        let level = |p: P2| grid::turn(&[p], -angle)[0];
        let mut draft = Draft {
            name: self.title.clone(),
            ..Draft::default()
        };
        // The doors first: a room reaching into a doorway is squared to its wall beside it.
        let spans: Vec<(P2, P2)> = doorways
            .iter()
            .map(|d| {
                let (c, u) = (level(d.centre), snap(level(d.along)));
                let half = d.width / 2.0;
                (
                    [c[0] - u[0] * half, c[1] - u[1] * half],
                    [c[0] + u[0] * half, c[1] + u[1] * half],
                )
            })
            .collect();
        let mut squared: Vec<Vec<P2>> = outlines
            .iter()
            .map(|(_, points)| grid::square(&grid::turn(points, -angle), 12.0, &spans))
            .collect();
        grid::snap_lines(&mut squared, 3.5);
        for ((k, _), points) in outlines.into_iter().zip(squared) {
            let room = &rooms[k];
            draft.rooms.push(DraftRoom {
                id: if self.segments.is_empty() {
                    room.id.clone()
                } else {
                    format!("segment-{}", room.id)
                },
                name: room.name.clone(),
                points,
                floor: room.floor,
            });
        }
        // Doors: each opens into the room with fewer doors (a bedroom off the hall), else into
        // the smaller one.
        let mut doors_of = vec![0_usize; rooms.len()];
        for d in doorways {
            doors_of[d.rooms.0] += 1;
            doors_of[d.rooms.1] += 1;
        }
        let size = |k: usize| rooms[k].cells.len();
        for (n, d) in doorways.iter().enumerate() {
            let (a, b) = d.rooms;
            let into_first = (doors_of[a], size(a)) < (doors_of[b], size(b));
            let side = if into_first {
                d.first_side
            } else {
                -d.first_side
            };
            let opens = [-d.along[1] * side, d.along[0] * side];
            draft.openings.push(DraftOpening {
                id: format!("door-{}", n + 1),
                name: String::new(),
                door: true,
                centre: level(d.centre),
                along: snap(level(d.along)),
                opens: level(opens),
                width: d.width,
                right: false,
                style: (d.width > WIDEST_DOOR).then_some("opening"),
            });
        }
        if let Some(dock) = self.dock {
            draft.pieces.push(self.dock_piece(dock, angle));
        }
        build::build(draft)
    }

    /// The dock, its back to the nearest wall (turned with the map by `angle`).
    fn dock_piece(&self, dock: P2, angle: f64) -> DraftPiece {
        let reach = DOCK_WALL / self.cell;
        let at = [dock[0] / self.cell, dock[1] / self.cell];
        let near = self
            .walls
            .iter()
            .map(|&(x, y)| {
                #[allow(clippy::cast_precision_loss)]
                let c = [x as f64 + 0.5, y as f64 + 0.5];
                (c, (c[0] - at[0]).hypot(c[1] - at[1]))
            })
            .filter(|(_, d)| *d > 0.25 && *d <= reach)
            .min_by(|a, b| a.1.total_cmp(&b.1));
        let turned = grid::turn(&[dock], -angle)[0];
        let (centre, rotation) = match near {
            Some((wall, _)) => {
                let wall = grid::turn(&[[wall[0] * self.cell, wall[1] * self.cell]], -angle)[0];
                let front = snap_axis([turned[0] - wall[0], turned[1] - wall[1]]);
                let back = self.cell / 2.0 + DOCK[1] / 2.0;
                // Along the wall, where the robot docks; across, against the wall.
                let along_wall = [-front[1], front[0]];
                let offset =
                    (turned[0] - wall[0]) * along_wall[0] + (turned[1] - wall[1]) * along_wall[1];
                (
                    [
                        wall[0] + front[0] * back + along_wall[0] * offset,
                        wall[1] + front[1] * back + along_wall[1] * offset,
                    ],
                    (degrees(front) + 270.0) % 360.0,
                )
            }
            None => (turned, 0.0),
        };
        DraftPiece {
            id: "dock".to_owned(),
            name: String::new(),
            kind: "robot-vacuum",
            centre,
            size: DOCK,
            angle: round1(rotation),
            elevation: 0.0,
            card: None,
        }
    }
}

/// The cells of the grid within `reach` cells of some of `cells` (those included).
fn reach_cells(cells: &[(i64, i64)], frame: ((i64, i64), usize, usize), reach: f64) -> Vec<usize> {
    let ((x0, y0), w, h) = frame;
    let Some(sub) = sub_mask(cells, reach.ceil() as i64 + 2) else {
        return Vec::new();
    };
    let (mask, (sx, sy)) = sub;
    let grown = mask.dilate(reach);
    let mut out = Vec::new();
    for (i, set) in grown.cells.iter().enumerate() {
        if !set {
            continue;
        }
        let (gx, gy) = (
            sx + (i % grown.w) as i64 - x0,
            sy + (i / grown.w) as i64 - y0,
        );
        if let (Ok(x), Ok(y)) = (usize::try_from(gx), usize::try_from(gy))
            && x < w
            && y < h
        {
            out.push(y * w + x);
        }
    }
    out
}

/// The cells of the box around `cells`, `margin` cells around them.
fn box_area(cells: &[(i64, i64)], margin: i64) -> u64 {
    let (mut lo, mut hi) = ((i64::MAX, i64::MAX), (i64::MIN, i64::MIN));
    for &(x, y) in cells {
        lo = (lo.0.min(x), lo.1.min(y));
        hi = (hi.0.max(x), hi.1.max(y));
    }
    if lo.0 > hi.0 {
        return 0;
    }
    let side = |a: i64, b: i64| (b - a + 1 + 2 * margin).unsigned_abs();
    side(lo.0, hi.0).saturating_mul(side(lo.1, hi.1))
}

/// The cells as a mask of their own, `margin` cells around them: the mask and the map
/// coordinates of its first cell.
fn sub_mask(cells: &[(i64, i64)], margin: i64) -> Option<(Mask, (i64, i64))> {
    let (mut lo, mut hi) = ((i64::MAX, i64::MAX), (i64::MIN, i64::MIN));
    for &(x, y) in cells {
        lo = (lo.0.min(x), lo.1.min(y));
        hi = (hi.0.max(x), hi.1.max(y));
    }
    if lo.0 > hi.0 {
        return None;
    }
    let (sx, sy) = (lo.0 - margin, lo.1 - margin);
    let w = usize::try_from(hi.0 - lo.0 + 1 + 2 * margin).ok()?;
    let h = usize::try_from(hi.1 - lo.1 + 1 + 2 * margin).ok()?;
    if w.checked_mul(h)? > MAX_CELLS {
        return None;
    }
    let mut mask = Mask::new(w, h);
    for &(x, y) in cells {
        mask.set(x - sx, y - sy);
    }
    Some((mask, (sx, sy)))
}

/// A room's outline (in map cells) from its largest part: closed over gaps of `close` cells,
/// its holes filled.
fn room_outline(
    cells: &[(i64, i64)],
    frame: ((i64, i64), usize, usize),
    close: f64,
) -> Option<Vec<P2>> {
    let ((x0, y0), _, _) = frame;
    let (mask, (sx, sy)) = sub_mask(cells, close.ceil() as i64 + 3)?;
    let (_, found) = grid::parts(&mask);
    let largest = found.iter().max_by_key(|p| p.len())?;
    let mut main = Mask::new(mask.w, mask.h);
    for &i in largest {
        main.cells[i] = true;
    }
    let shape = main.close(close).fill_holes();
    let outline = grid::outline(&shape);
    (outline.len() >= 4).then(|| {
        outline
            .into_iter()
            .map(|p| [p[0] + (sx - x0) as f64, p[1] + (sy - y0) as f64])
            .collect()
    })
}

/// The parts of a set of cells of a grid `w` wide (joined by a side).
fn cell_parts(cells: &[usize], w: usize) -> Vec<Vec<usize>> {
    let set: HashSet<usize> = cells.iter().copied().collect();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut parts = Vec::new();
    let mut sorted = cells.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    for &start in &sorted {
        if !seen.insert(start) {
            continue;
        }
        let mut part = vec![start];
        let mut k = 0;
        while k < part.len() {
            let i = part[k];
            k += 1;
            // Its neighbours in its row and column, not past the row's ends.
            let next = [
                (i % w + 1 < w).then(|| i + 1),
                (i % w > 0).then(|| i - 1),
                Some(i + w),
                i.checked_sub(w),
            ];
            for j in next.into_iter().flatten() {
                if set.contains(&j) && seen.insert(j) {
                    part.push(j);
                }
            }
        }
        parts.push(part);
    }
    parts
}

/// The door the cells two rooms reach make, in cm on the plan: along their longest axis, as wide
/// as they reach; `None` when narrower than a door.
fn doorway(
    part: &[usize],
    w: usize,
    owner: &[u32],
    rooms: (usize, usize),
    frame: ((i64, i64), usize, usize),
    cell: f64,
) -> Option<Doorway> {
    let ((x0, y0), _, h) = frame;
    #[allow(clippy::cast_precision_loss)]
    let n = part.len() as f64;
    if part.len() < 3 {
        return None;
    }
    #[allow(clippy::cast_precision_loss)]
    let points: Vec<P2> = part
        .iter()
        .map(|&i| [(i % w) as f64 + 0.5, (i / w) as f64 + 0.5])
        .collect();
    let mean = points
        .iter()
        .fold([0.0, 0.0], |m, p| [m[0] + p[0] / n, m[1] + p[1] / n]);
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for p in &points {
        let (dx, dy) = (p[0] - mean[0], p[1] - mean[1]);
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    let axis = 0.5 * (2.0 * xy).atan2(xx - yy);
    let along = [axis.cos(), axis.sin()];
    let normal = [-along[1], along[0]];
    let (lo, hi) = points
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            let t = (p[0] - mean[0]) * along[0] + (p[1] - mean[1]) * along[1];
            (lo.min(t), hi.max(t))
        });
    let width = (hi - lo + 1.0) * cell;
    if width < MIN_DOOR {
        return None;
    }
    // Which side of the door the first room is: its cells across the door's, either way.
    let first = u32::try_from(rooms.0 + 1).unwrap_or(u32::MAX);
    let second = u32::try_from(rooms.1 + 1).unwrap_or(u32::MAX);
    let mut side = 0.0;
    for p in &points {
        for step in 1..=ACROSS {
            for d in [-f64::from(step), f64::from(step)] {
                let (x, y) = (
                    (p[0] + normal[0] * d).floor(),
                    (p[1] + normal[1] * d).floor(),
                );
                if x < 0.0 || y < 0.0 {
                    continue;
                }
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let (x, y) = (x as usize, y as usize);
                if x >= w || y >= h {
                    continue;
                }
                let o = owner[y * w + x];
                if o == first {
                    side += d;
                } else if o == second {
                    side -= d;
                }
            }
        }
    }
    #[allow(clippy::cast_precision_loss)]
    Some(Doorway {
        rooms,
        centre: [(mean[0] + x0 as f64) * cell, (mean[1] + y0 as f64) * cell],
        along,
        width,
        first_side: if side < 0.0 { -1.0 } else { 1.0 },
    })
}

/// A direction put on the nearest axis when within 20° of it.
fn snap(v: P2) -> P2 {
    let len = v[0].hypot(v[1]);
    if len < 1e-12 {
        return [1.0, 0.0];
    }
    let u = [v[0] / len, v[1] / len];
    let slope = 20_f64.to_radians().sin();
    if u[1].abs() <= slope {
        [u[0].signum(), 0.0]
    } else if u[0].abs() <= slope {
        [0.0, u[1].signum()]
    } else {
        u
    }
}

/// A direction put on the nearest axis.
fn snap_axis(v: P2) -> P2 {
    if v[0].abs() >= v[1].abs() {
        [if v[0] < 0.0 { -1.0 } else { 1.0 }, 0.0]
    } else {
        [0.0, if v[1] < 0.0 { -1.0 } else { 1.0 }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::signed_area2;
    use serde_json::json;

    /// A fictional flat on a 5 cm map: a living room (0–4 m × 0–3 m), a bedroom beside it beyond
    /// a 10 cm wall, a 90 cm doorway between them; the dock against the living room's left wall.
    fn flat() -> Json {
        let mut living = Vec::new();
        let mut bedroom = Vec::new();
        let mut walls = Vec::new();
        for y in 0..60 {
            for x in 0..80 {
                living.extend([x, y]);
            }
            for x in 82..140 {
                bedroom.extend([x, y]);
            }
            // The wall between them, open from 1.2 m to 2.1 m: the robot went through.
            if !(24..42).contains(&y) {
                walls.extend([80, y, 81, y]);
            } else {
                living.extend([80, y]);
                bedroom.extend([81, y]);
            }
        }
        for x in -1..141 {
            walls.extend([x, -1, x, 60]);
        }
        for y in 0..60 {
            walls.extend([-1, y, 140, y]);
        }
        let runs = |pixels: &[i64]| -> Vec<i64> {
            pixels.chunks(2).flat_map(|p| [p[0], p[1], 1]).collect()
        };
        json!({
            "__class": "ValetudoMap",
            "metaData": { "version": 2 },
            "size": { "x": 5120, "y": 5120 },
            "pixelSize": 5,
            "layers": [
                { "__class": "MapLayer", "type": "segment", "pixels": [], "compressedPixels": runs(&living),
                  "metaData": { "segmentId": "16", "name": "Living room", "material": "wood_vertical" } },
                { "__class": "MapLayer", "type": "segment", "pixels": bedroom,
                  "metaData": { "segmentId": 17, "name": "Bedroom" } },
                { "__class": "MapLayer", "type": "wall", "pixels": walls, "metaData": {} },
            ],
            "entities": [
                { "__class": "PointMapEntity", "type": "charger_location", "points": [15, 150], "metaData": {} },
            ],
        })
    }

    #[test]
    fn a_valetudo_map() {
        let map = RobotMap::from_valetudo(&flat(), "Robot").unwrap();
        let storeys = map.storeys();
        assert_eq!((storeys[0].spaces, storeys[0].doors), (2, 1));
        let (plan, report, _) = map.convert(0).unwrap();
        domotwin_core::plan::read_plan_value(&plan).unwrap();
        assert_eq!(
            (report.rooms, report.doors, report.furniture),
            (2, 1, 1),
            "{plan:#}"
        );
        assert_eq!(plan["rooms"][0]["id"], "segment-16");
        assert_eq!(plan["rooms"][0]["name"], "Living room");
        assert_eq!(plan["rooms"][0]["floor"]["material"], "oak");
        assert_eq!(plan["rooms"][0]["floor"]["angle"], 90.0);
        assert_eq!(plan["rooms"][1]["id"], "segment-17");
        // Square rooms, 4 m × 3 m and 2.9 m × 3 m, once their gap is closed.
        let outline: Vec<P2> = serde_json::from_value(plan["rooms"][0]["outline"].clone()).unwrap();
        assert_eq!(outline.len(), 4, "{outline:?}");
        let area = signed_area2(&outline).abs() / 2.0;
        assert!((area - 405.0 * 300.0).abs() < 3000.0, "{area}");
        // The doorway, 90 cm wide, in the wall between them.
        let door = &plan["doors"][0];
        let from: P2 = serde_json::from_value(door["from"].clone()).unwrap();
        let to: P2 = serde_json::from_value(door["to"].clone()).unwrap();
        let width = (to[0] - from[0]).hypot(to[1] - from[1]);
        assert!((width - 90.0).abs() < 12.0, "{door}");
        assert!((from[0] - to[0]).abs() < 0.5, "{door}");
        // The dock, its back to the left wall, facing into the room.
        let dock = &plan["items"][0];
        assert_eq!(dock["kind"], "robot-vacuum");
        assert_eq!(dock["rotation"], 270.0);
        let at: P2 = serde_json::from_value(dock["at"].clone()).unwrap();
        assert!(
            (at[0] - 25.0).abs() < 3.0 && (at[1] - 150.0).abs() < 3.0,
            "{dock}"
        );
    }

    #[test]
    fn numbers_out_of_reach_are_left_out() {
        assert_eq!(coordinate(&json!(-1e300)), None);
        assert_eq!(coordinate(&json!(1e300)), None);
        assert_eq!(coordinate(&json!(12.4)), Some(12));
        let map = json!({ "pixelSize": 5, "layers": [
            { "type": "segment", "compressedPixels": [-1e300, 0, 5, 0, 0, -1e300], "metaData": {} }] });
        assert!(RobotMap::from_valetudo(&map, "x").is_ok());
        // A pixel of no size, or of a metre's.
        for size in [1e-300, 0.0, 101.0] {
            let map = json!({ "pixelSize": size, "layers": [
                { "type": "segment", "pixels": [0, 0, 1, 0, 0, 1, 1, 1], "metaData": {} }] });
            assert_eq!(RobotMap::from_valetudo(&map, "x").err(), Some("not_plan"));
        }
    }

    #[test]
    fn three_rooms_meeting_each_have_their_doors() {
        // A hall across the top, two rooms under it, open to each other and to the hall.
        let rect = |x: std::ops::Range<i64>, y: std::ops::Range<i64>| -> Vec<i64> {
            y.flat_map(|y| x.clone().flat_map(move |x| [x, y]))
                .collect()
        };
        let segment = |id: &str, pixels: Vec<i64>| json!({ "type": "segment", "pixels": pixels, "metaData": { "segmentId": id } });
        let map = json!({ "pixelSize": 5, "layers": [
            segment("1", rect(0..40, 0..20)),
            segment("2", rect(0..20, 20..40)),
            segment("3", rect(20..40, 20..40)),
        ] });
        let map = RobotMap::from_valetudo(&map, "x").unwrap();
        let frame = map.frame().unwrap();
        let doors = map.doorways(&map.rooms(), frame).unwrap();
        let widths: Vec<((usize, usize), f64)> = doors.iter().map(|d| (d.rooms, d.width)).collect();
        // The two rooms' door runs their whole side, from the hall's.
        let side = widths.iter().find(|(rooms, _)| *rooms == (1, 2)).unwrap().1;
        assert!(side >= 100.0, "{widths:?}");
        assert!(
            widths.iter().any(|(rooms, _)| *rooms == (0, 1)),
            "{widths:?}"
        );
        assert!(
            widths.iter().any(|(rooms, _)| *rooms == (0, 2)),
            "{widths:?}"
        );
    }

    #[test]
    fn a_map_without_rooms_is_one() {
        let mut floor = Vec::new();
        for y in 0..40 {
            for x in 0..50 {
                floor.extend([x, y]);
            }
        }
        let map = json!({ "pixelSize": 5, "layers": [{ "type": "floor", "pixels": floor }], "entities": [] });
        let map = RobotMap::from_valetudo(&map, "Robot").unwrap();
        let (plan, report, _) = map.convert(0).unwrap();
        assert_eq!((report.rooms, report.doors, report.furniture), (1, 0, 0));
        assert_eq!(plan["rooms"][0]["id"], "room-1");
        assert_eq!(map.convert(1).err(), Some("no_storeys"));
        let empty = RobotMap::from_valetudo(&json!({ "pixelSize": 5, "layers": [] }), "x").unwrap();
        assert_eq!(empty.convert(0).err(), Some("no_spaces"));
        assert_eq!(
            RobotMap::from_valetudo(&json!({ "layers": [] }), "x").err(),
            Some("not_plan")
        );
    }

    #[test]
    fn a_roborock_map() {
        // A 40 × 30 pixel image of one room (id 16) inside walls, its dock at 1 m, 50 cm.
        let (w, h) = (40_u32, 30_u32);
        let mut pixels = vec![0_u8; (w * h) as usize];
        for row in 0..h {
            for col in 0..w {
                let edge = row == 0 || col == 0 || row == h - 1 || col == w - 1;
                pixels[(row * w + col) as usize] = if edge { 1 } else { (16 << 3) | 7 };
            }
        }
        let rr = |pixels: &[u8]| {
            let mut map = b"rr".to_vec();
            map.extend_from_slice(&20_u16.to_le_bytes());
            map.extend_from_slice(&[0; 16]);
            // The dock.
            map.extend_from_slice(&1_u16.to_le_bytes());
            map.extend_from_slice(&8_u16.to_le_bytes());
            map.extend_from_slice(&8_u32.to_le_bytes());
            map.extend_from_slice(&(100 * 10 + 20 * 50_u32).to_le_bytes()[..2]);
            map.extend_from_slice(&[0; 2]);
            map.extend_from_slice(&(10 * 50 + 25 + 5 * 50_u32).to_le_bytes()[..2]);
            map.extend_from_slice(&[0; 2]);
            // The image, with its rooms' count.
            map.extend_from_slice(&2_u16.to_le_bytes());
            map.extend_from_slice(&28_u16.to_le_bytes());
            map.extend_from_slice(&(w * h).to_le_bytes());
            for v in [1_u32, 10, 20, h, w] {
                map.extend_from_slice(&v.to_le_bytes());
            }
            map.extend_from_slice(pixels);
            map
        };
        let read = RobotMap::from_rrmap(&rr(&pixels), "Roborock").unwrap();
        let (plan, report, _) = read.convert(0).unwrap();
        assert_eq!((report.rooms, report.furniture), (1, 1), "{plan:#}");
        assert_eq!(plan["rooms"][0]["id"], "segment-16");
        let outline: Vec<P2> = serde_json::from_value(plan["rooms"][0]["outline"].clone()).unwrap();
        let area = signed_area2(&outline).abs() / 2.0;
        assert!((area - 190.0 * 140.0).abs() < 1500.0, "{area} {outline:?}");
        // Inside in no room, scanned, a grey wall, something else: no room but room 16.
        for (k, b) in [0xFF_u8, 0x07, 0x08, 0x0A].into_iter().enumerate() {
            pixels[w as usize + 1 + k] = b;
        }
        let read = RobotMap::from_rrmap(&rr(&pixels), "Roborock").unwrap();
        let ids: Vec<&str> = read.segments.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["16"]);
        assert_eq!(
            (read.floor.len(), read.walls.len()),
            (3, 2 * (w + h) as usize - 4 + 1)
        );
        assert_eq!(
            RobotMap::from_rrmap(b"rr\x14\x00", "x").err(),
            Some("not_plan")
        );
        assert!(!is_rrmap(b"rr\x00\x00"));
    }
}
