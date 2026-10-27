//! Floorplanner's plans (`DECISIONS.md`, D-057): FML 3.0, the JSON that Floorplanner exports and
//! that apps exporting to it write. In centimetres, `y` down as on a plan.
//!
//! A project has floors (storeys, by level, each of its height), each with designs (variants of
//! its plan: the first is read). A design has areas (the rooms, inside their walls), walls (two
//! ends, a thickness, their openings at `t` along them), items (pieces, a centre, a size and a
//! rotation) and labels. Without areas, the rooms are the faces the walls enclose.

use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftPiece, DraftRoom, Report, WallHint};
use crate::convert::Storey;
use crate::faces;
use crate::kinds;
use crate::math::{P2, point_in_polygon};

/// Most elements read (areas, walls, openings, items and labels).
const MAX_ELEMENTS: usize = 20_000;
/// Most corners of an area.
const MAX_CORNERS: usize = 1_000;
/// A floor's height when it does not say (cm).
const HEIGHT: f64 = 280.0;

#[derive(Debug, Clone, PartialEq)]
struct Area {
    name: String,
    points: Vec<P2>,
}

#[derive(Debug, Clone, PartialEq)]
struct Opening {
    /// Where its centre is along its wall (0 to 1).
    t: f64,
    width: f64,
    window: bool,
    /// An opening without a leaf (a passage).
    open: bool,
    mirrored: (bool, bool),
}

#[derive(Debug, Clone, PartialEq)]
struct Wall {
    a: P2,
    b: P2,
    thickness: f64,
    openings: Vec<Opening>,
}

#[derive(Debug, Clone, PartialEq)]
struct Item {
    name: String,
    refid: String,
    centre: P2,
    size: [f64; 3],
    elevation: f64,
    rotation: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct Floor {
    name: String,
    level: i64,
    height: f64,
    areas: Vec<Area>,
    walls: Vec<Wall>,
    items: Vec<Item>,
    labels: Vec<(P2, String)>,
    /// Surfaces outside (a terrace, a path), left out.
    surfaces: usize,
}

/// A Floorplanner project, read.
#[derive(Debug, Clone, PartialEq)]
pub struct FmlFile {
    title: String,
    /// Lowest first.
    floors: Vec<Floor>,
}

/// The project of an FML object: itself, or its `project`.
fn project(object: &Map<String, Json>) -> Option<&Map<String, Json>> {
    let has_floors = |o: &Map<String, Json>| {
        o.get("floors")
            .and_then(Json::as_array)
            .is_some_and(|floors| {
                floors
                    .iter()
                    .any(|f| f.get("designs").is_some_and(Json::is_array))
            })
    };
    if has_floors(object) {
        return Some(object);
    }
    object
        .get("project")
        .and_then(Json::as_object)
        .filter(|p| has_floors(p))
}

/// Whether a JSON object is an FML project.
pub(crate) fn is_fml(object: &Map<String, Json>) -> bool {
    project(object).is_some()
}

/// Whether a text is the older FML, in XML.
pub(crate) fn is_fml_xml(start: &str) -> bool {
    start.trim_start().starts_with('<') && start.contains("<project") && start.contains("<floor")
}

fn number(value: &Json) -> Option<f64> {
    value.as_f64().filter(|v| v.is_finite() && v.abs() < 1e7)
}

fn point(value: &Json) -> Option<P2> {
    Some([number(&value["x"])?, number(&value["y"])?])
}

fn text(value: &Json, limit: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(limit)
        .collect()
}

/// Whether a label names a room rather than giving a size or a number.
fn is_name(text: &str) -> bool {
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    letters >= 2 && !text.contains("m²") && !text.contains("m2") && text.chars().count() <= 60
}

impl FmlFile {
    /// Reads an FML project; `title` names it when it has no name.
    ///
    /// # Errors
    ///
    /// `not_plan` for JSON that is not one, `too_large` past 20 000 elements.
    pub fn from_value(root: &Json, title: &str) -> Result<Self, &'static str> {
        let project = root.as_object().and_then(project).ok_or("not_plan")?;
        let named = text(project.get("name").unwrap_or(&Json::Null), 100);
        let mut budget = MAX_ELEMENTS;
        let mut take = |n: usize| -> Result<(), &'static str> {
            budget = budget.checked_sub(n).ok_or("too_large")?;
            Ok(())
        };
        let mut floors = Vec::new();
        for floor in project["floors"].as_array().into_iter().flatten() {
            let Some(design) = floor["designs"].as_array().and_then(|d| d.first()) else {
                continue;
            };
            let list = |key: &str| design[key].as_array().map_or(&[][..], Vec::as_slice);
            let mut f = Floor {
                name: text(&floor["name"], 60),
                level: floor["level"].as_i64().unwrap_or(0).clamp(-20, 200),
                height: number(&floor["height"])
                    .filter(|h| *h >= 100.0 && *h <= 2000.0)
                    .unwrap_or(HEIGHT),
                areas: Vec::new(),
                walls: Vec::new(),
                items: Vec::new(),
                labels: Vec::new(),
                surfaces: list("surfaces").len(),
            };
            take(list("areas").len() + list("walls").len() + list("items").len())?;
            take(list("labels").len())?;
            for area in list("areas") {
                let points: Vec<P2> = area["poly"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(MAX_CORNERS)
                    .filter_map(point)
                    .collect();
                f.areas.push(Area {
                    name: text(&area["name"], 60),
                    points,
                });
            }
            for wall in list("walls") {
                let (Some(a), Some(b)) = (point(&wall["a"]), point(&wall["b"])) else {
                    continue;
                };
                let openings: Vec<Opening> = wall["openings"]
                    .as_array()
                    .map_or(&[][..], Vec::as_slice)
                    .iter()
                    .filter_map(|o| {
                        let kind = o["type"].as_str().unwrap_or_default().to_ascii_lowercase();
                        let mirrored = o["mirrored"].as_array();
                        let flag = |k: usize| {
                            mirrored
                                .and_then(|m| m.get(k))
                                .and_then(Json::as_f64)
                                .is_some_and(|v| v != 0.0)
                        };
                        Some(Opening {
                            t: number(&o["t"])?.clamp(0.0, 1.0),
                            width: number(&o["width"]).filter(|w| *w > 0.0)?,
                            window: kind.contains("window"),
                            open: !kind.contains("window") && !kind.contains("door"),
                            mirrored: (flag(0), flag(1)),
                        })
                    })
                    .collect();
                take(openings.len())?;
                f.walls.push(Wall {
                    a,
                    b,
                    thickness: number(&wall["thickness"])
                        .filter(|t| *t > 0.0)
                        .unwrap_or(15.0)
                        .min(200.0),
                    openings,
                });
            }
            for item in list("items") {
                let Some(centre) = point(item) else { continue };
                let size = [
                    number(&item["width"]).unwrap_or(0.0).abs(),
                    number(&item["height"]).unwrap_or(0.0).abs(),
                    number(&item["z_height"]).unwrap_or(80.0).abs(),
                ];
                f.items.push(Item {
                    name: text(&item["name"], 100),
                    refid: text(&item["refid"], 100),
                    centre,
                    size,
                    elevation: number(&item["z"]).unwrap_or(0.0).max(0.0),
                    rotation: number(&item["rotation"]).unwrap_or(0.0).rem_euclid(360.0),
                });
            }
            for label in list("labels") {
                if let Some(at) = point(label) {
                    f.labels.push((at, text(&label["text"], 100)));
                }
            }
            floors.push(f);
        }
        if floors.is_empty() {
            return Err("not_plan");
        }
        floors.sort_by_key(|f| f.level);
        Ok(FmlFile {
            title: if named.is_empty() {
                title.chars().take(100).collect()
            } else {
                named
            },
            floors,
        })
    }

    /// The rooms of a floor: its areas, else the faces its walls enclose.
    fn rooms(floor: &Floor) -> Vec<Area> {
        let drawn: Vec<Area> = floor
            .areas
            .iter()
            .filter(|a| a.points.len() >= 3)
            .cloned()
            .collect();
        if !drawn.is_empty() || floor.walls.is_empty() {
            return drawn;
        }
        let segments: Vec<(P2, P2, f64)> = floor
            .walls
            .iter()
            .map(|w| (w.a, w.b, w.thickness))
            .collect();
        faces::rooms_between_walls(&segments)
            .into_iter()
            .map(|points| Area {
                name: String::new(),
                points,
            })
            .collect()
    }

    /// The height of each floor above the ground floor's (cm): the heights of the floors
    /// between, by level.
    fn elevation(&self, level: i64) -> f64 {
        let height = |l: i64| {
            self.floors
                .iter()
                .find(|f| f.level == l)
                .map_or(HEIGHT, |f| f.height)
        };
        // An empty sum is −0: the ground floor is at 0.
        if level >= 0 {
            (0..level).map(height).sum::<f64>() + 0.0
        } else {
            -(level..0).map(height).sum::<f64>()
        }
    }

    /// The storeys: the floors, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        self.floors
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let openings = f.walls.iter().flat_map(|w| &w.openings);
                Storey {
                    id: u32::try_from(i).unwrap_or(u32::MAX),
                    name: f.name.clone(),
                    elevation: self.elevation(f.level),
                    spaces: Self::rooms(f).len(),
                    doors: openings.clone().filter(|o| !o.window).count(),
                    windows: openings.filter(|o| o.window).count(),
                    furniture: f.items.len(),
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
        let floor = self.floors.get(id as usize).ok_or("no_storeys")?;
        let name = if self.floors.len() > 1 && !floor.name.is_empty() {
            format!("{} – {}", self.title, floor.name)
        } else {
            self.title.clone()
        };
        let mut draft = Draft {
            name: name.chars().take(100).collect(),
            ..Draft::default()
        };
        draft.report.skipped_spaces += floor.surfaces;
        for (k, area) in Self::rooms(floor).into_iter().enumerate() {
            // Named by its name, else by a label inside it.
            let name = if area.name.is_empty() {
                floor
                    .labels
                    .iter()
                    .find(|(at, text)| is_name(text) && point_in_polygon(*at, &area.points))
                    .map(|(_, text)| text.clone())
                    .unwrap_or_default()
            } else {
                area.name
            };
            draft.rooms.push(DraftRoom {
                id: format!("room-{}", k + 1),
                name: name.chars().take(60).collect(),
                points: area.points,
                floor: None,
            });
        }
        let (mut doors, mut windows) = (0, 0);
        for wall in &floor.walls {
            draft.walls.push(WallHint {
                thickness: wall.thickness,
                external: None,
            });
            let (dx, dy) = (wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
            let len = dx.hypot(dy);
            if len < 1.0 {
                draft.report.unplaced_openings += wall.openings.len();
                continue;
            }
            let along = [dx / len, dy / len];
            for o in &wall.openings {
                let id = if o.window {
                    windows += 1;
                    format!("window-{windows}")
                } else {
                    doors += 1;
                    format!("door-{doors}")
                };
                let side = if o.mirrored.1 { -1.0 } else { 1.0 };
                draft.openings.push(DraftOpening {
                    id,
                    name: String::new(),
                    door: !o.window,
                    centre: [wall.a[0] + dx * o.t, wall.a[1] + dy * o.t],
                    along,
                    opens: [-along[1] * side, along[0] * side],
                    width: o.width,
                    right: o.mirrored.0,
                    style: o.open.then_some("opening"),
                });
            }
        }
        for (k, item) in floor.items.iter().enumerate() {
            if item.size[0] < 1.0 || item.size[1] < 1.0 {
                draft.report.skipped_furniture += 1;
                continue;
            }
            let names = [item.name.as_str(), item.refid.as_str()];
            draft.pieces.push(DraftPiece {
                id: format!("piece-{}", k + 1),
                name: item.name.clone(),
                kind: kinds::kind_by_name(&names, item.size, item.elevation, false),
                centre: item.centre,
                size: item.size,
                angle: build::round1(item.rotation) % 360.0,
                elevation: item.elevation,
                card: None,
            });
        }
        build::build(draft)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn wall(a: [f64; 2], b: [f64; 2], thickness: f64, openings: Json) -> Json {
        json!({ "a": { "x": a[0], "y": a[1] }, "b": { "x": b[0], "y": b[1] }, "c": null,
                "az": { "z": 0, "h": 280 }, "bz": { "z": 0, "h": 280 }, "thickness": thickness,
                "balance": 0.5, "openings": openings })
    }

    fn poly(points: &[[f64; 2]]) -> Json {
        Json::Array(
            points
                .iter()
                .map(|p| json!({ "x": p[0], "y": p[1] }))
                .collect(),
        )
    }

    /// Two rooms side by side, a 10 cm partition with a door, a window in the façade, a sofa.
    fn project() -> Json {
        json!({
            "id": 1, "name": "Studio", "settings": { "wallHeight": 280, "useMetric": true },
            "floors": [{
                "id": 2, "name": "Ground floor", "level": 0, "height": 260,
                "designs": [{
                    "name": "First design",
                    "areas": [
                        { "name": "Living room", "poly": poly(&[[10.0, 10.0], [395.0, 10.0], [395.0, 290.0], [10.0, 290.0]]) },
                        { "poly": poly(&[[405.0, 10.0], [690.0, 10.0], [690.0, 290.0], [405.0, 290.0]]) },
                    ],
                    "labels": [{ "x": 550, "y": 150, "text": "Bedroom" }, { "x": 560, "y": 170, "text": "8 m²" }],
                    "walls": [
                        wall([0.0, 0.0], [700.0, 0.0], 20.0, json!([
                            { "refid": "w1", "t": 0.3, "type": "window", "width": 120, "z": 90, "z_height": 120, "mirrored": [0, 0] }])),
                        wall([700.0, 0.0], [700.0, 300.0], 20.0, json!([])),
                        wall([700.0, 300.0], [0.0, 300.0], 20.0, json!([])),
                        wall([0.0, 300.0], [0.0, 0.0], 20.0, json!([])),
                        wall([400.0, 0.0], [400.0, 300.0], 10.0, json!([
                            { "refid": "d1", "t": 0.5, "type": "door", "width": 83, "z": 0, "z_height": 204, "mirrored": [1, 0] }])),
                    ],
                    "items": [{ "refid": "5fde815109db6138", "name": "Sofa", "x": 200, "y": 200, "z": 0,
                                "width": 210, "height": 90, "z_height": 85, "rotation": 90 }],
                    "surfaces": [{ "poly": [] }],
                }],
            }, {
                "id": 3, "name": "Attic", "level": 1, "designs": [{ "walls": [
                    wall([0.0, 0.0], [500.0, 0.0], 20.0, json!([])),
                    wall([500.0, 0.0], [500.0, 400.0], 20.0, json!([])),
                    wall([500.0, 400.0], [0.0, 400.0], 20.0, json!([])),
                    wall([0.0, 400.0], [0.0, 0.0], 20.0, json!([])),
                ] }],
            }],
        })
    }

    #[test]
    fn a_project_of_two_floors() {
        let file = FmlFile::from_value(&project(), "studio").unwrap();
        let storeys = file.storeys();
        assert_eq!(storeys.len(), 2);
        assert_eq!(
            (
                storeys[0].spaces,
                storeys[0].doors,
                storeys[0].windows,
                storeys[0].furniture
            ),
            (2, 1, 1, 1)
        );
        assert_eq!(
            (
                storeys[1].name.as_str(),
                storeys[1].elevation,
                storeys[1].spaces
            ),
            ("Attic", 260.0, 1)
        );
        let (plan, report, _) = file.convert(0).unwrap();
        domotwin_core::plan::read_plan_value(&plan).unwrap();
        assert_eq!(plan["name"], "Studio – Ground floor");
        assert_eq!(plan["rooms"][0]["name"], "Living room");
        assert_eq!(plan["rooms"][1]["name"], "Bedroom");
        assert_eq!(
            (
                report.rooms,
                report.doors,
                report.windows,
                report.furniture,
                report.skipped_spaces
            ),
            (2, 1, 1, 1, 1),
            "{plan:#}"
        );
        assert_eq!(plan["wallThickness"]["interior"], 10.0);
        assert_eq!(plan["items"][0]["kind"], "sofa");
        assert_eq!(plan["items"][0]["rotation"], 90.0);
        // The door in the partition, 83 cm wide, centred on it.
        let from: P2 = serde_json::from_value(plan["doors"][0]["from"].clone()).unwrap();
        let to: P2 = serde_json::from_value(plan["doors"][0]["to"].clone()).unwrap();
        assert!(
            (from[0] - to[0]).abs() < 0.5 && ((from[1] + to[1]) / 2.0 - 140.0).abs() < 1.0,
            "{from:?} {to:?}"
        );
        // The attic, from its walls.
        let (attic, _, _) = file.convert(1).unwrap();
        assert_eq!(attic["rooms"].as_array().unwrap().len(), 1);
        assert_eq!(file.convert(2).err(), Some("no_storeys"));
    }

    #[test]
    fn what_is_not_a_project() {
        assert!(!is_fml(json!({ "floors": [] }).as_object().unwrap()));
        assert!(is_fml(
            json!({ "project": { "floors": [{ "designs": [] }] } })
                .as_object()
                .unwrap()
        ));
        assert_eq!(
            FmlFile::from_value(&json!({ "floors": [{ "designs": [] }] }), "x").err(),
            Some("not_plan")
        );
        assert!(is_fml_xml(
            "<?xml version=\"1.0\"?>\n<project><floors><floor>"
        ));
        assert!(!is_fml_xml("<svg></svg>"));
    }
}
