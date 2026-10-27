//! Room scans: what Apple's RoomPlan captures with a phone's LiDAR (`DECISIONS.md`, D-040), as the
//! USDZ it exports or its JSON (`CapturedRoom`, `CapturedStructure`).
//!
//! A scan is in metres, `y` up, its origin where the scan started. Walls, doors, windows and
//! openings are planes (a transform and a width and height; walls have no thickness: they are the
//! faces seen from inside), floors polygons, objects boxes with a category. The USDZ holds one
//! text layer per element (`.usda`), its category in `customData`; the root layer only groups
//! them. Each story is a storey. Rooms are the floors' outlines, else the faces the walls make;
//! their names come from the scan's sections (living room, bedroom…). A scan follows where the
//! phone pointed: the plan is turned so that its walls run along the axes.

use std::collections::{BTreeMap, BTreeSet};

use domotwin_models::zip::Archive;
use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftPiece, DraftRoom, Report, degrees};
use crate::convert::Storey;
use crate::faces;
use crate::math::{P2, point_in_polygon};
use crate::usda::{self, Layer, Prim, Value};

/// Most elements read.
const MAX_ELEMENTS: usize = 5_000;
/// Wall ends nearer than this (cm) to where another wall's line crosses theirs meet there.
const CORNER_GAP: f64 = 50.0;

/// What an element of a scan is.
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Wall,
    Door,
    Window,
    Opening,
    Floor,
    /// An object, by its category (lower case, `washerdryer`), with its attributes.
    Object(String, BTreeMap<String, String>),
}

/// An element: its kind, its pose (USD's row-vector matrix, rows `x`, `y`, `z` axes and the
/// translation; the JSON's column-major `simd_float4x4` is the same 16 numbers), its size along
/// its axes and, for a floor, its corners in its own plane (metres).
#[derive(Debug, Clone, PartialEq)]
struct Element {
    id: String,
    parent: Option<String>,
    kind: Kind,
    m: [f64; 16],
    size: [f64; 3],
    corners: Vec<[f64; 3]>,
    story: i64,
}

impl Element {
    /// A point of its own frame in the scan's.
    fn point(&self, p: [f64; 3]) -> [f64; 3] {
        let m = &self.m;
        [
            p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
            p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
            p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14],
        ]
    }

    /// Its centre on the plan (cm).
    fn centre(&self) -> P2 {
        [self.m[12] * 100.0, self.m[14] * 100.0]
    }

    /// Whether a point of the plan (cm) is within its footprint.
    fn covers(&self, p: P2) -> bool {
        let (Some(along), Some(across)) = (self.axis(0), self.axis(2)) else {
            return false;
        };
        let c = self.centre();
        let d = [p[0] - c[0], p[1] - c[1]];
        let x = d[0] * along[0] + d[1] * along[1];
        let z = d[0] * across[0] + d[1] * across[1];
        x.abs() <= self.size[0] * 50.0 && z.abs() <= self.size[2] * 50.0
    }

    /// One of its axes on the plan (`0`: along it, `2`: across it), as a unit vector.
    fn axis(&self, k: usize) -> Option<P2> {
        let (x, z) = (self.m[4 * k], self.m[4 * k + 2]);
        let len = x.hypot(z);
        (len > 1e-6).then(|| [x / len, z / len])
    }
}

/// A labelled place of the scan: the room it names.
#[derive(Debug, Clone, PartialEq)]
struct Section {
    label: String,
    centre: [f64; 3],
    story: i64,
}

/// A room scan, read.
#[derive(Debug, Clone, PartialEq)]
pub struct ScanFile {
    title: String,
    elements: Vec<Element>,
    sections: Vec<Section>,
}

/// A category as one lower-case word: `"Door(Isopen: False)"` → `door`, `washerDryer` →
/// `washerdryer`.
fn category(text: &str) -> String {
    text.split('(')
        .next()
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphabetic)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn kind_of(category: &str, attributes: BTreeMap<String, String>) -> Option<Kind> {
    Some(match category {
        "wall" => Kind::Wall,
        "door" => Kind::Door,
        "window" => Kind::Window,
        "opening" => Kind::Opening,
        "floor" => Kind::Floor,
        "" => return None,
        other => Kind::Object(other.to_owned(), attributes),
    })
}

fn matrix(values: &[f64]) -> Option<[f64; 16]> {
    let m: [f64; 16] = values.get(..16)?.try_into().ok()?;
    m.iter().all(|v| v.is_finite()).then_some(m)
}

impl ScanFile {
    /// Reads the JSON of a scan (`CapturedRoom` or `CapturedStructure`).
    ///
    /// # Errors
    ///
    /// `not_plan` for JSON that is not a scan, `too_large` past 5 000 elements.
    pub fn from_json(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        let root: Json = serde_json::from_slice(bytes).map_err(|_| "not_plan")?;
        Self::from_value(&root, title)
    }

    /// Reads the JSON of a scan, parsed.
    ///
    /// # Errors
    ///
    /// `not_plan` for JSON that is not a scan, `too_large` past 5 000 elements.
    pub fn from_value(root: &Json, title: &str) -> Result<Self, &'static str> {
        let object = root.as_object().ok_or("not_plan")?;
        if !object.contains_key("walls") && !object.contains_key("rooms") {
            return Err("not_plan");
        }
        // A structure's rooms, merged into its own lists; a room is its own.
        let lists = ["walls", "doors", "windows", "openings", "floors", "objects"];
        let merged = lists.iter().any(|k| {
            object
                .get(*k)
                .and_then(Json::as_array)
                .is_some_and(|a| !a.is_empty())
        });
        let rooms: Vec<&Map<String, Json>> = if merged || object.contains_key("walls") {
            vec![object]
        } else {
            object
                .get("rooms")
                .and_then(Json::as_array)
                .ok_or("not_plan")?
                .iter()
                .filter_map(Json::as_object)
                .collect()
        };
        let mut scan = ScanFile {
            title: title.chars().take(100).collect(),
            elements: Vec::new(),
            sections: Vec::new(),
        };
        for room in rooms {
            for list in lists {
                for entry in room
                    .get(list)
                    .and_then(Json::as_array)
                    .into_iter()
                    .flatten()
                {
                    if scan.elements.len() >= MAX_ELEMENTS {
                        return Err("too_large");
                    }
                    if let Some(element) = json_element(entry) {
                        scan.elements.push(element);
                    }
                }
            }
            let sections = if merged {
                object.get("sections")
            } else {
                room.get("sections")
            };
            for s in sections.and_then(Json::as_array).into_iter().flatten() {
                let centre: Vec<f64> = s["center"]
                    .as_array()
                    .map(|c| c.iter().filter_map(Json::as_f64).collect())
                    .unwrap_or_default();
                if let (Some(label), [x, y, z, ..]) = (s["label"].as_str(), centre.as_slice()) {
                    scan.sections.push(Section {
                        label: label.to_owned(),
                        centre: [*x, *y, *z],
                        story: s["story"].as_i64().unwrap_or(0),
                    });
                }
            }
        }
        Ok(scan)
    }

    /// Reads a scan's USDZ: its root layer, then the layer of each element it references, in
    /// the parametric export (else the mesh one, else the model one).
    ///
    /// # Errors
    ///
    /// `not_plan` for an archive without a scan, `scan_usdc` for one written in USD's binary
    /// format (re-saved by another app), `too_large` past the limits.
    pub fn from_usdz(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        let archive = Archive::new(bytes).map_err(|_| "not_plan")?;
        let mut names: Vec<&str> = archive.names().collect();
        names.sort_unstable();
        let root = names
            .iter()
            .find(|n| n.ends_with(".usda") && !n.contains('/'))
            .copied();
        let Some(root) = root else {
            return Err(if names.iter().any(|n| n.ends_with(".usdc")) {
                "scan_usdc"
            } else {
                "not_plan"
            });
        };
        let read = |name: &str| -> Result<Layer, &'static str> {
            let bytes = archive.read(name).map_err(|e| match e {
                domotwin_models::Error::TooLarge => "too_large",
                _ => "not_plan",
            })?;
            usda::read(&bytes)
        };
        let layer = read(root)?;
        let top = layer.default_prim().ok_or("not_plan")?;
        let mut scan = ScanFile {
            title: title.chars().take(100).collect(),
            elements: Vec::new(),
            sections: Vec::new(),
        };
        // Sections: `Section_grp/<label><k>`, at their centre.
        if let Some(group) = top.children.iter().find(|p| p.name == "Section_grp") {
            for section in &group.children {
                let m = section
                    .props
                    .get("xformOp:transform")
                    .and_then(|v| matrix(&v.numbers()));
                if let Some(m) = m {
                    scan.sections.push(Section {
                        label: section
                            .name
                            .trim_end_matches(|c: char| c.is_ascii_digit())
                            .to_owned(),
                        centre: [m[12], m[13], m[14]],
                        story: 0,
                    });
                }
            }
        }
        let option = ["Parametric_grp", "Mesh_grp", "Model_grp"]
            .iter()
            .find_map(|name| top.children.iter().find(|p| p.name == *name))
            .unwrap_or(top);
        let mut assets: Vec<String> = Vec::new();
        collect_references(option, &mut assets, 0);
        let mut seen = BTreeSet::new();
        for asset in assets {
            let name = asset.trim_start_matches("./").to_ascii_lowercase();
            if !seen.insert(name.clone()) || !archive.has(&name) {
                continue;
            }
            if scan.elements.len() >= MAX_ELEMENTS {
                return Err("too_large");
            }
            if name.ends_with(".usdc") {
                continue;
            }
            let layer = read(&name)?;
            if let Some(element) = usda_element(&layer) {
                scan.elements.push(element);
            }
        }
        scan.stories_by_height();
        Ok(scan)
    }

    /// The stories of a USDZ, which does not say them: the levels its floors and the feet of its
    /// walls stand at, more than 1.5 m apart; each element on the highest level at its foot.
    fn stories_by_height(&mut self) {
        let foot = |e: &Element| match e.kind {
            Kind::Floor => e.m[13],
            _ => e.m[13] - e.size[1] / 2.0,
        };
        let mut heights: Vec<f64> = self
            .elements
            .iter()
            .filter(|e| matches!(e.kind, Kind::Floor | Kind::Wall))
            .map(foot)
            .filter(|h| h.is_finite())
            .collect();
        heights.sort_by(f64::total_cmp);
        let mut levels: Vec<f64> = Vec::new();
        for h in heights {
            if levels.last().is_none_or(|l| h - l > 1.5) {
                levels.push(h);
            }
        }
        if levels.len() < 2 {
            return;
        }
        let story = |h: f64| {
            let k = levels.iter().filter(|l| **l <= h + 0.5).count().max(1) - 1;
            i64::try_from(k).unwrap_or(0)
        };
        for e in &mut self.elements {
            e.story = story(foot(e));
        }
        for s in &mut self.sections {
            s.story = story(s.centre[1]);
        }
    }

    /// The stories of the scan, lowest first.
    fn stories(&self) -> Vec<i64> {
        let set: BTreeSet<i64> = self.elements.iter().map(|e| e.story).collect();
        let mut stories: Vec<i64> = set.into_iter().collect();
        stories.sort_by(|a, b| {
            self.floor_level(*a)
                .total_cmp(&self.floor_level(*b))
                .then(a.cmp(b))
        });
        stories
    }

    /// The height of a story's floor (m): its floors', else the foot of its walls.
    fn floor_level(&self, story: i64) -> f64 {
        let on = || self.elements.iter().filter(move |e| e.story == story);
        on().filter(|e| e.kind == Kind::Floor)
            .map(|e| e.m[13])
            .reduce(f64::min)
            .or_else(|| {
                on().filter(|e| e.kind == Kind::Wall)
                    .map(|e| e.m[13] - e.size[1] / 2.0)
                    .reduce(f64::min)
            })
            .unwrap_or(0.0)
    }

    /// The rooms the walls of a story enclose, their corners closed.
    fn wall_rooms(&self, story: i64) -> Vec<Vec<P2>> {
        let mut walls: Vec<(P2, P2)> = self
            .elements
            .iter()
            .filter(|e| e.story == story && e.kind == Kind::Wall)
            .filter_map(|e| {
                let (c, u, w) = (e.centre(), e.axis(0)?, e.size[0] * 100.0);
                Some((
                    [c[0] - u[0] * w / 2.0, c[1] - u[1] * w / 2.0],
                    [c[0] + u[0] * w / 2.0, c[1] + u[1] * w / 2.0],
                ))
            })
            .collect();
        close_corners(&mut walls);
        let segments: Vec<(P2, P2, f64)> = walls.iter().map(|&(a, b)| (a, b, 0.0)).collect();
        faces::rooms_between_walls(&segments)
    }

    /// The storeys: the stories, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        let stories = self.stories();
        let ground = stories.first().map_or(0.0, |s| self.floor_level(*s));
        stories
            .iter()
            .enumerate()
            .map(|(i, &story)| {
                let on = || self.elements.iter().filter(move |e| e.story == story);
                let floors = on().filter(|e| e.kind == Kind::Floor).count();
                let walls = on().any(|e| e.kind == Kind::Wall);
                Storey {
                    id: u32::try_from(i).unwrap_or(u32::MAX),
                    // Named by its place (ground floor, floor 1…) where it is shown.
                    name: String::new(),
                    elevation: ((self.floor_level(story) - ground) * 1000.0).round() / 10.0,
                    spaces: if floors > 0 {
                        floors
                    } else if walls {
                        self.wall_rooms(story).len()
                    } else {
                        0
                    },
                    doors: on()
                        .filter(|e| matches!(e.kind, Kind::Door | Kind::Opening))
                        .count(),
                    windows: on().filter(|e| e.kind == Kind::Window).count(),
                    furniture: on().filter(|e| matches!(e.kind, Kind::Object(..))).count(),
                }
            })
            .collect()
    }

    /// The plan of storey `id`, what was left out, and no upkeep card.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no room.
    pub fn convert(&self, id: u32) -> Result<(Json, Report, Map<String, Json>), &'static str> {
        let stories = self.stories();
        let story = *stories.get(id as usize).ok_or("no_storeys")?;
        let on: Vec<&Element> = self.elements.iter().filter(|e| e.story == story).collect();
        let level = self.floor_level(story);
        let mut draft = Draft {
            name: self.title.clone(),
            ..Draft::default()
        };
        // Rooms: the floors, else the walls' faces.
        let mut outlines: Vec<Vec<P2>> = on
            .iter()
            .filter(|e| e.kind == Kind::Floor)
            .map(|e| {
                let corners = if e.corners.len() >= 3 {
                    e.corners.clone()
                } else {
                    let [w, d, _] = e.size;
                    vec![
                        [-w / 2.0, -d / 2.0, 0.0],
                        [w / 2.0, -d / 2.0, 0.0],
                        [w / 2.0, d / 2.0, 0.0],
                        [-w / 2.0, d / 2.0, 0.0],
                    ]
                };
                corners
                    .iter()
                    .map(|&c| {
                        let p = e.point(c);
                        [p[0] * 100.0, p[2] * 100.0]
                    })
                    .collect()
            })
            .collect();
        if outlines.is_empty() {
            outlines = self.wall_rooms(story);
        }
        for (k, points) in outlines.into_iter().enumerate() {
            let name = self
                .sections
                .iter()
                .filter(|s| s.story == story)
                .find(|s| point_in_polygon([s.centre[0] * 100.0, s.centre[2] * 100.0], &points))
                .map(|s| room_name(&s.label))
                .unwrap_or_default();
            draft.rooms.push(DraftRoom {
                id: format!("room-{}", k + 1),
                name: name.to_owned(),
                points,
                floor: None,
            });
        }
        // Doors, windows and openings.
        let (mut doors, mut windows) = (0, 0);
        for e in &on {
            let (door, style) = match e.kind {
                Kind::Door => (true, None),
                Kind::Opening => (true, Some("opening")),
                Kind::Window => (false, None),
                _ => continue,
            };
            let (Some(along), Some(across)) = (e.axis(0), e.axis(2)) else {
                draft.report.unplaced_openings += 1;
                continue;
            };
            let id = if door {
                doors += 1;
                format!("door-{doors}")
            } else {
                windows += 1;
                format!("window-{windows}")
            };
            draft.openings.push(DraftOpening {
                id,
                name: String::new(),
                door,
                centre: e.centre(),
                along,
                opens: across,
                width: e.size[0] * 100.0,
                right: false,
                style,
            });
        }
        // Objects: a storage unit holding a sink or a hob (its parent, or standing over it) is a
        // counter.
        let fitted: Vec<&&Element> = on
            .iter()
            .filter(|e| {
                matches!(&e.kind, Kind::Object(c, _)
                    if matches!(c.as_str(), "sink" | "stove" | "oven" | "dishwasher"))
            })
            .collect();
        let holds = |storage: &Element| {
            fitted.iter().any(|f| {
                f.parent.as_deref() == Some(storage.id.as_str()) && !storage.id.is_empty()
                    || storage.covers(f.centre())
            })
        };
        let mut pieces = 0;
        for e in &on {
            let Kind::Object(category, attributes) = &e.kind else {
                continue;
            };
            let [w, h, d] = e.size.map(|v| v * 100.0);
            let elevation = ((e.m[13] - level) * 100.0 - h / 2.0).max(0.0);
            let size = [w, d, h.clamp(1.0, 300.0)];
            let Some(along) = e.axis(0) else {
                draft.report.skipped_furniture += 1;
                continue;
            };
            if size[0] < 1.0 || size[1] < 1.0 {
                draft.report.skipped_furniture += 1;
                continue;
            }
            let counter = matches!(&e.kind, Kind::Object(c, _) if c == "storage") && holds(e);
            pieces += 1;
            draft.pieces.push(DraftPiece {
                id: format!("piece-{pieces}"),
                name: String::new(),
                kind: piece_kind(category, attributes, size, elevation, counter),
                centre: e.centre(),
                size,
                angle: degrees(along),
                elevation,
                card: None,
            });
        }
        build::align(&mut draft);
        build::build(draft)
    }
}

/// The references of a group and of the groups in it, in order.
fn collect_references(prim: &Prim, out: &mut Vec<String>, depth: usize) {
    if depth > 16 {
        return;
    }
    if let Some(references) = prim.meta.get("references") {
        out.extend(references.assets().into_iter().map(str::to_owned));
    }
    for child in &prim.children {
        collect_references(child, out, depth + 1);
    }
}

/// An element of a scan's JSON.
fn json_element(entry: &Json) -> Option<Element> {
    let category_object = entry["category"].as_object()?;
    let (name, _) = category_object.iter().next()?;
    let attributes: BTreeMap<String, String> = entry["attributes"]
        .as_object()
        .map(|a| {
            a.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default();
    let kind = kind_of(&category(name), attributes)?;
    let numbers = |v: &Json| -> Vec<f64> {
        v.as_array()
            .map(|a| a.iter().filter_map(Json::as_f64).collect())
            .unwrap_or_default()
    };
    let m = matrix(&numbers(&entry["transform"]))?;
    let size: [f64; 3] = numbers(&entry["dimensions"]).get(..3)?.try_into().ok()?;
    let corners = entry["polygonCorners"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|c| {
                    let n = numbers(c);
                    Some([*n.first()?, *n.get(1)?, n.get(2).copied().unwrap_or(0.0)])
                })
                .take(1_000)
                .collect()
        })
        .unwrap_or_default();
    Some(Element {
        id: entry["identifier"].as_str().unwrap_or_default().to_owned(),
        parent: entry["parentIdentifier"].as_str().map(str::to_owned),
        kind,
        m,
        size: size.map(f64::abs),
        corners,
        story: entry["story"].as_i64().unwrap_or(0),
    })
}

/// The element a layer of a scan's USDZ holds: its category from its default prim's
/// `customData`, its pose and size from its cube (`xformOp:transform`, `xformOp:scale`) or its
/// mesh (the box of its points).
fn usda_element(layer: &Layer) -> Option<Element> {
    let top = layer.default_prim()?;
    let custom = match top.meta.get("customData") {
        Some(Value::Dict(d)) => d.get("Category").and_then(Value::text).unwrap_or_default(),
        _ => "",
    };
    let named = top.name.trim_end_matches(|c: char| c.is_ascii_digit());
    let text = if custom.is_empty() { named } else { custom };
    let kind = kind_of(&category(text), BTreeMap::new())?;
    let posed = top.find(&|p| p.props.contains_key("xformOp:transform"))?;
    let m = matrix(&posed.props["xformOp:transform"].numbers())?;
    let metres = layer.metres();
    let mut element = Element {
        id: match top.meta.get("customData") {
            Some(Value::Dict(d)) => d
                .get("UUID")
                .and_then(Value::text)
                .unwrap_or_default()
                .to_owned(),
            _ => String::new(),
        },
        parent: None,
        kind,
        m,
        size: [0.0; 3],
        corners: Vec::new(),
        story: 0,
    };
    for k in 12..15 {
        element.m[k] *= metres;
    }
    if let Some(scale) = posed.props.get("xformOp:scale") {
        let s = scale.numbers();
        if let [x, y, z, ..] = s.as_slice() {
            let size = posed
                .props
                .get("size")
                .and_then(Value::number)
                .unwrap_or(1.0);
            element.size = [x, y, z].map(|v| (v * size * metres).abs());
        }
    } else if let Some(points) = posed.props.get("points") {
        let p = points.numbers();
        let points: Vec<[f64; 3]> = p.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for q in &points {
            for k in 0..3 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
        if !lo[0].is_finite() {
            return None;
        }
        element.size = [0, 1, 2].map(|k| (hi[k] - lo[k]) * metres);
        // The box's centre, in the scan: the pose moved to it (a floor's top face: the level
        // furniture stands on).
        let mut mid = [0, 1, 2].map(|k| (lo[k] + hi[k]) / 2.0);
        if element.kind == Kind::Floor {
            mid[2] = hi[2];
        }
        let centre = element.point(mid.map(|v| v * metres));
        element.m[12..15].copy_from_slice(&centre);
        if element.kind == Kind::Floor {
            // Its top face's outline, in its own plane, about the box's centre.
            element.corners = top_outline(&points, posed)
                .into_iter()
                .map(|q| [(q[0] - mid[0]) * metres, (q[1] - mid[1]) * metres, 0.0])
                .collect();
        }
    }
    (element.size[0] > 0.0).then_some(element)
}

/// The outline of a slab's top face (its points at the highest `z`), from its triangles' edges
/// used once; else the box of its points.
fn top_outline(points: &[[f64; 3]], mesh: &Prim) -> Vec<[f64; 3]> {
    let top = points
        .iter()
        .map(|p| p[2])
        .fold(f64::NEG_INFINITY, f64::max);
    let on_top = |k: usize| points.get(k).is_some_and(|p| (p[2] - top).abs() < 1e-4);
    let counts: Vec<usize> = mesh
        .props
        .get("faceVertexCounts")
        .map(|v| v.numbers().iter().map(|&n| n as usize).collect())
        .unwrap_or_default();
    let indices: Vec<usize> = mesh
        .props
        .get("faceVertexIndices")
        .map(|v| v.numbers().iter().map(|&n| n as usize).collect())
        .unwrap_or_default();
    let mut edges: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    let mut at = 0_usize;
    for &count in &counts {
        let Some(face) = at.checked_add(count).and_then(|end| indices.get(at..end)) else {
            break;
        };
        at += count;
        if face.iter().all(|&k| on_top(k)) {
            for i in 0..count {
                let (a, b) = (face[i], face[(i + 1) % count]);
                *edges.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }
    }
    let boundary: Vec<(usize, usize)> = edges
        .into_iter()
        .filter(|(_, n)| *n == 1)
        .map(|(e, _)| e)
        .collect();
    // Chain the boundary edges into one loop.
    let mut out = Vec::new();
    if let Some(&(start, mut next)) = boundary.first() {
        out.push(start);
        let mut prev = start;
        while next != start && out.len() <= boundary.len() {
            out.push(next);
            let Some(&(a, b)) = boundary
                .iter()
                .find(|&&(a, b)| (a == next && b != prev) || (b == next && a != prev))
            else {
                break;
            };
            prev = next;
            next = if a == prev { b } else { a };
        }
    }
    if out.len() >= 3 && out.len() == boundary.len() {
        return out.into_iter().map(|k| points[k]).collect();
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in points {
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    vec![
        [lo[0], lo[1], top],
        [hi[0], lo[1], top],
        [hi[0], hi[1], top],
        [lo[0], hi[1], top],
    ]
}

/// Moves the ends of walls that nearly meet to where their lines cross: a scan's corners are
/// rarely closed exactly.
fn close_corners(walls: &mut [(P2, P2)]) {
    let n = walls.len();
    for i in 0..n {
        for j in i + 1..n {
            let ((a, b), (c, d)) = (walls[i], walls[j]);
            let r = [b[0] - a[0], b[1] - a[1]];
            let s = [d[0] - c[0], d[1] - c[1]];
            let den = r[0] * s[1] - r[1] * s[0];
            if den.abs() < 0.3 * r[0].hypot(r[1]) * s[0].hypot(s[1]) {
                continue;
            }
            let t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
            let x = [a[0] + r[0] * t, a[1] + r[1] * t];
            let u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
            // The end of each wall nearest the crossing, when it stops short of it or past it
            // (a wall shorter than the gap has both ends near: the nearer one).
            let dist = |p: P2| (p[0] - x[0]).hypot(p[1] - x[1]);
            let nearest = |[p, q]: [P2; 2]| {
                let k = usize::from(dist(q) < dist(p));
                (dist([p, q][k]) < CORNER_GAP).then_some(k)
            };
            let mut set = |wall: usize, end: usize| {
                if end == 0 {
                    walls[wall].0 = x;
                } else {
                    walls[wall].1 = x;
                }
            };
            match (nearest([a, b]), nearest([c, d])) {
                (Some(ei), Some(ej)) => {
                    set(i, ei);
                    set(j, ej);
                }
                // A wall stopping short of another's middle: a T.
                (Some(ei), None) if (0.0..=1.0).contains(&u) => set(i, ei),
                (None, Some(ej)) if (0.0..=1.0).contains(&t) => set(j, ej),
                _ => {}
            }
        }
    }
}

/// A room's name from a section's label.
fn room_name(label: &str) -> &'static str {
    match label {
        "livingRoom" => "Living room",
        "bedroom" => "Bedroom",
        "bathroom" => "Bathroom",
        "kitchen" => "Kitchen",
        "diningRoom" => "Dining room",
        _ => "",
    }
}

/// The plan's kind of a scanned object, from its category, its attributes (iOS 17) and its size.
fn piece_kind(
    category: &str,
    attributes: &BTreeMap<String, String>,
    [w, d, h]: [f64; 3],
    elevation: f64,
    counter: bool,
) -> &'static str {
    let attr = |k: &str| attributes.get(k).map(String::as_str);
    match category {
        "refrigerator" => "fridge",
        "stove" | "oven" => "stove",
        "bed" => "bed",
        "sink" => "sink",
        "washerdryer" => "washer",
        "toilet" => "toilet",
        "bathtub" => "bathtub",
        "dishwasher" => "dishwasher",
        "television" => "tv",
        "stairs" => "stairs",
        "sofa" => {
            if attr("SofaType") == Some("singleSeat") {
                "armchair"
            } else {
                "sofa"
            }
        }
        "chair" => match attr("ChairType") {
            Some("swivel") => "office-chair",
            _ => "chair",
        },
        "table" => match attr("TableType") {
            Some("coffee") => "coffee-table",
            Some("dining") => "dining-table",
            _ if h < 55.0 => "coffee-table",
            _ if w.max(d) < 70.0 => "side-table",
            _ => "dining-table",
        },
        "storage" => {
            if counter {
                "counter"
            } else if attr("StorageType") == Some("shelf") {
                "bookcase"
            } else if elevation > 100.0 {
                "wall-cabinet"
            } else if h >= 150.0 {
                "tall-cabinet"
            } else {
                "dresser"
            }
        }
        _ => "box",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scan's pose: turned by `angle` (radians, about `y`) and placed at `at` (metres).
    fn pose(angle: f64, at: [f64; 3]) -> Vec<f64> {
        let (s, c) = angle.sin_cos();
        vec![
            c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, at[0], at[1], at[2], 1.0,
        ]
    }

    fn wall(angle: f64, at: [f64; 2], width: f64) -> Json {
        serde_json::json!({ "category": { "wall": {} }, "transform": pose(angle, [at[0], 0.0, at[1]]),
            "dimensions": [width, 2.5, 0.0], "story": 0 })
    }

    #[test]
    fn short_walls_keep_their_corners() {
        // A 4 × 3 m room with a chimney breast: two 40 cm returns, shorter than the gap closed
        // at corners.
        let half = std::f64::consts::FRAC_PI_2;
        let walls = [
            wall(0.0, [-1.3, -1.5], 1.4),
            wall(0.0, [0.0, -1.1], 1.2),
            wall(0.0, [1.3, -1.5], 1.4),
            wall(half, [-0.6, -1.3], 0.4),
            wall(half, [0.6, -1.3], 0.4),
            wall(0.0, [0.0, 1.5], 4.0),
            wall(half, [-2.0, 0.0], 3.0),
            wall(half, [2.0, 0.0], 3.0),
        ];
        let json = serde_json::json!({ "walls": walls });
        let scan = ScanFile::from_json(json.to_string().as_bytes(), "Scan").unwrap();
        let (plan, report, _) = scan.convert(0).unwrap();
        assert_eq!(report.rooms, 1, "{plan}");
        let outline: Vec<[f64; 2]> =
            serde_json::from_value(plan["rooms"][0]["outline"].clone()).unwrap();
        let area = crate::math::signed_area2(&outline).abs() / 2.0;
        assert!((area - 115_200.0).abs() < 100.0, "{area} {outline:?}");
        // A partition stopping 20 cm short of the back wall's middle: a T, two rooms.
        let split = [
            wall(0.0, [0.0, -1.5], 4.0),
            wall(0.0, [0.0, 1.5], 4.0),
            wall(half, [-2.0, 0.0], 3.0),
            wall(half, [2.0, 0.0], 3.0),
            wall(half, [0.5, 0.1], 2.8),
        ];
        let json = serde_json::json!({ "walls": split });
        let scan = ScanFile::from_json(json.to_string().as_bytes(), "Scan").unwrap();
        assert_eq!(scan.convert(0).unwrap().1.rooms, 2);
    }

    #[test]
    fn a_room_from_its_walls_turned_square() {
        // A 4 × 3 m room turned by 20°, its corners a little open.
        let a = 20_f64.to_radians();
        let (s, c) = a.sin_cos();
        let at = |x: f64, z: f64| [x * c + z * s, -x * s + z * c];
        let walls = [
            wall(a, at(0.0, -1.5), 3.95),
            wall(a, at(0.0, 1.5), 3.95),
            wall(a + std::f64::consts::FRAC_PI_2, at(-2.0, 0.0), 2.95),
            wall(a + std::f64::consts::FRAC_PI_2, at(2.0, 0.0), 2.95),
        ];
        let json = serde_json::json!({ "version": 2, "walls": walls,
            "doors": [{ "category": { "door": { "isOpen": false } }, "transform": pose(a, [at(0.5, 1.5)[0], 0.0, at(0.5, 1.5)[1]]),
                        "dimensions": [0.9, 2.1, 0.0] }],
            "objects": [{ "category": { "sofa": {} }, "transform": pose(a, [at(0.0, 1.0)[0], -0.8, at(0.0, 1.0)[1]]),
                          "dimensions": [2.0, 0.8, 0.9], "attributes": { "SofaType": "rectangular" } }],
            "sections": [{ "label": "livingRoom", "center": [0.0, 0.0, 0.0], "story": 0 }] });
        let scan = ScanFile::from_json(json.to_string().as_bytes(), "Scan").unwrap();
        assert_eq!(scan.storeys()[0].spaces, 1);
        let (plan, report, _) = scan.convert(0).unwrap();
        assert_eq!(
            (
                report.rooms,
                report.doors,
                report.furniture,
                report.unplaced_openings
            ),
            (1, 1, 1, 0)
        );
        assert_eq!(plan["rooms"][0]["name"], "Living room");
        // Square to the axes, 400 × 300.
        let outline: Vec<[f64; 2]> =
            serde_json::from_value(plan["rooms"][0]["outline"].clone()).unwrap();
        let xs: Vec<f64> = outline.iter().map(|p| p[0]).collect();
        let ys: Vec<f64> = outline.iter().map(|p| p[1]).collect();
        let span = |v: &[f64]| {
            v.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                - v.iter().copied().fold(f64::INFINITY, f64::min)
        };
        assert!(
            (span(&xs) - 400.0).abs() < 0.5 && (span(&ys) - 300.0).abs() < 0.5,
            "{outline:?}"
        );
        assert_eq!(plan["items"][0]["kind"], "sofa");
        assert!(plan["items"][0]["rotation"].as_f64().unwrap() % 90.0 < 0.5);
        domotwin_core::plan::read_plan_value(&plan).unwrap();
    }

    #[test]
    fn categories_and_kinds() {
        assert_eq!(category("Door(Isopen: False)"), "door");
        assert_eq!(category("washerDryer"), "washerdryer");
        assert_eq!(category("Washerdryer"), "washerdryer");
        let none = BTreeMap::new();
        assert_eq!(
            piece_kind("storage", &none, [60.0, 60.0, 90.0], 0.0, true),
            "counter"
        );
        assert_eq!(
            piece_kind("storage", &none, [60.0, 40.0, 200.0], 0.0, false),
            "tall-cabinet"
        );
        assert_eq!(
            piece_kind("table", &none, [100.0, 60.0, 40.0], 0.0, false),
            "coffee-table"
        );
        assert_eq!(
            piece_kind("fireplace", &none, [100.0, 60.0, 100.0], 0.0, false),
            "box"
        );
        assert_eq!(ScanFile::from_json(b"{}", "x").err(), Some("not_plan"));
        assert_eq!(ScanFile::from_json(b"[1]", "x").err(), Some("not_plan"));
    }
}
