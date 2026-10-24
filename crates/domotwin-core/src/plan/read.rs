//! The plan reader: strict on structure, lenient on optional values (`docs/plan-format.md`).
//!
//! Required values that are missing or out of range refuse the whole file with an [`ErrorCode`]
//! and the element concerned. Unknown fields are dropped, invalid optional values get their
//! default, texts are cut to their maximum length (in characters) and older revisions are migrated
//! (revisions 1–10 share the same data). Nothing here panics, whatever the input.

use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value};

use super::catalogue::{DoorStyle, Floor, Kind, Role, WallStyle};
use super::light::{KELVIN_RANGE, POWER_RANGE};
use super::{
    DEFAULT_COLOR, EdgeFinish, Element, Furniture, MAX_COORDINATE, MAX_ELEMENTS, MAX_PLAN_BYTES,
    Opening, PLAN_REVISION, Plan, Rgb8, Room, View, WallSettings,
};
use crate::error::{ErrorCode, ReadError};
use crate::geometry::polygon::{area, self_intersects};

type Object = Map<String, Value>;

const TEXT: usize = 100;
const LONG_TEXT: usize = 300;
const MAX_VERTICES: usize = 64;
const VERTEX_TOLERANCE: f64 = 1e-7;
const DEFAULT_MATERIAL_SOURCE: &str = "Revêtement à confirmer.";
const DEFAULT_FURNITURE_SOURCE: &str = "Implantation proposée ; dimensions estimées.";
const DEFAULT_VIEW_NAME: &str = "Vue";
const MAX_VIEWS: usize = 40;
const MAX_MODELS: usize = 50;

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
/// A [`ReadError`] when a required value is missing or out of range.
pub fn read_plan_value(value: &Value) -> Result<Plan, ReadError> {
    let Value::Object(root) = value else {
        return Err(ReadError::new(ErrorCode::NotAnObject));
    };
    if root.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err(ReadError::new(ErrorCode::BadVersion));
    }
    if root.get("unit").and_then(Value::as_str) != Some("cm") {
        return Err(ReadError::new(ErrorCode::BadUnit));
    }
    let Some(elements) = root.get("elements").and_then(Value::as_array) else {
        return Err(ReadError::new(ErrorCode::NoElements));
    };
    if elements.is_empty() {
        return Err(ReadError::new(ErrorCode::NoElements));
    }
    if elements.len() > MAX_ELEMENTS {
        return Err(ReadError::new(ErrorCode::TooManyElements));
    }
    let source_revision = read_revision(root.get("layoutRevision"))?;
    // Revisions 1 to 10 share the same data: every migration step is the identity.

    let models = read_models(root.get("models"))?;
    let mut plan = Plan {
        source_revision,
        title: text(root.get("title"), TEXT, ""),
        reference_name: text(root.get("referenceName"), TEXT, ""),
        wall_settings: read_wall_settings(root.get("wallSettings"))?,
        elements: Vec::with_capacity(elements.len()),
        views: read_views(root.get("views")),
        site: read_site(root.get("site"))?,
        models,
    };

    let mut ids = HashSet::with_capacity(elements.len());
    for (index, raw) in elements.iter().enumerate() {
        let element = read_element(raw, index, &plan.models)?;
        if !ids.insert(element.id().to_owned()) {
            return Err(ReadError::new(ErrorCode::DuplicateId).at(element.id()));
        }
        plan.elements.push(element);
    }
    check_parents(&plan)?;
    Ok(plan)
}

/// `layoutRevision`: an integer 1–10; anything else counts as 1; a higher integer is refused.
fn read_revision(value: Option<&Value>) -> Result<u32, ReadError> {
    let Some(revision) = value.and_then(integer) else {
        return Ok(1);
    };
    if revision > f64::from(PLAN_REVISION) {
        return Err(ReadError::with_detail(
            ErrorCode::NewerRevision,
            format!("{revision}"),
        ));
    }
    Ok(if revision >= 1.0 { revision as u32 } else { 1 })
}

fn read_wall_settings(value: Option<&Value>) -> Result<WallSettings, ReadError> {
    let defaults = WallSettings::default();
    let Some(Value::Object(map)) = value else {
        return Ok(defaults);
    };
    let field = |key: &str, default: f64| -> Result<f64, ReadError> {
        match map.get(key) {
            None => Ok(default),
            Some(v) => match v.as_f64() {
                Some(n) if (0.0..=100.0).contains(&n) => Ok(n),
                _ => Err(ReadError::new(ErrorCode::WallThickness)),
            },
        }
    };
    let settings = WallSettings {
        interior: field("interior", defaults.interior)?,
        exterior: field("exterior", defaults.exterior)?,
        spacing: field("spacing", defaults.spacing)?,
        reflow: map.get("reflow").is_some_and(truthy),
    };
    if settings.interior < 1.0 || settings.exterior < 1.0 {
        return Err(ReadError::new(ErrorCode::WallThickness));
    }
    Ok(settings)
}

fn read_element(
    raw: &Value,
    index: usize,
    models: &BTreeMap<String, Value>,
) -> Result<Element, ReadError> {
    let invalid = || ReadError::new(ErrorCode::InvalidElement).at(format!("#{index}"));
    let Value::Object(e) = raw else {
        return Err(invalid());
    };
    let id = match e.get("id").and_then(Value::as_str) {
        Some(id) if id.chars().count() <= TEXT => id.to_owned(),
        _ => return Err(invalid()),
    };
    let kind = e.get("type").and_then(Value::as_str);
    let Some(name) = e.get("name").and_then(Value::as_str) else {
        return Err(invalid().at(id));
    };
    let name = clip(name, TEXT);
    let at = |code: ErrorCode| ReadError::new(code).at(id.as_str());
    let x = number(e, "x");
    let y = number(e, "y");
    let (Some(x), Some(y)) = (x, y) else {
        return Err(at(ErrorCode::PositionRange));
    };
    if x.abs() > MAX_COORDINATE || y.abs() > MAX_COORDINATE {
        return Err(at(ErrorCode::PositionRange));
    }
    match kind {
        Some("room") => read_room(e, id, name, x, y).map(Element::Room),
        Some("furniture") => read_furniture(e, id, name, x, y, models).map(Element::Furniture),
        Some("wall") => read_wall(e, id, name, x, y),
        Some(kind @ ("door" | "window")) => read_opening(e, id, name, x, y, kind == "door"),
        _ => Err(invalid().at(id)),
    }
}

/// `w`, `h` in range and an optional numeric `angle` (rooms and furniture).
fn read_box(
    e: &Object,
    id: &str,
    range: (f64, f64),
    code: ErrorCode,
) -> Result<(f64, f64, f64), ReadError> {
    let w = number(e, "w").filter(|w| (range.0..=range.1).contains(w));
    let h = number(e, "h").filter(|h| (range.0..=range.1).contains(h));
    let (Some(w), Some(h)) = (w, h) else {
        return Err(ReadError::new(code).at(id));
    };
    let angle = match e.get("angle") {
        None => 0.0,
        Some(v) => match v.as_f64() {
            Some(a) => normal_angle(a),
            None => return Err(ReadError::new(ErrorCode::InvalidAngle).at(id)),
        },
    };
    Ok((w, h, angle))
}

fn read_room(e: &Object, id: String, name: String, x: f64, y: f64) -> Result<Room, ReadError> {
    let (w, h, angle) = read_box(e, &id, (5.0, 10_000.0), ErrorCode::RoomSize)?;
    let at = |code: ErrorCode| ReadError::new(code).at(id.as_str());
    let raw_bevel = number(e, "bevel");
    let bevel = raw_bevel.map_or(0.0, |b| b.max(0.0).min(w - 5.0).max(0.0));

    // The polygon: `vertices`, else the legacy bevel trapezoid, else the frame rectangle.
    let vertices: Vec<[f64; 2]> = match e.get("vertices") {
        Some(Value::Array(points)) => {
            let mut out = Vec::with_capacity(points.len());
            for point in points {
                let pair = point.as_array().filter(|p| p.len() == 2);
                let u = pair.and_then(|p| p.first()).and_then(Value::as_f64);
                let v = pair.and_then(|p| p.get(1)).and_then(Value::as_f64);
                match (u, v) {
                    (Some(u), Some(v)) if in_unit(u) && in_unit(v) => out.push([u, v]),
                    _ => return Err(at(ErrorCode::VertexCount)),
                }
            }
            out
        }
        _ => match raw_bevel.filter(|b| *b != 0.0) {
            Some(b) => vec![[0.0, 0.0], [1.0, 0.0], [1.0 - b / w, 1.0], [0.0, 1.0]],
            None => vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        },
    };
    if !(3..=MAX_VERTICES).contains(&vertices.len())
        || !vertices.iter().flatten().all(|c| in_unit(*c))
    {
        return Err(at(ErrorCode::VertexCount));
    }
    if self_intersects(&vertices) {
        return Err(at(ErrorCode::SelfIntersection));
    }
    if area(&vertices) * w * h < 25.0 {
        return Err(at(ErrorCode::MinArea));
    }
    let sides = vertices.len();
    let open_edges = match e.get("openEdges") {
        None => Vec::new(),
        Some(Value::Array(list)) => {
            let mut edges = Vec::with_capacity(list.len());
            for side in list {
                match integer(side) {
                    Some(i) if i >= 0.0 && (i as usize) < sides => edges.push(i as usize),
                    _ => return Err(at(ErrorCode::OpenEdgeRange)),
                }
            }
            edges.sort_unstable();
            edges.dedup();
            edges
        }
        Some(_) => return Err(at(ErrorCode::InvalidOpenEdges)),
    };
    let edge_thickness = match e.get("edgeThickness") {
        None => vec![None; sides],
        Some(Value::Array(list)) if list.len() == sides => {
            let mut out = Vec::with_capacity(sides);
            for t in list {
                match t {
                    Value::Null => out.push(None),
                    _ => match t.as_f64() {
                        Some(t) if (1.0..=100.0).contains(&t) => out.push(Some(t)),
                        _ => return Err(at(ErrorCode::InvalidEdgeThickness)),
                    },
                }
            }
            out
        }
        Some(_) => return Err(at(ErrorCode::InvalidEdgeThickness)),
    };
    let edge_finish = match e.get("edgeFinish") {
        Some(Value::Array(list)) if list.iter().any(truthy) => Some(
            (0..sides)
                .map(|i| match list.get(i) {
                    Some(Value::String(s)) if s == "metro" => Some(EdgeFinish::Metro),
                    Some(Value::String(s)) => Rgb8::from_hex(s).map(EdgeFinish::Paint),
                    _ => None,
                })
                .collect(),
        ),
        _ => None,
    };
    Ok(Room {
        id,
        name,
        x,
        y,
        w,
        h,
        angle,
        color: color(e.get("color")).unwrap_or(DEFAULT_COLOR),
        estimated: e.get("estimated").is_some_and(truthy),
        role: e
            .get("role")
            .and_then(Value::as_str)
            .map_or(Role::Room, Role::from_name),
        floor: e
            .get("floor")
            .and_then(Value::as_str)
            .map_or(Floor::Plain, Floor::from_name),
        floor_angle: number(e, "floorAngle").map_or(0.0, normal_angle),
        wall_style: e
            .get("wallStyle")
            .and_then(Value::as_str)
            .map_or(WallStyle::White, WallStyle::from_name),
        wall_color: color(e.get("wallColor")),
        cornice: e.get("cornice") == Some(&Value::Bool(true)),
        rounded_casing: e.get("casing").and_then(Value::as_str) == Some("arrondi"),
        material_source: text(e.get("materialSource"), LONG_TEXT, DEFAULT_MATERIAL_SOURCE),
        bevel,
        vertices,
        open_edges,
        edge_thickness,
        edge_finish,
    })
}

fn read_furniture(
    e: &Object,
    id: String,
    name: String,
    x: f64,
    y: f64,
    models: &BTreeMap<String, Value>,
) -> Result<Furniture, ReadError> {
    let (w, h, angle) = read_box(e, &id, (1.0, 10_000.0), ErrorCode::FurnitureSize)?;
    let at = |code: ErrorCode| ReadError::new(code).at(id.as_str());
    let z = number(e, "z")
        .filter(|z| (1.0..=300.0).contains(z))
        .ok_or_else(|| at(ErrorCode::FurnitureHeight))?;
    let elevation = match e.get("elevation") {
        None => 0.0,
        Some(v) => match v.as_f64() {
            Some(el) if (0.0..=300.0).contains(&el) => el,
            _ => return Err(at(ErrorCode::ElevationRange)),
        },
    };
    let kind = e
        .get("kind")
        .and_then(Value::as_str)
        .and_then(Kind::from_name)
        .unwrap_or(Kind::Desk);
    let model = if kind == Kind::Custom {
        match e.get("model").and_then(Value::as_str) {
            Some(model) if models.contains_key(model) => Some(model.to_owned()),
            _ => return Err(at(ErrorCode::MissingModel)),
        }
    } else {
        None
    };
    let light = kind.is_light();
    let light_color = if light {
        color(e.get("lightColor"))
    } else {
        None
    };
    let light_kelvin = if light && light_color.is_none() {
        number(e, "lightKelvin").map(|k| k.clamp(KELVIN_RANGE.0, KELVIN_RANGE.1).round() as u16)
    } else {
        None
    };
    let light_power = if light {
        number(e, "lightPower")
            .map(|p| p.clamp(POWER_RANGE.0, POWER_RANGE.1).round() as u16)
            .filter(|p| *p != 100)
    } else {
        None
    };
    let variant = e
        .get("variant")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty() && kind.has_variant(v))
        .map(str::to_owned);
    let open = if kind == Kind::Curtain {
        open_value(e.get("open")).map(|v| v.round().clamp(0.0, 100.0) as u8)
    } else {
        None
    };
    Ok(Furniture {
        id,
        name,
        x,
        y,
        w,
        h,
        z,
        angle,
        color: color(e.get("color")).unwrap_or(DEFAULT_COLOR),
        role: e
            .get("role")
            .and_then(Value::as_str)
            .map_or(Role::Room, Role::from_name),
        kind,
        model,
        variant,
        parent: e
            .get("parent")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        source: text(e.get("source"), LONG_TEXT, DEFAULT_FURNITURE_SOURCE),
        elevation,
        locked: e.get("locked") == Some(&Value::Bool(true)),
        open,
        light_off: light && e.get("lightOff") == Some(&Value::Bool(true)),
        light_color,
        light_kelvin,
        light_power,
    })
}

fn read_wall(e: &Object, id: String, name: String, x: f64, y: f64) -> Result<Element, ReadError> {
    let x2 = number(e, "x2").filter(|v| v.abs() <= MAX_COORDINATE);
    let y2 = number(e, "y2").filter(|v| v.abs() <= MAX_COORDINATE);
    let thickness = number(e, "thickness").filter(|t| (1.0..=100.0).contains(t));
    match (x2, y2, thickness) {
        (Some(x2), Some(y2), Some(thickness)) if (x2 - x).hypot(y2 - y) >= 5.0 => {
            Ok(Element::Wall(super::FreeWall {
                id,
                name,
                x,
                y,
                x2,
                y2,
                thickness,
                parent: e
                    .get("parent")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            }))
        }
        _ => Err(ReadError::new(ErrorCode::InvalidWall).at(id)),
    }
}

fn read_opening(
    e: &Object,
    id: String,
    name: String,
    x: f64,
    y: f64,
    door: bool,
) -> Result<Element, ReadError> {
    let range = if door { (20.0, 300.0) } else { (20.0, 1_000.0) };
    let w = number(e, "w").filter(|w| (range.0..=range.1).contains(w));
    let angle = number(e, "angle");
    let (Some(w), Some(angle)) = (w, angle) else {
        return Err(ReadError::new(ErrorCode::InvalidOpening).at(id));
    };
    let mut opening = Opening {
        id,
        name,
        x,
        y,
        w,
        angle: normal_angle(angle),
        swing: if e.get("swing").and_then(Value::as_f64) == Some(-1.0) {
            -1
        } else {
            1
        },
        parent: e
            .get("parent")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        style: DoorStyle::Hinged,
        open: None,
    };
    if !door {
        return Ok(Element::Window(opening));
    }
    opening.style = e
        .get("style")
        .and_then(Value::as_str)
        .map_or(DoorStyle::Hinged, DoorStyle::from_name);
    // 100 (fully open) is not stored: absent means open.
    opening.open = open_value(e.get("open"))
        .filter(|v| *v < 100.0)
        .map(|v| v.round().max(0.0) as u8);
    Ok(Element::Door(opening))
}

/// Every non-empty `parent` names a room.
fn check_parents(plan: &Plan) -> Result<(), ReadError> {
    let rooms: HashSet<&str> = plan.rooms().map(|room| room.id.as_str()).collect();
    for element in &plan.elements {
        let parent = match element {
            Element::Room(_) => continue,
            Element::Wall(w) => &w.parent,
            Element::Door(o) | Element::Window(o) => &o.parent,
            Element::Furniture(f) => &f.parent,
        };
        if !parent.is_empty() && !rooms.contains(parent.as_str()) {
            return Err(ReadError::new(ErrorCode::MissingParent).at(element.id()));
        }
    }
    Ok(())
}

/// Saved viewpoints: at most 40 read, invalid ones dropped.
fn read_views(value: Option<&Value>) -> Vec<View> {
    let Some(Value::Array(list)) = value else {
        return Vec::new();
    };
    let mut views = Vec::new();
    for (index, item) in list.iter().take(MAX_VIEWS).enumerate() {
        let Value::Object(v) = item else { continue };
        let Some(name) = v.get("name").and_then(Value::as_str) else {
            continue;
        };
        let id = match v.get("id").and_then(Value::as_str) {
            Some(id) if id.chars().count() < 80 => id.to_owned(),
            _ => format!("view-{index}"),
        };
        let name = match clip(name, 60) {
            name if name.is_empty() => DEFAULT_VIEW_NAME.to_owned(),
            name => name,
        };
        match v.get("mode").and_then(Value::as_str) {
            Some("walk") => {
                let (Some(x), Some(y), Some(yaw), Some(pitch)) = (
                    number(v, "x"),
                    number(v, "y"),
                    number(v, "yaw"),
                    number(v, "pitch"),
                ) else {
                    continue;
                };
                if x.abs() >= MAX_COORDINATE || y.abs() >= MAX_COORDINATE {
                    continue;
                }
                let eye = number(v, "eye").map_or(160.0, |e| e.clamp(60.0, 200.0));
                views.push(View::Walk {
                    id,
                    name,
                    x,
                    y,
                    yaw,
                    pitch: pitch.clamp(-1.3, 1.3),
                    eye,
                });
            }
            Some("orbit") => {
                let (Some(p), Some(t)) = (vector3(v.get("p")), vector3(v.get("t"))) else {
                    continue;
                };
                views.push(View::Orbit { id, name, p, t });
            }
            _ => {}
        }
    }
    views
}

fn vector3(value: Option<&Value>) -> Option<[f64; 3]> {
    let list = value?.as_array().filter(|l| l.len() == 3)?;
    let mut out = [0.0; 3];
    for (slot, item) in out.iter_mut().zip(list) {
        let n = item.as_f64().filter(|n| n.abs() < 100_000.0)?;
        *slot = n;
    }
    Some(out)
}

/// `site`: kept as read when it is an object of version 1 (DomoTwin does not draw it).
fn read_site(value: Option<&Value>) -> Result<Option<Value>, ReadError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(site @ Value::Object(map))
            if map.get("version").and_then(Value::as_f64) == Some(1.0) =>
        {
            Ok(Some(site.clone()))
        }
        Some(_) => Err(ReadError::new(ErrorCode::InvalidSite)),
    }
}

/// `models`: an object of at most 50 user models by id, each with a size and a kit or a file.
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
        let valid_id = id.len() <= 64
            && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
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
        let has_kit = fields.get("kit").is_some_and(|k| !k.is_null());
        let has_file = fields.get("file").is_some_and(|f| !f.is_null());
        if !valid_id || !size_ok || has_kit == has_file {
            return Err(ReadError::new(ErrorCode::InvalidModel).at(id.as_str()));
        }
        models.insert(id.clone(), model.clone());
    }
    Ok(models)
}

// ---------------------------------------------------------------- value helpers

fn number(e: &Object, key: &str) -> Option<f64> {
    e.get(key).and_then(Value::as_f64)
}

fn integer(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.fract() == 0.0)
}

fn in_unit(c: f64) -> bool {
    (-VERTEX_TOLERANCE..=1.0 + VERTEX_TOLERANCE).contains(&c)
}

/// JavaScript truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// An `open` value: a number or a numeric string; `null`, `""` and anything else are absent.
fn open_value(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if !s.trim().is_empty() => {
            s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
        }
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn color(value: Option<&Value>) -> Option<Rgb8> {
    value.and_then(Value::as_str).and_then(Rgb8::from_hex)
}

fn text(value: Option<&Value>, max: usize, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .map_or_else(|| fallback.to_owned(), |s| clip(s, max))
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
