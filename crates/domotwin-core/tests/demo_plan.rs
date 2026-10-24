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

#[test]
fn the_demo_apartment_is_outlined() {
    use domotwin_core::scene::lines::LineKind;
    use domotwin_core::scene::mesh::NO_GROUP;
    use domotwin_core::scene::{SceneOptions, build_scene};

    let plan = read_plan(DEMO.as_bytes()).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    let count = |kind: LineKind| scene.lines.iter().filter(|l| l.kind == kind).count();
    // Each of the 5 rooms' floor is outlined (the bedroom has 5 corners).
    assert_eq!(count(LineKind::Floor), 4 * 4 + 5);
    // A window's frame has four sides (its sill too), a door's three; the entrance door is on a
    // façade, the three others on partitions that both their rooms outline.
    assert_eq!(count(LineKind::Opening), 6 * 4 + (1 + 3 * 2) * 3);
    assert!(count(LineKind::Wall) > 50);
    let [lo, hi] = scene.bounds;
    let groups = u8::try_from(scene.groups.len()).unwrap();
    for line in &scene.lines {
        for p in [line.a, line.b] {
            for k in 0..3 {
                assert!(
                    p[k] >= lo[k] - 1.0 && p[k] <= hi[k] + 1.0,
                    "{line:?} out of the scene"
                );
            }
        }
        if line.kind == LineKind::Floor {
            assert_eq!(line.group, NO_GROUP);
        } else {
            // Wall lines follow the cut-away of a wall group.
            assert!(line.group < groups, "{line:?}");
        }
    }
}
