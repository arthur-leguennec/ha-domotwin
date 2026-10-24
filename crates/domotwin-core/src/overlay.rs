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

use std::collections::BTreeMap;

use serde_json::{Map, Value};

/// Most entries kept (twice the plan's 500 elements).
pub const MAX_ENTRIES: usize = 1000;
/// Most elements a plan may hold.
const MAX_ELEMENTS: usize = 500;
/// Longest id kept.
const MAX_ID: usize = 100;
/// Farthest coordinate of the plan format (cm).
const MAX_COORDINATE: f64 = 50_000.0;

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

/// Writes the entry's changes into a piece's element.
fn place(element: &mut Map<String, Value>, entry: &Entry) {
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
    if let Some(parent) = &entry.parent {
        element.insert("parent".into(), Value::String(parent.clone()));
    }
}

/// The plan with the overlay applied: pieces moved, removed and added. Entries for ids the plan
/// does not have (removed from an updated plan), for elements other than furniture, and added
/// pieces past the plan's 500 elements are ignored. Not a plan object: returned as it is.
pub fn apply(plan: &Value, layout: &Layout) -> Value {
    let mut plan = plan.clone();
    let Some(elements) = plan.get_mut("elements").and_then(Value::as_array_mut) else {
        return plan;
    };
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
                place(object, entry);
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
        place(&mut element, entry);
        elements.push(Value::Object(element));
    }
    plan
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
    }
}
