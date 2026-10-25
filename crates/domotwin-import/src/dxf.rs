//! DXF drawings (ASCII, AutoCAD R12 to 2018): a plan drawn as lines, with blocks for the doors,
//! windows and furniture. What is what comes from the names of layers and blocks (English,
//! French, German and Spanish words), the units from `$INSUNITS` (or the drawing's size):
//!
//! - rooms are the closed polylines of a room layer, else the faces the walls make, the doors
//!   closing their gaps (thin faces, between the two lines of a wall, are left out);
//! - a room's name is the text inside it;
//! - doors are found from their swing (an arc: the leaf turns about its centre, its closed end is
//!   the arc's end without a line to it); windows and pieces from their block's extent.
//!
//! DXF's `y` points up: the plan's is `-y`.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value as Json};

use crate::build::{self, Draft, DraftOpening, DraftPiece, DraftRoom, Report, degrees};
use crate::convert::Storey;
use crate::faces;
use crate::kinds;
use crate::math::{P2, point_in_polygon, signed_area2};

/// Most entities read, blocks expanded.
const MAX_ENTITIES: usize = 200_000;
/// Deepest nesting of blocks expanded.
const MAX_DEPTH: usize = 8;
/// Faces narrower than this (cm) are walls, not rooms: old stone walls are up to 60 cm thick.
const MIN_ROOM_WIDTH: f64 = 65.0;

/// An entity as read, in the drawing's units and `y` up.
#[derive(Debug, Clone, PartialEq)]
enum Raw {
    Line {
        layer: String,
        a: P2,
        b: P2,
    },
    Poly {
        layer: String,
        points: Vec<P2>,
        closed: bool,
    },
    Arc {
        layer: String,
        centre: P2,
        radius: f64,
        /// Degrees, counter-clockwise.
        from: f64,
        to: f64,
    },
    Insert {
        layer: String,
        block: String,
        at: P2,
        scale: P2,
        /// Degrees, counter-clockwise.
        rotation: f64,
    },
    Text {
        layer: String,
        at: P2,
        text: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Block {
    base: P2,
    entities: Vec<Raw>,
}

/// What a layer or a block holds, from its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Wall,
    Door,
    Window,
    Furniture,
    Room,
    Ignored,
    Other,
}

/// Words for rooms in layer names.
const ROOM_WORDS: &[&str] = &[
    "room", "space", "piece", "pièce", "raum", "zone", "area", "local",
];

/// Whether the texts of a layer may name rooms: not notes, dimensions or titles, but a room
/// layer even among the annotations (`A-ANNO-ROOM`).
fn names_rooms(layer: &str) -> bool {
    let lower = layer.to_lowercase();
    role(layer) != Role::Ignored || ROOM_WORDS.iter().any(|w| lower.contains(w))
}

fn role(name: &str) -> Role {
    // Words holding another one: a load-bearing wall (`porteur`) is no door, nor is outdoor.
    let lower = ["porteur", "porteuse", "outdoor", "indoor"]
        .iter()
        .fold(name.to_lowercase(), |s, w| s.replace(w, " "));
    let any = |words: &[&str]| words.iter().any(|w| lower.contains(w));
    if any(&[
        "dim",
        "cote",
        "cota",
        "bemass",
        "hatch",
        "hachur",
        "grid",
        "axis",
        "axe",
        "defpoints",
        "anno",
        "title",
        "cartouche",
    ]) {
        Role::Ignored
    } else if any(&[
        "window", "fenetre", "fenêtre", "fenster", "ventana", "glaz", "vitr",
    ]) {
        Role::Window
    } else if any(&["door", "porte", "tür", "tuer", "puerta"]) {
        Role::Door
    } else if any(&[
        "furn", "mobil", "möbel", "mobel", "mueble", "equip", "sanit", "kitchen", "cuisine",
    ]) {
        Role::Furniture
    } else if any(ROOM_WORDS) {
        Role::Room
    } else if any(&[
        "wall",
        "mur",
        "wand",
        "muro",
        "mauer",
        "cloison",
        "partition",
    ]) {
        Role::Wall
    } else {
        Role::Other
    }
}

/// The drawing's text: UTF-8 (R2007 and later, read in place), else Windows-1252 bytes taken
/// as Latin-1; without the byte-order mark some editors add.
fn decode(bytes: &[u8]) -> Cow<'_, str> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => Cow::Borrowed(text),
        Err(_) => Cow::Owned(bytes.iter().map(|&b| char::from(b)).collect()),
    }
}

/// A text without DXF's escapes and MTEXT formatting (`\P`, `{\fArial|b0;…}`, `\U+00E9`).
fn plain(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' | '}' => {}
            '\\' => match chars.next() {
                Some('P' | 'p' | 'X' | 'x') => out.push(' '),
                Some('U' | 'u') if chars.peek() == Some(&'+') => {
                    chars.next();
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Some(c) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                        out.push(c);
                    }
                }
                Some('\\') => out.push('\\'),
                Some('~') => out.push(' '),
                // Codes with a value up to `;` (`\f…;`, `\H…;`, `\C…;`…) and simple switches.
                Some(_) => {
                    let rest: String = chars.clone().take(60).collect();
                    if let Some(end) = rest.find(';') {
                        for _ in 0..=end {
                            chars.next();
                        }
                    }
                }
                None => {}
            },
            '%' if chars.peek() == Some(&'%') => {
                chars.next();
                // `%%c` (⌀), `%%d` (°), `%%p` (±), `%%u`/`%%o` (underline, overline).
                match chars.next() {
                    Some('d' | 'D') => out.push('°'),
                    Some('p' | 'P') => out.push('±'),
                    Some('c' | 'C') => out.push('⌀'),
                    _ => {}
                }
            }
            c => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The (code, value) pairs of an ASCII DXF file.
fn pairs(text: &str) -> Result<Vec<(i32, &str)>, &'static str> {
    let mut lines = text.lines();
    let mut out = Vec::new();
    while let Some(code) = lines.next() {
        let code = code.trim();
        if code.is_empty() && out.is_empty() {
            continue;
        }
        let code: i32 = code.parse().map_err(|_| "not_plan")?;
        let value = lines.next().ok_or("not_plan")?;
        out.push((code, value.trim_end_matches('\r')));
        // What follows the end (a blank line, an end-of-file character) is not the drawing's.
        if code == 0 && value.trim() == "EOF" {
            break;
        }
        if out.len() > MAX_ENTITIES * 40 {
            return Err("too_large");
        }
    }
    Ok(out)
}

fn float(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Reads the entities from `at` (the pair after a `0 ENTITY`) until the next `0`.
struct Fields<'a> {
    pairs: &'a [(i32, &'a str)],
}

impl Fields<'_> {
    fn get(&self, code: i32) -> Option<&str> {
        self.pairs.iter().find(|(c, _)| *c == code).map(|(_, v)| *v)
    }

    fn num(&self, code: i32) -> Option<f64> {
        self.get(code).and_then(float)
    }

    fn layer(&self) -> String {
        self.get(8).unwrap_or("0").trim().to_owned()
    }

    fn point(&self, x: i32, y: i32) -> Option<P2> {
        Some([self.num(x)?, self.num(y)?])
    }
}

/// The entities of a list of pairs (a section's or a block's), and the blocks defined there.
fn entities(pairs: &[(i32, &str)]) -> Vec<Raw> {
    let mut out = Vec::new();
    let mut i = 0;
    // An old-style polyline being read (its vertices follow it).
    let mut polyline: Option<(String, Vec<P2>, bool, bool)> = None;
    while i < pairs.len() {
        if pairs[i].0 != 0 {
            i += 1;
            continue;
        }
        let kind = pairs[i].1.trim();
        let end = pairs[i + 1..]
            .iter()
            .position(|(c, _)| *c == 0)
            .map_or(pairs.len(), |k| i + 1 + k);
        let f = Fields {
            pairs: &pairs[i + 1..end],
        };
        // Paper space (layouts, their frames and titles) is not the plan.
        if f.get(67).is_some_and(|v| v.trim() == "1") {
            i = end;
            continue;
        }
        // Seen from below (extrusion `0 0 -1`, what mirroring an arc or a polyline gives): its
        // own x is the world's −x.
        let flip = f.num(230).is_some_and(|z| z < 0.0);
        let x = |p: P2| if flip { [-p[0], p[1]] } else { p };
        match kind {
            "LINE" => {
                if let (Some(a), Some(b)) = (f.point(10, 20), f.point(11, 21)) {
                    out.push(Raw::Line {
                        layer: f.layer(),
                        a,
                        b,
                    });
                }
            }
            "LWPOLYLINE" => {
                let xs = f
                    .pairs
                    .iter()
                    .filter(|(c, _)| *c == 10)
                    .filter_map(|(_, v)| float(v));
                let ys = f
                    .pairs
                    .iter()
                    .filter(|(c, _)| *c == 20)
                    .filter_map(|(_, v)| float(v));
                let points: Vec<P2> = xs.zip(ys).map(|(a, b)| x([a, b])).collect();
                #[allow(clippy::cast_possible_truncation)]
                let flags = f.num(70).unwrap_or(0.0) as i64;
                if points.len() >= 2 {
                    out.push(Raw::Poly {
                        layer: f.layer(),
                        points,
                        closed: flags & 1 == 1,
                    });
                }
            }
            "POLYLINE" => {
                #[allow(clippy::cast_possible_truncation)]
                let flags = f.num(70).unwrap_or(0.0) as i64;
                polyline = Some((f.layer(), Vec::new(), flags & 1 == 1, flip));
            }
            "VERTEX" => {
                if let (Some((_, points, _, flipped)), Some(p)) =
                    (polyline.as_mut(), f.point(10, 20))
                {
                    points.push(if *flipped { [-p[0], p[1]] } else { p });
                }
            }
            "SEQEND" => {
                if let Some((layer, points, closed, _)) = polyline.take()
                    && points.len() >= 2
                {
                    out.push(Raw::Poly {
                        layer,
                        points,
                        closed,
                    });
                }
            }
            "ARC" => {
                if let (Some(centre), Some(radius), Some(from), Some(to)) =
                    (f.point(10, 20), f.num(40), f.num(50), f.num(51))
                {
                    // Counter-clockwise from below is clockwise from above.
                    let (from, to) = if flip {
                        (180.0 - to, 180.0 - from)
                    } else {
                        (from, to)
                    };
                    out.push(Raw::Arc {
                        layer: f.layer(),
                        centre: x(centre),
                        radius,
                        from,
                        to,
                    });
                }
            }
            // A whole circle (a round table, a column): an arc all the way round.
            "CIRCLE" => {
                if let (Some(centre), Some(radius)) = (f.point(10, 20), f.num(40)) {
                    out.push(Raw::Arc {
                        layer: f.layer(),
                        centre: x(centre),
                        radius,
                        from: 0.0,
                        to: 360.0,
                    });
                }
            }
            "INSERT" => {
                if let (Some(block), Some(at)) = (f.get(2), f.point(10, 20)) {
                    let (sx, rotation) = (f.num(41).unwrap_or(1.0), f.num(50).unwrap_or(0.0));
                    out.push(Raw::Insert {
                        layer: f.layer(),
                        block: block.trim().to_owned(),
                        at: x(at),
                        // Mirrored: its rotation turns the other way.
                        scale: [if flip { -sx } else { sx }, f.num(42).unwrap_or(1.0)],
                        rotation: if flip { -rotation } else { rotation },
                    });
                }
            }
            "TEXT" | "MTEXT" => {
                let mut text = String::new();
                // MTEXT: its chunks (3) then its end (1).
                for (c, v) in f.pairs {
                    if *c == 3 || *c == 1 {
                        text.push_str(v);
                    }
                }
                if let Some(at) = f.point(10, 20) {
                    let text = plain(&text);
                    if !text.is_empty() {
                        let at = if kind == "TEXT" { x(at) } else { at };
                        out.push(Raw::Text {
                            layer: f.layer(),
                            at,
                            text,
                        });
                    }
                }
            }
            _ => {}
        }
        if out.len() > MAX_ENTITIES {
            break;
        }
        i = end;
    }
    out
}

/// A placement: `world = at + R(rotation) · (scale ⊙ (p − base))`.
#[derive(Debug, Clone, Copy)]
struct Place {
    at: P2,
    base: P2,
    scale: P2,
    cos: f64,
    sin: f64,
}

impl Place {
    const IDENTITY: Place = Place {
        at: [0.0, 0.0],
        base: [0.0, 0.0],
        scale: [1.0, 1.0],
        cos: 1.0,
        sin: 0.0,
    };

    fn point(&self, p: P2) -> P2 {
        let (x, y) = (
            (p[0] - self.base[0]) * self.scale[0],
            (p[1] - self.base[1]) * self.scale[1],
        );
        [
            self.at[0] + x * self.cos - y * self.sin,
            self.at[1] + x * self.sin + y * self.cos,
        ]
    }

    /// The placement of an insert placed by this one.
    fn then(&self, insert: Place) -> Place {
        // Points go through `insert` then `self`: compose with the same form when `self` has a
        // uniform scale, mirrored or not (blocks in blocks), else approximately. Mirrored, `self`
        // turns the insert's rotation the other way.
        let at = self.point(insert.at);
        let s = [
            self.scale[0] * insert.scale[0],
            self.scale[1] * insert.scale[1],
        ];
        let sin = if self.scale[0] * self.scale[1] < 0.0 {
            -insert.sin
        } else {
            insert.sin
        };
        let (c, d) = (
            self.cos * insert.cos - self.sin * sin,
            self.sin * insert.cos + self.cos * sin,
        );
        Place {
            at,
            base: insert.base,
            scale: s,
            cos: c,
            sin: d,
        }
    }
}

/// An insert of a door, a window or a piece, with its block's entities in the world.
#[derive(Debug, Clone)]
struct Placed {
    role: Role,
    name: String,
    place: Place,
    /// Its block's extent in the block's own frame (scaled), and its lines and arcs (centre,
    /// radius, ends) in the world.
    extent: [P2; 2],
    lines: Vec<(P2, P2)>,
    arcs: Vec<(P2, f64, P2, P2)>,
}

/// A DXF drawing, read.
#[derive(Debug, Clone)]
pub struct DxfFile {
    draft: Draft,
}

impl DxfFile {
    /// Reads a drawing; `title` names it (the file's name).
    ///
    /// # Errors
    ///
    /// `not_plan` for a file that is not an ASCII DXF drawing, `dxf_binary` for a binary one,
    /// `too_large` past 200 000 entities.
    pub fn read(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        if bytes.starts_with(b"AutoCAD Binary DXF") {
            return Err("dxf_binary");
        }
        let text = decode(bytes);
        let pairs = pairs(&text)?;
        if !pairs.iter().any(|(c, v)| *c == 0 && v.trim() == "SECTION") {
            return Err("not_plan");
        }
        // Sections.
        let mut units = 0_i64;
        let mut blocks: HashMap<String, Block> = HashMap::new();
        let mut model: Vec<Raw> = Vec::new();
        let mut i = 0;
        while i < pairs.len() {
            if !(pairs[i] == (0, "SECTION") || (pairs[i].0 == 0 && pairs[i].1.trim() == "SECTION"))
            {
                i += 1;
                continue;
            }
            let name = pairs.get(i + 1).map(|(_, v)| v.trim()).unwrap_or_default();
            let end = pairs[i..]
                .iter()
                .position(|(c, v)| *c == 0 && v.trim() == "ENDSEC")
                .map_or(pairs.len(), |k| i + k);
            let section = pairs.get(i + 2..end.max(i + 2)).unwrap_or_default();
            match name {
                "HEADER" => {
                    if let Some(k) = section
                        .iter()
                        .position(|(c, v)| *c == 9 && v.trim() == "$INSUNITS")
                    {
                        #[allow(clippy::cast_possible_truncation)]
                        if let Some(v) = section.get(k + 1).and_then(|(_, v)| float(v)) {
                            units = v as i64;
                        }
                    }
                }
                "BLOCKS" => {
                    let mut k = 0;
                    while k < section.len() {
                        if !(section[k].0 == 0 && section[k].1.trim() == "BLOCK") {
                            k += 1;
                            continue;
                        }
                        let stop = section[k..]
                            .iter()
                            .position(|(c, v)| *c == 0 && v.trim() == "ENDBLK")
                            .map_or(section.len(), |e| k + e);
                        let head_end = section[k + 1..stop]
                            .iter()
                            .position(|(c, _)| *c == 0)
                            .map_or(stop, |e| k + 1 + e);
                        let head = Fields {
                            pairs: &section[k + 1..head_end],
                        };
                        if let Some(name) = head.get(2) {
                            blocks.insert(
                                name.trim().to_owned(),
                                Block {
                                    base: head.point(10, 20).unwrap_or([0.0, 0.0]),
                                    entities: entities(&section[head_end..stop]),
                                },
                            );
                        }
                        k = stop + 1;
                    }
                }
                "ENTITIES" => model = entities(section),
                _ => {}
            }
            i = end + 1;
        }
        let mut reading = Reading {
            blocks: &blocks,
            segments: Vec::new(),
            rooms: Vec::new(),
            placed: Vec::new(),
            texts: Vec::new(),
            count: 0,
            walls_named: false,
            skipped_pieces: 0,
            skipped_openings: 0,
        };
        // Whether any layer says it holds walls (in the drawing or the blocks it inserts, not in
        // blocks only defined): then only those are walls.
        let used = inserted(&blocks, &model);
        reading.walls_named = model
            .iter()
            .chain(
                used.iter()
                    .filter_map(|name| blocks.get(*name))
                    .flat_map(|b| &b.entities),
            )
            .any(|e| match e {
                Raw::Line { layer, .. } | Raw::Poly { layer, .. } => role(layer) == Role::Wall,
                _ => false,
            });
        reading.walk(&model, Place::IDENTITY, 0, Role::Other);
        let scale = scale(units, &reading.segments, &reading.rooms);
        Ok(DxfFile {
            draft: reading.draft(title, scale),
        })
    }

    /// The one storey of the drawing.
    pub fn storeys(&self) -> Vec<Storey> {
        let d = &self.draft;
        vec![Storey {
            id: 0,
            name: String::new(),
            elevation: 0.0,
            spaces: d.rooms.len(),
            doors: d.openings.iter().filter(|o| o.door).count(),
            windows: d.openings.iter().filter(|o| !o.door).count(),
            furniture: d.pieces.len(),
        }]
    }

    /// The plan of the drawing, what was left out, and no upkeep card.
    ///
    /// # Errors
    ///
    /// `no_storeys` for a storey other than 0, `no_spaces` when it has no room.
    pub fn convert(&self, id: u32) -> Result<(Json, Report, Map<String, Json>), &'static str> {
        if id != 0 {
            return Err("no_storeys");
        }
        build::build(self.draft.clone())
    }
}

/// Centimetres per drawing unit: from `$INSUNITS`, else from the drawing's size (a home is a few
/// metres to a few tens of metres across).
fn scale(units: i64, segments: &[(P2, P2)], rooms: &[(String, Vec<P2>)]) -> f64 {
    match units {
        1 => 2.54,
        2 => 30.48,
        4 => 0.1,
        5 => 1.0,
        6 => 100.0,
        14 => 10.0,
        _ => {
            let mut lo = [f64::INFINITY; 2];
            let mut hi = [f64::NEG_INFINITY; 2];
            for p in segments
                .iter()
                .flat_map(|(a, b)| [a, b])
                .chain(rooms.iter().flat_map(|(_, r)| r))
            {
                for k in 0..2 {
                    lo[k] = lo[k].min(p[k]);
                    hi[k] = hi[k].max(p[k]);
                }
            }
            let size = (hi[0] - lo[0]).max(hi[1] - lo[1]);
            if !size.is_finite() || size <= 0.0 {
                1.0
            } else if size > 4_000.0 {
                0.1
            } else if size < 150.0 {
                100.0
            } else {
                1.0
            }
        }
    }
}

struct Reading<'a> {
    blocks: &'a HashMap<String, Block>,
    /// Wall lines, closed room outlines (by layer), inserts of doors, windows and pieces, texts.
    segments: Vec<(P2, P2)>,
    rooms: Vec<(String, Vec<P2>)>,
    placed: Vec<Placed>,
    texts: Vec<(P2, String)>,
    count: usize,
    walls_named: bool,
    /// Inserts of pieces, doors and windows whose block draws nothing read.
    skipped_pieces: usize,
    skipped_openings: usize,
}

impl Reading<'_> {
    fn walk(&mut self, list: &[Raw], place: Place, depth: usize, inherited: Role) {
        for e in list {
            self.count += 1;
            if self.count > MAX_ENTITIES {
                return;
            }
            match e {
                Raw::Line { layer, a, b } => {
                    if self.is_wall(layer, inherited) {
                        self.segments.push((place.point(*a), place.point(*b)));
                    }
                }
                Raw::Poly {
                    layer,
                    points,
                    closed,
                } => {
                    let world: Vec<P2> = points.iter().map(|&p| place.point(p)).collect();
                    if *closed && role(layer) == Role::Room && world.len() >= 3 {
                        self.rooms.push((layer.clone(), world));
                    } else if self.is_wall(layer, inherited) {
                        let n = world.len();
                        let sides = if *closed { n } else { n - 1 };
                        for k in 0..sides {
                            self.segments.push((world[k], world[(k + 1) % n]));
                        }
                    }
                }
                // Notes, dimensions and titles do not name rooms.
                Raw::Text { layer, at, text } => {
                    if names_rooms(layer) {
                        self.texts.push((place.point(*at), text.clone()));
                    }
                }
                Raw::Arc { .. } => {}
                Raw::Insert {
                    layer,
                    block,
                    at,
                    scale,
                    rotation,
                } => {
                    let Some(def) = self.blocks.get(block) else {
                        continue;
                    };
                    if depth >= MAX_DEPTH {
                        continue;
                    }
                    let (sin, cos) = rotation.to_radians().sin_cos();
                    let inner = place.then(Place {
                        at: *at,
                        base: def.base,
                        scale: *scale,
                        cos,
                        sin,
                    });
                    let by_block = role(block);
                    let by_layer = role(layer);
                    let what = match (by_block, by_layer) {
                        (Role::Door | Role::Window | Role::Furniture, _) => by_block,
                        (_, Role::Door | Role::Window | Role::Furniture) => by_layer,
                        _ if kinds::kind_from_text(block).is_some() => Role::Furniture,
                        _ => Role::Other,
                    };
                    // A title block, a dimension or a note placed as a block: not the plan.
                    if by_layer == Role::Ignored
                        || (by_block == Role::Ignored && what == Role::Other)
                    {
                        continue;
                    }
                    if what == Role::Other {
                        self.walk(&def.entities, inner, depth + 1, by_layer);
                        continue;
                    }
                    let mut placed = Placed {
                        role: what,
                        name: block.clone(),
                        place: inner,
                        extent: [[f64::INFINITY; 2], [f64::NEG_INFINITY; 2]],
                        lines: Vec::new(),
                        arcs: Vec::new(),
                    };
                    collect(
                        self.blocks,
                        &def.entities,
                        Place::IDENTITY,
                        inner,
                        &mut placed,
                        depth + 1,
                        &mut self.count,
                    );
                    if placed.extent[0][0].is_finite() {
                        self.placed.push(placed);
                    } else if what == Role::Furniture {
                        self.skipped_pieces += 1;
                    } else {
                        self.skipped_openings += 1;
                    }
                }
            }
        }
    }

    fn is_wall(&self, layer: &str, inherited: Role) -> bool {
        let own = role(layer);
        let own = if own == Role::Other && layer == "0" {
            inherited
        } else {
            own
        };
        if self.walls_named {
            own == Role::Wall
        } else {
            matches!(own, Role::Wall | Role::Other)
        }
    }

    /// The draft, in centimetres with `y` down.
    fn draft(self, title: &str, scale: f64) -> Draft {
        let plan = |p: P2| [p[0] * scale, -p[1] * scale];
        let mut draft = Draft {
            name: title.chars().take(100).collect(),
            ..Draft::default()
        };
        draft.report.skipped_furniture += self.skipped_pieces;
        draft.report.unplaced_openings += self.skipped_openings;
        let mut closing: Vec<(P2, P2)> = Vec::new();
        let (mut doors, mut windows, mut pieces) = (0, 0, 0);
        for p in &self.placed {
            match p.role {
                Role::Door | Role::Window => {
                    let door = p.role == Role::Door;
                    let swung = swing(p).or_else(|| span(p).map(|(a, b, c)| (a, b, c, false)));
                    let Some((hinge, closed, open, double)) = swung else {
                        draft.report.unplaced_openings += 1;
                        continue;
                    };
                    let (a, b) = (plan(hinge), plan(closed));
                    let width = (b[0] - a[0]).hypot(b[1] - a[1]);
                    if width < 1.0 {
                        draft.report.unplaced_openings += 1;
                        continue;
                    }
                    let along = [(b[0] - a[0]) / width, (b[1] - a[1]) / width];
                    let o = plan(open);
                    let side = (o[0] - a[0]) * -along[1] + (o[1] - a[1]) * along[0];
                    let normal = [-along[1], along[0]];
                    let opens = if side < 0.0 {
                        [-normal[0], -normal[1]]
                    } else {
                        normal
                    };
                    // The gap it stands in, closed on both faces of the wall when a jamb shows
                    // how thick the wall is: the rooms on each side meet in its middle.
                    closing.push((hinge, closed));
                    if let Some(v) = jamb(&self.segments, hinge, closed, scale) {
                        closing.push((
                            [hinge[0] + v[0], hinge[1] + v[1]],
                            [closed[0] + v[0], closed[1] + v[1]],
                        ));
                    }
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
                        centre: [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0],
                        along,
                        opens,
                        width,
                        right: false,
                        style: double.then_some("double"),
                    });
                }
                _ => {
                    let [lo, hi] = p.extent;
                    let size = [(hi[0] - lo[0]) * scale, (hi[1] - lo[1]) * scale];
                    if size[0] < 1.0 || size[1] < 1.0 || size[0] > 10_000.0 || size[1] > 10_000.0 {
                        draft.report.skipped_furniture += 1;
                        continue;
                    }
                    let centre = plan(
                        p.place
                            .point_in_block([(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0]),
                    );
                    let kind = kinds::kind_by_name(
                        &[p.name.as_str()],
                        [size[0], size[1], 80.0],
                        0.0,
                        false,
                    );
                    let usual = domotwin_core::plan::Kind::from_name(kind).map(|k| k.info());
                    pieces += 1;
                    draft.pieces.push(DraftPiece {
                        id: format!("piece-{pieces}"),
                        name: String::new(),
                        kind,
                        centre,
                        size: [size[0], size[1], usual.map_or(80.0, |u| u.size[2])],
                        // Counter-clockwise with `y` up is clockwise with `y` down.
                        angle: degrees([p.place.cos, -p.place.sin]),
                        elevation: usual.map_or(0.0, |u| u.elevation),
                        card: None,
                    });
                }
            }
        }
        // Rooms: the room layer's outlines (the builder leaves out one drawn over others), else
        // the faces of the walls, their doors closed.
        let outlines: Vec<Vec<P2>> = if self.rooms.is_empty() {
            // The doors' closings first: `faces` keeps the first segments of a huge drawing.
            let segments: Vec<(P2, P2, f64)> = closing
                .iter()
                .chain(&self.segments)
                .map(|&(a, b)| (plan(a), plan(b), 0.0))
                .collect();
            let found: Vec<Vec<P2>> = faces::faces(&segments)
                .into_iter()
                .map(|(outline, _)| outline)
                .filter(|outline| {
                    let area = signed_area2(outline).abs() / 2.0;
                    let perimeter: f64 = (0..outline.len())
                        .map(|i| {
                            let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
                            (b[0] - a[0]).hypot(b[1] - a[1])
                        })
                        .sum();
                    // The width of the rectangle of the same area and perimeter.
                    let quarter = perimeter / 4.0;
                    quarter - (quarter * quarter - area).max(0.0).sqrt() >= MIN_ROOM_WIDTH
                })
                .collect();
            // Not the outline of the façades around every room, nor a table drawn in a room.
            let keep = faces::rooms_only(&found);
            found
                .into_iter()
                .zip(keep)
                .filter_map(|(outline, keep)| keep.then_some(outline))
                .collect()
        } else {
            self.rooms
                .iter()
                .map(|(_, r)| r.iter().map(|&p| plan(p)).collect())
                .collect()
        };
        let texts: Vec<(P2, &str)> = self
            .texts
            .iter()
            .map(|(p, t)| (plan(*p), t.as_str()))
            .filter(|(_, t)| is_name(t))
            .collect();
        for (k, points) in outlines.into_iter().enumerate() {
            let name = texts
                .iter()
                .find(|(p, _)| point_in_polygon(*p, &points))
                .map(|(_, t)| t.chars().take(100).collect())
                .unwrap_or_default();
            draft.rooms.push(DraftRoom {
                id: format!("room-{}", k + 1),
                name,
                points,
            });
        }
        draft
    }
}

impl Place {
    /// A point of the block's own scaled frame (its base at the origin) in the world.
    fn point_in_block(&self, s: P2) -> P2 {
        [
            self.at[0] + s[0] * self.cos - s[1] * self.sin,
            self.at[1] + s[0] * self.sin + s[1] * self.cos,
        ]
    }
}

/// The jamb at an opening's end: a wall line from `hinge`, across the opening, 3 to 60 cm long
/// (`scale` cm per drawing unit), as the vector from `hinge` to its other end.
fn jamb(segments: &[(P2, P2)], hinge: P2, closed: P2, scale: f64) -> Option<P2> {
    let along = [closed[0] - hinge[0], closed[1] - hinge[1]];
    let width = along[0].hypot(along[1]);
    if width <= 0.0 || scale <= 0.0 {
        return None;
    }
    let near = 1.0 / scale;
    segments.iter().find_map(|&(a, b)| {
        let (from, to) = if (a[0] - hinge[0]).hypot(a[1] - hinge[1]) < near {
            (a, b)
        } else if (b[0] - hinge[0]).hypot(b[1] - hinge[1]) < near {
            (b, a)
        } else {
            return None;
        };
        let v = [to[0] - from[0], to[1] - from[1]];
        let len = v[0].hypot(v[1]);
        let across = (v[0] * along[0] + v[1] * along[1]).abs() / (len * width).max(1e-12);
        (across < 0.1 && len * scale >= 3.0 && len * scale <= 60.0).then_some(v)
    })
}

/// Whether a text names a room rather than giving a size, a level or a number.
fn is_name(text: &str) -> bool {
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    letters >= 2 && !text.contains("m²") && !text.contains("m2") && text.chars().count() <= 60
}

/// Gathers an insert's block: its extent in its own scaled frame, and its lines and arcs in the
/// world (`world` places the block, `local` places nested blocks in it).
fn collect(
    blocks: &HashMap<String, Block>,
    list: &[Raw],
    local: Place,
    world: Place,
    out: &mut Placed,
    depth: usize,
    count: &mut usize,
) {
    let grow = |extent: &mut [P2; 2], p: P2| {
        let q = local.point(p);
        // In the block's own frame, scaled.
        let s = [
            (q[0] - world.base[0]) * world.scale[0],
            (q[1] - world.base[1]) * world.scale[1],
        ];
        for k in 0..2 {
            extent[0][k] = extent[0][k].min(s[k]);
            extent[1][k] = extent[1][k].max(s[k]);
        }
    };
    for e in list {
        // The same budget as the walk: a block inserting itself many times would never end.
        *count += 1;
        if *count > MAX_ENTITIES {
            return;
        }
        match e {
            Raw::Line { a, b, .. } => {
                grow(&mut out.extent, *a);
                grow(&mut out.extent, *b);
                out.lines
                    .push((world.point(local.point(*a)), world.point(local.point(*b))));
            }
            Raw::Poly { points, closed, .. } => {
                let n = points.len();
                let sides = if *closed { n } else { n.saturating_sub(1) };
                for k in 0..sides {
                    let (a, b) = (points[k], points[(k + 1) % n]);
                    grow(&mut out.extent, a);
                    grow(&mut out.extent, b);
                    out.lines
                        .push((world.point(local.point(a)), world.point(local.point(b))));
                }
            }
            Raw::Arc {
                centre,
                radius,
                from,
                to,
                ..
            } => {
                let at = |deg: f64| {
                    let (s, c) = deg.to_radians().sin_cos();
                    [centre[0] + radius * c, centre[1] + radius * s]
                };
                grow(&mut out.extent, at(*from));
                grow(&mut out.extent, at(*to));
                grow(&mut out.extent, *centre);
                if to - from >= 359.9 {
                    for deg in [0.0, 90.0, 180.0, 270.0] {
                        grow(&mut out.extent, at(deg));
                    }
                }
                let c = world.point(local.point(*centre));
                let (e0, e1) = (
                    world.point(local.point(at(*from))),
                    world.point(local.point(at(*to))),
                );
                out.arcs
                    .push((c, (e0[0] - c[0]).hypot(e0[1] - c[1]), e0, e1));
            }
            Raw::Insert {
                block,
                at,
                scale,
                rotation,
                ..
            } => {
                if depth >= MAX_DEPTH {
                    continue;
                }
                if let Some(def) = blocks.get(block) {
                    let (sin, cos) = rotation.to_radians().sin_cos();
                    let inner = local.then(Place {
                        at: *at,
                        base: def.base,
                        scale: *scale,
                        cos,
                        sin,
                    });
                    collect(blocks, &def.entities, inner, world, out, depth + 1, count);
                }
            }
            Raw::Text { .. } => {}
        }
    }
}

/// The blocks the drawing inserts, and the blocks they insert.
fn inserted<'a>(blocks: &'a HashMap<String, Block>, model: &'a [Raw]) -> HashSet<&'a str> {
    let mut found: HashSet<&str> = HashSet::new();
    let mut next: Vec<&[Raw]> = vec![model];
    while let Some(list) = next.pop() {
        for e in list {
            if let Raw::Insert { block, .. } = e
                && let Some(def) = blocks.get(block)
                && found.insert(block)
            {
                next.push(&def.entities);
            }
        }
    }
    found
}

/// A door's swing: the hinge (the arc's centre), the end of the leaf when closed (the arc's end
/// no leaf line reaches) and when open, in the drawing's frame; and whether it is a double door
/// (then the closed end is the other leaf's hinge).
fn swing(p: &Placed) -> Option<(P2, P2, P2, bool)> {
    // The widest arc (not a whole circle: a knob, a column).
    let &(centre, radius, e0, e1) = p
        .arcs
        .iter()
        .filter(|a| a.2 != a.3)
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    if !(radius.is_finite() && radius > 0.0) {
        return None;
    }
    let near = |a: P2, b: P2| (a[0] - b[0]).hypot(a[1] - b[1]) < radius * 0.05;
    let leaf_to = |e: P2| {
        p.lines.iter().any(|&(a, b)| {
            a != b && ((near(a, centre) && near(b, e)) || (near(b, centre) && near(a, e)))
        })
    };
    let (closed, open) = if leaf_to(e0) && !leaf_to(e1) {
        (e1, e0)
    } else {
        (e0, e1)
    };
    // A double door: a second leaf as wide, hinged at the other end of the opening.
    let second = p.arcs.iter().find(|a| {
        let apart = (a.0[0] - centre[0]).hypot(a.0[1] - centre[1]);
        a.2 != a.3
            && (a.1 - radius).abs() < radius * 0.1
            && (apart - 2.0 * radius).abs() < radius * 0.15
    });
    if let Some(&(other, ..)) = second {
        return Some((centre, other, open, true));
    }
    Some((centre, closed, open, false))
}

/// An opening without a swing (a window, a sliding door): across its block's longer side, centred,
/// opening to its block's front.
fn span(p: &Placed) -> Option<(P2, P2, P2)> {
    let [lo, hi] = p.extent;
    let (w, d) = (hi[0] - lo[0], hi[1] - lo[1]);
    if !(w.is_finite() && d.is_finite()) {
        return None;
    }
    let mid = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
    let (a, b, front) = if w >= d {
        ([lo[0], mid[1]], [hi[0], mid[1]], [mid[0], lo[1]])
    } else {
        ([mid[0], lo[1]], [mid[0], hi[1]], [hi[0], mid[1]])
    };
    let world = |q: P2| p.place.point_in_block(q);
    Some((world(a), world(b), world(front)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A DXF file from its entities (and blocks), in centimetres.
    fn drawing(blocks: &str, entities: &str) -> String {
        format!(
            "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n5\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n{blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n{entities}0\nENDSEC\n0\nEOF\n"
        )
    }

    fn line(layer: &str, a: P2, b: P2) -> String {
        format!(
            "0\nLINE\n8\n{layer}\n10\n{}\n20\n{}\n11\n{}\n21\n{}\n",
            a[0], a[1], b[0], b[1]
        )
    }

    const DOOR_BLOCK: &str = "0\nBLOCK\n2\nDoor 90\n10\n0\n20\n0\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n0\n21\n90\n0\nARC\n8\n0\n10\n0\n20\n0\n40\n90\n50\n0\n51\n90\n0\nENDBLK\n";
    const BED_BLOCK: &str = "0\nBLOCK\n2\nDouble bed\n10\n0\n20\n0\n0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n140\n20\n0\n10\n140\n20\n190\n10\n0\n20\n190\n0\nENDBLK\n";

    #[test]
    fn rooms_from_room_outlines_with_their_names() {
        let entities = "0\nLWPOLYLINE\n8\nROOMS\n90\n4\n70\n1\n10\n0\n20\n0\n10\n400\n20\n0\n10\n400\n20\n300\n10\n0\n20\n300\n0\nTEXT\n8\nTEXT\n10\n200\n20\n150\n1\nKitchen\n0\nTEXT\n8\nTEXT\n10\n200\n20\n120\n1\n12.0 m²\n";
        let file = DxfFile::read(drawing("", entities).as_bytes(), "Flat").unwrap();
        assert_eq!(file.storeys()[0].spaces, 1);
        let (plan, report, _) = file.convert(0).unwrap();
        assert_eq!(report.rooms, 1);
        assert_eq!(plan["name"], "Flat");
        assert_eq!(plan["rooms"][0]["name"], "Kitchen");
        domotwin_core::plan::read_plan_value(&plan).unwrap();
    }

    #[test]
    fn rooms_from_double_line_walls_doors_and_furniture() {
        // Two rooms, 400 × 300 and 300 × 300 inside, walls 20 cm and a 10 cm partition with a
        // door; a bed in the second room.
        let mut entities = String::new();
        // Façades, as closed double lines (outer and inner rectangles).
        entities += &line("A-WALL", [-20.0, -20.0], [730.0, -20.0]);
        entities += &line("A-WALL", [730.0, -20.0], [730.0, 320.0]);
        entities += &line("A-WALL", [730.0, 320.0], [-20.0, 320.0]);
        entities += &line("A-WALL", [-20.0, 320.0], [-20.0, -20.0]);
        entities += &line("A-WALL", [0.0, 0.0], [710.0, 0.0]);
        entities += &line("A-WALL", [710.0, 300.0], [0.0, 300.0]);
        entities += &line("A-WALL", [0.0, 300.0], [0.0, 0.0]);
        entities += &line("A-WALL", [710.0, 0.0], [710.0, 300.0]);
        // The partition, cut for the door from y 100 to 190.
        entities += &line("A-WALL", [400.0, 0.0], [400.0, 100.0]);
        entities += &line("A-WALL", [410.0, 0.0], [410.0, 100.0]);
        entities += &line("A-WALL", [400.0, 190.0], [400.0, 300.0]);
        entities += &line("A-WALL", [410.0, 190.0], [410.0, 300.0]);
        entities += &line("A-WALL", [400.0, 100.0], [410.0, 100.0]);
        entities += &line("A-WALL", [400.0, 190.0], [410.0, 190.0]);
        // The door: hinge at (410, 100), closed along +y (rotated 90°: the block's leaf line,
        // along its y, opens towards −x… into the first room).
        entities += "0\nINSERT\n8\nA-DOOR\n2\nDoor 90\n10\n410\n20\n100\n50\n90\n";
        entities += "0\nINSERT\n8\nA-FURN\n2\nDouble bed\n10\n500\n20\n50\n";
        entities += "0\nTEXT\n8\nA-TEXT\n10\n200\n20\n150\n1\nLiving room\n";
        let file = DxfFile::read(
            drawing(&(DOOR_BLOCK.to_owned() + BED_BLOCK), &entities).as_bytes(),
            "Flat",
        )
        .unwrap();
        let storey = &file.storeys()[0];
        assert_eq!(
            (storey.spaces, storey.doors, storey.furniture),
            (2, 1, 1),
            "{storey:?}"
        );
        let (plan, report, _) = file.convert(0).unwrap();
        assert_eq!(
            (
                report.rooms,
                report.doors,
                report.furniture,
                report.unplaced_openings
            ),
            (2, 1, 1, 0),
            "{report:?}"
        );
        assert_eq!(plan["items"][0]["kind"], "bed");
        let names: Vec<&str> = plan["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"Living room"), "{names:?}");
        // One wall between the rooms, 10 cm, centred on the partition.
        assert_eq!(plan["wallThickness"]["interior"], 10.0);
        domotwin_core::plan::read_plan_value(&plan).unwrap();
    }

    #[test]
    fn load_bearing_walls_and_layouts() {
        // `MURS_PORTEURS` holds load-bearing walls, not doors; a layout's frame (paper space)
        // is not the plan.
        let mut entities = String::new();
        for (a, b) in [
            ([0.0, 0.0], [400.0, 0.0]),
            ([400.0, 0.0], [400.0, 300.0]),
            ([400.0, 300.0], [0.0, 300.0]),
            ([0.0, 300.0], [0.0, 0.0]),
        ] {
            entities += &line("MURS_PORTEURS", a, b);
        }
        entities += "0\nLWPOLYLINE\n67\n1\n8\nMURS\n90\n4\n70\n1\n10\n-900\n20\n-900\n10\n900\n20\n-900\n10\n900\n20\n900\n10\n-900\n20\n900\n";
        let file = DxfFile::read(drawing("", &entities).as_bytes(), "Flat").unwrap();
        let (plan, report, _) = file.convert(0).unwrap();
        assert_eq!(report.rooms, 1, "{plan}");
        assert_eq!(
            plan["rooms"][0]["outline"],
            serde_json::json!([[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]])
        );
    }

    #[test]
    fn mirrored_entities_and_blocks() {
        // Seen from below (extrusion 0 0 −1), an arc, an insert and a text have their x turned.
        let read = entities(
            &pairs(
                "0\nARC\n8\n0\n10\n100\n20\n50\n40\n90\n50\n0\n51\n90\n230\n-1\n\
             0\nINSERT\n8\n0\n2\nDoor\n10\n100\n20\n50\n50\n30\n230\n-1\n\
             0\nTEXT\n8\n0\n10\n100\n20\n50\n1\nHall\n230\n-1\n",
            )
            .unwrap(),
        );
        assert!(
            matches!(&read[0], Raw::Arc { centre, from, to, .. }
            if *centre == [-100.0, 50.0] && *from == 90.0 && *to == 180.0),
            "{read:?}"
        );
        assert!(
            matches!(&read[1], Raw::Insert { at, scale, rotation, .. }
            if *at == [-100.0, 50.0] && *scale == [-1.0, 1.0] && *rotation == -30.0),
            "{read:?}"
        );
        assert!(
            matches!(&read[2], Raw::Text { at, .. } if *at == [-100.0, 50.0]),
            "{read:?}"
        );
        // A block turned in a mirrored block: placed as the two placements one after the other.
        let (sin, cos) = 90_f64.to_radians().sin_cos();
        let inner = Place {
            at: [30.0, 10.0],
            base: [5.0, 0.0],
            scale: [1.0, 1.0],
            cos,
            sin,
        };
        for scale in [[-1.0, 1.0], [2.0, 2.0], [1.0, -1.0]] {
            let (sin, cos) = 30_f64.to_radians().sin_cos();
            let outer = Place {
                at: [100.0, 0.0],
                base: [0.0, 0.0],
                scale,
                cos,
                sin,
            };
            let (a, b) = (
                outer.then(inner).point([40.0, 20.0]),
                outer.point(inner.point([40.0, 20.0])),
            );
            assert!(
                (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9,
                "{scale:?} {a:?} {b:?}"
            );
        }
    }

    /// Two rooms, 400 × 300 and 300 × 300 inside, walls 20 cm and a 10 cm partition cut for a
    /// door from y 100 to 190, in a model space whose walls are on `layer`.
    fn two_rooms(layer: &str) -> String {
        [
            ([-20.0, -20.0], [730.0, -20.0]),
            ([730.0, -20.0], [730.0, 320.0]),
            ([730.0, 320.0], [-20.0, 320.0]),
            ([-20.0, 320.0], [-20.0, -20.0]),
            ([0.0, 0.0], [710.0, 0.0]),
            ([710.0, 300.0], [0.0, 300.0]),
            ([0.0, 300.0], [0.0, 0.0]),
            ([710.0, 0.0], [710.0, 300.0]),
            ([400.0, 0.0], [400.0, 100.0]),
            ([410.0, 0.0], [410.0, 100.0]),
            ([400.0, 190.0], [400.0, 300.0]),
            ([410.0, 190.0], [410.0, 300.0]),
            ([400.0, 100.0], [410.0, 100.0]),
            ([400.0, 190.0], [410.0, 190.0]),
        ]
        .iter()
        .map(|(a, b)| line(layer, *a, *b))
        .collect()
    }

    #[test]
    fn doors_drawn_otherwise() {
        // A leaf drawn as a closed polyline, then a double door of two 45 cm leaves.
        let leaf = "0\nBLOCK\n2\nDoor 90\n10\n0\n20\n0\n0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n-5\n20\n0\n10\n-5\n20\n90\n10\n0\n20\n90\n0\nARC\n8\n0\n10\n0\n20\n0\n40\n90\n50\n0\n51\n90\n0\nENDBLK\n";
        let double = "0\nBLOCK\n2\nDouble door\n10\n0\n20\n0\n0\nARC\n8\n0\n10\n0\n20\n0\n40\n45\n50\n0\n51\n90\n0\nARC\n8\n0\n10\n90\n20\n0\n40\n45\n50\n90\n51\n180\n0\nENDBLK\n";
        for (block, name, width, style) in [
            (leaf, "Door 90", 90.0, None),
            (double, "Double door", 90.0, Some("double")),
        ] {
            let entities = two_rooms("A-WALL")
                + &format!("0\nINSERT\n8\nA-DOOR\n2\n{name}\n10\n410\n20\n100\n50\n90\n");
            let file = DxfFile::read(drawing(block, &entities).as_bytes(), "Flat").unwrap();
            let (plan, report, _) = file.convert(0).unwrap();
            assert_eq!(
                (report.rooms, report.doors, report.unplaced_openings),
                (2, 1, 0),
                "{name} {plan}"
            );
            let door = &plan["doors"][0];
            let span = (door["to"][0].as_f64().unwrap() - door["from"][0].as_f64().unwrap())
                .hypot(door["to"][1].as_f64().unwrap() - door["from"][1].as_f64().unwrap());
            assert!((span - width).abs() < 0.5, "{name} {door}");
            assert_eq!(
                plan["doors"][0].get("style").and_then(|s| s.as_str()),
                style,
                "{name}"
            );
        }
    }

    #[test]
    fn islands_notes_circles_and_unused_blocks() {
        // Walls on layer 0, a table drawn as lines in the first room; a note before the room's
        // name; a round table (a circle); a block never inserted with a line on a wall layer.
        let mut entities = two_rooms("0");
        for (a, b) in [
            ([100.0, 100.0], [200.0, 100.0]),
            ([200.0, 100.0], [200.0, 200.0]),
            ([200.0, 200.0], [100.0, 200.0]),
            ([100.0, 200.0], [100.0, 100.0]),
        ] {
            entities += &line("0", a, b);
        }
        entities += "0\nTEXT\n8\nA-ANNO-NOTE\n10\n50\n20\n50\n1\nRadiateur\n";
        entities += "0\nTEXT\n8\nA-ANNO-ROOM\n10\n300\n20\n250\n1\nSalon\n";
        entities += "0\nINSERT\n8\nA-FURN\n2\nRound table\n10\n550\n20\n150\n";
        entities += "0\nINSERT\n8\nA-DOOR\n2\nDoor 90\n10\n410\n20\n100\n50\n90\n";
        let blocks = DOOR_BLOCK.to_owned()
            + "0\nBLOCK\n2\nRound table\n10\n0\n20\n0\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n50\n0\nENDBLK\n0\nBLOCK\n2\nDETAIL\n10\n0\n20\n0\n0\nLINE\n8\nMURS\n10\n0\n20\n0\n11\n10\n21\n0\n0\nENDBLK\n";
        let file = DxfFile::read(drawing(&blocks, &entities).as_bytes(), "Flat").unwrap();
        let (plan, report, _) = file.convert(0).unwrap();
        assert_eq!(report.rooms, 2, "{plan}");
        let names: Vec<&str> = plan["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap())
            .collect();
        assert!(
            names.contains(&"Salon") && !names.contains(&"Radiateur"),
            "{names:?}"
        );
        assert_eq!(plan["items"][0]["size"][0], 100.0, "{plan}");
    }

    #[test]
    fn a_drawing_placed_on_a_map() {
        // In metres, 700 km from the origin as on a national grid.
        let (x0, y0) = (700_000.0, 6_600_000.0);
        let entities: String = [
            ([0.0, 0.0], [4.0, 0.0]),
            ([4.0, 0.0], [4.0, 3.0]),
            ([4.0, 3.0], [0.0, 3.0]),
            ([0.0, 3.0], [0.0, 0.0]),
        ]
        .iter()
        .map(|(a, b)| line("A-WALL", [x0 + a[0], y0 + a[1]], [x0 + b[0], y0 + b[1]]))
        .collect();
        let text = drawing("", &entities).replace("$INSUNITS\n70\n5", "$INSUNITS\n70\n6");
        let file = DxfFile::read(text.as_bytes(), "Map").unwrap();
        let (plan, _, _) = file.convert(0).unwrap();
        assert_eq!(
            plan["rooms"][0]["outline"],
            serde_json::json!([[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]])
        );
    }

    #[test]
    fn a_thick_wall_is_not_a_room() {
        // Two rooms side by side, a 50 cm stone wall between them and 40 cm façades: the wall's
        // face is not a room; the rooms meet in its middle.
        let mut entities = String::new();
        for (a, b) in [
            ([-40.0, -40.0], [770.0, -40.0]),
            ([770.0, -40.0], [770.0, 340.0]),
            ([770.0, 340.0], [-40.0, 340.0]),
            ([-40.0, 340.0], [-40.0, -40.0]),
            ([0.0, 0.0], [730.0, 0.0]),
            ([730.0, 0.0], [730.0, 300.0]),
            ([730.0, 300.0], [0.0, 300.0]),
            ([0.0, 300.0], [0.0, 0.0]),
            // The partition's two faces, from façade to façade.
            ([400.0, 0.0], [400.0, 300.0]),
            ([450.0, 0.0], [450.0, 300.0]),
        ] {
            entities += &line("A-WALL", a, b);
        }
        let file = DxfFile::read(drawing("", &entities).as_bytes(), "Flat").unwrap();
        let (plan, report, _) = file.convert(0).unwrap();
        assert_eq!(report.rooms, 2, "{plan}");
        let outline = plan["rooms"][0]["outline"].as_array().unwrap();
        assert!(
            outline.contains(&serde_json::json!([425.0, 0.0])),
            "{outline:?}"
        );
    }

    #[test]
    fn units_texts_and_refusals() {
        assert_eq!(plain("{\\fArial|b1;Living}\\Proom"), "Living room");
        assert_eq!(plain("Salle \\U+00E0 manger"), "Salle à manger");
        assert_eq!(decode(b"Cuisine \xe9t\xe9"), "Cuisine été");
        assert_eq!(scale(4, &[], &[]), 0.1);
        assert_eq!(scale(0, &[([0.0, 0.0], [9000.0, 0.0])], &[]), 0.1);
        assert_eq!(scale(0, &[([0.0, 0.0], [9.0, 0.0])], &[]), 100.0);
        assert!(DxfFile::read(b"AutoCAD Binary DXF\r\n", "x").is_err());
        assert_eq!(DxfFile::read(b"hello", "x").err(), Some("not_plan"));
        assert_eq!(DxfFile::read(b"0\nEOF\n", "x").err(), Some("not_plan"));
        let empty = DxfFile::read(drawing("", "").as_bytes(), "x").unwrap();
        assert_eq!(empty.convert(0), Err("no_spaces"));
        assert_eq!(empty.convert(1), Err("no_storeys"));
    }
}
