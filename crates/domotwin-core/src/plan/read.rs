//! The plan reader: strict on structure, lenient on values (`docs/plan-format.md`).
//!
//! What defines an element (a room's outline, an opening's ends, an item's place and size) refuses
//! the whole file with an [`ErrorCode`] and the element concerned when it is missing or out of
//! range. Optional values that are missing, of the wrong type or out of range take their default,
//! texts are cut to their longest (in characters) and unknown fields are left out. Nothing here
//! panics, whatever the input.

use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value};

use super::catalogue::{DoorStyle, Floor, Kind, WallStyle};
use super::light::{KELVIN_RANGE, POWER_RANGE};
use super::{
    EdgeFinish, Element, FreeWall, Furniture, MAX_COORDINATE, MAX_ELEMENTS, MAX_PLAN_BYTES,
    Opening, PLAN_FORMAT, PLAN_VERSION, Plan, Rgb8, Room, View, WallSettings,
};
use crate::error::{ErrorCode, ReadError};
use crate::geometry::polygon::{P2, area, self_intersects};

type Object = Map<String, Value>;

const TEXT: usize = 100;
/// Longest element id (characters), shared by the overlay and the plan editor.
pub(crate) const MAX_ID: usize = TEXT;
const VIEW_NAME: usize = 60;
const MAX_CORNERS: usize = 64;
/// Largest room, along x and along y (cm).
const MAX_ROOM: f64 = 10_000.0;
const MAX_VIEWS: usize = 40;
const MAX_MODELS: usize = 50;
/// The lists of elements of a plan file, in the order they are read, and what each element is to
/// the engine and the frontend.
pub const LISTS: [(&str, &str); 5] = [
    ("rooms", "room"),
    ("partitions", "wall"),
    ("doors", "door"),
    ("windows", "window"),
    ("items", "furniture"),
];
/// How far an opening may be over or under its range of widths and still be read at its limit
/// (cm): its ends are written rounded.
const WIDTH_SLACK: f64 = 0.25;

/// Reads a plan file (its bytes).
///
/// # Errors
///
/// A [`ReadError`] for empty, oversized or non-JSON input, or anything [`read_plan_value`] refuses.
pub fn read_plan(bytes: &[u8]) -> Result<Plan, ReadError> {
    read_plan_value(&parse_plan_json(bytes)?)
}

/// The JSON of a plan file, before it is read (to apply the edit overlay first).
///
/// # Errors
///
/// `too_large`, `empty` or `not_json`.
pub fn parse_plan_json(bytes: &[u8]) -> Result<Value, ReadError> {
    if bytes.len() > MAX_PLAN_BYTES {
        return Err(ReadError::new(ErrorCode::TooLarge));
    }
    // A leading byte order mark is ignored.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Err(ReadError::new(ErrorCode::Empty));
    }
    serde_json::from_slice(bytes)
        .map_err(|err| ReadError::with_detail(ErrorCode::NotJson, err.to_string()))
}

/// Reads a plan already parsed as JSON.
///
/// # Errors
///
/// A [`ReadError`] when the file is not a plan, or an element lacks what defines it.
pub fn read_plan_value(value: &Value) -> Result<Plan, ReadError> {
    let Value::Object(root) = value else {
        return Err(ReadError::new(ErrorCode::NotAnObject));
    };
    if root.get("format").and_then(Value::as_str) != Some(PLAN_FORMAT) {
        return Err(ReadError::new(ErrorCode::NotAPlan));
    }
    match root.get("version").and_then(integer) {
        Some(v) if v == f64::from(PLAN_VERSION) => {}
        Some(v) if v > f64::from(PLAN_VERSION) => {
            return Err(ReadError::with_detail(
                ErrorCode::NewerVersion,
                format!("{v}"),
            ));
        }
        _ => return Err(ReadError::new(ErrorCode::NotAPlan)),
    }
    let mut lists = Vec::with_capacity(LISTS.len());
    for (key, _) in LISTS {
        match root.get(key) {
            None | Some(Value::Null) => lists.push(&[][..]),
            Some(Value::Array(list)) => lists.push(list.as_slice()),
            Some(_) => return Err(ReadError::with_detail(ErrorCode::NotAPlan, key)),
        }
    }
    let count: usize = lists.iter().map(|l| l.len()).sum();
    if count == 0 {
        return Err(ReadError::new(ErrorCode::NoElements));
    }
    if count > MAX_ELEMENTS {
        return Err(ReadError::new(ErrorCode::TooManyElements));
    }
    let wall_settings = read_wall_thickness(root.get("wallThickness"))?;
    let models = read_models(root.get("models"))?;
    let mut plan = Plan {
        name: text(root.get("name"), TEXT),
        wall_settings,
        elements: Vec::with_capacity(count),
        views: read_views(root.get("views")),
        models,
    };
    let mut ids = HashSet::with_capacity(count);
    for ((key, _), list) in LISTS.iter().zip(lists) {
        for (index, raw) in list.iter().enumerate() {
            let element = read_element(key, raw, index, &plan)?;
            if !ids.insert(element.id().to_owned()) {
                return Err(ReadError::new(ErrorCode::DuplicateId).at(element.id()));
            }
            plan.elements.push(element);
        }
    }
    check_rooms(&plan)?;
    Ok(plan)
}

/// `wallThickness`: 1–100 cm each.
fn read_wall_thickness(value: Option<&Value>) -> Result<WallSettings, ReadError> {
    let defaults = WallSettings::default();
    let Some(Value::Object(map)) = value else {
        return Ok(defaults);
    };
    let field = |key: &str, default: f64| -> Result<f64, ReadError> {
        match map.get(key) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => match v.as_f64() {
                Some(n) if (1.0..=100.0).contains(&n) => Ok(n),
                _ => Err(ReadError::new(ErrorCode::WallThickness)),
            },
        }
    };
    Ok(WallSettings {
        interior: field("interior", defaults.interior)?,
        exterior: field("exterior", defaults.exterior)?,
    })
}

fn read_element(list: &str, raw: &Value, index: usize, plan: &Plan) -> Result<Element, ReadError> {
    let invalid = || ReadError::new(ErrorCode::InvalidElement).at(format!("{list}[{index}]"));
    let Value::Object(e) = raw else {
        return Err(invalid());
    };
    let id = match e.get("id").and_then(Value::as_str) {
        Some(id) if !id.is_empty() && id.chars().count() <= MAX_ID => id.to_owned(),
        _ => return Err(invalid()),
    };
    let name = text(e.get("name"), TEXT);
    let room = text(e.get("room"), MAX_ID);
    match list {
        "rooms" => read_room(e, id, name).map(Element::Room),
        "partitions" => read_partition(e, id, name, room, plan).map(Element::Wall),
        "doors" => read_opening(e, id, name, room, true).map(Element::Door),
        "windows" => read_opening(e, id, name, room, false).map(Element::Window),
        _ => read_item(e, id, name, room, plan).map(Element::Furniture),
    }
}

fn read_room(e: &Object, id: String, name: String) -> Result<Room, ReadError> {
    let at = |code: ErrorCode| ReadError::new(code).at(id.as_str());
    let Some(Value::Array(list)) = e.get("outline") else {
        return Err(at(ErrorCode::InvalidOutline));
    };
    if !(3..=MAX_CORNERS).contains(&list.len()) {
        return Err(at(ErrorCode::InvalidOutline));
    }
    let mut points = Vec::with_capacity(list.len());
    for raw in list {
        points.push(point(raw).ok_or_else(|| at(ErrorCode::InvalidOutline))?);
    }
    if self_intersects(&points) {
        return Err(at(ErrorCode::SelfIntersection));
    }
    if area(&points) < 25.0 {
        return Err(at(ErrorCode::MinArea));
    }
    let mut min = [f64::INFINITY; 2];
    let mut max = [f64::NEG_INFINITY; 2];
    for p in &points {
        for k in 0..2 {
            min[k] = min[k].min(p[k]);
            max[k] = max[k].max(p[k]);
        }
    }
    let (w, h) = (max[0] - min[0], max[1] - min[1]);
    if w > MAX_ROOM || h > MAX_ROOM || w <= 0.0 || h <= 0.0 {
        return Err(at(ErrorCode::InvalidOutline));
    }
    let vertices = points
        .iter()
        .map(|p| [(p[0] - min[0]) / w, (p[1] - min[1]) / h])
        .collect();
    let sides = points.len();
    let mut open_edges = Vec::new();
    let mut edge_thickness = vec![None; sides];
    let mut edge_finish = vec![None; sides];
    if let Some(Value::Array(list)) = e.get("sides") {
        for (i, side) in list.iter().take(sides).enumerate() {
            let Value::Object(side) = side else { continue };
            if side.get("open") == Some(&Value::Bool(true)) {
                open_edges.push(i);
            }
            edge_thickness[i] = side
                .get("thickness")
                .and_then(Value::as_f64)
                .filter(|t| (1.0..=100.0).contains(t));
            edge_finish[i] = match side.get("finish") {
                Some(Value::String(s)) if s == "tiles" => Some(EdgeFinish::Metro),
                Some(Value::String(s)) => Rgb8::from_hex(s).map(EdgeFinish::Paint),
                _ => None,
            };
        }
    }
    let floor = e.get("floor").and_then(Value::as_object);
    let walls = e.get("walls").and_then(Value::as_object);
    let outside = e.get("outside") == Some(&Value::Bool(true));
    Ok(Room {
        id,
        name,
        x: min[0],
        y: min[1],
        w,
        h,
        color: color(e.get("color")).unwrap_or(super::DEFAULT_COLOR),
        // A place outside is a lawn unless it says otherwise.
        floor: floor
            .and_then(|f| f.get("material"))
            .and_then(Value::as_str)
            .map_or(
                if outside { Floor::Lawn } else { Floor::Plain },
                Floor::from_name,
            ),
        floor_angle: floor
            .and_then(|f| f.get("angle"))
            .and_then(Value::as_f64)
            .map_or(0.0, normal_angle),
        wall_style: walls
            .and_then(|w| w.get("finish"))
            .and_then(Value::as_str)
            .map_or(WallStyle::White, WallStyle::from_name),
        wall_color: color(walls.and_then(|w| w.get("paint"))),
        cornice: walls.and_then(|w| w.get("moulding")) == Some(&Value::Bool(true)),
        vertices,
        open_edges,
        edge_thickness,
        edge_finish: edge_finish
            .iter()
            .any(Option::is_some)
            .then_some(edge_finish),
        outside,
        railing: outside && e.get("railing") == Some(&Value::Bool(true)),
    })
}

fn read_partition(
    e: &Object,
    id: String,
    name: String,
    parent: String,
    plan: &Plan,
) -> Result<FreeWall, ReadError> {
    let from = e.get("from").and_then(point);
    let to = e.get("to").and_then(point);
    match (from, to) {
        (Some([x, y]), Some([x2, y2])) if (x2 - x).hypot(y2 - y) >= 5.0 => Ok(FreeWall {
            id,
            name,
            x,
            y,
            x2,
            y2,
            thickness: e
                .get("thickness")
                .and_then(Value::as_f64)
                .filter(|t| (1.0..=100.0).contains(t))
                .unwrap_or(plan.wall_settings.interior),
            parent,
        }),
        _ => Err(ReadError::new(ErrorCode::InvalidPartition).at(id)),
    }
}

fn read_opening(
    e: &Object,
    id: String,
    name: String,
    parent: String,
    door: bool,
) -> Result<Opening, ReadError> {
    let range = if door { (20.0, 300.0) } else { (20.0, 1_000.0) };
    let (Some(from), Some(to)) = (e.get("from").and_then(point), e.get("to").and_then(point))
    else {
        return Err(ReadError::new(ErrorCode::InvalidOpening).at(id));
    };
    let (dx, dy) = (to[0] - from[0], to[1] - from[1]);
    // Ends written rounded leave a width at its limit a hair over it on a slanted wall.
    let w = dx.hypot(dy);
    if !(range.0 - WIDTH_SLACK..=range.1 + WIDTH_SLACK).contains(&w) {
        return Err(ReadError::new(ErrorCode::InvalidOpening).at(id));
    }
    let w = w.clamp(range.0, range.1);
    let style = if door {
        e.get("style")
            .and_then(Value::as_str)
            .map_or(DoorStyle::Hinged, DoorStyle::from_name)
    } else {
        DoorStyle::Hinged
    };
    // Fully open is not kept: absent means open.
    let open = if door {
        fraction(e.get("open"))
            .map(|f| (f * 100.0).round())
            .filter(|p| *p < 100.0)
            .map(|p| p.max(0.0) as u8)
    } else {
        None
    };
    Ok(Opening {
        id,
        name,
        x: from[0],
        y: from[1],
        w,
        angle: normal_angle(dy.atan2(dx).to_degrees()),
        swing: if e.get("opensTo").and_then(Value::as_str) == Some("left") {
            -1
        } else {
            1
        },
        parent,
        style,
        open,
    })
}

fn read_item(
    e: &Object,
    id: String,
    name: String,
    parent: String,
    plan: &Plan,
) -> Result<Furniture, ReadError> {
    let at = |code: ErrorCode| ReadError::new(code).at(id.as_str());
    let centre = e
        .get("at")
        .and_then(point)
        .ok_or_else(|| at(ErrorCode::PositionRange))?;
    let size = e
        .get("size")
        .and_then(Value::as_array)
        .filter(|s| s.len() == 3)
        .ok_or_else(|| at(ErrorCode::ItemSize))?;
    let length = |i: usize| size.get(i).and_then(Value::as_f64);
    let (Some(w), Some(d)) = (
        length(0).filter(|v| (1.0..=10_000.0).contains(v)),
        length(1).filter(|v| (1.0..=10_000.0).contains(v)),
    ) else {
        return Err(at(ErrorCode::ItemSize));
    };
    let model = match e.get("model") {
        None | Some(Value::Null) => None,
        Some(Value::String(model)) if plan.models.contains_key(model) => Some(model.clone()),
        Some(_) => return Err(at(ErrorCode::MissingModel)),
    };
    let kind = if model.is_some() {
        Kind::Box
    } else {
        e.get("kind")
            .and_then(Value::as_str)
            .and_then(Kind::from_name)
            .unwrap_or(Kind::Box)
    };
    // Under a ceiling, or as tall as a tree for a piece of the garden (D-077).
    let tallest = kind.max_height();
    let z = length(2)
        .filter(|v| (1.0..=tallest).contains(v))
        .ok_or_else(|| at(ErrorCode::ItemHeight))?;
    let elevation = e
        .get("lift")
        .and_then(Value::as_f64)
        .map_or(0.0, |lift| lift.clamp(0.0, 300.0));
    let light = kind
        .is_light()
        .then(|| e.get("light").and_then(Value::as_object))
        .flatten();
    let light_color = light.and_then(|l| color(l.get("color")));
    let light_kelvin = light
        .filter(|_| light_color.is_none())
        .and_then(|l| l.get("kelvin"))
        .and_then(Value::as_f64)
        .map(|k| k.clamp(KELVIN_RANGE.0, KELVIN_RANGE.1).round() as u16);
    let light_power = light
        .and_then(|l| l.get("power"))
        .and_then(Value::as_f64)
        .filter(|p| p.is_finite())
        .map(|p| (p * 100.0).clamp(POWER_RANGE.0, POWER_RANGE.1).round() as u16)
        .filter(|p| *p != 100);
    let variant = e
        .get("style")
        .and_then(Value::as_str)
        .filter(|v| kind.has_variant(v))
        .map(str::to_owned);
    let open = if kind.moves() {
        fraction(e.get("open")).map(|f| (f * 100.0).round() as u8)
    } else {
        None
    };
    Ok(Furniture {
        id,
        name,
        x: centre[0] - w / 2.0,
        y: centre[1] - d / 2.0,
        w,
        h: d,
        z,
        angle: e
            .get("rotation")
            .and_then(Value::as_f64)
            .map_or(0.0, normal_angle),
        color: color(e.get("color")).unwrap_or(kind.style_info(variant.as_deref()).color),
        kind,
        model,
        variant,
        parent,
        elevation,
        locked: e.get("fixed") == Some(&Value::Bool(true)),
        open,
        light_off: light.and_then(|l| l.get("on")) == Some(&Value::Bool(false)),
        light_color,
        light_kelvin,
        light_power,
    })
}

/// Every `room` an element names is a room of the plan.
fn check_rooms(plan: &Plan) -> Result<(), ReadError> {
    let rooms: HashSet<&str> = plan.rooms().map(|room| room.id.as_str()).collect();
    for element in &plan.elements {
        let parent = match element {
            Element::Room(_) => continue,
            Element::Wall(w) => &w.parent,
            Element::Door(o) | Element::Window(o) => &o.parent,
            Element::Furniture(f) => &f.parent,
        };
        if !parent.is_empty() && !rooms.contains(parent.as_str()) {
            return Err(ReadError::new(ErrorCode::MissingRoom).at(element.id()));
        }
    }
    Ok(())
}

/// Viewpoints: at most 40 read, those without both points left out.
fn read_views(value: Option<&Value>) -> Vec<View> {
    let Some(Value::Array(list)) = value else {
        return Vec::new();
    };
    let mut views = Vec::new();
    for (index, item) in list.iter().take(MAX_VIEWS).enumerate() {
        let Value::Object(v) = item else { continue };
        let (Some(eye), Some(target)) = (vector3(v.get("eye")), vector3(v.get("target"))) else {
            continue;
        };
        let id = match v.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() && id.chars().count() <= MAX_ID => id.to_owned(),
            _ => format!("view-{index}"),
        };
        let name = match text(v.get("name"), VIEW_NAME) {
            name if name.is_empty() => id.clone(),
            name => name,
        };
        // Files write `[x, y, height]`; the 3D axes are `[x, height, y]`.
        views.push(View::Orbit {
            id,
            name,
            p: [eye[0], eye[2], eye[1]],
            t: [target[0], target[2], target[1]],
        });
    }
    views
}

fn vector3(value: Option<&Value>) -> Option<[f64; 3]> {
    let list = value?.as_array().filter(|l| l.len() == 3)?;
    let mut out = [0.0; 3];
    for (slot, item) in out.iter_mut().zip(list) {
        *slot = item.as_f64().filter(|n| n.abs() < 100_000.0)?;
    }
    Some(out)
}

/// Whether a user model id is valid: 1–64 letters, digits, `-` and `_`, starting with a letter or
/// a digit.
pub fn valid_model_id(id: &str) -> bool {
    id.len() <= 64
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `models`: an object of at most 50 user models by id, each with a size and a file.
fn read_models(value: Option<&Value>) -> Result<BTreeMap<String, Value>, ReadError> {
    let map = match value {
        None | Some(Value::Null) => return Ok(BTreeMap::new()),
        Some(Value::Object(map)) => map,
        Some(_) => return Err(ReadError::new(ErrorCode::InvalidModel)),
    };
    if map.len() > MAX_MODELS {
        return Err(ReadError::new(ErrorCode::InvalidModel));
    }
    let mut models = BTreeMap::new();
    for (id, model) in map {
        let Value::Object(fields) = model else {
            return Err(ReadError::new(ErrorCode::InvalidModel).at(id.as_str()));
        };
        let size_ok = fields
            .get("size")
            .and_then(Value::as_array)
            .is_some_and(|s| {
                s.len() == 3
                    && s.iter()
                        .zip([10_000.0, 10_000.0, 300.0])
                        .all(|(v, max)| v.as_f64().is_some_and(|n| (1.0..=max).contains(&n)))
            });
        let has_file = fields.get("file").is_some_and(Value::is_object);
        if !valid_model_id(id) || !size_ok || !has_file {
            return Err(ReadError::new(ErrorCode::InvalidModel).at(id.as_str()));
        }
        models.insert(id.clone(), model.clone());
    }
    Ok(models)
}

// ---------------------------------------------------------------- value helpers

/// A point `[x, y]` within the plan's reach.
/// A point `[x, y]` of the plan, within its coordinates.
pub(crate) fn point(value: &Value) -> Option<P2> {
    let pair = value.as_array().filter(|p| p.len() == 2)?;
    let x = pair.first()?.as_f64()?;
    let y = pair.get(1)?.as_f64()?;
    (x.abs() <= MAX_COORDINATE && y.abs() <= MAX_COORDINATE).then_some([x, y])
}

fn integer(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.fract() == 0.0)
}

/// A fraction 0–1 (clamped); anything else is absent.
fn fraction(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite())
        .map(|f| f.clamp(0.0, 1.0))
}

fn color(value: Option<&Value>) -> Option<Rgb8> {
    value.and_then(Value::as_str).and_then(Rgb8::from_hex)
}

fn text(value: Option<&Value>, max: usize) -> String {
    value
        .and_then(Value::as_str)
        .map_or_else(String::new, |s| clip(s, max))
}

/// Cuts a text to `max` characters (code points), never inside one.
fn clip(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((byte, _)) => text[..byte].to_owned(),
        None => text.to_owned(),
    }
}

/// An angle in degrees normalised to [0, 360).
pub(crate) fn normal_angle(degrees: f64) -> f64 {
    let a = degrees.rem_euclid(360.0);
    if a == 0.0 || a >= 360.0 { 0.0 } else { a }
}
