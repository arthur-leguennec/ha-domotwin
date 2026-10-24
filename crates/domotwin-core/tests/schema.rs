//! The JSON Schema of the plan format lists the kinds, floors, wall finishes and door styles the
//! core reads (`tests/test_examples.py` checks the demo plans against it).

#![allow(clippy::unwrap_used)]

use domotwin_core::plan::{DoorStyle, Floor, Kind, WallStyle};
use serde_json::Value;

const SCHEMA: &str = include_str!("../../../schema/plan.schema.json");

fn names(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect()
}

#[test]
fn the_schema_lists_what_the_core_reads() {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let defs = &schema["$defs"];
    let kinds: Vec<&str> = std::iter::once(Kind::Box)
        .chain(Kind::ALL.iter().copied())
        .map(Kind::name)
        .collect();
    assert_eq!(names(&defs["item"]["properties"]["kind"]["enum"]), kinds);
    let room = &defs["room"]["properties"];
    let floors: Vec<&str> = Floor::ALL.iter().map(|f| f.name()).collect();
    assert_eq!(
        names(&room["floor"]["properties"]["material"]["enum"]),
        floors
    );
    let finishes: Vec<&str> = WallStyle::ALL.iter().map(|w| w.name()).collect();
    assert_eq!(
        names(&room["walls"]["properties"]["finish"]["enum"]),
        finishes
    );
    let styles: Vec<&str> = DoorStyle::ALL.iter().map(|d| d.name()).collect();
    assert_eq!(names(&defs["door"]["properties"]["style"]["enum"]), styles);
    assert_eq!(schema["properties"]["format"]["const"], "domotwin-plan");
}
