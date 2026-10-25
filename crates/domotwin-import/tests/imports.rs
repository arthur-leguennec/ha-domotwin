//! The plans of other apps (D-040), from the fictional files of `make-import-fixtures.py`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use domotwin_core::plan::read_plan_value;
use domotwin_import::PlanFile;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn names(plan: &serde_json::Value, list: &str, field: &str) -> Vec<String> {
    plan[list]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e[field].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_sweet_home_3d_home_of_two_levels() {
    let file = PlanFile::read(fixture("cottage.sh3d"), "Cottage").unwrap();
    assert_eq!(file.format(), "sh3d");
    let storeys = file.storeys();
    assert_eq!(storeys.len(), 2);
    assert_eq!(
        (
            storeys[0].name.as_str(),
            storeys[0].spaces,
            storeys[0].doors,
            storeys[0].windows
        ),
        ("Ground floor", 4, 4, 3)
    );
    assert_eq!(
        (storeys[1].name.as_str(), storeys[1].elevation),
        ("Upstairs", 262.0)
    );

    let (plan, report, cards) = file.convert(storeys[0].id).unwrap();
    assert!(cards.is_empty());
    read_plan_value(&plan).unwrap();
    assert_eq!(plan["name"], "Cottage – Ground floor");
    assert_eq!(
        names(&plan, "rooms", "name"),
        ["Living room", "Kitchen", "Bathroom", "Hall"]
    );
    assert_eq!(
        (
            report.doors,
            report.windows,
            report.furniture,
            report.unplaced_openings
        ),
        (4, 3, 12, 0)
    );
    // The rooms meet in the middle of their partitions: one wall, 10 cm; the façades 20.
    assert_eq!(
        plan["wallThickness"],
        serde_json::json!({ "interior": 10.0, "exterior": 20.0 })
    );
    assert_eq!(
        plan["rooms"][0]["outline"][1],
        serde_json::json!([490.0, 0.0])
    );
    assert_eq!(
        plan["rooms"][1]["outline"][0],
        serde_json::json!([490.0, 0.0])
    );
    // Pieces by name, the group's too; the lamp by its height.
    assert_eq!(
        names(&plan, "items", "kind"),
        [
            "sofa",
            "coffee-table",
            "tv",
            "floor-lamp",
            "fridge",
            "stove",
            "bathtub",
            "vanity",
            "toilet",
            "dining-table",
            "chair",
            "chair"
        ]
    );
    // The home's own ids: importing it again keeps the bindings.
    assert_eq!(plan["doors"][0]["id"], "doorOrWindow-1");
    assert_eq!(plan["items"][3]["id"], "light-1");
    // Upstairs, walls only: the rooms between them.
    let (upstairs, report, _) = file.convert(storeys[1].id).unwrap();
    read_plan_value(&upstairs).unwrap();
    assert_eq!((report.rooms, report.doors, report.furniture), (2, 1, 2));
}

#[test]
fn a_dxf_drawing_in_millimetres() {
    let file = PlanFile::read(fixture("studio.dxf"), "Studio").unwrap();
    assert_eq!(file.format(), "dxf");
    let (plan, report, _) = file.convert(0).unwrap();
    read_plan_value(&plan).unwrap();
    assert_eq!(plan["name"], "Studio");
    assert_eq!(names(&plan, "rooms", "name"), ["Séjour", "Chambre"]);
    assert_eq!(
        (report.rooms, report.doors, report.windows, report.furniture),
        (2, 1, 2, 4)
    );
    // In centimetres; the two rooms meet in the middle of the partition, the door on it.
    assert_eq!(
        plan["rooms"][0]["outline"],
        serde_json::json!([[0.0, 0.0], [485.0, 0.0], [485.0, 580.0], [0.0, 580.0]])
    );
    assert_eq!(plan["doors"][0]["from"], serde_json::json!([485.0, 310.0]));
    assert_eq!(plan["doors"][0]["opensTo"], "left");
    assert_eq!(
        names(&plan, "items", "kind"),
        ["bed", "sofa", "dining-table", "fridge"]
    );
    assert_eq!(plan["items"][2]["rotation"], 270.0);
    // The comment some apps write first, a byte-order mark, what some editors add at the end.
    for bytes in [
        [
            b"999\nwritten by an app\n".as_slice(),
            &fixture("studio.dxf"),
        ]
        .concat(),
        [
            b"\xEF\xBB\xBF".as_slice(),
            &fixture("studio.dxf"),
            b"\n\x1a",
        ]
        .concat(),
    ] {
        let file = PlanFile::read(bytes, "Studio").unwrap();
        assert_eq!((file.format(), file.storeys()[0].spaces), ("dxf", 2));
    }
}

#[test]
fn an_ifc_file_however_its_header_is_written() {
    let text = String::from_utf8(fixture("apartment-ifc4.ifc")).unwrap();
    for variant in [
        format!("/* written by an app */\n{text}"),
        text.replacen("ISO-10303-21;", "iso-10303-21;", 1),
    ] {
        let file = PlanFile::read(variant.into_bytes(), "x").unwrap();
        assert_eq!(file.format(), "ifc");
    }
}

#[test]
fn a_room_scan_as_json_or_usdz() {
    for name in ["scan.json", "scan.usdz"] {
        let file = PlanFile::read(fixture(name), "Scan").unwrap();
        assert_eq!(file.format(), "scan", "{name}");
        let (plan, report, _) = file.convert(0).unwrap();
        read_plan_value(&plan).unwrap();
        assert_eq!(
            (report.rooms, report.doors, report.windows, report.furniture),
            (1, 2, 1, 6),
            "{name}"
        );
        // Turned square to the axes: 5.2 × 4 m, as scanned.
        assert_eq!(
            plan["rooms"][0]["outline"],
            serde_json::json!([[0.0, 0.0], [520.0, 0.0], [520.0, 400.0], [0.0, 400.0]]),
            "{name}"
        );
        assert_eq!(plan["rooms"][0]["name"], "Living room");
        assert_eq!(plan["doors"][1]["style"], "opening");
        assert_eq!(
            names(&plan, "items", "kind"),
            ["sofa", "coffee-table", "tv", "counter", "sink", "chair"],
            "{name}"
        );
        // Standing on the floor; the television on the wall.
        assert!(plan["items"][0].get("lift").is_none(), "{name}");
        assert_eq!(plan["items"][2]["lift"], 100.0, "{name}");
    }
}

#[test]
fn a_scan_of_several_rooms_and_stories() {
    // As its JSON, which says the stories, and as its USDZ, which does not.
    for name in ["structure.json", "structure.usdz"] {
        let file = PlanFile::read(fixture(name), "Home").unwrap();
        let storeys = file.storeys();
        assert_eq!(storeys.len(), 2, "{name}");
        assert_eq!((storeys[0].spaces, storeys[1].spaces), (2, 1), "{name}");
        assert_eq!(storeys[1].elevation, 270.0, "{name}");
        let (plan, _, _) = file.convert(storeys[0].id).unwrap();
        read_plan_value(&plan).unwrap();
        assert_eq!(
            names(&plan, "rooms", "name"),
            ["Living room", "Bedroom"],
            "{name}"
        );
        // One wall between them, 12 cm as measured, the door in it.
        assert_eq!(plan["wallThickness"]["interior"], 12.0, "{name}");
        assert!(
            plan["rooms"][0]["outline"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!([406.0, 0.0])),
            "{name}"
        );
        assert_eq!(plan["doors"][0]["from"][0], 406.0, "{name}");
        // Upstairs, scanned without its floor: the room its walls make.
        let (upstairs, _, _) = file.convert(storeys[1].id).unwrap();
        assert_eq!(
            upstairs["rooms"][0]["outline"],
            serde_json::json!([[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]]),
            "{name}"
        );
    }
}

#[test]
fn files_it_cannot_read_say_why() {
    let code = |bytes: &[u8]| PlanFile::read(bytes.to_vec(), "x").err();
    assert_eq!(code(b"hello"), Some("not_plan"));
    assert_eq!(code(b""), Some("not_plan"));
    assert_eq!(code(b"AutoCAD Binary DXF\r\n\x1a\x00"), Some("dxf_binary"));
    assert_eq!(code(b"PK\x03\x04 not a zip"), Some("not_plan"));
    // A home saved before Sweet Home 3D 5.3: only its Java-serialised `Home`.
    let mut old = fixture("cottage.sh3d");
    // The entry renamed in both its headers: `Home.xml` → `Home.old`.
    while let Some(k) = old.windows(8).position(|w| w == b"Home.xml") {
        old[k + 5..k + 8].copy_from_slice(b"old");
    }
    assert_eq!(code(&old), Some("sh3d_old"));
    assert_eq!(code(b"ISO-10303-21;\nHEADER;\nENDSEC;\n"), Some("not_ifc"));
    // A scan's root layer alone, or in USD's binary format.
    assert_eq!(code(b"#usda 1.0\n"), Some("scan_usdz"));
    assert_eq!(code(b"PXR-USDC\x00\x08"), Some("scan_usdc"));
    assert_eq!(code(b"{\"rooms\": 3}"), Some("not_plan"));
    // A drawing cut short after its first section's start.
    let cut = PlanFile::read(b"0\nSECTION\n".to_vec(), "x").unwrap();
    assert_eq!(cut.convert(0).err(), Some("no_spaces"));
}
