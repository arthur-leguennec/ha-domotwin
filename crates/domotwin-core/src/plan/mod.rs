//! The DomoTwin plan format (`*.domotwin.json`), see `docs/plan-format.md`.
//!
//! [`read_plan`] turns any bytes into a clean [`Plan`] or a [`ReadError`]: strict on structure,
//! lenient on optional values, exactly as the format describes. Inside, rooms keep a frame and
//! their corners within it, items the corner of their unturned box: what the geometry works with.

pub mod catalogue;
pub mod light;
mod read;

use std::collections::BTreeMap;

pub use catalogue::{DoorStyle, Floor, Kind, KindFlags, KindInfo, WallStyle};
pub(crate) use read::MAX_ID;
pub(crate) use read::point;
pub use read::{LISTS, parse_plan_json, read_plan, read_plan_value, valid_model_id};
use serde_json::Value;

use crate::error::ReadError;

/// Largest plan file read, in bytes.
pub const MAX_PLAN_BYTES: usize = 32_000_000;
/// Number of elements of a plan.
pub const MAX_ELEMENTS: usize = 500;
/// `format` of a plan file.
pub const PLAN_FORMAT: &str = "domotwin-plan";
/// The format's version this DomoTwin reads and writes.
pub const PLAN_VERSION: u32 = 1;
/// |x| and |y| of elements, in cm.
pub const MAX_COORDINATE: f64 = 50_000.0;
/// Default colour of rooms and furniture without a valid `color`.
pub const DEFAULT_COLOR: Rgb8 = Rgb8 {
    r: 0xe5,
    g: 0xe9,
    b: 0xdc,
};

/// An sRGB colour, 8 bits per channel (`#rrggbb` in files).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rgb8 {
    /// Red.
    pub r: u8,
    /// Green.
    pub g: u8,
    /// Blue.
    pub b: u8,
}

impl Rgb8 {
    /// From `0xrrggbb`.
    pub const fn from_u32(hex: u32) -> Rgb8 {
        Rgb8 {
            r: (hex >> 16) as u8,
            g: (hex >> 8) as u8,
            b: hex as u8,
        }
    }

    /// Reads `#rrggbb` (either case).
    pub fn from_hex(text: &str) -> Option<Rgb8> {
        let hex = text.strip_prefix('#')?;
        if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let value = u32::from_str_radix(hex, 16).ok()?;
        Some(Rgb8 {
            r: (value >> 16) as u8,
            g: (value >> 8) as u8,
            b: value as u8,
        })
    }

    /// `#rrggbb` in lower case.
    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Linear-light RGB in 0–1 (for shading).
    pub fn to_linear(self) -> [f32; 3] {
        fn channel(c: u8) -> f32 {
            let c = f32::from(c) / 255.0;
            if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        }
        [channel(self.r), channel(self.g), channel(self.b)]
    }
}

/// Default wall thicknesses (`wallThickness`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallSettings {
    /// Walls between two rooms (cm).
    pub interior: f64,
    /// Façades (cm).
    pub exterior: f64,
}

impl Default for WallSettings {
    fn default() -> Self {
        Self {
            interior: 10.0,
            exterior: 20.0,
        }
    }
}

/// A finish of one side of a room, overriding its walls' finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeFinish {
    /// Tiles.
    Metro,
    /// Paint.
    Paint(Rgb8),
}

/// A room: its outline, kept as a frame and its corners within it, with walls on its sides.
#[derive(Debug, Clone, PartialEq)]
pub struct Room {
    /// Element id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Frame left (cm).
    pub x: f64,
    /// Frame top (cm).
    pub y: f64,
    /// Frame width (cm).
    pub w: f64,
    /// Frame depth along y (cm).
    pub h: f64,
    /// Fill colour on the plan.
    pub color: Rgb8,
    /// Floor material.
    pub floor: Floor,
    /// Direction of the floor pattern (degrees).
    pub floor_angle: f64,
    /// Finish of the walls.
    pub wall_style: WallStyle,
    /// Paint of the inner wall faces.
    pub wall_color: Option<Rgb8>,
    /// Crown moulding under the ceiling.
    pub cornice: bool,
    /// Corners relative to the frame (`[u, v]`, 0–1).
    pub vertices: Vec<[f64; 2]>,
    /// Sides without a wall (sorted, unique).
    pub open_edges: Vec<usize>,
    /// Wall thickness per side; `None` = automatic.
    pub edge_thickness: Vec<Option<f64>>,
    /// Finish per side, when one side has a finish.
    pub edge_finish: Option<Vec<Option<EdgeFinish>>>,
}

impl Room {
    /// The polygon in plan coordinates (cm).
    pub fn points(&self) -> Vec<[f64; 2]> {
        self.vertices
            .iter()
            .map(|[u, v]| [self.x + u * self.w, self.y + v * self.h])
            .collect()
    }

    /// Whether side `i` has no wall.
    pub fn is_open(&self, side: usize) -> bool {
        self.open_edges.contains(&side)
    }
}

/// A free partition from `(x, y)` to `(x2, y2)`.
#[derive(Debug, Clone, PartialEq)]
pub struct FreeWall {
    /// Element id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Start x.
    pub x: f64,
    /// Start y.
    pub y: f64,
    /// End x.
    pub x2: f64,
    /// End y.
    pub y2: f64,
    /// Thickness (cm).
    pub thickness: f64,
    /// Room it follows, or empty.
    pub parent: String,
}

/// A door or a window: the opening runs from `(x, y)` along `angle` for `w`.
#[derive(Debug, Clone, PartialEq)]
pub struct Opening {
    /// Element id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Hinge end x.
    pub x: f64,
    /// Hinge end y.
    pub y: f64,
    /// Width (cm).
    pub w: f64,
    /// Direction along the wall (degrees, 0–360).
    pub angle: f64,
    /// Side the leaf opens to: `1` = n = (−sin a, cos a) (`right` in files), `−1` the other.
    pub swing: i8,
    /// Room it follows, or empty.
    pub parent: String,
    /// Door style (windows: always hinged, unused).
    pub style: DoorStyle,
    /// Doors: how open, 0–99 %, `None` = fully open.
    pub open: Option<u8>,
}

impl Opening {
    /// Opening of a door as a fraction 0–1 (absent = fully open).
    pub fn open_fraction(&self) -> f64 {
        self.open
            .map_or(1.0, |open| f64::from(open.min(100)) / 100.0)
    }
}

/// An item: `x, y` is the top-left of the unturned box, turned by `angle` about its centre.
#[derive(Debug, Clone, PartialEq)]
pub struct Furniture {
    /// Element id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Left of the unrotated box.
    pub x: f64,
    /// Top of the unrotated box.
    pub y: f64,
    /// Width (cm).
    pub w: f64,
    /// Depth along local y (cm).
    pub h: f64,
    /// Height (cm).
    pub z: f64,
    /// Rotation about the centre (degrees, 0–360).
    pub angle: f64,
    /// Main colour.
    pub color: Rgb8,
    /// Kind.
    pub kind: Kind,
    /// The user model it is drawn from (its kind is then `box`).
    pub model: Option<String>,
    /// Style of the kind.
    pub variant: Option<String>,
    /// Room it follows, or empty.
    pub parent: String,
    /// Height of the underside (cm).
    pub elevation: f64,
    /// Built in: edit mode does not move it.
    pub locked: bool,
    /// Curtains: 0 (closed) to 100 (open).
    pub open: Option<u8>,
    /// Light kinds: switched off.
    pub light_off: bool,
    /// Light kinds: picked colour.
    pub light_color: Option<Rgb8>,
    /// Light kinds: colour temperature (K).
    pub light_kelvin: Option<u16>,
    /// Light kinds: intensity in % of the default.
    pub light_power: Option<u16>,
}

impl Furniture {
    /// Centre of the box in plan coordinates.
    pub fn center(&self) -> [f64; 2] {
        [self.x + self.w / 2.0, self.y + self.h / 2.0]
    }

    /// How open a curtain is drawn (absent: `closed` curtains closed, others open).
    pub fn curtain_open_fraction(&self) -> f64 {
        match self.open {
            Some(open) => f64::from(open.min(100)) / 100.0,
            None if self.variant.as_deref() == Some("closed") => 0.0,
            None => 1.0,
        }
    }
}

/// An element of the plan.
#[derive(Debug, Clone, PartialEq)]
pub enum Element {
    /// A room.
    Room(Room),
    /// A free partition.
    Wall(FreeWall),
    /// A door.
    Door(Opening),
    /// A window.
    Window(Opening),
    /// A furniture item.
    Furniture(Furniture),
}

impl Element {
    /// The element id.
    pub fn id(&self) -> &str {
        match self {
            Element::Room(e) => &e.id,
            Element::Wall(e) => &e.id,
            Element::Door(e) | Element::Window(e) => &e.id,
            Element::Furniture(e) => &e.id,
        }
    }

    /// The element name.
    pub fn name(&self) -> &str {
        match self {
            Element::Room(e) => &e.name,
            Element::Wall(e) => &e.name,
            Element::Door(e) | Element::Window(e) => &e.name,
            Element::Furniture(e) => &e.name,
        }
    }

    /// What the element is: `room`, `wall` (a partition), `door`, `window` or `furniture` (an
    /// item), as the engine names it to the frontend.
    pub const fn type_name(&self) -> &'static str {
        match self {
            Element::Room(_) => "room",
            Element::Wall(_) => "wall",
            Element::Door(_) => "door",
            Element::Window(_) => "window",
            Element::Furniture(_) => "furniture",
        }
    }
}

/// A saved viewpoint: where the camera is and what it looks at, `[x, height, plan y]` (the 3D
/// axes; files write `[x, y, height]`).
#[derive(Debug, Clone, PartialEq)]
pub enum View {
    /// A camera around the home.
    Orbit {
        /// Id.
        id: String,
        /// Name.
        name: String,
        /// Camera position.
        p: [f64; 3],
        /// Camera target.
        t: [f64; 3],
    },
}

/// A plan as read.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// Name (may be empty).
    pub name: String,
    /// Default wall thicknesses.
    pub wall_settings: WallSettings,
    /// Rooms, partitions, doors, windows and items, in that order (each in file order).
    pub elements: Vec<Element>,
    /// Saved viewpoints.
    pub views: Vec<View>,
    /// User 3D models by id, as read.
    pub models: BTreeMap<String, Value>,
}

impl Plan {
    /// The rooms of the plan.
    pub fn rooms(&self) -> impl Iterator<Item = &Room> {
        self.elements.iter().filter_map(|e| match e {
            Element::Room(room) => Some(room),
            _ => None,
        })
    }

    /// The furniture of the plan.
    pub fn furniture(&self) -> impl Iterator<Item = &Furniture> {
        self.elements.iter().filter_map(|e| match e {
            Element::Furniture(item) => Some(item),
            _ => None,
        })
    }

    /// Doors and windows (with `true` for doors).
    pub fn openings(&self) -> impl Iterator<Item = (&Opening, bool)> {
        self.elements.iter().filter_map(|e| match e {
            Element::Door(o) => Some((o, true)),
            Element::Window(o) => Some((o, false)),
            _ => None,
        })
    }

    /// The element with this id.
    pub fn element(&self, id: &str) -> Option<&Element> {
        self.elements.iter().find(|e| e.id() == id)
    }

    /// Counts of the plan's elements.
    pub fn summary(&self) -> PlanSummary {
        let mut summary = PlanSummary {
            name: self.name.clone(),
            ..PlanSummary::default()
        };
        for element in &self.elements {
            match element {
                Element::Room(_) => summary.rooms += 1,
                Element::Wall(_) => summary.walls += 1,
                Element::Door(_) => summary.doors += 1,
                Element::Window(_) => summary.windows += 1,
                Element::Furniture(_) => summary.furniture += 1,
            }
        }
        summary
    }

    /// Bounding box of the rooms (and other elements when there is no room): `[min, max]`.
    pub fn bounds(&self) -> [[f64; 2]; 2] {
        let mut min = [f64::INFINITY; 2];
        let mut max = [f64::NEG_INFINITY; 2];
        let mut add = |p: [f64; 2]| {
            for axis in 0..2 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis]);
            }
        };
        let mut any_room = false;
        for room in self.rooms() {
            any_room = true;
            room.points().into_iter().for_each(&mut add);
        }
        if !any_room {
            for element in &self.elements {
                match element {
                    Element::Wall(w) => {
                        add([w.x, w.y]);
                        add([w.x2, w.y2]);
                    }
                    Element::Door(o) | Element::Window(o) => add([o.x, o.y]),
                    Element::Furniture(f) => {
                        add([f.x, f.y]);
                        add([f.x + f.w, f.y + f.h]);
                    }
                    Element::Room(_) => {}
                }
            }
        }
        if !min[0].is_finite() {
            return [[0.0, 0.0], [0.0, 0.0]];
        }
        [min, max]
    }
}

/// What a plan contains, without its geometry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlanSummary {
    /// Name of the plan (may be empty).
    pub name: String,
    /// Number of rooms.
    pub rooms: usize,
    /// Number of free walls.
    pub walls: usize,
    /// Number of doors.
    pub doors: usize,
    /// Number of windows.
    pub windows: usize,
    /// Number of furniture items.
    pub furniture: usize,
}

impl PlanSummary {
    /// The summary as a small JSON object for the frontend.
    pub fn to_json(&self) -> String {
        serde_json::json!({
            "name": self.name,
            "rooms": self.rooms,
            "walls": self.walls,
            "doors": self.doors,
            "windows": self.windows,
            "furniture": self.furniture,
        })
        .to_string()
    }
}

/// Reads a plan and returns its summary (used by the import before saving).
///
/// # Errors
///
/// The [`ReadError`] of [`read_plan`].
pub fn summarize_plan(bytes: &[u8]) -> Result<PlanSummary, ReadError> {
    read_plan(bytes).map(|plan| plan.summary())
}
