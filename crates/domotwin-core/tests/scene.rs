//! Golden checks of the scene built from the demo plan, and every furniture kind at odd sizes.

#![allow(clippy::unwrap_used, clippy::panic, clippy::print_stdout)]

use domotwin_core::plan::{Element, Kind, read_plan};
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{SceneOptions, build_scene};

const DEMO: &[u8] = include_bytes!("../../../examples/demo-apartment.plan.json");

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
    check_mesh(&scene.opaque);
    check_mesh(&scene.transparent);
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
    let triangles = scene.opaque.triangle_count() + scene.transparent.triangle_count();
    assert!(triangles < 120_000, "{triangles} triangles");
    println!(
        "demo scene: {} + {} vertices, {triangles} triangles, {} groups",
        scene.opaque.vertex_count(),
        scene.transparent.vertex_count(),
        scene.groups.len()
    );
}

#[test]
fn every_kind_builds_at_any_size() {
    let mut elements = Vec::new();
    for (i, kind) in Kind::ALL.iter().enumerate() {
        for (j, [w, h, z]) in [[1.0, 1.0, 1.0], [37.0, 52.0, 81.0], [600.0, 300.0, 300.0]]
            .iter()
            .enumerate()
        {
            elements.push(serde_json::json!({
                "id": format!("f{i}-{j}"), "type": "furniture", "name": "x", "kind": kind.name(),
                "x": 100 + i * 10, "y": 100, "w": w, "h": h, "z": z, "angle": 33,
                "model": if *kind == Kind::Custom { serde_json::json!("m1") } else { serde_json::Value::Null },
            }));
        }
    }
    let plan = serde_json::json!({
        "version": 1, "unit": "cm", "layoutRevision": 10, "elements": elements,
        "models": { "m1": { "name": "Stool", "size": [38, 38, 71], "kit": { "parts": [
            { "shape": "cylinder", "at": [0, 0, 62], "size": [38, 38, 4], "material": "accent:wood" },
            { "shape": "cylinder", "at": [17, 17, 0], "size": [4, 4, 62], "axis": "y", "taper": 0.5 },
            { "shape": "box", "at": [0, 0, 30], "size": [38, 2, 2], "rotate": [10, -20, 45], "material": "glass" },
            { "shape": "sphere", "at": [10, 10, 66], "size": [18, 18, 10], "material": "metal:#808080" }
        ] } } }
    });
    let plan = read_plan(plan.to_string().as_bytes()).unwrap();
    let scene = build_scene(&plan, &SceneOptions::default());
    check_mesh(&scene.opaque);
    check_mesh(&scene.transparent);
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
    check_mesh(&scene.dynamic_opaque);
    check_mesh(&scene.dynamic_transparent);
    // Doors are moving parts only: none of their vertices is in the static mesh.
    let door = plan
        .elements
        .iter()
        .position(|e| e.id() == "door-entrance")
        .unwrap();
    let tag = u16::try_from(door + 1).unwrap().to_le_bytes();
    let has = |mesh: &Mesh| mesh.extras.iter().any(|e| [e[2], e[3]] == tag);
    assert!(!has(&scene.opaque) && has(&scene.dynamic_opaque));
    // Opening it moves its leaf.
    let mut overrides = Overrides::default();
    overrides.open.insert(door, 0.0);
    let (closed, _) = build_dynamic(&plan, &scene, &overrides);
    overrides.open.insert(door, 1.0);
    let (open, _) = build_dynamic(&plan, &scene, &overrides);
    assert_eq!(closed.vertex_count(), open.vertex_count());
    assert_ne!(closed.positions, open.positions);
    // A blind appears on a window bound to a cover.
    let window = plan
        .elements
        .iter()
        .position(|e| e.id() == "win-living-1")
        .unwrap();
    overrides.blind.insert(window, 0.5);
    let (blind, _) = build_dynamic(&plan, &scene, &overrides);
    assert!(blind.vertex_count() > open.vertex_count());
    // Every room, wall and piece belongs to a room slot.
    for info in &scene.elements {
        assert!(info.room > 0, "{} has no room", info.id);
    }
    assert_eq!(scene.rooms.len(), 5);
}
