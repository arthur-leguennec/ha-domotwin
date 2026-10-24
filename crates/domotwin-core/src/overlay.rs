//! The edit overlay (`layout`) stored beside the imported plan: pieces moved, turned, raised, put
//! in another room, removed or added in edit mode, keyed by element id. The imported plan is never
//! changed; the overlay is applied to its JSON before it is read, so re-importing an updated plan
//! keeps the edits of the pieces that still exist (`docs/DECISIONS.md`, D-005 and D-019).
//!
//! ```json
//! {
//!   "sofa": { "x": 360, "y": 110, "angle": 90 },
//!   "plant": { "removed": true },
//!   "lamp-1700000000": { "add": { "name": "Lamp", "kind": "lamp", "w": 35, "h": 35, "z": 160 },
//!                        "x": 40, "y": 20, "parent": "living" }
//! }
//! ```
//!
//! Only pieces of furniture are edited: rooms, walls, doors and windows belong to the plan.
//!
//! User models imported in edit mode are entries too, keyed `@model:<model id>` (D-021): they are
//! added to the plan's `models` (a model the plan already has stays the plan's), so they follow
//! undo, drafts, saving and Export like the pieces that show them.
//!
//! ```json
//! { "@model:m-1": { "model": { "name": "Stool", "size": [38, 38, 71],
//!                              "file": { "format": "glb", "hash": "…", "bytes": 19012, "up": "y" } } } }
//! ```

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::ReadError;
use crate::plan::{Plan, read_plan_value};

/// Most entries kept (twice the plan's 500 elements).
pub const MAX_ENTRIES: usize = 1000;
/// Most elements a plan may hold.
pub const MAX_ELEMENTS: usize = 500;
/// Longest id kept.
const MAX_ID: usize = 100;
/// Farthest coordinate of the plan format (cm).
const MAX_COORDINATE: f64 = 50_000.0;
/// The key prefix of model entries.
pub const MODEL_PREFIX: &str = "@model:";

/// Whether a model id is valid (`plan-format.md`, user 3D models).
pub fn valid_model_id(id: &str) -> bool {
    id.len() <= 64
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// What edit mode changed for one piece.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Entry {
    /// Left of the unrotated box (cm).
    pub x: Option<f64>,
    /// Top of the unrotated box (cm).
    pub y: Option<f64>,
    /// Rotation (degrees, 0–360).
    pub angle: Option<f64>,
    /// Height of the underside (cm).
    pub elevation: Option<f64>,
    /// The room it now follows (`""`: none).
    pub parent: Option<String>,
    /// Taken out of the home.
    pub removed: bool,
    /// A piece added in edit mode: its element (without `id` and `type`).
    pub add: Option<Map<String, Value>>,
    /// A user model added in edit mode (entries keyed [`MODEL_PREFIX`] + its id).
    pub model: Option<Map<String, Value>>,
}

impl Entry {
    /// Whether the entry changes nothing.
    pub fn is_empty(&self) -> bool {
        *self == Entry::default()
    }
}

/// The overlay, by element id.
pub type Layout = BTreeMap<String, Entry>;

fn finite(value: Option<&Value>, max: f64) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.abs() <= max)
}

/// Reads an overlay from JSON text leniently (not JSON: an empty overlay).
pub fn parse_layout(text: &str) -> Layout {
    serde_json::from_str(text).map_or_else(|_| Layout::new(), |value| read_layout(&value))
}

/// Reads a stored overlay leniently: anything malformed is left out.
pub fn read_layout(value: &Value) -> Layout {
    let mut layout = Layout::new();
    let Some(entries) = value.as_object() else {
        return layout;
    };
    for (id, raw) in entries.iter().take(MAX_ENTRIES) {
        let Some(raw) = raw.as_object() else { continue };
        if id.is_empty() || id.chars().count() > MAX_ID {
            continue;
        }
        if let Some(model_id) = id.strip_prefix(MODEL_PREFIX) {
            if let Some(model) = raw.get("model").and_then(Value::as_object)
                && valid_model_id(model_id)
            {
                let entry = Entry {
                    model: Some(model.clone()),
                    ..Entry::default()
                };
                layout.insert(id.clone(), entry);
            }
            continue;
        }
        let entry = Entry {
            x: finite(raw.get("x"), MAX_COORDINATE),
            y: finite(raw.get("y"), MAX_COORDINATE),
            angle: finite(raw.get("angle"), 1e6).map(|a| a.rem_euclid(360.0)),
            elevation: finite(raw.get("elevation"), 300.0).map(|e| e.max(0.0)),
            parent: raw
                .get("parent")
                .and_then(Value::as_str)
                .filter(|p| p.chars().count() <= MAX_ID)
                .map(str::to_owned),
            removed: raw.get("removed").and_then(Value::as_bool) == Some(true),
            add: raw.get("add").and_then(Value::as_object).cloned(),
            model: None,
        };
        if !entry.is_empty() {
            layout.insert(id.clone(), entry);
        }
    }
    layout
}

fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// The overlay as stored.
pub fn layout_value(layout: &Layout) -> Value {
    let mut out = Map::new();
    for (id, entry) in layout {
        let mut e = Map::new();
        if let Some(model) = &entry.model {
            e.insert("model".into(), Value::Object(model.clone()));
        }
        if let Some(add) = &entry.add {
            e.insert("add".into(), Value::Object(add.clone()));
        }
        if entry.removed {
            e.insert("removed".into(), Value::Bool(true));
        }
        for (key, v) in [
            ("x", entry.x),
            ("y", entry.y),
            ("angle", entry.angle),
            ("elevation", entry.elevation),
        ] {
            if let Some(v) = v {
                e.insert(key.into(), Value::from(round(v)));
            }
        }
        if let Some(parent) = &entry.parent {
            e.insert("parent".into(), Value::String(parent.clone()));
        }
        if !e.is_empty() {
            out.insert(id.clone(), Value::Object(e));
        }
    }
    Value::Object(out)
}

/// Writes the entry's changes into a piece's element. A room the plan does not have (renamed in an
/// updated plan) is not followed: the piece keeps its own.
fn place(element: &mut Map<String, Value>, entry: &Entry, rooms: &[String]) {
    for (key, v) in [("x", entry.x), ("y", entry.y), ("angle", entry.angle)] {
        if let Some(v) = v {
            element.insert(key.into(), Value::from(round(v)));
        }
    }
    match entry.elevation {
        Some(e) if e > 0.0 => {
            element.insert("elevation".into(), Value::from(round(e)));
        }
        Some(_) => {
            element.remove("elevation");
        }
        None => {}
    }
    if let Some(parent) = entry
        .parent
        .as_ref()
        .filter(|p| p.is_empty() || rooms.contains(*p))
    {
        element.insert("parent".into(), Value::String(parent.clone()));
    }
}

/// The plan with the overlay applied: pieces moved, removed and added. Entries for ids the plan
/// does not have (removed from an updated plan), for elements other than furniture, and added
/// pieces past the plan's 500 elements are ignored. Not a plan object: returned as it is.
pub fn apply(plan: &Value, layout: &Layout) -> Value {
    let mut plan = plan.clone();
    let models: Vec<(&str, &Map<String, Value>)> = layout
        .iter()
        .filter_map(|(id, entry)| Some((id.strip_prefix(MODEL_PREFIX)?, entry.model.as_ref()?)))
        .collect();
    if !models.is_empty()
        && let Some(root) = plan.as_object_mut()
    {
        let slot = root
            .entry("models")
            .or_insert_with(|| Value::Object(Map::new()));
        if slot.is_null() {
            *slot = Value::Object(Map::new());
        }
        if let Some(existing) = slot.as_object_mut() {
            for (id, model) in models {
                existing
                    .entry(id)
                    .or_insert_with(|| Value::Object(model.clone()));
            }
        }
    }
    let Some(elements) = plan.get_mut("elements").and_then(Value::as_array_mut) else {
        return plan;
    };
    let rooms: Vec<String> = elements
        .iter()
        .filter(|e| e.get("type").and_then(Value::as_str) == Some("room"))
        .filter_map(|e| e.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let mut ids: Vec<String> = Vec::with_capacity(elements.len());
    elements.retain_mut(|element| {
        let Some(object) = element.as_object_mut() else {
            return true;
        };
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let furniture = object.get("type").and_then(Value::as_str) == Some("furniture");
        let entry = layout.get(&id).filter(|_| furniture);
        ids.push(id);
        match entry {
            Some(entry) if entry.removed => false,
            Some(entry) => {
                place(object, entry, &rooms);
                true
            }
            None => true,
        }
    });
    for (id, entry) in layout {
        let Some(add) = &entry.add else { continue };
        if entry.removed || ids.contains(id) || elements.len() >= MAX_ELEMENTS {
            continue;
        }
        let mut element = add.clone();
        element.insert("id".into(), Value::String(id.clone()));
        element.insert("type".into(), Value::String("furniture".into()));
        place(&mut element, entry, &rooms);
        elements.push(Value::Object(element));
    }
    plan
}

/// The plan read with as much of the overlay as it accepts: when the whole overlay makes the plan
/// invalid (an updated plan, an entry written by hand), its entries are tried one by one and those
/// that make it invalid are left out. Returns the plan, the overlay kept and how many entries were
/// left out.
///
/// # Errors
///
/// The reader's error when the plan is invalid without any overlay.
pub fn fit(source: &Value, layout: &Layout) -> Result<(Plan, Layout, usize), ReadError> {
    if let Ok(plan) = read_plan_value(&apply(source, layout)) {
        return Ok((plan, layout.clone(), 0));
    }
    let mut plan = read_plan_value(source)?;
    let mut kept = Layout::new();
    // Models first: the pieces that show them need them.
    let (models, pieces): (Vec<_>, Vec<_>) = layout
        .iter()
        .partition(|(id, _)| id.starts_with(MODEL_PREFIX));
    for (id, entry) in models.into_iter().chain(pieces) {
        kept.insert(id.clone(), entry.clone());
        match read_plan_value(&apply(source, &kept)) {
            Ok(read) => plan = read,
            Err(_) => {
                kept.remove(id);
            }
        }
    }
    let left = layout.len() - kept.len();
    Ok((plan, kept, left))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::Element;
    use crate::read_plan;

    const DEMO: &str = include_str!("../../../examples/demo-apartment.plan.json");

    fn furniture<'a>(plan: &'a crate::Plan, id: &str) -> Option<&'a crate::plan::Furniture> {
        plan.elements.iter().find_map(|e| match e {
            Element::Furniture(f) if f.id == id => Some(f),
            _ => None,
        })
    }

    #[test]
    fn moves_removes_and_adds() {
        let plan: Value = serde_json::from_str(DEMO).unwrap();
        let layout = read_layout(&serde_json::json!({
            "sofa": { "x": 300, "y": 120.5, "angle": 450, "elevation": 0 },
            "plant-living": { "removed": true },
            "living": { "x": 9999 },
            "nothing-here": { "x": 1 },
            "lamp-new": { "add": { "name": "Lamp", "kind": "lamp", "w": 35, "h": 35, "z": 160 },
                          "x": 40, "y": 20, "parent": "living" },
            "bad": 3,
            "": { "x": 1 },
            "far": { "x": 1e9 }
        }));
        assert_eq!(layout.len(), 5);
        assert_eq!(layout["sofa"].angle, Some(90.0));
        assert!(!layout.contains_key("far"), "out of range: nothing left");
        let applied = apply(&plan, &layout);
        let read = read_plan(serde_json::to_string(&applied).unwrap().as_bytes()).unwrap();
        let sofa = furniture(&read, "sofa").unwrap();
        assert_eq!((sofa.x, sofa.y, sofa.angle), (300.0, 120.5, 90.0));
        assert!(furniture(&read, "plant-living").is_none());
        let lamp = furniture(&read, "lamp-new").unwrap();
        assert_eq!(
            (lamp.x, lamp.y, lamp.parent.as_str()),
            (40.0, 20.0, "living")
        );
        // Rooms are not edited.
        let original = read_plan(DEMO.as_bytes()).unwrap();
        let room = |p: &crate::Plan| match &p.elements[0] {
            Element::Room(r) => r.x,
            _ => f64::NAN,
        };
        assert_eq!(room(&read), room(&original));
        // Stored back as it was read.
        assert_eq!(read_layout(&layout_value(&layout)), layout);
        assert_eq!(parse_layout(&layout_value(&layout).to_string()), layout);
        assert!(parse_layout("not json").is_empty());
    }

    #[test]
    fn adds_models() {
        let plan: Value = serde_json::from_str(DEMO).unwrap();
        let stool = serde_json::json!({ "name": "Stool", "size": [38, 38, 71],
            "file": { "format": "glb", "hash": "a".repeat(64), "bytes": 100, "up": "y" } });
        let layout = read_layout(&serde_json::json!({
            "@model:m-1": { "model": stool },
            "@model:bad id": { "model": stool },
            "@model:m-2": { "x": 1 },
            // Sorted before the model: the piece must still find it.
            "1-stool": { "add": { "name": "Stool", "kind": "custom", "model": "m-1", "w": 38, "h": 38, "z": 71 },
                         "x": 40, "y": 20 },
            "2-bad": { "add": { "name": "Bad", "kind": "custom", "model": "m-9", "w": 38, "h": 38, "z": 71 } }
        }));
        assert_eq!(layout.len(), 3);
        assert_eq!(read_layout(&layout_value(&layout)), layout);
        let (read, kept, left) = fit(&plan, &layout).unwrap();
        assert_eq!(left, 1, "the piece of an unknown model");
        assert!(kept.contains_key("1-stool") && kept.contains_key("@model:m-1"));
        assert_eq!(read.models["m-1"]["name"], "Stool");
        assert_eq!(
            furniture(&read, "1-stool").unwrap().model.as_deref(),
            Some("m-1")
        );
        // A model the plan already has stays the plan's.
        let mut with_model = plan.clone();
        with_model["models"] = serde_json::json!({ "m-1": { "name": "Plan's", "size": [1, 1, 1], "kit": { "parts": [] } } });
        let applied = apply(&with_model, &layout);
        assert_eq!(applied["models"]["m-1"]["name"], "Plan's");
    }

    #[test]
    fn keeps_what_the_plan_accepts() {
        let plan: Value = serde_json::from_str(DEMO).unwrap();
        let layout = read_layout(&serde_json::json!({
            "sofa": { "x": 300 },
            // A room the plan does not have: the piece keeps its own.
            "armchair": { "x": 200, "parent": "old-room" },
            // An added piece the reader refuses (no height).
            "bad-added-1": { "add": { "name": "Bad", "kind": "lamp", "w": 35, "h": 35 } }
        }));
        let (read, kept, left) = fit(&plan, &layout).unwrap();
        assert_eq!(left, 1);
        assert!(!kept.contains_key("bad-added-1"));
        let armchair = furniture(&read, "armchair").unwrap();
        assert_eq!((armchair.x, armchair.parent.as_str()), (200.0, "living"));
        assert_eq!(furniture(&read, "sofa").unwrap().x, 300.0);
    }
}
