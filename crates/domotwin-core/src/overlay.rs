//! The edit overlay (`layout`) stored beside the imported plan: items moved, turned, raised, put
//! in another room, removed or added in edit mode, keyed by element id. The imported plan is never
//! changed; the overlay is applied to its JSON before it is read, so re-importing an updated plan
//! keeps the edits of the items that still exist (`docs/DECISIONS.md`, D-005 and D-019).
//!
//! ```json
//! {
//!   "sofa": { "at": [405, 215], "rotation": 90 },
//!   "plant": { "removed": true },
//!   "lamp-1700000000": { "add": { "name": "Lamp", "kind": "floor-lamp", "size": [35, 35, 160] },
//!                        "at": [58, 38], "room": "living" }
//! }
//! ```
//!
//! Only items are edited: rooms, partitions, doors and windows belong to the plan.
//!
//! User models imported in edit mode are entries too, keyed `@model:<model id>` (D-021): they are
//! added to the plan's `models` (a model the plan already has stays the plan's), so they follow
//! undo, drafts, saving and Export like the items that show them.
//!
//! ```json
//! { "@model:m-1": { "model": { "name": "Stool", "size": [38, 38, 71],
//!                              "file": { "format": "glb", "hash": "…", "bytes": 19012, "up": "y" } } } }
//! ```

use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value};

use crate::ReadError;
pub use crate::plan::MAX_ELEMENTS;
use crate::plan::{LISTS, MAX_ID, Plan, point, read_plan_value, valid_model_id};

/// Most entries kept (twice the plan's 500 elements).
pub const MAX_ENTRIES: usize = 1000;
/// The key prefix of model entries.
pub const MODEL_PREFIX: &str = "@model:";

/// What edit mode changed for one item.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Entry {
    /// The centre of its footprint (cm).
    pub at: Option<[f64; 2]>,
    /// Rotation (degrees, 0–360).
    pub rotation: Option<f64>,
    /// Height of the underside (cm).
    pub lift: Option<f64>,
    /// The room it now belongs to (`""`: none).
    pub room: Option<String>,
    /// Taken out of the home.
    pub removed: bool,
    /// An item added in edit mode: its fields (without `id`).
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
            at: raw.get("at").and_then(point),
            rotation: finite(raw.get("rotation"), 1e6).map(|a| a.rem_euclid(360.0)),
            lift: finite(raw.get("lift"), 300.0).map(|e| e.max(0.0)),
            room: raw
                .get("room")
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

fn point_value(p: [f64; 2]) -> Value {
    Value::from(vec![round(p[0]), round(p[1])])
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
        if let Some(at) = entry.at {
            e.insert("at".into(), point_value(at));
        }
        for (key, v) in [("rotation", entry.rotation), ("lift", entry.lift)] {
            if let Some(v) = v {
                e.insert(key.into(), Value::from(round(v)));
            }
        }
        if let Some(room) = &entry.room {
            e.insert("room".into(), Value::String(room.clone()));
        }
        if !e.is_empty() {
            out.insert(id.clone(), Value::Object(e));
        }
    }
    Value::Object(out)
}

/// Writes the entry's changes into an item. A room the plan does not have (renamed in an updated
/// plan) is not followed: the item keeps its own.
fn place(item: &mut Map<String, Value>, entry: &Entry, rooms: &[String]) {
    if let Some(at) = entry.at {
        item.insert("at".into(), point_value(at));
    }
    if let Some(rotation) = entry.rotation {
        item.insert("rotation".into(), Value::from(round(rotation)));
    }
    match entry.lift {
        Some(e) if e > 0.0 => {
            item.insert("lift".into(), Value::from(round(e)));
        }
        Some(_) => {
            item.remove("lift");
        }
        None => {}
    }
    if let Some(room) = entry
        .room
        .as_ref()
        .filter(|p| p.is_empty() || rooms.contains(*p))
    {
        if room.is_empty() {
            item.remove("room");
        } else {
            item.insert("room".into(), Value::String(room.clone()));
        }
    }
}

/// The plan with the overlay applied: items moved, removed and added. Entries for ids the plan
/// does not have (removed from an updated plan), for elements other than items, and added items
/// past the plan's 500 elements are ignored. Not a plan object: returned as it is.
pub fn apply(plan: &Value, layout: &Layout) -> Value {
    let mut plan = plan.clone();
    let models: Vec<(&str, &Map<String, Value>)> = layout
        .iter()
        .filter_map(|(id, entry)| Some((id.strip_prefix(MODEL_PREFIX)?, entry.model.as_ref()?)))
        .collect();
    let Some(root) = plan.as_object_mut() else {
        return plan;
    };
    if !models.is_empty() {
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
    let ids_of = |key: &str| -> Vec<String> {
        root.get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|e| e.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect()
    };
    let rooms = ids_of("rooms");
    let ids: HashSet<String> = LISTS.iter().flat_map(|(key, _)| ids_of(key)).collect();
    let count = ids.len();
    let items = root
        .entry("items")
        .or_insert_with(|| Value::Array(Vec::new()));
    // Null is an empty list, as the reader reads it.
    if items.is_null() {
        *items = Value::Array(Vec::new());
    }
    let Some(items) = items.as_array_mut() else {
        return plan;
    };
    let mut removed = 0;
    items.retain_mut(|item| {
        let Some(object) = item.as_object_mut() else {
            return true;
        };
        let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
        match layout.get(id) {
            Some(entry) if entry.removed => {
                removed += 1;
                false
            }
            Some(entry) => {
                place(object, entry, &rooms);
                true
            }
            None => true,
        }
    });
    let mut count = count - removed;
    for (id, entry) in layout {
        let Some(add) = &entry.add else { continue };
        if entry.removed || ids.contains(id) || count >= MAX_ELEMENTS {
            continue;
        }
        let mut item = add.clone();
        item.insert("id".into(), Value::String(id.clone()));
        place(&mut item, entry, &rooms);
        items.push(Value::Object(item));
        count += 1;
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

    const DEMO: &str = include_str!("../../../examples/demo-apartment.domotwin.json");

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
            "sofa": { "at": [345, 165.5], "rotation": 450, "lift": 0 },
            "plant-living": { "removed": true },
            "living": { "at": [9999, 0] },
            "nothing-here": { "at": [1, 1] },
            "lamp-new": { "add": { "name": "Lamp", "kind": "floor-lamp", "size": [35, 35, 160] },
                          "at": [57.5, 37.5], "room": "living" },
            "bad": 3,
            "": { "at": [1, 1] },
            "far": { "at": [1e9, 0] }
        }));
        assert_eq!(layout.len(), 5);
        assert_eq!(layout["sofa"].rotation, Some(90.0));
        assert!(!layout.contains_key("far"), "out of range: nothing left");
        let applied = apply(&plan, &layout);
        let read = read_plan(serde_json::to_string(&applied).unwrap().as_bytes()).unwrap();
        let sofa = furniture(&read, "sofa").unwrap();
        assert_eq!((sofa.center(), sofa.angle), ([345.0, 165.5], 90.0));
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
            "@model:m-2": { "at": [1, 1] },
            // Sorted before the model: the item must still find it.
            "1-stool": { "add": { "name": "Stool", "model": "m-1", "size": [38, 38, 71] },
                         "at": [59, 39] },
            "2-bad": { "add": { "name": "Bad", "model": "m-9", "size": [38, 38, 71] }, "at": [0, 0] }
        }));
        assert_eq!(layout.len(), 3);
        assert_eq!(read_layout(&layout_value(&layout)), layout);
        let (read, kept, left) = fit(&plan, &layout).unwrap();
        assert_eq!(left, 1, "the item of an unknown model");
        assert!(kept.contains_key("1-stool") && kept.contains_key("@model:m-1"));
        assert_eq!(read.models["m-1"]["name"], "Stool");
        assert_eq!(
            furniture(&read, "1-stool").unwrap().model.as_deref(),
            Some("m-1")
        );
        // A model the plan already has stays the plan's.
        let mut with_model = plan.clone();
        let mut own = stool.clone();
        own["name"] = serde_json::json!("Plan's");
        with_model["models"] = serde_json::json!({ "m-1": own });
        let applied = apply(&with_model, &layout);
        assert_eq!(applied["models"]["m-1"]["name"], "Plan's");
    }

    #[test]
    fn keeps_what_the_plan_accepts() {
        let plan: Value = serde_json::from_str(DEMO).unwrap();
        let layout = read_layout(&serde_json::json!({
            "sofa": { "at": [345, 210] },
            // A room the plan does not have: the item keeps its own.
            "armchair": { "at": [240, 300], "room": "old-room" },
            // An added item the reader refuses (no height).
            "bad-added-1": { "add": { "name": "Bad", "kind": "floor-lamp", "size": [35, 35] },
                             "at": [10, 10] }
        }));
        let (read, kept, left) = fit(&plan, &layout).unwrap();
        assert_eq!(left, 1);
        assert!(!kept.contains_key("bad-added-1"));
        let armchair = furniture(&read, "armchair").unwrap();
        assert_eq!(
            (armchair.center(), armchair.parent.as_str()),
            ([240.0, 300.0], "living")
        );
        assert_eq!(furniture(&read, "sofa").unwrap().center(), [345.0, 210.0]);
    }

    #[test]
    fn a_null_list_of_items_takes_added_ones() {
        let plan = serde_json::json!({
            "format": "domotwin-plan", "version": 1, "items": null,
            "rooms": [{ "id": "a", "outline": [[0, 0], [300, 0], [300, 300], [0, 300]] }]
        });
        let layout = read_layout(&serde_json::json!({
            "lamp": { "add": { "kind": "floor-lamp", "size": [35, 35, 160] }, "at": [50, 50] }
        }));
        let (read, kept, left) = fit(&plan, &layout).unwrap();
        assert_eq!((kept.len(), left), (1, 0));
        assert!(furniture(&read, "lamp").is_some());
    }
}
