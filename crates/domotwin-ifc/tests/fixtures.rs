//! The fictional IFC files of `tests/fixtures` (written by `scripts/make-ifc-fixtures.py`) become
//! plans that the core reads and draws, with every door and window on a wall.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use domotwin_core::geometry::walls::on_contour;
use domotwin_core::plan::{Element, Plan};
use domotwin_core::read_plan;
use domotwin_core::scene::{SceneOptions, build_scene};
use domotwin_ifc::{IfcFile, Report};
use serde_json::Value;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn convert(name: &str, storey: usize) -> (Value, Report, Plan) {
    let file = IfcFile::read(fixture(name)).unwrap();
    let storeys = file.storeys();
    let (json, report) = file.convert(storeys[storey].id, name).unwrap();
    let text = serde_json::to_vec(&json).unwrap();
    let plan =
        read_plan(&text).unwrap_or_else(|e| panic!("{name}: the core refuses the plan: {e:?}"));
    (json, report, plan)
}

fn rooms(plan: &Plan) -> Vec<(&str, Vec<[f64; 2]>)> {
    plan.elements
        .iter()
        .filter_map(|e| match e {
            Element::Room(r) => Some((r.name.as_str(), r.points())),
            _ => None,
        })
        .collect()
}

/// Every door and window lies on the contour of a room, so it cuts its wall.
fn openings_on_walls(plan: &Plan) {
    let rooms = rooms(plan);
    for (opening, _) in plan.openings() {
        assert!(
            rooms.iter().any(|(_, points)| on_contour(opening, points)),
            "{} is on no room side",
            opening.name
        );
    }
}

fn kinds(json: &Value) -> Vec<String> {
    let mut kinds: Vec<String> = json["elements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "furniture")
        .map(|e| e["kind"].as_str().unwrap().to_owned())
        .collect();
    kinds.sort();
    kinds
}

fn bounds(points: &[[f64; 2]]) -> [f64; 4] {
    points.iter().fold(
        [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ],
        |b, p| {
            [
                b[0].min(p[0]),
                b[1].min(p[1]),
                b[2].max(p[0]),
                b[3].max(p[1]),
            ]
        },
    )
}

#[test]
fn apartment_ifc4() {
    let file = IfcFile::read(fixture("apartment-ifc4.ifc")).unwrap();
    assert_eq!(file.schema(), "IFC4");
    let storeys = file.storeys();
    assert_eq!(storeys.len(), 1);
    assert_eq!(storeys[0].name, "Level 0");
    assert_eq!((storeys[0].doors, storeys[0].windows), (6, 4));

    let (json, report, plan) = convert("apartment-ifc4.ifc", 0);
    assert_eq!(json["title"], "Fictional building – Level 0");
    let names: Vec<&str> = rooms(&plan).iter().map(|(n, _)| *n).collect();
    assert_eq!(
        names,
        [
            "Living room",
            "Kitchen",
            "Bedroom",
            "Bathroom",
            "Hall",
            "Storage"
        ]
    );
    // The balcony is outside, the gross floor area holds the others.
    assert_eq!(report.skipped_spaces, 2);
    assert_eq!(
        (report.doors, report.windows, report.unplaced_openings),
        (6, 4, 0)
    );
    assert_eq!(report.skipped_furniture, 1, "the unknown proxy");
    assert_eq!(json["wallSettings"]["interior"], 10.0);
    assert_eq!(json["wallSettings"]["exterior"], 30.0);

    // Living room 5 × 4 m and kitchen 3 × 4 m (net), now meeting in the middle of their wall.
    let all = rooms(&plan);
    let living = bounds(&all[0].1);
    let kitchen = bounds(&all[1].1);
    assert!(
        (living[2] - kitchen[0]).abs() < 0.5,
        "{living:?} {kitchen:?}"
    );
    assert!((living[2] - living[0] - 505.0).abs() < 0.5);
    // Plan y points down: the bedroom (IFC y 4.4–8.0 m) is above the living room (0.3–4.3 m).
    let bedroom = bounds(&all[2].1);
    assert!(bedroom[3] <= living[1] + 0.5);

    openings_on_walls(&plan);
    let doors: Vec<&Value> = json["elements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "door")
        .collect();
    let style = |name: &str| {
        doors
            .iter()
            .find(|d| d["name"] == name)
            .map(|d| d["style"].as_str().unwrap().to_owned())
            .unwrap()
    };
    assert_eq!(style("Glazed double door"), "double");
    assert_eq!(style("Bedroom door"), "coulissante");
    assert_eq!(style("Storage door"), "pliante");
    assert_eq!(style("Entrance door"), "battante");

    assert_eq!(
        kinds(&json),
        [
            "bathtub",
            "bed",
            "cabinet",
            "ceilinglight",
            "chair",
            "chair",
            "chair",
            "chair",
            "counter",
            "dining",
            "fridge",
            "lamp",
            "linen",
            "nightstand",
            "nightstand",
            "pendant",
            "sink",
            "sofa",
            "stove",
            "table",
            "toilet",
            "tv",
            "vanity",
            "washer"
        ]
    );
    let pendant = json["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "pendant")
        .unwrap();
    assert_eq!(pendant["elevation"], 160.0);
    assert_eq!(pendant["parent"], json["elements"][0]["id"]);

    // The core draws it.
    let scene = build_scene(&plan, &SceneOptions::default());
    assert!(
        scene.parts[0].opaque.triangle_count() + scene.parts[0].wall_mesh.triangle_count() > 1000
    );
}

#[test]
fn house_ifc2x3_two_storeys_turned() {
    let file = IfcFile::read(fixture("house-ifc2x3.ifc")).unwrap();
    assert_eq!(file.schema(), "IFC2X3");
    let storeys = file.storeys();
    let names: Vec<&str> = storeys.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Rez-de-chaussée", "Étage"]);
    assert!((storeys[1].elevation - 280.0).abs() < 1e-6);

    let (json, report, plan) = convert("house-ifc2x3.ifc", 0);
    let names: Vec<&str> = rooms(&plan).iter().map(|(n, _)| *n).collect();
    assert_eq!(names, ["Séjour", "Cuisine", "Entrée", "WC"]);
    assert_eq!(
        (report.doors, report.windows, report.unplaced_openings),
        (2, 1, 0)
    );
    openings_on_walls(&plan);
    assert_eq!(kinds(&json), ["fridge", "sofa", "table", "toilet"]);
    // Turned by 30°: the doors follow, far from the georeferenced origin.
    for e in json["elements"].as_array().unwrap() {
        assert!(e["x"].as_f64().unwrap().abs() < 2000.0, "{e}");
    }
    let double = json["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == "Porte cuisine")
        .unwrap();
    assert_eq!(double["style"], "double");
    // The plan is turned back so that the walls run along the axes: a door in a wall along
    // IFC +y runs up the plan (270°, y down).
    let angle = double["angle"].as_f64().unwrap();
    assert!((angle - 270.0).abs() < 0.2, "got {angle}");
    assert_eq!(json["wallSettings"]["interior"], 15.0);

    let (json, _, plan) = convert("house-ifc2x3.ifc", 1);
    assert_eq!(rooms(&plan).len(), 2);
    assert_eq!(kinds(&json), ["bed"]);
}

#[test]
fn studio_in_feet() {
    let (json, report, plan) = convert("studio-feet-ifc4.ifc", 0);
    let all = rooms(&plan);
    let studio = bounds(&all[0].1);
    // 6 m wide (in feet in the file), plus half of the 10 cm partition.
    assert!((studio[2] - studio[0] - 605.0).abs() < 1.0, "{studio:?}");
    assert_eq!(report.doors, 1);
    openings_on_walls(&plan);
    let door = json["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "door")
        .unwrap();
    assert!((door["w"].as_f64().unwrap() - 75.0).abs() < 0.2);
}

#[test]
fn refusals() {
    let file = IfcFile::read(fixture("no-spaces-ifc4.ifc")).unwrap();
    let storey = file.storeys()[0].id;
    assert_eq!(file.convert(storey, "x").unwrap_err(), "no_spaces");
    assert_eq!(file.convert(1, "x").unwrap_err(), "no_storeys");
    assert_eq!(
        IfcFile::read(b"{\"version\":1}".to_vec()).unwrap_err(),
        "not_ifc"
    );
    assert_eq!(
        IfcFile::read(b"ISO-10303-21;\nDATA;\n#1=IFCWALL('x',$,$);\nENDSEC;".to_vec()).unwrap_err(),
        "not_ifc"
    );
}
