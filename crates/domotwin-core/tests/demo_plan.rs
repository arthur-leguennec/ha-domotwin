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

const UPPER: &str = include_str!("../../../examples/demo-upper-floor.plan.json");

#[test]
fn the_upper_floor_reads_with_its_stairs_and_ids_of_its_own() {
    let plan = read_plan(UPPER.as_bytes()).unwrap();
    let summary = plan.summary();
    assert_eq!((summary.rooms, summary.doors, summary.windows), (5, 4, 5));
    assert!(plan.furniture().any(|f| f.kind == Kind::Stairs));
    // Ids are the home's: none is the ground floor's (`DECISIONS.md`, D-026).
    let ground = read_plan(DEMO.as_bytes()).unwrap();
    for element in &plan.elements {
        assert!(ground.element(element.id()).is_none(), "{}", element.id());
    }
    let scene =
        domotwin_core::scene::build_scene(&plan, &domotwin_core::scene::SceneOptions::default());
    assert!(scene.opaque.triangle_count() > 1000);
}
