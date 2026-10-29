//! The fictional demo apartment in `examples/` must always load.

#![allow(clippy::unwrap_used)]

use domotwin_core::plan::{Element, Kind};
use domotwin_core::read_plan;

const DEMO: &str = include_str!("../../../examples/demo-apartment.domotwin.json");

#[test]
fn demo_apartment_reads() {
    let plan = read_plan(DEMO.as_bytes()).unwrap();
    let summary = plan.summary();
    assert_eq!(summary.name, "Demo apartment");
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

const UPPER: &str = include_str!("../../../examples/demo-upper-floor.domotwin.json");

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
    assert!(scene.parts[0].opaque.triangle_count() > 1000);
}

#[test]
fn the_demo_apartment_is_outlined() {
    use domotwin_core::scene::lines::LineKind;
    use domotwin_core::scene::mesh::NO_GROUP;
    use domotwin_core::scene::{SceneOptions, build_scene};

    let plan = read_plan(DEMO.as_bytes()).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    let count = |kind: LineKind| {
        scene.parts[0]
            .lines
            .iter()
            .filter(|l| l.kind == kind)
            .count()
    };
    // Each of the 5 rooms' floor is outlined (the bedroom has 5 corners).
    assert_eq!(count(LineKind::Floor), 4 * 4 + 5);
    // A window's frame has four sides (its sill too), a door's three; the entrance door is on a
    // façade, the three others on partitions that both their rooms outline.
    assert_eq!(count(LineKind::Opening), 6 * 4 + (1 + 3 * 2) * 3);
    assert!(count(LineKind::Wall) > 50);
    let [lo, hi] = scene.bounds;
    let groups = u8::try_from(scene.groups.len()).unwrap();
    for line in &scene.parts[0].lines {
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

#[test]
fn the_demo_home_is_built_storey_by_storey_with_its_roof() {
    use domotwin_core::scene::{SceneOptions, build_home, build_scene, stack_plans};

    let ground = read_plan(DEMO.as_bytes()).unwrap();
    let upper = read_plan(UPPER.as_bytes()).unwrap();
    let home = build_home(&[(&ground, 0.0), (&upper, 280.0)], &SceneOptions::default());
    let stacked = stack_plans(&[&ground, &upper]).unwrap();
    assert_eq!(
        stacked.elements.len(),
        ground.elements.len() + upper.elements.len()
    );
    // Two parts at their heights, each with its elements, the upper one's after the ground's.
    assert_eq!(home.parts.len(), 2);
    assert_eq!(home.parts[1].elevation, 280.0);
    assert_eq!(home.parts[1].first, ground.elements.len());
    assert_eq!(home.elements.len(), stacked.elements.len());
    for (info, element) in home.elements.iter().zip(&stacked.elements) {
        assert_eq!(info.id, element.id());
    }
    let upstairs = home.parts[1].first;
    assert!(home.elements[upstairs..].iter().all(|e| e.storey == 1));
    // The ground floor is drawn the same as alone; the upper floor's tags come after its.
    let alone = build_scene(&ground, &SceneOptions::default());
    assert_eq!(home.parts[0].opaque, alone.parts[0].opaque);
    assert_eq!(home.parts[0].lines, alone.parts[0].lines);
    let tags = |mesh: &domotwin_core::scene::mesh::Mesh| {
        mesh.extras
            .iter()
            .map(|e| usize::from(u16::from_le_bytes([e[2], e[3]])))
            .filter(|t| *t > 0)
            .collect::<Vec<_>>()
    };
    assert!(tags(&home.parts[1].opaque).iter().all(|t| *t > upstairs));
    // Rooms and lamps are the home's: slots go on upstairs, lamps know their storey.
    assert_eq!(
        home.rooms.len(),
        ground.rooms().count() + upper.rooms().count()
    );
    assert!(
        home.lights
            .iter()
            .any(|l| l.storey == 1 && l.element >= upstairs)
    );
    // The bounds hold both storeys; the roof covers the upper one, above its walls.
    assert!(f64::from(home.bounds[1][1]) > 280.0 + 200.0);
    let roof = home.roofs.iter().find(|r| r.storey == 1).unwrap();
    assert_eq!(roof.elevation, 280.0);
    let [low, _] = roof.mesh.bounds();
    assert!(f64::from(low[1]) > home.wall_height - 20.0, "{low:?}");
    assert!(roof.mesh.triangle_count() > 10 && !roof.wings.is_empty());
    // A storey alone has no roof.
    assert!(alone.roofs.is_empty());
}

const HOUSE: &str = include_str!("../../../examples/demo-house.domotwin.json");
const HOUSE_UPPER: &str = include_str!("../../../examples/demo-house-upper.domotwin.json");

#[test]
fn the_demo_house_reads_storey_by_storey_with_ids_of_its_own() {
    let ground = read_plan(HOUSE.as_bytes()).unwrap();
    let upper = read_plan(HOUSE_UPPER.as_bytes()).unwrap();
    let (g, u) = (ground.summary(), upper.summary());
    assert_eq!((g.rooms, g.doors, g.windows, g.furniture), (12, 7, 5, 90));
    assert_eq!((u.rooms, u.doors, u.windows, u.furniture), (6, 5, 6, 43));
    // Its garden all round (D-077): five places outside, a lawn behind and in front.
    assert_eq!(ground.rooms().filter(|r| r.outside).count(), 5);
    assert!(upper.rooms().all(|r| !r.outside));
    // Its robots' docks, and the stairs up.
    assert!(ground.furniture().any(|f| f.kind == Kind::RobotVacuum));
    assert!(ground.furniture().any(|f| f.kind == Kind::RobotMower));
    assert!(ground.furniture().any(|f| f.kind == Kind::Stairs));
    // Ids are the home's (`DECISIONS.md`, D-026).
    for element in &upper.elements {
        assert!(ground.element(element.id()).is_none(), "{}", element.id());
    }
    for plan in [&ground, &upper] {
        let scene =
            domotwin_core::scene::build_scene(plan, &domotwin_core::scene::SceneOptions::default());
        assert!(scene.parts[0].opaque.triangle_count() > 1000);
        // Every room is reached from another through a door or an open side.
        let walls = domotwin_core::geometry::walls::WallLayout::new(plan);
        let floor = domotwin_core::walk::Floor::new(plan, &walls);
        let first = plan.rooms().next().unwrap();
        let spot = floor.room_spot(&first.id).unwrap();
        assert_eq!(floor.reachable_ids(spot).len(), plan.rooms().count());
    }
}
