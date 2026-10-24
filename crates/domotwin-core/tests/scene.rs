//! Golden checks of the scene built from the demo plan, and every furniture kind at odd sizes.

#![allow(clippy::unwrap_used, clippy::panic, clippy::print_stdout)]

use domotwin_core::plan::{Element, Kind, read_plan};
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{SceneOptions, build_scene};

const DEMO: &[u8] = include_bytes!("../../../examples/demo-apartment.domotwin.json");

fn check_mesh(mesh: &Mesh) {
    let n = mesh.vertex_count();
    assert_eq!(mesh.normals.len(), n);
    assert_eq!(mesh.colors.len(), n);
    assert_eq!(mesh.extras.len(), n);
    assert_eq!(mesh.uvs.len(), n);
    assert_eq!(mesh.indices.len() % 3, 0);
    assert!(mesh.indices.iter().all(|i| (*i as usize) < n));
    assert!(mesh.positions.iter().flatten().all(|v| v.is_finite()));
    assert!(mesh.uvs.iter().flatten().all(|v| v.is_finite()));
}

#[test]
fn demo_scene() {
    let plan = read_plan(DEMO).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    check_mesh(&scene.parts[0].opaque);
    check_mesh(&scene.parts[0].wall_mesh);
    check_mesh(&scene.parts[0].transparent);
    // The walls are a mesh of their own (glass in some looks), and nothing else is in it.
    assert!(scene.parts[0].wall_mesh.triangle_count() > 500);
    for e in &scene.parts[0].wall_mesh.extras {
        let index = usize::from(u16::from_le_bytes([e[2], e[3]])) - 1;
        assert!(matches!(
            plan.elements[index],
            Element::Room(_) | Element::Wall(_)
        ));
    }
    // Every element has geometry, inside the plan's footprint (with the walls around it).
    let [min, max] = plan.bounds();
    for info in &scene.elements {
        let [lo, hi] = info.bounds;
        assert!(lo != hi, "{} has no geometry", info.id);
        assert!(
            f64::from(lo[0]) > min[0] - 60.0 && f64::from(hi[0]) < max[0] + 60.0,
            "{}",
            info.id
        );
        assert!(
            f64::from(lo[2]) > min[1] - 60.0 && f64::from(hi[2]) < max[1] + 60.0,
            "{}",
            info.id
        );
    }
    // Walls come in a handful of direction groups, façades and partitions.
    assert!(
        scene.groups.len() >= 4 && scene.groups.len() <= 16,
        "{}",
        scene.groups.len()
    );
    assert!(scene.groups.iter().any(|g| g.inner) && scene.groups.iter().any(|g| !g.inner));
    // Lamps: every light kind has at least one source, on as in the plan.
    let lit = plan
        .furniture()
        .filter(|f| f.kind.is_light() && !f.light_off)
        .count();
    let on: std::collections::BTreeSet<usize> = scene
        .lights
        .iter()
        .filter(|l| l.on)
        .map(|l| l.element)
        .collect();
    assert_eq!(on.len(), lit);
    // A budget that keeps the demo light on old tablets.
    let triangles = scene.parts[0].opaque.triangle_count()
        + scene.parts[0].wall_mesh.triangle_count()
        + scene.parts[0].transparent.triangle_count();
    assert!(triangles < 120_000, "{triangles} triangles");
    println!(
        "demo scene: {} + {} + {} vertices, {triangles} triangles, {} groups",
        scene.parts[0].opaque.vertex_count(),
        scene.parts[0].wall_mesh.vertex_count(),
        scene.parts[0].transparent.vertex_count(),
        scene.groups.len()
    );
}

#[test]
fn every_kind_builds_at_any_size() {
    let mut items = Vec::new();
    for (i, kind) in Kind::ALL.iter().chain([&Kind::Box]).enumerate() {
        for (j, [w, h, z]) in [[1.0, 1.0, 1.0], [37.0, 52.0, 81.0], [600.0, 300.0, 300.0]]
            .iter()
            .enumerate()
        {
            items.push(serde_json::json!({
                "id": format!("f{i}-{j}"), "name": "x", "kind": kind.name(),
                "at": [100 + i * 10, 100], "size": [w, h, z], "rotation": 33,
            }));
        }
    }
    items.push(serde_json::json!({
        "id": "stool", "model": "m1", "at": [50, 50], "size": [38, 38, 71]
    }));
    let plan = serde_json::json!({
        "format": "domotwin-plan", "version": 1, "items": items,
        "models": { "m1": { "name": "Stool", "size": [38, 38, 71],
            "file": { "format": "glb", "hash": "a".repeat(64), "bytes": 100, "up": "y" } } }
    });
    let plan = read_plan(plan.to_string().as_bytes()).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    check_mesh(&scene.parts[0].opaque);
    check_mesh(&scene.parts[0].transparent);
    for (info, element) in scene.elements.iter().zip(&plan.elements) {
        let Element::Furniture(f) = element else {
            continue;
        };
        assert!(
            info.bounds[0] != info.bounds[1],
            "{} ({})",
            info.id,
            f.kind.name()
        );
    }
}

#[test]
fn moving_parts_rebuild_with_overrides() {
    use domotwin_core::scene::{Overrides, build_dynamic};
    let plan = read_plan(DEMO).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    check_mesh(&scene.parts[0].dynamic_opaque);
    check_mesh(&scene.parts[0].dynamic_transparent);
    // Doors are moving parts only: none of their vertices is in the static mesh.
    let door = plan
        .elements
        .iter()
        .position(|e| e.id() == "door-entrance")
        .unwrap();
    let tag = u16::try_from(door + 1).unwrap().to_le_bytes();
    let has = |mesh: &Mesh| mesh.extras.iter().any(|e| [e[2], e[3]] == tag);
    assert!(!has(&scene.parts[0].opaque) && has(&scene.parts[0].dynamic_opaque));
    // Opening it moves its leaf.
    let mut overrides = Overrides::default();
    overrides.open.insert(door, 0.0);
    let (closed, _) = build_dynamic(&plan, &scene, &overrides).swap_remove(0);
    overrides.open.insert(door, 1.0);
    let (open, _) = build_dynamic(&plan, &scene, &overrides).swap_remove(0);
    assert_eq!(closed.vertex_count(), open.vertex_count());
    assert_ne!(closed.positions, open.positions);
    // A blind appears on a window bound to a cover.
    let window = plan
        .elements
        .iter()
        .position(|e| e.id() == "win-living-1")
        .unwrap();
    overrides.blind.insert(window, 0.5);
    let (blind, _) = build_dynamic(&plan, &scene, &overrides).swap_remove(0);
    assert!(blind.vertex_count() > open.vertex_count());
    // Every room, wall and piece belongs to a room slot.
    for info in &scene.elements {
        assert!(info.room > 0, "{} has no room", info.id);
    }
    assert_eq!(scene.rooms.len(), 5);
}

#[test]
fn outlines_follow_the_walls() {
    use domotwin_core::geometry::heights::SILL;
    use domotwin_core::scene::lines::LineKind;

    // Two rooms 10 cm apart (a partition fills the gap), the first with a vertex halfway along
    // its top side, a window on that side and a door in the partition; a sharp triangle apart.
    let plan = serde_json::json!({
        "format": "domotwin-plan", "version": 1,
        "wallThickness": { "interior": 10, "exterior": 20 },
        "rooms": [
            { "id": "a", "name": "A",
              "outline": [[0, 0], [150, 0], [300, 0], [300, 300], [0, 300]] },
            { "id": "b", "name": "B", "outline": [[310, 0], [610, 0], [610, 300], [310, 300]] },
            { "id": "c", "name": "C", "outline": [[1000, 0], [1400, 0], [1000, 30]] }
        ],
        "windows": [{ "id": "w", "name": "W", "from": [40, 0], "to": [120, 0], "room": "a" }],
        "doors": [{ "id": "d", "name": "D", "from": [300, 100], "to": [300, 180], "room": "a" }]
    });
    let plan = read_plan(plan.to_string().as_bytes()).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    #[allow(clippy::cast_possible_truncation)]
    let height = scene.wall_height as f32;
    let near = |a: f32, b: f32| (a - b).abs() < 0.01;
    let walls = || {
        scene.parts[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::Wall)
    };
    // The partition's top runs once, on its middle: both rooms give it there, and neither on
    // its own face.
    let along_x = |x: f32| {
        walls()
            .filter(|l| near(l.a[1], height) && near(l.b[1], height))
            .filter(|l| near(l.a[0], x) && near(l.b[0], x))
            .count()
    };
    assert_eq!(along_x(300.0) + along_x(310.0), 0);
    assert!(along_x(305.0) >= 2);
    // No corner up the wall where the sides run on.
    let vertical_at = |x: f32, z: f32| {
        walls().any(|l| near(l.a[0], x) && near(l.a[2], z) && near(l.b[0], x) && near(l.b[2], z))
    };
    assert!(!vertical_at(150.0, 0.0));
    assert!(vertical_at(0.0, 0.0));
    // The window's frame goes with the cut-away below its sill; the door's stands on the floor.
    #[allow(clippy::cast_possible_truncation)]
    let sill = SILL as f32;
    let frames: Vec<_> = scene.parts[0]
        .lines
        .iter()
        .filter(|l| l.kind == LineKind::Opening)
        .collect();
    assert!(frames.iter().any(|l| near(l.base, sill)));
    assert!(frames.iter().any(|l| l.base == 0.0));
    for line in &frames {
        assert!(line.base <= line.a[1].min(line.b[1]) + 0.01, "{line:?}");
    }
    // The outer faces of the sharp triangle's façades stop at its corners.
    for line in walls().filter(|l| l.a[0] > 900.0) {
        for p in [line.a, line.b] {
            assert!(p[0] > 1000.0 - 90.0 && p[0] < 1400.0 + 90.0, "{line:?}");
            assert!(p[2] > -90.0 && p[2] < 30.0 + 90.0, "{line:?}");
        }
    }
}
