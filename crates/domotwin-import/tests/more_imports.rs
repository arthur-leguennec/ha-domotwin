//! The imports of D-057 (robot vacuum maps, Floorplanner, mesh scans), from the fictional files of
//! `make-import-fixtures.py`, and what a careless or hostile file does to them.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::{Duration, Instant};

use domotwin_core::plan::read_plan_value;
use domotwin_import::PlanFile;
use serde_json::{Value, json};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn names(plan: &Value, list: &str, field: &str) -> Vec<String> {
    plan[list]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e[field].as_str().unwrap_or_default().to_owned())
        .collect()
}

fn outline(room: &Value) -> Vec<[f64; 2]> {
    serde_json::from_value(room["outline"].clone()).unwrap()
}

fn area(points: &[[f64; 2]]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        .abs()
        / 2.0
}

fn width(opening: &Value) -> f64 {
    let (a, b): ([f64; 2], [f64; 2]) = (
        serde_json::from_value(opening["from"].clone()).unwrap(),
        serde_json::from_value(opening["to"].clone()).unwrap(),
    );
    (b[0] - a[0]).hypot(b[1] - a[1])
}

/// Every side of every room along an axis: the plan is square.
fn square(plan: &Value) -> bool {
    plan["rooms"].as_array().unwrap().iter().all(|room| {
        let o = outline(room);
        (0..o.len()).all(|i| {
            let (a, b) = (o[i], o[(i + 1) % o.len()]);
            (a[0] - b[0]).abs() < 0.2 || (a[1] - b[1]).abs() < 0.2
        })
    })
}

#[test]
fn a_valetudo_map_as_its_api_gives_it_and_as_home_assistant_receives_it() {
    let json = fixture("robot.json");
    // Over MQTT, deflated.
    let deflated = miniz_oxide::deflate::compress_to_vec_zlib(&json, 6);
    for (name, bytes) in [
        ("robot.json", json.clone()),
        ("robot.png", fixture("robot.png")),
        ("map-data", deflated),
    ] {
        let file = PlanFile::read(bytes, "Robot").unwrap();
        assert_eq!(file.format(), "robot", "{name}");
        let storeys = file.storeys();
        assert_eq!(storeys.len(), 1, "{name}");
        assert_eq!(
            (storeys[0].spaces, storeys[0].doors, storeys[0].furniture),
            (4, 3, 1),
            "{name}"
        );
        let (plan, report, cards) = file.convert(0).unwrap();
        read_plan_value(&plan).unwrap();
        assert!(cards.is_empty());
        assert_eq!(
            (report.rooms, report.doors, report.windows, report.furniture),
            (4, 3, 0, 1),
            "{name}"
        );
        // Kept by their segments' ids, named as in Valetudo, turned square.
        assert_eq!(
            names(&plan, "rooms", "id"),
            ["segment-16", "segment-17", "segment-18", "segment-19"]
        );
        assert_eq!(
            names(&plan, "rooms", "name"),
            ["Living room", "Kitchen", "Hall", "Bedroom"]
        );
        assert!(square(&plan), "{name}: {plan:#}");
        // Its floors: wood in the living room, tiles in the kitchen.
        assert_eq!(plan["rooms"][0]["floor"]["material"], "oak");
        assert_eq!(plan["rooms"][1]["floor"]["material"], "beige-tiles");
        // 5 × 4 m and 2.9 × 4 m, within the thickness of a wall.
        let living = area(&outline(&plan["rooms"][0]));
        assert!((living - 505.0 * 405.0).abs() < 5_000.0, "{living}");
        let wall = plan["wallThickness"]["interior"].as_f64().unwrap();
        assert!((wall - 10.0).abs() <= 2.5, "{wall}");
        // The wide passage to the kitchen is an opening; the doors 80 and 90 cm.
        assert_eq!(plan["doors"][0]["style"], "opening");
        assert!((width(&plan["doors"][0]) - 180.0).abs() < 12.0);
        assert!((width(&plan["doors"][1]) - 80.0).abs() < 12.0);
        assert!((width(&plan["doors"][2]) - 90.0).abs() < 12.0);
        // The dock in the hall, its back to the wall, facing in.
        let dock = &plan["items"][0];
        assert_eq!(
            (dock["kind"].as_str(), dock["room"].as_str()),
            (Some("robot-vacuum"), Some("segment-18"))
        );
        assert_eq!(dock["rotation"], 90.0);
    }
}

#[test]
fn roborocks_own_map_as_valetudo_re_serves_it() {
    let file = PlanFile::read(fixture("roborock.gz"), "Roborock").unwrap();
    assert_eq!(file.format(), "robot");
    let (plan, report, _) = file.convert(0).unwrap();
    read_plan_value(&plan).unwrap();
    assert_eq!((report.rooms, report.doors, report.furniture), (4, 3, 1));
    assert_eq!(
        names(&plan, "rooms", "id"),
        ["segment-16", "segment-17", "segment-18", "segment-19"]
    );
    assert!(square(&plan), "{plan:#}");
    // The same flat as Valetudo's, not mirrored: the same rooms where they were.
    let (valetudo, _, _) = PlanFile::read(fixture("robot.json"), "x")
        .unwrap()
        .convert(0)
        .unwrap();
    for k in 0..4 {
        let (a, b) = (outline(&plan["rooms"][k]), outline(&valetudo["rooms"][k]));
        assert!((area(&a) - area(&b)).abs() < 3_000.0, "{a:?} {b:?}");
    }
    assert_eq!(plan["items"][0]["room"], "segment-18");
}

#[test]
fn a_floorplanner_project_of_two_floors() {
    let file = PlanFile::read(fixture("apartment.fml"), "apartment").unwrap();
    assert_eq!(file.format(), "fml");
    let storeys = file.storeys();
    assert_eq!(storeys.len(), 2);
    assert_eq!(
        (
            storeys[0].name.as_str(),
            storeys[0].elevation,
            storeys[0].spaces
        ),
        ("Ground floor", 0.0, 4)
    );
    assert!(storeys[0].elevation.is_sign_positive());
    assert_eq!(
        (
            storeys[1].name.as_str(),
            storeys[1].elevation,
            storeys[1].spaces
        ),
        ("Attic", 270.0, 1)
    );
    let (plan, report, _) = file.convert(0).unwrap();
    read_plan_value(&plan).unwrap();
    assert_eq!(plan["name"], "Fictional apartment – Ground floor");
    // The kitchen named by its label, not by its area.
    assert_eq!(
        names(&plan, "rooms", "name"),
        ["Living room", "Kitchen", "Bathroom", "Hall"]
    );
    assert_eq!(
        (
            report.rooms,
            report.doors,
            report.windows,
            report.furniture,
            report.skipped_spaces,
            report.unplaced_openings
        ),
        (4, 4, 3, 4, 1, 0)
    );
    assert_eq!(
        plan["wallThickness"],
        json!({ "interior": 10.0, "exterior": 20.0 })
    );
    // Inside walls from 10 to 495 cm, moved to the origin and out to the partition's middle.
    assert_eq!(
        plan["rooms"][0]["outline"],
        json!([[0.0, 0.0], [490.0, 0.0], [490.0, 340.0], [0.0, 340.0]])
    );
    // The living room's door to the kitchen, 1.4 m, centred at `t` = 0.29 of its wall.
    let door = &plan["doors"][1];
    assert!((width(door) - 140.0).abs() < 0.5, "{door}");
    let (from, to): ([f64; 2], [f64; 2]) = (
        serde_json::from_value(door["from"].clone()).unwrap(),
        serde_json::from_value(door["to"].clone()).unwrap(),
    );
    assert!(((from[1] + to[1]) / 2.0 - 164.0).abs() < 0.5, "{door}");
    // Pieces: by their names, else a box of their size.
    assert_eq!(
        names(&plan, "items", "kind"),
        ["sofa", "box", "fridge", "bathtub"]
    );
    // The attic, drawn with walls only.
    let (attic, report, _) = file.convert(1).unwrap();
    read_plan_value(&attic).unwrap();
    assert_eq!(attic["name"], "Fictional apartment – Attic");
    assert_eq!((report.rooms, report.windows), (1, 1));
}

#[test]
fn a_house_scanned_as_a_mesh() {
    for name in ["house.obj", "house.glb"] {
        let file = PlanFile::read(fixture(name), "House").unwrap();
        assert_eq!(file.format(), "mesh", "{name}");
        let storeys = file.storeys();
        assert_eq!(storeys.len(), 2, "{name}");
        assert_eq!(storeys[1].elevation, 280.0, "{name}");
        assert_eq!(
            (storeys[0].spaces, storeys[0].doors, storeys[0].windows),
            (3, 3, 2),
            "{name}"
        );
        assert_eq!(
            (storeys[1].spaces, storeys[1].doors, storeys[1].windows),
            (3, 2, 1),
            "{name}"
        );
        for storey in &storeys {
            let (plan, report, _) = file.convert(storey.id).unwrap();
            read_plan_value(&plan).unwrap();
            assert_eq!(report.unplaced_openings, 0, "{name}");
            assert!(square(&plan), "{name}: {plan:#}");
            // Its 10 cm partitions, measured; no furniture read.
            let wall = plan["wallThickness"]["interior"].as_f64().unwrap();
            assert!((wall - 10.0).abs() <= 2.5, "{name}: {wall}");
            assert!(plan["items"].as_array().unwrap().is_empty());
        }
        // The ground floor: the living room 5 × 5 m, the kitchen whole under its wall
        // cabinets and beside its fridge column, a 95 cm front door, a 1.4 m window.
        let (plan, _, _) = file.convert(0).unwrap();
        let mut areas: Vec<f64> = plan["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| area(&outline(r)))
            .collect();
        areas.sort_by(f64::total_cmp);
        assert!(
            (areas[2] - 505.0 * 500.0).abs() < 6_000.0,
            "{name}: {areas:?}"
        );
        assert!(
            (areas[0] - 305.0 * 245.0).abs() < 6_000.0,
            "{name}: {areas:?}"
        );
        let mut doors: Vec<f64> = plan["doors"]
            .as_array()
            .unwrap()
            .iter()
            .map(width)
            .collect();
        doors.sort_by(f64::total_cmp);
        assert!((doors[2] - 95.0).abs() < 11.0, "{name}: {doors:?}");
        let mut windows: Vec<f64> = plan["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(width)
            .collect();
        windows.sort_by(f64::total_cmp);
        assert!((windows[1] - 140.0).abs() < 11.0, "{name}: {windows:?}");
    }
    // Its ground floor in a PLY, `z` up, in centimetres: the same rooms.
    let ply = PlanFile::read(fixture("house.ply"), "House").unwrap();
    let storeys = ply.storeys();
    assert_eq!(storeys.len(), 1);
    assert_eq!(
        (storeys[0].spaces, storeys[0].doors, storeys[0].windows),
        (3, 3, 2)
    );
}

#[test]
fn a_stray_far_from_the_scan_changes_nothing() {
    // A triangle 500 m away at the floor's height, another 300 m up, as photogrammetry leaves
    // some.
    let mut obj = String::from_utf8(fixture("house.obj")).unwrap();
    let n = obj.lines().filter(|l| l.starts_with("v ")).count();
    obj += "v 500 0 500\nv 500.3 0 500\nv 500 0 500.3\nv 3 300 3\nv 3.3 300 3\nv 3 300 3.3\n";
    obj += &format!("f {} {} {}\n", n + 1, n + 3, n + 2);
    obj += &format!("f {} {} {}\n", n + 4, n + 6, n + 5);
    let stray = PlanFile::read(obj.into_bytes(), "House").unwrap();
    let clean = PlanFile::read(fixture("house.obj"), "House").unwrap();
    assert_eq!(stray.storeys().len(), 2);
    for storey in 0..2 {
        let (a, _, _) = stray.convert(storey).unwrap();
        let (b, _, _) = clean.convert(storey).unwrap();
        assert_eq!(a["rooms"], b["rooms"]);
        assert_eq!(a["doors"], b["doors"]);
    }
}

#[test]
fn files_it_cannot_read_say_what_to_do() {
    let code = |bytes: &[u8]| PlanFile::read(bytes.to_vec(), "x").err();
    // A picture without a map in it.
    let mut picture = fixture("robot.png");
    let at = picture.windows(4).position(|w| w == b"zTXt").unwrap();
    picture[at + 4] = b'v';
    assert_eq!(code(&picture), Some("picture"));
    // Floorplanner's older XML.
    assert_eq!(
        code(b"<?xml version=\"1.0\"?>\n<project><floors><floor><designs/></floor></floors></project>"),
        Some("fml_xml")
    );
    // Points without faces, a glTF with its buffers apart, an FBX.
    assert_eq!(
        code(b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n"),
        Some("mesh_points")
    );
    assert_eq!(
        code(br#"{"asset": {"version": "2.0"}, "meshes": [], "buffers": [{"uri": "scan.bin"}]}"#),
        Some("mesh_gltf")
    );
    assert_eq!(code(b"Kaydara FBX Binary  \x00\x1a\x00"), Some("mesh_fbx"));
    // A robot map with no pixel size, a mesh with no floor.
    assert_eq!(
        code(br#"{"__class": "ValetudoMap", "layers": []}"#),
        Some("not_plan")
    );
    let flat = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    assert!(matches!(code(flat), Some("no_spaces") | None));
    // A gzipped text that is no plan.
    let gz = [
        &[0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3][..],
        &miniz_oxide::deflate::compress_to_vec(b"hello", 6),
        &[0; 8],
    ]
    .concat();
    assert_eq!(code(&gz), Some("not_plan"));
    // Deflated, larger than an import unpacks.
    let mut big = b"{".to_vec();
    big.resize(65_000_000, b' ');
    let deflated = miniz_oxide::deflate::compress_to_vec_zlib(&big, 1);
    assert_eq!(code(&deflated), Some("too_large"));
}

#[test]
fn cut_short_anywhere_they_neither_crash_nor_hang() {
    let started = Instant::now();
    for name in [
        "robot.json",
        "robot.png",
        "roborock.gz",
        "apartment.fml",
        "house.glb",
        "house.ply",
    ] {
        let bytes = fixture(name);
        let n = bytes.len();
        for k in 1..32 {
            let cut = bytes[..n * k / 32].to_vec();
            if let Ok(file) = PlanFile::read(cut, "x") {
                for storey in file.storeys() {
                    if let Ok((plan, _, _)) = file.convert(storey.id) {
                        read_plan_value(&plan).unwrap();
                    }
                }
            }
        }
    }
    assert!(started.elapsed() < Duration::from_secs(60));
}

#[test]
fn hostile_maps_and_meshes_run_out_of_budget() {
    let code = |bytes: Vec<u8>| PlanFile::read(bytes, "x").err();
    // Pixels claimed by the billion, and far apart.
    let runs: Vec<u64> = (0..5).flat_map(|y| [0, y, 900_000]).collect();
    let many = json!({ "pixelSize": 5, "layers": [
        { "type": "segment", "compressedPixels": runs, "metaData": {} }] });
    assert_eq!(code(many.to_string().into_bytes()), Some("too_large"));
    let far = json!({ "pixelSize": 5, "layers": [
        { "type": "segment", "pixels": [0, 0, 900_000, 900_000], "metaData": {} }] });
    let file = PlanFile::read(far.to_string().into_bytes(), "x").unwrap();
    assert_eq!(file.convert(0).err(), Some("too_large"));
    // Rooms each as large as the map: each drawn on a grid of its own, past the budget in all.
    let layers: Vec<_> = (0..60)
        .map(|k| {
            json!({ "type": "segment", "pixels": [0, 0, 1500, 1500],
            "metaData": { "segmentId": k.to_string() } })
        })
        .collect();
    let wide = json!({ "pixelSize": 5, "layers": layers });
    let start = Instant::now();
    let file = PlanFile::read(wide.to_string().into_bytes(), "x").unwrap();
    assert_eq!(file.storeys()[0].doors, 0);
    assert_eq!(file.convert(0).err(), Some("too_large"));
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    // Rooms drawn over one another: every cell between two of them.
    let square: Vec<u64> = (0..750).flat_map(|y| [0, y, 750]).collect();
    let layers: Vec<_> = (0..3)
        .map(|k| {
            json!({ "type": "segment", "compressedPixels": square,
            "metaData": { "segmentId": k.to_string() } })
        })
        .collect();
    let over = json!({ "pixelSize": 5, "layers": layers });
    let start = Instant::now();
    let file = PlanFile::read(over.to_string().into_bytes(), "x").unwrap();
    assert_eq!(file.convert(0).err(), Some("too_large"));
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "{:?}",
        start.elapsed()
    );
    // A Roborock image larger than any map.
    let mut rr = b"rr".to_vec();
    rr.extend_from_slice(&20_u16.to_le_bytes());
    rr.extend_from_slice(&[0; 16]);
    rr.extend_from_slice(&2_u16.to_le_bytes());
    rr.extend_from_slice(&24_u16.to_le_bytes());
    rr.extend_from_slice(&u32::MAX.to_le_bytes());
    for v in [0_u32, 0, 4096, 4096] {
        rr.extend_from_slice(&v.to_le_bytes());
    }
    assert!(matches!(code(rr), Some("too_large" | "not_plan")));
    // A PLY claiming a trillion elements of nothing, or more vertices than it holds.
    let started = Instant::now();
    let empty = b"ply\nformat binary_little_endian 1.0\nelement junk 1000000000000\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1000000000\nproperty list uchar int vertex_indices\nend_header\n";
    assert_eq!(code(empty.to_vec()), Some("not_plan"));
    assert!(started.elapsed() < Duration::from_secs(5));
    // A mesh of huge floor triangles over one another: past its budget, quickly.
    let started = Instant::now();
    let mut obj = String::from("v 0 0 0\nv 60 0 0\nv 0 0 60\nv 0 2.5 0\nv 60 2.5 0\nv 0 2.5 60\n");
    for _ in 0..200_000 {
        obj += "f 1 3 2\nf 4 5 6\n";
    }
    let result = PlanFile::read(obj.into_bytes(), "x");
    assert!(
        matches!(result.as_ref().err(), Some(&"mesh_too_large")) || result.is_ok(),
        "{:?}",
        result.err()
    );
    assert!(started.elapsed() < Duration::from_secs(60));
}
