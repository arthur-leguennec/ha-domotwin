//! The fictional demo apartment in `examples/` must always load.

#![allow(clippy::unwrap_used)]

use domotwin_core::summarize_plan;

const DEMO: &str = include_str!("../../../examples/demo-apartment.plan.json");

#[test]
fn demo_apartment_summary() {
    let summary = summarize_plan(DEMO.as_bytes()).unwrap();
    assert_eq!(summary.revision, 10);
    assert_eq!(summary.title, "Demo apartment");
    assert_eq!(summary.rooms, 5);
    assert_eq!(summary.doors, 4);
    assert_eq!(summary.windows, 6);
    assert_eq!(summary.furniture, 39);
    assert_eq!(summary.unknown, 0);
}
