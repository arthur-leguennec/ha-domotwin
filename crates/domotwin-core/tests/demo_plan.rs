//! The fictional demo apartment in `examples/` must always load.

#![allow(clippy::unwrap_used)]

use domotwin_core::plan::{Element, Kind};
use domotwin_core::read_plan;

const DEMO: &str = include_str!("../../../examples/demo-apartment.plan.json");

#[test]
fn demo_apartment_reads() {
    let plan = read_plan(DEMO.as_bytes()).unwrap();
    let summary = plan.summary();
    assert_eq!(summary.revision, 10);
    assert_eq!(summary.title, "Demo apartment");
    assert_eq!(
        (
            summary.rooms,
            summary.doors,
            summary.windows,
            summary.furniture
        ),
        (5, 4, 6, 39)
    );
    let bedroom = plan.rooms().find(|r| r.id == "bedroom").unwrap();
    assert_eq!(bedroom.vertices.len(), 5);
    let lamps = plan
        .furniture()
        .filter(|f| f.kind.is_light() && !f.light_off)
        .count();
    assert_eq!(lamps, 11);
    assert!(
        plan.furniture()
            .any(|f| f.kind == Kind::Curtain && f.open == Some(30))
    );
    assert!(matches!(
        plan.element("door-living"),
        Some(Element::Door(_))
    ));
}
