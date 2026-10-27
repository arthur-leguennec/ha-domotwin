//! Sweet Home 3D homes (`.sh3d`): a ZIP archive whose `Home.xml` (written since Sweet Home 3D 5.3)
//! describes the levels, walls, rooms, doors and windows, pieces and lights in centimetres, `x`
//! to the right and `y` down the plan, angles in radians clockwise: the plan format's own frame.
//! Each level is a storey; rooms are drawn inside their walls, so the builder closes the gaps
//! between them. A level drawn with walls only gets its rooms from the walls (`faces`).

use domotwin_models::xml::{Event, Reader, Tag};
use domotwin_models::zip::Archive;
use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftPiece, DraftRoom, Report, WallHint, degrees};
use crate::convert::Storey;
use crate::faces;
use crate::kinds;
use crate::math::P2;

/// Most elements read from the file.
const MAX_ELEMENTS: usize = 20_000;
/// Most corners of a room read.
const MAX_POINTS: usize = 1_000;

/// A level of the home.
#[derive(Debug, Clone, PartialEq)]
struct Level {
    id: String,
    name: String,
    /// Height of its floor (cm).
    elevation: f64,
    /// Its order among levels at the same elevation.
    index: i64,
}

#[derive(Debug, Clone, PartialEq)]
struct Wall {
    level: Option<String>,
    from: P2,
    to: P2,
    thickness: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct Room {
    /// Its id in the home (written since Sweet Home 3D 6.4), else empty.
    id: String,
    level: Option<String>,
    name: String,
    points: Vec<P2>,
}

/// A piece, a light, a door or a window.
#[derive(Debug, Clone, PartialEq)]
struct Piece {
    /// Its id in the home, else empty.
    id: String,
    level: Option<String>,
    name: String,
    catalog: String,
    opening: bool,
    lamp: bool,
    centre: P2,
    /// Width, depth and height (cm).
    size: [f64; 3],
    elevation: f64,
    /// Radians, clockwise on the plan.
    angle: f64,
    mirrored: bool,
    /// The first sash of a door or a window: where its hinge is across the width (cm from the
    /// left) and the angle its leaf opens to (radians).
    sash: Option<(f64, f64)>,
}

/// A Sweet Home 3D home, read.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sh3dFile {
    title: String,
    levels: Vec<Level>,
    walls: Vec<Wall>,
    rooms: Vec<Room>,
    pieces: Vec<Piece>,
}

fn number(tag: &Tag<'_>, name: &str) -> Option<f64> {
    tag.attr(name)
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite())
}

fn text(tag: &Tag<'_>, name: &str) -> String {
    tag.attr(name)
        .map(|v| v.trim().chars().take(100).collect())
        .unwrap_or_default()
}

impl Sh3dFile {
    /// Reads a home from the bytes of a `.sh3d` file; `title` names it (the file's name).
    ///
    /// # Errors
    ///
    /// `not_plan` for an archive that is not a home, `sh3d_old` for a home saved before Sweet
    /// Home 3D 5.3 (no `Home.xml`), `too_large` past the readers' limits.
    pub fn read(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        let archive = Archive::new(bytes).map_err(|_| "not_plan")?;
        if !archive.has("Home.xml") {
            return Err(if archive.has("Home") {
                "sh3d_old"
            } else {
                "not_plan"
            });
        }
        let xml = archive.read("Home.xml").map_err(|e| match e {
            domotwin_models::Error::TooLarge => "too_large",
            _ => "not_plan",
        })?;
        Self::from_xml(&xml, title)
    }

    /// Reads a home from its `Home.xml`.
    ///
    /// # Errors
    ///
    /// `not_plan` for a document that is not a home, `too_large` past 20 000 elements.
    pub fn from_xml(xml: &[u8], title: &str) -> Result<Self, &'static str> {
        let mut reader = Reader::new(xml).map_err(|_| "not_plan")?;
        let mut home = Sh3dFile {
            title: title.chars().take(100).collect(),
            ..Self::default()
        };
        let mut root = false;
        // The level of the furniture group being read, and the room or opening being read.
        let mut groups: Vec<Option<String>> = Vec::new();
        let mut room: Option<Room> = None;
        let mut opening: Option<Piece> = None;
        let mut count = 0_usize;
        while let Some(event) = reader.next_event().map_err(|_| "not_plan")? {
            match event {
                Event::Start(tag) => {
                    count += 1;
                    if count > MAX_ELEMENTS {
                        return Err("too_large");
                    }
                    if !root {
                        if tag.name != "home" {
                            return Err("not_plan");
                        }
                        root = true;
                        continue;
                    }
                    let level = tag
                        .attr("level")
                        .map(str::to_owned)
                        .or_else(|| groups.last().cloned().flatten());
                    match tag.name {
                        "level" => {
                            if let Some(id) = tag.attr("id") {
                                home.levels.push(Level {
                                    id: id.to_owned(),
                                    name: text(&tag, "name"),
                                    elevation: number(&tag, "elevation").unwrap_or(0.0),
                                    #[allow(clippy::cast_possible_truncation)]
                                    index: number(&tag, "elevationIndex").unwrap_or(0.0) as i64,
                                });
                            }
                        }
                        "wall" => {
                            let at = |x: &str, y: &str| Some([number(&tag, x)?, number(&tag, y)?]);
                            if let (Some(from), Some(to)) =
                                (at("xStart", "yStart"), at("xEnd", "yEnd"))
                            {
                                home.walls.push(Wall {
                                    level,
                                    from,
                                    to,
                                    thickness: number(&tag, "thickness").unwrap_or(10.0),
                                });
                            }
                        }
                        "room" => {
                            let started = Room {
                                id: text(&tag, "id"),
                                level,
                                name: text(&tag, "name"),
                                points: Vec::new(),
                            };
                            if tag.empty {
                                home.rooms.push(started);
                            } else {
                                room = Some(started);
                            }
                        }
                        "point" => {
                            if let (Some(room), Some(x), Some(y)) =
                                (room.as_mut(), number(&tag, "x"), number(&tag, "y"))
                                && room.points.len() < MAX_POINTS
                            {
                                room.points.push([x, y]);
                            }
                        }
                        "furnitureGroup" => {
                            if !tag.empty {
                                groups.push(level);
                            }
                        }
                        "pieceOfFurniture" | "light" | "doorOrWindow" => {
                            if tag.attr("visible") == Some("false") {
                                continue;
                            }
                            let size = [
                                number(&tag, "width").unwrap_or(0.0),
                                number(&tag, "depth").unwrap_or(0.0),
                                number(&tag, "height").unwrap_or(0.0),
                            ];
                            let (Some(x), Some(y)) = (number(&tag, "x"), number(&tag, "y")) else {
                                continue;
                            };
                            let piece = Piece {
                                id: text(&tag, "id"),
                                level,
                                name: text(&tag, "name"),
                                catalog: text(&tag, "catalogId"),
                                opening: tag.name == "doorOrWindow",
                                lamp: tag.name == "light",
                                centre: [x, y],
                                size,
                                elevation: number(&tag, "elevation").unwrap_or(0.0),
                                angle: number(&tag, "angle").unwrap_or(0.0),
                                mirrored: tag.attr("modelMirrored") == Some("true"),
                                sash: None,
                            };
                            if piece.opening && !tag.empty {
                                opening = Some(piece);
                            } else {
                                home.pieces.push(piece);
                            }
                        }
                        "sash" => {
                            if let Some(o) = opening.as_mut()
                                && o.sash.is_none()
                            {
                                o.sash = number(&tag, "xAxis")
                                    .map(|x| (x, number(&tag, "endAngle").unwrap_or(0.0)));
                            }
                        }
                        _ => {}
                    }
                }
                Event::End(name) => match name {
                    "room" => home.rooms.extend(room.take()),
                    "doorOrWindow" => home.pieces.extend(opening.take()),
                    "furnitureGroup" => {
                        groups.pop();
                    }
                    _ => {}
                },
            }
        }
        if !root {
            return Err("not_plan");
        }
        home.levels.sort_by(|a, b| {
            a.elevation
                .total_cmp(&b.elevation)
                .then(a.index.cmp(&b.index))
        });
        Ok(home)
    }

    /// The level of storey `id` (its index among the levels, lowest first); `None` for a home
    /// without levels (storey 0).
    fn level(&self, id: u32) -> Result<Option<&Level>, &'static str> {
        if self.levels.is_empty() {
            return if id == 0 { Ok(None) } else { Err("no_storeys") };
        }
        self.levels.get(id as usize).map(Some).ok_or("no_storeys")
    }

    /// Whether an element of level `of` is on `level` (elements without a level are on the
    /// lowest one).
    fn on(&self, level: Option<&Level>, of: Option<&String>) -> bool {
        match (level, of) {
            (None, _) => true,
            (Some(l), Some(of)) => *of == l.id,
            (Some(l), None) => self.levels.first().is_some_and(|first| first.id == l.id),
        }
    }

    /// The rooms the walls of a level enclose, inside them.
    fn wall_rooms(&self, level: Option<&Level>) -> Vec<Vec<P2>> {
        let segments: Vec<(P2, P2, f64)> = self
            .walls
            .iter()
            .filter(|w| self.on(level, w.level.as_ref()))
            .map(|w| (w.from, w.to, w.thickness))
            .collect();
        faces::rooms_between_walls(&segments)
    }

    /// The storeys: the levels, lowest first (one storey for a home without levels).
    pub fn storeys(&self) -> Vec<Storey> {
        let ground = self
            .levels
            .iter()
            .map(|l| l.elevation)
            .min_by(|a, b| a.abs().total_cmp(&b.abs()))
            .unwrap_or(0.0);
        let count = |level: Option<&Level>| {
            let rooms = self
                .rooms
                .iter()
                .filter(|r| self.on(level, r.level.as_ref()) && r.points.len() >= 3)
                .count();
            let walls = self.walls.iter().any(|w| self.on(level, w.level.as_ref()));
            let pieces = self
                .pieces
                .iter()
                .filter(|p| self.on(level, p.level.as_ref()));
            let (mut doors, mut windows, mut furniture) = (0, 0, 0);
            for p in pieces {
                match (p.opening, is_door(p)) {
                    (true, true) => doors += 1,
                    (true, false) => windows += 1,
                    _ => furniture += 1,
                }
            }
            // Rooms from the walls when none is drawn.
            let spaces = if rooms == 0 && walls {
                self.wall_rooms(level).len()
            } else {
                rooms
            };
            (spaces, doors, windows, furniture)
        };
        if self.levels.is_empty() {
            let (spaces, doors, windows, furniture) = count(None);
            return vec![Storey {
                id: 0,
                name: String::new(),
                elevation: 0.0,
                spaces,
                doors,
                windows,
                furniture,
            }];
        }
        self.levels
            .iter()
            .enumerate()
            .map(|(i, level)| {
                let (spaces, doors, windows, furniture) = count(Some(level));
                Storey {
                    id: u32::try_from(i).unwrap_or(u32::MAX),
                    name: level.name.clone(),
                    elevation: ((level.elevation - ground) * 10.0).round() / 10.0,
                    spaces,
                    doors,
                    windows,
                    furniture,
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
        let level = self.level(id)?;
        let name = match level {
            Some(l) if self.levels.len() > 1 && !l.name.is_empty() => {
                format!("{} – {}", self.title, l.name)
            }
            _ => self.title.clone(),
        };
        let mut draft = Draft {
            name: name.chars().take(100).collect(),
            ..Draft::default()
        };
        let walls: Vec<&Wall> = self
            .walls
            .iter()
            .filter(|w| self.on(level, w.level.as_ref()))
            .collect();
        draft.walls = walls
            .iter()
            .filter(|w| w.thickness > 0.5 && w.thickness < 150.0)
            .map(|w| WallHint {
                thickness: w.thickness,
                external: None,
            })
            .collect();
        for (k, room) in self
            .rooms
            .iter()
            .filter(|r| self.on(level, r.level.as_ref()))
            .enumerate()
        {
            if room.points.len() < 3 {
                draft.report.skipped_spaces += 1;
                continue;
            }
            draft.rooms.push(DraftRoom {
                id: own_id(&room.id, || format!("room-{}", k + 1)),
                name: room.name.clone(),
                points: room.points.clone(),
                floor: None,
            });
        }
        if draft.rooms.is_empty() {
            // Walls only: the rooms they enclose, inside them.
            for (k, points) in self.wall_rooms(level).into_iter().enumerate() {
                draft.rooms.push(DraftRoom {
                    id: format!("room-{}", k + 1),
                    name: String::new(),
                    points,
                    floor: None,
                });
            }
        }
        let (mut doors, mut windows, mut pieces) = (0, 0, 0);
        for piece in self
            .pieces
            .iter()
            .filter(|p| self.on(level, p.level.as_ref()))
        {
            let (cos, sin) = (piece.angle.cos(), piece.angle.sin());
            if piece.opening {
                let door = is_door(piece);
                let id = if door {
                    doors += 1;
                    own_id(&piece.id, || format!("door-{doors}"))
                } else {
                    windows += 1;
                    own_id(&piece.id, || format!("window-{windows}"))
                };
                // Its sash: the side its hinge is on and the side its leaf opens to, in its own
                // frame (y towards its front), then mirrored when its model is.
                let (hinge_right, opens_back) = match piece.sash {
                    Some((x, end)) => {
                        let right = x > piece.size[0] / 2.0;
                        let towards = if right { -end.sin() } else { end.sin() };
                        (right, towards < 0.0)
                    }
                    None => (false, false),
                };
                let right = hinge_right != piece.mirrored;
                let front = [-sin, cos];
                draft.openings.push(DraftOpening {
                    id,
                    name: piece.name.clone(),
                    door,
                    centre: piece.centre,
                    along: [cos, sin],
                    opens: if opens_back {
                        [-front[0], -front[1]]
                    } else {
                        front
                    },
                    width: piece.size[0],
                    right,
                    style: None,
                });
                continue;
            }
            if piece.size[0] < 1.0
                || piece.size[1] < 1.0
                || piece.size[0] > 10_000.0
                || piece.size[1] > 10_000.0
            {
                draft.report.skipped_furniture += 1;
                continue;
            }
            pieces += 1;
            let names = [piece.name.as_str(), piece.catalog.as_str()];
            draft.pieces.push(DraftPiece {
                id: own_id(&piece.id, || format!("piece-{pieces}")),
                name: piece.name.clone(),
                kind: kinds::kind_by_name(&names, piece.size, piece.elevation.max(0.0), piece.lamp),
                centre: piece.centre,
                size: piece.size,
                angle: degrees([cos, sin]),
                elevation: piece.elevation.max(0.0),
                card: None,
            });
        }
        build::build(draft)
    }
}

/// The home's own id of an element, else one by its place in the home. Its own keeps the
/// bindings when an updated home is imported again (as an IFC file's `GlobalId`s, D-018).
fn own_id(id: &str, by_place: impl FnOnce() -> String) -> String {
    if id.is_empty() {
        by_place()
    } else {
        id.to_owned()
    }
}

/// Whether a door or a window is a door: by its name or catalogue id, else by its shape (from
/// the floor, and as tall as a person).
fn is_door(piece: &Piece) -> bool {
    let named = |words: &[&str]| {
        let text = format!("{} {}", piece.name, piece.catalog).to_lowercase();
        words.iter().any(|w| text.contains(w))
    };
    if named(&[
        "window", "fenêtre", "fenetre", "fenster", "ventana", "finestra", "velux",
    ]) {
        return false;
    }
    if named(&[
        "door", "porte", "tür", "tuer", "puerta", "porta", "gate", "portail",
    ]) {
        return true;
    }
    piece.elevation < 30.0 && piece.size[2] >= 170.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = r#"<?xml version='1.0'?>
<home version='7200' name='/somewhere/house.sh3d' wallHeight='250.0'>
  <level id='level0' name='Ground floor' elevation='0.0' floorThickness='12.0' height='250.0' elevationIndex='0'/>
  <level id='level1' name='Upstairs' elevation='262.0' floorThickness='12.0' height='250.0' elevationIndex='0'/>
  <wall id='w1' level='level0' xStart='0' yStart='0' xEnd='600' yEnd='0' thickness='20'/>
  <wall id='w2' level='level0' xStart='600' yStart='0' xEnd='600' yEnd='400' thickness='20'/>
  <wall id='w3' level='level0' xStart='600' yStart='400' xEnd='0' yEnd='400' thickness='20'/>
  <wall id='w4' level='level0' xStart='0' yStart='400' xEnd='0' yEnd='0' thickness='20'/>
  <wall id='w5' level='level0' xStart='350' yStart='0' xEnd='350' yEnd='400' thickness='10'/>
  <room id='r1' level='level0' name='Living room'>
    <point x='10' y='10'/><point x='345' y='10'/><point x='345' y='390'/><point x='10' y='390'/>
  </room>
  <room id='r2' level='level0' name='Bedroom'>
    <point x='355' y='10'/><point x='590' y='10'/><point x='590' y='390'/><point x='355' y='390'/>
  </room>
  <doorOrWindow id='d1' level='level0' catalogId='eTeks#door' name='Door' x='350' y='200' elevation='0' angle='1.5707964' width='90' depth='10' height='210'>
    <sash xAxis='5' yAxis='5' width='80' startAngle='0' endAngle='-1.5707964'/>
  </doorOrWindow>
  <doorOrWindow id='w' level='level0' catalogId='eTeks#window' name='Window' x='150' y='0' elevation='90' angle='0' width='120' depth='20' height='120'/>
  <pieceOfFurniture id='p1' level='level0' catalogId='eTeks#bed140x190' name='Double bed' x='470' y='200' elevation='0' angle='0' width='140' depth='190' height='70'/>
  <furnitureGroup id='g' level='level0' name='Living' x='150' y='200' width='200' depth='100' height='80'>
    <pieceOfFurniture id='p2' catalogId='eTeks#sofa' name='Sofa' x='150' y='300' elevation='0' angle='3.1415927' width='200' depth='90' height='80'/>
    <light id='l1' catalogId='eTeks#lamp' name='Lamp' x='60' y='60' elevation='0' angle='0' width='40' depth='40' height='160' power='0.5'/>
  </furnitureGroup>
  <pieceOfFurniture id='p3' name='Hidden' x='10' y='10' width='10' depth='10' height='10' visible='false'/>
  <wall id='u1' level='level1' xStart='0' yStart='0' xEnd='400' yEnd='0' thickness='20'/>
  <wall id='u2' level='level1' xStart='400' yStart='0' xEnd='400' yEnd='300' thickness='20'/>
  <wall id='u3' level='level1' xStart='400' yStart='300' xEnd='0' yEnd='300' thickness='20'/>
  <wall id='u4' level='level1' xStart='0' yStart='300' xEnd='0' yEnd='0' thickness='20'/>
</home>"#;

    #[test]
    fn levels_are_storeys_with_their_rooms_openings_and_pieces() {
        let home = Sh3dFile::from_xml(HOME.as_bytes(), "House").unwrap();
        let storeys = home.storeys();
        assert_eq!(storeys.len(), 2);
        assert_eq!(
            (
                storeys[0].spaces,
                storeys[0].doors,
                storeys[0].windows,
                storeys[0].furniture
            ),
            (2, 1, 1, 3)
        );
        assert_eq!(storeys[1].elevation, 262.0);
        let (plan, report, cards) = home.convert(0).unwrap();
        assert!(cards.is_empty());
        assert_eq!(
            (report.rooms, report.doors, report.windows, report.furniture),
            (2, 1, 1, 3)
        );
        assert_eq!(plan["name"], "House – Ground floor");
        // The two rooms meet in the middle of the partition: one wall between them, 10 cm.
        let rooms = plan["rooms"].as_array().unwrap();
        assert_eq!(rooms[0]["name"], "Living room");
        assert_eq!(plan["wallThickness"]["interior"], 10.0);
        let right = rooms[0]["outline"].as_array().unwrap()[1][0]
            .as_f64()
            .unwrap();
        let left = rooms[1]["outline"].as_array().unwrap()[0][0]
            .as_f64()
            .unwrap();
        assert_eq!(right, left);
        // The door is in the partition, the window in the façade.
        assert!(plan["doors"][0]["room"].is_string());
        assert_eq!(plan["windows"][0]["from"][1], 0.0);
        let kinds: Vec<&str> = plan["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["bed", "sofa", "floor-lamp"]);
        assert_eq!(plan["items"][1]["rotation"], 180.0);
        // The plan reads.
        domotwin_core::plan::read_plan_value(&plan).unwrap();
    }

    #[test]
    fn a_level_of_walls_only_gets_its_rooms_from_them() {
        let home = Sh3dFile::from_xml(HOME.as_bytes(), "House").unwrap();
        assert_eq!(home.storeys()[1].spaces, 1);
        let (plan, report, _) = home.convert(1).unwrap();
        assert_eq!(report.rooms, 1);
        // Inside the walls: 10 cm in from their centre lines.
        assert_eq!(
            plan["rooms"][0]["outline"],
            serde_json::json!([[0.0, 0.0], [380.0, 0.0], [380.0, 280.0], [0.0, 280.0]])
        );
    }

    #[test]
    fn partitions_ending_at_a_wall_face_and_open_levels() {
        // A 600 × 400 box of 20 cm walls, a partition ending at the façades' inner faces (as
        // Sweet Home 3D's magnetism draws it); a terrace level with two walls enclosing nothing.
        let xml = br#"<home version='7200'>
  <level id='g' name='Ground floor' elevation='0'/>
  <level id='t' name='Terrace' elevation='262'/>
  <wall level='g' xStart='0' yStart='0' xEnd='600' yEnd='0' thickness='20'/>
  <wall level='g' xStart='600' yStart='0' xEnd='600' yEnd='400' thickness='20'/>
  <wall level='g' xStart='600' yStart='400' xEnd='0' yEnd='400' thickness='20'/>
  <wall level='g' xStart='0' yStart='400' xEnd='0' yEnd='0' thickness='20'/>
  <wall level='g' xStart='350' yStart='10' xEnd='350' yEnd='390' thickness='10'/>
  <wall level='t' xStart='0' yStart='0' xEnd='400' yEnd='0' thickness='10'/>
  <wall level='t' xStart='400' yStart='0' xEnd='400' yEnd='300' thickness='10'/>
</home>"#;
        let home = Sh3dFile::from_xml(xml, "Home").unwrap();
        let storeys = home.storeys();
        assert_eq!((storeys[0].spaces, storeys[1].spaces), (2, 0));
        let (plan, report, _) = home.convert(0).unwrap();
        assert_eq!(report.rooms, 2, "{plan}");
    }

    #[test]
    fn what_is_not_a_home_is_refused() {
        assert_eq!(Sh3dFile::from_xml(b"<plan/>", "x"), Err("not_plan"));
        assert_eq!(Sh3dFile::from_xml(b"not xml", "x"), Err("not_plan"));
        assert_eq!(Sh3dFile::read(b"PK\x03\x04", "x"), Err("not_plan"));
        let home = Sh3dFile::from_xml(b"<home/>", "Empty").unwrap();
        assert_eq!(home.storeys()[0].spaces, 0);
        assert_eq!(home.convert(0), Err("no_spaces"));
        assert_eq!(home.convert(1), Err("no_storeys"));
    }
}
